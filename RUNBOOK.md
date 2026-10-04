> **Status: superseded.** This is the planning runbook for the Astryx scaffold
> work. The shipped app is documented in [`README.md`](README.md), which is
> authoritative for the start command (`bun run serve`), the `RUN_DIR` data
> contract, and the verification gates. Kept for the record of how the surface
> was built.

# RUNBOOK — Grader Dashboard (standalone, Bun + Astryx only)

Toolchain: **Bun** (runtime/build/start) · **Astryx 0.6.5** (components, default theme only).
CLI is the only sanctioned way to discover or adjust anything: `bunx astryx <cmd>`.

Spec source: "Grader Dashboard: Handoff Brief" (this run). Supersedes the earlier
ide-frame runbook; `src/Grader.tsx` was dropped and is rebuilt from the named templates.

## Hard constraints (from the brief — pass/fail, not preferences)

1. **Astryx components only.** No hand-rolled button, tab, tree, chat bubble or code
   block. **If a needed component does not exist, stop and ask.**
2. **Default theme only.** No custom or generated theme, no raw hex/px.
3. **New dashboard.** Do not patch or extend the old one.
4. **Template bases:** `shell-nav` (app shell + file explorer), `ai-chat` (chat view),
   plus whatever else fits from the template list.
5. **Single Bun command starts it.** `bun run dev`. Documented in README.

## Required features (brief §Required Features)

| # | Feature | Acceptance check |
|---|---|---|
| 1 | Model selector; nav shows only the selected model's runs + files | No all-models list anywhere |
| 2 | File explorer tree of the selected run's files; open any file in main view | Tree works |
| 3 | Every source file syntax-highlighted, in file view **and** every code tab; language from extension | No unhighlighted code block |
| 4 | Chat view = real chat window, user + assistant messages, tool calls/results as structured elements, **every** code snippet wrapped in a highlighted block | All snippets wrapped |
| 5 | Per-file grading + grade-all-files; persist to disk; editable later; overview per model and per run | Grades survive restart |

## Data sources — LOCATED (brief §Data Sources asked first)

Real run data found; no mock data.

```
/tmp/smoke-tr/2026-10-04-20261004T012309Z-710e1c68/
├── run.json                benchmark=honeypot-stack-issue-158-v2, operator=hermes,
│                           provenance=live_model, schema=apiary-benchmark-transcript-v1
├── transcripts.jsonl       47 records, workflow=coder_generation
├── human-grades.json       existing grades
└── coder-artifacts/qwen3:8b/  19 files (.rs .py .php .c .sh + compile-report.json)
```

Runs without artifacts: `…T230236Z-8ba8b84e`, `…T010903Z-ef5b84e3`, `…T010918Z-c0ad6eba`.

Transcript record shape (verified, `apiary-benchmark-transcript-v1`):
`case`, `round`, `workflow`, `recorded_at`, `outcome`, `provenance`, `claim_ids`,
`model{tag,family,parameter_size,quantization}`,
`timing{done_reason,output_tokens,prompt_tokens,tokens_per_second,wall_seconds}`,
`request{body{tools,options},system_prompt,user_prompt}`,
`response{raw,parse_ok,parsed}`, `reproducibility{prompt_contract{…}}`,
`slot`, `operator`, `error`.

Frozen rubric: `/home/xore/Github/APIARY/analysis/ghidra/benchmarks/corpus/coder_cases_v1_rubric.json`
— 44 cases, `cases` keyed by id, each with `bucket`, `max_score`, `pass_anchors`;
total `max_score` 176, 4 checks/case, `mode: human`.

Known quirk: some records carry a top-level `answer` instead of `response.raw`
(older/flattened shape). Support both.

## The 3-step contract (docs/working-with-ai) — this is the whole thing

Before writing any UI code, in this order:

1. `astryx template --list` — find a related page pattern
2. `astryx template <name> --skeleton` — study the layout
3. `astryx component <Name>` — read props for every component used

The docs state these three questions have a **0% pass rate** without the agent
docs: (1) correct import path for Button, (2) how to make a Dialog
non-dismissible, (3) what prop Selector uses for its items. If unknown →
`npx @astryxdesign/cli init --features agents` and read the generated file.

**Run `init --features agents` after every Astryx version bump.** It updates in
place. Cursor needs `--agent-docs-path ~/.cursor/rules/xds.mdc` (project rules
get picked selectively; User Rules always apply).

