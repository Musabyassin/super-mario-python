#!/usr/bin/env python3
"""Generate levels/Level1-2.json .. Level1-10.json for the Mario web game.

Level1-1.json is the original and is NEVER touched. Level1-2 reuses 1-1's
terrain but gets its own entities (the original shipped with none).
Levels 1-3..1-10 are new, progressively harder.

Format (mirrors the originals):
  {id, length: 60, level: {objects: {sky, ground, bush, cloud, pipe},
                           layers: {...}, entities: {CoinBox, coinBrick,
                           coin, Goomba, Koopa, RandomBox}}}
  - sky [[x,13],[x,14]] removes the default ground rows -> a pit.
  - ground [[x,y]] adds solid tiles (elevated platforms at y=8..11).
  - pipe [[x,topRow,z]]: 2-wide solid pipe, top at row topRow.
  - Goomba [[a,b]] -> engine spawns at (b*TILE, (a-1)*TILE);
    Koopa [[a,b]] -> engine spawns at ((b-1)*TILE, a*TILE).
  - Win is positional: first player with rect.x >= 57*TILE wins, so
    tiles 56..59 must stay walkable at ground level.

Playability limits (from the engine: max jump ~132px = 4.1 tiles,
boost run ~5px/frame -> ~170px jump distance):
  - pit width <= 3 tiles; pipe top rows 9..11 only (2..4 tiles high);
    platform steps <= 3 tiles up (4 only from a pipe/platform top).

Usage: python3 tools/gen_levels.py   (writes levels/Level1-N.json)
Validation runs first and aborts on any failure.
"""
import json, os, sys
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS_DIR = os.path.join(ROOT, 'levels')
TILE = 32
MAX_JUMP_PX = 132          # engine max jump height
MAX_JUMP_TILES = 5         # horizontal jump distance with boost, tiles

END_COINS = [[x, y] for x in (56, 57, 58, 59) for y in (9, 10, 11, 12)]

BUSH_A = [[2, 12], [17, 12], [24, 12], [34, 12], [40, 12], [44, 12]]
CLOUD_A = [[5, 5], [13, 3], [26, 5], [32, 3], [42, 6], [55, 4]]
BUSH_B = [[3, 12], [15, 12], [28, 12], [38, 12], [47, 12]]
CLOUD_B = [[4, 4], [11, 6], [21, 3], [30, 5], [44, 4], [52, 6]]
BUSH_C = [[6, 12], [20, 12], [31, 12], [45, 12]]
CLOUD_C = [[7, 5], [16, 3], [25, 6], [36, 4], [48, 5], [56, 3]]

def arc(cx, top_row=10):
    """Coin arc over a pit centred at tile cx (3-4 coins)."""
    return [[cx - 1, top_row + 1], [cx, top_row], [cx + 1, top_row + 1]]

def arc2(x0, top_row=10):
    """Coin arc over a 2-wide pit starting at x0."""
    return [[x0 - 1, top_row + 1], [x0, top_row], [x0 + 1, top_row], [x0 + 2, top_row + 1]]

# ---------------------------------------------------------------- levels
# pipes: [x, topRow]  pits: (x, width)  platforms: (x0, x1, row)
L2_ENTITIES = {
    'CoinBox': [[6, 8], [20, 8], [44, 5], [56, 2]],
    'coinBrick': [[36, 9]],
    'coin': [[21, 8], [22, 8], [23, 8], [24, 8], [21, 7], [22, 7], [23, 7], [24, 7],
             [47, 11], [48, 10], [49, 11], [41, 8], [43, 8], [45, 8]] + END_COINS,
    'Goomba': [[12, 18], [12, 26], [10, 14]],
    'Koopa': [[12, 34], [12, 44]],
    'RandomBox': [[26, 8, 'RedMushroom'], [52, 5, 'RedMushroom']],
}

