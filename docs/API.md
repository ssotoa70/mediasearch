# MediaSearch API Reference

## Search API (port 3001)

### Search

```http
GET /search?q={query}&type={type}&bucket={bucket}&speaker={speaker}&limit={limit}&offset={offset}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| q | string | required | Search query text |
| type | string | keyword | `keyword`, `semantic`, or `hybrid` |
| bucket | string | - | Filter by bucket |
| speaker | string | - | Filter by speaker label |
| limit | number | 20 | Max results (1-100) |
| offset | number | 0 | Pagination offset |

**Response:**
```json
{
  "query": "hello world",
  "type": "keyword",
  "total": 2,
  "results": [
    {
      "asset_id": "uuid",
      "start_ms": 5000,
      "end_ms": 7500,
      "snippet": "...hello world...",
      "score": 0.95,
      "speaker": "Speaker1",
      "asset": {
        "bucket": "media",
        "object_key": "video.mp4"
      }
    }
  ]
}
```

### Health Check

```http
GET /health
```

**Response:** `{ "status": "healthy" }`

### Statistics

```http
GET /stats
```

**Response:**
```json
{
  "keywordSearches": 100,
  "semanticSearches": 50,
  "hybridSearches": 25,
  "averageLatencyMs": 45
}
```

---

## Ingest Service (port 3000)

### Trigger S3 Event (Manual)

```http
POST /events/s3
Content-Type: application/json

{
  "event_type": "ObjectCreated",
  "bucket": "media",
  "object_key": "video.mp4",
  "etag": "abc123",
  "size": 1048576
}
```

**Response:** `{ "success": true }`

### Health Check

```http
GET /health
```

### Statistics

```http
GET /stats
```

**Response:**
```json
{
  "objectsCreated": 10,
  "objectsRemoved": 2,
  "jobsEnqueued": 10,
  "errors": 0
}
```

---

## Triage Service (port 3002)

### List Quarantined Assets

```http
GET /quarantined?limit={limit}&state={state}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| limit | number | Max results (default 50) |
| state | string | Filter by triage state |

**Response:**
```json
{
  "total": 2,
  "assets": [
    {
      "asset_id": "uuid",
      "bucket": "media",
      "object_key": "broken.mp4",
      "triage_state": "NEEDS_MEDIA_FIX",
      "recommended_action": "Re-encode media file",
      "last_error": "Unsupported codec",
      "attempt": 5,
      "ingest_time": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### List DLQ Items

```http
GET /dlq?limit={limit}
```

### Retry Asset

```http
POST /quarantined/{assetId}/retry
Content-Type: application/json

{
  "engine": "WHISPER"
}
```

### Skip Asset

```http
POST /quarantined/{assetId}/skip
Content-Type: application/json

{
  "reason": "Corrupt file, cannot process"
}
```

### Remove DLQ Item

```http
DELETE /dlq/{dlqId}
```

---

## Orchestrator Service (port 3003)

### Health Check

```http
GET /health
```

### Statistics

```http
GET /stats
```

**Response:**
```json
{
  "jobsProcessed": 100,
  "jobsSucceeded": 95,
  "jobsFailed": 5,
  "jobsRetried": 10,
  "jobsDLQ": 2
}
```

### Pause Processing

```http
POST /pause
```

### Resume Processing

```http
POST /resume
```
