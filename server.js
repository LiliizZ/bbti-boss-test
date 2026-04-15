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

// GET /admin - 后台数据面板
app.get('/admin', async (req, res) => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM results');
    const total = parseInt(totalResult.rows[0].count, 10);

    const distResult = await pool.query(
      'SELECT type_code, type_cn, COUNT(*) as count FROM results GROUP BY type_code, type_cn ORDER BY count DESC'
    );

    const recentResult = await pool.query(
      'SELECT type_code, type_cn, ip, created_at FROM results ORDER BY created_at DESC LIMIT 20'
    );

    const rows = distResult.rows;
    const recent = recentResult.rows;
    const maxCount = rows.length ? Math.max(...rows.map(r => parseInt(r.count))) : 1;

    const barRows = rows.map(r => {
      const pct = Math.round((parseInt(r.count) / maxCount) * 100);
      return `<tr>
        <td style="padding:8px 12px;font-weight:600;white-space:nowrap">${r.type_code}</td>
        <td style="padding:8px 12px;color:#6b7084">${r.type_cn}</td>
        <td style="padding:8px 12px;width:100%">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;background:#ece8f8;border-radius:999px;height:10px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#6d28d9,#a855f7);border-radius:999px"></div>
            </div>
            <span style="font-weight:700;color:#6d28d9;min-width:24px">${r.count}</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    const recentRows = recent.map(r => {
      const d = new Date(r.created_at);
      const time = d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      return `<tr style="border-bottom:1px solid #f0eef8">
        <td style="padding:8px 12px;font-weight:600">${r.type_code}</td>
        <td style="padding:8px 12px;color:#6b7084">${r.type_cn}</td>
        <td style="padding:8px 12px;color:#6b7084;font-size:13px">${r.ip || '-'}</td>
        <td style="padding:8px 12px;color:#6b7084;font-size:13px;white-space:nowrap">${time}</td>
      </tr>`;
    }).join('');

    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BBTI 后台</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f5f4fa;margin:0;padding:24px;color:#1a1e2e}
  .shell{max-width:900px;margin:0 auto}
  .card{background:#fff;border:1px solid #dde0ea;border-radius:18px;padding:24px;margin-bottom:20px;box-shadow:0 4px 16px rgba(109,40,217,0.06)}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
  .sub{color:#6b7084;font-size:14px;margin:0 0 24px}
  .stat{font-size:48px;font-weight:900;color:#6d28d9;letter-spacing:-.03em}
  h2{font-size:16px;font-weight:700;margin:0 0 16px;color:#1a1e2e}
  table{width:100%;border-collapse:collapse}
  tr:hover td{background:#fbfaff}
  .badge{display:inline-block;background:#f0eef8;color:#6d28d9;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700}
  .refresh{float:right;font-size:13px;color:#6b7084;text-decoration:none;padding:6px 14px;border:1px solid #dde0ea;border-radius:999px}
  .refresh:hover{background:#f0eef8}
</style>
</head>
<body>
<div class="shell">
  <div class="card">
    <a class="refresh" href="/admin">↻ 刷新</a>
    <h1>🔬 BBTI 后台数据</h1>
    <p class="sub">老板人格鉴定 · 实时统计</p>
    <div class="stat">${total}</div>
    <div style="color:#6b7084;font-size:14px;margin-top:4px">总测评人数</div>
  </div>

  <div class="card">
    <h2>📊 人格分布</h2>
    ${rows.length ? `<table>${barRows}</table>` : '<p style="color:#6b7084;text-align:center;padding:24px">暂无数据</p>'}
  </div>

  <div class="card">
    <h2>🕐 最近 20 条记录</h2>
    ${recent.length ? `<table>
      <thead><tr style="border-bottom:2px solid #f0eef8">
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7084">类型</th>
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7084">名称</th>
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7084">IP</th>
        <th style="padding:8px 12px;text-align:left;font-size:13px;color:#6b7084">时间</th>
      </tr></thead>
      <tbody>${recentRows}</tbody>
    </table>` : '<p style="color:#6b7084;text-align:center;padding:24px">暂无数据</p>'}
  </div>
</div>
</body></html>`);
  } catch (err) {
    console.error('admin error:', err);
    res.status(500).send('Internal server error');
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
