#!/usr/bin/env bash
# wuwaid-tunnel.sh — Cloudflare Quick Tunnel wrapper for systemd
# Features:
#   - Captures tunnel URL automatically
#   - Exponential backoff on rate limit (429 Too Many Requests)
#   - Only exits with real error when needed
set -u
set -o pipefail

URL_FILE="$HOME/wuwaid-log-server/current-tunnel-url.txt"
HISTORY_DIR="$HOME/wuwaid-log-data/.tunnel"
HISTORY_FILE="$HISTORY_DIR/url-history.txt"
PID_FILE="/tmp/wuwaid-tunnel.pid"
CLOUDFLARED="$HOME/.local/bin/cloudflared"
TMP_OUTPUT=$(mktemp /tmp/wuwaid-tunnel.XXXXXX)

mkdir -p "$HISTORY_DIR"
echo "$$" > "$PID_FILE"

BACKOFF=5
MAX_BACKOFF=120

cleanup() {
    rm -f "$TMP_OUTPUT"
}
trap cleanup EXIT

echo "[wuwaid-tunnel] Starting cloudflared tunnel → http://localhost:8080 ..."

# Run tunnel, redirect everything to a temp file for parsing
# We use a temp file instead of a pipe so both cloudflared and any background work don't race
"$CLOUDFLARED" tunnel --url http://localhost:8080 > "$TMP_OUTPUT" 2>&1 &
CLOUDFLARED_PID=$!

# Wait for URL or error, with timeout
URL=""
WAIT_SECONDS=0
while [ $WAIT_SECONDS -lt 60 ]; do
    if [ ! -d "/proc/$CLOUDFLARED_PID" ]; then
        # cloudflared exited
        wait $CLOUDFLARED_PID 2>/dev/null || true
        EXIT_CODE=$?
        break
    fi

    # Read any new output
    NEW_OUTPUT=$(cat "$TMP_OUTPUT" 2>/dev/null)

    # Check for URL
    URL=$(echo "$NEW_OUTPUT" | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
    if [ -n "$URL" ]; then
        break
    fi

    # Check for 429 rate limit
    if echo "$NEW_OUTPUT" | grep -q "429 Too Many Requests" 2>/dev/null; then
        echo "[wuwaid-tunnel] ⚠️ Rate limited (429)! Backing off ${BACKOFF}s..."
        kill $CLOUDFLARED_PID 2>/dev/null || true
        wait $CLOUDFLARED_PID 2>/dev/null || true
        
        echo "[wuwaid-tunnel] Sleeping ${BACKOFF}s before retry..."
        sleep $BACKOFF
        
        # Exponential backoff (cap at 120s)
        BACKOFF=$((BACKOFF * 2))
        [ $BACKOFF -gt $MAX_BACKOFF ] && BACKOFF=$MAX_BACKOFF
        
        # Retry
        > "$TMP_OUTPUT"  # clear output file
        "$CLOUDFLARED" tunnel --url http://localhost:8080 > "$TMP_OUTPUT" 2>&1 &
        CLOUDFLARED_PID=$!
        WAIT_SECONDS=0
        continue
    fi

    sleep 1
    WAIT_SECONDS=$((WAIT_SECONDS + 1))
done

# If we found a URL, save it
if [ -n "$URL" ]; then
    OLD_URL=""
    [ -f "$URL_FILE" ] && OLD_URL=$(cat "$URL_FILE")

    if [ "$URL" != "$OLD_URL" ]; then
        echo "$URL" > "$URL_FILE"
        TIMESTAMP=$(date -Iseconds)
        echo "$TIMESTAMP | $URL" >> "$HISTORY_FILE"
        echo ""
        echo "═══════════════════════════════════════════════"
        echo "  🎯 NEW TUNNEL URL: $URL"
        echo "  📁 Saved to: $URL_FILE"
        echo "═══════════════════════════════════════════════"
        echo ""
    fi

    # Now keep running — wait for cloudflared to exit
    # Print any remaining output
    cat "$TMP_OUTPUT" 2>/dev/null
    wait $CLOUDFLARED_PID 2>/dev/null || true
    EXIT_CODE=$?
    echo "[wuwaid-tunnel] ⚠️ cloudflared exited (code: $EXIT_CODE). Restarting..."
else
    # No URL found — check for errors
    cat "$TMP_OUTPUT" 2>/dev/null
    echo "[wuwaid-tunnel] ❌ Failed to get tunnel URL (exit: ${EXIT_CODE:-unknown}). Retrying..."
fi

exit 1  # Force systemd to restart
