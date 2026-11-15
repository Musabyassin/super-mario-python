# Super Mario Implementation in Python

This is inspired by Meth-Meth-Method's [super mario game](https://github.com/meth-meth-method/super-mario/)

## Running

* $ pip install -r requirements.txt
* $ python main.py

## Standalone windows build

* $ pip install py2exe
* $ python compile.py py2exe

## Controls

* Left: Move left  
* Right: Move right  
* Space: Jump  
* Shift: Boost   
* Left/Right Mouseclick: secret   

## Current state:
![Alt text](img/pics.png "current state")

## Dependencies	
* pygame	
* scipy	

## Contribution

If you have any Improvements/Ideas/Refactors feel free to contact me or make a Pull Request.
The code needs still alot of refactoring as it is right now, so I appreciate any kind of Contribution.

---

## Web version — TV + phone (نسخة الويب: تلفاز + هاتف)

This repo now also contains a **web version** of the game, built the same
way as Sayyed Alaqar: the TV displays the game, the phone is the
controller, and players join with a room code. The original Python/pygame
game is untouched.

### Run locally

```bash
npm --prefix server install
node server/server.js   # listens on http://localhost:3000
```

### How to play

1. Open `http://localhost:3000/tv/` on the TV (or a big screen) — a
   4-digit room code + QR code appear.
2. On the phone open `http://localhost:3000/play/` (or scan the QR) and
   enter the code.
3. The phone becomes the controller: ◀ ▶ to move, قفز (Jump) to jump,
   تسريع (Boost) to run faster. Start / Pause / Restart from the phone
   or from the TV keyboard (arrows + Space, P to pause, R to restart).
4. Extra phones joining the same code watch as spectators.

Levels 1-1 and 1-2 are included (same level JSONs and sprite sheets as
the Python game). The game engine (`public/shared/mario.js`) is a
JavaScript/Canvas port of the Python code; the server (`server/server.js`)
is only a WebSocket relay for the phone's held-input state — the physics
runs on the TV page.

### Deploy

`render.yaml` defines a free Render web service: build
`npm --prefix server install`, start `node server/server.js`,
health check `/health`.
