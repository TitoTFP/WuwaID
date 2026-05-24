import { app, db, cfg } from './server';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuwaid-debug-upload-'));
  cfg.dataDir = tempDir;

  const server = app.listen(0);
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const zip = new AdmZip();
    zip.addFile('launcher-test.log', Buffer.from('hello from launcher log'));
    const zipBuffer = zip.toBuffer();

    const formData = new FormData();
    formData.append('appVersion', 'v2.5.0');
    formData.append('timestamp', '20260525T040000');
    formData.append('os', 'Windows 11');
    formData.append('logs', new Blob([zipBuffer]), 'logs.zip');

    console.log('Sending request to', `${baseUrl}/api/logs`);
    const res = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      body: formData
    });

    console.log('Response status:', res.status);
    const text = await res.text();
    console.log('Response body:', text);

  } catch (err) {
    console.error('Error during request:', err);
  } finally {
    server.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
