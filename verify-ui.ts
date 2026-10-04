// Real-browser gate for the grader dashboard.
//
//   google-chrome --headless=new --remote-debugging-port=9222 --no-sandbox about:blank &
//   bun run verify-ui.ts            # exits non-zero if any console/uncaught error
//
// Why this file exists: the reported "webserver crashes when I click Source"
// was a React hooks-order violation that surfaced only at click time, as an
// uncaught error. A fetch-based smoke test cannot see it. This drives a real
// Chrome, clicks every tab with real mouse events, and fails on any error.
//
// ponytail: binds 192.168.42.253 because the higher-level browser tool refuses
// private/loopback targets. Chrome itself has no such restriction; localhost
// would work here. The LAN IP is the one moving part -- override with UI_HOST.

const HOST = process.env.UI_HOST ?? 'http://192.168.42.253:3020'
const CDP = 'http://127.0.0.1:9222'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const errors: string[] = []

type Msg = {id?: number; method?: string; params?: any; result?: any; error?: any}

function attach(wsUrl: string) {
  const sock = new WebSocket(wsUrl)
  const pending = new Map<number, (m: Msg) => void>()
  const listeners: ((m: Msg) => void)[] = []
  sock.onmessage = e => {
    const m: Msg = JSON.parse(String(e.data))
    if (m.id != null && pending.has(m.id)) {
      pending.get(m.id)!(m)
      pending.delete(m.id)
    } else if (m.method) listeners.forEach(f => f(m))
  }
  const ready = new Promise<void>((res, rej) => {
    sock.onopen = () => res()
    sock.onerror = () => rej(new Error('ws failed: ' + wsUrl))
  })
  let id = 0
  return {
    ready,
    on: (f: (m: Msg) => void) => listeners.push(f),
    send: (method: string, params?: unknown) =>
      new Promise<any>((res, rej) => {
        const i = ++id
        pending.set(
          i,
          m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)),
        )
        sock.send(JSON.stringify({id: i, method, params}))
        setTimeout(() => rej(new Error('timeout: ' + method)), 15000)
      }),
    close: () => sock.close(),
  }
}

// Tabs from earlier runs keep the page alive but detached; without this the
// target list grows until chrome stops handing out websockets.
for (const t of await (await fetch(`${CDP}/json/list`)).json()) {
  if (t.type === 'page' && t.url.includes(':3020')) {
    await fetch(`${CDP}/json/close/${t.id}`).catch(() => {})
  }
}

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent(HOST)}`, {method: 'PUT'})
).json()
const cdp = attach(target.webSocketDebuggerUrl)
await cdp.ready

const evalJs = async (expr: string): Promise<any> =>
  (await cdp.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  }))?.result?.value

await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.enable')

cdp.on(m => {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    errors.push('EXCEPTION ' + (d.exception?.description ?? d.text))
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push(
      'CONSOLE ' + m.params.args.map((a: any) => a.value ?? a.description).join(' '),
    )
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    errors.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url ?? ''))
})

// Real mouse click: el.click() does not drive Astryx's TabList reliably, and a
// synthetic click would not reproduce what the user actually did.
//
// Match on textContent *prefix*, not equality: Astryx renders a visually-hidden
// copy of each tab's label inside the button, so the accessible name reads
// "SourceSource". Exact matching finds nothing and silently skips the tab --
// which would let a real regression pass. Prefix matching is stable whether or
// not the hidden duplicate is present.
//
// Measure AFTER scrolling, in a separate roundtrip: selecting a tab reflows the
// strip (the selected button becomes position:relative), so a rect read before
// the scroll lands on a stale point and the click hits the neighbour.
async function clickText(label: string, isTreeRow = false): Promise<boolean> {
  const sel = isTreeRow
    ? '[role="treeitem"][aria-level="2"]'
    : 'button,[role="tab"],label,input[type="radio"]'
  const found = await evalJs(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const el = all.find(e => {
      const t = (e.textContent||e.value||'').trim();
      return t === ${JSON.stringify(label)} || t.startsWith(${JSON.stringify(label)});
    });
    if (!el) return false;
    el.scrollIntoView({block:'center'});
    return true;
  })()`)
  if (!found) return false
  await sleep(250)
  const box = await evalJs(`(() => {
    const all = [...document.querySelectorAll(${JSON.stringify(sel)})]
    const el = all.find(e => {
      const t = (e.textContent||e.value||'').trim();
      return t === ${JSON.stringify(label)} || t.startsWith(${JSON.stringify(label)});
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + 40, r.y + r.height/2);
    return {x: r.x + 40, y: r.y + r.height/2, w: r.width,
            // If the click point is not inside the row, the centre is covered
            // and the click would silently land on a neighbour.
            covered: !hit || !hit.closest(${JSON.stringify(sel)})};
  })()`)
  if (!box || box.w === 0) return false
  if (box.covered) errors.push(`CLICK ${label}: centre point is covered by another element`)
  // mouseMoved first: without it CDP dispatches pressed/released at the last
  // known cursor position, not at x/y, so the click lands on whatever is under
  // the stale pointer and the tab never switches.
  await cdp.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: box.x, y: box.y})
  for (const type of ['mousePressed', 'mouseReleased'])
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    })
  await sleep(1200)
  return true
}

const text = () => evalJs('document.body.innerText')

