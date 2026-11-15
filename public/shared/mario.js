'use strict';
/* ============================================================
   Super Mario — web engine (Canvas + vanilla JS)
   A faithful port of mx0c/super-mario-python (pygame):
   same level JSONs, same sprite sheets + sprite JSONs, same
   physics numbers (gravity 0.8, jump -12, go accel 0.4,
   maxVel 3.0 / boost 5.0), same camera, same enemies.
   The physics runs on the TV page; each phone sends its
   held-input state {left,right,jump,boost} via the server,
   tagged with its player slot (1–4). One Mario per player,
   sharing one world and one camera (leader). */
const TILE = 32, VIEW_W = 640, VIEW_H = 480;
/* ترتيب المراحل: 1-1 → … → 1-10. الفوز بمرحلة ينتقل تلقائياً للتالية
   بعد عدّ تنازلي 5 ثوانٍ؛ الفوز بـ 1-10 ينهي البطولة. */
export const LEVEL_ORDER = ['Level1-1', 'Level1-2', 'Level1-3', 'Level1-4', 'Level1-5',
  'Level1-6', 'Level1-7', 'Level1-8', 'Level1-9', 'Level1-10'];
export const COUNTDOWN_MS = 5000;
function displayName(file) {
  const m = /^Level1-(\d+)$/.exec(file);
  return m ? '1-' + m[1] : file;
}
/* ألوان اللاعبين الأربعة — نفسها في الخادم (server/server.js).
   اللاعب 1 أحمر كلاسيكي (بدون تلوين)، والباقون يُلوَّنون باستبدال
   أحمر ماريو (255,49,24) بلون اللاعب. */
export const PLAYER_COLORS = [
  { slot: 1, name: 'اللاعب 1', css: '#e52521', rgb: [229, 37, 33], tint: null },
  { slot: 2, name: 'اللاعب 2', css: '#22a447', rgb: [34, 164, 71], tint: [34, 164, 71] },
  { slot: 3, name: 'اللاعب 3', css: '#2f6df6', rgb: [47, 109, 246], tint: [47, 109, 246] },
  { slot: 4, name: 'اللاعب 4', css: '#f5b800', rgb: [245, 184, 0], tint: [245, 184, 0] },
];
/* استبدال بكسلات أحمر ماريو (255,49,24) بلون الهدف مع الحفاظ على
   التظليل النسبي. البني (198,99,0) والجلد (255,148,90) لا يطابقان
   الشرط (r-g>110 و g<=110) فيبقيان كما هما. */
function tintCanvas(src, target) {
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const refLum = 0.299 * 255 + 0.587 * 49 + 0.114 * 24;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r >= 190 && g <= 110 && b <= 90 && (r - g) > 110) {
      const f = (0.299 * r + 0.587 * g + 0.114 * b) / refLum;
      d[i] = Math.min(255, target[0] * f);
      d[i + 1] = Math.min(255, target[1] * f);
      d[i + 2] = Math.min(255, target[2] * f);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
const FONT_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cannot load ' + src));
    img.src = src;
  });
}
/* Cut one sprite out of a sheet, honouring the Python Spritesheet
   colorkey rules: -1 = colour of the top-left pixel of the cut,
   [r,g,b] = that colour, null = keep the sheet's own alpha. */
function cutSprite(sheet, sx, sy, sw, sh, scale, colorKey) {
  const tmp = document.createElement('canvas');
  tmp.width = sw; tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, sw, sh);
  let key = null;
  if (colorKey === -1 || (Array.isArray(colorKey) && colorKey.length === 3)) {
    const d = tctx.getImageData(0, 0, sw, sh).data;
    if (colorKey === -1) {
      if (d[3] > 0) key = [d[0], d[1], d[2]]; /* transparent sheet pixel: no keying */
    } else key = colorKey;
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  if (key) {
    const img = tctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === key[0] && d[i + 1] === key[1] && d[i + 2] === key[2]) d[i + 3] = 0;
    }
    tctx.putImageData(img, 0, 0);
  }
  octx.drawImage(tmp, 0, 0, out.width, out.height);
  return out;
}

class Sprites {
  constructor() { this.map = {}; this.tintedCache = {}; }
  /* نسخة ملوّنة من إطار ماريو للاعب slot (1 = الأصل بدون تلوين). */
  tinted(name, slot) {
    const entry = this.map[name];
    if (!entry || !entry.img) return null;
    if (!slot || slot <= 1) return entry.img;
    const key = name + ':' + slot;
    if (!this.tintedCache[key]) {
      this.tintedCache[key] = tintCanvas(entry.img, PLAYER_COLORS[slot - 1].tint);
    }
    return this.tintedCache[key];
  }
  async load() {
    const files = ['Mario.json', 'Goomba.json', 'Koopa.json', 'Animations.json',
      'BackgroundSprites.json', 'ItemAnimations.json', 'RedMushroom.json'];
    const sheets = {};
    const sheetFor = async (url) => {
      const name = url.split('/').pop();
      if (!sheets[name]) {
        const img = await loadImage('/assets/img/' + name);
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        sheets[name] = c;
      }
      return sheets[name];
    };
    for (const f of files) {
      const data = await (await fetch('/assets/sprites/' + f)).json();
      const sheet = await sheetFor(data.spriteSheetURL);
      if (data.type === 'background') {
        for (const s of data.sprites) {
          this.map[s.name] = {
            kind: 'static', redrawBg: !!s.redrawBg,
            img: cutSprite(sheet, s.x * 16, s.y * 16, 16, 16, s.scalefactor || 2, s.colorKey ?? null),
          };
        }
      } else if (data.type === 'animation') {
        for (const s of data.sprites) {
          this.map[s.name] = {
            kind: 'anim', deltaTime: s.deltaTime || 7,
            frames: s.images.map((im) => cutSprite(sheet, im.x * 16, im.y * 16, 16, 16, im.scale || 2, s.colorKey ?? null)),
          };
        }
      } else { /* character / item — NOTE: unlike background/animation
                  sprites, x/y here are PIXEL coords (Python passes
                  ignoreTileSize=True), not tile coords. */
        const tw = data.size ? data.size[0] : 16, th = data.size ? data.size[1] : 16;
        for (const s of data.sprites) {
          const w = s.xsize || tw, h = s.ysize || th;
          this.map[s.name] = {
            kind: 'static',
            img: cutSprite(sheet, s.x, s.y, w, h, s.scalefactor || 2, s.colorKey ?? null),
          };
        }
      }
    }
  }
  get(name) { return this.map[name]; }
}

