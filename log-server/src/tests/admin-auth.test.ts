import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, cfg, db } from '../server';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wuwaid-admin-auth-test-'));
}

test('admin API requires the configured header token', async () => {
  const originalDataDir = cfg.dataDir;
  const originalToken = cfg.adminToken;
  const tempDir = createTempDir();
  cfg.dataDir = tempDir;
  cfg.adminToken = 'baseline-admin-token';
  db.reopen(tempDir);

  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const baseUrl = `http://localhost:${port}`;

  try {
    for (const token of [undefined, 'wrong-token']) {
      const response = await fetch(
        `${baseUrl}/admin/api/logs`,
        token ? { headers: { 'X-Admin-Token': token } } : undefined,
      );
      assert.strictEqual(response.status, 401);
    }

    const logs = await fetch(`${baseUrl}/admin/api/logs`, {
      headers: { 'X-Admin-Token': cfg.adminToken },
    });
    assert.strictEqual(logs.status, 200);
    assert.deepStrictEqual(await logs.json(), []);

    const active = await fetch(`${baseUrl}/admin/api/active`, {
      headers: { 'X-Admin-Token': cfg.adminToken },
    });
    assert.strictEqual(active.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.reopen(originalDataDir);
    cfg.dataDir = originalDataDir;
    cfg.adminToken = originalToken;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test.todo('admin API denies access when WUWAID_ADMIN_TOKEN is unset');
