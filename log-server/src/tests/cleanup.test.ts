import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { runCleanup } from '../cleanup';
import { DatabaseManager } from '../db';
import { Config } from '../types';

test('cleanup prunes history older than 30 days without requiring a logs directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuwaid-cleanup-test-'));
  const db = new DatabaseManager(tempDir);
  const cfg: Config = {
    port: 8080,
    dataDir: tempDir,
    maxUploadMB: 10,
    retentionDays: 30,
    adminToken: '',
  };

  try {
    const now = Date.now();
    db.saveActiveHeartbeat('old-client', 'v1', 'test', 'heartbeat', new Date(now - 31 * 24 * 60 * 60 * 1000));
    db.saveActiveHeartbeat('recent-client', 'v1', 'test', 'heartbeat', new Date(now - 29 * 24 * 60 * 60 * 1000));

    runCleanup(cfg, db);

    const history = db.getHistoryPoints(new Date(now), 60 * 24 * 60 * 60 * 1000);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].events.heartbeat, 1);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
