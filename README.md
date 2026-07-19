# Superpower Visualizer

**English** | [繁體中文](README.zh-TW.md)

A local web app that **watches and steers** a Claude agent while it works. The UI *is* the
commander: it launches and drives the agent through the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), renders its tool calls, subagents,
and skills live as an interactive tree plus an activity log, and lets you **approve / deny**
permissioned tools before they run, **pause** at any time, or **send a new task**.

**Two modes (one server, one UI, switched from the "source" dropdown in the header):**

- **Control (Route B)** — the UI launches the agent itself via the Agent SDK; you can approve /
  pause / send tasks.
- **Observe (Route A, read-only)** — watch **another coding agent's session**, rebuilt live into
  the same interactive tree + conversation. Two systems are supported (pick the system first in the
  dropdown):
  - **Claude Code** — reads `~/.claude/projects/<slug>/<session>.jsonl` (main file + `subagents/`).
  - **Antigravity** (Google) — reads `~/.gemini/antigravity/conversations/<id>.db` (SQLite, with
    protobuf-encoded steps); each tool carries its own `toolAction`, used directly as the ReAct
    "thought". v1 is flat (one conversation = one agent block).
  Because a transcript is a historical record, observe mode has no approval prompts and can't pause
  or send tasks (the input box shows "observing (read-only)").

```
┌─────────── Browser (:5173) ──────────┐         ┌──────── Backend (:3001) ─────┐
│  Tree  │  Activity log │ Approvals │… │         │  Express + WebSocketServer   │
└───────────────┬──────────────────────┘         │  SessionManager ── canUseTool │
                │  WS event stream (down, w/ seq)  │        │                      │
                │◀─────────────────────────────────┤   translate() → SnapshotStore │
                │  HTTP /start /control (up)        │        │                      │
                └─────────────────────────────────▶│   Agent SDK query()  ─────────┼──▶ real agent
                                                    └──────────────────────────────┘
```

- **Downstream**: events pass through `translate()` (Route B stream) or `translateTranscript()` /
  `translateAntigravity()` (Route A transcripts), land in the `SnapshotStore` (with a monotonic
  `seq`), and are broadcast over WebSocket. On reconnect the server sends a snapshot first, then
  incremental events; the client dedupes by `seq`.
- **Upstream**: approve / pause / send-task via POST `/control`, start via POST `/start`; switch
  source via POST `/observe`, `/new-agent`; list sessions via `GET /sessions?system=`.
- **The backend is the single source of truth.** Exactly **one** session is observed / controlled at
  a time, with switching managed by `SourceController`.

## Requirements

- Node.js 18+ (tested on v24)
- **A logged-in Claude Code CLI** — the Agent SDK reuses its credentials, so **no `ANTHROPIC_API_KEY`
  is needed**. To confirm: `claude --version` producing output means it's installed and logged in.

## Install

```bash
# Backend (repo root)
npm install

# Frontend
cd web && npm install && cd ..
```

## Run

Open **two terminals**, one for the backend and one for the frontend (both must stay running):

```bash
# Terminal 1 — backend (:3001), from the repo root
npm run dev

# Terminal 2 — frontend (:5173)
cd web && npm run dev
```

Open <http://localhost:5173>; a green 🟢 "connected" in the top-right means the backend is wired up.

**To stop:** `Ctrl+C` in each terminal. If a port is stuck (EADDRINUSE :3001), find and kill the
leftover process:

```bash
# Find the PID holding 3001, then kill it (5173 is the same)
netstat -ano | grep ":3001" | grep LISTENING
powershell -Command "Stop-Process -Id <PID> -Force"
```

## Usage

The **"source"** dropdown in the top-right decides which mode you're in:

### A. Control mode (Route B) — launch and direct an agent yourself

1. Make sure the source dropdown shows "**control mode**" (the default; if you're observing, open the
   dropdown and pick "＋ New Agent (control)" to switch back).
2. Type a task in the box at the bottom, e.g. `Use Grep to find all .ts files and summarize them with
   a subagent`, and hit "Send" to start.
3. The left "Agents" panel grows nodes live (status: ⏳ running · 🟡 awaiting approval · ✅ done ·
   ❌ / 💥 error); the right "Conversation" shows the agent's replies.