LEVELS = {
    3: dict(
        feel='pipe garden (gentle)',
        pipes=[[6, 11], [14, 10], [24, 11], [34, 10], [44, 11]],
        pits=[(19, 1), (38, 2)],
        platforms=[(26, 31, 10)],
        coinbox=[[10, 8], [28, 7], [47, 8]], coinbrick=[[16, 9], [36, 9]],
        randombox=[[28, 5, 'RedMushroom']],
        coin=[[4, 8], [5, 8], [27, 9], [29, 9]] + arc(19) + arc2(38) + END_COINS,
        goomba=[[12, 10], [12, 20], [12, 40]], koopa=[[12, 30], [12, 50]],
        bush=BUSH_B, cloud=CLOUD_B),
    4: dict(
        feel='pit-hopping',
        pipes=[[14, 11], [32, 10]],
        pits=[(9, 2), (18, 1), (27, 3), (36, 2), (45, 2), (52, 1)],
        platforms=[(40, 43, 10)],
        coinbox=[[5, 8], [22, 8], [41, 7]], coinbrick=[[12, 9], [48, 9]],
        randombox=[[41, 5, 'RedMushroom']],
        coin=[[41, 9], [42, 9]] + arc2(9) + arc(18) + [[26, 11], [27, 10], [28, 10], [29, 10], [30, 11]] + arc2(36) + arc2(45) + arc(52) + END_COINS,
        goomba=[[12, 6], [12, 16], [12, 33], [12, 49]], koopa=[[12, 24], [12, 42]],
        bush=BUSH_C, cloud=CLOUD_A),
    5: dict(
        feel='coin-arc heaven',
        pipes=[[8, 11], [20, 10], [44, 11], [50, 10]],
        pits=[(30, 2)],
        platforms=[(12, 16, 10), (24, 28, 10), (33, 35, 11), (36, 40, 9)],
        coinbox=[[4, 8], [14, 7], [26, 7], [38, 5], [54, 8]], coinbrick=[[10, 9], [46, 9]],
        randombox=[[14, 5, 'RedMushroom'], [38, 5, 'RedMushroom']],
        coin=[[5, 11], [6, 10], [7, 10], [8, 11], [13, 9], [15, 9], [17, 11], [18, 10],
              [19, 10], [20, 11], [25, 9], [27, 9], [34, 10], [37, 8], [39, 8],
              [47, 8], [48, 8], [49, 8]] + arc2(30) + END_COINS,
        goomba=[[12, 7], [12, 22], [12, 42], [12, 52]], koopa=[[12, 15], [12, 31], [12, 47]],
        bush=BUSH_A, cloud=CLOUD_C),
    6: dict(
        feel='pipe maze',
        pipes=[[5, 10], [10, 11], [16, 9], [22, 11], [27, 10], [33, 11], [39, 9], [45, 10], [51, 11]],
        pits=[(19, 1), (47, 2)],
        platforms=[(30, 32, 10)],
        coinbox=[[7, 8], [19, 8], [29, 7], [41, 7], [53, 8]], coinbrick=[[13, 9], [36, 9]],
        randombox=[[31, 5, 'RedMushroom'], [45, 8, 'RedMushroom']],
        coin=[[7, 11], [8, 11], [12, 11], [13, 11], [18, 11], [24, 11], [25, 11], [29, 11],
              [30, 11], [35, 11], [36, 11], [42, 11], [43, 11], [48, 11], [49, 11],
              [53, 11], [31, 9]] + arc(19) + arc2(47) + END_COINS,
        goomba=[[12, 7], [12, 14], [12, 25], [12, 36], [12, 49]], koopa=[[12, 20], [12, 31], [12, 44]],
        bush=BUSH_B, cloud=CLOUD_A),
    7: dict(
        feel='platform hopping',
        pipes=[[6, 11], [54, 10]],
        pits=[(12, 2), (24, 2), (37, 3)],
        platforms=[(8, 11, 10), (14, 17, 9), (20, 23, 10), (26, 30, 8), (33, 36, 10), (40, 44, 9), (47, 51, 8)],
        coinbox=[[10, 7], [16, 6], [28, 5], [42, 6], [49, 5]], coinbrick=[[22, 7], [35, 7]],
        randombox=[[16, 5, 'RedMushroom'], [49, 5, 'RedMushroom']],
        coin=[[9, 9], [11, 9], [15, 8], [17, 8], [21, 9], [23, 9], [27, 7], [29, 7],
              [34, 9], [36, 9], [41, 8], [43, 8], [48, 7], [50, 7]] + arc2(12) + arc2(24) + [[36, 11], [37, 10], [38, 10], [39, 10], [40, 11]] + END_COINS,
        goomba=[[12, 5], [12, 19], [12, 32], [12, 45], [12, 53]], koopa=[[12, 9], [12, 28], [12, 39]],
        bush=BUSH_C, cloud=CLOUD_B),
    8: dict(
        feel='enemy alley',
        pipes=[[10, 11], [22, 10], [34, 11], [46, 10]],
        pits=[(16, 2), (40, 2)],
        platforms=[(28, 31, 10)],
        coinbox=[[6, 8], [18, 8], [30, 7], [42, 8], [52, 8]], coinbrick=[[14, 9], [44, 9]],
        randombox=[[30, 5, 'RedMushroom'], [54, 8, 'RedMushroom']],
        coin=[[4, 11], [5, 11], [7, 11], [8, 11], [12, 11], [13, 11], [18, 11], [19, 11],
              [24, 11], [25, 11], [30, 9], [36, 11], [37, 11], [43, 11], [44, 11],
              [48, 11], [49, 11]] + arc2(16) + arc2(40) + END_COINS,
        goomba=[[12, 8], [12, 12], [12, 20], [12, 26], [12, 32], [12, 38], [12, 44], [12, 50]],
        koopa=[[12, 11], [12, 24], [12, 36], [12, 47], [12, 54]],
        bush=BUSH_A, cloud=CLOUD_A),
    9: dict(
        feel='gauntlet',
        pipes=[[7, 10], [15, 9], [23, 11], [31, 10], [39, 9], [47, 11], [53, 10]],
        pits=[(11, 2), (19, 2), (27, 2), (35, 2), (43, 2), (50, 1)],
        platforms=[(25, 27, 10), (41, 43, 10)],
        coinbox=[[5, 8], [13, 8], [21, 7], [29, 7], [37, 7], [45, 8], [55, 8]],
        coinbrick=[[9, 9], [33, 9], [49, 9]],
        randombox=[[26, 6, 'RedMushroom'], [42, 6, 'RedMushroom']],
        coin=[[4, 11], [16, 11], [24, 11], [26, 9], [32, 11], [40, 11], [42, 9], [48, 11], [54, 11]]
             + arc2(11) + arc2(19) + arc2(27) + arc2(35) + arc2(43) + arc(50) + END_COINS,
        goomba=[[12, 6], [12, 14], [12, 22], [12, 30], [12, 38], [12, 52]],
        koopa=[[12, 10], [12, 26], [12, 41], [12, 48]],
        bush=BUSH_B, cloud=CLOUD_C),
    10: dict(
        feel='final fortress',
        pipes=[[6, 9], [13, 10], [20, 9], [27, 11], [34, 9], [41, 10], [48, 9], [54, 11]],
        pits=[(10, 1), (17, 2), (24, 2), (31, 2), (38, 2), (45, 2), (51, 2)],
        platforms=[(29, 31, 10), (43, 45, 9)],
        coinbox=[[4, 8], [11, 8], [19, 7], [26, 7], [33, 7], [40, 7], [47, 7], [55, 8]],
        coinbrick=[[8, 9], [22, 9], [36, 9], [50, 9]],
        randombox=[[30, 6, 'RedMushroom'], [47, 6, 'RedMushroom']],
        coin=[[4, 11], [14, 11], [21, 11], [28, 11], [30, 9], [35, 11], [42, 11], [44, 8],
              [49, 11], [55, 11]] + arc(10) + arc2(17) + arc2(24) + arc2(31) + arc2(38) + arc2(45) + arc2(51) + END_COINS,
        goomba=[[12, 5], [12, 12], [12, 19], [12, 26], [12, 33], [12, 40], [12, 47], [12, 53]],
        koopa=[[12, 9], [12, 22], [12, 30], [12, 44], [12, 50]],
        bush=BUSH_C, cloud=CLOUD_B),
}

