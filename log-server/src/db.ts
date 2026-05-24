import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { LogMeta, ActivePlayer, HistoryPoint, ActiveSummary } from './types';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbDir = path.join(dataDir, 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, 'wuwaid.db');
    this.db = new Database(dbPath);

    // Initialize Schema
    this.initSchema();

    // Run Migration from old JSON files
    this.migrateOldData(dataDir);
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);

    // Insert version 1 if not exists
    const schemaVersion = this.db.prepare("SELECT value FROM _schema WHERE key = 'version'").get() as { value: number } | undefined;
    if (!schemaVersion) {
      this.db.prepare("INSERT INTO _schema (key, value) VALUES ('version', 1)").run();
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS log_uploads (
        id TEXT PRIMARY KEY,
        app_version TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        os TEXT NOT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        storage_path TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_log_uploads_timestamp ON log_uploads(timestamp DESC);

      CREATE TABLE IF NOT EXISTS active_players (
        client_id TEXT PRIMARY KEY,
        launcher_version TEXT NOT NULL DEFAULT '',
        install_method TEXT NOT NULL DEFAULT '',
        event TEXT NOT NULL DEFAULT '',
        last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS history_events (
        bucket TEXT NOT NULL,
        event_type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket, event_type)
      );

      CREATE INDEX IF NOT EXISTS idx_history_bucket ON history_events(bucket);
    `);
  }

  private migrateOldData(dataDir: string) {
    // 1. Migrate active players JSON
    const playersJsonPath = path.join(dataDir, 'active', 'players.json');
    if (fs.existsSync(playersJsonPath)) {
      try {
        const raw = fs.readFileSync(playersJsonPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.players) {
          const insertPlayer = this.db.prepare(`
            INSERT OR REPLACE INTO active_players (client_id, launcher_version, install_method, event, last_seen)
            VALUES (?, ?, ?, ?, ?)
          `);

          const tx = this.db.transaction((playersMap: Record<string, any>) => {
            for (const key of Object.keys(playersMap)) {
              const p = playersMap[key];
              insertPlayer.run(
                p.client_id || key,
                p.launcher_version || '',
                p.install_method || '',
                p.event || '',
                p.last_seen || new Date().toISOString()
              );
            }
          });
          tx(data.players);
          console.log(`Migrated active players from JSON to SQLite.`);
        }
        fs.renameSync(playersJsonPath, `${playersJsonPath}.migrated`);
      } catch (err) {
        console.error('Failed to migrate players.json:', err);
      }
    }

    // 2. Migrate history JSON
    const historyJsonPath = path.join(dataDir, 'active', 'history.json');
    if (fs.existsSync(historyJsonPath)) {
      try {
        const raw = fs.readFileSync(historyJsonPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.points)) {
          const insertHistory = this.db.prepare(`
            INSERT INTO history_events (bucket, event_type, count)
            VALUES (?, ?, ?)
            ON CONFLICT(bucket, event_type) DO UPDATE SET count = count + excluded.count
          `);

          const tx = this.db.transaction((points: any[]) => {
            for (const pt of points) {
              const bucket = pt.timestamp;
              if (!bucket) continue;
              if (pt.events) {
                for (const eventType of Object.keys(pt.events)) {
                  const count = pt.events[eventType] || 0;
                  insertHistory.run(bucket, eventType, count);
                }
              }
            }
          });
          tx(data.points);
          console.log(`Migrated active player history from JSON to SQLite.`);
        }
        fs.renameSync(historyJsonPath, `${historyJsonPath}.migrated`);
      } catch (err) {
        console.error('Failed to migrate history.json:', err);
      }
    }

    // 3. Sync logs metadata from directory
    const logsDir = path.join(dataDir, 'logs');
    if (fs.existsSync(logsDir)) {
      try {
        const insertUpload = this.db.prepare(`
          INSERT OR IGNORE INTO log_uploads (id, app_version, timestamp, os, file_count, total_bytes, created_at, storage_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const walkDir = (currentDir: string) => {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              walkDir(fullPath);
            } else if (entry.isFile() && entry.name === 'metadata.json') {
              try {
                const raw = fs.readFileSync(fullPath, 'utf8');
                const meta = JSON.parse(raw);
                if (meta.id) {
                  insertUpload.run(
                    meta.id,
                    meta.app_version || meta.appVersion || '',
                    meta.timestamp || '',
                    meta.os || '',
                    meta.file_count || meta.fileCount || 0,
                    meta.total_bytes || meta.totalBytes || 0,
                    meta.created_at || meta.timestamp || new Date().toISOString(),
                    currentDir
                  );
                }
              } catch (e) {
                console.error(`Failed to parse metadata in ${fullPath}:`, e);
              }
            }
          }
        };

        const tx = this.db.transaction(() => {
          walkDir(logsDir);
        });
        tx();
        console.log('Synchronized logs metadata from logs directory to SQLite.');
      } catch (err) {
        console.error('Failed to sync logs directories:', err);
      }
    }
  }

  // --- API Methods ---

  public saveLogUpload(upload: LogMeta) {
    this.db.prepare(`
      INSERT OR REPLACE INTO log_uploads (id, app_version, timestamp, os, file_count, total_bytes, created_at, storage_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      upload.id,
      upload.app_version,
      upload.timestamp,
      upload.os,
      upload.file_count,
      upload.total_bytes,
      upload.created_at,
      upload.storage_path
    );
  }

  public listLogUploads(): LogMeta[] {
    return this.db.prepare(`
      SELECT id, app_version, timestamp, os, file_count, total_bytes, created_at, storage_path
      FROM log_uploads
      ORDER BY timestamp DESC
    `).all() as LogMeta[];
  }

  public getLogUpload(id: string): LogMeta | undefined {
    return this.db.prepare(`
      SELECT id, app_version, timestamp, os, file_count, total_bytes, created_at, storage_path
      FROM log_uploads
      WHERE id = ?
    `).get(id) as LogMeta | undefined;
  }

  public deleteLogUpload(id: string) {
    this.db.prepare(`
      DELETE FROM log_uploads
      WHERE id = ?
    `).run(id);
  }

  public saveActiveHeartbeat(clientId: string, launcherVersion: string, installMethod: string, event: string, now: Date) {
    const lastSeen = now.toISOString();

    // 1. Update/insert active_players
    this.db.prepare(`
      INSERT OR REPLACE INTO active_players (client_id, launcher_version, install_method, event, last_seen)
      VALUES (?, ?, ?, ?, ?)
    `).run(clientId, launcherVersion, installMethod, event, lastSeen);

    // 2. Record to history_events
    // Truncate to 5 minute interval bucket
    const historyIntervalMs = 5 * 60 * 1000;
    const bucketTime = new Date(Math.floor(now.getTime() / historyIntervalMs) * historyIntervalMs);
    const bucket = bucketTime.toISOString();
    const eventKey = event || 'unknown';

    this.db.prepare(`
      INSERT INTO history_events (bucket, event_type, count)
      VALUES (?, ?, 1)
      ON CONFLICT(bucket, event_type) DO UPDATE SET count = count + 1
    `).run(bucket, eventKey);
  }

  public getActiveSummary(now: Date, windowMs: number): ActiveSummary {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const row = this.db.prepare(`
      SELECT count(*) as count
      FROM active_players
      WHERE last_seen >= ?
    `).get(cutoff) as { count: number };

    return {
      active: row ? row.count : 0,
      window_seconds: Math.floor(windowMs / 1000),
      updated_at: now.toISOString()
    };
  }

  public listActivePlayers(now: Date, windowMs: number): ActivePlayer[] {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    return this.db.prepare(`
      SELECT client_id, launcher_version, install_method, event, last_seen
      FROM active_players
      WHERE last_seen >= ?
      ORDER BY last_seen DESC
    `).all(cutoff) as ActivePlayer[];
  }

  public getHistoryPoints(now: Date, windowMs: number): HistoryPoint[] {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const rows = this.db.prepare(`
      SELECT bucket, event_type, count
      FROM history_events
      WHERE bucket >= ?
      ORDER BY bucket ASC
    `).all(cutoff) as { bucket: string, event_type: string, count: number }[];

    // Group rows by bucket
    const bucketMap = new Map<string, Record<string, number>>();
    for (const r of rows) {
      if (!bucketMap.has(r.bucket)) {
        bucketMap.set(r.bucket, {});
      }
      bucketMap.get(r.bucket)![r.event_type] = r.count;
    }

    const points: HistoryPoint[] = [];
    bucketMap.forEach((events, timestamp) => {
      const total = Object.values(events).reduce((sum, val) => sum + val, 0);
      points.push({
        timestamp,
        events,
        total
      });
    });

    // Sort by timestamp
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return points;
  }

  public collectEventKeys(points: HistoryPoint[]): string[] {
    const seen = new Set<string>();
    for (const p of points) {
      for (const k of Object.keys(p.events)) {
        seen.add(k);
      }
    }
    return Array.from(seen).sort();
  }

  public pruneHistory(cutoff: Date) {
    const cutoffStr = cutoff.toISOString();
    this.db.prepare(`
      DELETE FROM history_events
      WHERE bucket < ?
    `).run(cutoffStr);
  }

  public reopen(dataDir: string) {
    try {
      this.db.close();
    } catch (e) {}
    const dbDir = path.join(dataDir, 'db');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'wuwaid.db');
    this.db = new Database(dbPath);
    this.initSchema();
    this.migrateOldData(dataDir);
  }

  public close() {
    try {
      this.db.close();
    } catch (e) {}
  }
}
