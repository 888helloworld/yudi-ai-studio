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
    .get(`xi-job-recovery-failure:${historyId}`);
  assert.equal(refundLogs.count, 1);
});