/** Poll a predicate until true. Fixed sleeps are a race: the tab pane swaps in a
 *  later tick than the click handler returns, so a short sleep reads the
 *  PREVIOUS tab and a real regression sails through. */
async function waitFor(expr: string, ms = 15000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await evalJs(expr)) return true
    await sleep(250)
  }
  return false
}

await sleep(5000)

console.log('=== initial render ===')
console.log(((await text()) as string).slice(0, 500))

for (const tab of ['Source', 'Prompt', 'Run info', 'Transcript']) {
  const clicked = await clickText(tab)
  await sleep(1800)
  const body = ((await text()) as string) ?? ''
  console.log(`\n=== tab ${tab}: clicked=${clicked} bodyLen=${body.length} ===`)
  console.log(body.slice(0, 300))
  if (!clicked) errors.push(`TAB ${tab}: could not find or click the control`)
  if (body.trim() === '') errors.push(`TAB ${tab}: rendered empty body`)
}

// The source pane must show real code from coder-artifacts/, not a blank box.
//
// Order matters and is app behaviour, not test scaffolding:
//   1. pick a FILE first. Source renders nothing until `picked` is set; the
//      default case is selected on load, the default *file* is not.
//   2. THEN switch to Source. Clicking Source with no file selected leaves a
//      blank pane and looks like a broken code viewer.
//   3. folder rows are aria-level="1" and render 60px tall (label + bucket
//      tag); clicking one selects nothing. Files are aria-level="2".
//   4. shiki emits a second <pre> for the line-number gutter holding only a
//      zero-width space, so filter on text length before measuring.
//   5. selection state is an Astryx CSS class (isSelected), not aria-selected.
const pickedName = await evalJs(
  `(() => {const f = document.querySelector('[role="treeitem"][aria-level="2"]');
    return f ? (f.textContent||'').trim().slice(0,40) : null})()`,
)
const picked = await clickText(pickedName ?? '', true)
console.log('file pick:', pickedName, 'clicked=', picked)

await clickText('Source')
const onSource = await waitFor(`(() => {
  const b = document.querySelector('.astryx-tab.selected');
  return b && b.getAttribute('data-tab-value') === 'source';
})()`)
if (!onSource) errors.push('SOURCE: Source tab did not activate')
await sleep(1200)

const codeBox = await evalJs(`(() => {
  const all = [...document.querySelectorAll('pre')]
    .map(p => ({w: Math.round(p.getBoundingClientRect().width),
                h: Math.round(p.getBoundingClientRect().height),
                len: (p.innerText||'').trim().length,
                text: (p.innerText||'').trim().slice(0,120)}))
    .filter(x => x.len > 40)
    .sort((a,b) => b.w - a.w);
  return all.length ? all[0] : null;
})()`)
console.log('\n=== code block ===')
console.log(codeBox)
if (!codeBox) errors.push('SOURCE: no <pre> rendered')
else if (codeBox.w < 200)
  errors.push('SOURCE: code block collapsed (width=' + codeBox.w + ')')

// Unthemed Astryx silently loses every token; assert the theme actually loaded.
// Count only the <link>ed stylesheets: React also injects one inline <style>
// for the tokenizer, so document.styleSheets is 4, not 3.
const theme = await evalJs(`(() => {
  const root = getComputedStyle(document.documentElement);
  return {sheets: document.styleSheets.length,
          spacing2: root.getPropertyValue('--spacing-2').trim(),
          linked: [...document.querySelectorAll('link[rel=stylesheet]')].length};
})()`)
console.log('\n=== theme ===')
console.log(theme)
if (theme.linked !== 3) errors.push('THEME: expected 3 linked stylesheets, got ' + theme.linked)
if (!theme.spacing2) errors.push('THEME: --spacing-2 unset, components will be unstyled')

// --- the transcript must show the model's own output, not just filenames.
// Order matters: Rubric is asserted first, then Transcript is the LAST tab
// clicked, so this reads a settled pane.
await clickText('Rubric')
await sleep(2000)
const rubric = await evalJs(`(() => {
  const t = document.body.innerText;
  const i = t.indexOf('Rust') >= 0 ? t.indexOf('Rust') : 0;
  return {snippet: t.slice(i, i+500), hasMax: /max \\d/.test(t),
          hasCheck: /functional correctness|security failure handling|deliverable present/.test(t)};
})()`)
console.log('\n=== rubric panel ===')
console.log(rubric)
if (!rubric.hasMax) errors.push('RUBRIC: no max_score token rendered')
if (!rubric.hasCheck)
  errors.push('RUBRIC: no pass-anchor checks rendered -- rubric did not reach the UI')

await clickText('Transcript')
const gotAttempts = await waitFor(`document.body.innerText.includes('Round 1')`)
const transcript = await evalJs(`(() => {
  const t = document.body.innerText;
  return {hasAttempt: /Round \\d+/.test(t),
          attempts: (t.match(/Round \\d+/g)||[]).length,
          emptyResp: (t.match(/\\(empty response\\)/g)||[]).length,
          tok: /out tok/.test(t)};
})()`)
console.log('\n=== transcript content ===')
console.log(transcript)
if (!gotAttempts || !transcript.hasAttempt)
  errors.push('TRANSCRIPT: no "Round N" header -- model answers are not rendered')

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
cdp.close()
process.exit(errors.length ? 1 : 0)
