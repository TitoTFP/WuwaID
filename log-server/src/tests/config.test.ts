import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, maxUploadBytes, retentionDurationMs, logDir } from '../config';

test('loadConfig defaults', () => {
  // Clear env vars
  const origPort = process.env.WUWAID_PORT;
  const origDataDir = process.env.WUWAID_DATA_DIR;
  const origMax = process.env.WUWAID_MAX_UPLOAD_MB;
  const origDays = process.env.WUWAID_RETENTION_DAYS;
  const origToken = process.env.WUWAID_ADMIN_TOKEN;

  delete process.env.WUWAID_PORT;
  delete process.env.WUWAID_DATA_DIR;
  delete process.env.WUWAID_MAX_UPLOAD_MB;
  delete process.env.WUWAID_RETENTION_DAYS;
  delete process.env.WUWAID_ADMIN_TOKEN;

  try {
    const cfg = loadConfig();
    assert.strictEqual(cfg.port, 8080);
    assert.ok(cfg.dataDir.length > 0);
    assert.strictEqual(cfg.maxUploadMB, 10);
    assert.strictEqual(cfg.retentionDays, 30);
    assert.strictEqual(cfg.adminToken, '');
  } finally {
    if (origPort) process.env.WUWAID_PORT = origPort;
    if (origDataDir) process.env.WUWAID_DATA_DIR = origDataDir;
    if (origMax) process.env.WUWAID_MAX_UPLOAD_MB = origMax;
    if (origDays) process.env.WUWAID_RETENTION_DAYS = origDays;
    if (origToken) process.env.WUWAID_ADMIN_TOKEN = origToken;
  }
});

test('loadConfig environment overrides', () => {
  const origPort = process.env.WUWAID_PORT;
  const origDataDir = process.env.WUWAID_DATA_DIR;
  const origMax = process.env.WUWAID_MAX_UPLOAD_MB;
  const origDays = process.env.WUWAID_RETENTION_DAYS;
  const origToken = process.env.WUWAID_ADMIN_TOKEN;

  process.env.WUWAID_PORT = '9090';
  process.env.WUWAID_DATA_DIR = '/tmp/wuwaid-test';
  process.env.WUWAID_MAX_UPLOAD_MB = '50';
  process.env.WUWAID_RETENTION_DAYS = '7';
  process.env.WUWAID_ADMIN_TOKEN = 'secret-token';

  try {
    const cfg = loadConfig();
    assert.strictEqual(cfg.port, 9090);
    assert.strictEqual(cfg.dataDir, '/tmp/wuwaid-test');
    assert.strictEqual(cfg.maxUploadMB, 50);
    assert.strictEqual(cfg.retentionDays, 7);
    assert.strictEqual(cfg.adminToken, 'secret-token');

    assert.strictEqual(maxUploadBytes(cfg), 50 * 1024 * 1024);
    assert.strictEqual(retentionDurationMs(cfg), 7 * 24 * 60 * 60 * 1000);
    assert.strictEqual(logDir(cfg), '/tmp/wuwaid-test/logs');
  } finally {
    if (origPort) process.env.WUWAID_PORT = origPort; else delete process.env.WUWAID_PORT;
    if (origDataDir) process.env.WUWAID_DATA_DIR = origDataDir; else delete process.env.WUWAID_DATA_DIR;
    if (origMax) process.env.WUWAID_MAX_UPLOAD_MB = origMax; else delete process.env.WUWAID_MAX_UPLOAD_MB;
    if (origDays) process.env.WUWAID_RETENTION_DAYS = origDays; else delete process.env.WUWAID_RETENTION_DAYS;
    if (origToken) process.env.WUWAID_ADMIN_TOKEN = origToken; else delete process.env.WUWAID_ADMIN_TOKEN;
  }
});
