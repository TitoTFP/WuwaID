#!/usr/bin/env bash
set -euo pipefail

# Start cloudflared and capture the tunnel URL
TUNNEL_LOG=$(mktemp /tmp/cloudflared-url.XXXXXX)
echo "Starting cloudflared tunnel..." | tee "$TUNNEL_LOG"

cloudflared tunnel --url http://localhost:8080 2>&1 | tee -a "$TUNNEL_LOG" &

CLOUDFLARED_PID=$!
echo "PID: $CLOUDFLARED_PID" >> "$TUNNEL_LOG"

# Wait for URL to appear in output
for i in $(seq 1 20); do
    sleep 1
    URL=$(grep -oP 'https://[a-z-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$URL" ]; then
        echo "TUNNEL_URL=$URL" >> "$TUNNEL_LOG"
        echo "TUNNEL_URL=$URL"
        break
    fi
done

if [ -z "${URL:-}" ]; then
    echo "URL_NOT_FOUND=true" >> "$TUNNEL_LOG"
    echo "URL_NOT_FOUND=true"
fi

# Keep running until killed
wait $CLOUDFLARED_PID 2>/dev/null || true
