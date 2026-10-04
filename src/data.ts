// Data layer for the grader dashboard. Bun-served JSON only; no hand-rolled
// fetching, no mock data — every field comes from the real benchmark runner
// output under RUN_DIR.

export type Artifact = {
  path: string
  lang: string
  source: string
  case: string
}

export type Attempt = {
  case: string
  /** Position within the case, assigned server-side in recorded order. */
  round?: number
  model?: {tag?: string}
  outcome?: string
  recorded_at?: string
  degenerate?: boolean
  repetition_ratio?: number | null
  request?: {body?: {messages?: {role: string; content: string}[]}}
  response?: {raw?: string; parse_ok?: boolean}
  timing?: {
    wall_seconds?: number
    output_tokens?: number
    prompt_tokens?: number
    tokens_per_second?: number
    done_reason?: string
  }
}

export type Rubric = {
  bucket?: string
  max_score?: number
  pass_anchors?: Record<string, string[]>
}

export type Case = {
  id: string
  attempts: Attempt[]
  artifacts: Artifact[]
  rubric?: Rubric | null
}

export type Run = {
  id: string
  records: number
  cases: Case[]
  /** Every model tag present in the run. A run normally has one. */
  models?: string[]
  /** "This output may be worthless" signals, surfaced up front. */
  diagnostics?: {degenerate: number; maxRepetitionRatio: number | null}
  /** Case count per rubric bucket. */
  buckets?: Record<string, number>
}

export type RunSummary = {
  id: string
  records: number
  cases: number
  /** Model tag(s) in the run; runs are grouped by this in the UI. */
  model: string
}

export type Grade = {
  score: number | null
  note: string
  at: string
  lineNotes?: {lineStart?: number; lineEnd?: number; note: string; at: string}[]
}

export async function saveLineNote(
  runId: string,
  file: string,
  lineStart: number | undefined,
  lineEnd: number | undefined,
  note: string,
) {
  const r = await fetch('/api/grades', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({run: runId, file, lineStart, lineEnd, note}),
  })
  if (!r.ok) throw new Error(`POST /api/grades -> ${r.status}`)
  return json<GradeBook>('/api/grades')
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return (await r.json()) as T
}

export const listRuns = () => json<RunSummary[]>('/api/runs')

export const loadRun = (id: string) =>
  json<Run>(`/api/run/${encodeURIComponent(id)}`)

export type GradeBook = Record<string, {files?: Record<string, Grade>}>

export const loadGrades = () => json<GradeBook>('/api/grades')

export async function saveGrade(
  runId: string,
  file: string,
  score: number | null,
  note: string,
) {
  const r = await fetch('/api/grades', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({run: runId, file, score, note}),
  })
  if (!r.ok) throw new Error(`POST /api/grades -> ${r.status}`)
  return json<GradeBook>('/api/grades')
}

/** The user prompt that produced this case. */
export function promptOf(a: Attempt | undefined): string {
  const msgs = a?.request?.body?.messages
  return msgs?.find(m => m.role === 'user')?.content ?? ''
}

/** Language for a path — mirrors the server's extension map. */
export function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (
    {
      rs: 'rust',
      py: 'python',
      php: 'php',
      c: 'c',
      h: 'c',
      cpp: 'cpp',
      sh: 'shellscript',
      bash: 'shellscript',
      json: 'json',
    }[ext] ?? 'plaintext'
  )
}

export function linesOf(src: string): number {
  return src ? src.split('\n').length : 0
}

export function bytesOf(src: string): string {
  const n = new TextEncoder().encode(src).length
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}
