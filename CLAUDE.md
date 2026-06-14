# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

"地主与农民" (Landlord and Farmer) is a real-time multiplayer "bankruptcy race" betting game. Players take asymmetric roles — Landlord (1) vs Farmers (1-4) — and each round secretly bet money cards, a coin flip decides the winner (heads = landlord, tails = farmers), then money is settled/negotiated. A player is bankrupt at balance ≤ 0; the game ends when the landlord or all farmers go bankrupt.

**The authoritative design document is `docs/GAME_SPEC.md`** — all rules, parameters, protocol, and architecture decisions live there. Update the spec first, then the code.

## Commands

Run from the repo root (npm workspaces: `server`, `client`).

- `npm run dev` — server (`node --watch index.js`, port 3001) + client (Vite, port 5173) concurrently
- `npm run build` — builds the client
- `npm run lint` — run from `client/`: `cd client && npx eslint .`
- No test suite. The pure logic in `server/logic/` is designed to be unit-testable with plain `node -e` scripts.

Vite proxies `/api` and `/ws` to `http://localhost:3001` (`client/vite.config.js`). The WS path is `/ws` with `?token=` auth.

**Offline visual verification**: `client/preview.html` + `src/preview.jsx` mount the real `GameScreen` with mock zustand state and no backend — with `npm run dev` running, open `/preview.html?phase=LOBBY|DISCUSSION|BETTING|FLIGHT|REVEAL|COIN_FLIP|SETTLE|NEGOTIATE|FINALIZE|ENDED`. Useful for screenshot-checking 3D scene/UI changes. `preview.html` is a second HTML file in `client/` but isn't a Vite build entry, so it's excluded from `npm run build`.

## Architecture principles (do not violate)

