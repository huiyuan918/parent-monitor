require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 先加载路由（不需要等数据库）
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/report');
const dashboardRoutes = require('./routes/dashboard');

app.use('/api/auth', authRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    db: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
    commit: process.env.RENDER_GIT_COMMIT || null,
  });
});

// 静态文件和前端页面
const webDist = path.join(__dirname, '..', 'public');
app.use(express.static(webDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const { getDb } = require('./db');
const { migrateFromPostgresIfNeeded } = require('./migratePostgres');

migrateFromPostgresIfNeeded().then(() => getDb()).then(() => {
  console.log('DB ready');
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
});
