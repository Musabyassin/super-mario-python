'use strict';
/* سوبر ماريو ويب: خادم غرف بكود، WebSocket، وتقديم صفحات التلفاز والهاتف.
   نفس نموذج سيد العقار: الخادم «مُرحِّل» فقط — فيزياء اللعبة تعمل على
   صفحة التلفاز، والهاتف يرسل حالة الأزرار المضغوطة فيُمرَّرها الخادم
   للتلفاز. لا يحتفظ الخادم بأي حالة لعب. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const ROOT = path.join(__dirname, '..');
/* /assets/img, /assets/levels, /assets/sprites, /assets/sfx
   تُقرأ مباشرة من مجلدات اللعبة الأصلية — لا ننسخ أي ملف ثنائي. */
const ASSETS = {
  '/assets/img/': path.join(ROOT, 'img'),
  '/assets/levels/': path.join(ROOT, 'levels'),
  '/assets/sprites/': path.join(ROOT, 'sprites'),
  '/assets/sfx/': path.join(ROOT, 'sfx'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json; charset=utf-8',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};
const MAX_ROOMS = 300;
const rooms = new Map();

function send(ws, obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } } }
function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

/* ---------- HTTP ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true })); }
    if (p === '/qr') {
      const c = String(url.searchParams.get('c') || '');
      if (!/^\d{4}$/.test(c)) { res.writeHead(400); return res.end('bad code'); }
      const svg = await QRCode.toString(`${origin(req)}/play/?c=${c}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    if (p === '/tv' || p === '/play') { res.writeHead(302, { Location: p + '/' + url.search }); return res.end(); }
    /* ملفات الأصول الأصلية (صور/مستويات/أصوات) */
    for (const [prefix, dir] of Object.entries(ASSETS)) {
      if (p.startsWith(prefix)) {
        const rel = p.slice(prefix.length);
        const file = path.normalize(path.join(dir, rel));
        if (!file.startsWith(dir + path.sep) && file !== dir) { res.writeHead(403); return res.end(); }
        return serveFile(res, file);
      }
    }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  } catch (e) { res.writeHead(500); res.end('server error'); }
});

function serveFile(res, file) {
  fs.stat(file, (statErr, st) => {
    if (!statErr && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
}

/* ---------- Rooms ---------- */
function newCode() {
  for (let i = 0; i < 50; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  return null;
}
function newRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode(); if (!code) return null;
  const room = { code, tv: null, controller: null, spectators: new Set(), created: Date.now(), last: Date.now(), emptyTimer: null };
  rooms.set(code, room); return room;
}
function roomState(room) {
  return { t: 'room', code: room.code, tv: !!room.tv, controller: !!room.controller, spectators: room.spectators.size };
}
function notifyRoom(room) {
  const m = roomState(room);
  if (room.tv) send(room.tv, m);
  if (room.controller) send(room.controller, m);
  room.spectators.forEach((ws) => send(ws, m));
}
function maybeDelete(room) {
  if (room.tv || room.controller || room.spectators.size) return;
  if (room.emptyTimer) return;
  room.emptyTimer = setTimeout(() => {
    if (!room.tv && !room.controller && !room.spectators.size) rooms.delete(room.code);
    room.emptyTimer = null;
  }, 60000);
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const room = ws.room;
    if (room) room.last = Date.now();
    switch (msg.t) {
      case 'ping': return send(ws, { t: 'pong' });
      case 'create': { /* التلفاز ينشئ غرفة (أو يستعيد غرفته بعد تحديث الصفحة) */
        if (room) return;
        let r = null;
        if (msg.resume) { const cand = rooms.get(String(msg.resume)); if (cand && !cand.tv) r = cand; }
        if (!r) r = newRoom();
        if (!r) return send(ws, { t: 'err', m: 'الخادم ممتلئ حالياً، حاول لاحقاً' });
        r.tv = ws; ws.room = r; ws.role = 'tv';
        send(ws, { t: 'created', code: r.code });
        notifyRoom(r);
        return;
      }
      case 'watch': { /* مشاهدة فقط بكود الغرفة */
        const r = rooms.get(String(msg.code || '').trim());
        if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true });
        ws.room = r; ws.role = 'spectator'; r.spectators.add(ws);
        send(ws, { t: 'joined', code: r.code, role: 'spectator' });
        notifyRoom(r);
        return;
      }
      case 'join': { /* الهاتف: أول هاتف يدخل يصير يد التحكم، والباقي مشاهدون */
        const r = rooms.get(String(msg.code || '').trim());
        if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true });
        ws.room = r;
        if (!r.controller) {
          r.controller = ws; ws.role = 'controller';
          send(ws, { t: 'joined', code: r.code, role: 'controller', name: String(msg.name || '').trim().slice(0, 14) || 'لاعب' });
        } else {
          r.spectators.add(ws); ws.role = 'spectator';
          send(ws, { t: 'joined', code: r.code, role: 'spectator', name: String(msg.name || '').trim().slice(0, 14) || 'مشاهد' });
        }
        notifyRoom(r);
        return;
      }
      case 'input': { /* حالة الأزرار من يد التحكم إلى التلفاز */
        if (room && ws.role === 'controller' && room.tv) {
          const inp = msg.input || {};
          send(room.tv, { t: 'input', input: { left: !!inp.left, right: !!inp.right, jump: !!inp.jump, boost: !!inp.boost } });
        }
        return;
      }
      case 'control': { /* بدء/إيقاف/إعادة من الهاتف أو التلفاز نفسه */
        if (!room) return;
        const m = { t: 'control', action: String(msg.action || ''), level: String(msg.level || '') };
        if (ws.role === 'controller' && room.tv) send(room.tv, m);
        if (ws.role === 'tv') send(ws, m); /* التلفاز يتحكم بنفسه محلياً عبر نفس الرسالة */
        return;
      }
      case 'hud': { /* التلفاز يبث حالة اللعبة للهاتف والمشاهدين */
        if (!room || ws.role !== 'tv') return;
        const m = { t: 'hud', phase: String(msg.phase || ''), level: String(msg.level || ''), score: Number(msg.score) || 0, coins: Number(msg.coins) || 0, time: Number(msg.time) || 0 };
        if (room.controller) send(room.controller, m);
        room.spectators.forEach((s) => send(s, m));
        return;
      }
      default: return;
    }
  });
  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    if (ws.role === 'tv' && room.tv === ws) room.tv = null;
    if (ws.role === 'controller' && room.controller === ws) room.controller = null;
    if (ws.role === 'spectator') room.spectators.delete(ws);
    ws.room = null;
    notifyRoom(room);
    maybeDelete(room);
  });
});

setInterval(() => { wss.clients.forEach((ws) => { if (!ws.alive) { try { ws.terminate(); } catch (e) {} return; } ws.alive = false; try { ws.ping(); } catch (e) {} }); }, 30000);

server.listen(PORT, () => console.log(`super-mario-web listening on ${PORT}`));
