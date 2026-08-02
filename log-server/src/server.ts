import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { loadConfig } from './config';
import { DatabaseManager } from './db';
import { startCleanupScheduler } from './cleanup';
import { LogMeta } from './types';

const cfg = loadConfig();
const db = new DatabaseManager(cfg.dataDir);

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Admin-Token']
}));

app.use(express.json());

// Set up upload size limit using multer
const upload = multer({
  limits: {
    fileSize: cfg.maxUploadMB * 1024 * 1024 + 1024 // slight overhead allowance
  }
});

// Admin auth helper
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!cfg.adminToken) {
    res.status(503).json({ error: 'admin auth not configured' });
    return;
  }
  const token = req.header('x-admin-token');
  const expected = Buffer.from(cfg.adminToken);
  const provided = token ? Buffer.from(token) : null;
  if (!provided || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Upload Log Archive (Multipart POST /api/logs)
app.post('/api/logs', upload.single('logs'), (req: Request, res: Response) => {
  try {
    const appVersion = req.body.appVersion;
    const timestamp = req.body.timestamp;
    const osName = req.body.os;

    if (!appVersion || !timestamp || !osName) {
      console.warn('[server] 400 Bad Request: missing required fields');
      res.status(400).json({ error: 'missing required fields: appVersion, timestamp, os' });
      return;
    }

    if (!req.file) {
      console.warn('[server] 400 Bad Request: missing logs file field');
      res.status(400).json({ error: "missing 'logs' file field" });
      return;
    }

    // Process Zip in memory
    let zip: AdmZip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (e) {
      console.warn('[server] 400 Bad Request: invalid zip file');
      res.status(400).json({ error: 'invalid zip file' });
      return;
    }

    const entries = zip.getEntries();
    const processableEntries = entries.filter(entry => !entry.isDirectory);

    if (processableEntries.length === 0) {
      console.warn('[server] 400 Bad Request: zip contains no files');
      res.status(400).json({ error: 'zip archive contains no files' });
      return;
    }

    // Extract date from timestamp
    let datePart = timestamp;
    const tIdx = timestamp.indexOf('T');
    const uIdx = timestamp.indexOf('_');
    if (tIdx >= 0) {
      datePart = timestamp.substring(0, tIdx);
    } else if (uIdx >= 0 && timestamp.substring(0, uIdx).length === 8) {
      datePart = timestamp.substring(0, uIdx);
    } else if (timestamp.length > 8) {
      datePart = timestamp.substring(0, 8);
    }
    if (!datePart) {
      datePart = 'unknown';
    }

    const uploadId = crypto.randomBytes(8).toString('hex');
    const relPath = path.join('logs', appVersion, datePart, uploadId);
    const fullPath = path.join(cfg.dataDir, relPath);

    fs.mkdirSync(fullPath, { recursive: true });

    let fileCount = 0;
    let totalBytes = 0;

    for (const entry of processableEntries) {
      const cleanName = path.normalize(entry.entryName);
      // Path traversal check
      if (cleanName.includes('..') || path.isAbsolute(cleanName)) {
        continue;
      }

      const destPath = path.join(fullPath, cleanName);
      // Secondary check: verify target path is inside fullPath
      const resolvedDest = path.resolve(destPath);
      const resolvedRoot = path.resolve(fullPath);
      if (!resolvedDest.startsWith(resolvedRoot + path.sep)) {
        continue;
      }

      // Ensure directory for entry exists
      fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });

      // Save file
      const fileData = entry.getData();
      fs.writeFileSync(resolvedDest, fileData);

      fileCount++;
      totalBytes += fileData.length;
    }

    if (fileCount === 0) {
      // Clean up directory if nothing was written
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {}
      console.warn('[server] 400 Bad Request: zip contains no processable files');
      res.status(400).json({ error: 'zip archive contains no processable files' });
      return;
    }

    // Create log metadata
    const meta: LogMeta = {
      id: uploadId,
      app_version: appVersion,
      timestamp,
      os: osName,
      file_count: fileCount,
      total_bytes: totalBytes,
      created_at: new Date().toISOString(),
      storage_path: fullPath
    };

    // Write metadata.json alongside logs on disk
    fs.writeFileSync(path.join(fullPath, 'metadata.json'), JSON.stringify(meta, null, 2));

    // Save to Database
    db.saveLogUpload(meta);

    res.json({
      status: 'ok',
      id: uploadId,
      file_count: fileCount,
      total_bytes: totalBytes
    });

  } catch (err: any) {
    console.error('Upload handler error:', err);
    res.status(500).json({ error: err.message || 'internal server error' });
  }
});