4. When the agent wants a **permissioned tool** (Bash / Write / Edit, etc.) an **approval dialog pops
   up** — "Approve" to allow, "Deny" to block. (Read-only tools like Read / Grep auto-run under the
   default permission mode without prompting.)
5. "Pause" aborts the current run; after starting, typing again and sending = **a new task** (queued
   into the agent's input).

**Setting the agent's working directory:** it operates in `process.cwd()` by default (the directory
you ran `npm run dev` from). To point it at **another** project, set `AGENT_WORKSPACE` (relative paths
for Read / Write / Bash resolve against it); the header shows the current working directory:

```bash
AGENT_WORKSPACE="D:/path/to/target-project" npm run dev
```

### B. Observe mode (Route A) — read-only watching of another coding agent

1. Open the "source" dropdown → **pick a system first**: "Observe a Claude session" or "Observe an
   Antigravity conversation".
2. That system's sessions are listed (sorted by last-modified):
   - Claude: shows the project slug + subagent count (from `~/.claude/projects`).
   - Antigravity: shows the role identity (orchestrator / explorer …) + step count (from
     `~/.gemini/antigravity/conversations`).
3. Pick one → it's rebuilt instantly into the interactive tree + conversation; if that session is
   **still running**, newly appended content streams into the view live (Claude polls the transcript
   for new lines; Antigravity polls new steps using `steps.idx` as a cursor).
4. Observe mode is **read-only**: the header switches to "observing (read-only)", the input is
   disabled, and there are no approval prompts or pause (a transcript is a historical record).
5. To watch **your own current Claude session**, pick the top entry in the Claude list — the one whose
   time shows "just now".
6. Pick "＋ New Agent (control)" to return to control mode (the view clears, ready for a new task).

> **Antigravity's reason**: each tool step carries both `toolAction` (the *why*) and `toolSummary`
> (the *what*), which feed the "💡 Thought" and "🔧 Action" lines respectively. Antigravity usually
> bundles the thought and the action into the same step, so no tools are lost. The transcript is
> protobuf; v1 uses a generic extractor (no `.proto` needed), and the model's long-form thinking is
> not shown for now (to avoid file contents bleeding in).

> On a source switch, the backend calls `store.reset()` and re-sends a full snapshot; the client
> replaces everything, so no nodes leak from the previous session.

### Reading the left "Agents" panel — list + popup

The left panel is an **agent list** (main agent + each subagent); each row shows its name / status /
step count / subagent count. **Click any row → a centered popup** opens with that agent's full task.
The popup lists the subagents it dispatched as chips at the top (click a chip to switch within the same
window), and its header has prev / next plus a "`current / total`" position — use `←` `→` or the arrow
keys to move between agents, and `Esc` / clicking the scrim / ✕ to close.

Every step inside the popup follows the ReAct paradigm so you can see **why** the agent did what it did:

- 💡 **Thought (reason)** — the narration just before the agent acts (e.g. "let me look at the project
  structure to check whether it's empty"). One reason is shown once per **batch** of tools.
- 🔧 **Action** — the tool and its key arguments (Bash command / filename / skill name / MCP…); the dot
  on the left is the status (running / done / error).
- **Result summary** — the first line of the tool's output (truncated if long); click "▸ Expand
  output" for the full result.

> The reason comes from the agent's own narration text (present in both control and observe modes). The
> model's inner "extended thinking" is redacted (empty) in transcripts and can't be shown. A tool with
> no preceding narration simply shows the action only — that's normal.

**Reasonableness analysis (⚖):** inside the popup, click **"分析合理性" (Analyze reasonableness)** to
send *this agent's* ReAct trace to a **separate Claude** (an independent review session — it does not
touch the observed/controlled agent). It returns a structured verdict — **妥當 / 有疑慮 / 有問題**
(sound / questionable / problematic) — a short summary, and a list of findings, each with a severity
(high/med/low), the step it points at (click to jump + highlight the matching work item), and a
suggested fix. Runs through a stateless `POST /analyze` endpoint; results are cached per agent for the
session (not persisted). Works in both control and observe mode.

