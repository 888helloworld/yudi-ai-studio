const jwt = require('jsonwebtoken');
const { getUserAuthById } = require('../db');

// JWT_SECRET 必须显式配置，避免随机回退导致重启后所有 token 失效、或弱密钥被伪造。
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
  throw new Error('必须配置 JWT_SECRET（至少 16 个字符的高强度随机字符串）');
}
const JWT_SECRET = process.env.JWT_SECRET.trim();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const AUTH_COOKIE_NAME = 'xhs_session';

function getCookieToken(req) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function getRequestToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer && !['cookie', 'null', 'undefined'].includes(bearer.toLowerCase())) return bearer;
  }
  return getCookieToken(req);
}

// 生成Token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: Number(user.token_version || 0) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// 验证Token中间件
function authMiddleware(req, res, next) {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserAuthById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    if (Number(decoded.tv || 0) !== Number(user.token_version || 0)) {
      return res.status(401).json({ error: '登录状态已失效，请重新登录' });
    }
    if (user.status && user.status !== 'active') {
      const label = user.status === 'banned' ? '账号已封禁' : '账号已冻结';
      return res.status(403).json({ error: user.status_reason ? `${label}：${user.status_reason}` : label });
    }
    
    req.user = user;
    req.userId = user.id;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的登录凭证' });
  }
}

// 管理员中间件
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// 可选认证（不强制登录）
function optionalAuth(req, res, next) {
  const token = getRequestToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = getUserAuthById(decoded.id);
      if (user && Number(decoded.tv || 0) === Number(user.token_version || 0)) {
        req.user = user;
        req.userId = user.id;
      }
    } catch (e) {
      // 忽略错误，继续
    }
  }
  
  next();
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  AUTH_COOKIE_NAME,
  generateToken,
  getRequestToken,
  authMiddleware,
  adminMiddleware,
  optionalAuth
};
