#!/usr/bin/env bash
# End-to-end curl walkthrough for the editor.
# Run with: bash scripts/manual-editor-test.sh
# Requires: server running on :8000, EDITOR_PASSWORD set in server env,
#           data/quests/106000002.json present.
# This creates and approves a real draft, mutating local gitignored data/index.db.
set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
QID="${QID:-106000002}"
LINE_ID="${LINE_ID:-1}"
PASSWORD="${EDITOR_PASSWORD:?set EDITOR_PASSWORD in the env}"

echo "== /api/me (anon)"
curl -sS -c /tmp/cookies.txt "$BASE/api/me" | tee /tmp/me.json
echo

echo "== POST /api/login"
curl -sS -c /tmp/cookies.txt -X POST -H "Content-Type: application/json" \
  -d "{\"password\":\"$PASSWORD\"}" "$BASE/api/login" | tee /tmp/login.json
echo

echo "== /api/me (editor)"
curl -sS -b /tmp/cookies.txt "$BASE/api/me" | tee /tmp/me.json
echo

echo "== POST /api/editor/drafts (anonymous — set X-Author-Label)"
curl -sS -X POST -H "Content-Type: application/json" -H "X-Author-Label: test-$(date +%s)" \
  -d "{\"qid\":$QID,\"line_id\":$LINE_ID,\"patch\":{\"text_en\":\"Howdy.\"}}" \
  "$BASE/api/editor/drafts" | tee /tmp/draft.json
DID=$(python3 -c "import json; print(json.load(open('/tmp/draft.json'))['id'])")
echo "draft id: $DID"

echo "== GET /api/drafts (editor sees it)"
curl -sS -b /tmp/cookies.txt "$BASE/api/drafts" | python3 -m json.tool | head -20

echo "== POST /api/drafts/$DID/approve"
curl -sS -b /tmp/cookies.txt -X POST "$BASE/api/drafts/$DID/approve"
echo

echo "== GET /api/quests/$QID — verify text_en on line $LINE_ID"
curl -sS "$BASE/api/quests/$QID" | python3 -c "
import json, sys
q = json.load(sys.stdin)
line = next(l for l in q['all_lines'] if l['id'] == $LINE_ID)
print('text_en:', repr(line['text_en']))
assert line['text_en'] == 'Howdy.', 'edit not visible'
print('OK — edit visible in viewer')
"
