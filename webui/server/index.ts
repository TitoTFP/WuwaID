import { createApp } from './app.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[WuwaID WebUI Server] Running on http://127.0.0.1:${PORT}`);
  console.log(` - Reader Endpoints:    http://127.0.0.1:${PORT}/api/reader/*`);
  console.log(` - Workbench Endpoints: http://127.0.0.1:${PORT}/api/workbench/*`);
  console.log(` - Operations Endpoints:http://127.0.0.1:${PORT}/api/ops/*`);
  console.log(` - Auth Endpoints:      http://127.0.0.1:${PORT}/api/auth/*`);
});
