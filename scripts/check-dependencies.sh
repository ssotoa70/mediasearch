#!/usr/bin/env bash
#
# Dependency Guardrail Script
#
# This script enforces the VAST-only architecture by preventing
# production dependencies on external infrastructure services.
#
# Prohibited in production dependencies:
# - PostgreSQL clients (pg, postgres, @prisma/client with postgres)
# - Redis clients (redis, ioredis, bullmq)
# - S3/MinIO SDKs (@aws-sdk/client-s3, minio)
#
# These are ONLY allowed in packages/adapters/local-* for development.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROHIBITED_PATTERNS=(
    '"pg":'
    '"postgres":'
    '"@prisma/client":'
    '"redis":'
    '"ioredis":'
    '"bullmq":'
    '"@aws-sdk/client-s3":'
    '"minio":'
    '"@aws-sdk/s3-request-presigner":'
)

ALLOWED_PATHS=(
    "packages/adapters/local-postgres"
    "packages/adapters/local-queue"
    "packages/adapters/local-s3"
)

echo "=========================================="
echo " VAST Dependency Guardrail Check"
echo "=========================================="
echo ""

VIOLATIONS_FOUND=0

# Check each package.json outside of allowed paths
find_package_files() {
    find . -name "package.json" -not -path "*/node_modules/*" -not -path "./.git/*"
}

is_allowed_path() {
    local file_path="$1"
    for allowed in "${ALLOWED_PATHS[@]}"; do
        if [[ "$file_path" == *"$allowed"* ]]; then
            return 0
        fi
    done
    return 1
}

while IFS= read -r package_file; do
    # Skip if in allowed path
    if is_allowed_path "$package_file"; then
        echo -e "${YELLOW}[SKIP]${NC} $package_file (local adapter - allowed)"
        continue
    fi

    for pattern in "${PROHIBITED_PATTERNS[@]}"; do
        if grep -q "$pattern" "$package_file" 2>/dev/null; then
            echo -e "${RED}[FAIL]${NC} $package_file contains prohibited dependency: $pattern"
            VIOLATIONS_FOUND=1
        fi
    done
done < <(find_package_files)

echo ""

# Also check for any direct imports of prohibited packages in production code
echo "Checking for prohibited imports in source files..."

PROHIBITED_IMPORTS=(
    "from 'pg'"
    "from \"pg\""
    "require('pg')"
    "require(\"pg\")"
    "from 'redis'"
    "from \"redis\""
    "from 'ioredis'"
    "from \"ioredis\""
    "from 'bullmq'"
    "from \"bullmq\""
    "from '@aws-sdk/client-s3'"
    "from \"@aws-sdk/client-s3\""
    "from 'minio'"
    "from \"minio\""
)

check_source_files() {
    find . -type f \( -name "*.ts" -o -name "*.js" \) \
        -not -path "*/node_modules/*" \
        -not -path "./.git/*" \
        -not -path "*/dist/*"
}

while IFS= read -r source_file; do
    # Skip if in allowed path
    if is_allowed_path "$source_file"; then
        continue
    fi

    for import_pattern in "${PROHIBITED_IMPORTS[@]}"; do
        if grep -q "$import_pattern" "$source_file" 2>/dev/null; then
            echo -e "${RED}[FAIL]${NC} $source_file contains prohibited import: $import_pattern"
            VIOLATIONS_FOUND=1
        fi
    done
done < <(check_source_files)

echo ""

if [ $VIOLATIONS_FOUND -eq 1 ]; then
    echo -e "${RED}=========================================="
    echo " GUARDRAIL CHECK FAILED"
    echo "==========================================${NC}"
    echo ""
    echo "Production code must not depend on:"
    echo "  - PostgreSQL (use VAST DataBase)"
    echo "  - Redis/BullMQ (use VAST DataEngine)"
    echo "  - AWS S3 SDK/MinIO (use VAST S3-compatible storage)"
    echo ""
    echo "These dependencies are only allowed in:"
    echo "  - packages/adapters/local-postgres"
    echo "  - packages/adapters/local-queue"
    echo "  - packages/adapters/local-s3"
    echo ""
    exit 1
else
    echo -e "${GREEN}=========================================="
    echo " GUARDRAIL CHECK PASSED"
    echo "==========================================${NC}"
    echo ""
    echo "No prohibited dependencies found in production code."
    exit 0
fi
