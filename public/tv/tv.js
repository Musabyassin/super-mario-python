'use strict';
/* TV page: owns the room, runs the game engine, receives held-input
   from the phone (via the server) and merges it with local keyboard. */
import { MarioGame } from '../shared/mario.js';

const $ = (id) => document.getElementById(id);
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

const canvas = $('cv');
const game = new MarioGame(canvas, {
  onPhase: (phase) => onPhase(phase),
  onHud: (hud) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hud', ...hud })); },
});
window.__mario = game; /* test hook: state inspection from headless tests */
window.__marioNet = { get code() { return code; }, get phoneInput() { return phoneInput; }, get keyInput() { return keyInput; } };

let ws = null, code = sessionStorage.getItem('mario_room') || '';
let phoneInput = { left: false, right: false, jump: false, boost: false };
let keyInput = { left: false, right: false, jump: false, boost: false };
let level = 'Level1-1';
let started = false;

function mergeInput() {
  game.setInput({
    left: phoneInput.left || keyInput.left,
    right: phoneInput.right || keyInput.right,
    jump: phoneInput.jump || keyInput.jump,
    boost: phoneInput.boost || keyInput.boost,
  });
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
}

function onPhase(phase) {
  const ov = $('overlay');
  if (phase === 'gameover') {
    ov.hidden = false;
    $('ovTitle').textContent = 'GAME OVER';
    $('ovSub').textContent = 'النقاط: ' + game.score + '  •  العملات: ' + game.coins;
    $('ovNext').hidden = true;
    $('barPhase').textContent = 'انتهت اللعبة';
  } else if (phase === 'win') {
    ov.hidden = false;
    $('ovTitle').textContent = '🎉 LEVEL COMPLETE!';
    $('ovSub').textContent = 'أنهيت المستوى ' + game.levelName + ' — النقاط: ' + game.score + '  •  العملات: ' + game.coins;
    $('ovNext').hidden = (game.levelName === '1-2');
    $('barPhase').textContent = 'أنهيت المستوى!';
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
    else if (game.phase === 'gameover' || game.phase === 'win') game.restart();
    else if (game.phase === 'paused') game.pauseToggle();
  } else if (action === 'pause') game.pauseToggle();
  else if (action === 'restart') { showGame(); game.restart(); }
  else if (action === 'level' && lvl) {
    level = lvl;
    document.querySelectorAll('.lvlBtn').forEach((b) => b.classList.toggle('on', b.id === (lvl === 'Level1-2' ? 'lvl12' : 'lvl11')));
    game.setLevel(lvl);
  } else if (action === 'lobby') { showLobby(); game.setPhase('lobby'); }
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    $('lobbyStatus').textContent = '✅ متصل بالخادم — بانتظار الهاتف…';
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
      const on = !!msg.controller;
      $('ctrlState').textContent = on ? '📱 الهاتف متصل — جاهز للعب' : '📵 لا يوجد هاتف متصل بعد';
      $('ctrlState').classList.toggle('on', on);
      $('barCtrl').textContent = on ? '📱 هاتف متصل' : '📵 هاتف غير متصل';
    } else if (msg.t === 'input') {
      phoneInput = msg.input;
      mergeInput();
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

/* local keyboard (also makes the game testable without a phone) */
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
  if (k) { keyInput[k] = true; mergeInput(); if (k === 'jump') e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keyInput[k] = false; mergeInput(); }
});
window.addEventListener('blur', () => { keyInput = { left: false, right: false, jump: false, boost: false }; mergeInput(); });

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
  connect();
  (function loop() { game.frame(); requestAnimationFrame(loop); })();
});
