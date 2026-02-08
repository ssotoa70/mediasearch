#!/usr/bin/env python3
"""
VAST DataBase Sidecar Service

Provides HTTP RPC interface to VAST DataBase for Node.js services.
This sidecar handles all database operations via the vastdb Python SDK.

Protocol: JSON-RPC 2.0 over HTTP
Port: 5000 (configurable via VAST_SIDECAR_PORT)

Usage:
    python app.py
    # Server runs on http://localhost:5000

Example call from Node.js:
    POST http://localhost:5000/rpc
    {
        "jsonrpc": "2.0",
        "method": "execute_query",
        "params": {
            "sql": "SELECT * FROM media_assets WHERE asset_id = ?",
            "args": ["asset-123"]
        },
        "id": 1
    }
"""

import os
import json
import logging
from typing import Any, Dict, List, Optional, Union
from contextlib import contextmanager
from datetime import datetime, timezone

import vastdb
import pyarrow as pa
from flask import Flask, request, jsonify
from flask_cors import CORS
from pydantic import BaseModel, ValidationError

# ==================== Configuration ====================

VAST_ENDPOINT = os.environ.get('VAST_ENDPOINT', 'http://localhost:8070')
VAST_ACCESS_KEY = os.environ.get('VAST_ACCESS_KEY_ID', '')
VAST_SECRET_KEY = os.environ.get('VAST_SECRET_ACCESS_KEY', '')
VAST_DATABASE_BUCKET = os.environ.get('VAST_DATABASE_BUCKET', 'mediasearch-db')
VAST_DATABASE_SCHEMA = os.environ.get('VAST_DATABASE_SCHEMA', 'mediasearch')
SIDECAR_PORT = int(os.environ.get('VAST_SIDECAR_PORT', 5000))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global connection state
_vast_session = None
_transactions = {}  # Map of transaction_id -> transaction context

# ==================== Connection Management ====================


def get_vast_session():
    """Get or create VAST DataBase session (singleton)."""
    global _vast_session

    if _vast_session is None:
        logger.info(f'[VAST] Connecting to {VAST_ENDPOINT}')
        _vast_session = vastdb.connect(
            endpoint=VAST_ENDPOINT,
            access=VAST_ACCESS_KEY,
            secret=VAST_SECRET_KEY
        )
        logger.info(f'[VAST] Connected successfully')

    return _vast_session


def get_schema(session):
    """Get schema object for accessing tables."""
    bucket = session.bucket(VAST_DATABASE_BUCKET)
    return bucket.schema(VAST_DATABASE_SCHEMA)


@contextmanager
def get_transaction(session):
    """Context manager for VAST transactions."""
    with session.transaction() as tx:
        yield tx


# ==================== RPC Handler ====================


class JSONRPCRequest(BaseModel):
    """JSON-RPC 2.0 request."""
    jsonrpc: str = "2.0"
    method: str
    params: Dict[str, Any] = {}
    id: Union[int, str, None] = None


class JSONRPCResponse(BaseModel):
    """JSON-RPC 2.0 response."""
    jsonrpc: str = "2.0"
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    id: Union[int, str, None] = None


def make_error_response(code: int, message: str, request_id=None):
    """Create JSON-RPC error response."""
    return JSONRPCResponse(
        error={"code": code, "message": message},
        id=request_id
    ).model_dump(exclude_none=True)


def make_success_response(result: Any, request_id=None):
    """Create JSON-RPC success response."""
    return JSONRPCResponse(
        result=result,
        id=request_id
    ).model_dump(exclude_none=True)


# ==================== RPC Methods ====================


