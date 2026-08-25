const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `xhs-http-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-characters';
process.env.OPENAI_IMAGE_API_KEY = 'test-image-key';
process.env.XI_XU_GENERATE_RETRIES = '0';
process.env.DEEPSEEK_API_KEY = '';
process.env.ARK_API_KEY = '';
process.env.AUTH_RETURN_TOKEN = 'true';

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
    assert.equal(loader.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.match(await loader.text(), /xhs-tool/);

    const loginPage = await fetch(`${baseUrl}/login.html`);
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /login\.js/);

    const loginScript = await fetch(`${baseUrl}/login.js`);
    assert.equal(loginScript.status, 200);
    assert.match(await loginScript.text(), /api\/auth\/login/);

    const sharedUtils = await fetch(`${baseUrl}/frontend/shared-utils.js`);
    assert.equal(sharedUtils.status, 200);
    assert.equal(sharedUtils.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.match(await sharedUtils.text(), /AppUtils/);

    const toolScript = await fetch(`${baseUrl}/xhs-tool/bootstrap.js`);
    assert.equal(toolScript.status, 200);
    assert.match(await toolScript.text(), /initToolScript/);

    const historyCardScript = await fetch(`${baseUrl}/xhs-tool/history-card.js`);
    assert.equal(historyCardScript.status, 200);
    assert.match(await historyCardScript.text(), /createHistoryCard/);

    const studioScript = await fetch(`${baseUrl}/image-studio/bootstrap.js`);
    assert.equal(studioScript.status, 200);
    assert.match(await studioScript.text(), /refreshPromptPlaceholder/);

    const imageActionsScript = await fetch(`${baseUrl}/image-studio/image-actions.js`);
    assert.equal(imageActionsScript.status, 200);
    assert.match(await imageActionsScript.text(), /openImagePreview/);

    const promptPolishScript = await fetch(`${baseUrl}/image-studio/prompt-polish.js`);
    assert.equal(promptPolishScript.status, 200);
    assert.match(await promptPolishScript.text(), /polishCurrentPrompt/);

    const adminBootstrap = await fetch(`${baseUrl}/admin/bootstrap.js`);
    assert.equal(adminBootstrap.status, 200);
    assert.match(await adminBootstrap.text(), /checkAdmin/);

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

    const promptPolishRoute = await fetch(`${baseUrl}/api/xi-image/polish-prompt`, { method: 'POST' });
    assert.equal(promptPolishRoute.status, 401);

    const paymentRoute = await fetch(`${baseUrl}/api/payment/create`, { method: 'POST' });
    assert.equal(paymentRoute.status, 401);

    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'http_template_user', password: 'HttpTemplate123' })
    });
    assert.equal(register.status, 200);
    const registerBody = await register.json();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registerBody.token}`
    };

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'http_template_user', password: 'HttpTemplate123' })
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') || '', /xhs_session=.*HttpOnly.*SameSite=Strict/i);
    const loginBody = await login.json();
    assert.equal(typeof loginBody.token, 'string');

    const beforeCopyFailureResponse = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Authorization: `Bearer ${registerBody.token}` }
    });
    const beforeCopyFailurePoints = (await beforeCopyFailureResponse.json()).points;
    const failedCopy = await fetch(`${baseUrl}/generate-copy`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ topic: '验证文案服务未配置时退款', type: '种草' })
    });
    assert.equal(failedCopy.status, 500);
    const afterCopyFailureResponse = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Authorization: `Bearer ${registerBody.token}` }
    });
    assert.equal((await afterCopyFailureResponse.json()).points, beforeCopyFailurePoints);

    const savedTemplate = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: '回归模板', type: 'copy', content: '第一版内容' })
    });
    assert.equal(savedTemplate.status, 200);
    const savedTemplateBody = await savedTemplate.json();
    assert.equal(savedTemplateBody.templates.length, 1);
    const templateId = savedTemplateBody.templates[0].id;

    const updatedTemplate = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: '回归模板', type: 'copy', content: '第二版内容' })
    });
    assert.equal(updatedTemplate.status, 200);

    const templateList = await fetch(`${baseUrl}/api/templates?type=copy`, {
      headers: { Authorization: `Bearer ${registerBody.token}` }
    });
    const templateListBody = await templateList.json();
    assert.equal(templateListBody.templates.length, 1);
    assert.equal(templateListBody.templates[0].content, '第二版内容');

    const deletedTemplate = await fetch(`${baseUrl}/api/templates/${templateId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${registerBody.token}` }
    });
    assert.equal(deletedTemplate.status, 200);
    assert.equal((await deletedTemplate.json()).deleted, true);

    let upstreamRequestedCount = 0;
    const upstream = http.createServer((request, response) => {
      let requestBody = '';
      request.on('data', (chunk) => { requestBody += chunk; });
      request.on('end', () => {
        try { upstreamRequestedCount = JSON.parse(requestBody).n; } catch {}
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'temporary upstream failure' } }));
      });
    });
    await listen(upstream);
    try {
      const upstreamAddress = upstream.address();
      process.env.OPENAI_IMAGE_API_BASE_URL = `http://127.0.0.1:${upstreamAddress.port}`;
      const beforePointsResponse = await fetch(`${baseUrl}/api/user/me`, {
        headers: { Authorization: `Bearer ${registerBody.token}` }
      });
      const beforePoints = (await beforePointsResponse.json()).points;
      const failedGeneration = await fetch(`${baseUrl}/api/xi-image/generate`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ prompt: '验证上游失败自动退款', size: '1024x1536', count: 5 })
      });
      assert.equal(failedGeneration.status, 502);
      assert.equal(upstreamRequestedCount, 5);
      const afterPointsResponse = await fetch(`${baseUrl}/api/user/me`, {
        headers: { Authorization: `Bearer ${registerBody.token}` }
      });
      const afterPoints = (await afterPointsResponse.json()).points;
      assert.equal(afterPoints, beforePoints);
    } finally {
      await close(upstream);
    }

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestAdmin123' })
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;
    const recharge = await fetch(`${baseUrl}/api/admin/users/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ userId: registerBody.user.id, amount: 1, description: '审计测试' })
    });
    assert.equal(recharge.status, 200);
    const auditResponse = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(auditResponse.status, 200);
    const auditBody = await auditResponse.json();
    assert.equal(auditBody.logs[0].action, 'user.recharge');

    const passwordChange = await fetch(`${baseUrl}/api/user/change-password`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ oldPassword: 'HttpTemplate123', newPassword: 'HttpTemplate456' })
    });
    assert.equal(passwordChange.status, 200);
    const oldTokenAfterPasswordChange = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Authorization: `Bearer ${registerBody.token}` }
    });
    assert.equal(oldTokenAfterPasswordChange.status, 401);

    const relogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'http_template_user', password: 'HttpTemplate456' })
    });
    assert.equal(relogin.status, 200);
    const reloginToken = (await relogin.json()).token;
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${reloginToken}` }
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') || '', /xhs_session=;/i);
    const tokenAfterLogout = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Authorization: `Bearer ${reloginToken}` }
    });
    assert.equal(tokenAfterLogout.status, 401);
  } finally {
    await close(server);
  }
});
