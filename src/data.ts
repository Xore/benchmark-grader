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
  model?: {
    tag?: string
    digest?: string
    family?: string
    parameter_size?: string
    quantization?: string
    size_bytes?: number
  }
  outcome?: string
  recorded_at?: string
  degenerate?: boolean
  repetition_ratio?: number | null
  /** Populated when the runner failed the request; the message is only here. */
  error?: string | null
  /** The slot that produced this attempt (ghidra / revdeck / sessions). */
  slot?: string
  benchmark?: string
  workflow?: string
  provenance?: string
  operator?: string
  schema_version?: string
  /** Rubric claims this attempt was graded against. Empty on these slots. */
  claim_ids?: string[]
  request?: {
    body?: {
      messages?: {role: string; content: string}[]
      model?: string
      options?: Record<string, unknown>
      think?: boolean
      stream?: boolean
      format?: string
      keep_alive?: string
    }
    /** sha256 of the exact request body -- the reproducibility fingerprint. */
    body_sha256?: string
  }
  response?: {
    raw?: string
    /** Assistant turn as written by the runner; .content mirrors `raw`. */
    message?: {role?: string; content?: string}
    /** The runner's JSON.parse of `raw`; null when it was not JSON. */
    parse_ok?: boolean
    parsed?: unknown
    tool_turns?: unknown[]
  }
  timing?: {
    wall_seconds?: number
    output_tokens?: number
    prompt_tokens?: number
    tokens_per_second?: number
    done_reason?: string
  }
  /** What it takes to reproduce this record. Absent on old runs. */
  reproducibility?: {
    tier?: string
    engine?: string
    fallback_engine?: string | null
    rubric_version?: string | null
    claim_pool_version?: string | null
    corpus_manifest_sha256?: string | null
    ghidra_cache_key?: string | null
    kv_offload_disabled?: boolean | null
    prompt_contract?: {
      prompt_contract_version?: string
      system_prompt_sha256?: string
      response_schema_sha256?: string
      workflow_contract_sha256?: string
      effective_schema_sha256?: string
      prompt_suffix_sha256?: string
    } | null
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
  /** The runner's own run.json for this run dir, verbatim. */
  meta?: {
    benchmark?: string
    operator?: string
    provenance?: string
    schema_version?: string
    started_at?: string
    notes?: string | null
    supersedes?: string | null
  } | null
  /** Did the loaded rubric actually cover this run's cases? */
  rubricCoverage?: {
    file: string
    loaded: number
    matched: number
  }
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

/** First 12 hex chars of a sha256 -- enough to compare by eye, short enough to read. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 12)}…` : '-'
}

/** `{"temperature":0,"seed":144}` as `temperature=0, seed=144`. */
export function optionsOf(
  options: Record<string, unknown> | undefined,
): string {
  if (!options) return ''
  return Object.entries(options)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ')
}

export function bytesOf(src: string): string {
  const n = new TextEncoder().encode(src).length
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}
