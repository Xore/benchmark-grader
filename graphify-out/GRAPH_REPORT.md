# Graph Report - benchmark-grader  (2026-10-04)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 158 nodes · 184 edges · 14 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9182e518`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.tsx
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
- devDependencies
- neutralPalettes.ts
- ide.tsx

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 12 edges
2. `react` - 7 edges
3. `chunkAnswer()` - 4 edges
4. `App()` - 4 edges
5. `RoundMessage()` - 4 edges
6. `fetch()` - 4 edges
7. `tokenize()` - 4 edges
8. `evaluate()` - 4 edges
9. `codeScore()` - 3 edges
10. `isCode()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `RoundMessage()` --calls--> `chunkAnswer()`  [EXTRACTED]
  src/app.tsx → src/answer-chunks.ts

## Import Cycles
- None detected.

## Communities (14 total, 0 thin omitted)

### Community 0 - "app.tsx"
Cohesion: 0.14
Nodes (18): Chunk, chunkAnswer(), codeScore(), isCode(), isSentence(), App(), Case, caseLang() (+10 more)

### Community 1 - "package.json"
Cohesion: 0.10
Nodes (19): astryx, theme, name, private, scripts, dev, start, type (+11 more)

### Community 2 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, paths (+5 more)

### Community 3 - "ai-chat.tsx"
Cohesion: 0.17
Nodes (8): AIChatConversationTemplate(), articleBody, artifactPanelWidthVar(), artifactScroll, chatColumn, chatLayout, MENTION_TOKENS, root

### Community 4 - "neutralTheme.ts"
Cohesion: 0.20
Nodes (8): react, iconProps, neutralIconRegistry, neutralPaletteRefs, neutralLocalTokens, neutralSyntax, neutralTheme, statusFill

### Community 5 - "shiki-tokenizer.ts"
Cohesion: 0.22
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

### Community 11 - "devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, @astryxdesign/cli, @types/bun, @types/react, @types/react-dom, typescript

### Community 12 - "neutralPalettes.ts"
Cohesion: 0.53
Nodes (4): black, palette, white, neutralPalettes

### Community 13 - "ide.tsx"
Cohesion: 0.40
Nodes (5): buildFileTree(), HISTORY_ITEMS, PROPERTIES, ResizableWorkspacePage(), styles

## Knowledge Gaps
- **90 isolated node(s):** `Chunk`, `Case`, `Check`, `Corpus`, `GradeMap` (+85 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 102 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `neutralTheme.ts` to `app.tsx`, `package.json`, `ai-chat.tsx`, `file-explorer.tsx`, `shell-nav.tsx`, `ide.tsx`?**
  _High betweenness centrality (0.463) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `Chunk`, `Case`, `Check` to the rest of the system?**
  _90 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.13852813852813853 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._