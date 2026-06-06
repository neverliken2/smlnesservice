import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../core/auth';
import { APP_VERSION } from '../../core/version';

/**
 * GET / — Status page (HTML, no auth, no global prefix)
 * เปิด browser ที่ root → เห็นการ์ดแสดง status + version + uptime
 * หน้านี้ fetch /health เองทุก 5s
 */
@ApiExcludeController()
@Controller()
@Public()
export class StatusController {
  @Get()
  index(@Res() res: Response): void {
    res.type('html').send(renderStatusPage());
  }
}

function renderStatusPage(): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>smlnesservice — status</title>
<style>
  :root {
    --bg: #0d1117;
    --card: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --muted: #8b949e;
    --ok: #3fb950;
    --warn: #d29922;
    --err: #f85149;
    --accent: #58a6ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg); color: var(--text);
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .wrap { width: 100%; max-width: 640px; }
  h1 {
    margin: 0 0 4px; font-size: 22px; font-weight: 600;
    display: flex; align-items: center; gap: 10px;
  }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 20px; margin-bottom: 16px;
  }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .row:last-child { border: 0; }
  .key { color: var(--muted); font-size: 13px; }
  .val { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600;
  }
  .badge.ok   { background: rgba(63,185,80,.15); color: var(--ok); }
  .badge.warn { background: rgba(210,153,34,.15); color: var(--warn); }
  .badge.err  { background: rgba(248,81,73,.15); color: var(--err); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .dot.pulse { animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  form { display: flex; gap: 8px; margin-top: 12px; }
  input {
    flex: 1; padding: 8px 12px;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; font-size: 13px; font-family: inherit;
  }
  input:focus { outline: none; border-color: var(--accent); }
  button {
    padding: 8px 16px; background: var(--accent); color: #0d1117;
    border: 0; border-radius: 6px; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  button:hover { opacity: .85; }
  .footer { color: var(--muted); font-size: 11px; text-align: center; margin-top: 16px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">
  <h1>
    <span id="hero-badge" class="badge ok"><span class="dot pulse"></span>online</span>
    smlnesservice
  </h1>
  <div class="sub">API Gateway สำหรับ SML ERP — auto-refresh ทุก 5 วินาที</div>

  <div class="card">
    <div class="row"><span class="key">Status</span>             <span class="val" id="status">loading…</span></div>
    <div class="row"><span class="key">Version</span>            <span class="val" id="version">${APP_VERSION}</span></div>
    <div class="row"><span class="key">Uptime</span>             <span class="val" id="uptime">—</span></div>
    <div class="row"><span class="key">Last checked</span>       <span class="val" id="last">—</span></div>
  </div>

  <div class="card">
    <div class="row"><span class="key">Database ping</span>      <span class="val" id="db-status">—</span></div>
    <div class="row" id="db-name-row" style="display:none">
      <span class="key">Database name</span> <span class="val" id="db-name">—</span>
    </div>
    <div class="row" id="db-latency-row" style="display:none">
      <span class="key">Latency</span> <span class="val" id="db-latency">—</span>
    </div>
    <form id="db-form">
      <input id="provider" type="text" placeholder="provider (เช่น demo)" autocomplete="off">
      <button type="submit">Ping</button>
    </form>
  </div>

  <div class="footer">
    JSON endpoint: <a href="/health">/health</a> ·
    <a href="/health?provider=demo">/health?provider=demo</a>
  </div>
</div>

<script>
  const $ = id => document.getElementById(id);
  let lastProvider = '';

  function fmtUptime(sec) {
    if (sec < 60) return sec + 's';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m || (!d && !h)) parts.push(m + 'm');
    return parts.join(' ');
  }

  function setBadge(el, kind, text) {
    el.className = 'badge ' + kind;
    el.innerHTML = '<span class="dot' + (kind==='ok'?' pulse':'') + '"></span>' + text;
  }

  async function refresh() {
    const url = lastProvider
      ? '/health?provider=' + encodeURIComponent(lastProvider)
      : '/health';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      const d = j.data || {};
      const ok = d.status === 'ok';
      const deg = d.status === 'degraded';
      $('status').textContent = d.status || 'unknown';
      setBadge($('hero-badge'), ok ? 'ok' : deg ? 'warn' : 'err', ok ? 'online' : d.status);
      $('version').textContent = d.version || '—';
      $('uptime').textContent = d.uptimeSeconds != null ? fmtUptime(d.uptimeSeconds) : '—';
      $('last').textContent = new Date().toLocaleTimeString();
      if (d.db) {
        $('db-status').innerHTML = '';
        const b = document.createElement('span');
        setBadge(b, d.db.healthy ? 'ok' : 'err', d.db.healthy ? 'healthy' : 'unhealthy');
        $('db-status').appendChild(b);
        $('db-name').textContent = d.db.database;
        $('db-latency').textContent = d.db.latencyMs + ' ms';
        $('db-name-row').style.display = '';
        $('db-latency-row').style.display = '';
        if (d.db.error) {
          $('db-status').appendChild(document.createTextNode(' — ' + d.db.error));
        }
      } else {
        $('db-status').textContent = 'ไม่ได้ระบุ provider';
        $('db-name-row').style.display = 'none';
        $('db-latency-row').style.display = 'none';
      }
    } catch (e) {
      setBadge($('hero-badge'), 'err', 'offline');
      $('status').textContent = 'offline';
      $('last').textContent = new Date().toLocaleTimeString();
    }
  }

  $('db-form').addEventListener('submit', e => {
    e.preventDefault();
    lastProvider = $('provider').value.trim();
    refresh();
  });

  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
