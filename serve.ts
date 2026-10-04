// Grader dashboard service. New file: the old server.ts is untouched.
//
//   bun run serve            # 0.0.0.0:3020
//   RUN_DIR=/tmp/smoke-tr bun run serve
//
// Reads benchmark run directories (transcripts.jsonl + coder-artifacts/) and
// serves them as JSON to the Astryx client. Grades are dashboard-owned and
// written to a separate file so the runner's own human-grades.json is never
// overwritten.

import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {mkdirSync, writeFileSync} from 'node:fs'

const ROOT = '/home/xore/Desktop/benchmark-grader'
const RUN_DIR = process.env.RUN_DIR ?? '/tmp/smoke-tr'
const PORT = Number(process.env.PORT ?? 3020)
const RUBRIC =
  process.env.RUBRIC ??
  '/home/xore/Github/APIARY/analysis/ghidra/benchmarks/corpus/coder_cases_v1_rubric.json'

// Grades live here, NOT in the run dir, so we never touch runner output.
const GRADES_FILE = join(ROOT, 'grades.json')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

// ---------------------------------------------------------------- rubric

// ponytail: the rubric is frozen for the process, so parse it once. If it is
// missing or malformed every case simply gets `rubric: null` and the UI shows
// its empty state -- a broken rubric must not take the dashboard down.
let rubricIndex: Map<string, unknown> | null = null

function rubricOf(caseId: string): unknown {
  if (rubricIndex === null) {
    rubricIndex = new Map()
    const raw = safeRead(RUBRIC)
    if (raw) {
      try {
        const cases = (JSON.parse(raw) as {cases?: Record<string, unknown>}).cases ?? {}
        rubricIndex = new Map(Object.entries(cases))
      } catch {
        rubricIndex = new Map()
      }
    }
  }
  return rubricIndex.get(caseId) ?? null
}

// ---------------------------------------------------------------- run loading

type Case = {
  id: string
  rubric: unknown
  attempts: unknown[]
  artifacts: {path: string; lang: string; source: string; case: string}[]
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function walk(dir: string, root = dir): string[] {
  let out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir, {withFileTypes: true})
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out = out.concat(walk(p, root))
    else out.push(p.slice(root.length + 1))
  }
  return out
}

function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    rs: 'rust',
    py: 'python',
    php: 'php',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    sh: 'shellscript',
    bash: 'shellscript',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    toml: 'toml',
    md: 'markdown',
  }
  return map[ext] ?? 'plaintext'
}

// The runner's injection_gate.is_degenerate, ported. It is NOT written into
// transcripts.jsonl, so the dashboard cannot read it back -- it has to be
// computed from the same rule, or the flag is missing for every case and the
// reviewer grades a repeating loop on the merits of its first paragraph.
// Module scope (not inside loadRun) so `--selftest` exercises this exact code
// instead of a copy that can drift. Keep in sync with injection_gate.py:
// same thresholds, same digit-normalisation, same punctuation-only skip.
const DIGITS = /\d+/g
const PUNCT_ONLY = /^[\s\-|:=*#_.>]*$/
function isDegenerate(text: string): boolean {
  const body = (text ?? '').trim()
  if (!body) return false
  // 512 tokens of <think> with no final text is a failure, not an answer.
  if (body.startsWith('<think>') && !body.includes('</think>')) return true
  const lines: string[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line.length < 12 || PUNCT_ONLY.test(line)) continue
    lines.push(line.replace(DIGITS, '#'))
  }
  if (lines.length < 8) return false
  const counts = new Map<string, number>()
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1)
  if (Math.max(...counts.values()) >= 5) return true
  const dupes = [...counts.values()].reduce((n, c) => n + (c - 1), 0)
  return dupes / lines.length >= 0.25
}

// Fraction of digit-normalised lines that are duplicates. Same normalisation
// as isDegenerate, reported raw rather than thresholded so the UI can show
// "how close to degenerate" instead of a bare yes/no.
function repetitionRatio(text: string): number | null {
  const lines = (text ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 12 && !PUNCT_ONLY.test(l))
    .map(l => l.replace(DIGITS, '#'))
  if (lines.length < 8) return null
  const counts = new Map<string, number>()
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1)
  const dupes = [...counts.values()].reduce((n, c) => n + (c - 1), 0)
  return Math.round((dupes / lines.length) * 100) / 100
}

