const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { createUserWithInvite, verifyUser, getUserById } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');

// 注册接口：每小时最多3次，防止批量注册
const registerLimiter = rateLimit({ windowMs: 3600000, max: 3, message: { error: '注册过于频繁，请稍后再试' } });

// 注册（需要邀请码）
router.post('/register', registerLimiter, (req, res) => {
  const { username, password, inviteCode } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  
  if (!inviteCode) {
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
    const user = createUserWithInvite(username, password, inviteCode);
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
  
  const user = verifyUser(username, password);
  
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  
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
