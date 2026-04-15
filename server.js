const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway 自动注入 DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// 初始化表
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      type_code TEXT NOT NULL,
      type_cn TEXT NOT NULL,
      dim_scores JSONB,
      answers JSONB,
      ip TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('DB ready');
}

app.use(express.json());
app.use(express.static(__dirname));

// POST /api/submit
app.post('/api/submit', async (req, res) => {
  try {
    const { type_code, type_cn, dim_scores, answers } = req.body;
    if (!type_code || !type_cn) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
    const result = await pool.query(
      'INSERT INTO results (type_code, type_cn, dim_scores, answers, ip) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [type_code, type_cn, dim_scores || {}, answers || {}, ip]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM results');
    const total = parseInt(totalResult.rows[0].count, 10);

    const distResult = await pool.query(
      'SELECT type_code, type_cn, COUNT(*) as count FROM results GROUP BY type_code, type_cn ORDER BY count DESC'
    );
    const distribution = {};
    distResult.rows.forEach(r => {
      distribution[r.type_code] = { count: parseInt(r.count, 10), cn: r.type_cn };
    });

    res.json({ total, distribution });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`BBTI server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
