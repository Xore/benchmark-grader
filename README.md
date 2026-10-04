# benchmark-grader

A Bun + React 19 review dashboard for LLM coder-benchmark runs. Reads benchmark
run data from disk and serves an Astryx UI for browsing runs, coder artifacts,
compile diagnostics and per-case human grades.

## Start

```sh
bun install
bun run serve
```

Serves `http://localhost:3020`. That is the only command needed.

`bun start` is an alias for the same thing. `bun run dev` is the `--hot`
watch-mode variant.

## Data-directory contract

Two directories, and the split is the whole design: **the runner writes one,
the dashboard writes the other.**

### `RUN_DIR` — read-only, owned by the benchmark runner

Default `/tmp/smoke-tr`. Override with `RUN_DIR=/path/to/runs bun run serve`.

```
$RUN_DIR/<runId>/
  run.json                    # run metadata (schema apiary-benchmark-transcript-v1)
  transcripts.jsonl           # one JSON record per model attempt
  human-grades.json           # runner's own grades -- NEVER written by the dashboard
  coder-artifacts/
    <model-tag>/
      <file>                  # e.g. rust-scanner-jsonl-summary.rs
      compile-report.json
      <tier>/source-manifest.json
```

Every artifact path the UI shows resolves to a real file under `$RUN_DIR`.
The server refuses to serve a run whose `transcripts.jsonl` it cannot read.

### `grades.json` — write, owned by the dashboard

Lives next to `serve.ts` in the repo root, **not** in `$RUN_DIR`. Grades and
line notes are dashboard-owned, keyed by run id then by `<caseId>:<path>`:

```json
{"<runId>": {"files": {"<caseId>:<path>": {
  "score": 1, "note": "...", "at": "<iso>",
  "lineNotes": [{"lineStart": 3, "lineEnd": 9, "note": "..."}]
}}}}
```

This is why the runner's `human-grades.json` is never overwritten. It is an
input and stays an input.

## Endpoints

| Method | Route                   | Purpose                                  |
|--------|-------------------------|------------------------------------------|
| GET    | `/api/runs`             | Run ids with record and case counts      |
| GET    | `/api/run/<runId>`      | Cases, attempts and artifacts for a run  |
| GET    | `/api/grades`           | All dashboard grades                     |
| POST   | `/api/grades`           | Upsert a score, whole-file note, or line note |
| GET    | `/api/rubric`           | Full rubric JSON (`RUBRIC` env)          |

Per-case rubric (`bucket`, `max_score`, `pass_anchors`) is attached to
`/api/run/<runId>` output and rendered in the inspector's **Rubric** tab, so the
reviewer grades against the frozen anchors rather than from memory.

POST body: `{run, file, score?, note?, lineStart?, lineEnd?}`. A body carrying
`lineStart` writes a line-anchored note; otherwise it upserts the whole-file
grade.

## Verifying

```sh
bunx tsc --noEmit                  # typecheck
bunx astryx doctor                # setup health
bun run verify:ui                  # real-browser render gate
```

`verify:ui` needs a Chrome on the debug port:

```sh
google-chrome --headless=new --remote-debugging-port=9222 --no-sandbox about:blank &
bun run verify:ui
```

It drives real mouse clicks through every case tab, asserts the source pane
renders real code at a sane width, asserts all three stylesheets loaded, and
exits non-zero on any console or uncaught error. This is the check that catches
a conditional-hook regression — it reproduced the original "crashes when I
click Source" report, which a fetch-based smoke test cannot see. Override the
host with `UI_HOST=` if `192.168.42.253` is not this machine's LAN address.

## Environment

| Variable | Default                                          |
|----------|--------------------------------------------------|
| `PORT`   | `3020`                                           |
| `RUN_DIR`| `/tmp/smoke-tr`                                  |
| `RUBRIC` | APIARY `coder_cases_v1_rubric.json` in-repo path |

## Honesty rules baked in

- An empty run renders as empty. No placeholder model output, ever.
- The Transcript pane shows the model's own `response.raw` per attempt (with
  timing: output tokens, tok/s, done_reason). Attempts whose `raw` is empty say
  `(empty response)` rather than being hidden.
- When a case has no artifacts, the transcript pane says **why**: either the
  runner has not written `coder-artifacts/` yet, or every attempt recorded an
  empty `response.raw` (a failed model parse). Those are different states and
  they are not conflated.
- `source-manifest.json` is rewritten per case, so it only ever describes the
  last case written. Files whose stem is not a known case id land in an explicit
  `(unattributed)` bucket instead of being mislabelled against a case.

## Layout

- `serve.ts` — Bun server: run loading, artifacts, grade store
- `src/dashboard.tsx` — the UI, adapted from the official Astryx IDE scaffold
- `src/data.ts` — API types and fetch helpers
- `src/shiki-tokenizer.ts` — Shiki tokenizer for `CodeBlock`
- `src/answer-chunks.ts` — splits raw model answers into prose/code chunks
- `src/app.tsx` — bootstrap, default neutral Astryx theme
- `src/index.html` — links reset.css → aistryx.css → theme.css
- `tmpl/` — Astryx template references (shell-nav, ai-chat, file-explorer, ide)
- `verify.ts`, `server.ts` — older verification helpers, not used by `serve.ts`
- `AGENTS.md` — generated by `astryx init`

## UI rules

Built only through the Astryx CLI: no hand-rolled components, no custom CSS, no
authored theme. Layout comes from `bunx astryx template`, component APIs from
`bunx astryx component <Name>`. The three stylesheets must load in the order
above or components render unstyled.
