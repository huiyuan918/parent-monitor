require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 静态文件 - 托管 Web 面板
const webDist = path.join(__dirname, '..', 'public');
app.use(express.static(webDist));

// 路由（延迟加载，等数据库初始化完成后注册）
let serverReady = false;

app.use('/api/auth', (req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: '服务正在启动中...' });
  next();
});
app.use('/api/report', (req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: '服务正在启动中...' });
  next();
});
app.use('/api/dashboard', (req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: '服务正在启动中...' });
  next();
});

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: serverReady ? 'ok' : 'starting', time: new Date().toISOString() });
});

// 异步启动
async function start() {
  await getDb();
  console.log('✅ 数据库初始化完成');

  // 数据库就绪后加载路由
  const authRoutes = require('./routes/auth');
  const reportRoutes = require('./routes/report');
  const dashboardRoutes = require('./routes/dashboard');

  app.use('/api/auth', authRoutes);
  app.use('/api/report', reportRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  // 所有非 API 请求返回 Web 面板
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(webDist, 'index.html'));
    }
  });

  serverReady = true;

  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅  家长监控系统已启动！');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  🖥️  本机打开: http://localhost:${PORT}`);
    console.log(`  📱  手机打开: http://<本机IP>:${PORT}`);
    console.log(`  🔑  绑定码:  ${process.env.BIND_CODE || '123456'}`);
    console.log('');
    console.log('  按 Ctrl+C 停止服务');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
}

start().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
