'use strict';
/* WS relay test: TV creates a room, phone joins, phone input must reach
   the TV; a second phone must become a spectator. Run: node test/relay.test.js
   (expects the server on PORT or 3000). */
const assert = require('assert');
const WebSocket = require('ws');
const PORT = Number(process.env.PORT) || 3000;
const URL = `ws://127.0.0.1:${PORT}/ws`;

function connect() { return new Promise((res, rej) => { const ws = new WebSocket(URL); ws.on('open', () => res(ws)); ws.on('error', rej); }); }
function waitFor(ws, pred, timeout = 5000) {
  return new Promise((res, rej) => {
    const msgs = [];
    const timer = setTimeout(() => rej(new Error('timeout waiting for ' + JSON.stringify(msgs))), timeout);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      msgs.push(m);
      if (pred(m)) { clearTimeout(timer); res(m); }
    });
  });
}

(async () => {
  const tv = await connect();
  tv.send(JSON.stringify({ t: 'create', role: 'tv' }));
  const created = await waitFor(tv, (m) => m.t === 'created');
  assert.ok(/^\d{4}$/.test(created.code), 'room code is 4 digits');
  console.log('room created:', created.code);

  const phone = await connect();
  phone.send(JSON.stringify({ t: 'join', code: created.code, name: 'tester' }));
  const joined = await waitFor(phone, (m) => m.t === 'joined');
  assert.strictEqual(joined.role, 'controller');
  console.log('phone joined as controller');

  const tvInput = waitFor(tv, (m) => m.t === 'input' && m.input.right === true && m.input.jump === false);
  phone.send(JSON.stringify({ t: 'input', input: { left: false, right: true, jump: false, boost: false } }));
  const got = await tvInput;
  assert.deepStrictEqual(got.input, { left: false, right: true, jump: false, boost: false });
  console.log('TV received phone input:', JSON.stringify(got.input));

  const phone2 = await connect();
  phone2.send(JSON.stringify({ t: 'join', code: created.code, name: 'watcher' }));
  const joined2 = await waitFor(phone2, (m) => m.t === 'joined');
  assert.strictEqual(joined2.role, 'spectator');
  console.log('second phone joined as spectator');

  const bad = await connect();
  bad.send(JSON.stringify({ t: 'join', code: '0000', name: 'x' }));
  const err = await waitFor(bad, (m) => m.t === 'err');
  assert.ok(err.m, 'wrong code rejected');
  console.log('wrong code rejected:', err.m);

  [tv, phone, phone2, bad].forEach((w) => w.close());
  console.log('RELAY TEST: PASS');
  process.exit(0);
})().catch((e) => { console.error('RELAY TEST: FAIL', e.message); process.exit(1); });