LAYERS = {"sky": {"x": [0, 60], "y": [0, 13]}, "ground": {"x": [0, 60], "y": [14, 16]}}

def build(n):
    """Build the level dict for Level1-N (N>=3)."""
    d = LEVELS[n]
    sky = []
    for (x, w) in d['pits']:
        for dx in range(w):
            sky.append([x + dx, 13]); sky.append([x + dx, 14])
    ground = []
    for (x0, x1, row) in d['platforms']:
        for x in range(x0, x1 + 1):
            ground.append([x, row])
    pipes = [[x, y, 6 if y == 9 else 4] for [x, y] in d['pipes']]
    return {
        "id": n - 1, "length": 60,
        "level": {
            "objects": {"bush": d['bush'], "sky": sky, "cloud": d['cloud'],
                        "pipe": pipes, "ground": ground},
            "layers": LAYERS,
            "entities": {"CoinBox": d['coinbox'], "coinBrick": d['coinbrick'],
                         "coin": d['coin'], "Goomba": d['goomba'],
                         "Koopa": d['koopa'], "RandomBox": d['randombox']},
        },
    }

# ---------------------------------------------------------------- validation
def segments(d):
    """Standable top surfaces as (row, x0, x1): ground intervals, pipe tops, platforms."""
    pit_cols = set()
    for (x, w) in d['pits']:
        pit_cols.update(range(x, x + w))
    pipe_cols = set()
    for [x, _] in d['pipes']:
        pipe_cols.update([x, x + 1])
    segs = []
    # ground row 13, split at pits and pipe columns
    x = 0
    while x < 60:
        if x in pit_cols or x in pipe_cols:
            x += 1; continue
        x0 = x
        while x < 60 and x not in pit_cols and x not in pipe_cols:
            x += 1
        segs.append((13, x0, x - 1))
    for [x, y] in d['pipes']:
        segs.append((y, x, x + 1))
    for (x0, x1, row) in d['platforms']:
        segs.append((row, x0, x1))
    return sorted(segs, key=lambda s: (s[1], s[0]))