The right "Conversation" panel keeps only the **real dialogue**: your task instructions + the agent's
summaries/answers to you (the step-by-step detail lives in the left-side popup, so it no longer floods
the chat).

## Tests

```bash
npm test            # backend unit tests (vitest, 66)
cd web && npm test  # frontend unit tests (vitest + jsdom, 33)
```

Type-check: `npx tsc --noEmit` (in the root and `web/` separately).

## End-to-end check

```bash
# Start the backend first (npm run dev), then in another terminal:
npx tsx spike/e2e.ts
```

`spike/e2e.ts` simulates the frontend running the full loop: connect WS → `/start` → auto-approve on
`await:tool` → watch nodes turn `done`. `spike/probe.ts` (`npm run spike`) instead prints raw
SDKMessage shapes, used to calibrate assumptions about the SDK.

## Project layout

```
src/                    backend
  server.ts             Express + WebSocketServer; /start /control /sessions /observe /new-agent; sends snapshot on connect
  sourceController.ts   manages "source + mode": control (Route B) ↔ observe (Route A) switching, reset + re-send snapshot
  sessionManager.ts     Route B state core: start, canUseTool approval gate, pause, send-task (input queue)
  agentAdapter.ts       wraps Agent SDK query(); bridges abort, wires canUseTool's toolUseID
  translator.ts         pure fn: SDK stream SDKMessage → frontend events (tree node / status / log / narration)
  translateTranscript.ts pure fn: one Claude transcript record → frontend events (parentId passed in)
  reactAssembler.ts     pairs assistant narration into a tool's reason (thought→action); flushes unpaired ones as conversation summaries
  transcriptSource.ts   Claude Route A tailer: backfill + poll new lines + subagent child-file linking; pickLatestSession
  sessions.ts           lists observable sessions under ~/.claude/projects (listSessions); firstCwd for working dir
  sourceSystems.ts      dispatches by system (claude/antigravity): observe source, working dir, session listing
  antigravityProto.ts   protobuf step decoder for Antigravity conversation .db (generic extraction, no .proto)
  translateAntigravity.ts pure fn: one decoded step → frontend events (toolSummary→action, toolAction→reason)
  antigravitySource.ts  Antigravity Route A tailer: opens the .db, polls new steps using steps.idx as a cursor
  antigravitySessions.ts lists conversations under ~/.gemini/antigravity/conversations (identity / step count / working dir)
  snapshot.ts           SnapshotStore: applies events, maintains seq / nodes / logs / messages; reset()
  types.ts              shared types (FrontendEvent / TreeNode / ControlCommand …)
web/src/                frontend (Vite + React)
  store.ts              pure reducer applyPacket: snapshot init + seq dedupe + event apply + mode
  buildAgentBlocks.ts   flat nodes → one block per agent (expandable tools / MCP, subagents as child blocks)
  useSession.ts         WebSocket lifecycle (1s reconnect) + control/switch commands + optimistic updates
  components/           AgentList · AgentModal · Conversation · ApprovalModal · SourcePicker
docs/superpowers/       design specs and implementation plans
NOTES.md                SDK / transcript notes (findings calibrated from spike experiments)
```

## Known limitations

- **Observe mode (Route A) is read-only**: a transcript is a historical record with no pending
  approvals, so there's no approval dialog and no pause / send-task while observing. Only control mode
  (Route B) can intervene.
- The backend snapshot **does not include pending approvals**. In control mode, if "an approval was
  pending at the moment of disconnect", it can't be restored from the snapshot on reconnect (the
  frontend marks that node 🟡 awaiting as partial compensation). A full fix needs the backend to
  serialize pending approvals.
- **Control mode's "pause" is "abort the current run", not "resume the same conversation"**: pause
  interrupts the in-flight tool (its node turns error) and stops the agent; you can then start a **new**
  task from the input (pause has rebuilt the AbortController + cleared the input queue). But after an
  abort the SDK conversation is gone and can't be continued — to continue, use "send a new task"
  instead of pausing first (see `NOTES.md`).
- One session is observed / controlled at a time (fully swapped on switch); cost / token stats and a
  task board are deliberately out of scope (YAGNI).
```
