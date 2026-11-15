'use strict';
/* Phone controller: join by room code, then hold-buttons send the
   held-input state to the TV through the server (on change + heartbeat). */
const $ = (id) => document.getElementById(id);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

let ws = null, code = '', role = '';
let mySlot = 0, myColor = '';
const input = { left: false, right: false, jump: false, boost: false };
let lastSent = '';
window.__phone = { input, get role() { return role; }, get code() { return code; }, get slot() { return mySlot; } };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function renderStandings(list) {
  const el = $('standings');
  if (!list || !list.length) { el.hidden = true; return; }
  const rows = [...list].sort((a, b) => ((b.progress || 0) - (a.progress || 0)) || (b.score - a.score));
  el.hidden = false;
  el.innerHTML = '<div class="stTitle">🏁 الترتيب</div>' + rows.map((p, i) =>
    '<div class="stRow"><span class="stRank">' + (i + 1) + '</span>'
    + '<span class="chipDot" style="background:' + (p.color || '#888') + '"></span>'
    + '<b>' + escapeHtml(p.name || ('اللاعب ' + p.slot)) + '</b>'
    + '<span>⭐ ' + p.score + '</span><span>🪙 ' + p.coins + '</span><span>💀 ' + (p.deaths || 0) + '</span></div>').join('');
}

const params = new URLSearchParams(location.search);
if (params.get('c')) $('codeInput').value = params.get('c').slice(0, 4);

function sendInput(force) {
  if (!ws || ws.readyState !== 1 || role !== 'controller') return;
  const s = JSON.stringify(input);
  if (force || s !== lastSent) { lastSent = s; ws.send(JSON.stringify({ t: 'input', input })); }
}
setInterval(() => sendInput(false), 100); /* heartbeat: resends only on change */

function setKey(k, on) {
  input[k] = on;
  const btn = document.querySelector('[data-k="' + k + '"]');
  if (btn) btn.classList.toggle('held', on);
  sendInput(true);
}
document.querySelectorAll('.ctl').forEach((btn) => {
  const k = btn.dataset.k;
  const down = (e) => { e.preventDefault(); setKey(k, true); };
  const up = (e) => { e.preventDefault(); setKey(k, false); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('touchstart', down, { passive: false });
  btn.addEventListener('touchend', up, { passive: false });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

function sendControl(action, level) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'control', action, level: level || undefined }));
}
$('startBtn').addEventListener('click', () => sendControl('start'));
$('pauseBtn').addEventListener('click', () => sendControl('pause'));
$('restartBtn').addEventListener('click', () => sendControl('restart'));

function join() {
  code = $('codeInput').value.trim();
  if (!/^\d{4}$/.test(code)) { $('joinErr').textContent = 'أدخل كوداً من 4 أرقام'; return; }
  $('joinErr').textContent = '';
  $('joinBtn').disabled = true;
  $('joinBtn').textContent = '⏳ جارٍ الاتصال…';
  ws = new WebSocket(WS_URL);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code, name: $('nameInput').value.trim() }));
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.t === 'joined') {
      role = msg.role;
      $('join').hidden = true;
      $('pad').hidden = false;
      $('roomLbl').textContent = 'غرفة ' + msg.code;
      $('connLbl').textContent = '✅ متصل';
      if (role === 'controller') {
        mySlot = msg.slot; myColor = msg.color || '#e52521';
        const b = $('slotBadge');
        b.hidden = false;
        b.textContent = '🎮 أنت اللاعب ' + msg.slot + (msg.name ? ' — ' + msg.name : '');
        b.style.background = myColor;
        b.style.borderColor = myColor;
      }
      if (role === 'spectator') {
        $('specNote').hidden = false;
        $('controls').style.opacity = '.35';
        $('controls').style.pointerEvents = 'none';
        $('phaseLbl').textContent = 'أنت تشاهد اللعبة فقط';
      }
    } else if (msg.t === 'hud') {
      const ps = msg.players || [];
      const me = ps.find((p) => p.slot === mySlot);
      if (role === 'spectator') {
        $('hudLbl').textContent = '👀 تشاهد • ' + ps.length + (ps.length === 1 ? ' لاعب' : ' لاعبين');
        renderStandings(msg.standings || ps);
      } else if (me) {
        $('hudLbl').textContent = '⭐ ' + me.score + ' • 🪙 ' + me.coins + ' • 💀 ' + me.deaths;
      }
      const phases = { lobby: 'الردهة', playing: 'تلعب الآن — المستوى ' + msg.level, paused: 'متوقفة مؤقتاً', dying: '…', gameover: 'انتهت اللعبة — اضغط إعادة', win: '🎉 أنهيت المستوى ' + msg.level + '!' };
      if (role !== 'spectator') $('phaseLbl').textContent = phases[msg.phase] || msg.phase;
      if (msg.phase === 'win' && msg.winner) {
        $('phaseLbl').textContent = '🏆 الفائز: ' + msg.winner.name + '!';
        renderStandings(msg.standings || ps);
      } else if (role !== 'spectator') {
        $('standings').hidden = true;
      }
    } else if (msg.t === 'err') {
      $('joinErr').textContent = msg.m || 'خطأ';
      $('joinBtn').disabled = false;
      $('joinBtn').textContent = '🎮 انضم للعب';
      try { ws.close(); } catch (e) {}
    }
  };
  ws.onclose = () => {
    if (!$('pad').hidden) { $('connLbl').textContent = '⚠️ انقطع الاتصال'; }
    $('joinBtn').disabled = false;
    $('joinBtn').textContent = '🎮 انضم للعب';
  };
}
$('joinBtn').addEventListener('click', join);
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
if ($('codeInput').value.length === 4) $('joinBtn').focus();
