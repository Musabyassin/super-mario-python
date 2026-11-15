'use strict';
/* TV page: owns the room, runs the game engine, receives held-input
   from up to 4 phones (via the server, tagged by player slot) and
   merges it with the local keyboard (P1). Renders the party HUD bar,
   the lobby slots and the winner screen. Canvas backing store scales
   to the display (up to 3840×2160) with crisp pixel-art upscaling. */
import { MarioGame, PLAYER_COLORS } from '../shared/mario.js';

const $ = (id) => document.getElementById(id);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const canvas = $('cv');
const game = new MarioGame(canvas, {
  onPhase: (phase) => onPhase(phase),
  onHud: (hud) => { renderHud(hud); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hud', ...hud })); },
});
window.__mario = game; /* test hook: state inspection from headless tests */
window.__marioNet = { get code() { return code; }, get phoneInputs() { return phoneInputs; }, get keyInput() { return keyInput; }, get players() { return players; } };

let ws = null, code = sessionStorage.getItem('mario_room') || '';
let phoneInputs = {}; /* slot -> {left,right,jump,boost} */
let keyInput = { left: false, right: false, jump: false, boost: false };
let level = 'Level1-1';
let started = false;
let players = [{ slot: 1, name: 'اللاعب 1' }]; /* room roster; phones override names */
let lastHud = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function applyInputs() {
  for (const p of players) {
    const ph = phoneInputs[p.slot] || {};
    game.setPlayerInput(p.slot, {
      left: !!ph.left || (p.slot === 1 && keyInput.left),
      right: !!ph.right || (p.slot === 1 && keyInput.right),
      jump: !!ph.jump || (p.slot === 1 && keyInput.jump),
      boost: !!ph.boost || (p.slot === 1 && keyInput.boost),
    });
  }
}

function renderLobbySlots(joined) {
  const box = $('slots');
  box.innerHTML = '';
  for (let s = 1; s <= 4; s++) {
    const j = (joined || []).find((p) => p.slot === s);
    const c = PLAYER_COLORS[s - 1];
    const div = document.createElement('div');
    div.className = 'slot' + (j ? ' on' : '');
    div.innerHTML = '<span class="slotDot" style="background:' + c.css + '"></span>'
      + '<b>اللاعب ' + s + '</b>'
      + '<span class="slotName">' + (j ? escapeHtml(j.name) : 'بانتظار لاعب…') + '</span>';
    box.appendChild(div);
  }
}

function renderHud(hud) {
  lastHud = hud;
  const ps = hud.players || [];
  const lead = ps.length ? ps.reduce((a, b) => (b.progress > a.progress ? b : a)) : null;
  $('chips').innerHTML = ps.map((p) => {
    const isLead = lead && p.slot === lead.slot && hud.phase === 'playing';
    return '<div class="chip' + (isLead ? ' leader' : '') + '" style="--pc:' + p.color + '">'
      + '<span class="chipDot"></span><b>' + escapeHtml(p.name) + '</b>'
      + '<span>⭐ ' + p.score + '</span><span>🪙 ' + p.coins + '</span><span>💀 ' + p.deaths + '</span>'
      + (isLead ? '<span>👑</span>' : '') + '</div>';
  }).join('');
  $('barMid').textContent = 'العالم ' + hud.level + '  •  ⏱ ' + String(hud.time).padStart(3, '0');
  if (hud.phase === 'win' && hud.winner) showWin(hud);
}

function showWin(hud) {
  const ov = $('overlay');
  ov.hidden = false;
  $('ovTitle').textContent = '🏆 الفائز: ' + hud.winner.name;
  $('ovSub').textContent = 'أنهى المستوى ' + hud.level + ' أولاً!';
  const st = hud.standings || hud.players || [];
  $('ovStandings').innerHTML = '<div class="stTitle">الترتيب النهائي</div>' + st.map((p, i) =>
    '<div class="stRow"><span class="stRank">' + (i + 1) + '</span>'
    + '<span class="chipDot" style="background:' + p.color + '"></span>'
    + '<b>' + escapeHtml(p.name) + '</b>'
    + '<span>⭐ ' + p.score + '</span><span>🪙 ' + p.coins + '</span><span>💀 ' + p.deaths + '</span></div>').join('');
  $('ovNext').hidden = (hud.level === '1-2');
  $('barPhase').textContent = '🏆 فاز ' + hud.winner.name + '!';
}

function showLobby() {
  $('lobby').hidden = false;
  $('game').hidden = true;
  $('overlay').hidden = true;
  started = false;
  $('barPhase').textContent = 'الردهة';
}
function showGame() {
  $('lobby').hidden = true;
  $('game').hidden = false;
  $('barCode').innerHTML = 'كود الغرفة: <b>' + code + '</b>';
  fitCanvas();
}

function onPhase(phase) {
  const ov = $('overlay');
  if (phase === 'win') {
    $('barPhase').textContent = '🏆 انتهى السباق!';
  } else if (phase === 'paused') {
    $('barPhase').textContent = 'متوقفة مؤقتاً';
  } else if (phase === 'playing') {
    ov.hidden = true;
    $('barPhase').textContent = 'تلعب الآن — المستوى ' + game.levelName;
  }
}

function doControl(action, lvl) {
  if (action === 'start') {
    if (!started) { started = true; showGame(); game.start(); }
    else if (game.phase === 'win') game.restart();
    else if (game.phase === 'paused') game.pauseToggle();
  } else if (action === 'pause') game.pauseToggle();
  else if (action === 'restart') { showGame(); game.restart(); }
  else if (action === 'level' && lvl) {
    level = lvl;
    document.querySelectorAll('.lvlBtn').forEach((b) => b.classList.toggle('on', b.id === (lvl === 'Level1-2' ? 'lvl12' : 'lvl11')));
    game.setLevel(lvl);
  } else if (action === 'lobby') { showLobby(); game.setPhase('lobby'); }
}

/* 4K: backing store = stage size × devicePixelRatio, capped at 3840×2160.
   The engine then renders the 640×480 logical view scaled up with
   imageSmoothingEnabled=false, so the pixel art stays crisp. */
function fitCanvas() {
  if (!game.ready) return;
  const stage = $('stage');
  const r = stage.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) return;
  const dpr = window.devicePixelRatio || 1;
  const s = Math.min(dpr, 3840 / r.width, 2160 / r.height);
  game.resize(Math.round(r.width * s), Math.round(r.height * s));
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    $('lobbyStatus').textContent = '✅ متصل بالخادم — بانتظار الهواتف…';
    ws.send(JSON.stringify({ t: 'create', role: 'tv', resume: code || undefined }));
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.t === 'created') {
      code = msg.code;
      sessionStorage.setItem('mario_room', code);
      $('codeRow').innerHTML = code.split('').map((d) => '<b>' + d + '</b>').join('');
      $('qr').src = '/qr?c=' + code;
      $('startBtn').disabled = false;
    } else if (msg.t === 'room') {
      const joined = msg.players || [];
      players = joined.length ? joined : [{ slot: 1, name: 'اللاعب 1' }];
      game.setPlayers(players);
      renderLobbySlots(joined);
      const n = joined.length;
      $('ctrlState').textContent = n ? '📱 ' + n + (n === 1 ? ' هاتف متصل' : ' هواتف متصلة') + ' — جاهز للعب' : '📵 لا يوجد هاتف متصل بعد';
      $('ctrlState').classList.toggle('on', n > 0);
      $('barCtrl').textContent = n ? '📱 ' + n + (n === 1 ? ' لاعب' : ' لاعبين') : '📵 هاتف غير متصل';
      applyInputs();
    } else if (msg.t === 'input') {
      phoneInputs[msg.player] = msg.input;
      applyInputs();
    } else if (msg.t === 'control') {
      doControl(msg.action, msg.level);
    } else if (msg.t === 'err') {
      $('lobbyStatus').textContent = '⚠️ ' + (msg.m || 'خطأ');
    }
  };
  ws.onclose = () => {
    $('lobbyStatus').textContent = '⚠️ انقطع الاتصال — أعيد المحاولة…';
    setTimeout(connect, 2000);
  };
}

