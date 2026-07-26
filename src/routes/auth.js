const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prepare } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  return key === crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

// 注册
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }

  const existing = prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const hash = hashPassword(password);
  prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);

  res.json({ message: '注册成功' });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '30d' });

  res.json({ message: '登录成功', token, userId: user.id, username });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// 绑定设备
router.post('/bind-device', authMiddleware, (req, res) => {
  const { deviceId, deviceName, bindCode } = req.body;
  if (!deviceId || !bindCode) return res.status(400).json({ error: '参数不完整' });
  if (bindCode !== (process.env.BIND_CODE || '918918')) return res.status(403).json({ error: '绑定码错误' });

  const existing = prepare('SELECT id FROM devices WHERE device_id = ?').get(deviceId);
  if (existing) {
    prepare('UPDATE devices SET user_id = ?, device_name = ?, last_online = CURRENT_TIMESTAMP WHERE device_id = ?')
      .run(req.userId, deviceName || '设备', deviceId);
    return res.json({ message: '设备已重新绑定' });
  }

  prepare('INSERT INTO devices (device_id, device_name, user_id, bind_code) VALUES (?, ?, ?, ?)')
    .run(deviceId, deviceName || '设备', req.userId, bindCode);
  res.json({ message: '设备绑定成功' });
});

// 获取已绑定设备列表
router.get('/devices', authMiddleware, (req, res) => {
  const devices = prepare('SELECT device_id, device_name, last_online, created_at FROM devices WHERE user_id = ? ORDER BY last_online DESC').all(req.userId);
  res.json(devices);
});

module.exports = router;
