import { serve } from 'bun'

const HOST = process.env.HOST ?? '0.0.0.0'
const PORT = Number(process.env.PORT ?? 3020)
const RUN_DIR = process.env.RUN_DIR ?? '/tmp/roster-run'

// One build at boot; the app is a client-rendered SPA so nothing needs SSR.
const built = await Bun.build({
  entrypoints: ['./src/app.tsx'],
  target: 'browser',
  minify: false,
  define: { 'process.env.NODE_ENV': '"production"' },
})
if (!built.success) throw new AggregateError(built.logs, 'client build failed')

const clientJs = await built.outputs[0].text()

type Run = {
  id: string
  model: string
  caseCount: number
  roundCount: number
  capped: number
  degenerate: number
}

async function runs(): Promise<Run[]> {
  const files: string[] = []
  const glob = new Bun.Glob('*/transcripts.jsonl')
  for await (const f of glob.scan({ cwd: `${RUN_DIR}/transcripts` })) files.push(f)

  const out: Run[] = []
  for (const rel of files.sort().reverse()) {
    const path = `${RUN_DIR}/transcripts/${rel}`
    const text = await Bun.file(path).text()
    const recs = text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter((r): r is any => r?.workflow === 'coder_generation')

    if (!recs.length) continue
    out.push({
      id: rel.split('/')[0],
      model: recs[0].model?.tag ?? 'unknown',
      caseCount: new Set(recs.map((r) => r.case)).size,
      roundCount: recs.length,
      capped: recs.filter((r) => r.timing?.done_reason === 'length').length,
      degenerate: recs.filter((r) => r.degenerate).length,
    })
  }
  return out
}

const corpus = await Bun.file(
  '/home/xore/Github/APIARY/analysis/ghidra/benchmarks/corpus/coder_cases_v1_rubric.json',
).json()

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  })
}

serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname

    if (p === '/app.js')
      return new Response(clientJs, {
        headers: {
          'content-type': 'text/javascript',
          'cache-control': 'no-cache',
        },
      })

    if (p === '/api/corpus') return json(corpus)

    if (p === '/api/runs') return json(await runs())

    const run = p.match(/^\/api\/run\/([^/]+)$/)
    if (run) {
      const dir = `${RUN_DIR}/transcripts/${run[1]}`
      const text = await Bun.file(`${dir}/transcripts.jsonl`).text()
      const recs = text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as any)
      // Round = position within this case, in recorded order.
      const seen = new Map<string, number>()
      return json(
        recs.map((r) => {
          const n = (seen.get(r.case) ?? 0) + 1
          seen.set(r.case, n)
          return {
          case: r.case,
          round: n,
          recorded_at: r.recorded_at,
          // Current schema nests the text under response.raw; older/flattened
          // transcripts carry a top-level `answer`. Fall back so both render.
          answer: r.response?.raw ?? r.answer ?? '',
          outcome: r.outcome,
          done_reason: r.timing?.done_reason,
          output_tokens: r.timing?.output_tokens,
          prompt_tokens: r.timing?.prompt_tokens,
          tokens_per_second: r.timing?.tokens_per_second,
          degenerate: r.degenerate ?? false,
          repetition_ratio: r.repetition_ratio ?? null,
          // Transcripts store the prompt as user_prompt (the legacy `prompt`
            // key is absent); fall back so older files still render.
            prompt: r.request?.user_prompt ?? r.request?.prompt ?? '',
        }})
      )
    }

    // Directory listing for the file explorer. Artifacts only exist once a
    // model finished every case, so a missing dir is a normal empty state.
    const listing = p.match(/^\/api\/artifacts\/([^/]+)$/)
    if (listing) {
      const root = `${RUN_DIR}/transcripts/${listing[1]}/coder-artifacts`
      // A directory is not a file: Bun.file(root).exists() is false for it,
      // which silently returned an empty listing for every run. Globbing a
      // missing dir yields nothing anyway, so no existence check is needed.
      const files: string[] = []
      const glob = new Bun.Glob('**/*')
      try {
        for await (const f of glob.scan({ cwd: root })) files.push(f)
      } catch (err) {
        return json({ files: [], error: String(err) })
      }
      return json({ files: files.filter((f) => !f.endsWith('/')).sort() })
    }

    const transcript = p.match(/^\/api\/transcript\/([^/]+)$/)
    if (transcript) {
      const f = Bun.file(`${RUN_DIR}/transcripts/${transcript[1]}/transcripts.jsonl`)
      return (await f.exists()) ? new Response(f, {
        headers: { 'content-type': 'application/x-ndjson' },
      }) : new Response('', { status: 404 })
    }

    const file = p.match(/^\/api\/artifact\/([^/]+)\/(.+)$/)
    if (file) {
      const [, runId, rel] = file
      // rel is caller-controlled; refuse anything that could climb out of
      // the run's artifact directory.
      if (rel.includes('..') || rel.startsWith('/'))
        return new Response('bad path', { status: 400 })
      const body = Bun.file(
        `${RUN_DIR}/transcripts/${runId}/coder-artifacts/${rel}`,
      )
      // A stale or half-typed path used to throw ENOENT out of the handler,
      // which Bun renders as a 500 with a stack trace. A file that is not
      // there is a normal condition here: the run is still streaming.
      if (!(await body.exists()))
        return new Response('not found', { status: 404 })
      const res = new Response(await body.arrayBuffer())
      res.headers.set('content-type', mime(rel))
      return res
    }

    const grade = p.match(/^\/api\/grades\/([^/]+)$/)
    if (grade) {
      const path = `${RUN_DIR}/grades/${grade[1]}.json`
      if (req.method === 'POST') {
        await Bun.write(path, await req.text())
        return json({ ok: true })
      }
      const f = Bun.file(path)
      return (await f.exists()) ? new Response(f) : json({})
    }

    // Bun does not serve static files by default; the Astryx stylesheets are
    // the only ones the client needs. Paths come from the package exports map:
    // core's reset.css lives in src/, the other two in dist/.
    const css = p.match(/^\/node_modules\/(@astryxdesign\/[^/]+)\/(?:dist\/)?(\S+\.css)$/)
    if (css) {
      for (const dir of ['dist/', 'src/']) {
        const f = Bun.file(`./node_modules/${css[1]}/${dir}${css[2]}`)
        if (await f.exists())
          return new Response(f, { headers: { 'content-type': 'text/css' } })
      }
    }

    if (p === '/' || p === '/index.html')
      return new Response(Bun.file('./src/index.html'))

    return new Response('not found', { status: 404 })
  },
})

function mime(f: string) {
  const ext = f.split('.').pop() ?? ''
  return (
    {
      cpp: 'text/x-c++src',
      c: 'text/x-csrc',
      py: 'text/x-python',
      rs: 'text/x-rust',
      php: 'text/x-php',
      json: 'application/json',
    }[ext] ?? 'text/plain'
  )
}

console.log(`benchmark-grader on http://localhost:${PORT} — serving ${RUN_DIR}`)