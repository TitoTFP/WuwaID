import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DatabaseManager } from '../db';
import { LogMeta } from '../types';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wuwaid-db-test-'));
}

test('DatabaseManager operations', () => {
  const tempDir = createTempDir();
  const db = new DatabaseManager(tempDir);

  try {
    // 1. Test log uploads
    const upload: LogMeta = {
      id: 'test-id-123',
      app_version: 'v2.5.0',
      timestamp: '20260525T030000',
      os: 'Windows 11',
      file_count: 3,
      total_bytes: 456,
      created_at: new Date().toISOString(),
      storage_path: path.join(tempDir, 'logs', 'v2.5.0', '20260525', 'test-id-123')
    };

    db.saveLogUpload(upload);

    // List logs
    const logs = db.listLogUploads();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, 'test-id-123');
    assert.strictEqual(logs[0].app_version, 'v2.5.0');
    assert.strictEqual(logs[0].os, 'Windows 11');

    // Get specific log
    const fetched = db.getLogUpload('test-id-123');
    assert.ok(fetched);
    assert.strictEqual(fetched!.file_count, 3);

    // 2. Test active players & heartbeats
    const now = new Date();
    db.saveActiveHeartbeat('client-abc', 'v2.5.0', 'method1', 'heartbeat', now);
    db.saveActiveHeartbeat('client-xyz', 'v2.5.0', 'method2', 'launch', new Date(now.getTime() + 1000));

    // Active summary (10 min window)
    const summary = db.getActiveSummary(now, 10 * 60 * 1000);
    assert.strictEqual(summary.active, 2);

    // Active players list
    const players = db.listActivePlayers(now, 10 * 60 * 1000);
    assert.strictEqual(players.length, 2);
    assert.strictEqual(players[0].client_id, 'client-xyz'); // Sorted by last seen DESC (xyz was saved second)
    assert.strictEqual(players[1].client_id, 'client-abc');

    // Test cutoff window
    const olderTime = new Date(now.getTime() - 15 * 60 * 1000); // 15 mins ago
    const olderSummary = db.getActiveSummary(now, 5 * 60 * 1000); // 5 min window
    assert.strictEqual(olderSummary.active, 2); // both are still within 5 min window since they are at "now"

    // Simulate query with past "now" to test cutoff
    const queryTime = new Date(now.getTime() + 15 * 60 * 1000); // query 15 mins in future
    const futureSummary = db.getActiveSummary(queryTime, 10 * 60 * 1000); // 10 min window in future
    assert.strictEqual(futureSummary.active, 0); // last seen was 15 mins ago, outside 10 min window

    // 3. Test history points
    const history = db.getHistoryPoints(now, 60 * 60 * 1000); // 1 hour window
    assert.ok(history.length >= 1);
    
    // The total event types recorded
    const keys = db.collectEventKeys(history);
    assert.ok(keys.includes('heartbeat'));
    assert.ok(keys.includes('launch'));

    const deletedHistory = db.pruneHistory(new Date(now.getTime() + 60 * 60 * 1000));
    assert.strictEqual(deletedHistory, 2);
    assert.strictEqual(db.getHistoryPoints(now, 60 * 60 * 1000).length, 0);

    // 4. Test delete log
    db.deleteLogUpload('test-id-123');
    const logsAfterDelete = db.listLogUploads();
    assert.strictEqual(logsAfterDelete.length, 0);

  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