1. **Server-authoritative**: all rules/settlement/validation run on the server; the client only renders `state` and sends intents. The client must never compute balances or outcomes.
2. **No hardcoded parameters**: every tunable number lives in `server/config.js` (`DEFAULT_CONFIG`), overridable per room at creation. `getInitialBalance`/`getMinStake` are the reserved extension points for player-count-dynamic values.
3. **Logic/presentation split**: `server/logic/` is pure functions (no IO); `Room.js` owns the state machine. Client `scene/` (real 3D via react-three-fiber) and `ui/` (2D HUD) layers only read the zustand store — no game logic or balance/outcome computation in components.
4. **Data lives server-side**: accounts and game records persist via `server/storage.js` into `server/data/` (gitignored JSON; swap point for a real DB). Client localStorage holds only the auth token.
5. **Art via registry, with shared canvas assets**: components get art through `client/src/assets/registry.jsx` `getArt(key)` — the single swap point. Icons/coin badges are SVG (`assets/svg/index.jsx`). Money notes are canvas-rendered by `assets/pixelnote.js` (`PixelMoneyNote`), and that *same canvas* is reused as a `THREE.CanvasTexture` for the 3D table cards (`scene/textures.js`'s `noteTexture`) — hand and table cards are guaranteed visually identical. All HUD digits/Latin text render through the hand-authored bitmap font in `assets/pixelfont/`; Chinese text falls back to a CJK pixel-font CSS stack (`--font-cjk` in `pixel.css`).

## Server (`server/`, ESM)

- `config.js` — `DEFAULT_CONFIG` (all parameters: initial balances 23/8, min stakes, settlement multipliers/rounding/debt allocation, phase timings, reconnect grace…), `mergeConfig`, `getInitialBalance`, `getMinStake`.
- `modes/index.js` — mode registry: `quick` (available), `classic` (bank role) and `competitive` (rotating bank) are registered but `available: false` (reserved; future hooks attach here).
- `logic/apportion.js` — largest-remainder integer apportionment (all splits go through this; per-person error ≤ 1).
- `logic/rules.js` — `flipCoin`, `betBounds`/`validateBet` (bet ∈ [minStake, balance−minStake]; forced all-in when balance < 2×minStake), `allocateDebt` (capacity-capped recursive re-apportionment, default `inverseBet` = "whoever bet more covers less"), `settleRound` (default payout plan), `applyAllocation` (final booking + bankruptcy detection).
- `auth.js` — register/login (scrypt+salt), token sessions, duplicate login kicks the old socket, online presence.
- `storage.js` — JSON persistence (`users.json`, `records/*.json` per finished game).
- `Room.js` — phase machine: `LOBBY → DISCUSSION(ready) → BETTING → REVEAL(confirm) → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE → DISCUSSION(next round) | ENDED`. The four payout sub-phases are SETTLE (system plan) / NEGOTIATE (farmers drag money & debt between each other; any change resets confirmations; skipped if ≤1 farmer or nothing to split) / FINALIZE (booking, history, bankruptcy) / next DISCUSSION. Offline players are auto-acted (`autoActForOffline`) so gates never stall. `viewFor(playerId)` is the **privacy boundary**: others' balances `null`, bet amounts hidden during BETTING (`hasBet` only), `allocation` visible to farmers/spectators only, `history[].balancesAfter` stripped unless spectator/ENDED.
- `index.js` — thin REST (`/api/auth/*`, `/api/online`, `/api/modes`, `/api/rooms`) + WS dispatch. Single `state` push pattern: every mutation broadcasts each player their own `viewFor` view; client animations are driven by state diffs, not bespoke events. `voice_*` message types are reserved (reply `NOT_IMPLEMENTED`).

## Client (`client/src/`, React 19 + Vite + zustand + three/@react-three/fiber/@react-three/drei)

- `store/authStore.js` (token/login, localStorage). `store/gameStore.js` — mirrors server `state`/`chat`/`toast`/`kicked` (never computed client-side), plus transient presentation state: `chatOpen` (also suppresses game keyboard shortcuts), `flights` (2D FINALIZE table→hand recovery queue, consumed by `FlightLayer`), and `betFlight`/`myStack` + `startBetFlight`/`finalizeBetFlight` — the bet-flight handoff: the exact card models that fly from hand to table become `myStack` once the flight ends, so nothing swaps. `net/socket.js` — WS singleton with auto-reconnect and rejoin (handlers injected by gameStore to avoid import cycles). `api.js` — REST with Bearer token; 401 clears the session.
- `App.jsx` routing: no token → `LoginScreen`; no room → `LobbyScreen` (mode cards, room list, join by id); else `GameScreen` (composes `scene/Scene3D` + `ui/UiLayer` + `ui/McChat` + `ui/FlightLayer`).
- `scene/` — **3D scene layer** (react-three-fiber, presentation-only, reads the store):
  - `Scene3D.jsx` — `<Canvas>` containing `Table` (3D mesh, no "押注区" text), opponent `MinecraftPlayer`s seated per `SEATS` layout, `MoneyStack`s, `Coin`, and `CameraRig` (damped mouse-look, not free-fly). `cardMaterials(value)` builds one 6-face material array per denomination (`+y` = face texture via `noteTexture`, `-y` = back texture, edges plain), shared by every card mesh (hand-flight, own stack, opponent stacks) — face-up/down is purely `rotation.x` (0 vs π), never a material swap. `cardLocal(i)`/`cardYaw(i)` give each card's slot in a stack, shared between `MoneyStack` and flight landing points. `FlyingNotes`/`FlyingNote` animate a bet: each selected hand card's on-screen rect is unprojected to a 3D world point, then flown along a quadratic-Bezier arc (apex above start/end, `easeInOut` timing) to its exact `MoneyStack` slot — same mesh flies and lands, so there's no handoff pop. `Projector` publishes a 3D→screen projector via `scene/projection.js`.
  - `MinecraftPlayer.jsx` — Minecraft-style box-stacked character (head/body/arms/legs, idle bob + arm-swing via `useFrame`), role-colored (landlord = gold crown, farmer = green; bankrupt = grayscale + tilted), expression baked into the head's front-face texture (`textures.js#faceTexture`). Overhead nameplate via drei `<Html>` billboard rendering `<PixelText>` (role/name/bankrupt tag).
  - `Coin.jsx` — separately modeled coin (double-sided cylinder). `mode="flip"` runs a step-by-step physics sim each frame (gravity fall → decaying bounces with restitution/spin/friction-decay → a "settle" phase that eases the flip angle onto the server-determined `result`, locking heads/tails exactly). `mode="rest"` shows the final face flat.
  - `textures.js` — `THREE.CanvasTexture` generators, all `NearestFilter` for crisp pixels: `faceTexture` (player expressions), `coinFaceTexture` (王/禾), `noteTexture` (delegates to `assets/pixelnote.js` so 2D and 3D banknotes share one canvas).
  - `projection.js` — module-level singleton (`setProjector`/`projectPoint`): lets 2D UI code (e.g. `UiLayer`'s FINALIZE flight) query where a 3D world point lands on screen without prop-drilling the camera.
- `ui/` — **2D HUD layer** (pointer-transparent except interactive elements):
  - `UiLayer.jsx` — top bar (room id/round/phase chip + exit), right-side vertical `PlayerRail` (online players, role, balance, status), bottom-right `BalanceHud` (own balance in large `PixelText`, just `¥<amount>`, no label), phase hint banner, the current phase's action panel, and global keyboard shortcuts (`useGameKeys`: `T` opens chat, Enter/Space does the context action, all suppressed while typing or `chatOpen`).
  - `MoneyHand.jsx` — balance decomposed into 10/5/2/1 notes via `game/notes.js`, reserved min-stake shown locked aside. Click selects; long-press (450ms, shake starts at 140ms via `.hand-note.shaking`) splits a note — a short press never shakes or splits. On confirm, the selected cards' screen rects are captured and passed to `gameStore.startBetFlight` (the 3D layer flies those same cards to the table), then `place_bet` is sent.
  - `NegotiationBoard.jsx` — HTML5 drag of take/debt notes between farmer columns.
  - `McChat.jsx` — bottom-left Minecraft-style chat: idle messages fade after ~10s, `T` opens a scrollable input (Esc closes), farmers get a public/密谈 channel toggle.
  - `FlightLayer.jsx` — 2D FLIP-ghost animation; now only used for the FINALIZE table→hand payout recovery (driven by `gameStore.flights` + `projectPoint`).
- `game/notes.js` — pure note decomposition/split helpers (presentation-only; the server only ever sees integer amounts).
- `assets/registry.jsx` — `getArt(key)`: `moneyNote` → `PixelMoneyNote` (canvas, shared with 3D), `coin` → `CoinFace` (SVG, login-screen badge), `icon` → `Icon` (SVG, used throughout the HUD); `avatar`/`tableSurface` (`CubeAvatar`/`TableSurface`) are registered but unused now that players/table render in 3D.
- `assets/pixelnote.js` + `PixelMoneyNote.jsx` — the canonical banknote visual: `draw(ctx, {value, faceDown, debt, locked})` paints a low-res pixel grid (per-denomination color table, debt = red, face-down "地" back design) onto a cached canvas; `noteCanvas`/`noteDataUrl` feed the 2D `<img>`, and `scene/textures.js#noteTexture` wraps the same canvas as a 3D texture.
- `assets/pixelfont/` — hand-authored 5×7 bitmap font (built for this project; an earlier `@fontsource/press-start-2p` dependency is unused): `glyphs.js` has point data for digits/A-Z/a-z/punctuation/¥$; `PixelText.jsx` splits text into ASCII runs (rendered as crisp inline SVG bitmaps) and non-ASCII chunks (rendered via the `.pixel-cjk` CSS class, which falls back to a CJK pixel font stack).
- `pixel.css` — hardcore Minecraft/pixel theme, loaded after `theme.css`/`App.css` in `main.jsx`: stone-panel borders/bevels, HUD layout (`hud-top`, `player-rail`, `balance-hud`, `mc-chat*`), note-shake keyframes, the 3D canvas container (`.r3f-scene`), nameplate styling.
- `assets/svg/index.jsx` — `CoinFace`, `CubeAvatar`, `TableSurface`, `Icon` (its `MoneyNote` export is dead, superseded by `PixelMoneyNote`). All colors via `theme.css` CSS variables (dark theme, white UI, gold accents).

## Adding a new WebSocket message type

1. Server: add a `case` in `index.js`'s switch dispatching to a `Room` method; the method should `_broadcastState()` after mutating.
2. If it changes what a player may see, expose it through `viewFor()` per-player (never raw global state).
3. Client: send via `useGameStore.getState().send({type, ...})`; render from the updated `state` (avoid bespoke client events — drive animations from state diffs).