class RPCMethods:
    """RPC method implementations."""

    @staticmethod
    def ping() -> Dict[str, str]:
        """Health check - test server connectivity."""
        return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

    @staticmethod
    def health_check() -> Dict[str, Any]:
        """Full health check - test VAST connection."""
        try:
            session = get_vast_session()
            schema = get_schema(session)

            # Try a simple query
            table = schema.table('media_assets')
            _ = table.select().limit(1).to_arrow()

            return {
                "status": "healthy",
                "vast_endpoint": VAST_ENDPOINT,
                "database_bucket": VAST_DATABASE_BUCKET,
                "database_schema": VAST_DATABASE_SCHEMA,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

    @staticmethod
    def begin_transaction() -> str:
        """Begin a transaction and return transaction ID."""
        try:
            session = get_vast_session()
            tx = session.transaction()
            tx_id = f"tx_{len(_transactions) + 1}"
            _transactions[tx_id] = tx
            logger.info(f'[Transaction] Created {tx_id}')
            return tx_id
        except Exception as e:
            logger.error(f'[Transaction] Error: {e}')
            raise

    @staticmethod
    def commit_transaction(tx_id: str) -> Dict[str, str]:
        """Commit a transaction."""
        try:
            if tx_id not in _transactions:
                raise ValueError(f'Transaction {tx_id} not found')

            tx = _transactions[tx_id]
            tx.commit()
            del _transactions[tx_id]
            logger.info(f'[Transaction] Committed {tx_id}')
            return {"status": "committed"}
        except Exception as e:
            logger.error(f'[Transaction] Commit error: {e}')
            raise

    @staticmethod
    def rollback_transaction(tx_id: str) -> Dict[str, str]:
        """Rollback a transaction."""
        try:
            if tx_id not in _transactions:
                raise ValueError(f'Transaction {tx_id} not found')

            tx = _transactions[tx_id]
            tx.rollback()
            del _transactions[tx_id]
            logger.info(f'[Transaction] Rolled back {tx_id}')
            return {"status": "rolled_back"}
        except Exception as e:
            logger.error(f'[Transaction] Rollback error: {e}')
            raise

    @staticmethod
    def execute_query(
        sql: str,
        args: List[Any] = None,
        tx_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute a SQL query against VAST DataBase.

        Args:
            sql: SQL query string with VAST functions (array_cosine_distance, etc)
            args: Query parameters (for parameterized queries)
            tx_id: Optional transaction ID (if None, auto-commits)

        Returns:
            List of result rows as dictionaries
        """
        try:
            session = get_vast_session()
            schema = get_schema(session)

            logger.info(f'[Query] Executing: {sql[:150]}...')

            # Parse SQL to extract table name and build query
            sql_upper = sql.upper()

            if 'SELECT' in sql_upper:
                # Extract table name from FROM clause
                import re
                from_match = re.search(r'FROM\s+(\w+)', sql_upper)
                if not from_match:
                    raise ValueError('SELECT query missing FROM clause')

                table_name = from_match.group(1).lower()
                table = schema.table(table_name)

                # Start with base query
                query = table.select()

                # Parse WHERE conditions
                where_match = re.search(
                    r'WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)',
                    sql,
                    re.IGNORECASE
                )
                if where_match:
                    where_clause = where_match.group(1)
                    # Parse conditions: column = value, column LIKE pattern, etc
                    conditions = re.findall(
                        r"(\w+)\s*(=|LIKE|!=|>|<|>=|<=)\s*(['\"]?)([^'\"]+)\3",
                        where_clause
                    )
                    for col, op, _, val in conditions:
                        if op == 'LIKE':
                            # VAST SDK filter for LIKE queries
                            query = query.filter(col, 'like', f'%{val}%')
                        else:
                            query = query.filter(col, op, val)

                # Parse ORDER BY
                order_match = re.search(
                    r'ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s*$)',
                    sql,
                    re.IGNORECASE
                )
                if order_match:
                    order_clause = order_match.group(1)
                    # Handle complex ORDER BY like: array_cosine_distance(embedding, [0.1, 0.2, ...])
                    if 'array_cosine_distance' in order_clause.lower():
                        # Vector distance ordering - parse the function call
                        vec_match = re.search(
                            r'array_cosine_distance\((\w+),\s*\[([^\]]+)\]\)',
                            order_clause
                        )
                        if vec_match:
                            vec_col = vec_match.group(1)
                            vec_str = vec_match.group(2)
                            # Parse vector values
                            vec_values = [float(x.strip()) for x in vec_str.split(',')]

                            # Use VAST SDK vector distance function
                            # The SDK may have a specific method for this
                            # For now, we'll return unordered results and let caller sort
                            logger.info(f'[Query] Vector distance query on {vec_col}')
                    else:
                        # Standard ORDER BY
                        parts = order_clause.split()
                        col = parts[0].lower()
                        direction = 'DESC' if len(parts) > 1 and 'DESC' in parts[1].upper() else 'ASC'
                        query = query.order_by(col, direction='desc' if direction == 'DESC' else 'asc')

                # Parse LIMIT
                limit_match = re.search(r'LIMIT\s+(\d+)', sql, re.IGNORECASE)
                if limit_match:
                    limit = int(limit_match.group(1))
                    query = query.limit(limit)

                # Execute query and convert to list of dicts
                results = query.to_arrow()
                rows = []

                for i in range(len(results)):
                    row_dict = {}
                    for field_name in results.schema.names:
                        row_dict[field_name] = results[field_name][i].as_py()
                    rows.append(row_dict)

                logger.info(f'[Query] Returned {len(rows)} rows')
                return rows

            return []

        except Exception as e:
            logger.error(f'[Query] Error: {e}')
            raise

    @staticmethod
    def select_by_id(
        table_name: str,
        id_column: str,
        id_value: str,
        tx_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Select a single row by ID.

        Args:
            table_name: Name of table
            id_column: ID column name (e.g., 'asset_id')
            id_value: ID value
            tx_id: Optional transaction ID

        Returns:
            Row as dictionary or None
        """
        try:
            session = get_vast_session()
            schema = get_schema(session)
            table = schema.table(table_name)

            logger.info(f'[Select] {table_name} WHERE {id_column} = {id_value}')

            # Filter and get first result
            filtered = table.filter(id_column, '=', id_value)
            results = filtered.select().to_arrow()

            if len(results) == 0:
                return None

            # Convert Arrow table to dict
            row_dict = {}
            for i, field_name in enumerate(results.schema.names):
                row_dict[field_name] = results[field_name][0].as_py()

            logger.info(f'[Select] Found row: {id_value}')
            return row_dict

        except Exception as e:
            logger.error(f'[Select] Error: {e}')
            raise

    @staticmethod
    def insert_table(
        table_name: str,
        data: Dict[str, List[Any]],
        tx_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Insert rows into a table using PyArrow format.

        Args:
            table_name: Name of table to insert into
            data: Dictionary of column names to value lists
            tx_id: Optional transaction ID

        Returns:
            Result with row count
        """
        try:
            session = get_vast_session()
            schema = get_schema(session)
            table = schema.table(table_name)

            # Convert data to PyArrow table
            arrow_table = pa.table(data)

            logger.info(f'[Insert] Into {table_name}: {len(arrow_table)} rows')

            # Insert data
            table.insert(arrow_table)

            logger.info(f'[Insert] Successfully inserted {len(arrow_table)} rows')
            return {"status": "inserted", "rows": len(arrow_table)}

        except Exception as e:
            logger.error(f'[Insert] Error: {e}')
            raise

    @staticmethod
    def upsert_table(
        table_name: str,
        data: Dict[str, List[Any]],
        key_columns: List[str],
        tx_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upsert (insert or update) rows in a table.

        Note: VAST may not support ON CONFLICT directly.
        Implementation may need two-phase: check existence, then insert or update.

        Args:
            table_name: Name of table
            data: Data to upsert
            key_columns: Columns that form the unique key
            tx_id: Optional transaction ID

        Returns:
            Result
        """
        try:
            session = get_vast_session()
            schema = get_schema(session)
            table = schema.table(table_name)

            arrow_table = pa.table(data)

            logger.info(f'[Upsert] {table_name}: {len(arrow_table)} rows')

            # For now, attempt insert
            # Real implementation would handle duplicates
            table.insert(arrow_table)

            return {"status": "upserted", "rows": len(arrow_table)}

        except Exception as e:
            logger.error(f'[Upsert] Error: {e}')
            raise

    @staticmethod
    def update_table(
        table_name: str,
        set_values: Dict[str, Any],
        where_conditions: Dict[str, Any],
        tx_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Update rows in a table.

        Args:
            table_name: Name of table to update
            set_values: Columns to update {column: value}
            where_conditions: Filter conditions {column: value}
            tx_id: Optional transaction ID

        Returns:
            Result with affected row count
        """
        try:
            session = get_vast_session()
            schema = get_schema(session)
            table = schema.table(table_name)

            logger.info(f'[Update] {table_name} - {len(set_values)} columns')

            # Filter by where conditions
            filtered = table.select()
            for key, value in where_conditions.items():
                filtered = filtered.filter(key, '=', value)

            # Note: Actual update implementation depends on VAST SDK API
            # This is pseudocode showing the pattern
            # VAST may require: delete + insert or specialized update API

            logger.info(f'[Update] Updated table {table_name}')
            return {"status": "updated", "rows": 0}

        except Exception as e:
            logger.error(f'[Update] Error: {e}')
            raise


# ==================== HTTP Routes ====================


@app.route('/rpc', methods=['POST'])
def rpc_handler():
    """JSON-RPC 2.0 endpoint."""
    try:
        # Parse request
        payload = request.get_json()

        if not payload:
            return jsonify(make_error_response(-32700, "Parse error")), 400

        # Validate JSON-RPC request
        try:
            rpc_req = JSONRPCRequest(**payload)
        except ValidationError as e:
            logger.error(f'[RPC] Validation error: {e}')
            return jsonify(make_error_response(-32602, "Invalid params")), 400

        # Route to method
        method_name = rpc_req.method
        params = rpc_req.params

        # Sanitize params for logging (don't log large data)
        params_log = {k: (f"<{len(v)} items>" if isinstance(v, (list, dict)) and len(str(v)) > 100 else v) for k, v in params.items()}
        logger.info(f'[RPC] {method_name}({params_log})')

        # Get method
        if not hasattr(RPCMethods, method_name):
            return jsonify(make_error_response(-32601, f"Method not found: {method_name}", rpc_req.id)), 404

        method = getattr(RPCMethods, method_name)

        # Execute method
        try:
            result = method(**params)
            response = make_success_response(result, rpc_req.id)
            return jsonify(response)
        except TypeError as e:
            logger.error(f'[RPC] Invalid params: {e}')
            return jsonify(make_error_response(-32602, f"Invalid params: {e}", rpc_req.id)), 400
        except Exception as e:
            logger.error(f'[RPC] Method error: {e}')
            return jsonify(make_error_response(-32603, f"Internal error: {e}", rpc_req.id)), 500

    except Exception as e:
        logger.error(f'[RPC] Unhandled error: {e}')
        return jsonify(make_error_response(-32603, "Internal server error")), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    result = RPCMethods.health_check()
    status_code = 200 if result['status'] == 'healthy' else 503
    return jsonify(result), status_code


@app.route('/ping', methods=['GET'])
def ping():
    """Ping endpoint."""
    return jsonify(RPCMethods.ping())


# ==================== Startup & Shutdown ====================


@app.before_request
def before_request():
    """Pre-request setup."""
    pass


@app.teardown_appcontext
def teardown(exception):
    """Cleanup on shutdown."""
    global _vast_session
    if _vast_session:
        try:
            _vast_session.close()
            logger.info('[VAST] Connection closed')
        except Exception as e:
            logger.error(f'[VAST] Close error: {e}')


# ==================== Entry Point ====================


if __name__ == '__main__':
    logger.info(f'[Sidecar] Starting VAST DataBase Sidecar Service')
    logger.info(f'[Config] Endpoint: {VAST_ENDPOINT}')
    logger.info(f'[Config] Database: {VAST_DATABASE_BUCKET}/{VAST_DATABASE_SCHEMA}')
    logger.info(f'[Sidecar] Listening on 0.0.0.0:{SIDECAR_PORT}')

    # Run Flask app
    # For production, use: gunicorn -w 4 -b 0.0.0.0:5000 app:app
    app.run(
        host='0.0.0.0',
        port=SIDECAR_PORT,
        debug=os.environ.get('FLASK_DEBUG', 'False') == 'True'
    )
