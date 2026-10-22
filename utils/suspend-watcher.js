// 电脑休眠/待机检测。
// Windows 进入睡眠后进程被冻结，恢复时墙钟时间会直接跳过去一大段，
// 于是"任务用时"会把睡眠时间也算进去（用户会以为上游生成了十几分钟）。
// 这里用固定心跳发现墙钟跳变，并在任务结算时把这段标记成 suspended_ms。
const HEARTBEAT_MS = 2000;
const MIN_SUSPEND_MS = 15000;
const MAX_WINDOWS = 200;

let heartbeatTimer = null;
let lastTickMs = Date.now();
let suspendWindows = [];

function recordGap(fromMs, toMs) {
  const from = Number(fromMs);
  const to = Number(toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const gapMs = to - from;
  if (gapMs < MIN_SUSPEND_MS) return null;
  const window = { fromMs: from, toMs: to, ms: gapMs };
  suspendWindows.push(window);
  if (suspendWindows.length > MAX_WINDOWS) suspendWindows = suspendWindows.slice(-MAX_WINDOWS);
  return window;
}

function tick() {
  const now = Date.now();
  recordGap(lastTickMs, now);
  lastTickMs = now;
}

function start() {
  if (heartbeatTimer) return;
  lastTickMs = Date.now();
  heartbeatTimer = setInterval(tick, HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function stop() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function getSuspendedWindows() {
  return suspendWindows.slice();
}

function getSuspendedMsBetween(startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let total = 0;
  for (const window of suspendWindows) {
    const overlap = Math.min(end, window.toMs) - Math.max(start, window.fromMs);
    if (overlap > 0) total += overlap;
  }
  return total;
}

function reset() {
  suspendWindows = [];
  lastTickMs = Date.now();
}

module.exports = {
  HEARTBEAT_MS,
  MIN_SUSPEND_MS,
  getSuspendedMsBetween,
  getSuspendedWindows,
  recordGap,
  reset,
  start,
  stop
};