def bfs_reachable(d):
    """Forward jump graph over segments; goal = any segment ending at x>=57."""
    segs = segments(d)
    start = [i for i, s in enumerate(segs) if s[1] <= 0]
    seen, q = set(start), deque(start)
    while q:
        i = q.popleft()
        row, x0, x1 = segs[i]
        if x1 >= 57:
            return True
        for j, (r2, y0, y1) in enumerate(segs):
            if j in seen or y0 < x0 - 1:
                continue
            gap = max(0, y0 - x1)
            rise = row - r2
            if gap <= MAX_JUMP_TILES and rise <= 4:
                seen.add(j); q.append(j)
    return False

def block_reachable(d, bx, by):
    """Can a standing Mario hit a block at [bx,by]? Standing on ground or
    on a segment covering bx (within 1 tile), jump sweep must overlap it."""
    by_px, bh = by * TILE, TILE
    surfaces = [(13, -1, 60)]  # ground everywhere (x range irrelevant for ground)
    for (row, x0, x1) in segments(d):
        surfaces.append((row, x0, x1))
    for (row, x0, x1) in surfaces:
        if row == 13 or (x0 - 1 <= bx <= x1 + 1):
            stand_y = row * TILE - TILE
            apex_y = stand_y - MAX_JUMP_PX
            if by_px + bh > apex_y and by_px < stand_y + TILE:
                return True
    return False

