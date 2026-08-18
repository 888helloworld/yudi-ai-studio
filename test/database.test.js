const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const databasePath = path.join(os.tmpdir(), `xhs-database-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-characters';

const api = require('../db');
const { db } = require('../database');

function removeTestDatabase() {
  for (const suffix of ['', '-shm', '-wal']) {
    const target = `${databasePath}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

function runDatabaseWorker(action, values) {
  const workerSource = `
    const api = require('./db');
    const { db } = require('./database');
    let result;
    if (process.env.TEST_ACTION === 'redeem') {
      result = api.redeemCdkey(process.env.TEST_CODE, Number(process.env.TEST_USER_ID));
    } else if (process.env.TEST_ACTION === 'pay') {
      result = api.paySuccess(process.env.TEST_ORDER_NO, process.env.TEST_TRADE_NO);
    } else {
      throw new Error('unknown action');
    }
    console.log('TEST_RESULT:' + JSON.stringify(result));
    db.close();
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', workerSource], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        TEST_ACTION: action,
        ...values
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`database worker failed (${code}): ${stderr || stdout}`));
        return;
      }
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('TEST_RESULT:'));
      if (!line) {
        reject(new Error(`database worker returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(line.slice('TEST_RESULT:'.length)));
    });
  });
}

test.after(() => {
  db.close();
  removeTestDatabase();
});

test('积分、卡密、支付和历史记录保持原子与幂等', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  const user = api.createUser('database_test_user', 'DatabasePass123');

  assert.equal(api.deductPoints(user.id, 100, '测试扣减').balance, 900);
  assert.equal(api.deductPoints(user.id, 901, '超额扣减').success, false);
  assert.equal(api.rechargePoints(user.id, 50, '测试退款').balance, 950);

  const code = api.generateCdkeys(1, 25, admin.id)[0];
  const redeemResults = await Promise.all([
    runDatabaseWorker('redeem', { TEST_CODE: code, TEST_USER_ID: String(user.id) }),
    runDatabaseWorker('redeem', { TEST_CODE: code, TEST_USER_ID: String(user.id) })
  ]);
  assert.equal(redeemResults.filter((result) => result.success).length, 1);
  assert.equal(redeemResults.filter((result) => !result.success).length, 1);
  assert.equal(api.getUserPoints(user.id), 975);

  const order = api.createPaymentOrder(user.id, 1, 40, 'test');
  const paymentResults = await Promise.all([
    runDatabaseWorker('pay', { TEST_ORDER_NO: order.order_no, TEST_TRADE_NO: 'trade-a' }),
    runDatabaseWorker('pay', { TEST_ORDER_NO: order.order_no, TEST_TRADE_NO: 'trade-b' })
  ]);
  assert.equal(paymentResults.filter((result) => result.success).length, 1);
  assert.equal(paymentResults.filter((result) => !result.success).length, 1);
  assert.equal(api.getUserPoints(user.id), 1015);

  const concurrentOrderA = api.createPaymentOrder(user.id, 1, 15, 'test');
  const concurrentOrderB = api.createPaymentOrder(user.id, 1, 20, 'test');
  const concurrentPayments = await Promise.all([
    runDatabaseWorker('pay', { TEST_ORDER_NO: concurrentOrderA.order_no, TEST_TRADE_NO: 'trade-c' }),
    runDatabaseWorker('pay', { TEST_ORDER_NO: concurrentOrderB.order_no, TEST_TRADE_NO: 'trade-d' })
  ]);
  assert.equal(concurrentPayments.every((result) => result.success), true);
  assert.equal(api.getUserPoints(user.id), 1050);

  const historyId = api.addHistory(user.id, 'image', {
    image_url: JSON.stringify(['/uploads/a.png', '/uploads/b.png']),
    prompt: '测试图片',
    cost_points: 5
  });
  assert.equal(api.updateHistory(user.id, historyId, { ratio: '1:1' }), true);
  assert.equal(api.getUserHistoryCount(user.id, { keyword: '测试图片' }), 1);

  const stats = api.getUserStats(user.id);
  assert.equal(stats.currentPoints, 1050);
  assert.equal(stats.totalImages, 2);
  assert.equal(stats.totalRecords, 1);
});
