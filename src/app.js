require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const contractsRouter = require('./routes/contracts');
const usersRouter = require('./routes/users');
const rulesRouter = require('./routes/rules');
const departmentsRouter = require('./routes/departments');
const archivesRouter = require('./routes/archives');

const app = express();
const PORT = process.env.PORT || 3000;

const archiveDir = path.resolve(__dirname, '../data/archives');
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/contracts', contractsRouter);
app.use('/api/users', usersRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/archives', archivesRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`合同审批 API 服务已启动`);
  console.log(`服务地址: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log(`========================================\n`);
});

module.exports = app;