### `astryx` npm script alias — prevents silent CLI failures

Agents habitually call the wrong binary path and fail silently. Add:

```json
"scripts": { "astryx": "node node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs" }
```

Flags need `--`: `npm run astryx -- template --list`.

### `--dense` on every command

Token-efficient output meant for AI context windows. Use it whenever CLI output
enters a context: `astryx component Dialog --dense`, `astryx docs tokens --dense`.

### MCP server — register this

```json
{ "mcpServers": { "xds": { "type": "url", "url": "https://astryx.atmeta.com/mcp" } } }
```

Tools: `search(query)` and `get(name)`. Not currently registered on this box.

### Batch component lookup — the cheapest existence check

`astryx component` is variadic. 2+ selectors → one ordered `component.batch`
receipt, max 100 selectors.

```bash
astryx --json component AppShell Layout LayoutPanel --props   # exit 0 = all found
```

Exit **1 if any row is not `found`** — that is the programmatic proof a
component exists before writing markup. A version qualifies the package, never
the component (`@acme/widgets@1.2.3/Button`). `astryx discover` is free-text and
is NOT a batch selector.

### Template writing rules

`astryx template` copies **exactly one file** — no sibling helpers, stylesheets,
fonts or icons. Keep every editable helper **in the same file**. Default-export
one React component; named helpers are fine. `'use client'` only when hooks,
handlers or browser APIs need it.

## Frame — from the official docs (docs/layout), NOT from template choice

The docs are explicit: *"Decide the frame before writing any content… Content-first
layout produces a padded scroll column that reads as a prototype, not a product."*
This dashboard is a multi-pane tool, so the frame is **AppShell + Layout +
LayoutContent + LayoutPanel**, not a template's opinionated shell.

```tsx
// Responsive contract (write this at the frame root, per docs/layout):
// > 1024px   side nav 256 | content flex | inspector 380 (resizable 320–480)
// <= 1024px  inspector overlays content (end-aligned, absolute)
// <= 768px   side nav collapses into the mobile drawer; toolbar actions wrap

<AppShell sideNav={<SideNav>{/* TreeList of the selected run's files */}</SideNav>}
          contentPadding={0}>
  <Layout>
    <LayoutContent>{/* per-case chat, dense, edge-to-edge */}</LayoutContent>
    <LayoutPanel width={380} resizable={{minSizePx: 320, maxSizePx: 480}}
                 hasDivider label="Inspector">
      {/* grade + notes for the selected file; EmptyState when nothing selected */}
    </LayoutPanel>
  </Layout>
</AppShell>
```

Region budgets from the docs: side nav 240–280, inspector 340–420, filter rail
220–260. Ours: nav 256, inspector 380.

**Container policy.** The file tree and the case list are dense data → rows
(`TreeList`, `List/Item`), never Card-wrapped. `Card` is for standalone widgets
only (the grading-summary tile). `StatusDot`/`Token` for status; `Badge` for
counts only. `EmptyState` inside a region when a filter matches nothing.

## The 3 stylesheets are mandatory (docs/getting-started)

```css
@import '@astryxdesign/core/reset.css';
@import '@astryxdesign/core/astryx.css';
@import '@astryxdesign/theme-neutral/theme.css';
```

All three. Themes supply every token as CSS custom properties; without them
components render unstyled. Pair with `neutralTheme` from
`@astryxdesign/theme-neutral/built` (pre-compiled path) — not both that and the
runtime-injection import.

**Serving gotcha, already hit and fixed once:** `core` ships `astryx.css` in
`dist/` and `reset.css` in `src/`, resolved through the package `exports` map,
NOT at the package root. `serve.ts` resolves `/node_modules/*` with
`Bun.resolveSync`. A root-relative guess 500s every sheet and the page renders
unstyled with no console error — verify all three return 200 before believing
anything about the UI.

## Styling rules (docs/styling)

- Component props first. No `style={{}}` on wrappers, no raw `<div>` for spacing.
- `xstyle` takes `stylex.create()` output, never an inline object. **But** this
  project has no StyleX compiler (see AGENTS.md) — so `xstyle` is out; use token
  values via props.
- No hardcoded colors or spacing: `var(--color-*)`, `var(--spacing-*)`.
- No `!important`. Every `:hover` must be inside `@media (hover: hover)`.
- Bare modifier classes (`.primary`, `.sm`) are deprecated; use `data-variant` /
  `data-size` or component props.

