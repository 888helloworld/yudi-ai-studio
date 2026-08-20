const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), `xhs-xi-manager-${crypto.randomUUID()}.db`);
process.env.DATABASE_PATH = databasePath;
process.env.ADMIN_PASSWORD = 'TestAdmin123';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-characters';

const api = require('../db');
const { db } = require('../database');
const { createXiJobManager } = require('../services/xi-job-manager');

function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('等待 Xi 队列状态超时'));
      setTimeout(check, 10);
    };
    check();
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

test('Xi 队列限制并发并保持任务历史与上传权限', async () => {
  const user = api.createUser('xi_manager_user', 'XiManagerPass123');
  const releases = [];
  let active = 0;
  let maxSeen = 0;
  let started = 0;
  let manager;

  manager = createXiJobManager({
    db: api,
    maxActiveJobs: 2,
    formatDateTime: () => '12:00',
    getModel: () => 'test-image-model',
    runJob: async (job) => {
      job.status = 'running';
      job.startedAtMs = Date.now();
      active += 1;
      started += 1;
      maxSeen = Math.max(maxSeen, active);
      await new Promise((resolve) => {
        releases.push(() => {
          job.status = 'completed';
          job.finishedAtMs = Date.now();
          job.imageUrls = [`/uploads/${job.id}.png`];
          manager.updateJobHistory(job, 'completed', job.imageUrls, job.costPoints);
          active -= 1;
          resolve();
        });
      });
    }
  });

  const payload = {
    mode: 'generate',
    prompt: '测试 Xi 队列',
    size: '1024x1024',
    count: 1,
    quality: 'medium',
    costPoints: 10
  };
  const first = manager.createJob(user.id, payload);
  manager.createJob(user.id, payload);
  manager.createJob(user.id, payload);

  await waitFor(() => started === 2);
  assert.equal(maxSeen, 2);
  assert.equal(manager.listActiveJobsForUser(user.id).length, 3);

  releases.shift()();
  await waitFor(() => started === 3);
  assert.equal(maxSeen, 2);

  while (releases.length) releases.shift()();
  await waitFor(() => manager.listActiveJobsForUser(user.id).length === 0);

  assert.equal(manager.canUserAccessUpload(user.id, `${first.id}.png`), true);
  const history = api.getUserHistory(user.id, { type: 'image' });
  assert.equal(history.length, 3);
  assert.equal(JSON.parse(history[0].content).status, 'completed');
});

test('Xi 队列拒绝单用户超额任务和全局排队溢出', () => {
  const users = [
    api.createUser('xi_limit_user_a', 'XiLimitPass123'),
    api.createUser('xi_limit_user_b', 'XiLimitPass123'),
    api.createUser('xi_limit_user_c', 'XiLimitPass123')
  ];
  const manager = createXiJobManager({
    db: api,
    maxActiveJobs: 1,
    maxJobsPerUser: 2,
    maxQueuedJobs: 1,
    formatDateTime: () => '12:00',
    getModel: () => 'gpt-image-2',
    runJob: async (job) => {
      job.status = 'running';
      await new Promise(() => {});
    }
  });
  const payload = { mode: 'generate', prompt: '限额测试', size: '1024x1024', count: 1, quality: 'medium', costPoints: 10 };
  manager.assertCanCreateJob(users[0].id);
  manager.createJob(users[0].id, payload);
  manager.assertCanCreateJob(users[0].id);
  manager.createJob(users[0].id, payload);
  assert.throws(() => manager.assertCanCreateJob(users[0].id), /最多同时处理 2 个/);
  assert.throws(() => manager.assertCanCreateJob(users[1].id), /排队任务较多/);
});