// ponytail: one pass per run, cached. Fine for ~50 records; add mtime invalidation
// if runs are appended to while the dashboard is open.
function loadRun(runId: string): unknown | null {
  const dir = join(RUN_DIR, runId)
  const raw = safeRead(join(dir, 'transcripts.jsonl'))
  if (raw === null) return null
  const records = raw
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Record<string, unknown>[]

  // Model tag, so the UI can group runs per model and show what was actually
  // under test. A benchmark review is meaningless without knowing which model
  // produced the artifact you are grading.
  const modelOf = (r: Record<string, unknown>) => {
    const m = r.model as Record<string, unknown> | undefined
    return String(m?.tag ?? r.model ?? 'unknown')
  }
  const tags = [...new Set(records.map(modelOf))].sort()

  const cases = new Map<string, Case>()
  for (const r of records) {
    const id = String(r.case ?? r.case_id ?? 'unknown')
    if (!cases.has(id))
      cases.set(id, {id, rubric: rubricOf(id), attempts: [], artifacts: []})
    const c = cases.get(id)!
    // Round = position within this case in recorded order. Without it the UI
    // shows N attempts with no way to tell retries from first tries, and a
    // reviewer cannot tell which of two identical-looking runs is the real one.
    const rawText = String((r.response as Record<string, unknown>)?.raw ?? '')
    c.attempts.push({
      ...r,
      round: c.attempts.length + 1,
      degenerate: r.degenerate === true ? true : isDegenerate(rawText),
      repetition_ratio:
        typeof r.repetition_ratio === 'number'
          ? r.repetition_ratio
          : repetitionRatio(rawText),
    })
  }

  // Case count per bucket, straight from the frozen rubric. The old surface had
  // a buckets overview; without it there is no way to see at a glance which
  // slices of the corpus a run actually covers.
  const buckets = new Map<string, number>()
  for (const c of cases.values()) {
    const b = (c.rubric as {bucket?: string} | null)?.bucket
    if (b) buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }

  // artifacts live under <run>/coder-artifacts/<model-tag>/<tier>/<file>
  // ponytail: source-manifest.json is rewritten per case, so it only describes
  // the LAST case written — it cannot attribute a whole tier. Only files whose
  // stem equals a case id are attributed; the rest land in an explicit
  // unattributed bucket rather than being silently mislabelled.
  const artRoot = join(dir, 'coder-artifacts')
  const unattributed: Artifact[] = []
  for (const rel of walk(artRoot)) {
    if (!rel || rel.endsWith('source-manifest.json')) continue
    const full = join(artRoot, rel)
    try {
      if (statSync(full).size > 512_000) continue
    } catch {
      continue
    }
    const source = safeRead(full)
    if (source === null) continue
    const base = rel.split('/').pop() ?? ''
    const stem = base.replace(/\.[^.]+$/, '')
    const art: Artifact = {path: rel, lang: langOf(base), source, case: stem}
    if (cases.has(stem)) cases.get(stem)!.artifacts.push(art)
    else unattributed.push(art)
  }
  if (unattributed.length)
    cases.set('(unattributed)', {
      id: '(unattributed)',
      rubric: null,
      attempts: [],
      artifacts: unattributed,
    })

  // Derived from the cases, not from the raw records: the per-record field is
  // absent in this runner, so the numbers would be a dishonest zero.
  const allAttempts = [...cases.values()].flatMap(c => c.attempts)
  const ratios = allAttempts
    .map(a => a.repetition_ratio)
    .filter((n): n is number => typeof n === 'number')

  return {
    id: runId,
    records: records.length,
    model: records[0]?.model ?? null,
    models: tags,
    diagnostics: {
      // Shown in Run info. Both are "this output may be worthless" signals and
      // must be visible before grading, not buried in a transcript field.
      degenerate: allAttempts.filter(a => a.degenerate).length,
      maxRepetitionRatio: ratios.length ? Math.max(...ratios) : null,
    },
    buckets: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1] - a[1])),
    cases: [...cases.values()],
  }
}

