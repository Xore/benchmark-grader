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
// ponytail: binds 127.0.0.1 because the server hardcodes hostname '0.0.0.0'
// (serve.ts), so loopback is the canonical URL. Chrome has no restriction on
// loopback targets; the browser TOOL does, which is what the old LAN IP was
// working around. Override with UI_HOST.

const HOST = process.env.UI_HOST ?? 'http://127.0.0.1:3020'
// ponytail: launch our OWN chrome on a free port instead of attaching to a
// shared :9222. Attaching meant a stale tab left by any other process (or a
// concurrent run of this same script) wedged the endpoint, and the failure
// surfaced as a bare "timeout: Runtime.evaluate" that looks like a page bug
// but is not. An isolated browser removes the failure mode entirely.
const CHROME = process.env.CHROME ?? 'google-chrome'
const DEBUG_PORT = Number(process.env.UI_CDP_PORT ?? 9333)
const CDP = `http://127.0.0.1:${DEBUG_PORT}`
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
// Own browser for this run only. --remote-debugging-port binds 127.0.0.1
// explicitly so it cannot collide with another chrome on the box.
const chrome = Bun.spawn(
  [
    CHROME,
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + (await import('fs')).mkdtempSync('/tmp/verify-ui-'),
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ],
  {stdout: 'ignore', stderr: 'ignore'},
)

// Wait for the endpoint to answer instead of firing a request into a browser
// that has not finished booting -- that race is what surfaced as a 15s
// "timeout: Runtime.evaluate" rather than as "chrome never started".
let up = false
for (let i = 0; i < 60 && !up; i++) {
  await sleep(250)
  up = await fetch(`${CDP}/json/version`)
    .then(r => r.ok)
    .catch(() => false)
}
if (!up) {
  console.error(`chrome never came up on ${CDP}`)
  chrome.kill('SIGKILL')
  process.exit(2)
}

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
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const url = m.params.entry.url ?? ''
    // ponytail: exclude favicon. The app never shipped one, so a cold browser
    // always requests /favicon.ico and always 404s. This gate used to pass only
    // because the shared :9222 browser had it cached from some earlier session
    // -- with its own cold browser the false positive is exposed. Every other
    // error-level log entry still fails the run.
    if (url.includes('/favicon.ico')) return
    errors.push('LOG ' + m.params.entry.text + ' ' + url)
  }
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

// Desktop width first, then the cramped one.
//
// The old gate ran only at Chrome's default 780px, where the three resizable
// panels are 256 + 523 + 202: the inspector is pinned at its 160px minimum and
// the code pane is genuinely squeezed. That is a real but unrepresentative
// width -- nobody reviews 40-file cases in a 780px window. Worse, a layout that
// only ever gets checked at one cramped width is a layout that has never been
// checked where it is used.
//
// So: assert the real desktop geometry at 1600px, then resize down and re-assert
// that nothing breaks or vanishes at the cramped width. Measured 2026-10-04:
// the code block is 1022px at 1600 (the content pane is also 1022, i.e. it
// fills), and still renders at 780.
const DESKTOP = {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}
const CRAMPED = {width: 780, height: 493, deviceScaleFactor: 1, mobile: false}

await cdp.send('Emulation.setDeviceMetricsOverride', DESKTOP)
await sleep(2500)

await sleep(5000)

console.log('=== initial render ===')
console.log(((await text()) as string).slice(0, 500))

// Pick a FILE before visiting any tab.
//
// Source renders nothing until `picked` is set. The tab loop below visits
// Source FIRST with nothing selected, which caches the empty pane, and a
// later re-click on the already-selected tab is a no-op -- so the pane stays
// blank for the rest of the run and the <pre> assertion fails even though the
// viewer works. Selecting first makes the very first Source visit meaningful.
const pickedNameEarly = await evalJs(
  `(() => {const f = document.querySelector('[role="treeitem"][aria-level="2"]');
    return f ? (f.textContent||'').trim().slice(0,40) : null})()`,
)
if (pickedNameEarly) await clickText(pickedNameEarly, true)

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

