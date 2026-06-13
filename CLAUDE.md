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

## Architecture principles (do not violate)

1. **Server-authoritative**: all rules/settlement/validation run on the server; the client only renders `state` and sends intents. The client must never compute balances or outcomes.
2. **No hardcoded parameters**: every tunable number lives in `server/config.js` (`DEFAULT_CONFIG`), overridable per room at creation. `getInitialBalance`/`getMinStake` are the reserved extension points for player-count-dynamic values.
3. **Logic/presentation split**: `server/logic/` is pure functions (no IO); `Room.js` owns the state machine. Client `scene/` (3D) and `ui/` (2D) layers only read stores.
4. **Data lives server-side**: accounts and game records persist via `server/storage.js` into `server/data/` (gitignored JSON; swap point for a real DB). Client localStorage holds only the auth token.
5. **All art is SVG via registry**: components get art through `client/src/assets/registry.jsx` `getArt(key)`. To replace art later, change only the registry/svg files.

## Server (`server/`, ESM)

- `config.js` — `DEFAULT_CONFIG` (all parameters: initial balances 23/8, min stakes, settlement multipliers/rounding/debt allocation, phase timings, reconnect grace…), `mergeConfig`, `getInitialBalance`, `getMinStake`.
- `modes/index.js` — mode registry: `quick` (available), `classic` (bank role) and `competitive` (rotating bank) are registered but `available: false` (reserved; future hooks attach here).
- `logic/apportion.js` — largest-remainder integer apportionment (all splits go through this; per-person error ≤ 1).
- `logic/rules.js` — `flipCoin`, `betBounds`/`validateBet` (bet ∈ [minStake, balance−minStake]; forced all-in when balance < 2×minStake), `allocateDebt` (capacity-capped recursive re-apportionment, default `inverseBet` = "whoever bet more covers less"), `settleRound` (default payout plan), `applyAllocation` (final booking + bankruptcy detection).
- `auth.js` — register/login (scrypt+salt), token sessions, duplicate login kicks the old socket, online presence.
- `storage.js` — JSON persistence (`users.json`, `records/*.json` per finished game).
- `Room.js` — phase machine: `LOBBY → DISCUSSION(ready) → BETTING → REVEAL(confirm) → COIN_FLIP → SETTLE → NEGOTIATE → FINALIZE → DISCUSSION(next round) | ENDED`. The four payout sub-phases are SETTLE (system plan) / NEGOTIATE (farmers drag money & debt between each other; any change resets confirmations; skipped if ≤1 farmer or nothing to split) / FINALIZE (booking, history, bankruptcy) / next DISCUSSION. Offline players are auto-acted (`autoActForOffline`) so gates never stall. `viewFor(playerId)` is the **privacy boundary**: others' balances `null`, bet amounts hidden during BETTING (`hasBet` only), `allocation` visible to farmers/spectators only, `history[].balancesAfter` stripped unless spectator/ENDED.
- `index.js` — thin REST (`/api/auth/*`, `/api/online`, `/api/modes`, `/api/rooms`) + WS dispatch. Single `state` push pattern: every mutation broadcasts each player their own `viewFor` view; client animations are driven by state diffs, not bespoke events. `voice_*` message types are reserved (reply `NOT_IMPLEMENTED`).

## Client (`client/src/`, React 19 + Vite + zustand)

- `store/authStore.js` (token/login) and `store/gameStore.js` (server-state mirror, chat, toast, `flights` animation queue). `net/socket.js` — WS singleton with auto-reconnect and rejoin (handlers injected by gameStore to avoid import cycles). `api.js` — REST with Bearer token; 401 clears the session.
- `App.jsx` routing: no token → `LoginScreen`; no room → `LobbyScreen` (mode cards, room list, join by id); else `GameScreen`.
- `scene/TableScene.jsx` — **3D scene layer**: CSS 3D (`perspective` + `rotateX(55deg)` table plane). Opponents stand on the plane counter-rotated (`rotateX(-55deg)`, bottom origin) so true perspective produces near-large/far-small. Money notes lie flat in the plane. Seat order = clockwise from the viewer (`SEAT_LAYOUTS`). Coin flip is a dual-face CSS keyframe animation whose duration comes from `state.config.timing.coinAnimMs`.
- `ui/` — **2D UI layer**: `UiLayer.jsx` shows only the current phase's panel (+ global bar with room id/exit + players strip + self-explaining phase hint), `MoneyHand.jsx` (balance decomposed into 10/5/2/1 notes, reserved min-stake locked aside, long-press to split, select & confirm → notes fly into the 3D table via `FlightLayer`), `NegotiationBoard.jsx` (HTML5 drag of take/debt notes between farmer columns), `ChatPanel.jsx` (public + farmer-only channels, mic button reserved), `FlightLayer.jsx` (FLIP ghost animations between 2D UI and 3D table, fed by `gameStore.flights`).
- `game/notes.js` — pure note decomposition/split helpers (presentation-only; the server only ever sees integer amounts).
- `assets/svg/index.jsx` — MoneyNote, CoinFace, CubeAvatar (human-ish body + big cube head with expressions), TableSurface, Icon. All colors via `theme.css` CSS variables (dark theme, white UI, gold accents).

## Adding a new WebSocket message type

1. Server: add a `case` in `index.js`'s switch dispatching to a `Room` method; the method should `_broadcastState()` after mutating.
2. If it changes what a player may see, expose it through `viewFor()` per-player (never raw global state).
3. Client: send via `useGameStore.getState().send({type, ...})`; render from the updated `state` (avoid bespoke client events — drive animations from state diffs).