function listRuns(): string[] {
  try {
    return readdirSync(RUN_DIR).filter(d => {
      try {
        return statSync(join(RUN_DIR, d)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ grades IO

function readGrades(): Record<string, unknown> {
  const raw = safeRead(GRADES_FILE)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeGrades(g: Record<string, unknown>) {
  mkdirSync(ROOT, {recursive: true})
  writeFileSync(GRADES_FILE, JSON.stringify(g, null, 2))
}

// ---------------------------------------------------------------------- server

// Self-check for the ported detector: `bun serve.ts --selftest`. Without it the
// port is unfalsifiable against a run containing no degenerate output -- exactly
// the run this dashboard was built on, which would report "0 degenerate" no
// matter how wrong the port was. Cases are the real failure shapes from
// injection_gate.py's docstring.
if (process.argv.includes('--selftest')) {
  // Lines unique AFTER digit-normalisation -- otherwise every line collapses to
  // "a unique line of prose number #" and the fixture itself is degenerate.
  const UNIQ = 'abcdefghijklmnopqrstuvwxyz'
  const unique = (n: number) =>
    Array.from({length: n}, (_, i) => `distinct prose line ${UNIQ[i % 26]}${UNIQ[(i * 7 + 3) % 26]} here`).join('\n')
  const cases: [string, boolean][] = [
    ['', false],
    ['   \n  ', false],
    ['a short useful answer', false],
    // argv[N] ladder: digit-normalisation must make these collide.
    [Array.from({length: 8}, (_, i) => `argv[${i}]: The argument.`).join('\n'), true],
    // never left the thinking channel
    ['<think>\nlots\nof\nunfinished\nthinking\nhere\nindeed\nyes\n', true],
    // one sentence repeated to REPEAT_COUNT, among otherwise-unique lines
    ['same line repeated here\n' + unique(8) + '\n' + 'same line repeated here\n'.repeat(4), true],
    // 25%+ duplicate fraction from several distinct repeats
    ['repeated shape line one\n'.repeat(4) + '\n' + unique(8), true],
    // below DEGENERATE_MIN_LINES -- must NOT trip
    ['dup\ndup\ndup\ndup', false],
    [unique(20), false],
    // punctuation-only lines are skipped, so a table is not repetition
    [['-' + '-'.repeat(20), '|' + '|'.repeat(20)].join('\n').repeat(6) + '\n' + unique(8), false],
  ]
  let bad = 0
  for (const [text, want] of cases) {
    const got = isDegenerate(text)
    if (got !== want) {
      bad++
      console.error(`FAIL degenerate=${got} want=${want} :: ${JSON.stringify(text.slice(0, 50))}`)
    }
  }
  // repetition_ratio: null below the line floor, 0 for all-unique, >0 for dupes.
  const rr: [string, number | null][] = [
    ['', null],
    ['dup\ndup\ndup\ndup', null],
    [unique(20), 0],
    // 8 identical lines count as 7 duplicates (n-1), not 8: 7/16 = 0.44.
    ['repeated shape line one\n'.repeat(8) + '\n' + unique(8), 0.44],
  ]
  for (const [text, want] of rr) {
    const got = repetitionRatio(text)
    if (got !== want) {
      bad++
      console.error(`FAIL ratio=${got} want=${want} :: ${JSON.stringify(text.slice(0, 40))}`)
    }
  }
  console.log(
    bad
      ? `selftest FAILED (${bad})`
      : `OK isDegenerate+repetitionRatio (${cases.length + rr.length} cases)`,
  )
  process.exit(bad ? 1 : 0)
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname

    // Bundle the client once, lazily, on first request. Bun's bundler resolves
    // the bare @astryxdesign/* imports; serving raw .tsx would not.
    let bundled: string | null = null
    const bundle = async () =>
      (bundled ??= await Bun.build({
        entrypoints: [join(ROOT, 'src/app.tsx')],
        target: 'browser',
        minify: false,
      })
        .then(r => r.outputs[0]?.text())
        .catch(e => {
          console.error('bundle failed:', e)
          return `console.error(${JSON.stringify(String(e))})`
        }))

    if (p === '/api/runs')
      return Response.json(
        listRuns().map(id => {
          const run = loadRun(id) as
            | {records: number; cases: unknown[]; models?: string[]}
            | null
          return {
            id,
            records: run?.records ?? 0,
            cases: run?.cases.length ?? 0,
            // Grouped client-side into a model selector. Runs are per-model by
            // construction, so without the tag the reviewer cannot tell a
            // re-run of qwen3 from a first run of some other model.
            model: run?.models?.join(', ') || 'unknown',
          }
        }),
      )

    if (p === '/api/rubric') {
      const raw = safeRead(RUBRIC)
      return raw ? Response.json(JSON.parse(raw)) : new Response('{}')
    }

    if (p.startsWith('/api/run/')) {
      const id = decodeURIComponent(p.slice('/api/run/'.length))
      const run = loadRun(id)
      return run ? Response.json(run) : new Response('not found', {status: 404})
    }

    if (p === '/api/grades') {
      if (req.method === 'GET') return Response.json(readGrades())
      if (req.method === 'POST') {
        const body = (await req.json()) as Record<string, unknown>
        const all = readGrades()
        const key = String(body.run ?? 'unknown')
        const runGrades = ((all[key] as Record<string, unknown>) ?? {}) as Record<
          string,
          unknown
        >
        // per-file grade
        const fileKey = body.file as string | undefined
        if (fileKey) {
          const files = ((runGrades.files as Record<string, unknown>) ?? {}) as Record<
            string,
            unknown
          >
          const prev = (files[fileKey] ?? {}) as {
            score?: number | null
            note?: string
            lineNotes?: {lineStart?: number; lineEnd?: number; note: string}[]
          }
          const at = new Date().toISOString()
          // A line note is anchored to a range; a bare file note is not.
          const ls = body.lineStart as number | undefined
          const le = body.lineEnd as number | undefined
          if (ls !== undefined || le !== undefined) {
            const kept = (prev.lineNotes ?? []).filter(
              n => !(n.lineStart === ls && n.lineEnd === le),
            )
            if (body.note) kept.push({lineStart: ls, lineEnd: le, note: String(body.note)})
            files[fileKey] = {...prev, lineNotes: kept, at}
          } else {
            files[fileKey] = {
              ...prev,
              score: body.score ?? null,
              note: body.note ?? '',
              at,
            }
          }
          runGrades.files = files
        }
        // whole-run grade
        if (body.case !== undefined && fileKey === undefined) {
          runGrades.caseScores = {
            ...((runGrades.caseScores as Record<string, unknown>) ?? {}),
            [String(body.case)]: {
              score: body.score ?? null,
              note: body.note ?? '',
              at: new Date().toISOString(),
            },
          }
        }
        all[key] = runGrades
        writeGrades(all)
        return Response.json({ok: true})
      }
      return new Response('method not allowed', {status: 405})
    }

    // static
    if (p === '/app.js')
      return new Response(await bundle(), {
        headers: {'content-type': MIME['.js']!},
      })
    let file = p === '/' ? '/src/index.html' : p
    if (file.endsWith('/')) file += 'index.html'
    // ponytail: resolve node_modules through the package `exports` map rather
    // than guessing a path — @astryxdesign/core ships astryx.css in dist/, not
    // at the package root, so a root-relative guess 404s and the page renders
    // unstyled. Bun.resolveSync honours the exports map.
    let full: string
    try {
      full = file.startsWith('/node_modules/')
        ? Bun.resolveSync(file.slice('/node_modules/'.length), ROOT)
        : join(ROOT, file)
    } catch {
      return new Response('not found', {status: 404})
    }
    if (!full.startsWith(ROOT)) return new Response('no', {status: 403})
    if (file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.tsx')) {
      return new Response(Bun.file(full))
    }
    const body = safeRead(full)
    if (body === null) return new Response('not found', {status: 404})
    return new Response(body, {
      headers: {'content-type': MIME['.html'] ?? 'text/plain; charset=utf-8'},
    })
  },
})

console.log(
  `grader dashboard on http://0.0.0.0:${PORT}  RUN_DIR=${RUN_DIR}  grades=${GRADES_FILE}`,
)