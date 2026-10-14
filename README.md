# The Cube - upgraded build (v1.0.0)

A 3D cube puzzle (2x2 to 5x5) built on Three.js **r95**. This build keeps the original game logic and
adds a pause system, undo/redo, keyboard play, daily challenge, a dark neon theme, loading/error
handling, render throttling and CrazyGames SDK hooks.

Based on "The Cube" by bsehovac (https://github.com/bsehovac/the-cube). **Check that repo's licence
and keep its attribution before you publish.**

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: title/meta, loader + error screen, HUD and overlay markup |
| `boot.js` | Safe storage, startup sequence, error screens, CrazyGames SDK wrapper |
| `main.js` | The game (original code, patched; see "What changed in main.js") |
| `pro.js` | HUD, pause menu, help, sound, keyboard, visibility handling, platform hooks |
| `pro.css` | Dark neon UI layer (the original `style.css` is **unchanged**) |
| `lib/three.min.js` | **You add this** (see below) |

## Controls

Drag a face to turn a layer; drag the background to rotate the cube.
Keyboard: `U D L R F B` turn faces (Shift = reverse), arrows rotate the cube, `Z` undo, `Y` redo,
`P`/`Esc` pause, `Space` start, `M` sound, `F` fullscreen, `H` help.

## Features added

- **Gameplay:** move counter, undo/redo (persisted across refresh), pause/resume (auto-pauses when the
  tab is hidden or the window loses focus; the timer excludes paused time), New scramble, Daily
  challenge (same scramble for everyone per UTC day and cube size; best time/moves saved), first-run tip,
  How-to-play screen.
- **Stats:** best/worst/last time, fewest moves, Ao5/Ao12/Ao25 (simple mean, as in the original),
  last 100 solves per size.
- **Look:** neon theme is the default (the original colour schemes remain); original UI re-tints for dark
  backgrounds; responsive for phone/tablet/desktop, safe-area aware, 40-44px touch targets.
- **Performance:** pixel ratio capped at 1.5 (Auto), adaptive resolution under load (Auto/Sharp/Fast in the
  pause menu), 30fps ambient/idle rendering instead of 60fps forever, zero rendering while hidden,
  shared sticker materials, GPU buffers released when the cube is rebuilt.
- **Robustness:** loading screen with progress; clear errors for missing WebGL, blocked scripts or init
  failures; storage that never throws (sandboxed iframes, private mode, full quota) and falls back to memory;
  drags are finished safely on touch-cancel / window blur.
- **Platform:** CrazyGames SDK v3 wrapper (`boot.js`): `init`, `loadingStart/Stop`, `gameplayStart/Stop`
  on every real start/stop of play, `happytime` only for a new personal best, midgame ad when the
  player leaves the solve screen. Everything is optional: with the SDK blocked or absent the game runs unchanged.
  Set `ads.enabled = false` in `boot.js` (`CONFIG`) to disable ads.

## Bugs fixed in the original

- Saved game and **preferences were wiped on every page load** (`window.gameVersion` was never defined).
- Solve history was never trimmed (`scores.lenght` typo).
- Unguarded `localStorage` threw in sandboxed iframes / private mode.
- Geometry and materials were leaked on every cube rebuild; one material per sticker.
- A permanent animation forced full-rate rendering even when nothing moved.
- Page title was "Document"; no keyboard support (`keyboardMove` existed but was never wired).
- A drag interrupted by the OS / window blur could leave the cube stuck.
