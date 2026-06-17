const jwt = require('jsonwebtoken');
const { getUserById } = require('../db');

// JWT_SECRET 必须显式配置，避免随机回退导致重启后所有 token 失效、或弱密钥被伪造。
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
  throw new Error('必须配置 JWT_SECRET（至少 16 个字符的高强度随机字符串）');
}
const JWT_SECRET = process.env.JWT_SECRET.trim();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// 生成Token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// 验证Token中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
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
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = getUserById(decoded.id);
      if (user) {
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
  generateToken,
  authMiddleware,
  adminMiddleware,
  optionalAuth
};
