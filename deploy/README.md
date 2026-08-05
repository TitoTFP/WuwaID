# Deploy notes for wuwaid-quests on tito-thinkpad
# Target: wuwaid.titotfp.my.id via Cloudflare Tunnel (logs-tunnel)

## 1. Prereqs on the server (one-time)
#   - uv:        curl -LsSf https://astral.sh/uv/install.sh | sh
#   - bun:       curl -fsSL https://bun.sh/install | bash
#   - repo:      git clone https://github.com/TitoTFP/WuwaID /home/nozomi/wuwaid-quests
#                (or rsync from this checkout; .git excluded)

## 2. Build the app
cd /home/nozomi/wuwaid-quests/quests
uv sync --frozen
uv run python scripts/build_index.py     # generates data/ (quests + FTS index)
bun install --frozen-lockfile
bun run build                            # -> web/dist/

## 3. Configure env
cp quests/.env.example /home/nozomi/wuwaid-quests/.env
#   WUWAID_ORIGINS=https://wuwaid.titotfp.my.id
#   WUWAID_LOG_SERVER_URL=https://logs.titotfp.my.id
#   WUWAID_ADMIN_TOKEN=<same token as log-server .env>
#   ADMIN_PASSWORD=<strong password for /admin/login>

## 4. Systemd (user unit)
mkdir -p ~/.config/systemd/user
cp deploy/wuwaid-quests.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wuwaid-quests
systemctl --user status wuwaid-quests      # verify :8000 listening

## 5. Cloudflare Tunnel: add hostname
# Edit ~/.cloudflared/config.yml, add before the 404 fallback:
#   - hostname: wuwaid.titotfp.my.id
#     service: http://127.0.0.1:8000
# Then: systemctl --user restart cloudflared-tunnel
# Verify: curl -s -o /dev/null -w "%{http_code}" https://wuwaid.titotfp.my.id/

## 6. Reindex after a game update (data/ is generated, not in git)
uv run python scripts/build_index.py

## Rollback
#   systemctl --user stop wuwaid-quests   # logs.titotfp.my.id unaffected
#   Revert the tunnel config if the hostname was added to the same tunnel.
