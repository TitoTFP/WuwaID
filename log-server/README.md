# WuwaID Log Server

[![Go Version](https://img.shields.io/github/go-mod/go-version/TitoTFP/wuwaid-log-server)](https://go.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)]()

A lightweight, zero-dependency log upload server built in Go. Designed to receive compressed log archives from the [WuwaIDLauncher](https://github.com/TitoTFP/WuwaIDLauncher) (Wuthering Waves Indonesian patch launcher) and store them on disk with configurable retention.

## Features

- **Log Upload** — Accepts multipart ZIP uploads via `POST /api/logs`
- **Log Listing** — Lists all uploaded logs via `GET /api/logs` (JSON)
- **Health Check** — `GET /health` endpoint for monitoring
- **Active Player Count** — Anonymous launcher heartbeat via `POST /api/active/heartbeat`
- **CORS Support** — Cross-origin headers for browser-based launcher access
- **Configurable Retention** — Auto-cleanup of logs older than N days
- **Configurable Size Limit** — Max upload size in MB
- **Path Traversal Protection** — Zip entries with `../` are rejected
- **Subdirectory Support** — Zip entries organized in subfolders (e.g., `launcher/*`, `game/*`) are preserved with their directory structure
- **Concurrent Safe** — Handles multiple simultaneous uploads
- **Graceful Shutdown** — Clean stop via SIGINT/SIGTERM
- **No Dependencies** — Single binary, pure Go standard library

## Quick Start

### 1. Build

```bash
git clone https://github.com/TitoTFP/wuwaid-log-server.git
cd wuwaid-log-server
go build -ldflags="-X main.BuildInfo=$(git describe --tags --always 2>/dev/null || echo dev)" -o wuwaid-log-server .
```

### 2. Run

```bash
./wuwaid-log-server
```

Default: listens on `:8080`, stores data in `~/wuwaid-log-data/`.

### 3. Test

```bash
# Upload a log archive
curl -X POST http://localhost:8080/api/logs \
  -F "logs=@logs.zip" \
  -F "appVersion=v2.0.0" \
  -F "timestamp=20260516T143022" \
  -F "os=Windows 10"

# List uploaded logs
curl http://localhost:8080/api/logs

# Health check
curl http://localhost:8080/health
```

## API

### `POST /api/logs`

Upload a compressed log archive.

**Request** (multipart/form-data):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `logs` | file | ✅ | ZIP file containing `.log` files |
| `appVersion` | string | ✅ | Launcher version (e.g., `v2.0.0`) |
| `timestamp` | string | ✅ | Upload timestamp (e.g., `20260516T143022`) |
| `os` | string | ✅ | Operating system (e.g., `Windows 10`) |

**Response `200 OK`:**

```json
{
  "status": "ok",
  "id": "a1b2c3d4e5f6g7h8",
  "file_count": 3,
  "total_bytes": 15360
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| `400` | Missing fields, invalid zip, path traversal detected |
| `413` | Upload exceeds max size |

### `GET /api/logs`

List all uploaded logs, sorted by timestamp descending (newest first).

```json
[
  {
    "id": "a1b2c3d4e5f6g7h8",
    "app_version": "v2.0.0",
    "timestamp": "20260516T143022",
    "os": "Windows 10",
    "file_count": 3,
    "total_bytes": 15360,
    "created_at": "20260516T143022"
  }
]
```

### `GET /health`

Simple health check.

```json
{ "status": "ok" }
```

### `POST /api/active/heartbeat`

Receives anonymous launcher heartbeat events. No personal data, Windows user name,
or game path is required.

```json
{
  "client_id": "anonymous-random-id",
  "launcher_version": "2.2.0",
  "install_method": "method1",
  "event": "open"
}
```

### `GET /api/active`

Returns anonymous active launcher count for clients seen in the last 10 minutes.
If `WUWAID_ADMIN_TOKEN` is configured, pass it as `X-Admin-Token`.

```json
{
  "active": 12,
  "window_seconds": 600,
  "updated_at": "2026-05-24T00:00:00Z"
}
```

### `GET /api/active/players`

Returns active anonymous clients. Intended for private developer use. If
`WUWAID_ADMIN_TOKEN` is configured, pass it as `X-Admin-Token`.

## Configuration

The server is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WUWAID_PORT` | `8080` | Server port |
| `WUWAID_DATA_DIR` | `~/wuwaid-log-data/` | Data storage directory |
| `WUWAID_MAX_UPLOAD_MB` | `10` | Maximum upload size in MB |
| `WUWAID_RETENTION_DAYS` | `30` | Days to keep logs before auto-cleanup |
| `WUWAID_ADMIN_TOKEN` | empty | Optional token for active player read endpoints |

Example:

```bash
WUWAID_PORT=9090 WUWAID_MAX_UPLOAD_MB=50 ./wuwaid-log-server
```

## Storage Structure

Uploaded logs are stored on disk as follows:

```
{dataDir}/
└── logs/
    └── {appVersion}/
        └── {YYYYMMDD}/
            └── {uploadId}/
                ├── metadata.json     # Upload metadata
                └── launcher-*.log    # Extracted log files
```

## Deployment

### Systemd Service

```ini
[Unit]
Description=WuwaID Log Server
After=network-online.target

[Service]
Type=simple
ExecStart=/path/to/wuwaid-log-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Cloudflare Tunnel (Recommended)

Expose the server publicly without opening ports:

```bash
# 1. Authenticate
cloudflared tunnel login

# 2. Create tunnel
cloudflared tunnel create wuwaid-log

# 3. Configure (~/.cloudflared/config.yml)
tunnel: <TUNNEL_ID>
credentials-file: /home/user/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: logs.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404

# 4. Route DNS
cloudflared tunnel route dns wuwaid-log logs.yourdomain.com

# 5. Run
cloudflared tunnel run wuwaid-log
```

### Quick Tunnel (Ephemeral, No Domain Needed)

```bash
cloudflared tunnel --url http://localhost:8080
```

## Development

### Prerequisites

- [Go](https://go.dev/dl/) 1.26+
- Make (optional)

### Test

The project follows **Test-Driven Development (TDD)**:

```bash
# Run all tests
go test ./... -v -count=1

# Run specific test
go test ./... -run TestSaveLogUpload -v
```

The test suite includes:

| Package | Tests | Coverage |
|---------|-------|----------|
| Configuration | 6 | Defaults, env vars, computed fields |
| Handlers | 12 | Upload, list, health, CORS, method validation, content-type, path traversal |
| Storage | 10 | Save, list, get, concurrent saves, empty/invalid data, path traversal, **subfolder entries** |
| Cleanup | 7 | Retention, boundary, empty storage, non-log file preservation, scheduler |
| Security | 3 | Path traversal prevention, Content-Type validation |
| **Total** | **38** | — |

### Build

```bash
go build -ldflags="-X main.BuildInfo=$(git describe --tags --always 2>/dev/null || echo dev)" -o wuwaid-log-server .
```

## Architecture

```
┌──────────────┐     POST /api/logs (multipart ZIP)
│  Launcher/   │ ──────────────────────────────────> ┌──────────────────────┐
│  Client      │                                      │                      │
│              │     GET /api/logs (JSON)             │   WuwaID Log Server  │
│              │ ──────────────────────────────────> │                      │
│              │                                      │   ┌──────────────┐   │
│              │     GET /health (JSON)               │   │  Storage     │   │
│              │ ──────────────────────────────────> │   │  (Disk)      │   │
└──────────────┘                                      │   └──────────────┘   │
                                                      │                      │
                                                      │   ┌──────────────┐   │
                                                      │   │  Cleanup     │   │
                                                      │   │  Scheduler   │   │
                                                      │   └──────────────┘   │
                                                      └──────────────────────┘
```

## Why This Exists

The [WuwaIDLauncher](https://github.com/TitoTFP/WuwaIDLauncher) is a WPF application for installing the Indonesian language patch in Wuthering Waves. The launcher includes an optional **anonymous log upload** feature — when users encounter bugs, the logs are automatically sent to this server so developers can diagnose issues without asking users to manually find and send log files.

## License

MIT
