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
const templateRepository = require('../repositories/template-repository');
const { UPLOAD_DIR } = require('../utils/image-storage');
const { deleteUnreferencedUploads, extractUploadFilenames } = require('../utils/upload-cleanup');

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
    } else if (process.env.TEST_ACTION === 'template') {
      const templates = require('./repositories/template-repository');
      result = templates.saveTemplate(Number(process.env.TEST_USER_ID), {
        name: process.env.TEST_TEMPLATE_NAME,
        type: 'copy',
        content: process.env.TEST_TEMPLATE_CONTENT
      });
    } else if (process.env.TEST_ACTION === 'refund') {
      result = api.rechargePoints(
        Number(process.env.TEST_USER_ID),
        Number(process.env.TEST_AMOUNT),
        '并发幂等退款测试',
        process.env.TEST_REFERENCE_KEY
      );
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

  const refundReferenceKey = `test-refund-${crypto.randomUUID()}`;
  const refundResults = await Promise.all([
    runDatabaseWorker('refund', {
      TEST_USER_ID: String(user.id),
      TEST_AMOUNT: '30',
      TEST_REFERENCE_KEY: refundReferenceKey
    }),
    runDatabaseWorker('refund', {
      TEST_USER_ID: String(user.id),
      TEST_AMOUNT: '30',
      TEST_REFERENCE_KEY: refundReferenceKey
    })
  ]);
  assert.equal(refundResults.filter((result) => result.alreadyApplied === false).length, 1);
  assert.equal(refundResults.filter((result) => result.alreadyApplied === true).length, 1);
  assert.equal(api.getUserPoints(user.id), 1080);

  await runDatabaseWorker('template', {
    TEST_USER_ID: String(user.id),
    TEST_TEMPLATE_NAME: '跨进程模板',
    TEST_TEMPLATE_CONTENT: '模板内容会保存到 SQLite'
  });
  assert.equal(templateRepository.getTemplates(user.id, 'copy')[0].content, '模板内容会保存到 SQLite');

  const disposableUser = api.createUser('template_delete_user', 'TemplateDelete123');
  templateRepository.saveTemplate(disposableUser.id, { name: '待删除', type: 'copy', content: '随用户删除' });
  assert.equal(api.deleteUser(disposableUser.id), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM templates WHERE user_id = ?').get(disposableUser.id).count, 0);

  const historyId = api.addHistory(user.id, 'image', {
    image_url: JSON.stringify(['/uploads/a.png', '/uploads/b.png']),
    prompt: '测试图片',
    cost_points: 5
  });
  assert.equal(api.updateHistory(user.id, historyId, { ratio: '1:1' }), true);
  assert.equal(api.getUserHistoryCount(user.id, { keyword: '测试图片' }), 1);

  const stats = api.getUserStats(user.id);
  assert.equal(stats.currentPoints, 1080);
  assert.equal(stats.totalImages, 2);
  assert.equal(stats.totalRecords, 1);
});

test('账号状态、政策同意、分页和正负积分调整可审计', () => {
  const user = api.createUser('governance_user', 'GovernancePass123', {
    version: '2026-08-26-v1',
    acceptedAt: '2026-08-26T00:00:00.000Z',
    ip: '127.0.0.1'
  });
  const persisted = db.prepare('SELECT policy_version, policy_accepted_at, policy_ip, status FROM users WHERE id = ?').get(user.id);
  assert.equal(persisted.policy_version, '2026-08-26-v1');
  assert.equal(persisted.policy_ip, '127.0.0.1');
  assert.equal(persisted.status, 'active');

  assert.deepEqual(api.setUserStatus(user.id, 'frozen', '异常行为待核查'), { success: true });
  assert.equal(api.getUserAuthById(user.id).status, 'frozen');
  assert.deepEqual(api.setUserStatus(user.id, 'active', ''), { success: true });
  db.prepare("UPDATE users SET status = 'frozen', status_until = datetime('now', '-1 minute') WHERE id = ?").run(user.id);
  assert.equal(api.getUserAuthById(user.id).status, 'active');

  const deducted = api.adjustUserPoints(user.id, -100, '异常积分扣回', 'admin-adjust-test');
  assert.equal(deducted.success, true);
  assert.equal(deducted.balance, 900);
  const rejected = api.adjustUserPoints(user.id, -901, '不得扣成负数', 'admin-adjust-rejected');
  assert.equal(rejected.success, false);
  assert.equal(api.getUserPoints(user.id), 900);

  const page = api.getAllUsers({ page: 1, limit: 2, keyword: 'governance', status: 'active' });
  assert.equal(page.total, 1);
  assert.equal(page.list[0].id, user.id);
  const log = db.prepare('SELECT type, amount FROM point_logs WHERE reference_key = ?').get('admin-adjust-test');
  assert.deepEqual(log, { type: 'admin_adjust', amount: -100 });
});

test('删除历史后会清理不再被引用的本地图片，并拒绝删除运行中任务', () => {
  const user = api.createUser('cleanup_user', 'CleanupPass123');
  const filename = `cleanup-test-${crypto.randomUUID()}.png`;
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from('temporary-test-image'));
  const historyId = api.addHistory(user.id, 'image', { image_url: `/uploads/${filename}`, prompt: '清理测试' });
  const deleted = api.deleteHistory(historyId, user.id);
  assert.equal(deleted.success, true);
  deleteUnreferencedUploads(extractUploadFilenames(deleted.row.image_url, deleted.row.content));
  assert.equal(fs.existsSync(filepath), false);

  const activeId = api.addHistory(user.id, 'image', {
    sub_type: 'xi-generate',
    content: JSON.stringify({ status: 'running' }),
    prompt: '运行中任务'
  });
  const blocked = api.deleteHistory(activeId, user.id);
  assert.deepEqual(blocked, { success: false, reason: 'active' });
  assert.deepEqual(api.deleteHistoryAdmin(activeId), { success: false, reason: 'active' });
});
