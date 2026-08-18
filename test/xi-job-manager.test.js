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
