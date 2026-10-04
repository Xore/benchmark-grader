// Headless end-to-end check: loads the SPA in Chrome, clicks through
// run → case → chat / source, and asserts each surface rendered.
// Run: bun run verify.ts   (server must be listening on :3020)
const url = process.env.URL ?? 'http://127.0.0.1:3020/'
const chrome = Bun.which('google-chrome') ?? 'google-chrome'
const port = 9400 + (Date.now() % 200)

const proc = Bun.spawn(
  [
    chrome,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/bg-chrome-${port}`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let target: any
for (let i = 0; i < 60 && !target; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`)
    if (r.ok) target = (await r.json()).find((t: any) => t.type === 'page')
  } catch {}
  if (!target) await sleep(250)
}
if (!target) throw new Error('chrome never came up')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map<number, (v: any) => void>()
const errors: string[] = []
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data))
  if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(
      m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text,
    )
}
const send = (method: string, params: any = {}) =>
  new Promise<any>((r) => {
    const n = ++id
    pending.set(n, r)
    ws.send(JSON.stringify({ id: n, method, params }))
  })

const evaluate = async (expression: string) => {
  const res: any = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  // CDP wraps the value as {result:{type,value}}; booleans come back without
  // an outer result key, so normalise both shapes.
  const v = res?.value !== undefined ? res.value : res?.result?.value
  if (v === undefined) throw new Error('evaluate failed: ' + JSON.stringify(res))
  return v
}

// Click the first element whose trimmed text starts with `text`, so we drive
// the real UI rather than poking React internals.
// Real mouse click at the element's box centre — synthetic el.click() on the
// wrong node silently does nothing inside TreeList.
const clickText = async (sel: string, text: string) => {
  const box: any = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .filter(e => (e.innerText || e.textContent || '').trim().startsWith(${JSON.stringify(text)}))
      .sort((a, b) => (a.innerText||'').length - (b.innerText||'').length)[0]
    if (!el) return null
    // The explorer panel scrolls, so an off-screen row would get mouse
    // coordinates outside the viewport and the click would land nowhere.
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (!box) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return true
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(4000)

const results: Record<string, unknown> = {}
results.mounted = await evaluate(`!!document.getElementById('root').firstChild`)
results.treeNodes = await evaluate(`document.querySelectorAll('[role="treeitem"]').length`)

// Surface 1 — file explorer. Walk the run list until we land on a run that
// actually wrote artifacts, so the artifact branch is exercised for real.
const artifactCount = () =>
  evaluate(
    `[...document.querySelectorAll('body *')]
       .map(e => (e.innerText||'').trim())
       .filter(t => /^ARTIFACTS \\(\\d+\\)$/.test(t))[0] || 'ARTIFACTS (0)'`,
  )
const runLabels: string[] = await evaluate(
  `[...document.querySelectorAll('[role="treeitem"]')].map(e => (e.innerText||'').trim()).slice(0, 60)`,
)
for (const label of runLabels) {
  await clickText('[role="treeitem"]', label)
  await sleep(700)
  if (Number((await artifactCount()).replace(/\D/g, '')) > 0) break
}
results.pickedRun = await artifactCount()
results.explorerSections = await evaluate(
  `[...document.querySelectorAll('body *')]
     .map(e => (e.innerText||'').trim())
     .filter(t => /^(CASES|ARTIFACTS) \\(\\d+\\)$/.test(t))`,
)
results.artifactFiles = await evaluate(
  `[...document.querySelectorAll('[role="treeitem"]')]
     .map(e => (e.innerText||'').trim()).filter(t => /\\.(rs|py|php|c|cpp)\\b/.test(t)).slice(0, 3)`,
)

// Surface 3 — chat transcript for a case.
results.pickedCase = await clickText('[role="treeitem"]', 'c-')
await sleep(1500)
results.chat = await evaluate(`(() => {
  const t = document.body.innerText
  const i = t.indexOf('Round 1')
  return {
    hasEmptyPrompt: t.includes('_(empty prompt)_'),
    hasEmptyResponse: t.includes('_(empty response)_'),
    hasRoundHeader: i >= 0,
    sample: i >= 0 ? t.slice(i, i + 300) : '',
  }
})()`)

// Surface 2 — syntax-highlighted source.
const fileLeaf: string | undefined = (results.artifactFiles as string[])?.[1]
results.pickedFile = fileLeaf ? await clickText('[role="treeitem"]', fileLeaf) : false
await sleep(1800)
// Clicking the file should already have switched to the Source tab; if not,
// drive the tab explicitly so the CodeBlock branch is exercised regardless.
await clickText('button', 'Source')
await sleep(1800)
results.activeSourceTab = await evaluate(
  `[...document.querySelectorAll('[role="tab"]')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.innerText.trim())`,
)
results.source = await evaluate(`(() => {
  const pre = document.querySelector('pre')
  const code = document.querySelector('code')
  const t = document.body.innerText
  return {
    pres: document.querySelectorAll('pre').length,
    codes: document.querySelectorAll('code').length,
    preChars: pre ? pre.innerText.length : 0,
    codeChars: code ? code.innerText.length : 0,
    sample: (pre || code) ? (pre||code).innerText.slice(0, 200) : t.slice(t.indexOf('Source')+6, t.indexOf('Source')+300),
  }
})()`)

// Per-file grading writes through POST /api/grades/ID.
results.selBefore = await evaluate(
  `[...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map(e => e.innerText.trim())`,
)
await clickText('[role="treeitem"]', 'c-length-prefixed-record-parser.c')
await sleep(1500)
results.selAfterFileClick = await evaluate(
  `JSON.stringify([...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map(e => e.innerText.trim()))`,
)
results.retry = await clickText('[role="treeitem"]', 'c-length-prefixed-record-parser.c')
await sleep(1500)
results.selAfterRetry = await evaluate(
  `JSON.stringify([...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map(e => e.innerText.trim()))`,
)
results.clickedPass = await clickText('button', 'Pass')
await sleep(800)
results.passButtons = await evaluate(
  `[...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'Pass').length`,
)

ws.close()
proc.kill()

console.log(JSON.stringify(results, null, 2))
console.log('console errors:', errors.length ? errors : 'none')

const ok =
  results.mounted === true &&
  (results.treeNodes as number) > 0 &&
  (results.chat as any).hasRoundHeader &&
  !(results.chat as any).hasEmptyResponse &&
  (results.source as any).codeChars > 50 &&
  errors.length === 0
console.log(ok ? '\nOK' : '\nFAIL')
if (!ok) process.exit(1)
