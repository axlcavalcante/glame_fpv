# Glame! Playable Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `index.html` in which one walker wanders an endless black-and-white megastructure, with a pull-back view that shows the walker as a speck.

**Architecture:** Pure-logic ES modules (random numbers, world generation, collision, walker, pull-back camera) are unit-tested in Node. Browser modules (renderer, sound, input, page) are checked with headless Chrome. `build.mjs` strips `import`/`export` and inlines every module into one `index.html`, because a page opened by double-click cannot load modules.

**Tech Stack:** JavaScript (ES2020), WebGL2, WebAudio, `node:test`, Playwright driving the installed Chrome. No runtime dependency.

**Spec:** `docs/2026-11-13-glame-demo-design.md`

## Global Constraints

- One self-contained `index.html`: no install, no network, opens by double-click in current desktop Chrome, Safari, Firefox.
- Black and white only. No ground, horizon or sky, at any height.
- Structure readable to about 2.5 km; distant masses become paler silhouettes.
- Keys read by physical position (`event.code`), so ZQSD on AZERTY and WASD on QWERTY both work.
- Walker 1.75 m, walk 3 m/s, run 7 m/s (Shift), no jump. One level = 4 m.
- Pull-back: hold Space or right mouse button, or 8 s standing still; up to 400 m out. Walker's light off by default, toggled with L. H hides the level counter, M mutes.
- Same seed, same world.
- Nothing copied from Blame!: every shape is generated.
- The folder is not a git repository. Where a step says "checkpoint", the full test suite passes; there are no commits.

## Review Focus

