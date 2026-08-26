const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { createUser, createUserWithInvite, verifyUser, revokeUserTokens } = require('../db');
const { AUTH_COOKIE_NAME, generateToken, authMiddleware, optionalAuth } = require('../middleware/auth');
const { addAnalyticsEvent } = require('../repositories/analytics-repository');
const POLICY_VERSION = process.env.POLICY_VERSION || '2026-08-26-v1';

const configuredCookieMaxAge = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const cookieMaxAge = Number.isFinite(configuredCookieMaxAge)
  ? Math.min(Math.max(Math.floor(configuredCookieMaxAge), 60 * 1000), 30 * 24 * 60 * 60 * 1000)
  : 7 * 24 * 60 * 60 * 1000;
const cookieSecure = /^true$/i.test(process.env.AUTH_COOKIE_SECURE || '')
  || (process.env.NODE_ENV === 'production' && !/^false$/i.test(process.env.AUTH_COOKIE_SECURE || ''));

function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure,
    path: '/',
    maxAge: cookieMaxAge
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
  res.setHeader('Cache-Control', 'no-store');
}

function publicAuthResponse(user, token) {
  const response = {
    success: true,
    user: { id: user.id, username: user.username, points: user.points, role: user.role }
  };
  if (/^true$/i.test(process.env.AUTH_RETURN_TOKEN || '')) response.token = token;
  return response;
}

// 注册接口：每小时最多3次，防止批量注册
const registerLimiter = rateLimit({ windowMs: 3600000, max: 3, message: { error: '注册过于频繁，请稍后再试' } });

// 登录失败计数：按"用户名+IP"维度，连续失败5次锁定15分钟，防暴力破解
const loginFailCounts = new Map(); // key -> { count, lockedUntilMs, touchedAtMs }
const LOGIN_FAIL_MAX = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_TRACKER_MAX = 10000;

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePassword(value) {
  return typeof value === 'string' ? value : '';
}

function cleanupLoginTrackers() {
  const cutoff = Date.now() - LOGIN_LOCK_MS;
  for (const [key, entry] of loginFailCounts) {
    if ((entry.touchedAtMs || 0) < cutoff && Date.now() >= (entry.lockedUntilMs || 0)) loginFailCounts.delete(key);
  }
  while (loginFailCounts.size >= LOGIN_TRACKER_MAX) {
    const oldestKey = loginFailCounts.keys().next().value;
    if (oldestKey === undefined) break;
    loginFailCounts.delete(oldestKey);
  }
}

function isLoginLocked(username, ip) {
  const key = `${username}:${ip}`;
  const entry = loginFailCounts.get(key);
  if (!entry) return false;
  if (Date.now() < entry.lockedUntilMs) return true;
  loginFailCounts.delete(key); // 锁定期过了，清除
  return false;
}

function recordLoginFailure(username, ip) {
  const key = `${username}:${ip}`;
  cleanupLoginTrackers();
  const entry = loginFailCounts.get(key) || { count: 0, lockedUntilMs: 0, touchedAtMs: 0 };
  entry.count += 1;
  entry.touchedAtMs = Date.now();
  if (entry.count >= LOGIN_FAIL_MAX) {
    entry.lockedUntilMs = Date.now() + LOGIN_LOCK_MS;
  }
  loginFailCounts.set(key, entry);
}

function clearLoginFailures(username, ip) {
  loginFailCounts.delete(`${username}:${ip}`);
}

