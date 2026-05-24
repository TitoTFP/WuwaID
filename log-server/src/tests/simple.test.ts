import test from 'node:test';
import assert from 'node:assert';
import http from 'http';

test('simple fetch headers test', async () => {
  const server = http.createServer((req, res) => {
    console.log('[simple] req headers:', req.headers);
    res.end('ok');
  });

  server.listen(0);
  const address = server.address() as any;
  const port = address.port;

  try {
    const formData = new FormData();
    formData.append('key', 'value');

    const res = await fetch(`http://localhost:${port}/`, {
      method: 'POST',
      body: formData
    });
    
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});
