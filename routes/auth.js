const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { createUser, createUserWithInvite, verifyUser, getUserById } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

// 注册接口：每小时最多3次，防止批量注册
const registerLimiter = rateLimit({ windowMs: 3600000, max: 3, message: { error: '注册过于频繁，请稍后再试' } });

// 登录失败计数：按"用户名+IP"维度，连续失败5次锁定15分钟，防暴力破解
const loginFailCounts = new Map(); // key -> { count, lockedUntilMs }
const LOGIN_FAIL_MAX = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

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
  const entry = loginFailCounts.get(key) || { count: 0, lockedUntilMs: 0 };
  entry.count += 1;
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
  const host = String(req.hostname || '').split(':')[0];
  return isPrivateAddress(host) || isPrivateAddress(req.ip);
}

router.get('/register-config', (req, res) => {
  res.json({ inviteRequired: !allowRegisterWithoutInvite(req) });
});

// 注册（公网需要邀请码，本地/内网部署可免邀请码）
router.post('/register', registerLimiter, (req, res) => {
  const { username, password, inviteCode } = req.body;
  const inviteRequired = !allowRegisterWithoutInvite(req);
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  
  if (inviteRequired && !inviteCode) {
    return res.status(400).json({ error: '注册需要邀请码' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: '用户名长度需在3-20个字符之间' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: '密码长度至少8位' });
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return res.status(400).json({ error: '密码需包含大小写字母和数字' });
  }
  
  try {
    const user = inviteRequired || inviteCode
      ? createUserWithInvite(username, password, inviteCode)
      : createUser(username, password);
    const token = generateToken(user);
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        points: user.points,
        role: user.role
      }
    });
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
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
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

  clearLoginFailures(username, clientIp);
  const token = generateToken(user);
  
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      points: user.points,
      role: user.role
    }
  });
});

// 获取当前登录用户信息
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