class FontSprites {
  async load() {
    const img = await loadImage('/assets/img/font.png');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    this.chars = {};
    let row = 0, col = 0;
    for (const ch of FONT_CHARS) {
      if (col === 16) { col = 0; row += 1; }
      this.chars[ch] = cutSprite(c, col * 8, row * 8, 8, 8, 2, [0, 0, 0]);
      col += 1;
    }
  }
  draw(ctx, text, x, y, size) {
    for (const ch of String(text)) {
      const spr = this.chars[ch];
      if (spr) ctx.drawImage(spr, x, y, size, size);
      x += (ch === ' ' ? size / 2 : size);
    }
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

class Anim {
  constructor(frames, idle, air, deltaTime = 7) {
    this.frames = frames; this.idleSpr = idle; this.airSpr = air;
    this.deltaTime = deltaTime; this.timer = 0; this.index = 0;
    this.image = frames[0];
  }
  update() {
    this.timer += 1;
    if (this.timer % this.deltaTime === 0) this.index = (this.index + 1) % this.frames.length;
    this.image = this.frames[this.index];
  }
  idle() { if (this.idleSpr) this.image = this.idleSpr; }
  inAir() { if (this.airSpr) this.image = this.airSpr; }
}

/* One sound channel each for music + sfx, like the Python Sound class. */
class SoundBank {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.files = {
      soundtrack: 'main_theme.ogg', coin: 'coin.ogg', bump: 'bump.ogg',
      stomp: 'stomp.ogg', jump: 'small_jump.ogg', death: 'death.wav',
      kick: 'kick.ogg', brick_bump: 'brick-bump.ogg', powerup: 'powerup.ogg',
      powerup_appear: 'powerup_appears.ogg', pipe: 'pipe.ogg',
    };
    this.cache = {};
    this.music = null;
  }
  _audio(name) {
    if (!this.cache[name]) {
      const a = new Audio('/assets/sfx/' + this.files[name]);
      a.volume = 0.2;
      this.cache[name] = a;
    }
    return this.cache[name];
  }
  play(name) {
    if (!this.enabled) return;
    try { const a = this._audio(name); a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
  }
  startMusic() {
    if (!this.enabled) return;
    try {
      if (!this.music) { this.music = this._audio('soundtrack'); this.music.loop = true; }
      this.music.play().catch(() => {});
    } catch (e) {}
  }
  stopMusic() { try { if (this.music) this.music.pause(); } catch (e) {} }
}

export class MarioGame {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.onPhase = opts.onPhase || (() => {});
    this.onHud = opts.onHud || (() => {});
    this.sound = new SoundBank(opts.sound !== false);
    this.sprites = new Sprites();
    this.font = new FontSprites();
    this.ready = false;
    this.phase = 'lobby'; /* lobby | playing | paused | win */
    this.levelName = '1-1';
    this.levelFile = 'Level1-1';
    this.players = []; /* one Mario object per joined player (slot 1..4) */
    this.mario = null; /* alias: players[0] (keyboard / P1) */
    this.winner = null;
    this.standings = null;
    this.confetti = [];
    /* البطولة التراكمية: totals[slot][levelName] = نقاط تلك المرحلة
       عند الفوز بها (تُستبدل عند إعادة الفوز بنفس المرحلة فلا ازدواج).
       تُصفَّر فقط عند بدء جولة جديدة من الردهة؛ تحميل مرحلة يصفّر
       نقاط المرحلة الحالية فقط ولا يمسّ totals أبداً. */
    this.totals = {};
    /* الانتقال التلقائي: المرحلة التالية + موعدها بساعة الحائط
       (Date.now) فيتحرك العدّ حتى لو كان تبويب التلفاز في الخلفية. */
    this.nextLevel = null; this.nextLevelName = null; this.nextAt = 0;
    this.isFinal = false; /* true عندما يكون الفوز الحالي بآخر مرحلة */
    this.champion = null;
    this._lastHudPush = 0;
    /* 4K: backing-store scale + logical view width (view height stays 480).
       resize() sets them from the real canvas size; defaults = 640×480. */
    this.scale = 1;
    this.viewW = VIEW_W;
    this.time = 0; this.ticks = 0;
    this.hudTimer = 0;
  }

  /* ضبط دقة العرض: backing store بعرض/ارتفاع حقيقيين، والعرض المنطقي
     يتسع مع الشاشات العريضة (نرى بلاطات أكثر أفقياً بدل التمديد). */
  resize(backingW, backingH) {
    this.canvas.width = Math.max(320, Math.round(backingW));
    this.canvas.height = Math.max(240, Math.round(backingH));
    this.scale = this.canvas.height / VIEW_H;
    this.viewW = this.canvas.width / this.scale;
    this.draw();
  }

  async init() {
    await this.sprites.load();
    await this.font.load();
    await this.loadLevel('Level1-1');
    this.ready = true;
    this.draw();
  }

  /* ---------- level loading (mirrors classes/Level.py) ---------- */
  loadLevel(name) {
    return fetch('/assets/levels/' + name + '.json').then((r) => r.json()).then((data) => {
      this.levelFile = name;
      this.levelName = displayName(name);
      this.levelLength = data.length;
      const S = this.sprites;
      /* grid[y][x]: {spr, rect|null, redraw} — 15 rows x levelLength cols */
      const grid = [];
      for (let y = 0; y < 15; y++) {
        const row = [];
        for (let x = 0; x < this.levelLength; x++) {
          if (y < 13) row.push({ spr: 'sky', rect: null, redraw: false });
          else row.push({ spr: 'ground', rect: { x: x * TILE, y: y * TILE, w: TILE, h: TILE }, redraw: false });
        }
        grid.push(row);
      }
      this.grid = grid;
      this.entities = [];
      this.floaters = [];
      this.fx = [];
      const put = (x, y, spr, rect, redraw = false) => {
        if (grid[y] && grid[y][x] !== undefined) grid[y][x] = { spr, rect, redraw };
      };
      const objs = data.level.objects || {};
      for (const [x, y] of (objs.sky || [])) put(x, y, 'sky', null);
      for (const [x, y] of (objs.ground || [])) put(x, y, 'ground', { x: x * TILE, y: y * TILE, w: TILE, h: TILE });
      for (const [x, y] of (objs.bush || [])) {
        put(x, y, 'bush_1', null, true); put(x + 1, y, 'bush_2', null, true); put(x + 2, y, 'bush_3', null, true);
      }
      for (const [x, y] of (objs.cloud || [])) {
        put(x, y, 'cloud1_1', null, true); put(x + 1, y, 'cloud1_2', null, true); put(x + 2, y, 'cloud1_3', null, true);
        put(x, y + 1, 'cloud2_1', null, true); put(x + 1, y + 1, 'cloud2_2', null, true); put(x + 2, y + 1, 'cloud2_3', null, true);
      }
      for (const [x, y, z] of (objs.pipe || [])) {
        put(x, y, 'pipeL', { x: x * TILE, y: y * TILE, w: TILE, h: TILE });
        put(x + 1, y, 'pipeR', { x: (x + 1) * TILE, y: y * TILE, w: TILE, h: TILE });
        for (let i = 1; i < z + 20; i++) {
          if (y + i >= 15) break;
          put(x, y + i, 'pipe2L', { x: x * TILE, y: (y + i) * TILE, w: TILE, h: TILE }, true);
          put(x + 1, y + i, 'pipe2R', { x: (x + 1) * TILE, y: (y + i) * TILE, w: TILE, h: TILE }, true);
        }
      }
      const ents = data.level.entities || {};
      /* NOTE: entity coords follow the Python code exactly, including its
         swapped x/y in Goomba/Koopa/RedMushroom constructors. */
      for (const [x, y] of (ents.CoinBox || [])) this._addBlock(x, y, 'coinbox');
      for (const [x, y] of (ents.coinBrick || [])) this._addBlock(x, y, 'coinbrick');
      for (const [x, y, item] of (ents.RandomBox || [])) this._addBlock(x, y, 'randombox', item);
      for (const [x, y] of (ents.coin || [])) {
        this.entities.push({ type: 'coin', rect: { x: x * TILE, y: y * TILE, w: TILE, h: TILE }, alive: true, anim: new Anim(S.get('coin').frames, null, null, S.get('coin').deltaTime) });
      }
      for (const [a, b] of (ents.Goomba || [])) this._addGoomba(b * TILE, (a - 1) * TILE);
      for (const [a, b] of (ents.Koopa || [])) this._addKoopa((b - 1) * TILE, a * TILE);
      /* قائمة اللاعبين محفوظة عبر إعادة تحميل المستوى (إعادة اللعب):
         كل لاعب يعود للبداية بنقاط صفر. */
      const roster = (this.players && this.players.length)
        ? this.players.map((p) => ({ slot: p.slot, name: p.name }))
        : [{ slot: 1, name: PLAYER_COLORS[0].name }];
      this.players = roster.map((r) => this._spawnMario(r.slot, r.name));
      this.mario = this.players[0];
      this.winner = null; this.standings = null; this.confetti = [];
      this.champion = null; this.isFinal = false;
      this.nextLevel = null; this.nextLevelName = null; this.nextAt = 0;
      this.time = 0; this.ticks = 0;
      this.camX = 0; this.camPosX = 0;
    });
  }

  /* مزامنة قائمة اللاعبين مع الغرفة: انضمام يضيف ماريو (عند الكاميرا
     إذا كانت اللعبة جارية)، ومغادرة تحذف ماريو ذلك اللاعب. */
  setPlayers(list) {
    const want = (list && list.length) ? list : [{ slot: 1, name: PLAYER_COLORS[0].name }];
    const keep = new Set(want.map((p) => p.slot));
    this.players = this.players.filter((p) => keep.has(p.slot));
    for (const info of want) {
      let p = this.players.find((x) => x.slot === info.slot);
      if (!p) {
        p = this._spawnMario(info.slot, info.name || PLAYER_COLORS[info.slot - 1].name);
        if (this.phase === 'playing' || this.phase === 'paused') this._respawnPlayer(p);
        this.players.push(p);
      } else {
        p.name = info.name || p.name;
      }
    }
    this.players.sort((a, b) => a.slot - b.slot);
    this.mario = this.players[0];
    this.pushHud();
  }
  setPlayerInput(slot, inp) {
    const p = this.players.find((x) => x.slot === slot);
    if (p) p.nextInput = { left: !!inp.left, right: !!inp.right, jump: !!inp.jump, boost: !!inp.boost };
  }
  /* إعادة ظهور لاعب عند الكاميرا (بعد موت أو تأخر) مع حصانة ثانيتين. */
  _respawnPlayer(p) {
    p.rect.x = Math.max(0, -this.camX + (2 + (p.slot - 1)) * TILE);
    p.rect.y = 0;
    p.vel.x = 0; p.vel.y = 0;
    p.invincibility = 120;
    p.respawnIn = 0;
    p.onGround = false; p.inAir = true; p.obeyGravity = true; p.inJump = false;
  }
  /* موت لاعب (حفرة أو عدو): يختفي 1.5 ثانية ثم يعود عند الكاميرا. */
  _killPlayer(p) {
    if (p.respawnIn > 0) return;
    p.deaths += 1;
    p.respawnIn = 90;
    p.vel.x = 0; p.vel.y = 0;
    if (p.power === 1) {
      p.power = 0; p.go.anim = p.smallAnim;
      p.rect = { x: p.rect.x, y: p.rect.y + TILE, w: TILE, h: TILE };
    }
    this.sound.play('death');
  }

  _addBlock(x, y, kind, item) {
    this.grid[y][x] = { spr: null, rect: { x: x * TILE, y: y * TILE - 1, w: TILE, h: TILE }, redraw: false, block: kind };
    const S = this.sprites;
    const ent = {
      type: kind, rect: { x: x * TILE, y: y * TILE, w: TILE, h: TILE },
      alive: true, triggered: false, time: 0, maxTime: 10, vel: 1, item: item || null,
      anim: new Anim(S.get('CoinBox').frames, null, null, S.get('CoinBox').deltaTime),
      fxDone: false,
    };
    if (kind === 'coinbrick') ent.img = S.get('bricks').img;
    this.entities.push(ent);
  }
  _addGoomba(x, y) {
    const S = this.sprites;
    this.entities.push({
      type: 'goomba', rect: { x, y, w: TILE, h: TILE }, vel: { x: 0, y: 0 }, gravity: 1.25,
      alive: true, active: true, bouncing: false, timer: 0, timeAfterDeath: 5, onGround: false,
      dir: Math.random() < 0.5 ? -1 : 1, speed: 1,
      anim: new Anim([S.get('goomba-1').img, S.get('goomba-2').img]),
      textPos: { x: 0, y: 0 },
    });
  }
  _addKoopa(x, y) {
    const S = this.sprites;
    this.entities.push({
      type: 'koopa', rect: { x, y, w: TILE, h: TILE }, vel: { x: 0, y: 0 }, gravity: 1.25,
      alive: true, active: true, bouncing: false, timer: 0, timeAfterDeath: 35, onGround: false,
      dir: Math.random() < 0.5 ? -1 : 1, speed: 1,
      anim: new Anim([S.get('koopa-1').img, S.get('koopa-2').img]),
    });
  }
  _addMushroom(x, y) {
    const S = this.sprites;
    this.entities.push({
      type: 'mushroom', rect: { x, y, w: TILE, h: TILE }, vel: { x: 0, y: 0 }, gravity: 1.25,
      alive: true, active: true, bouncing: false, timer: 0, timeAfterDeath: 5, onGround: false,
      dir: Math.random() < 0.5 ? -1 : 1, speed: 1,
      anim: new Anim([S.get('mushroom').img]), textPos: { x: 0, y: 0 },
    });
  }

  _spawnMario(slot, name) {
    const S = this.sprites;
    const fr = (n) => S.tinted(n, slot);
    const small = new Anim([fr('mario_run1'), fr('mario_run2'), fr('mario_run3')], fr('mario_idle'), fr('mario_jump'), 7);
    const big = new Anim([fr('mario_big_run1'), fr('mario_big_run2'), fr('mario_big_run3')], fr('mario_big_idle'), fr('mario_big_jump'), 7);
    return {
      slot, name: name || PLAYER_COLORS[slot - 1].name,
      color: PLAYER_COLORS[slot - 1].css,
      rect: { x: (slot - 1) * TILE, y: 0, w: TILE, h: TILE }, vel: { x: 0, y: 0 }, gravity: 0.8,
      onGround: false, obeyGravity: true, inAir: false, inJump: false,
      power: 0, invincibility: 0, restart: false, pause: false,
      go: { direction: 0, heading: 1, accelVel: 0.4, decelVel: 0.25, maxVel: 3.0, boost: false, anim: small },
      jump: { verticalSpeed: -12, jumpHeight: 120, initialHeight: 384, deaccelHeight: 120 - (12 * 12) / (2 * 0.8) },
      bounce: { vel: 5, jump: false },
      smallAnim: small, bigAnim: big,
      score: 0, coins: 0, deaths: 0, respawnIn: 0,
      input: { left: false, right: false, jump: false, boost: false },
      nextInput: { left: false, right: false, jump: false, boost: false },
    };
  }

  setPhase(p, info) {
    this.phase = p;
    this.onPhase(p, info || {});
    this.pushHud();
  }
  start() {
    if (!this.ready) return;
    this.sound.startMusic();
    this.setPhase('playing');
  }
  /* بدء جولة جديدة من الردهة: تُصفَّر نقاط البطولة. */
  startFresh() { this.resetTotals(); this.start(); }
  resetTotals() { this.totals = {}; this.pushHud(); }
  totalFor(slot) {
    const t = this.totals[slot];
    return t ? Object.values(t).reduce((a, b) => a + b, 0) : 0;
  }
  pauseToggle() {
    if (this.phase === 'playing') { this.setPhase('paused'); this.sound.stopMusic(); }
    else if (this.phase === 'paused') { this.setPhase('playing'); this.sound.startMusic(); }
  }
  /* إعادة المرحلة الحالية بنقاط مرحلة صفر؛ نقاط البطولة للمراحل
     المكتملة تبقى. على شاشة البطل (الفوز بـ 1-10) يعيد الجولة
     كلها من 1-1 بنقاط بطولة صفر. */
  restart() {
    if (this.phase === 'win' && this.isFinal) return this.restartRun();
    this.loadLevel(this.levelFile).then(() => { this.sound.startMusic(); this.setPhase('playing'); });
  }
  restartRun() {
    this.resetTotals();
    this.loadLevel('Level1-1').then(() => { this.sound.startMusic(); this.setPhase('playing'); });
  }
  /* الانتقال للمرحلة التالية (تلقائياً بعد العدّ أو بتخطي زر «التالي»).
     لا يفعل شيئاً إن لم تكن هناك مرحلة تالية. */
  advanceLevel() {
    if (!this.nextLevel) return false;
    const next = this.nextLevel;
    this.nextLevel = null; this.nextLevelName = null; this.nextAt = 0;
    this.loadLevel(next).then(() => { this.sound.startMusic(); this.setPhase('playing'); });
    return true;
  }
  setLevel(name) { this.resetTotals(); this.loadLevel(name).then(() => { this.draw(); }); }
  setInput(inp) { this.setPlayerInput(1, inp); } /* توافقية: لوحة المفاتيح = اللاعب 1 */

  pushHud() {
    const players = this.players.map((p) => ({
      slot: p.slot, name: p.name, color: p.color,
      score: p.score, coins: p.coins, deaths: p.deaths,
      total: this.totalFor(p.slot),
      progress: Math.max(0, Math.min(1, p.rect.x / (57 * TILE))),
    }));
    this.onHud({
      phase: this.phase, level: this.levelName, time: this.time,
      players,
      winner: this.winner ? { slot: this.winner.slot, name: this.winner.name, color: this.winner.color } : null,
      standings: this.standings,
      /* الانتقال التلقائي: ثوانٍ متبقية واسم المرحلة التالية (null في النهاية) */
      nextIn: this.nextLevel ? Math.max(0, Math.ceil((this.nextAt - Date.now()) / 1000)) : 0,
      nextLevel: this.nextLevelName,
      isFinal: this.isFinal,
      champion: this.champion,
      /* حقول قديمة للتوافقية (اللاعب 1) */
      score: this.mario ? this.mario.score : 0,
      coins: this.mario ? this.mario.coins : 0,
    });
  }

  /* ---------- tile collision (mirrors classes/Collider.py) ---------- */
  _tileAt(tx, ty) {
    if (ty < 0 || ty >= 15 || tx < 0 || tx >= this.levelLength) return null;
    return this.grid[ty][tx];
  }
  _checkX(ent) {
    if (ent.rect.x < 0) { ent.rect.x = 0; ent.vel.x = 0; return; }
    if (ent.rect.x / TILE > this.levelLength - 1) { ent.rect.x = (this.levelLength - 1) * TILE; ent.vel.x = 0; return; }
    const py = Math.floor(ent.rect.y / TILE), px = Math.floor(ent.rect.x / TILE);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const t = this._tileAt(px + c, py + r);
        if (t && t.rect && rectsOverlap(ent.rect, t.rect)) {
          if (ent.vel.x > 0) { ent.rect.x = t.rect.x - ent.rect.w; ent.vel.x = 0; }
          if (ent.vel.x < 0) { ent.rect.x = t.rect.x + t.rect.w; ent.vel.x = 0; }
        }
      }
    }
  }
  _checkY(ent, isMario) {
    ent.onGround = false;
    const py = Math.floor(ent.rect.y / TILE), px = Math.floor(ent.rect.x / TILE);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const t = this._tileAt(px + c, py + r);
        if (t && t.rect && rectsOverlap(ent.rect, t.rect)) {
          if (ent.vel.y > 0) {
            ent.onGround = true;
            ent.rect.y = t.rect.y - ent.rect.h;
            ent.vel.y = 0;
            if (isMario) { ent.inAir = false; ent.inJump = false; }
          } else if (ent.vel.y < 0) {
            ent.rect.y = t.rect.y + t.rect.h;
            ent.vel.y = 0;
          }
        }
      }
    }
  }

  /* ---------- Mario traits (mirrors traits/go.py, jump.py, bounce.py) ---------- */
  _goUpdate(m) {
    const g = m.go;
    if (g.boost) { g.maxVel = 5.0; g.anim.deltaTime = 4; }
    else {
      g.anim.deltaTime = 7;
      if (Math.abs(m.vel.x) > 3.2) m.vel.x = 3.2 * g.heading;
      g.maxVel = 3.2;
    }
    if (g.direction !== 0) {
      g.heading = g.direction;
      if (g.heading === 1) { if (m.vel.x < g.maxVel) m.vel.x += g.accelVel * g.heading; }
      else if (m.vel.x > -g.maxVel) m.vel.x += g.accelVel * g.heading;
      if (!m.inAir) g.anim.update(); else g.anim.inAir();
    } else {
      g.anim.update();
      m.vel.x += (m.vel.x >= 0 ? -g.decelVel : g.decelVel);
      if (Math.trunc(m.vel.x) === 0) {
        m.vel.x = 0;
        if (m.inAir) g.anim.inAir(); else g.anim.idle();
      }
    }
  }
  _jumpCall(m, jumping) {
    const j = m.jump;
    if (jumping) {
      if (m.onGround) {
        this.sound.play('jump');
        m.vel.y = j.verticalSpeed;
        m.inAir = true;
        j.initialHeight = m.rect.y;
        m.inJump = true;
        m.obeyGravity = false; /* always reach maximum height */
      }
    }
    if (m.inJump) {
      if ((j.initialHeight - m.rect.y) >= j.deaccelHeight || m.vel.y === 0) {
        m.inJump = false;
        m.obeyGravity = true;
      }
    }
  }

  /* ---------- per-frame update ---------- */
  frame() {
    if (!this.ready) return;
    if (this.phase === 'playing') {
      this._updatePlaying();
      this.ticks += 1;
      if (this.ticks >= 60) { this.ticks = 0; this.time += 1; }
      this.hudTimer += 1;
      if (this.hudTimer >= 30) { this.hudTimer = 0; this.pushHud(); }
    } else if (this.phase === 'win') {
      this._updateConfetti();
      /* العدّ التنازلي بساعة الحائط فيتقدّم حتى في تبويب مخفيّ
         (فاصل الـ 50ms يستدعي frame() هناك)، والـ HUD يُدفع كل
         ~نصف ثانية فيرى التلفاز والهواتف العدّ يتكتك 5←1. */
      if (this.nextLevel && Date.now() >= this.nextAt) this.advanceLevel();
      if (Date.now() - this._lastHudPush >= 500) { this._lastHudPush = Date.now(); this.pushHud(); }
    }
    this.draw();
  }

  _updatePlaying() {
    /* كل لاعب يتحرك ويقفز ويموت ويعود بمفرده؛ العالم والأعداء مشتركون. */
    for (const p of this.players) {
      if (p.respawnIn > 0) {
        p.respawnIn -= 1;
        if (p.respawnIn === 0) this._respawnPlayer(p);
        continue;
      }
      if (p.invincibility > 0) p.invincibility -= 1;
      /* traits use last frame's input (like the Python loop) */
      this._goUpdate(p);
      if (p.bounce.jump) { p.vel.y = 0; p.vel.y -= p.bounce.vel; p.bounce.jump = false; p.inAir = true; }
      /* move */
      p.rect.y += p.vel.y; this._checkY(p, true);
      p.rect.x += p.vel.x; this._checkX(p);
      /* gravity */
      if (p.obeyGravity) p.vel.y += p.gravity;
      /* fell into a pit? -> respawn (no game over in party mode) */
      if (p.rect.y > VIEW_H + TILE) { this._killPlayer(p); continue; }
      /* reached the flag? first player there wins the round */
      if (p.rect.x >= 57 * TILE) { this._win(p); return; }
      /* entity collisions (coins/blocks/enemies, scored for this player) */
      this._marioEntityCollisions(p);
      /* input sampled at end of frame, applied next frame (Python order) */
      p.input = { ...p.nextInput };
      p.go.direction = p.input.left ? -1 : p.input.right ? 1 : 0;
      p.go.boost = p.input.boost;
      this._jumpCall(p, p.input.jump);
    }
    /* camera follows the leading alive player (same rule as before:
       scrolls only while the leader is between tiles 10..50) */
    const alive = this.players.filter((p) => p.respawnIn === 0);
    if (alive.length) {
      const lead = alive.reduce((a, b) => (b.rect.x > a.rect.x ? b : a));
      const tileX = lead.rect.x / TILE;
      if (tileX > 10 && tileX < 50) this.camPosX = -tileX + 10;
    }
    this.camX = this.camPosX * TILE;
    /* a player who fell behind the left edge respawns at the camera */
    for (const p of alive) {
      if (p.rect.x + this.camX + TILE < 0) this._respawnPlayer(p);
    }
    /* entities (shared world) */
    this._updateEntities();
  }

  _win(winner) {
    winner.score += Math.max(0, 100 - this.time) * 10;
    /* سجّل نقاط هذه المرحلة في البطولة (استبدال لا إضافة، فإعادة
       الفوز بنفس المرحلة لا تضاعف النقاط). */
    for (const p of this.players) {
      if (!this.totals[p.slot]) this.totals[p.slot] = {};
      this.totals[p.slot][this.levelName] = p.score;
    }
    this.winner = winner;
    const rows = this.players.map((p) => ({
      slot: p.slot, name: p.name, color: p.color, score: p.score,
      coins: p.coins, deaths: p.deaths, total: this.totalFor(p.slot),
      progress: Math.max(0, Math.min(1, p.rect.x / (57 * TILE))),
    }));
    const idx = LEVEL_ORDER.indexOf(this.levelFile);
    this.isFinal = idx === LEVEL_ORDER.length - 1;
    if (this.isFinal) {
      /* شاشة البطل: الترتيب بالمجموع التراكمي، والبطل أوله. */
      this.standings = rows.sort((a, b) => (b.total - a.total) || (b.score - a.score));
      const c = this.standings[0];
      this.champion = c ? { slot: c.slot, name: c.name, color: c.color, total: c.total } : null;
      this.nextLevel = null; this.nextLevelName = null; this.nextAt = 0;
    } else {
      /* فوز مرحلة عادية: الترتيب بالتقدّم (الفائز أولاً) مع عرض المجموع. */
      this.standings = rows.sort((a, b) => (b.progress - a.progress) || (b.score - a.score));
      this.champion = null;
      const next = LEVEL_ORDER[idx + 1] || null;
      this.nextLevel = next;
      this.nextLevelName = next ? displayName(next) : null;
      this.nextAt = next ? Date.now() + COUNTDOWN_MS : 0;
    }
    this.sound.play('powerup');
    this.sound.stopMusic();
    this._spawnConfetti();
    this.setPhase('win', { winner, standings: this.standings });
  }
  _spawnConfetti() {
    const colors = ['#e52521', '#fbd000', '#22a447', '#2f6df6', '#ff7ad9', '#ffffff'];
    this.confetti = [];
    for (let i = 0; i < 180; i++) {
      this.confetti.push({
        x: Math.random() * this.viewW, y: -20 - Math.random() * 140,
        vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2.5,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
        color: colors[i % colors.length], life: 0,
      });
    }
  }
  _updateConfetti() {
    for (const c of this.confetti) {
      c.x += c.vx; c.y += c.vy;
      c.vy = Math.min(4, c.vy + 0.03);
      c.rot += c.vr; c.life += 1;
    }
    this.confetti = this.confetti.filter((c) => c.y < VIEW_H + 20 && c.life < 900);
    if (this.phase === 'win' && this.confetti.length < 40) this._spawnConfetti();
  }

  _marioEntityCollisions(m) {
    for (const ent of this.entities) {
      if (!ent.alive) continue;
      if (!rectsOverlap(m.rect, ent.rect)) continue;
      const isTop = m.vel.y > 0 && (m.rect.y + m.rect.h - ent.rect.y) < 18;
      if (ent.type === 'coin') {
        ent.alive = false;
        m.score += 100; m.coins += 1;
        this.sound.play('coin');
      } else if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        if (!ent.triggered) {
          ent.triggered = true;
          ent.triggeredBy = m.slot;
          m.coins += 1;
          this.sound.play('bump');
          if (ent.type === 'randombox' && ent.item === 'RedMushroom') {
            this._addMushroom(ent.rect.x, ent.rect.y - 2 * TILE);
            this.sound.play('powerup_appear');
          }
        }
      } else if (ent.type === 'mushroom') {
        if (ent.alive) {
          this._powerup(m);
          this._killEntity(ent, m);
          this.sound.play('powerup');
        }
      } else if (ent.type === 'goomba' || ent.type === 'koopa') {
        if (isTop && (ent.alive || ent.bouncing)) {
          this.sound.play('stomp');
          m.rect.y = ent.rect.y - m.rect.h;
          m.bounce.jump = true;
          this._killEntity(ent, m);
        } else if (ent.alive && !ent.active && !ent.bouncing) {
          /* stomped shell lying still: kick it */
          ent.bouncing = true;
          if (m.rect.x < ent.rect.x) { ent.dir = 1; ent.rect.x += 5; }
          else { ent.dir = -1; ent.rect.x -= 5; }
          this.sound.play('kick');
        } else if (ent.alive && !m.invincibility) {
          if (m.power === 0) { this._killPlayer(m); return; }
          m.power = 0;
          m.go.anim = m.smallAnim;
          const { x, y } = m.rect;
          m.rect = { x, y: y + TILE, w: TILE, h: TILE };
          m.invincibility = 60;
          this.sound.play('pipe');
        }
      }
    }
  }

  _powerup(m) {
    if (m.power === 0) {
      m.power = 1;
      m.go.anim = m.bigAnim;
      const { x, y } = m.rect;
      m.rect = { x, y: y - TILE, w: TILE, h: TILE * 2 };
      m.invincibility = 20;
    }
  }
  _killEntity(ent, p) {
    if (ent.type === 'koopa') {
      ent.timer = 0; ent.speed = 1; ent.alive = true; ent.active = false; ent.bouncing = false;
    } else {
      ent.alive = false;
      ent.timer = 0;
      ent.textPos = { x: ent.rect.x + 3, y: ent.rect.y };
    }
    if (p) p.score += 100;
  }

  _updateEntities() {
    for (const ent of this.entities) {
      if (ent.type === 'coin') { if (ent.alive) ent.anim.update(); continue; }
      if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        if (ent.alive && !ent.triggered) ent.anim.update();
        else {
          if (!ent.fxDone) {
            ent.fxDone = true;
            const pl = this.players.find((p) => p.slot === ent.triggeredBy);
            if (pl) pl.score += 100;
            this.sound.play('coin');
            this.fx.push({ x: ent.rect.x, y: ent.rect.y, timer: 0, kind: 'coin' });
          }
          if (ent.time < ent.maxTime) { ent.time += 1; ent.rect.y -= ent.vel; }
          else if (ent.time < ent.maxTime * 2) { ent.time += 1; ent.rect.y += ent.vel; }
        }
        continue;
      }
      if (ent.type === 'goomba' || ent.type === 'koopa' || ent.type === 'mushroom') {
        if (ent.alive && ent.active && !ent.bouncing) {
          ent.vel.y += ent.gravity;
          this._walkUpdate(ent);
          ent.anim.update();
          this._mobVsMob(ent);
        } else if (ent.alive && !ent.active && !ent.bouncing) {
          /* sleeping in shell */
          ent.timer += 0.1;
          if (ent.timer >= ent.timeAfterDeath) { ent.alive = true; ent.active = true; ent.bouncing = false; ent.timer = 0; }
        } else if (ent.bouncing) {
          ent.speed = 4;
          ent.vel.y += ent.gravity;
          this._walkUpdate(ent);
          this._mobVsMob(ent);
        } else if (!ent.alive) {
          /* dead: flat goomba / floating "100" for a while, then remove */
          ent.timer += 0.1;
          if (ent.textPos) ent.textPos.y -= 0.5;
          if (ent.timer >= ent.timeAfterDeath) ent.alive = null;
        }
      }
    }
    this.entities = this.entities.filter((e) => e.alive !== null);
    /* coin pop-up fx + floating score text */
    for (const f of this.fx) f.timer += 1;
    this.fx = this.fx.filter((f) => f.timer < 80);
    for (const f of this.floaters) { f.y -= 0.5; f.timer += 1; }
    this.floaters = this.floaters.filter((f) => f.timer < 50);
  }
  _walkUpdate(ent) {
    if (ent.vel.x === 0) ent.dir *= -1;
    ent.vel.x = ent.speed * ent.dir;
    ent.rect.y += ent.vel.y; this._checkY(ent, false);
    ent.rect.x += ent.vel.x; this._checkX(ent);
  }
  _mobVsMob(ent) {
    for (const other of this.entities) {
      if (other === ent || other.type === 'coin' || other.type === 'coinbox' || other.type === 'coinbrick' || other.type === 'randombox') continue;
      if (other.bouncing && rectsOverlap(ent.rect, other.rect)) {
        ent.alive = false; ent.timer = 0;
        this.sound.play('brick_bump');
      }
    }
  }

  /* ---------- drawing ---------- */
  draw() {
    const ctx = this.ctx;
    const scale = this.scale || 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    /* خلفية السماء: لون بلاطة السماء الأصلية تماماً (99,173,255) —
       فلا حاجة لرسم بلاطات 'sky' واحدة واحدة كل إطار (أداء 4K). */
    ctx.fillStyle = '#63adff';
    ctx.fillRect(0, 0, this.viewW, VIEW_H);
    if (!this.ready || !this.grid) return;
    const S = this.sprites;
    const camX = this.camX || 0;
    const x0 = Math.max(0, Math.floor(-camX / TILE) - 1);
    const x1 = Math.min(this.levelLength - 1, x0 + Math.ceil(this.viewW / TILE) + 1);
    for (let y = 0; y < 15; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = this.grid[y][x];
        if (!t.spr || t.spr === 'sky') continue; /* السماء هي لون الخلفية */
        const spr = S.get(t.spr);
        if (!spr || !spr.img) continue;
        const dx = Math.round((x * TILE) + camX), dy = y * TILE;
        ctx.drawImage(spr.img, dx, dy);
      }
    }
    /* entities */
    for (const ent of this.entities) {
      if (ent.alive === null) continue;
      const dx = Math.round(ent.rect.x + camX);
      if (dx < -64 || dx > this.viewW + 64) continue;
      if (ent.type === 'coin') {
        if (ent.alive) ctx.drawImage(ent.anim.image, dx, ent.rect.y);
      } else if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        if (ent.triggered) ctx.drawImage(S.get('empty').img, dx, ent.rect.y - 1);
        else if (ent.type === 'coinbrick') ctx.drawImage(ent.img, dx, ent.rect.y - 1);
        else ctx.drawImage(ent.anim.image, dx, ent.rect.y - 1);
      } else if (ent.type === 'goomba') {
        if (ent.alive) ctx.drawImage(ent.anim.image, dx, ent.rect.y);
        else {
          ctx.drawImage(S.get('goomba-flat').img, dx, ent.rect.y);
          if (ent.textPos) this.font.draw(ctx, '100', Math.round(ent.textPos.x + camX), Math.round(ent.textPos.y), 8);
        }
      } else if (ent.type === 'koopa') {
        if (ent.alive && ent.active && !ent.bouncing) {
          const img = ent.anim.image;
          if (ent.dir === -1) ctx.drawImage(img, dx, ent.rect.y - TILE);
          else { ctx.save(); ctx.translate(dx + 34, ent.rect.y - TILE); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore(); }
        } else {
          ctx.drawImage(S.get('koopa-hiding').img, dx, ent.rect.y - TILE);
        }
      } else if (ent.type === 'mushroom') {
        if (ent.alive) ctx.drawImage(ent.anim.image, dx, ent.rect.y);
        else if (ent.textPos) this.font.draw(ctx, '100', Math.round(ent.textPos.x + camX), Math.round(ent.textPos.y), 8);
      }
    }
    /* coin pop-up fx */
    for (const f of this.fx) {
      const anim = S.get('coin-item');
      const frame = anim.frames[Math.floor(f.timer / anim.deltaTime) % anim.frames.length];
      const dx = Math.round(f.x + camX);
      let y = f.y;
      if (f.timer < 45) y = f.y - Math.min(f.timer, 15) * 4 + Math.max(0, f.timer - 15) * 2;
      if (f.timer < 45) ctx.drawImage(frame, dx, Math.round(y));
      else if (f.timer < 80) this.font.draw(ctx, '100', dx + 3, Math.round(y - (f.timer - 45)), 8);
    }
    /* Players (one Mario each — tinted per slot, name tag in party mode) */
    const showTags = this.players.length > 1;
    for (const p of this.players) {
      if (p.respawnIn > 0) continue;
      if (p.invincibility === 0 || Math.floor(p.invincibility / 2) % 2 === 0) {
        const img = p.go.anim.image;
        const dx = Math.round(p.rect.x + camX), dy = Math.round(p.rect.y);
        if (p.go.heading === 1) ctx.drawImage(img, dx, dy);
        else { ctx.save(); ctx.translate(dx + p.rect.w, dy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, p.rect.w, p.rect.h); ctx.restore(); }
        if (showTags) {
          const label = 'P' + p.slot;
          ctx.font = 'bold 11px sans-serif';
          const w = ctx.measureText(label).width + 10;
          const lx = dx + (p.rect.w - w) / 2, ly = dy - 17;
          ctx.fillStyle = p.color;
          ctx.fillRect(lx, ly, w, 14);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, lx + 5, ly + 11);
        }
      }
    }
    /* confetti (win screen) */
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    if (this.phase === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, this.viewW, VIEW_H);
      this.font.draw(ctx, 'PAUSED', Math.round(this.viewW / 2) - 45, 220, 24);
    }
  }
}
