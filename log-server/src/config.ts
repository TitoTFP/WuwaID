import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function defaultDataDir(): string {
  const home = os.homedir();
  if (home) {
    return path.join(home, 'wuwaid-log-data');
  }
  return '/var/lib/wuwaid-log-server';
}

export function loadConfig(): Config {
  const port = parseInt(process.env.WUWAID_PORT || '8080', 10);
  const dataDir = process.env.WUWAID_DATA_DIR || defaultDataDir();
  const maxUploadMB = parseInt(process.env.WUWAID_MAX_UPLOAD_MB || '10', 10);
  const retentionDays = parseInt(process.env.WUWAID_RETENTION_DAYS || '30', 10);
  const adminToken = process.env.WUWAID_ADMIN_TOKEN || '';

  return {
    port: isNaN(port) ? 8080 : port,
    dataDir,
    maxUploadMB: isNaN(maxUploadMB) ? 10 : maxUploadMB,
    retentionDays: isNaN(retentionDays) ? 30 : retentionDays,
    adminToken,
  };
}

export function maxUploadBytes(cfg: Config): number {
  return cfg.maxUploadMB * 1024 * 1024;
}

export function retentionDurationMs(cfg: Config): number {
  return cfg.retentionDays * 24 * 60 * 60 * 1000;
}

export function logDir(cfg: Config): string {
  return path.join(cfg.dataDir, 'logs');
}
