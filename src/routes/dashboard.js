const express = require('express');
const { prepare } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { normalizeRecord } = require('../appClassifier');
const { todayInShanghai, shanghaiDateExpr } = require('../time');

const router = express.Router();

router.use(authMiddleware);

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function getOwnedDeviceId(req, res) {
  const deviceId = String(req.query.deviceId || '').trim();
  if (!deviceId) {
    res.status(400).json({ error: '缺少 deviceId' });
    return null;
  }

  const device = await prepare('SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, req.userId);
  if (!device) {
    res.status(404).json({ error: '设备不存在或不属于当前账号' });
    return null;
  }

  return device.device_id;
}

// 仪表盘总览
router.get('/overview', asyncHandler(async (req, res) => {
  const { deviceId, date } = req.query;

  const devices = deviceId
    ? [await prepare('SELECT * FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, req.userId)]
    : await prepare('SELECT * FROM devices WHERE user_id = ?').all(req.userId);

  if (!devices.length || !devices[0]) {
    return res.json({ totalTime: 0, categories: [], devices: [] });
  }

  const targetDeviceId = devices[0].device_id;
  const targetDate = date || todayInShanghai();

  const todayTotal = await prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) as total
    FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
  `).get(targetDeviceId, targetDate);

  const appRows = await prepare(`
    SELECT app_name, package_name, category, duration_seconds
    FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
  `).all(targetDeviceId, targetDate);
  const categories = Object.values(appRows.reduce((acc, row) => {
    const category = normalizeRecord(row).category;
    if (!acc[category]) acc[category] = { category, total_seconds: 0 };
    acc[category].total_seconds += row.duration_seconds || 0;
    return acc;
  }, {})).sort((a, b) => b.total_seconds - a.total_seconds);

  const mpTotal = await prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) as total
    FROM miniprogram_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
  `).get(targetDeviceId, targetDate);

  const webCount = await prepare(`
    SELECT COUNT(*) as count FROM web_history
    WHERE device_id = ? AND ${shanghaiDateExpr('visited_at')} = ?
  `).get(targetDeviceId, targetDate);

  res.json({
    totalTime: Number(todayTotal.total || 0),
    categories,
    miniprogramTime: Number(mpTotal.total || 0),
    webPageCount: Number(webCount.count || 0),
    devices: devices.map(d => ({
      deviceId: d.device_id,
      deviceName: d.device_name,
      lastOnline: d.last_online,
    })),
  });
}));

// 应用使用详情
router.get('/app-usage', asyncHandler(async (req, res) => {
  const { date, page = 1, pageSize = 50 } = req.query;
  const deviceId = await getOwnedDeviceId(req, res);
  if (!deviceId) return;

  const targetDate = date || todayInShanghai();
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = (await prepare(`
    SELECT app_name, package_name, category, start_time, end_time, duration_seconds
    FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
    ORDER BY start_time DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset)).map(normalizeRecord);

  const total = await prepare(`
    SELECT COUNT(*) as count FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
  `).get(deviceId, targetDate);

  const summaryRows = await prepare(`
    SELECT app_name, package_name, category,
           COALESCE(SUM(duration_seconds), 0) as total_seconds,
           COUNT(*) as session_count
    FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
    GROUP BY package_name, app_name, category
    ORDER BY total_seconds DESC
  `).all(deviceId, targetDate);
  const summary = summaryRows.map((row) => ({
    ...normalizeRecord(row),
    total_seconds: Number(row.total_seconds || 0),
    session_count: Number(row.session_count || 0),
  }));

  res.json({
    records, summary,
    total: Number(total.count || 0), page: parseInt(page), pageSize: parseInt(pageSize),
  });
}));

// 应用使用趋势
router.get('/app-trend', asyncHandler(async (req, res) => {
  const { days = 7 } = req.query;
  const deviceId = await getOwnedDeviceId(req, res);
  if (!deviceId) return;

  const trend = (await prepare(`
    SELECT ${shanghaiDateExpr('start_time')} as day,
           COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM app_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} >= ${process.env.DATABASE_URL ? "CURRENT_DATE - (?::int * INTERVAL '1 day')" : "date('now', '+8 hours', '-' || ? || ' days')"}
    GROUP BY ${shanghaiDateExpr('start_time')}
    ORDER BY day ASC
  `).all(deviceId, parseInt(days))).map((row) => ({
    ...row,
    total_seconds: Number(row.total_seconds || 0),
  }));

  res.json(trend);
}));

// 网页浏览历史
router.get('/web-history', asyncHandler(async (req, res) => {
  const { date, page = 1, pageSize = 50 } = req.query;
  const deviceId = await getOwnedDeviceId(req, res);
  if (!deviceId) return;

  const targetDate = date || todayInShanghai();
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = await prepare(`
    SELECT url, title, browser, visited_at
    FROM web_history
    WHERE device_id = ? AND ${shanghaiDateExpr('visited_at')} = ?
    ORDER BY visited_at DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset);

  const total = await prepare(`
    SELECT COUNT(*) as count FROM web_history
    WHERE device_id = ? AND ${shanghaiDateExpr('visited_at')} = ?
  `).get(deviceId, targetDate);

  res.json({ records, total: Number(total.count || 0), page: parseInt(page), pageSize: parseInt(pageSize) });
}));

// 微信小程序使用记录
router.get('/miniprogram-usage', asyncHandler(async (req, res) => {
  const { date, page = 1, pageSize = 50 } = req.query;
  const deviceId = await getOwnedDeviceId(req, res);
  if (!deviceId) return;

  const targetDate = date || todayInShanghai();
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  const records = await prepare(`
    SELECT program_name, category, start_time, end_time, duration_seconds
    FROM miniprogram_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
    ORDER BY start_time DESC
    LIMIT ? OFFSET ?
  `).all(deviceId, targetDate, parseInt(pageSize), offset);

  const total = await prepare(`
    SELECT COUNT(*) as count FROM miniprogram_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
  `).get(deviceId, targetDate);

  const summary = (await prepare(`
    SELECT program_name, category,
           COALESCE(SUM(duration_seconds), 0) as total_seconds,
           COUNT(*) as visit_count
    FROM miniprogram_usage
    WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?
    GROUP BY program_name, category
    ORDER BY total_seconds DESC
  `).all(deviceId, targetDate)).map((row) => ({
    ...row,
    total_seconds: Number(row.total_seconds || 0),
    visit_count: Number(row.visit_count || 0),
  }));

  res.json({
    records, summary,
    total: Number(total.count || 0), page: parseInt(page), pageSize: parseInt(pageSize),
  });
}));

// 清空某台设备某一天的记录
router.delete('/day-data', asyncHandler(async (req, res) => {
  const { deviceId, date } = req.body;
  if (!deviceId || !date) return res.status(400).json({ error: '缺少 deviceId 或 date' });

  const device = await prepare('SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?').get(deviceId, req.userId);
  if (!device) return res.status(404).json({ error: '设备不存在或不属于当前账号' });

  await prepare(`DELETE FROM app_usage WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?`).run(deviceId, date);
  await prepare(`DELETE FROM web_history WHERE device_id = ? AND ${shanghaiDateExpr('visited_at')} = ?`).run(deviceId, date);
  await prepare(`DELETE FROM miniprogram_usage WHERE device_id = ? AND ${shanghaiDateExpr('start_time')} = ?`).run(deviceId, date);

  res.json({ message: '当天记录已清空' });
}));

module.exports = router;
