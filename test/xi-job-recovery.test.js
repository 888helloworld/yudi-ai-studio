const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `xhs-xi-recovery-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-characters';

const api = require('../db');
const { db } = require('../database');
const { refundPoints } = require('../services/point-service');
const { createXiJobRuntime } = require('../services/xi-job-runtime');
const { createChargedXiJobHistory, settleXiJobHistory } = require('../repositories/xi-history-repository');

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

test('重启任务无法恢复时退款一次，并保持失败状态', () => {
  const user = api.createUser('xi_recovery_user', 'XiRecoveryPass123');
  api.deductPoints(user.id, 20, '创建改图任务');
  const historyId = api.addHistory(user.id, 'image', {
    sub_type: 'xi-edit',
    image_url: null,
    content: JSON.stringify({
      status: 'queued',
      count: 2,
      source_urls: ['/uploads/missing-source.png']
    }),
    prompt: '缺少参考图的恢复任务',
    ratio: '1024x1024',
    cost_points: 20
  });

  const provider = { fixedQuality: 'medium' };
  const runtime = createXiJobRuntime({ db: api, provider, refundPoints, formatDateTime: () => '12:00' });
  runtime.initializeRecovery();
  runtime.initializeRecovery();

  assert.equal(api.getUserPoints(user.id), 1000);
  const row = db.prepare('SELECT content, cost_points FROM history WHERE id = ?').get(historyId);
  const meta = JSON.parse(row.content);
  assert.equal(meta.status, 'failed');
  assert.equal(meta.refunded_points, 20);
  assert.match(meta.error, /积分已自动退回/);
  assert.equal(row.cost_points, 0);
  const refundLogs = db.prepare('SELECT COUNT(*) AS count FROM point_logs WHERE reference_key = ?')
    .get(`xi-job-settlement:${historyId}`);
  assert.equal(refundLogs.count, 1);
  const refundLog = db.prepare('SELECT type, amount FROM point_logs WHERE reference_key = ?')
    .get(`xi-job-settlement:${historyId}`);
  assert.deepEqual(refundLog, { type: 'refund', amount: 20 });
});

test('画面工坊请求号保证只扣费一次，终态退款与历史更新原子且幂等', () => {
  const user = api.createUser('xi_atomic_user', 'XiAtomicPass123');
  const job = {
    id: 'job_atomic_1',
    userId: user.id,
    clientTaskId: 'client_atomic_1',
    mode: 'generate',
    count: 2,
    costPoints: 20,
    prompt: '原子任务',
    size: '1024x1024'
  };
  const first = createChargedXiJobHistory({ job, content: JSON.stringify({ status: 'queued', count: 2 }) });
  const duplicate = createChargedXiJobHistory({ job, content: JSON.stringify({ status: 'queued', count: 2 }) });
  assert.equal(duplicate.alreadyExists, true);
  assert.equal(duplicate.historyId, first.historyId);
  assert.equal(api.getUserPoints(user.id), 980);

  const settlement = {
    historyId: first.historyId,
    userId: user.id,
    content: JSON.stringify({ status: 'failed', refunded_points: 20 }),
    imageUrls: [],
    costPoints: 0,
    refundAmount: 20,
    refundDescription: '测试退款'
  };
  settleXiJobHistory(settlement);
  settleXiJobHistory(settlement);
  assert.equal(api.getUserPoints(user.id), 1000);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM point_logs WHERE reference_key = ?').get(`xi-job-settlement:${first.historyId}`).count, 1);
});
