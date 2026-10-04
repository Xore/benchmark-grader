# Graph Report - benchmark-grader  (2026-10-04)

## Corpus Check
- 27 files · ~28,870 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 236 nodes · 300 edges · 19 communities (17 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6c5c4cf2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- answer-chunks.ts
- package.json
- compilerOptions
- ai-chat.tsx
- neutralTheme.ts
- shiki-tokenizer.ts
- file-explorer.tsx
- shell-nav.tsx
- verify.ts
- dependencies
- server.ts
- dashboard.tsx
- neutralPalettes.ts
- RUNBOOK — Grader Dashboard (standalone, Bun + Astryx only)
- serve.ts
- benchmark-grader
- verify-ui.ts
- theme.template.ts

## God Nodes (most connected - your core abstractions)
1. `RUNBOOK — Grader Dashboard (standalone, Bun + Astryx only)` - 17 edges
2. `ResizableWorkspacePage()` - 13 edges
3. `compilerOptions` - 12 edges
4. `benchmark-grader` - 9 edges
5. `loadRun()` - 8 edges
6. `react` - 7 edges
7. `scripts` - 6 edges
8. `fetch()` - 6 edges
9. `json()` - 6 edges
10. `The 3-step contract (docs/working-with-ai) — this is the whole thing` - 6 edges

## Surprising Connections (you probably didn't know these)
- `ResizableWorkspacePage()` --calls--> `chunkAnswer()`  [EXTRACTED]
  src/dashboard.tsx → src/answer-chunks.ts
- `ResizableWorkspacePage()` --calls--> `tokenize()`  [EXTRACTED]
  src/dashboard.tsx → src/shiki-tokenizer.ts
- `ResizableWorkspacePage()` --calls--> `bytesOf()`  [EXTRACTED]
  src/dashboard.tsx → src/data.ts
- `ResizableWorkspacePage()` --calls--> `linesOf()`  [EXTRACTED]
  src/dashboard.tsx → src/data.ts
- `ResizableWorkspacePage()` --calls--> `listRuns()`  [EXTRACTED]
  src/dashboard.tsx → src/data.ts

## Import Cycles
- None detected.

## Communities (19 total, 1 thin omitted)

### Community 0 - "answer-chunks.ts"
Cohesion: 0.53
Nodes (5): Chunk, chunkAnswer(), codeScore(), isCode(), isSentence()

### Community 1 - "package.json"
Cohesion: 0.07
Nodes (28): astryx, theme, devDependencies, @astryxdesign/cli, @types/bun, @types/react, @types/react-dom, typescript (+20 more)

### Community 2 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, paths (+5 more)

### Community 3 - "ai-chat.tsx"
Cohesion: 0.17
Nodes (8): AIChatConversationTemplate(), articleBody, artifactPanelWidthVar(), artifactScroll, chatColumn, chatLayout, MENTION_TOKENS, root

### Community 4 - "neutralTheme.ts"
Cohesion: 0.13
Nodes (13): react, iconProps, neutralIconRegistry, neutralPaletteRefs, neutralLocalTokens, neutralSyntax, neutralTheme, statusFill (+5 more)

### Community 5 - "shiki-tokenizer.ts"
Cohesion: 0.21
Nodes (10): ALIAS, cache, GRAMMARS, ready(), requireHighlighter(), SCOPE_MAP, scopeToType(), Token (+2 more)

### Community 6 - "file-explorer.tsx"
Cohesion: 0.22
Nodes (10): columnRow, detailColumn, FileExplorerPage(), FILESYSTEM, FileSystemItem, findItem(), fixedColumn, getFileExtension() (+2 more)

### Community 7 - "shell-nav.tsx"
Cohesion: 0.18
Nodes (6): CODE_LINES, COMMANDS, EDITOR_TABS, FILE_TREE, MenuEntry, MENUS

### Community 8 - "verify.ts"
Cohesion: 0.25
Nodes (9): artifactCount(), clickText(), errors, evaluate(), pending, proc, results, send() (+1 more)

### Community 9 - "dependencies"
Cohesion: 0.25
Nodes (8): dependencies, @astryxdesign/core, @astryxdesign/theme-neutral, @heroicons/react, react, react-dom, shiki, @stylexjs/stylex

### Community 10 - "server.ts"
Cohesion: 0.43
Nodes (6): fetch(), json(), mime(), PORT, Run, runs()

### Community 11 - "dashboard.tsx"
Cohesion: 0.19
Nodes (20): buildFileTree(), ResizableWorkspacePage(), styles, Artifact, Attempt, bytesOf(), Case, Grade (+12 more)

### Community 12 - "neutralPalettes.ts"
Cohesion: 0.53
Nodes (4): black, palette, white, neutralPalettes

### Community 13 - "RUNBOOK — Grader Dashboard (standalone, Bun + Astryx only)"
Cohesion: 0.09
Nodes (22): `astryx` npm script alias — prevents silent CLI failures, Batch component lookup — the cheapest existence check, Canonical CLI invocations — no hand-rolling, Data sources — LOCATED (brief §Data Sources asked first), `--dense` on every command, Frame — from the official docs (docs/layout), NOT from template choice, Gate — every brief point (brief §Working Method), Hard constraints (from the brief — pass/fail, not preferences) (+14 more)

### Community 14 - "serve.ts"
Cohesion: 0.23
Nodes (15): Case, fetch(), GRADES_FILE, isDegenerate(), langOf(), listRuns(), loadRun(), MIME (+7 more)

### Community 15 - "benchmark-grader"
Cohesion: 0.15
Nodes (11): benchmark-grader, Data-directory contract, Endpoints, Environment, `grades.json` — write, owned by the dashboard, Honesty rules baked in, Layout, `RUN_DIR` — read-only, owned by the benchmark runner (+3 more)

### Community 16 - "verify-ui.ts"
Cohesion: 0.24
Nodes (10): cdp, clickText(), CRAMPED, DESKTOP, errors, evalJs(), Msg, sleep() (+2 more)

## Knowledge Gaps
- **129 isolated node(s):** `name`, `private`, `type`, `start`, `dev` (+124 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 144 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `neutralTheme.ts` to `package.json`, `ai-chat.tsx`, `file-explorer.tsx`, `shell-nav.tsx`, `dashboard.tsx`?**
  _High betweenness centrality (0.242) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _129 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `neutralTheme.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13071895424836602 - nodes in this community are weakly interconnected._
- **Should `RUNBOOK — Grader Dashboard (standalone, Bun + Astryx only)` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._