# Connect Four Hackathon — Design

ACM UGA hackathon: teams get **60 minutes** to build a Connect Four bot, then the bots
compete in a projected tournament. ~10–15 teams expected. This document is the settled
design; see IMPLEMENTATION_PLAN.md for the build plan.

## The game

- **8×8 board, four in a row to win** (standard Connect Four rules, non-standard size).
- Why 8×8: standard 7×6 has a public perfect-play oracle (`connect4.gamesolver.org`) —
  a bot proxying it is a 10-minute cheat. No practical oracle exists for 8×8. (8×8 is
  solved on paper as a second-player win, but theoretical values are irrelevant at
  hackathon skill levels; no queryable database exists.)
- **Fairness by structure, not theory**: every match is **best-of-3** with alternating
  first player. Game 1's first mover (and sudden death's) is an arena coin flip,
  recorded in the game record.

## The bot model

A bot is a **stateless HTTP server**. The arena is the only client.

### Contract (JSON only)

```
POST /move
Content-Type: application/json

{
  "you": 1,                        // are you player 1 or 2 this game
  "board": [[0,0,...], ...],       // board[col][row], col 0 = left, row 0 = BOTTOM
                                   // 0 = empty, 1 = player 1, 2 = player 2
  "moves": [3, 4, 3],              // full move history (columns), convenience
  "game": {
    "match_id": "rr-007",
    "game_number": 2,              // 1-based within the match
    "clock_remaining_ms": 8420     // your remaining think budget this game
  }
}

→ 200 { "column": 4 }              // 0–7; must be a non-full column
```

```
GET /health → 200                  // readiness probe
```

- Bots listen on the **`PORT` env var** (templates default to 8000 for local dev).
- Bots must be **stateless between requests** — the full state arrives every request.
  This is load-bearing: it makes crash-restart safe (the request is simply re-sent).
- Templates pre-bake CORS: `Access-Control-Allow-Origin: *`, OPTIONS preflight
  handling, and `Access-Control-Allow-Private-Network: true` (Chrome PNA, required
  for the hosted testground page to reach `http://localhost`).

### Why HTTP (examined exhaustively)