function isPrivateAddress(value = '') {
  const text = String(value || '').toLowerCase().replace(/^::ffff:/, '');
  if (!text) return false;
  if (text === 'localhost' || text === '::1' || text === '127.0.0.1') return true;
  if (text.startsWith('127.')) return true;
  if (text.startsWith('10.')) return true;
  if (text.startsWith('192.168.')) return true;
  const match = text.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function allowRegisterWithoutInvite(req) {
  if (/^true$/i.test(process.env.LOCAL_REGISTER_WITHOUT_INVITE || '')) return true;
  if (/^false$/i.test(process.env.LOCAL_REGISTER_WITHOUT_INVITE || '')) return false;
  // 生产环境必须显式决定注册策略。不能仅凭 req.ip 是内网地址就放行：
  // nginx 反代到 127.0.0.1 时，未正确配置 trust proxy 的公网请求也会看起来来自本机。
  if (process.env.NODE_ENV === 'production') return false;
  const forwarded = req.get('x-forwarded-for') || req.get('x-forwarded-proto') || req.get('forwarded');
  if (forwarded) return false;
  return isPrivateAddress(req.socket?.remoteAddress || req.ip);
}

router.get('/register-config', (req, res) => {
  res.json({ inviteRequired: !allowRegisterWithoutInvite(req) });
});

// 注册（公网需要邀请码，本地/内网部署可免邀请码）
router.post('/register', registerLimiter, (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  const inviteCode = typeof req.body.inviteCode === 'string' ? req.body.inviteCode.trim() : '';
  const inviteRequired = !allowRegisterWithoutInvite(req);
  const policyAccepted = req.body.policyAccepted === true;
  const policyVersion = String(req.body.policyVersion || '').trim();
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (!policyAccepted || policyVersion !== POLICY_VERSION) {
    return res.status(400).json({ error: '请先阅读并同意当前版本的服务条款、隐私政策和内容规范' });
  }
  
  if (inviteRequired && !inviteCode) {
    return res.status(400).json({ error: '注册需要邀请码' });
  }
  
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为3-20位字母、数字或下划线' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: '密码长度至少8位' });
  }
  if (password.length > 128) return res.status(400).json({ error: '密码长度不能超过128位' });
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return res.status(400).json({ error: '密码需包含大小写字母和数字' });
  }
  
  try {
    const policy = { version: POLICY_VERSION, acceptedAt: new Date().toISOString(), ip: req.ip };
    const user = inviteRequired || inviteCode
      ? createUserWithInvite(username, password, inviteCode, policy)
      : createUser(username, password, policy);
    const token = generateToken(user);
    setAuthCookie(res, token);
    try { addAnalyticsEvent({ userId: user.id, eventName: 'signup_success', properties: { policy_version: POLICY_VERSION } }); } catch {}
    res.json(publicAuthResponse(user, token));
  } catch (e) {
    if (e.message === '用户名已存在') {
      return res.status(400).json({ error: '用户名已存在' });
    }
    if (e.message === '邀请码无效' || e.message === '邀请码已被使用') {
      return res.status(400).json({ error: e.message });
    }
    console.error('注册错误:', e);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

// 登录
router.post('/login', (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length > 20 || password.length > 128) {
    return res.status(400).json({ error: '用户名或密码格式不正确' });
  }

  const clientIp = req.ip;
  if (isLoginLocked(username, clientIp)) {
    return res.status(429).json({ error: '登录失败次数过多，请15分钟后再试' });
  }
  
  const user = verifyUser(username, password);
  
  if (!user) {
    recordLoginFailure(username, clientIp);
    const key = `${username}:${clientIp}`;
    const remaining = LOGIN_FAIL_MAX - (loginFailCounts.get(key)?.count || 0);
    if (remaining <= 0) {
      return res.status(429).json({ error: '登录失败次数过多，请15分钟后再试' });
    }
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (user.status && user.status !== 'active') {
    const label = user.status === 'banned' ? '账号已封禁' : '账号已冻结';
    return res.status(403).json({ error: user.status_reason ? `${label}：${user.status_reason}` : label });
  }

  clearLoginFailures(username, clientIp);
  const token = generateToken(user);
  setAuthCookie(res, token);
  try { addAnalyticsEvent({ userId: user.id, eventName: 'login_success' }); } catch {}
  res.json(publicAuthResponse(user, token));
});

router.post('/logout', optionalAuth, (req, res) => {
  if (req.userId) revokeUserTokens(req.userId);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure,
    path: '/'
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true });
});

// 获取当前登录用户信息
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
