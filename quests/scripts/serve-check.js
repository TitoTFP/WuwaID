// Pre-flight for `bun run serve`: only checks the production port.
import { execSync } from "node:child_process";

let out = "";
for (const cmd of [
  `lsof -iTCP:8000 -sTCP:LISTEN -t 2>/dev/null`,
  `fuser 8000/tcp 2>/dev/null`,
  `ss -ltnpH 'sport = :8000' 2>/dev/null`,
]) {
  try {
    const r = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (r) { out = r; break; }
  } catch {}
}
if (out) {
  const pid = (out.match(/\d+/) || ["?"])[0];
  console.error(`✗ port 8000 busy — PID ${pid}`);
  console.error(`  Kill it:  kill ${pid}`);
  process.exit(1);
}
console.log("✓ port 8000 free");
