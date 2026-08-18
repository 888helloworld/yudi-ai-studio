const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `xhs-http-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-characters';

const app = require('../server');
const { db } = require('../database');

function listen(appInstance) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function removeTestDatabase() {
  for (const suffix of ['', '-shm', '-wal']) {
    const target = `${databasePath}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

test.after(() => {
  db.close();
  removeTestDatabase();
});

test('公开页面、拆分脚本与公开接口可以正常访问', async () => {
  const server = await listen(app);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /御弟哥哥/);

    const loader = await fetch(`${baseUrl}/script.js`);
    assert.equal(loader.status, 200);
    assert.match(loader.headers.get('cache-control'), /immutable/);
    assert.match(await loader.text(), /xhs-tool/);

    const toolScript = await fetch(`${baseUrl}/xhs-tool/bootstrap.js`);
    assert.equal(toolScript.status, 200);
    assert.match(await toolScript.text(), /initToolScript/);

    const studioScript = await fetch(`${baseUrl}/image-studio/bootstrap.js`);
    assert.equal(studioScript.status, 200);
    assert.match(await studioScript.text(), /refreshPromptPlaceholder/);

    const missingToolScript = await fetch(`${baseUrl}/xhs-tool/not-allowed.js`);
    assert.equal(missingToolScript.status, 404);

    const reversePromptPage = await fetch(`${baseUrl}/reverse-prompt.html`);
    assert.equal(reversePromptPage.status, 200);

    const stats = await fetch(`${baseUrl}/api/public/stats`);
    assert.equal(stats.status, 200);
    const statsBody = await stats.json();
    assert.equal(typeof statsBody.totalUsers, 'number');
    assert.equal(typeof statsBody.totalRecords, 'number');

    const generationRoute = await fetch(`${baseUrl}/generate-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: '路由烟测', type: '种草' })
    });
    assert.equal(generationRoute.status, 401);

    const templatesRoute = await fetch(`${baseUrl}/api/templates`);
    assert.equal(templatesRoute.status, 401);

    const paymentRoute = await fetch(`${baseUrl}/api/payment/create`, { method: 'POST' });
    assert.equal(paymentRoute.status, 401);
  } finally {
    await close(server);
  }
});
