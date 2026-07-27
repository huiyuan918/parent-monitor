const express = require('express');
const { prepare } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { normalizeRecord } = require('../appClassifier');

const router = express.Router();

router.use(authMiddleware);

// 仪表盘总览
router.get('/overview', (req, res) => {
  const { deviceId, date } = req.query;

  const devices = deviceId
    ? [prepare('SELECT * FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, req.userId)]
    : prepare('SELECT * FROM devices WHERE user_id = ?').all(req.userId);

  if (!devices.length || !devices[0]) {
    return res.json({ totalTime: 0, categories: [], devices: [] });
  }

  const targetDeviceId = devices[0].device_id;
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const todayTotal = prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) as total
    FROM app_usage
    WHERE device_id = ? AND date(start_time) = ?
  `).get(targetDeviceId, targetDate);

  const appRows = prepare(`
    SELECT app_name, package_name, category, duration_seconds
    FROM app_usage
    WHERE device_id = ? AND date(start_time) = ?
  `).all(targetDeviceId, targetDate);
  const categories = Object.values(appRows.reduce((acc, row) => {
    const category = normalizeRecord(row).category;
    if (!acc[category]) acc[category] = { category, total_seconds: 0 };
    acc[category].total_seconds += row.duration_seconds || 0;
    return acc;
  }, {})).sort((a, b) => b.total_seconds - a.total_seconds);

  const mpTotal = prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) as total
    FROM miniprogram_usage
    WHERE device_id = ? AND date(start_time) = ?
  `).get(targetDeviceId, targetDate);

  const webCount = prepare(`
    SELECT COUNT(*) as count FROM web_history
    WHERE device_id = ? AND date(visited_at) = ?
  `).get(targetDeviceId, targetDate);

  res.json({
    totalTime: todayTotal.total,
    categories,
    miniprogramTime: mpTotal.total,
    webPageCount: webCount.count,
    devices: devices.map(d => ({
      deviceId: d.device_id,
      deviceName: d.device_name,
      lastOnline: d.last_online,
    })),
  });
});

// 应用使用详情
router.get('/app-usage', (req, res) => {
  const { deviceId, date, page = 1, pageSize = 50 } = req.query;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const targetDate = date || new Date().toISOString().slice(0, 10);
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = prepare(`
    SELECT app_name, package_name, category, start_time, end_time, duration_seconds
    FROM app_usage
    WHERE device_id = ? AND date(start_time) = ?
    ORDER BY start_time DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset).map(normalizeRecord);

  const total = prepare(`
    SELECT COUNT(*) as count FROM app_usage
    WHERE device_id = ? AND date(start_time) = ?
  `).get(deviceId, targetDate);

  const summaryRows = prepare(`
    SELECT app_name, package_name, category,
           COALESCE(SUM(duration_seconds), 0) as total_seconds,
           COUNT(*) as session_count
    FROM app_usage
    WHERE device_id = ? AND date(start_time) = ?
    GROUP BY package_name
    ORDER BY total_seconds DESC
  `).all(deviceId, targetDate);
  const summary = summaryRows.map(normalizeRecord);

  res.json({
    records, summary,
    total: total.count, page: parseInt(page), pageSize: parseInt(pageSize),
  });
});

// 应用使用趋势
router.get('/app-trend', (req, res) => {
  const { deviceId, days = 7 } = req.query;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const trend = prepare(`
    SELECT date(start_time) as day,
           COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM app_usage
    WHERE device_id = ? AND start_time >= datetime('now', '-' || ? || ' days')
    GROUP BY date(start_time)
    ORDER BY day ASC
  `).all(deviceId, parseInt(days));

  res.json(trend);
});

// 网页浏览历史
router.get('/web-history', (req, res) => {
  const { deviceId, date, page = 1, pageSize = 50 } = req.query;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const targetDate = date || new Date().toISOString().slice(0, 10);
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = prepare(`
    SELECT url, title, browser, visited_at
    FROM web_history
    WHERE device_id = ? AND date(visited_at) = ?
    ORDER BY visited_at DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset);

  const total = prepare(`
    SELECT COUNT(*) as count FROM web_history
    WHERE device_id = ? AND date(visited_at) = ?
  `).get(deviceId, targetDate);

  res.json({ records, total: total.count, page: parseInt(page), pageSize: parseInt(pageSize) });
});

// 微信小程序使用记录
router.get('/miniprogram-usage', (req, res) => {
  const { deviceId, date, page = 1, pageSize = 50 } = req.query;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const targetDate = date || new Date().toISOString().slice(0, 10);
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = prepare(`
    SELECT program_name, start_time, end_time, duration_seconds
    FROM miniprogram_usage
    WHERE device_id = ? AND date(start_time) = ?
    ORDER BY start_time DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset);

  const total = prepare(`
    SELECT COUNT(*) as count FROM miniprogram_usage
    WHERE device_id = ? AND date(start_time) = ?
  `).get(deviceId, targetDate);

  const summary = prepare(`
    SELECT program_name,
           COALESCE(SUM(duration_seconds), 0) as total_seconds,
           COUNT(*) as visit_count
    FROM miniprogram_usage
    WHERE device_id = ? AND date(start_time) = ?
    GROUP BY program_name
    ORDER BY total_seconds DESC
  `).all(deviceId, targetDate);

  res.json({
    records, summary,
    total: total.count, page: parseInt(page), pageSize: parseInt(pageSize),
  });
});

module.exports = router;