def validate(n, data):
    d = LEVELS[n]
    errs = []
    # pits
    for (x, w) in d['pits']:
        if not 1 <= w <= 3:
            errs.append(f'pit at {x} width {w} > 3')
        if x + w > 57:
            errs.append(f'pit at {x} reaches the finish area')
    # pipes
    for [x, y] in d['pipes']:
        if y not in (9, 10, 11):
            errs.append(f'pipe at {x} top row {y} (must be 9..11)')
        if x >= 56:
            errs.append(f'pipe at {x} blocks the finish')
        for (px, w) in d['pits']:
            if x in range(px, px + w) or x + 1 in range(px, px + w):
                errs.append(f'pipe at {x} overlaps pit at {px}')
    # platforms vs pipes
    for (x0, x1, row) in d['platforms']:
        if row not in (8, 9, 10, 11):
            errs.append(f'platform row {row} out of range')
        for [px, py] in d['pipes']:
            if x0 <= px + 1 and px <= x1 and row >= py:
                errs.append(f'platform {x0}-{x1}@{row} collides with pipe at {px}')
        if x1 >= 56 and row >= 9:
            errs.append(f'platform {x0}-{x1}@{row} overhangs the finish')
    # entities in bounds
    ents = data['level']['entities']
    for kind, items in ents.items():
        for it in items:
            if kind in ('Goomba', 'Koopa'):
                # swapped coords in the file: [a, b] -> spawn at (b*TILE, (a-1)*TILE)
                x, y = it[1], it[0]
            else:
                x, y = it[0], it[1]
            if not (0 <= x < 60 and 0 <= y < 15):
                errs.append(f'{kind} {it} out of bounds')
    # blocks hittable
    for kind in ('CoinBox', 'coinBrick', 'RandomBox'):
        for it in ents[kind]:
            if not block_reachable(d, it[0], it[1]):
                errs.append(f'{kind} at {it} unreachable')
    # path exists
    if not bfs_reachable(d):
        errs.append('no jump path from x=0 to x>=57 (BFS)')
    # difficulty: enemy counts grow with level number
    n_enemies = len(ents['Goomba']) + len(ents['Koopa'])
    if n < 5 and n_enemies > 6:
        errs.append(f'too many enemies ({n_enemies}) for early level 1-{n}')
    if n_enemies < 3:
        errs.append(f'too few enemies ({n_enemies}) for level 1-{n}')
    if not ents['coin']:
        errs.append('no coins')
    return errs

def main():
    # Level 1-2: 1-1 terrain + fresh entities
    with open(os.path.join(LEVELS_DIR, 'Level1-1.json')) as f:
        l1 = json.load(f)
    l2 = {"id": 1, "length": 60,
          "level": {"objects": l1['level']['objects'], "layers": LAYERS,
                    "entities": L2_ENTITIES}}
    all_errs = {}
    if not l2['level']['entities'].get('coin') or not l2['level']['entities'].get('Goomba'):
        all_errs[2] = ['1-2 entities missing coins/enemies']
    out = {2: l2}
    for n in range(3, 11):
        data = build(n)
        errs = validate(n, data)
        if errs:
            all_errs[n] = errs
        out[n] = data
    if all_errs:
        for n, errs in sorted(all_errs.items()):
            print(f'Level 1-{n}:')
            for e in errs:
                print(f'  FAIL {e}')
        sys.exit(1)
    for n, data in out.items():
        p = os.path.join(LEVELS_DIR, f'Level1-{n}.json')
        with open(p, 'w') as f:
            json.dump(data, f, indent=4)
        e = data['level']['entities']
        print(f'Level 1-{n}: {LEVELS.get(n, {}).get("feel", "1-1 terrain, new entities")} | '
              f'pipes={len(data["level"]["objects"]["pipe"])} pits={len(data["level"]["objects"]["sky"]) // 2} '
              f'coins={len(e["coin"])} goombas={len(e["Goomba"])} koopas={len(e["Koopa"])} '
              f'boxes={len(e["CoinBox"]) + len(e["coinBrick"]) + len(e["RandomBox"])}')
    print('OK: all levels validated and written.')

if __name__ == '__main__':
    main()
