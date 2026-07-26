const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, prepare } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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

  const hash = bcrypt.hashSync(password, 10);
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
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

  res.json({
    message: '登录成功',
    token,
    userId: user.id,
    username,
  });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

// 绑定设备
router.post('/bind-device', authMiddleware, (req, res) => {
  const { deviceId, deviceName, bindCode } = req.body;
  if (!deviceId || !bindCode) {
    return res.status(400).json({ error: '参数不完整' });
  }

  if (bindCode !== process.env.BIND_CODE) {
    return res.status(403).json({ error: '绑定码错误' });
  }

  const existing = prepare('SELECT id FROM devices WHERE device_id = ?').get(deviceId);
  if (existing) {
    prepare('UPDATE devices SET user_id = ?, device_name = ?, last_online = CURRENT_TIMESTAMP WHERE device_id = ?')
      .run(req.userId, deviceName || '学习机', deviceId);
    return res.json({ message: '设备已重新绑定' });
  }

  prepare('INSERT INTO devices (device_id, device_name, user_id, bind_code) VALUES (?, ?, ?, ?)')
    .run(deviceId, deviceName || '学习机', req.userId, bindCode);

  res.json({ message: '设备绑定成功' });
});

// 获取已绑定设备列表
router.get('/devices', authMiddleware, (req, res) => {
  const devices = prepare(
    'SELECT device_id, device_name, last_online, created_at FROM devices WHERE user_id = ? ORDER BY last_online DESC'
  ).all(req.userId);
  res.json(devices);
});

module.exports = router;
