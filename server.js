const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'bbti.db');

// 确保 data 目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_code TEXT NOT NULL,
    type_cn TEXT NOT NULL,
    dim_scores TEXT,
    answers TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json());
app.use(express.static(__dirname));

// POST /api/submit - 提交测评结果
app.post('/api/submit', (req, res) => {
  try {
    const { type_code, type_cn, dim_scores, answers } = req.body;
    if (!type_code || !type_cn) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
    const stmt = db.prepare(
      'INSERT INTO results (type_code, type_cn, dim_scores, answers, ip) VALUES (?, ?, ?, ?, ?)'
    );
    const info = stmt.run(
      type_code,
      type_cn,
      JSON.stringify(dim_scores || {}),
      JSON.stringify(answers || {}),
      ip
    );
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stats - 获取统计数据
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM results').get().count;
    const rows = db.prepare(
      'SELECT type_code, type_cn, COUNT(*) as count FROM results GROUP BY type_code ORDER BY count DESC'
    ).all();
    const distribution = {};
    rows.forEach(r => {
      distribution[r.type_code] = { count: r.count, cn: r.type_cn };
    });
    res.json({ total, distribution });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`BBTI server running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
