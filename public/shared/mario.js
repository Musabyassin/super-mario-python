'use strict';
/* ============================================================
   Super Mario — web engine (Canvas + vanilla JS)
   A faithful port of mx0c/super-mario-python (pygame):
   same level JSONs, same sprite sheets + sprite JSONs, same
   physics numbers (gravity 0.8, jump -12, go accel 0.4,
   maxVel 3.0 / boost 5.0), same camera, same enemies.
   The physics runs on the TV page; the phone only sends
   held-input state {left,right,jump,boost} via the server.
   ============================================================ */
const TILE = 32, VIEW_W = 640, VIEW_H = 480;
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
  constructor() { this.map = {}; }
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
    this.phase = 'lobby'; /* lobby | playing | paused | dying | gameover | win */
    this.levelName = '1-1';
    this.input = { left: false, right: false, jump: false, boost: false };
    this.nextInput = { ...this.input };
    this.score = 0; this.coins = 0; this.time = 0; this.ticks = 0;
    this.hudTimer = 0;
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
      this.levelName = name === 'Level1-2' ? '1-2' : '1-1';
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
      this._spawnMario();
      this.score = 0; this.coins = 0; this.time = 0; this.ticks = 0;
      this.camX = 0; this.camPosX = 0;
      this.deathTimer = 0;
    });
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

  _spawnMario() {
    const S = this.sprites;
    const small = new Anim([S.get('mario_run1').img, S.get('mario_run2').img, S.get('mario_run3').img], S.get('mario_idle').img, S.get('mario_jump').img, 7);
    const big = new Anim([S.get('mario_big_run1').img, S.get('mario_big_run2').img, S.get('mario_big_run3').img], S.get('mario_big_idle').img, S.get('mario_big_jump').img, 7);
    this.mario = {
      rect: { x: 0, y: 0, w: TILE, h: TILE }, vel: { x: 0, y: 0 }, gravity: 0.8,
      onGround: false, obeyGravity: true, inAir: false, inJump: false,
      power: 0, invincibility: 0, restart: false, pause: false,
      go: { direction: 0, heading: 1, accelVel: 0.4, decelVel: 0.25, maxVel: 3.0, boost: false, anim: small },
      jump: { verticalSpeed: -12, jumpHeight: 120, initialHeight: 384, deaccelHeight: 120 - (12 * 12) / (2 * 0.8) },
      bounce: { vel: 5, jump: false },
      smallAnim: small, bigAnim: big,
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
  pauseToggle() {
    if (this.phase === 'playing') { this.setPhase('paused'); this.sound.stopMusic(); }
    else if (this.phase === 'paused') { this.setPhase('playing'); this.sound.startMusic(); }
  }
  restart() { this.loadLevel(this.levelName === '1-2' ? 'Level1-2' : 'Level1-1').then(() => { this.sound.startMusic(); this.setPhase('playing'); }); }
  setLevel(name) { this.loadLevel(name).then(() => { this.draw(); }); }
  setInput(inp) { this.nextInput = { left: !!inp.left, right: !!inp.right, jump: !!inp.jump, boost: !!inp.boost }; }

  pushHud() {
    this.onHud({ phase: this.phase, level: this.levelName, score: this.score, coins: this.coins, time: this.time });
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
    } else if (this.phase === 'dying') {
      const m = this.mario;
      m.vel.y += m.gravity;
      m.rect.y += m.vel.y;
      this.deathTimer += 1;
      if (this.deathTimer > 150 || m.rect.y > VIEW_H + 64) {
        this.sound.stopMusic();
        this.setPhase('gameover');
      }
    }
    this.draw();
  }

  _updatePlaying() {
    const m = this.mario;
    if (m.invincibility > 0) m.invincibility -= 1;
    /* traits use last frame's input (like the Python loop) */
    this._goUpdate(m);
    if (m.bounce.jump) { m.vel.y = 0; m.vel.y -= m.bounce.vel; m.bounce.jump = false; m.inAir = true; }
    /* move */
    m.rect.y += m.vel.y; this._checkY(m, true);
    m.rect.x += m.vel.x; this._checkX(m);
    /* camera (classes/Camera.py): scrolls only while Mario is between tiles 10..50 */
    const tileX = m.rect.x / TILE;
    if (tileX > 10 && tileX < 50) this.camPosX = -tileX + 10;
    this.camX = this.camPosX * TILE;
    /* gravity */
    if (m.obeyGravity) m.vel.y += m.gravity;
    /* fell into a pit? */
    if (m.rect.y > VIEW_H + TILE) { this._die(); return; }
    /* reached the end of the level? (the original has no win flag — we add one) */
    if (m.rect.x >= 57 * TILE) { this._win(); return; }
    /* entity collisions */
    this._marioEntityCollisions();
    /* entities */
    this._updateEntities();
    /* input sampled at end of frame, applied next frame (Python order) */
    this.input = { ...this.nextInput };
    const g = m.go;
    g.direction = this.input.left ? -1 : this.input.right ? 1 : 0;
    g.boost = this.input.boost;
    this._jumpCall(m, this.input.jump);
  }

  _die() {
    if (this.phase !== 'playing') return;
    this.sound.stopMusic();
    this.sound.play('death');
    const m = this.mario;
    m.vel.y = -11; m.vel.x = 0;
    this.deathTimer = 0;
    this.setPhase('dying');
  }
  _win() {
    this.score += Math.max(0, 100 - this.time) * 10;
    this.sound.play('powerup');
    this.sound.stopMusic();
    this.setPhase('win');
  }

  _marioEntityCollisions() {
    const m = this.mario;
    for (const ent of this.entities) {
      if (!ent.alive) continue;
      if (!rectsOverlap(m.rect, ent.rect)) continue;
      const isTop = m.vel.y > 0 && (m.rect.y + m.rect.h - ent.rect.y) < 18;
      if (ent.type === 'coin') {
        ent.alive = false;
        this.score += 100; this.coins += 1;
        this.sound.play('coin');
      } else if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        if (!ent.triggered) {
          ent.triggered = true;
          this.coins += 1;
          this.sound.play('bump');
          if (ent.type === 'randombox' && ent.item === 'RedMushroom') {
            this._addMushroom(ent.rect.x, ent.rect.y - 2 * TILE);
            this.sound.play('powerup_appear');
          }
        }
      } else if (ent.type === 'mushroom') {
        if (ent.alive) {
          this._powerup();
          this._killEntity(ent);
          this.sound.play('powerup');
        }
      } else if (ent.type === 'goomba' || ent.type === 'koopa') {
        if (isTop && (ent.alive || ent.bouncing)) {
          this.sound.play('stomp');
          m.rect.y = ent.rect.y - m.rect.h;
          m.bounce.jump = true;
          this._killEntity(ent);
        } else if (ent.alive && !ent.active && !ent.bouncing) {
          /* stomped shell lying still: kick it */
          ent.bouncing = true;
          if (m.rect.x < ent.rect.x) { ent.dir = 1; ent.rect.x += 5; }
          else { ent.dir = -1; ent.rect.x -= 5; }
          this.sound.play('kick');
        } else if (ent.alive && !m.invincibility) {
          if (m.power === 0) { this._die(); return; }
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

  _powerup() {
    const m = this.mario;
    if (m.power === 0) {
      m.power = 1;
      m.go.anim = m.bigAnim;
      const { x, y } = m.rect;
      m.rect = { x, y: y - TILE, w: TILE, h: TILE * 2 };
      m.invincibility = 20;
    }
  }
  _killEntity(ent) {
    if (ent.type === 'koopa') {
      ent.timer = 0; ent.speed = 1; ent.alive = true; ent.active = false; ent.bouncing = false;
    } else {
      ent.alive = false;
      ent.timer = 0;
      ent.textPos = { x: ent.rect.x + 3, y: ent.rect.y };
    }
    this.score += 100;
  }

  _updateEntities() {
    for (const ent of this.entities) {
      if (ent.type === 'coin') { if (ent.alive) ent.anim.update(); continue; }
      if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        if (ent.alive && !ent.triggered) ent.anim.update();
        else {
          if (!ent.fxDone) {
            ent.fxDone = true;
            this.score += 100;
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
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#5c94fc';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (!this.ready || !this.grid) return;
    const S = this.sprites;
    const sky = S.get('sky').img;
    const camX = this.camX || 0;
    const x0 = Math.max(0, Math.floor(-camX / TILE) - 1);
    const x1 = Math.min(this.levelLength - 1, x0 + 22);
    for (let y = 0; y < 15; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = this.grid[y][x];
        if (!t.spr) continue;
        const spr = S.get(t.spr);
        if (!spr || !spr.img) continue;
        const dx = Math.round((x * TILE) + camX), dy = y * TILE;
        if (t.redraw) ctx.drawImage(sky, dx, dy);
        ctx.drawImage(spr.img, dx, dy);
      }
    }
    /* entities */
    for (const ent of this.entities) {
      if (ent.alive === null) continue;
      const dx = Math.round(ent.rect.x + camX);
      if (dx < -64 || dx > VIEW_W + 64) continue;
      if (ent.type === 'coin') {
        if (ent.alive) ctx.drawImage(ent.anim.image, dx, ent.rect.y);
      } else if (ent.type === 'coinbox' || ent.type === 'coinbrick' || ent.type === 'randombox') {
        ctx.drawImage(sky, dx, ent.rect.y + 2);
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
    /* Mario */
    const m = this.mario;
    if (m && (m.invincibility === 0 || Math.floor(m.invincibility / 2) % 2 === 0)) {
      const img = m.go.anim.image;
      const dx = Math.round(m.rect.x + camX), dy = Math.round(m.rect.y);
      if (m.go.heading === 1) ctx.drawImage(img, dx, dy);
      else { ctx.save(); ctx.translate(dx + m.rect.w, dy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, m.rect.w, m.rect.h); ctx.restore(); }
    }
    /* HUD (classes/Dashboard.py) */
    this.font.draw(ctx, 'MARIO', 50, 20, 15);
    this.font.draw(ctx, String(this.score).padStart(6, '0'), 50, 37, 15);
    this.font.draw(ctx, '@x' + String(this.coins).padStart(2, '0'), 225, 37, 15);
    this.font.draw(ctx, 'WORLD', 380, 20, 15);
    this.font.draw(ctx, this.levelName, 395, 37, 15);
    this.font.draw(ctx, 'TIME', 520, 20, 15);
    this.font.draw(ctx, String(this.time).padStart(3, '0'), 535, 37, 15);
    if (this.phase === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      this.font.draw(ctx, 'PAUSED', 270, 220, 24);
    }
  }
}
