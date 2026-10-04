// Split a benchmark answer into renderable chunks.
//
// The models under test return RAW SOURCE, not markdown: across a 84-turn run
// there were 13 ``` markers in 84 answers, so the Markdown code override
// almost never fires and the source renders as unhighlighted prose. So decide
// per answer whether it is code, and route raw code straight to CodeBlock.
//
// ponytail: deterministic line/word heuristics, no LLM and no network. If the
// corpus ever emits a language whose shape evades these signals it will render
// as prose; add a signal here before reaching for an LLM.

export type Chunk =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }

/** Lines starting with a language keyword/construct. */
const KEYWORD_START =
  /^(#include|#define|fn |def |class |struct |enum |impl |trait |use |import |from |package |namespace |public |private |protected |static |const |let |var |func |function |return |if |else |elif |for |while |switch |case |match |mod |type |async |await |yield |try |except |catch|@|\$\(|<\?php|#!)/

/** A prose sentence: many words, terminal punctuation, no code punctuation. */
function isSentence(line: string): boolean {
  if (/[;{}()=><|&]/.test(line)) return false
  const words = line.trim().split(/\s+/)
  return words.length >= 6 && /[.!?:]$/.test(line.trim())
}

function codeScore(block: string): number {
  const lines = block.split('\n')
  const nonBlank = lines.filter((l) => l.trim())
  if (!nonBlank.length) return 0

  let score = 0
  const all = block
  // S1: braces/brackets/parens all balanced, with at least one `{`.
  const bal = (a: string, b: string) => {
    let d = 0
    for (const ch of all) {
      if (ch === a) d++
      else if (ch === b) d--
      if (d < 0) return false
    }
    return d === 0
  }
  if (all.includes('{') && bal('{', '}') && bal('[', ']') && bal('(', ')')) score++

  // S2: statement terminators or block delimiters on >=10% of lines.
  if (nonBlank.filter((l) => /[;{}]\s*$/.test(l)).length / nonBlank.length >= 0.1) score++

  // S3: language keywords at line starts on >=20% of lines.
  if (nonBlank.filter((l) => KEYWORD_START.test(l)).length / nonBlank.length >= 0.2) score++

  // S4: consistent indentation (>=15% indented lines, multiples of 2 only).
  const indented = nonBlank.filter((l) => /^\s+\S/.test(l))
  if (
    indented.length / nonBlank.length >= 0.15 &&
    indented.every((l) => (l.match(/^ */) as RegExpMatchArray)[0].length % 2 === 0)
  )
    score++

  // S5: not prose — fewer than 25% of lines look like sentences.
  if (nonBlank.filter(isSentence).length / nonBlank.length < 0.25) score++

  return score
}

/** >=2 independent signals AND prose ratio under 25% -> code. */
export function isCode(block: string): boolean {
  if (!block.trim()) return false
  if (block.includes('```')) return false // genuine markdown: let Markdown own it
  return codeScore(block) >= 2
}

/**
 * Answer -> chunks. Prose with a fenced block comes back as one text chunk so
 * the existing Markdown path (and its components.code override) still runs.
 * Mixed answers are split on blank lines; each code run gets its own block.
 */
export function chunkAnswer(answer: string): Chunk[] {
  const text = answer ?? ''
  if (!text.trim()) return []
  if (text.includes('```')) return [{ kind: 'text', text }]

  const blocks = text.split(/\n{2,}/).filter((b) => b.trim())
  if (blocks.length === 1) return [isCode(blocks[0]) ? { kind: 'code', text: blocks[0] } : { kind: 'text', text }]

  // Multi-paragraph: group consecutive same-kind blocks, then drop lone prose.
  const kinds = blocks.map((b) => (isCode(b) ? 'code' : 'text'))
  const out: Chunk[] = []
  for (let i = 0; i < blocks.length; ) {
    let j = i
    while (j + 1 < blocks.length && kinds[j + 1] === kinds[i]) j++
    out.push({ kind: kinds[i] as Chunk['kind'], text: blocks.slice(i, j + 1).join('\n\n') })
    i = j + 1
  }
  return out.length > 1 && out.every((c) => c.kind === 'text')
    ? [{ kind: 'text', text }]
    : out
}

// Self-check: bun src/answer-chunks.ts --selftest
if (typeof process !== 'undefined' && process.argv.includes('--selftest')) {
  const expect = (name: string, got: Chunk[], want: Chunk['kind'][]) => {
    const kinds = got.map((c) => c.kind)
    if (JSON.stringify(kinds) !== JSON.stringify(want))
      throw new Error(`${name}: got ${JSON.stringify(kinds)} want ${JSON.stringify(want)}`)
    console.log('ok', name, JSON.stringify(kinds))
  }

  expect('empty', chunkAnswer(''), [])
  expect('whitespace', chunkAnswer('   \n\n '), [])
  expect(
    'raw rust',
    chunkAnswer('use std::io::Result;\n\nfn main() {\n    let x = 1;\n    println!("{}", x);\n}\n'),
    ['code'],
  )
  expect('single line code', chunkAnswer('int main(void) { return 0; }'), ['code'])
  expect(
    'prose',
    chunkAnswer(
      'The scanner reads each line and validates it. Malformed input must not be echoed back to the caller. Every rejected line increments the error counter.',
    ),
    ['text'],
  )
  expect(
    'prose with fence',
    chunkAnswer('Here is the fix:\n\n```rust\nfn main() {}\n```\n'),
    ['text'],
  )
  expect(
    'mixed intro + code',
    chunkAnswer(
      'Here is the minimal parser you asked for.\n\nfn main() {\n    let n: i64 = read_i64();\n    println!("{}", n);\n}\n',
    ),
    ['text', 'code'],
  )
  expect(
    'multi code chunk',
    chunkAnswer(
      'Part one.\n\nfn a() {\n    let x = 1;\n}\n\nPart two.\n\ndef b():\n    y = 2\n    return y\n',
    ),
    ['text', 'code', 'text', 'code'],
  )
  console.log('OK chunkAnswer')
}