// Poll for the <pre> instead of sleeping a fixed amount. Shiki tokenises
// asynchronously, so the code block appears some time after the tab mounts;
// a fixed wait is a race that fails on a slow run and wastes time on a fast
// one. Re-selecting the tab is not an option -- clicking an already-selected
// tab is a no-op, so a missed render can never be retried that way.
//
// waitFor() answers "did it appear", not "what is it", so poll for truthiness
// here and read the block once at the end.
// Look for the code BODY, not specifically a <pre>.
//
// CodeBlock with highlightMode="spans" emits a <code> containing one <span>
// per token, and does not use a <pre> at all in that mode -- the gutter is a
// sibling. Asserting on <pre> therefore fails against a correctly rendered
// block. Match the container's own class and require real text in it, which
// is what "the source viewer works" actually means.
const PRE_SEL = `(() => {
  const block = document.querySelector('.astryx-code-block');
  if (!block) return null;
  const cand = [...block.querySelectorAll('pre, code, [class*="code-body"], [class*="highlight"]')]
    .map(p => ({w: Math.round(p.getBoundingClientRect().width),
                len: (p.innerText||'').trim().length,
                text: (p.innerText||'').trim().slice(0,120)}))
    .filter(x => x.len > 40)
    .sort((a,b) => b.len - a.len);
  return cand.length ? cand[0] : null;
})()`
await waitFor(PRE_SEL, 10000)
const codeBox = await evalJs(PRE_SEL)
await sleep(300)
console.log('\n=== code block ===')
console.log(codeBox)
if (!codeBox) errors.push('SOURCE: no <pre> rendered')
else if (codeBox.w < 200)
  errors.push('SOURCE: code block collapsed (width=' + codeBox.w + ')')

// The code must actually USE the pane at desktop width.
//
// This is the assertion that would have caught the single-child-horizontal-
// Stack collapse: removing the Source-tab file list left one child, the Stack
// shrank to content, and the block fell to 202px -- while the code still
// rendered and every other check stayed green. A 200px floor is too low to see
// it, so require the block to occupy most of its content pane.
const layout = await evalJs(`(() => {
  const block = document.querySelector('.astryx-code-block');
  const pane = block && block.closest('.astryx-layout-content');
  if (!block) return null;
  const bw = Math.round(block.getBoundingClientRect().width);
  const pw = pane ? Math.round(pane.getBoundingClientRect().width) : 0;
  return {blockW: bw, paneW: pw, ratio: pw ? +(bw/pw).toFixed(2) : 0,
          panels: [...document.querySelectorAll('.astryx-layout-content')]
            .map(p => Math.round(p.getBoundingClientRect().width))};
})()`)
console.log('\n=== layout @1600 ===')
console.log(layout)
if (layout) {
  if (layout.blockW < 600)
    errors.push(`LAYOUT: code block only ${layout.blockW}px at 1600px viewport`)
  if (layout.ratio < 0.9)
    errors.push(`LAYOUT: code block fills only ${Math.round(layout.ratio*100)}% of its ${layout.paneW}px pane`)
}

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

// --- per-round ChatMessage -----------------------------------------------
// One assistant bubble per round, so the reviewer can see where an attempt
// ends. A single wrapping bubble ran all rounds together and the round
// numbers lost their meaning.
const rounds = await evalJs(`(() => {
  const names = [...document.querySelectorAll('.astryx-chat-message__name, [class*="chat-message"] [class*="name"]')]
    .map(n => (n.textContent||'').trim()).filter(Boolean);
  return {
    roundLabels: names.filter(n => /^Round \\d+$/.test(n)).length,
    timeEls: document.querySelectorAll('time').length,
  };
})()`)
console.log('per-round:', rounds)
await sleep(800)
const roundMsg = await evalJs(`(() => {
  const t = document.body.innerText;
  return {
    roundN: (t.match(/Round \\d+/g)||[]).length,
    timingCollapsed: (t.match(/Timing/g)||[]).length,
  };
})()`)
console.log('transcript rounds:', roundMsg)
if (!roundMsg.roundN) errors.push('TRANSCRIPT: no per-round labels after the split')

// "Recorded" lives in the RUN INFO pane, not the transcript (checked the
// source, not guessed). Was the raw ISO string printed verbatim.
await clickText('Run info')
await sleep(900)
const stampsInfo = await evalJs(`document.querySelectorAll('time').length`)
console.log('time elements @run info:', stampsInfo)
if (!stampsInfo)
  errors.push('TIMESTAMP: no <time> element in the Run info pane')
await clickText('Transcript')
await sleep(700)


// --- next ungraded ------------------------------------------------------
await clickText('Properties')
await sleep(900)
const nextLabel = await evalJs(
  `[...document.querySelectorAll('button')]
     .map(b => (b.innerText||'').trim())
     .find(t => /^Next ungraded:|^All files graded$/.test(t)) || ''`,
)
console.log('next-ungraded button:', JSON.stringify(nextLabel))
if (!nextLabel)
  errors.push('NAV: no next-ungraded affordance in the inspector')

// "Graded at" lives in the inspector. Also the raw ISO string before.
const stampsProps = await evalJs(`(() => {
  const t = [...document.querySelectorAll('time')];
  return { n: t.length, txt: t.map(x => (x.textContent||'').trim()) };
})()`)
console.log('time elements @properties:', JSON.stringify(stampsProps))
if (!stampsProps.n)
  errors.push('TIMESTAMP: no <time> element in the inspector')