/* local keyboard controls P1 only (also makes the game testable without a phone) */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', KeyH: 'left',
  ArrowRight: 'right', KeyD: 'right', KeyL: 'right',
  ArrowUp: 'jump', Space: 'jump', KeyK: 'jump', KeyW: 'jump',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') { doControl('pause'); return; }
  if (e.code === 'KeyR') { doControl('restart'); return; }
  if (e.code === 'Enter' && !started) { doControl('start'); return; }
  const k = KEYMAP[e.code];
  if (k) { keyInput[k] = true; applyInputs(); if (k === 'jump') e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keyInput[k] = false; applyInputs(); }
});
window.addEventListener('blur', () => { keyInput = { left: false, right: false, jump: false, boost: false }; applyInputs(); });

$('startBtn').addEventListener('click', () => doControl('start'));
$('pauseBtn').addEventListener('click', () => doControl('pause'));
$('restartBtn').addEventListener('click', () => doControl('restart'));
$('lobbyBtn').addEventListener('click', () => doControl('lobby'));
$('ovRestart').addEventListener('click', () => doControl('restart'));
$('ovLobby').addEventListener('click', () => doControl('lobby'));
$('ovNext').addEventListener('click', () => { doControl('level', 'Level1-2'); doControl('restart'); });
$('lvl11').addEventListener('click', () => doControl('level', 'Level1-1'));
$('lvl12').addEventListener('click', () => doControl('level', 'Level1-2'));

game.init().then(() => {
  renderLobbySlots([]);
  connect();
  fitCanvas();
  new ResizeObserver(() => fitCanvas()).observe($('stage'));
  window.addEventListener('resize', fitCanvas);
  (function loop() { game.frame(); requestAnimationFrame(loop); })();
  /* Fallback: headed browsers throttle requestAnimationFrame in a
     background tab, which would freeze the game while someone holds
     phone buttons in another tab. When hidden, tick at ~20/s instead. */
  setInterval(() => { if (document.hidden) game.frame(); }, 50);
});
