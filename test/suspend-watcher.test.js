const test = require('node:test');
const assert = require('node:assert/strict');

const suspendWatcher = require('../utils/suspend-watcher');

test('recordGap 只记录明显的时间跳变', () => {
  suspendWatcher.reset();
  assert.equal(suspendWatcher.recordGap(1000, 2000), null);
  assert.equal(suspendWatcher.recordGap(2000, 2000 + suspendWatcher.MIN_SUSPEND_MS - 1), null);
  const recorded = suspendWatcher.recordGap(5000, 5000 + 60000);
  assert.ok(recorded);
  assert.equal(recorded.ms, 60000);
  assert.equal(suspendWatcher.getSuspendedWindows().length, 1);
});

test('getSuspendedMsBetween 只统计与任务区间重叠的休眠时间', () => {
  suspendWatcher.reset();
  suspendWatcher.recordGap(10000, 70000); // 10s -> 70s 跳变 60s
  assert.equal(suspendWatcher.getSuspendedMsBetween(0, 5000), 0);
  assert.equal(suspendWatcher.getSuspendedMsBetween(0, 20000), 10000);
  assert.equal(suspendWatcher.getSuspendedMsBetween(40000, 90000), 30000);
  assert.equal(suspendWatcher.getSuspendedMsBetween(0, 100000), 60000);
  assert.equal(suspendWatcher.getSuspendedMsBetween(80000, 90000), 0);
  suspendWatcher.reset();
});

test('getSuspendedMsBetween 对异常入参返回 0', () => {
  suspendWatcher.reset();
  assert.equal(suspendWatcher.getSuspendedMsBetween(undefined, 100), 0);
  assert.equal(suspendWatcher.getSuspendedMsBetween(100, 100), 0);
  assert.equal(suspendWatcher.getSuspendedMsBetween(200, 100), 0);
});
