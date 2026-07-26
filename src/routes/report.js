const express = require('express');
const { prepare, transaction } = require('../db');

const router = express.Router();

// 设备上报：自动注册，无需手动绑定
function autoBindDevice(deviceId) {
  const device = prepare('SELECT user_id FROM devices WHERE device_id = ?').get(deviceId);
  if (device) return device.user_id;

  const firstUser = prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (!firstUser) return null;

  prepare('INSERT INTO devices (device_id, device_name, user_id, bind_code) VALUES (?, ?, ?, ?)')
    .run(deviceId, '学习机', firstUser.id, 'auto');
  return firstUser.id;
}

function checkDevice(req, res, next) {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: '缺少 deviceId' });
  }
  const userId = autoBindDevice(deviceId);
  if (!userId) {
    return res.status(200).json({ message: 'ok', note: '请先在网页注册账号' });
  }
  req.deviceUserId = userId;
  next();
}

// 上报应用使用记录（批量）
router.post('/app-usage', checkDevice, (req, res) => {
  const { deviceId, records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records 不能为空' });
  }

  const insert = transaction((items) => {
    for (const r of items) {
      prepare(`
        INSERT INTO app_usage (device_id, package_name, app_name, category, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        deviceId, r.packageName, r.appName, r.category || '其他',
        r.startTime, r.endTime, r.durationSeconds
      );
    }
  });

  insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'app_usage', records.length);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: records.length });
});

// 上报网页浏览记录（批量）
router.post('/web-history', checkDevice, (req, res) => {
  const { deviceId, records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records 不能为空' });
  }

  const insert = transaction((items) => {
    for (const r of items) {
      prepare('INSERT INTO web_history (device_id, url, title, browser, visited_at) VALUES (?, ?, ?, ?, ?)')
        .run(deviceId, r.url, r.title || '', r.browser || '未知浏览器', r.visitedAt);
    }
  });

  insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'web_history', records.length);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: records.length });
});

// 上报微信小程序使用记录（批量）
router.post('/miniprogram-usage', checkDevice, (req, res) => {
  const { deviceId, records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records 不能为空' });
  }

  const insert = transaction((items) => {
    for (const r of items) {
      prepare(`
        INSERT INTO miniprogram_usage (device_id, program_name, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?)
      `).run(deviceId, r.programName, r.startTime, r.endTime || null, r.durationSeconds || 0);
    }
  });

  insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'miniprogram_usage', records.length);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: records.length });
});

// 心跳/设备在线
router.post('/heartbeat', checkDevice, (req, res) => {
  const { deviceId } = req.body;
  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);
  res.json({ message: 'ok', serverTime: new Date().toISOString() });
});

module.exports = router;
