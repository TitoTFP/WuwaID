import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';
import { app, db, cfg } from '../server';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wuwaid-server-test-'));
}

test('Express Server API Endpoints', async (t) => {
  console.log('global.FormData:', global.FormData);
  console.log('global.fetch:', global.fetch);
  const tempDir = createTempDir();
  
  // Override dataDir in configuration
  cfg.dataDir = tempDir;
  db.reopen(tempDir);

  // Start server on an ephemeral port (0)
  const server = app.listen(0);
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Test Health Check
    await t.test('GET /health', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json() as { status: string };
      assert.strictEqual(data.status, 'ok');
    });

    // 2. Test Multipart Upload
    await t.test('POST /api/logs', async () => {
      // Create test zip in memory
      const zip = new AdmZip();
      zip.addFile('launcher-test.log', Buffer.from('hello from launcher log'));
      zip.addFile('game-test.log', Buffer.from('hello from game log'));
      const zipBuffer = zip.toBuffer();

      // Create Multipart Body
      const formData = new FormData();
      formData.append('appVersion', 'v2.5.0');
      formData.append('timestamp', '20260525T040000');
      formData.append('os', 'Windows 11');
      formData.append('logs', new Blob([zipBuffer]), 'logs.zip');

      const res = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        body: formData
      });

      if (res.status !== 200) {
        const bodyText = await res.text();
        assert.fail(`Upload 1 failed. Status: ${res.status}, Body: ${bodyText}`);
      }
      const data = await res.json() as { status: string, id: string, file_count: number, total_bytes: number };
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.file_count, 2);
      assert.ok(data.id);

      // Verify folder contents
      const uploads = db.listLogUploads();
      assert.strictEqual(uploads.length, 1);
      assert.strictEqual(uploads[0].id, data.id);
      
      const dirPath = uploads[0].storage_path;
      assert.ok(fs.existsSync(path.join(dirPath, 'launcher-test.log')));
      assert.ok(fs.existsSync(path.join(dirPath, 'game-test.log')));
      assert.ok(fs.existsSync(path.join(dirPath, 'metadata.json')));
    });

    // 3. Test Active Heartbeat
    await t.test('POST /api/active/heartbeat', async () => {
      const res = await fetch(`${baseUrl}/api/active/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'test-client-server',
          launcher_version: 'v2.5.0',
          install_method: 'method1',
          event: 'launch'
        })
      });
      
      assert.strictEqual(res.status, 200);
      const data = await res.json() as { status: string };
      assert.strictEqual(data.status, 'ok');

      // Verify DB row
      const summary = db.getActiveSummary(new Date(), 10 * 60 * 1000);
      assert.strictEqual(summary.active, 1);
    });

    // 4. Test Multipart Upload with Path Traversal
    await t.test('POST /api/logs with Path Traversal', async () => {
      // Create test zip with traversal entry
      const zip = new AdmZip();
      zip.addFile('dangerous.txt', Buffer.from('evil file'));
      zip.addFile('safe-log.log', Buffer.from('safe file'));
      zip.getEntries()[0].entryName = '../../../dangerous.txt';
      const zipBuffer = zip.toBuffer();

      const formData = new FormData();
      formData.append('appVersion', 'v2.5.0');
      formData.append('timestamp', '20260525T041000');
      formData.append('os', 'Windows 11');
      formData.append('logs', new Blob([zipBuffer]), 'logs.zip');

      const res = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        body: formData
      });

      if (res.status !== 200) {
        const bodyText = await res.text();
        assert.fail(`Upload 2 failed. Status: ${res.status}, Body: ${bodyText}`);
      }
      const data = await res.json() as { status: string, file_count: number };
      assert.strictEqual(data.file_count, 1); // Only safe-log.log is written, dangerous.txt is skipped

      // Verify no leaked files in parent dir
      assert.ok(!fs.existsSync(path.join(tempDir, 'dangerous.txt')));
    });

  } finally {
    // Shutdown server & DB
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
