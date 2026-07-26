import fs from 'fs';
import { DatabaseManager } from './db';
import { logDir, retentionDurationMs } from './config';
import { Config } from './types';

export function runCleanup(cfg: Config, db: DatabaseManager) {
  try {
    const now = new Date();

    // The history API exposes at most 30 days, so older buckets only consume disk.
    const historyCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prunedHistoryCount = db.pruneHistory(historyCutoff);
    if (prunedHistoryCount > 0) {
      console.log(`[cleanup] Removed ${prunedHistoryCount} history bucket(s) older than ${historyCutoff.toISOString()}`);
    }

    const logsDirectory = logDir(cfg);
    if (!fs.existsSync(logsDirectory)) {
      return;
    }

    const cutoffMs = retentionDurationMs(cfg);
    const cutoffDate = new Date(now.getTime() - cutoffMs);
    const cutoffStr = cutoffDate.toISOString();

    console.log(`[cleanup] Running log cleanup: deleting uploads older than ${cutoffStr} (retention: ${cfg.retentionDays} days)`);

    // Let SQLite use the created_at index instead of loading every upload and
    // filtering it in JavaScript. Legacy malformed dates remain conservatively kept.
    const uploads = db.listLogUploadsBefore(cutoffDate);
    let deletedCount = 0;

    for (const upload of uploads) {
      // Parse created_at or timestamp (they are stored as ISO strings or timestamp format YYYYMMDDTHHMMSS)
      // If timestamp is not standard ISO, we try parsing it. Or we can use file system stats if created_at is not parseable.
      let uploadTime = new Date(upload.created_at);
      if (isNaN(uploadTime.getTime())) {
        // Try parsing YYYYMMDDTHHMMSS
        const match = upload.timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
        if (match) {
          uploadTime = new Date(
            Date.UTC(
              parseInt(match[1], 10),
              parseInt(match[2], 10) - 1,
              parseInt(match[3], 10),
              parseInt(match[4], 10),
              parseInt(match[5], 10),
              parseInt(match[6], 10)
            )
          );
        } else {
          // Fallback to current time if parsing fails (safe default so we don't accidentally delete new logs)
          uploadTime = now;
        }
      }

      if (uploadTime.getTime() < cutoffDate.getTime()) {
        console.log(`[cleanup] Deleting old upload: ${upload.id} at path ${upload.storage_path} (age: ${Math.round((now.getTime() - uploadTime.getTime()) / (24 * 3600 * 1000))} days)`);
        
        // Delete directory from disk
        if (upload.storage_path && fs.existsSync(upload.storage_path)) {
          try {
            fs.rmSync(upload.storage_path, { recursive: true, force: true });
          } catch (err) {
            console.error(`[cleanup] Failed to delete directory ${upload.storage_path}:`, err);
          }
        }

        // Delete from database
        db.deleteLogUpload(upload.id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[cleanup] Cleanup completed: removed ${deletedCount} old upload(s)`);
    }



  } catch (err) {
    console.error('[cleanup] Error during cleanup execution:', err);
  }
}

export function startCleanupScheduler(cfg: Config, db: DatabaseManager): NodeJS.Timeout {
  // Run immediately on start
  runCleanup(cfg, db);

  // Run every 6 hours
  const intervalMs = 6 * 60 * 60 * 1000;
  return setInterval(() => {
    runCleanup(cfg, db);
  }, intervalMs);
}
