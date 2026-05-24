export interface LogMeta {
  id: string;
  app_version: string;
  timestamp: string;
  os: string;
  file_count: number;
  total_bytes: number;
  created_at: string;
  storage_path: string;
}

export interface ActivePlayer {
  client_id: string;
  launcher_version: string;
  install_method: string;
  event: string;
  last_seen: string;
}

export interface ActiveSummary {
  active: number;
  window_seconds: number;
  updated_at: string;
}

export interface HistoryPoint {
  timestamp: string;
  events: Record<string, number>;
  total: number;
}

export interface Config {
  port: number;
  dataDir: string;
  maxUploadMB: number;
  retentionDays: number;
  adminToken: string;
}
