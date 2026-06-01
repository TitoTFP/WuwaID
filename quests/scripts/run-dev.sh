#!/bin/bash
# Helper: start the dev server, wait until both ports are live, run smoke tests, then stop.
set -e
cd "$(dirname "$0")/.."
trap 'pkill -f "uvicorn app.main" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; pkill -f "cd web && vite" 2>/dev/null' EXIT
bun run dev > /tmp/dev.log 2>&1 &
BUN_PID=$!
echo "started bun run dev (pid $BUN_PID)"

for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -s -o /dev/null http://127.0.0.1:8000/api/chapters 2>/dev/null \
     && curl -s -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
    echo "both servers up after ${i}s"
    break
  fi
  sleep 1
done

echo "=== API direct ==="
curl -s "http://127.0.0.1:8000/api/chapters" | python3 -c "import json,sys; d=json.load(sys.stdin); print('chapters:', [c['name'] for c in d])"

echo "=== Vite SPA ==="
curl -sI http://127.0.0.1:5173/ | head -2

echo "=== Vite → /api proxy ==="
curl -s "http://127.0.0.1:5173/api/speakers" | python3 -c "import json,sys; d=json.load(sys.stdin); print('top speaker:', d[0]['name'])"

echo "=== SPA fallback (deep link) ==="
curl -s -o /dev/null -w "HTTP %{http_code}, %{size_download} bytes\n" http://127.0.0.1:5173/quests/119000000

echo
echo "open http://127.0.0.1:5173 in your browser"
echo "press Ctrl+C to stop"
wait $BUN_PID