// Narrow pass. Desktop is the primary layout; this only asserts that shrinking
// the window does not BREAK anything. A 200px code block is legitimate here --
// at 780px the inspector is pinned at its 160px minimum and the content pane is
// genuinely small -- so the width floor is deliberately absent below.
await cdp.send('Emulation.setDeviceMetricsOverride', CRAMPED)
await sleep(1500)

// Return to Source with a file selected first: the checks below look for the
// code block, and the tab loop ended on Transcript, where there is none. A
// "missing" code block here would be the probe's fault, not the app's.
const narrowFile = await evalJs(
  `(() => {const f = document.querySelector('[role="treeitem"][aria-level="2"]');
    return f ? (f.textContent||'').trim().slice(0,40) : null})()`,
)
if (narrowFile) await clickText(narrowFile, true)
await clickText('Source')
await sleep(1500)

const narrow = await evalJs(`(() => {
  const gone = [];
  // Every panel must still exist and stay non-zero at the cramped width.
  for (const sel of ['.astryx-layout-panel', '.astryx-code-block']) {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) gone.push(sel + ':missing');
    else els.forEach((e, i) => {
      const w = Math.round(e.getBoundingClientRect().width);
      if (w <= 0) gone.push(sel + '[' + i + ']:0px');
    });
  }
  // Horizontal overflow is the classic narrow-window failure.
  return {gone, overflowX: document.documentElement.scrollWidth - window.innerWidth};
})()`)

// Grading controls live in the inspector's Properties panel, so that panel has
// to be the active tab -- checking while Source is showing reports a false
// failure. (Verified they DO appear once Properties is selected.)
await clickText('Properties')
await sleep(1200)
const gradeBtns = await evalJs(
  `[...document.querySelectorAll('button')]
     .filter(b => /^(Pass|Fail)$/.test((b.innerText||'').trim())).length`,
)
console.log('\n=== layout @780 ===')
console.log({...narrow, gradeBtns})
if (narrow.gone.length)
  errors.push('NARROW: collapsed to zero width: ' + narrow.gone.join(', '))
if (gradeBtns === 0)
  errors.push('NARROW: Pass/Fail controls not reachable at 780px -- cannot grade')
if (narrow.overflowX > 2)
  errors.push(`NARROW: horizontal overflow of ${narrow.overflowX}px at 780px`)

// Glyph-overflow audit. The old check compared button.scrollWidth to
// button.clientWidth and so was blind to the actual defect: the cut was on an
// INNER label span, so the button element never tripped it and the gate passed
// a visibly ellipsized control. This measures where the glyphs really end.
//
// Visually-hidden elements (1px boxes) are excluded: being 1px wide is their
// entire purpose, so flagging them is noise.
const overflow = await evalJs(`(() => {
  const out = []
  for (const e of document.querySelectorAll('*')) {
    if (e.children.length !== 0 || e.clientWidth === 0) continue
    const box = e.getBoundingClientRect()
    if (box.width < 4) continue            // visually-hidden (a11y skips, sr-only)
    const range = document.createRange()
    range.selectNodeContents(e)
    const right = Math.max(0, ...[...range.getClientRects()].map(r => r.right))
    const over = Math.round(right - box.right)
    if (over <= 1) continue
    // Distinguish a DESIGNED ellipsis from a hard cut. A long case id in a
    // 256px sidebar legitimately truncates to "k8s-audi\u2026" and the full
    // value is in the selector and the URL; that is not a defect. What IS a
    // defect is text that silently disappears with no ellipsis, or a primary
    // action reduced to a couple of glyphs. So: flag cuts, and flag ellipsis
    // only when so little fits that the control stops being identifiable.
    const cs = getComputedStyle(e)
    const designed = cs.textOverflow === 'ellipsis' || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)'
    const readable = cs.textOverflow === 'ellipsis' ? over : 0
    out.push({
      txt: (e.textContent||'').trim().slice(0,44),
      w: Math.round(box.width),
      over,
      ellipsis: cs.textOverflow === 'ellipsis',
      // A control label narrower than its own widest word is unreadable.
      fatal: !designed || box.width < 24,
    })
  }
  return out
})()`)
console.log('glyph overflow:', JSON.stringify(overflow))
for (const o of overflow) {
  if (o.fatal)
    errors.push(
      'OVERFLOW: "' + o.txt + '" ' + (o.ellipsis ? 'ellipsised to ' : 'hard-cut at ') +
        o.w + 'px, ' + o.over + 'px past its box',
    )
  else
    console.log('  ok (designed ellipsis): "' + o.txt + '" at ' + o.w + 'px')
}

console.log('\n=== ERRORS ===')
console.log(errors.length ? errors.join('\n') : '(none)')
cdp.close()
// Take our own browser down with us. The old shared-:9222 setup leaked the
// browser and every tab in it, which is exactly what wedged later runs.
chrome?.kill('SIGKILL')
process.exit(errors.length ? 1 : 0)
