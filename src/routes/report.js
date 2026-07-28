const express = require('express');
const { prepare, transaction } = require('../db');
const { classifyApp } = require('../appClassifier');
const { normalizeReportedTime } = require('../time');

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
    return res.status(409).json({ error: '请先在网页注册账号' });
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
    let inserted = 0;
    for (const r of items) {
      const appName = String(r.appName || '').trim();
      const packageName = String(r.packageName || '').trim();
      if (!appName && !packageName) continue;

      prepare(`
        INSERT INTO app_usage (device_id, package_name, app_name, category, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        deviceId, packageName, appName || packageName, classifyApp(packageName, appName, r.category),
        normalizeReportedTime(r.startTime), normalizeReportedTime(r.endTime), Number(r.durationSeconds || 0)
      );
      inserted += 1;
    }
    return inserted;
  });

  const insertedCount = insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'app_usage', insertedCount);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: insertedCount, skipped: records.length - insertedCount });
});

// 上报网页浏览记录（批量）
router.post('/web-history', checkDevice, (req, res) => {
  const { deviceId, records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records 不能为空' });
  }

  const insert = transaction((items) => {
    let inserted = 0;
    for (const r of items) {
      const url = String(r.url || '').trim();
      if (!url) continue;
      prepare('INSERT INTO web_history (device_id, url, title, browser, visited_at) VALUES (?, ?, ?, ?, ?)')
        .run(deviceId, url, r.title || '', r.browser || '未知浏览器', normalizeReportedTime(r.visitedAt));
      inserted += 1;
    }
    return inserted;
  });

  const insertedCount = insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'web_history', insertedCount);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: insertedCount, skipped: records.length - insertedCount });
});

// 上报微信小程序使用记录（批量）
router.post('/miniprogram-usage', checkDevice, (req, res) => {
  const { deviceId, records } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records 不能为空' });
  }

  const insert = transaction((items) => {
    let inserted = 0;
    for (const r of items) {
      const programName = String(r.programName || '').trim();
      if (!programName) continue;
      prepare(`
        INSERT INTO miniprogram_usage (device_id, program_name, start_time, end_time, duration_seconds)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        deviceId, programName, normalizeReportedTime(r.startTime),
        r.endTime ? normalizeReportedTime(r.endTime) : null, Number(r.durationSeconds || 0)
      );
      inserted += 1;
    }
    return inserted;
  });

  const insertedCount = insert(records);

  prepare('INSERT INTO sync_log (device_id, sync_type, record_count) VALUES (?, ?, ?)')
    .run(deviceId, 'miniprogram_usage', insertedCount);

  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);

  res.json({ message: 'ok', count: insertedCount, skipped: records.length - insertedCount });
});

// 心跳/设备在线
router.post('/heartbeat', checkDevice, (req, res) => {
  const { deviceId } = req.body;
  prepare('UPDATE devices SET last_online = CURRENT_TIMESTAMP WHERE device_id = ?').run(deviceId);
  res.json({ message: 'ok', serverTime: new Date().toISOString() });
});

module.exports = router;
