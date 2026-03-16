# Diamond Painting Game — Implementation Plan

## Concept
A relaxing HTML5 puzzle game where the player fills a grid cell-by-cell using
colored "diamonds" to recreate pixel-art images. Designed for Yandex Games
(desktop + mobile).

---

## Tech Stack
| Layer | Choice | Reason |
|---|---|---|
| Rendering | HTML5 Canvas (2D) | Fast for grid drawing, no heavy deps |
| Language | Vanilla JS (ES modules) | No build step, fast load |
| Yandex SDK | `yandex-games-sdk` (CDN) | Ads, leaderboards, saves |
| Packaging | Single `index.html` + assets | Yandex requires ZIP upload |

---

## Core Game Loop

```
Start Screen → Select Picture → Paint Mode → Complete Screen
                                    ↑               |
                                    └───────────────┘ (next picture / replay)
```

1. **Start Screen** — title, "Play" button, leaderboard button
2. **Select Picture** — grid of unlocked/locked levels
3. **Paint Mode** — main gameplay
4. **Complete Screen** — score, stars, share, next level

---

## File Structure

```
diamond-game/
├── index.html          # Entry point (single page)
├── style.css           # Layout + UI styles
├── src/
│   ├── main.js         # Bootstrap, screen router
│   ├── game.js         # Core game engine (canvas, input)
│   ├── levels.js       # Level definitions (pixel art data)
│   ├── ui.js           # Screen components (start, select, complete)
│   ├── yandex.js       # Yandex SDK wrapper (ads, saves, leaderboard)
│   └── utils.js        # Helpers (color conversion, grid math)
├── assets/
│   ├── diamonds/       # Diamond sprite sheets (colors)
│   ├── ui/             # Buttons, icons, backgrounds
│   └── sounds/         # Click SFX, complete jingle
└── PLAN.md
```

---

## Grid & Data Model

### Level Format
```js
{
  id: 1,
  name: "Butterfly",
  width: 20,        // columns
  height: 20,       // rows
  palette: [
    { id: 1, color: "#FF69B4", label: "Pink" },
    { id: 2, color: "#FFFFFF", label: "White" },
    // ...up to ~10 colors per level
  ],
  cells: [          // flat array, length = width * height
    1, 1, 2, 0, ...  // 0 = empty/background (no diamond needed)
  ]
}
```

### Game State (in-memory + Yandex Cloud Save)
```js
{
  currentLevel: 1,
  completedLevels: [1, 3],
  progress: {           // partial saves per level
    1: { filledCells: Set([0, 1, 5, ...]) }
  }
}
```

---

## Gameplay Mechanics

### Painting
- **Select color** from palette tray at bottom
- **Tap / click** a cell → fills it if correct color selected
- **Wrong color** → subtle shake animation, no penalty (relaxed mode)
- **Zoom / pan** — pinch-to-zoom on mobile, scroll wheel on desktop
- **Bucket fill** (power-up) — fill all visible cells of same color at once

### Visual Feedback
- Unfilled cells show a faint number (color ID) + light grid lines
- Filled cells render a shiny diamond sprite in the correct color
- Completed rows/columns flash briefly
- Progress bar at top showing % complete

### Scoring
```
Base score  = number of cells correctly placed
Time bonus  = max(0, 300 - seconds_elapsed) * 10
Star rating = 1★ (50%), 2★ (80%), 3★ (100%) complete
```

---

## Yandex Games Integration

### SDK Init
```js
// yandex.js
await YaGames.init();
const player = await ysdk.getPlayer();
```

### Features to integrate
| Feature | When triggered |
|---|---|
| Interstitial ad | Between levels |
| Rewarded ad | Unlock "Bucket Fill" hint |
| Cloud saves | On level complete + every 30 sec |
| Leaderboard | Score submitted on level complete |
| Localization | `ysdk.environment.i18n.lang` → EN/RU/TR |

---

## Levels (Initial Set — 5 Levels)

| # | Name | Size | Colors | Difficulty |
|---|---|---|---|---|
| 1 | Heart | 10×10 | 2 | Tutorial |
| 2 | Butterfly | 20×20 | 6 | Easy |
| 3 | Flower | 25×25 | 8 | Medium |
| 4 | Owl | 30×30 | 10 | Hard |
| 5 | Landscape | 40×30 | 12 | Expert |

---

## Mobile UX

- Canvas fills the screen, UI overlays on top
- Palette tray slides up from bottom (like a toolbar)
- Large tap targets (min 44×44 px per palette color swatch)
- Pinch-to-zoom with `touch` events; double-tap to reset zoom
- Landscape + portrait supported via canvas resize listener

---

## Implementation Phases

### Phase 1 — Core Engine
- [ ] `index.html` skeleton + canvas setup
- [ ] Grid renderer (draw cells, grid lines, color fills)
- [ ] Input handler (click/tap → fill cell)
- [ ] Palette UI
- [ ] Level 1 (Heart) hardcoded

### Phase 2 — Game Flow
- [ ] Screen router (start → select → game → complete)
- [ ] Level select screen
- [ ] Zoom/pan system
- [ ] Progress tracking (localStorage fallback)
- [ ] All 5 levels

### Phase 3 — Polish
- [ ] Diamond sprite rendering (glitter effect via canvas)
- [ ] Sound effects
- [ ] Animations (fill, complete, star rating)
- [ ] Responsive layout

### Phase 4 — Yandex Integration
- [ ] SDK wrapper (`yandex.js`)
- [ ] Cloud saves
- [ ] Leaderboard
- [ ] Ads (interstitial + rewarded)
- [ ] Localization (EN/RU)

### Phase 5 — Release
- [ ] Test on Yandex Games sandbox
- [ ] Performance profiling (target 60 fps on mid-range mobile)
- [ ] ZIP packaging per Yandex requirements
- [ ] Submit to Yandex Games catalog

---

## Yandex Games Requirements Checklist
- [ ] Single `index.html` entry point
- [ ] No external CDN calls (bundle or vendor locally) except Yandex SDK
- [ ] SDK script: `<script src="//yandex.ru/games/sdk/v2"></script>`
- [ ] Works offline after first load (except leaderboards/ads)
- [ ] Max ZIP size: 30 MB
- [ ] Tested in Yandex Games iframe environment
- [ ] 16:9 and 9:16 aspect ratios supported
- [ ] Age rating: 0+

---

## Estimated Scope
~800–1200 lines of JS across all files. No framework needed.
