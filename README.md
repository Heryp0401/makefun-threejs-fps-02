# makefun-threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Heryp0401/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Heryp0401/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

FOUNDRY — a round-based tactical FPS in the style Counter-Strike made famous, built on three.js 0.187.0. You are a Warden defending bomb sites A and B against five Raider bots: rounds are won by elimination, by stopping the bomb, or by defusing it after it is planted. Money earned each round buys rifles, a sniper, grenades and ammunition in the freeze-phase shop. Gunfire rewards stopping to aim: spread blooms with movement and sustained fire, recoil kicks the view, and ADS narrows both.

Entry for the [threejs-fps-02 competition](https://make.fun/bounty/threejs-fps-02) on [make.fun](https://make.fun).

## Run it

```sh
node serve.ts
# open http://localhost:8080/game/index.html
```

The game is plain static files under `game/` — ES modules the browser loads with no build step and no network request. `main.ts` (Node 22) hands it in: it copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json`.

## How it plays

- **Gunplay:** three weapons (VK-47 rifle, LONGSHOT sniper, P9 pistol) + FRAG grenade. Aim down sights (right mouse) narrows spread and zooms; the sniper gets a scope overlay. Spread blooms per shot and with movement; recoil kicks the camera and springs back. Headshots deal up to 3× damage. Weapons run out of ammunition and reload (R).
- **Tactics:** two bomb sites (A/B), a planter bot that pushes a site and plants, a 35-second fuse, defusal (hold E near the bomb). Bots have roles — planter, rushers, sniper, lurker on the Raider side; site holders, mid and a rotator on the Warden side — and navigate with A* over a nav grid, hold angles, react to what they see and hear, and strafe in firefights.
- **Rounds:** freeze (buy) → live (100s) → round end → next round. First to 5 rounds takes the match. Money: $300 per kill, $1400 for a round win, $800 for a loss.
- **Map:** FOUNDRY, an original industrial yard — A long, B tunnel, mid with a choke block, two sites with distinct cover. Collision and line of sight come from the same wall list the renderer draws.

## Code

- `game/src/main.js` — bootstrap, input, render loop, bot meshes, viewmodel, screenshot staging (`?shot=start|play|end&seed=N`)
- `game/src/sim.js` — the fixed-step (60 Hz) simulation core; raycast hit resolution, grenades
- `game/src/config.js` — every tuning constant in one place
- `game/src/map.js` — map geometry, collision, nav grid, line of sight
- `game/src/astar.js` — A* with string-pulled paths
- `game/src/bots.js` — bot AI: roles, perception, combat, plant/defuse
- `game/src/player.js` — movement, look, weapons, damage
- `game/src/rounds.js` — round/match state machine + economy + buy menu
- `game/src/weapons.js` — fire gating, spread, recoil, damage, grenade physics
- `game/src/audio.js` — procedural WebAudio sounds (no assets)
- `game/src/hud.js` — the DOM HUD (health, ammo, timer, score, kill feed)
- `game/src/effects.js` — tracers, muzzle flash, impacts, explosions (pooled, no per-frame allocation)

## Screenshots

`shots.json` lists the three staged shots (`?shot=start|play|end&seed=1`); the PNGs/JPEGs under `screenshots/` are real renders of this game's own code in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=k67zx4h5&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