The browser-based testground requires bots reachable from a web page; that admits only
HTTP and WebSocket. WebSocket loses on the zero-dependency rule (not in Python stdlib).
Rejected: stdin/stdout (kills browser testing; debug-print corrupts the protocol;
flush/buffering footguns), raw TCP (browsers can't), gRPC (toolchain burden),
exec-per-move, shared files, message brokers, WASM modules (toolchain burden).

## Time control & failure rules

**Chess clock: 10 seconds of total think time per bot per game.** Measured arena-side,
wall clock, request-sent → response-fully-received. The clock is the only judge:

| Event | Consequence |
|---|---|
| Clock hits zero | Forfeit that **game** |
| Invalid move (full/out-of-range column, malformed JSON, non-200) | Forfeit that **game** |
| Container crash (incl. OOM-kill) | Arena restarts it; **restart time billed to that bot's clock**; the move request is re-sent. Crash-looping drains the clock to forfeit. |
| Initial pre-match startup | **Free** — arena starts both containers and waits on `/health` off-clock (fair to JVM-class runtimes) |
| Not healthy within 30 s grace at match start | Forfeit the **match** (broken submission, not a slow one) |
| Draw (board fills) | Counts for neither; a tied best-of-3 goes to sudden-death games, first mover random |

## Tournament structure

1. **Full round-robin** (everyone plays everyone, best-of-3) runs headless after the
   submission freeze. Standings by match wins; tiebreaks: head-to-head → total game
   wins → coin flip.
2. Standings seed a **single-elimination bracket** (16 slots, scales to 32 if needed —
   never cap registrations). Top seeds get the byes; bracket arranged so seeds 1 and 2
   can only meet in the final.

Rejected: random-seeded single elim (bye lottery, half the field out after one match),
round-robin only (no final, no drama), Swiss (its purpose is economizing matches;
headless matches cost milliseconds — pure added complexity here).

## Architecture: compute and theater are decoupled

**Everything on the projector is a replay of finished computation.** Bots answer in
milliseconds; the match engine runs the whole tournament headless (parallel matches),
and the presenter replays it at a dramatic pace. The audience is not told, and cannot
tell. Show flow: round-robin ticker (results streaming in, leaderboard reshuffling) →
standings reveal → bracket rounds with featured game replays → full replay of the final.

### The game-record contract (the load-bearing interface)

The **game-record JSON file is the ONLY interface between the match engine and the
presenter.** Schema lives in `packages/contract`. The match engine's entire output is a
directory of these files — one per match, fully self-contained: teams, coin flips,
every move with per-move think time, clock events, restarts, forfeits, outcome. The
presenter's entire input is that directory. No shared DB, no sockets between them.

Consequences (all deliberate):
- Presenter is developable/rehearsable against **synthesized fixture data** weeks early.
- Match engine is testable headless by asserting on emitted JSON.
- Cloud execution is trivial: run remotely, copy a folder of JSON down.
- The tournament is archivable and replayable forever.

### Execution environment

- Fresh containers per match, orchestrated via the Docker API.
- Caps: **1 CPU** (pinned — keeps chess clocks fair), **512 MB** memory (OOM = crash =
  billed restart), **`--network none`** (closes every online-cheat door at match time).
- Up to 4 matches in parallel (needs 2 cores per match; arena auto-sizes to the host).
- Runs on the venue machine (Docker + HDMI to projector, presenter served from
  localhost) or a rented ~8-vCPU/16 GB cloud instance (~$1–2 total for the event);
  the match engine is fully driveable headless via CLI.

## The dev hour (teams' experience)

1. Clone the **public repo**, copy a starter template (Python, Node, TypeScript,
   Java, Go, C#, C++, C, Rust; each needs only its language's standard toolchain),
   edit exactly one function, `choose_move(board, you) -> column`, in the template's
   bot file. The HTTP server, CORS/PNA, and JSON parsing live in a separate server
   file and are pre-written.
2. Test in the **hosted browser testground** (static page on Cloudflare Workers):
   enter `http://localhost:8000`, watch games render live against **practice bots** —
   `random`, `greedy` (take wins, block losses), `minimax` (shallow) — which are
   server-side (Cloudflare Worker, same `/move` contract, source private).
3. Push to their own GitHub repo. The template ships a **GitHub Actions smoke test**:
   build the Docker image, start it, POST a sample `/move`, assert a legal response.
4. Submit repo URL via a **UGA-restricted Google Form** (team name + URL; the response
   sheet is the roster — no accounts, no registration system).
5. Arena `validate` command (pull all → build → smoke game) runs at **T-30, T-15,
   T-5**; failures announced to the room. USB fallback for submission emergencies.

The venue LAN is trusted for nothing: dev testing is browser→localhost, practice bots
and testground are public internet, submissions travel via GitHub, and the presenter
runs on the projector machine itself.

## Source layout

**Private pnpm monorepo** (this repo — one workspace, no cross-repo dependencies):

```
apps/
  match-engine/   # headless orchestrator: Docker lifecycle, chess clocks,
                  # round-robin + bracket, parallel pool → emits game records. CLI.
  presenter/      # projector app: ticker, standings, bracket, replay player
  testground/     # static site for teams (deploys to Workers; shares board renderer
                  # with presenter)
  practice-bots/  # random/greedy/minimax behind the /move contract (deploys to Workers)
packages/
  engine/         # pure game rules: board, legal moves, win/draw detection. Zero I/O.
  contract/       # bot API types/schemas + game-record schema. The spec, as code.
  board-ui/       # framework-free DOM/canvas board renderer, shared by presenter
                  # and testground
  samples/        # private sample bots run through the real Docker/match-engine
                  # path (materialize -> tournament -> validate -> bundle);
                  # see samples/<slug>/ at the repo root for the bot files
```

**Public repo** (deliberately boring; lives at `../c4-hackathon`): `templates/`
(starter kits incl. Dockerfile + CI workflow) and a `README.md` that IS the contract
spec. No build step, nothing to explain during the 60 minutes.

## Decision log (roads not taken)

- **Bots as HTTP clients polling a shared arena** — killed by untrusted venue LAN.
- **Shared LAN arena for practice** — same. Replaced by hosted testground + localhost.
- **stdin/stdout protocol** — see transport analysis above.
- **XML or multi-format support** — no language lacks JSON; formats multiply bugs.
- **Per-move timeout** — replaced by chess clock (bounds total compute, one rule).
- **"One restart then forfeit"** — replaced by clock-billed restarts (no magic numbers).
- **Swiss / random-seeded elimination** — see tournament section.
- **10×10 "unsolved" board** — unsolved ≠ balanced; buys nothing at this skill level.
- **Cross-repo shared packages (git deps/subtrees)** — dissolved by keeping all code
  private and publishing only artifacts (testground page) and materials (templates).
- **Genuinely live final** — all-replay, no exceptions; one presenter model.