// List Uploaded Logs (GET /api/logs)
const handleListLogs = (req: Request, res: Response) => {
  try {
    const uploads = db.listLogUploads();
    res.json(uploads);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/logs', requireAdmin, handleListLogs);
app.get('/admin/api/logs', requireAdmin, handleListLogs);

// Active Heartbeat (POST /api/active/heartbeat)
app.post('/api/active/heartbeat', (req: Request, res: Response) => {
  try {
    const { client_id, launcher_version, install_method, event } = req.body;

    if (!client_id || typeof client_id !== 'string') {
      res.status(400).json({ error: 'client_id is required' });
      return;
    }

    if (client_id.trim().length === 0 || client_id.length > 128) {
      res.status(400).json({ error: 'client_id is invalid or too long' });
      return;
    }

    const cleanClientId = client_id.trim();
    const cleanLauncherVersion = (launcher_version || '').trim().substring(0, 32);
    const cleanInstallMethod = (install_method || '').trim().substring(0, 32);
    const cleanEvent = (event || '').trim().substring(0, 32);

    db.saveActiveHeartbeat(
      cleanClientId,
      cleanLauncherVersion,
      cleanInstallMethod,
      cleanEvent,
      new Date()
    );

    res.json({ status: 'ok' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const handleActiveSummary = (req: Request, res: Response) => {
  try {
    const now = new Date();
    const defaultWindowMs = 10 * 60 * 1000; // 10 minutes
    const counts = db.getActiveCounts(now, defaultWindowMs, 30 * 24 * 60 * 60 * 1000);

    res.json({
      active: counts.active,
      window_seconds: Math.floor(defaultWindowMs / 1000),
      total_30d: counts.total,
      updated_at: now.toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/active', requireAdmin, handleActiveSummary);
app.get('/admin/api/active', requireAdmin, handleActiveSummary);

// Active Player List (GET /api/active/players)
const handleActivePlayers = (req: Request, res: Response) => {
  try {
    const defaultWindowMs = 10 * 60 * 1000;
    const players = db.listActivePlayers(new Date(), defaultWindowMs);
    res.json(players);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/active/players', requireAdmin, handleActivePlayers);
app.get('/admin/api/active/players', requireAdmin, handleActivePlayers);

// Active History (GET /api/active/history)
const handleActiveHistory = (req: Request, res: Response) => {
  try {
    const rangeParam = req.query.range as string || '24h';
    let windowMs = 24 * 60 * 60 * 1000;

    switch (rangeParam) {
      case '1h':
        windowMs = 1 * 60 * 60 * 1000;
        break;
      case '24h':
        windowMs = 24 * 60 * 60 * 1000;
        break;
      case '7d':
        windowMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        windowMs = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        res.status(400).json({ error: 'invalid range: use 1h, 24h, 7d, 30d' });
        return;
    }

    const points = db.getHistoryPoints(new Date(), windowMs);
    const eventKeys = db.collectEventKeys(points);

    res.json({
      points,
      window: rangeParam,
      interval: '5m',
      event_keys: eventKeys
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/active/history', requireAdmin, handleActiveHistory);
app.get('/admin/api/active/history', requireAdmin, handleActiveHistory);

// --- Extended Admin View API ---

// List files in log upload (GET /admin/api/logs/:id/files)
app.get('/admin/api/logs/:id/files', requireAdmin, (req: Request, res: Response) => {
  try {
    const upload = db.getLogUpload(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'upload not found' });
      return;
    }

    if (!fs.existsSync(upload.storage_path)) {
      res.status(404).json({ error: 'log directory not found on server disk' });
      return;
    }

    // Read files recursively or flat
    const getFilesList = (dir: string, baseDir: string): { name: string, size: number }[] => {
      let results: { name: string, size: number }[] = [];
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of list) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
          results = results.concat(getFilesList(fullPath, baseDir));
        } else if (file.name !== 'metadata.json') {
          const stats = fs.statSync(fullPath);
          const rel = path.relative(baseDir, fullPath);
          results.push({ name: rel, size: stats.size });
        }
      }
      return results;
    };

    const files = getFilesList(upload.storage_path, upload.storage_path);
    res.json({ id: upload.id, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// View specific log file contents (GET /admin/api/logs/:id/files/:filename(*))
app.get('/admin/api/logs/:id/files/:filename(*)', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id, filename } = req.params;
    const upload = db.getLogUpload(id);
    if (!upload) {
      res.status(404).json({ error: 'upload not found' });
      return;
    }

    // Prevent directory traversal
    const cleanFilename = path.normalize(filename);
    if (cleanFilename.includes('..') || path.isAbsolute(cleanFilename)) {
      res.status(400).json({ error: 'invalid filename' });
      return;
    }

    const filePath = path.join(upload.storage_path, cleanFilename);
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(upload.storage_path);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'file not found' });
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Download log upload zip on the fly (GET /admin/api/logs/:id/download)
app.get('/admin/api/logs/:id/download', requireAdmin, (req: Request, res: Response) => {
  try {
    const upload = db.getLogUpload(req.params.id);
    if (!upload) {
      res.status(404).json({ error: 'upload not found' });
      return;
    }

    if (!fs.existsSync(upload.storage_path)) {
      res.status(404).json({ error: 'log directory not found on server' });
      return;
    }

    const zip = new AdmZip();
    
    const addDirToZip = (dir: string, zipDirName: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          addDirToZip(fullPath, zipDirName ? `${zipDirName}/${item.name}` : item.name);
        } else if (item.name !== 'metadata.json') {
          zip.addLocalFile(fullPath, zipDirName);
        }
      }
    };

    addDirToZip(upload.storage_path, '');

    const buffer = zip.toBuffer();
    const downloadName = `logs_${upload.app_version}_${upload.id}.zip`;

    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend static assets
const publicPath = path.join(__dirname, '../../public');
app.use('/admin', express.static(publicPath));
app.use('/admin/*', express.static(publicPath)); // support SPA routing if needed

// Redirect root to /admin for convenience
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Error handling middleware for Multer file size limits
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[server] Error caught in middleware:', err);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `upload too large; max ${cfg.maxUploadMB} MB` });
    return;
  }
  next(err);
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Export app, db, and cfg for unit/integration testing
export { app, db, cfg };

// Start Server
if (require.main === module) {
  startCleanupScheduler(cfg, db);

  app.listen(cfg.port, () => {
    console.log(`🚀 WuwaID Log Server (TS) starting on :${cfg.port}`);
    console.log(`   Data directory: ${cfg.dataDir}`);
    console.log(`   Max upload size: ${cfg.maxUploadMB} MB`);
    console.log(`   Log retention: ${cfg.retentionDays} days`);
    console.log(`   Admin endpoints active`);
  });
}
