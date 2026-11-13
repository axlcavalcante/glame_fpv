# Glame! — playable demo: design

Date: 2026-11-13 · Status: approved by Alex 2026-11-13 (light made optional, L key)

## Intent

Make someone feel how huge this universe is and how small one person is inside it.
The walker is the only person in the world. There is nothing to achieve; you wander and look.

## Goals

- An endless megastructure generated around the walker as they move, always the same for a given seed.
- Black and white only, drawn like ink: outlines, hatching, flat tones, small white lights.
- The structure hangs in a grey void. No ground is ever visible, in any direction, at any height.
- Structure stays readable very far away (about 2.5 km): distant masses turn into paler silhouettes instead of disappearing.
- Narrow corridors, catwalks over the void, and long stairs, joined into one walkable network.
- First-person walking, plus a pull-back view that shows the walker as a speck against the structure.

## Non-goals

Objectives, enemies, other characters, story, inventory, saving, touch/mobile controls, multiplayer.

## Anti-goals (the demo fails if any of these happen)

- A ground, a horizon line, or a sky is visible.
- Any colour.
- Fog that hides the structure nearby, or geometry visibly popping in close to the walker.
- The world reads as a regular grid of identical towers.
- Anything copied from Blame!: its panels, characters, logo or named places. Nihei's work is the inspiration for scale and mood only; every shape here is generated.

## Constraints

- One self-contained `index.html`: no install, no network, opens by double-click in a current desktop browser (Chrome, Safari, Firefox).
- Keyboard and mouse. Keys are read by physical position, so ZQSD on an AZERTY keyboard and WASD on QWERTY both work.
- Smooth on an ordinary laptop.

## Approaches considered

How the person is shown:

- A. First-person only — most immersive, but the person is never seen, so their smallness is only implied.
- B. Third-person, far camera — the figure is always visible, but the camera fights narrow corridors and the inside feeling is lost.
- **C. First-person with a pull-back view — chosen by Alex.** Inside feeling while walking, outside proof of scale on demand.

How it is built (Alex left this open; these are the builder's calls):

- **Own WebGL2 renderer drawing instanced boxes — chosen.** Single file, no dependency, full control over the ink look, and simple exact collision.
- A 3D engine (three.js) — works, but adds a large dependency for features this demo does not use.
- A fully shader-computed world (ray marching) — endless detail for free, but walking, collision and frame rate become hard.

## Design

### The world

- Space is divided into 40 m cells. Most cells hold a megablock that runs hundreds of metres up and down, usually beyond sight; some end, so tops and undersides are visible. Blocks merge, step back and vary in width so the grid does not show.
- Between blocks are canyons 6–12 m wide. Large regions have no blocks at all: open voids crossed by thin bridges on pylons that descend out of sight.
- Walkways follow the canyons. Junction heights drift by hundreds of metres across the world, so neighbouring junctions are joined by flat catwalks, enclosed corridors (about 1.6 m wide), or straight stair flights of up to 80 steps. Flights chain into climbs of several hundred steps.
- Some catwalks have railings, some do not. Some links are missing: dead ends exist.
- More walkway layers hang above and below, roughly every 100 m, with giant beams and pipes crossing the canyons.
- Near blocks carry ledges, ribs, pipes and protruding boxes. Far blocks get their detail from the surface pattern only.

### The look

- Background: flat grey, darkening to near-black straight down and straight up.
- Surfaces: white where lit, hatched in the mid-tones, solid black underneath; black outlines on every edge and depth break.
- Distance: structure fades towards the void grey slowly, so 2 km away it is still a pale silhouette.
- Scattered pin-point white lights on the structure, visible as dots at any distance.
- Fine paper grain over the whole image.

### The walker

- 1.75 m tall. Walk 3 m/s, run 7 m/s (Shift). Mouse looks. No jump.
- You can step off an unrailed edge. The fall is long; the image fades and you are back on the last junction you crossed.
- **Pull-back view:** hold Space (or the right mouse button), or stand still for 8 seconds. The camera leaves the walker and drifts up to 400 m out into the most open direction, keeping the walker centred. The walker is a small original dark figure. The walker's light is optional: off by default, switched on and off with the L key. When on, it lights nearby surfaces and shows as a pin-point in the pull-back view, so the speck can be found. The mouse orbits; walking still works. Release, or move after an automatic pull-back, and the camera returns.

### Around it

- Start screen: title, the controls, "click to enter".
- A small level counter in a corner (one level = 4 m), which can be hidden with H.
- Sound: a low drone and footsteps, muted with M.

## Left to the builder

- Exact generation rules, proportions and tone values, tuned by looking at the result.
- Level-of-detail distances and performance tuning.
- Stretch, only if time allows: stair shafts that connect one walkway layer to the next.

## As built (2026-11-13)

Differences from the design above:

- **Falling.** If the walker lands on something within 6 seconds (a lower walkway layer, a beam, a megablock top), the walk simply continues from there. The fade and return to the last junction happen only after 6 seconds of uninterrupted falling.
- **Open voids** carry only a few long bridges (whole rows or columns of links, different on each layer) and occasional lone towers and pillars, so the void stays visible. Dense regions keep the full web of walkways.
- **Haze** is `1 − exp(−distance / 1000 m)`: structure at 1 km keeps about a third of its contrast, at 2.5 km under a tenth.
- **Detail rings**: full detail within 3 cells (120 m), medium within 7, walkway slabs within 20, megablock masses within 70 (2.8 km).
- **Not built**: stair shafts joining one walkway layer to the next (the stretch item). Layers are reached only by falling.
- **Known limit**: positions are stored as 32-bit numbers for drawing, so the picture would start to shimmer several tens of kilometres from the start.
