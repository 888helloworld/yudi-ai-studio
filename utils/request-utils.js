const crypto = require('crypto');

function formatBeijingDateTime(input = new Date(), options = {}) {
  const { date = true, seconds = false } = options;
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(date ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: false
  });
  return formatter.format(input).replace(/\//g, '-');
}

function sanitizeInput(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength).replace(/[<>]/g, '').trim();
}

function normalizeClientTaskId(value) {
  const taskId = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(taskId) ? taskId : null;
}

function safeCompareSecret(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getRequiredEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseImageCount(value, maximum = 4) {
  const count = parseInt(value, 10);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(count, 1), maximum);
}

module.exports = {
  formatBeijingDateTime,
  getRequiredEnv,
  normalizeClientTaskId,
  parseImageCount,
  safeCompareSecret,
  sanitizeInput
};
