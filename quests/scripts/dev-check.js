// Pre-flight: fail fast with a clear error if 8000/5173 are taken.
// Skips silently when no tool is available.
import { execSync } from "node:child_process";

function check(port, name) {
  let out = "";
  for (const cmd of [
    `lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`,
    `fuser ${port}/tcp 2>/dev/null`,
    `ss -ltnpH 'sport = :${port}' 2>/dev/null`,  // -H = no header
  ]) {
    try {
      const r = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (r) { out = r; break; }
    } catch {}
  }
  if (out) {
    // out may be a single PID, or "pid=12345,..." from ss
    const pid = (out.match(/\d+/) || ["?"])[0];
    console.error(`✗ port ${port} (${name}) is busy — PID ${pid}`);
    console.error(`  Kill it:  kill ${pid}`);
    process.exit(1);
  }
  console.log(`✓ port ${port} (${name}) free`);
}

check(8000, "FastAPI / uvicorn");
check(5173, "Vite dev server");
