# WuwaID Log Server

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)]()

A modern, fullstack log upload server built using **TypeScript**, **Express**, and **SQLite**. It is designed to receive compressed log archives from the [WuwaIDLauncher](https://github.com/TitoTFP/WuwaIDLauncher) (Wuthering Waves Indonesian patch launcher), store them on disk, index metadata in SQLite, and present a premium, interactive administrative dashboard with glassmorphic Web UI elements.

---

## Features

- **Robust Backend (TypeScript + Express)** — High performance endpoints for uploads and queries.
- **Structured Storage (SQLite)** — Log metadata is stored in SQL tables (`wuwaid.db`), replacing flat JSON files.
- **Log Upload** — Accepts multipart ZIP uploads via `POST /api/logs`.
- **Automatic Migration** — Automatically imports old JSON-based player and history lists into the SQLite database on server startup.
- **Interactive Web UI Dashboard** — Rich dashboard with dark-mode glassmorphism styling (`/admin` panel):
  - **Live Search & Filter** — Fast client-side search by Client ID, version, or OS.
  - **Interactive Log Viewer** — Admins can browse files inside any upload, inspect log text content in-browser, and download the logs as a zip built on-the-fly.
  - **Interactive Chart** — Active events timeline visualization using Chart.js.
- **Retention & Cleanup** — Automated scheduler that prunes files and DB records older than N days.
- **Path Traversal Protection** — Validates and sanitizes paths in ZIP archives to prevent security breaches.
- **Concurrent Safe** — Backed by SQLite transactions and Node asynchronous file I/O.

---

## Quick Start

### 1. Prerequisites

- **Node.js** v20.0.0 or higher
- **npm** or yarn

### 2. Installation & Build

```bash
git clone https://github.com/TitoTFP/wuwaid-log-server.git
cd wuwaid-log-server

# Install dependencies
npm install

# Compile TypeScript backend and frontend bundle
npm run build
```

### 3. Running the Server

#### Development Mode (Hot Reload)
```bash
npm run dev
```

#### Production Mode
```bash
npm run start
```

Default: listens on `:8080`, stores databases and extracted logs in `~/wuwaid-log-data/`.

### 4. Running Tests

Runs config, database schema, active player migrations, and mock endpoint upload tests:
```bash
npm test
```

---

## API Documentation

### `POST /api/logs`
Upload a compressed log archive.

**Request** (multipart/form-data):
- `logs` (file): ZIP file containing log files.
- `appVersion` (string): Launcher version (e.g., `v2.5.0`).
- `timestamp` (string): Upload timestamp (e.g., `20260525T040000`).
- `os` (string): Operating system (e.g., `Windows 11`).

**Response `200 OK`**:
```json
{
  "status": "ok",
  "id": "7cd47eb0491b03b1",
  "file_count": 2,
  "total_bytes": 10240
}
```

---

### `POST /api/active/heartbeat`
Receives anonymous launcher heartbeat events.

**Request JSON**:
```json
{
  "client_id": "anonymous-guid",
  "launcher_version": "v2.5.0",
  "install_method": "method1",
  "event": "launch"
}
```

---

### `GET /admin/api/logs` (Requires X-Admin-Token)
Lists all log metadata records.

---

### `GET /admin/api/logs/:id/files` (Requires X-Admin-Token)
Lists files extracted inside a specific log upload.

---

### `GET /admin/api/logs/:id/files/:filename` (Requires X-Admin-Token)
Retrieves the raw text contents of an extracted log file.

---

### `GET /admin/api/logs/:id/download` (Requires X-Admin-Token)
Re-compresses log files inside the upload folder into a ZIP archive on-the-fly and downloads it.

---

## Configuration

Set the following environment variables to customize behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `WUWAID_PORT` | `8080` | Port server listens on |
| `WUWAID_DATA_DIR` | `~/wuwaid-log-data/` | Root directory for logs and SQLite database |
| `WUWAID_MAX_UPLOAD_MB` | `10` | Maximum size of upload ZIP files in MB |
| `WUWAID_RETENTION_DAYS` | `30` | Number of days to keep uploaded logs before cleanup |
| `WUWAID_ADMIN_TOKEN` | empty | Token matching the `X-Admin-Token` header for admin routes |

---

## Deployment

### Systemd Service

Create a service file at `/etc/systemd/system/wuwaid-log-server.service`:

```ini
[Unit]
Description=WuwaID Log Server (TypeScript Node App)
After=network-online.target

[Service]
Type=simple
User=ai
WorkingDirectory=/home/ai/wuwaid-log-server
Environment=WUWAID_PORT=8080 WUWAID_DATA_DIR=/home/ai/wuwaid-log-data/ WUWAID_ADMIN_TOKEN=your-secure-token
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reload and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable wuwaid-log-server
sudo systemctl start wuwaid-log-server
```

---

## License

MIT
