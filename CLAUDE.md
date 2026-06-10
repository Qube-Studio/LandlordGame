# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

"地主与农民" (Landlord and Farmer) is a real-time multiplayer "bankruptcy race" game (not an EV-maximization game). Players take asymmetric roles — Landlord (1), Farmers (1+), Bank (0/1) — and each round simultaneously place secret bets, then a coin flip determines the winner. The Bank can issue/forgive loans with interest. A player is bankrupt when balance ≤ 0; the game ends when the Landlord or all Farmers go bankrupt.

## Commands

Run from the repo root (npm workspaces: `server`, `client`).

- `npm run dev` — runs server (`node --watch index.js` on port 3001) and client (Vite dev server on port 5173) concurrently
- `npm run build` — builds the client (`vite build` in `client/`)
- `npm run lint` — run from `client/`: `cd client && npm run lint` (eslint)
- No test suite currently exists.

The Vite dev server proxies `/api` and `/ws` to `http://localhost:3001` (see `client/vite.config.js`). The client connects via `ws://${window.location.host}/ws` — this path must match the proxy rule.

## Architecture

### Server (`server/`, ESM)

- `index.js` — Express + `ws` WebSocket server. Holds in-memory `rooms` (roomId → `GameRoom`) and `users` (registered usernames, `Set`). REST: `POST /api/users/register`, `POST /api/rooms`, `GET /api/rooms`. All gameplay happens over a single WebSocket connection per client; `index.js` is a thin message-type switch that dispatches to `GameRoom` methods and sends back `*_result` responses.
- `GameRoom.js` — the game state machine and source of truth for one room. Phases: `LOBBY → BETTING → REVEAL → FLIP → SETTLEMENT → NEGOTIATION → (loop to BETTING) → ENDED`. Key responsibilities:
  - Player/role management (`addPlayer`, `assignRole`, roles: `landlord`/`farmer`/`bank`)
  - Round flow (`placeBet` → `_startReveal` → `_doFlip` → `_doSettlement` → negotiation or game end), driven by `setTimeout` chains
  - Bank/loan ledger (`requestLoan`, `approveLoan`, `forgiveLoan`, `fileComplaint`)
  - `getStateFor(playerId)` builds a **per-player view** of state — this is the key privacy boundary:
    - Other players' balances are hidden (`null`) unless the viewer is a bankrupt farmer (who gets full transparent spectator view via `isBankruptSpectator`)
    - Bets are masked during `BETTING` (`_maskedBets`) — only the viewer's own bet amount is real; revealed once phase moves past `BETTING`
    - Computes `forceAllIn`/`allInAmount` (when a player's balance is too low to bet normally) and `myBalanceHistory` (per-round balance deltas for the fund-history UI)
  - `_broadcastState()` sends each player their own `getStateFor()` view via `state_update` — call this after any mutation that should be visible to clients (it's called on phase transitions including `REVEAL`/`FLIP`, not just `SETTLEMENT`)
- `GameLogic.js` — pure functions, no I/O, easy to test/reuse: `flipCoin`, `settle` (computes balance deltas + round events from bets/coin result), `accrueInterest`, `isBankrupt`, `validateBet` (enforces min-bet and force-all-in rules). All monetary results use `Math.ceil` — the game avoids fractional currency.

### Client (`client/src/`, React 19 + Vite)

- `store/gameStore.js` — single Zustand store; owns the WebSocket connection and is the only place that talks to the server. `connect(roomId, name)` opens the socket and sends `join_room`; `send(msg)` sends arbitrary typed messages; `handleMessage(msg)` is the inbound message dispatcher (handles `state_update`, `bets_revealed`, `coin_flipped`, `settlement`, `negotiation_*`, `chat`, loan events, etc.) and updates store fields like `gameState`, `coinResult`, `lastRoundResult`, `revealedBets`, `skipVotes`, `chatMessages`/`bankruptChat`. `username` persists to `localStorage` (`landlord_username`) independent of room/connection state; `leaveRoom()` resets room state but keeps `username`.
- `App.jsx` — three-level routing based on store state: no `username` → `Login`; no `roomId`/`playerId` → `Lobby`; otherwise → `GameBoard`.
- `components/GameBoard.jsx` — main game screen layout (`.main-grid`: left column = `GameTable` + `ActionPanel` + `ChatBox`; right column = `BalanceBar` + `PlayerList` + `RoundHistory` + `FundHistory`).
  - `GameTable` — central per-round visualization, renders different content per `phase` (own bet during BETTING, opponents' bet-placed status, revealed bets, coin flip result, settlement deltas/events)
  - `ActionPanel` — phase/role-driven action area: betting input during `BETTING`, negotiation skip-vote during `NEGOTIATION`, plus an always-present `BankPanel` section for loan requests/approvals
  - `PlayerList` — player cards with status dots; balances shown as `🔒` for other players per the server-side privacy rules
  - `BalanceBar` — the viewer's own balance as an HP-style bar
- All game state is server-authoritative — the client never computes settlement/balances itself, it only renders `gameState` (from `getStateFor`) plus a few transient broadcast-only fields (`coinResult`, `revealedBets`, `lastRoundResult`).

### Adding a new WebSocket message type

1. Server: add a `case` in `index.js`'s switch (dispatch to a `GameRoom` method), and call `room._broadcastState()` if other players' views need to update.
2. Client: add a branch in `gameStore.js`'s `handleMessage`, updating store state as needed.
3. If the change affects what a player can see/do, update `getStateFor()` in `GameRoom.js` to expose the right per-player fields rather than sending raw global state.