## Canonical CLI invocations — no hand-rolling

```bash
bunx astryx init --features agents,theme,template   # agent docs + theme template
bunx astryx build "<description>"                    # kit: template + blocks + components
bunx astryx template <name> <path>                  # scaffold verbatim
bunx astryx template <name> --type block            # print a block to place in a section
bunx astryx component <Name>                        # props BEFORE using or changing
bunx astryx hook <name>                             # hook props (useResizable)
bunx astryx search "<query>"                        # neutral lookup of anything
bunx astryx theme list                              # default theme only
bunx astryx doctor                                  # must stay 0 fail
bunx astryx docs layout --index
```

Rules: keep the template's frame, gap and padding; replace only data, copy and sections.
No `<div>`/raw HTML for layout. No `style={{}}` for values — props and tokens only.
Wrap in `<Theme theme={...}>` + core `reset.css`/`astryx.css`.

## Phase 0 — Preflight

- [x] Real data located
- [x] `astryx init --features agents,theme,template` run
- [x] `astryx doctor` 11 pass / 0 fail
- [x] Old `src/Grader.tsx` dropped
- [ ] `astryx template --list` → confirm `shell-nav` and `ai-chat`
- [ ] Scaffold `shell-nav` → app shell + file explorer
- [ ] Scaffold `ai-chat` → chat view

## Phase 1 — Template scaffolds (brief §4)

- [ ] `bunx astryx template shell-nav <path>` — keep frame/spacing
- [ ] `bunx astryx template ai-chat <path>` — keep frame/spacing
- [ ] Third template only if the data model needs it; justify in the log

## Phase 2 — Bun service (new; the old server.ts is not reused)

- [ ] New server entry serving the SPA + data API over the located run dirs
- [ ] Routes: models, runs-for-model, file tree, file body, transcript/turns, grades GET+POST, grade-all
- [ ] Path-traversal guard on file reads (trust boundary — not negotiable)
- [ ] `bun run dev` starts it; port documented

## Phase 3 — Features, each closed against the brief

- [ ] F1 model selector — nav shows only that model's runs/files
- [ ] F2 file explorer tree → open file in main view
- [ ] F3 highlighting everywhere, language from extension
- [ ] F4 chat window: user/assistant, tool calls + results structured, all snippets wrapped
- [ ] F5 grading: per-file, grade-all, persisted to disk, editable, overview per model and run

## Phase 3b — review quality (owner addition)

Grading is not enough; the review itself must be commentable.

1. **Grade every file / every source file** — a grade control on each artifact in
   both the file view and every chat code block, not just the tree node.
2. **Notes on a whole file** — free-text note attached to `<case>:<path>`, persisted
   with the grade.
3. **Notes on specific line ranges** — select a start/end line in the file view;
   CodeBlock's `highlightLines` (1-indexed, verified via
   `bunx astryx component CodeBlock`) marks the range and the note is keyed
   `(file, lineStart, lineEnd)`. Lines, ranges and whole-file notes are three
   note scopes — one storage shape, not three features.
   Note: CodeBlock has no built-in click-to-select-lines or inline annotation
   layer. If no Astryx component provides one, **ask the owner before
   hand-rolling** (brief §Hard Constraints 1).

## Phase 4 — Impeccable (after the above is green)

Scope is the WHOLE surface, not a single page: dashboard, every component, every
subpage/view (Cases, File, Overview), the layout frame, and the navigation
(nav tree, model selector, tabs, command palette).

Order: `detect` → `audit` → `critique` → `polish` → `harden`, then APPLY the
critique — a critique that is not acted on is not a deliverable. Re-run all gates
after applying and report before/after deltas.

## Gate — every brief point (brief §Working Method)

- [ ] No custom CSS or hand-rolled components remain
- [ ] Theme is the default one
- [ ] All code highlighted everywhere (file view + every code tab)
- [ ] Only the selected model is shown in the nav
- [ ] File tree works
- [ ] Grades persist after a restart
- [ ] Grade control on every file, in file view AND chat
- [ ] File-level and line-range notes persist and reload
- [ ] Single Bun command documented in README

## Log

| Step | Result |
|---|---|
| Dropped old `src/Grader.tsx` | done |
| Data located | `…T012309Z-710e1c68`: 47 records, 19 artifact files |
| `astryx init --features agents,theme,template` | ok |
| `astryx doctor` | 11 pass / 0 warn / 0 fail |