import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { readerRouter } from './routes/reader.js';
import { workbenchRouter } from './routes/workbench.js';
import { opsRouter } from './routes/ops.js';
import { authRouter } from './routes/auth.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get(['/api/health', '/api/reader/health', '/api/workbench/health', '/api/ops/health'], (_req, res) => {
  res.json({
    status: 'ok',
    service: 'WuwaID Standalone Fullstack WebUI Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// System Telemetry Metrics API
app.get(['/api/metrics', '/api/reader/metrics'], (_req, res) => {
  res.json(db.getSystemMetrics());
});

// Tab-Specific Dedicated Routers
app.use('/api/reader', readerRouter);
app.use('/api/workbench', workbenchRouter);
app.use('/api/ops', opsRouter);
app.use('/api/auth', authRouter);

// Flat Legacy Routers Mounting (backwards compatibility)
app.use('/api', readerRouter);
app.use('/api', workbenchRouter);
app.use('/api', opsRouter);
app.use('/api', authRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WuwaID WebUI Server] Running on http://127.0.0.1:${PORT}`);
  console.log(` - Reader Endpoints:    http://127.0.0.1:${PORT}/api/reader/*`);
  console.log(` - Workbench Endpoints: http://127.0.0.1:${PORT}/api/workbench/*`);
  console.log(` - Operations Endpoints:http://127.0.0.1:${PORT}/api/ops/*`);
  console.log(` - Auth Endpoints:      http://127.0.0.1:${PORT}/api/auth/*`);
});