1. Mouse capture refused or unavailable (page embedded in a frame): the player can still look around by dragging. → Task 6 browser check.
2. WebGL2 missing: the page shows a readable sentence, not a blank screen. → Task 6 browser check.
3. A very long frame (tab was hidden): the walker does not pass through floors. → Task 4 test `long frame does not tunnel`.
4. Window resized while playing: picture fills the window, no stretching. → Task 6 browser check.
5. Window loses focus with keys held: the walker stops, nothing stays "pressed". → Task 6 test `blur clears keys`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/rng.js` | Deterministic hashing and smooth noise |
| `src/world.js` | What exists where: heights, links, blocks, and the boxes and light points for a cell |
| `src/collide.js` | Moving a box-shaped body through solid boxes, with step-up |
| `src/walker.js` | Walker state: input to motion, falling, return to last junction |
| `src/pullback.js` | Choosing the open direction and placing the far camera |
| `src/input.js` | Key and mouse state, capture fallback |
| `src/render.js` | WebGL2 drawing: boxes, light points, ink outlines, haze, grain |
| `src/audio.js` | Drone and footsteps |
| `src/main.js` | Start screen, loop, counter, wiring |
| `src/page.html` | Markup and CSS, with a `/*SCRIPT*/` slot |
| `build.mjs` | Produces `index.html` |
| `tests/*.test.mjs` | Node tests |
| `tools/shot.mjs` | Headless Chrome: screenshots and browser checks |

Box format everywhere: 8 floats `cx, cy, cz, hx, hy, hz, material, seed` (centre, half-sizes). Materials: `0` megablock, `1` walkway, `2` dark mass, `3` rail/pipe, `4` figure. Light point format: 4 floats `x, y, z, size`.

---

### Task 1: Random numbers and the build

**Files:** Create `src/rng.js`, `build.mjs`, `tests/rng.test.mjs`, `tests/build.test.mjs`

**Interfaces — Produces:**
- `hash2(x:int, y:int, seed:int) -> number in [0,1)`
- `hash3(x:int, y:int, z:int, seed:int) -> number in [0,1)`
- `noise2(x:number, y:number, seed:int) -> number in [0,1)` (smooth value noise)
- `node build.mjs` writes `index.html`

- [ ] **Step 1:** Write `tests/rng.test.mjs`: `hash2(3,-7,1) === hash2(3,-7,1)`; 10 000 samples all in `[0,1)` with mean within 0.02 of 0.5; `hash2(1,2,5) !== hash2(2,1,5)`; `noise2` equals `hash2` at integer points and changes by less than 0.2 over a 0.05 step.
- [ ] **Step 2:** Run `node --test tests/` — expect failure (module missing).
- [ ] **Step 3:** Implement `src/rng.js` with integer mixing (`Math.imul`) and smoothstep interpolation.
- [ ] **Step 4:** Write `tests/build.test.mjs`: after running `build.mjs`, `index.html` exists, contains no `import ` or `export ` statement lines, and no `http://` or `https://`.
- [ ] **Step 5:** Implement `build.mjs`: read modules in the order `rng, world, collide, walker, pullback, input, render, audio, main`, drop lines starting with `import `, remove a leading `export `, wrap in one function scope, substitute into `src/page.html`. Missing modules are skipped so the build works from Task 1.
- [ ] **Step 6:** Run `node --test tests/` — expect pass. Checkpoint.

### Task 2: The shape of the world

**Files:** Create `src/world.js`, `tests/world.test.mjs`

**Interfaces — Consumes:** `hash2`, `hash3`, `noise2`.

**Produces:**
- Constants `CELL=40`, `LEVEL=4`, `LAYER=96`, `STEP_RISE=0.25`, `STEP_RUN=0.36`, `MAX_RISE=20`, `PLATFORM=3` (half-size), `WALK_HALF=1`.
- `makeWorld(seed:int) -> World`
- `World.nodeHeight(i, j) -> number` (layer 0 height of junction `i,j`; layer `L` adds `L*LAYER`)
- `World.link(i, j, axis:0|1, L) -> null | {type, rise, hA, hB}` where axis 0 joins `(i,j)-(i+1,j)`, axis 1 joins `(i,j)-(i,j+1)`; `type` is one of `'catwalk' | 'bare' | 'corridor' | 'stair' | 'stairBare' | 'stairWalled' | 'stairEnclosed'`
- `World.block(i, j) -> null | {x0,x1,z0,z1,y0,y1,seed}` (megablock inside cell `i,j`)
- `World.closure(i, j, axis) -> null | {y0,y1}` (mass closing the canyon over a link, slotted at walkways)
- `World.startNode() -> {i,j}`

- [ ] **Step 1:** Write tests: `nodeHeight` is a multiple of 4 and identical for two worlds with one seed, different for another seed; over a 60×60 area every non-null link has `|rise| <= 20` and `rise === hB - hA`; between 55 % and 95 % of possible links exist; flat links are never a stair type and sloped links always are; blocks keep at least 3.2 m from every cell edge; between 25 % and 80 % of cells hold a block; heights over a 400×400 area span more than 200 m; `startNode` has at least two links on layer 0.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement. Heights: two octaves of `noise2` (wavelengths 14 and 5 cells, amplitudes 180 m and 30 m), terraced into 20 m bands, rounded to `LEVEL`. Blocks: presence from a density noise (wavelength 9 cells) so open voids and dense regions both occur; per-side inset 3.2–9 m; vertical extent one of: through-going (±4000 m), ends above, ends below, hanging, stump. Links: absent when `|rise| > MAX_RISE` or by an 18 % hash; type by hash. Closures: 30 % of links whose two neighbouring blocks both exist.
- [ ] **Step 4:** Run — expect pass. Checkpoint.

### Task 3: Boxes and lights for a cell

**Files:** Modify `src/world.js`; create `tests/pieces.test.mjs`

**Produces:**
- `World.common(i, j, lod:1|2|3) -> {boxes:Float32Array, lights:Float32Array}` — megablock (stepped segments at lod 1, one box otherwise), junction pillar (lod ≤ 2), giant beams, closures (slotted at lod 1, solid otherwise).
- `World.layer(i, j, L, detail:0|1|2) -> {boxes, lights}` — junction platform and the two links owned by the cell on layer `L`. Detail 0: every step, railings, corridor walls with slit windows, pipes, ledges and protruding boxes on nearby block faces, cross-beams. Detail 1: slabs and 10 coarse steps. Detail 2: slabs and 4 coarse steps.
- `World.walkVolumes(i, j, L) -> Array<[x0,y0,z0,x1,y1,z1]>` — the space a walker needs on the cell's platform and links (used by tests and by generation to keep things clear).

- [ ] **Step 1:** Write tests: `layer` and `common` return identical arrays when called twice; array lengths are multiples of 8 and 4; every half-size is positive; for 200 sloped links at detail 0, sorted step tops differ by exactly 0.25 and run from `hA` to `hB`; over a 30×30 area on layers −1..1, no box from `common(…,1)` or from a neighbouring cell's `layer(…,0)` intersects any `walkVolumes` box, except the link's own floor, walls and railings outside the volume; detail-0 box count for one cell and layer is under 6000.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement. Geometry values: platform 6×6×0.5 m; catwalk 2 m wide; corridor 1.6 m wide inside, 2.6 m high, 0.2 m walls, window slits between 1.0 and 1.8 m; railings 1.0 m high; stairs centred in the link, steps 0.5 m thick; pillar 1.2 m square at a platform corner, running ±4000 m; nothing may enter a walk volume.
- [ ] **Step 4:** Run — expect pass. Checkpoint.

### Task 4: Collision and the walker

**Files:** Create `src/collide.js`, `src/walker.js`, `tests/walker.test.mjs`

**Produces:**
- `moveBody(body:{x,y,z,vy,onGround}, dx, dz, dt, solids:Float32Array[], opts:{half:0.3, height:1.75, step:0.3, gravity:20, maxFall:60}) -> void` (mutates `body`; `y` is the feet)
- `makeWalker(world, seed) -> Walker` with fields `x,y,z,yaw,pitch,vy,onGround,eyeY,light:boolean,fallTime,lastSafe:{x,y,z},fade:number,stepPhase`
- `Walker.update(dt, input:{fwd,strafe,run,turn}, solids) -> {stepped:boolean, landed:boolean}`
- `World.solidsNear(x, y, z) -> Float32Array[]` (detail-0 boxes of the 3×3 cells around the point, three nearest layers)

- [ ] **Step 1:** Write tests: body dropped onto a box comes to rest on its top with `onGround`; a 0.25 m ledge is climbed, a 0.5 m ledge blocks; a wall stops horizontal motion; `long frame does not tunnel`: one `update` with `dt = 5` leaves the walker on the platform; for 40 generated links covering every type, a walker holding forward from junction A reaches junction B's platform at height `hB` within 60 s of simulated time (running), and the same back; walking off a platform edge with no floor below sets `fade` rising after 6 s of falling and then restores `lastSafe` with `vy = 0`; walk speed measured over 5 s is 3 m/s ±0.1, run 7 m/s ±0.2.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement. Axis-separated sweep in sub-steps of at most 1/120 s; step-up of 0.3 m when grounded; snap-down of 0.3 m when leaving a step; `eyeY` eases towards `y + 1.62`; `lastSafe` is updated whenever the walker stands within 2 m of a junction centre.
- [ ] **Step 4:** Run — expect pass. Checkpoint.

### Task 5: The pull-back camera

**Files:** Create `src/pullback.js`, `tests/pullback.test.mjs`

**Produces:**
- `World.freeDistance(ox, oy, oz, dx, dy, dz, max) -> number` (distance to the first megablock, closure or giant beam along a ray; walkway parts are ignored)
- `makePullback() -> Pullback` with fields `amount` (0..1), `dist`, `az`, `el`
- `Pullback.update(dt, {held:boolean, idleSeconds:number, moved:boolean, orbitDX, orbitDY}, walker, world) -> void` — active while `held`, or automatically once `idleSeconds >= 8` until the walker moves
- `Pullback.camera(walker) -> {pos:[x,y,z], fwd:[x,y,z], figureVisible:boolean}`

- [ ] **Step 1:** Write tests: `freeDistance` returns `max` in empty space and the exact distance to a block face placed ahead; with a block 10 m to the east and open space elsewhere the chosen azimuth points away from east; holding for 20 s gives `dist` within 5 % of `min(400, free − 2)` and `amount` 1; releasing returns `amount` to 0 within 4 s; `idleSeconds = 7.9` leaves `amount` 0 and `8` starts the pull-back; at `amount 0` the camera is at the eye with the walker's own view direction; when pulled back the walker is on the camera's forward axis (angle under 1°); `figureVisible` is false below 1 m of distance.
- [ ] **Step 2:** Run — expect failure.
- [ ] **Step 3:** Implement. Direction search: 16 azimuths × 3 elevations (10°, 30°, 55°), score = free distance with a bonus for directions behind the walker's view. Distance eases out over about 6 s and back over about 2 s; view direction blends from first-person to look-at over the first 6 m.
- [ ] **Step 4:** Run — expect pass. Checkpoint.

### Task 6: Picture, sound, controls

**Files:** Create `src/render.js`, `src/input.js`, `src/audio.js`, `src/main.js`, `src/page.html`, `tools/shot.mjs`, `tests/input.test.mjs`

**Interfaces — Produces:**
- `makeInput(target) -> Input` with `state:{fwd,strafe,run,turn,pull}`, `consumeLook() -> {dx,dy}`, `toggles` callbacks for `KeyL`, `KeyH`, `KeyM`; `Input.handle(event)` so tests can feed plain objects.
- `makeRenderer(canvas) -> Renderer | null` with `setRing(n:0..3, boxes:Float32Array, lights:Float32Array)`, `draw({pos, fwd, fovY, lightOn, lightPos, figure:Float32Array|null, figureYaw, fade, time})`, `resize()`.
- `makeAudio() -> Audio` with `start()`, `step(running)`, `setMuted(bool)`, `setOpen(0..1)`.
- Debug entry for checks: URL parameters `auto=1` (skip the start screen), `seed`, `pos=x,y,z`, `yaw`, `pitch`, `pull=0..1`, `light=1`; `window.__glame` exposes `{walker, pullback, frames, error}`.

- [ ] **Step 1:** Write `tests/input.test.mjs`: `KeyW` down gives `fwd 1`, plus `KeyS` gives 0; `ShiftLeft` sets `run`; `Space` and mouse button 2 set `pull`; `blur clears keys`: after a blur event every field is 0/false; `KeyL` keydown fires its toggle once, not on key repeat.
- [ ] **Step 2:** Run — expect failure; implement `src/input.js`; run — expect pass.
- [ ] **Step 3:** Implement `src/render.js`. Pass 1 draws instanced boxes, nearest ring first, into a tone + normal target with a depth texture; tones are per-face with world-space panel seams, per-panel variation, streaks and anti-aliased hatching for mid-tones, solid black undersides; the optional walker light lifts tones within about 30 m. Pass 2 draws light points (minimum 1.5 px). Pass 3 composites: black outlines where depth curvature or normals break, haze towards the background grey (`1 − exp(−(d/1300)²)`, outlines fading with it), background grey darkening to near-black straight down and up, paper grain, fade-out for falls. Rings: 0 = cells within 2 (full detail on the three nearest layers), 1 = within 6, 2 = within 20, 3 = within 70. Render scale drops in steps when frames run long.
- [ ] **Step 4:** Implement `src/audio.js`, `src/main.js`, `src/page.html`: start screen (title, controls, "click to enter"), loop, ring rebuild when the walker changes cell or layer, level counter `floor(y / 4)`, drag-to-look when mouse capture is unavailable, a plain sentence when WebGL2 is missing.
- [ ] **Step 5:** Implement `tools/shot.mjs <out.png> [query]`: build, open `index.html` from disk in headless Chrome, wait for `__glame.frames >= 3`, fail on any console error, save a screenshot.
- [ ] **Step 6:** Browser checks with `tools/shot.mjs`: screenshot is not a single flat colour and contains no pixel whose red, green and blue differ; with `getContext` stubbed to return `null` the WebGL2 sentence is visible; after resizing the window the canvas matches the window size; with `requestPointerLock` stubbed to throw, a simulated drag changes `walker.yaw`.
- [ ] **Step 7:** Run `node --test tests/` — expect pass. Checkpoint.

### Task 7: Tune by eye, then deliver

**Files:** Modify `src/world.js`, `src/render.js` (values only); deliver to the Glame_fpv folder.

- [ ] **Step 1:** Take screenshots at six stations (corridor, stair foot looking up, catwalk over an open void, looking straight down, looking straight up, pulled back 400 m) and compare each against the spec's goals and anti-goals: no ground or horizon, no colour, far structure still readable, no obvious grid, the walker visible as a speck with the light on.
- [ ] **Step 2:** Adjust generation proportions and tone values; repeat Step 1 until every anti-goal is clear.
- [ ] **Step 3:** Run `node --test tests/` and the browser checks — expect pass.
- [ ] **Step 4:** Copy `index.html`, `src/`, `tests/`, `tools/`, `build.mjs` and this plan into Glame_fpv. Record in the hand-over note anything from the spec's stretch list that was not built.
