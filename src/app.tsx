import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

import { AppShell } from '@astryxdesign/core/AppShell'
import { TopNav } from '@astryxdesign/core/TopNav'
import {
  SideNav,
  SideNavHeading,
  SideNavSection,
} from '@astryxdesign/core/SideNav'
import { TreeList } from '@astryxdesign/core/TreeList'
import type { TreeListItemData } from '@astryxdesign/core/TreeList'
import {
  HStack,
  VStack,
  Layout,
  LayoutContent,
  LayoutPanel,
} from '@astryxdesign/core/Layout'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Selector } from '@astryxdesign/core/Selector'
import type { SelectorOptionData } from '@astryxdesign/core/Selector'
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from '@astryxdesign/core/Chat'
import { Markdown } from '@astryxdesign/core/Markdown'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { ready as shikiReady, tokenize as shikiTokenize } from './shiki-tokenizer'
import { chunkAnswer } from './answer-chunks'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Token } from '@astryxdesign/core/Token'
import { Badge } from '@astryxdesign/core/Badge'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Icon } from '@astryxdesign/core/Icon'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Center } from '@astryxdesign/core/Center'
import { Divider } from '@astryxdesign/core/Divider'
import { Card } from '@astryxdesign/core/Card'
import { Avatar } from '@astryxdesign/core/Avatar'
import {
  FolderIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  ListBulletIcon,
} from '@heroicons/react/24/outline'

// ---------------------------------------------------------------- data shapes

type Run = {
  id: string
  model: string
  caseCount: number
  roundCount: number
  capped: number
  degenerate: number
}
type Turn = {
  case: string
  round: number
  recorded_at?: string
  answer: string
  outcome: string
  done_reason?: string
  output_tokens?: number
  prompt_tokens?: number
  tokens_per_second?: number
  degenerate?: boolean
  repetition_ratio?: number | null
  prompt: string
}
// Real /api/corpus shape: `cases` is an OBJECT keyed by caseId. Each case
// carries the frozen rubric: max_score plus pass_anchors per graded check.
type Check = { id: string; label: string; max_points: number }
type Case = {
  id: string
  bucket: string
  max_score: number
  pass_anchors: Record<string, string[]>
}
type Corpus = { cases: Record<string, Omit<Case, 'id'>>; generic_checks: Check[] }

const CASES_IN_BENCH = 44

const get = async <T,>(u: string): Promise<T> => (await fetch(u)).json()

// Grades live in their own file on the server, never in the frozen rubric.
// Case keys are `case:<id>`, artifact keys are `file:<path>`.
type GradeMap = Record<string, number>

// ---------------------------------------------------------------- utilities

const LANG: Record<string, string> = {
  rs: 'rust',
  py: 'python',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  json: 'json',
}

// ponytail: buckets are prompt-defined and some (cve-*, re-*, mal-*, ip-*)
// genuinely mix C/Python/shell, so no case-id mapping is right for those;
// they fall to cpp and highlight approximately. Fix properly if the corpus
// starts tagging a deliverable language per case.
function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (LANG[ext]) return LANG[ext]
  // Specific prefixes FIRST: the generic /^<word>-/ catch-all below would
  // otherwise swallow every one of them and label them all rust.
  if (/^rust-/.test(path)) return 'rust'
  if (/^python-/.test(path)) return 'python'
  if (/^php-/.test(path)) return 'php'
  if (/^c-/.test(path)) return 'c'
  if (/^[a-z0-9]+-/.test(path)) return 'rust'
  return 'cpp'
}

function caseLang(id: string): string {
  return langOf(id)
}

const num = (n?: number) =>
  n === undefined || n === null ? '—' : n.toLocaleString('en-US')


// ---------------------------------------------------------------- components

function GradeButtons({
  value,
  onChange,
}: {
  value?: number
  onChange: (v: number) => void
}) {
  return (
    <HStack gap={1}>
      <IconButton
        icon={<Icon icon={CheckCircleIcon} size="sm" />}
        label="Pass"
        size="sm"
        variant={value === 1 ? 'primary' : 'secondary'}
        onClick={() => onChange(1)}
      />
      <IconButton
        icon={<Icon icon={XCircleIcon} size="sm" />}
        label="Fail"
        size="sm"
        variant={value === 0 ? 'destructive' : 'secondary'}
        onClick={() => onChange(0)}
      />
      {value !== undefined && (
        <IconButton
          icon={<Icon icon={MinusCircleIcon} size="sm" />}
          label="Clear grade"
          size="sm"
          variant="ghost"
          onClick={() => onChange(-1)}
        />
      )}
    </HStack>
  )
}

function RoundMessage({ turn }: { turn: Turn }) {
  const lang = caseLang(turn.case)
  const tokens = [
    { id: 'out', label: `${num(turn.output_tokens)} out` },
                { id: 'in', label: `${num(turn.prompt_tokens)} in` },
  ]
  return (
    <>
      <ChatSystemMessage variant="divider" icon={<Icon icon={ListBulletIcon} size="sm" />}>
        <HStack gap={2}>
          <Text size="sm" weight="bold">
            Round {turn.round}
          </Text>
          <Text size="sm" color="secondary">
            {turn.case}
          </Text>
          {turn.recorded_at && (
            <Timestamp value={turn.recorded_at} format="system_time" size="sm" color="secondary" />
          )}
          {tokens.map((t) => (
            <Token key={t.id} label={t.label} size="sm" />
          ))}
          {turn.done_reason === 'length' && <Badge variant="orange" label="length-capped" />}
          {turn.degenerate && <Badge variant="red" label="degenerate" />}
          {turn.repetition_ratio !== null && turn.repetition_ratio !== undefined && (
            <Badge
              variant={turn.repetition_ratio > 0.5 ? 'red' : 'neutral'}
              label={`rep ${turn.repetition_ratio.toFixed(2)}`}
            />
          )}
          {turn.outcome && turn.outcome !== 'ok' && <Badge variant="yellow" label={turn.outcome} />}
        </HStack>
      </ChatSystemMessage>

      <ChatMessage
        sender="user"
        name="prompt"
        avatar={<Avatar name="P" size="sm" />}
        metadata={<ChatMessageMetadata timestamp={turn.recorded_at ?? undefined} />}
      >
        <ChatMessageBubble variant="filled" width="md">
          <Markdown density="compact">{turn.prompt || '_(empty prompt)_'}</Markdown>
        </ChatMessageBubble>
      </ChatMessage>

      <ChatMessage
        sender="assistant"
        name={turn.outcome || 'model'}
        avatar={<Avatar name="M" size="sm" />}
        metadata={
          <ChatMessageMetadata
            timestamp={turn.recorded_at ?? undefined}
            footer={
              turn.tokens_per_second !== undefined && (
                <Text size="sm" color="secondary">
                  {turn.tokens_per_second.toFixed(1)} tok/s
                </Text>
              )
            }
          />
        }
      >
        <ChatMessageBubble variant="ghost" width="full">
          {/* empty answer -> one placeholder text chunk, so the bubble still renders */}
          {(chunkAnswer(turn.answer || '_(empty response)_')).map((chunk, i) =>
            chunk.kind === 'code' ? (
              <CodeBlock
                key={i}
                code={chunk.text}
                language={lang}
                tokenizer={shikiTokenize}
                hasLineNumbers
                hasCopyButton
                isWrapped={false}
                maxHeight={520}
              />
            ) : (
              <Markdown
                key={i}
                density="compact"
                components={{
                  code: ({ code, language }) => (
                    <CodeBlock
                      code={code}
                      language={language ?? lang}
                      tokenizer={shikiTokenize}
                      hasLineNumbers
                      hasCopyButton
                      isWrapped={false}
                      maxHeight={520}
                    />
                  ),
                }}
              >
                {chunk.text}
              </Markdown>
            ),
          )}
        </ChatMessageBubble>
        {turn.done_reason === 'length' && (
          <ChatToolCalls
            label="Generation"
            defaultIsExpanded={false}
            calls={[
              {
                name: 'generate',
                target: turn.case,
                status: 'error',
                errorMessage: `stopped early: ${num(turn.output_tokens)} output tokens, done_reason=length`,
              },
            ]}
          />
        )}
      </ChatMessage>
    </>
  )
}

export default function App() {
  const [runs, setRuns] = useState<Run[]>([])
  const [runId, setRunId] = useState<string>()
  const [model, setModel] = useState<string>() // selected model tag (one per row in the Selector)
  const [turns, setTurns] = useState<Turn[]>([])
  const [cases, setCases] = useState<Record<string, Case>>({})
  const [files, setFiles] = useState<string[]>([])
  const [grades, setGrades] = useState<GradeMap>({})
  const [selCase, setSelCase] = useState<string>()
  const [selFile, setSelFile] = useState<string>()
  const [fileSrc, setFileSrc] = useState<string>()
  const [tab, setTab] = useState('chat')

  useEffect(() => {
    get<Run[]>('/api/runs').then((r) => {
      setRuns(r)
      // ~167 attempts collapse to far fewer model tags; preselect the first.
      if (r[0]) {
        setModel(r[0].model)
        setRunId(r[0].id)
      }
    })
    get<Corpus>('/api/corpus').then((c) =>
      setCases(
        Object.fromEntries(
          Object.entries(c?.cases ?? {}).map(([id, v]) => [id, { id, ...v }]),
        ),
      ),
    )
  }, [])

  useEffect(() => {
    if (!runId) return
    setSelCase(undefined)
    setSelFile(undefined)
    setFileSrc(undefined)
    get<Turn[]>(`/api/run/${runId}`).then((t) => {
      setTurns(t)
      setSelCase(t[0]?.case)
    })
    get<GradeMap>(`/api/grades/${runId}`).then((g) => setGrades(g ?? {}))
    // A run that has not finished every case has no artifacts yet — an empty
    // listing is the expected state, not an error.
    get<{ files?: string[] }>(`/api/artifacts/${runId}`)
      .then((a) => setFiles(a?.files ?? []))
      .catch(() => setFiles([]))
  }, [runId])

  useEffect(() => {
    if (!runId || !selFile) return setFileSrc(undefined)
    let live = true
    fetch(`/api/artifact/${runId}/${selFile}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setFileSrc(t))
      .catch(() => live && setFileSrc('// could not load this artifact'))
    return () => {
      live = false
    }
  }, [runId, selFile])

  const saveGrade = useCallback(
    (key: string, v: number) => {
      if (!runId) return
      const next = { ...grades }
      if (v < 0) delete next[key]
      else next[key] = v
      setGrades(next)
      fetch(`/api/grades/${runId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
    },
    [grades, runId],
  )

  const run = runs.find((r) => r.id === runId)
  const caseTurns = useMemo(() => turns.filter((t) => t.case === selCase), [turns, selCase])
  const kase = selCase ? cases[selCase] : undefined
  // One row per pass anchor, grouped by the check it belongs to.
  const claims = useMemo(
    () =>
      Object.entries(kase?.pass_anchors ?? {}).flatMap(([check, anchors]) =>
        anchors.map((text, i) => ({ id: `${check}.${i}`, check, text })),
      ),
    [kase],
  )

  const graded = Object.keys(grades).length
  // /api/runs carries one entry per ATTEMPT; the same model tag shows up many
  // times (retries, partial runs). Group by tag so the Selector lists each
  // model once and the nav only lists that model's attempts.
  const byModel = useMemo(() => {
    const m = new Map<string, Run[]>()
    for (const r of runs) m.set(r.model, [...(m.get(r.model) ?? []), r])
    for (const list of m.values())
      list.sort((a, b) => b.caseCount - a.caseCount || b.id.localeCompare(a.id))
    return m
  }, [runs])
  const modelOptions = useMemo<SelectorOptionData[]>(
    () =>
      [...byModel.keys()].sort().map((tag) => ({
        value: tag,
        label: tag,
        description: `${byModel.get(tag)?.length ?? 0} attempts`,
      })),
    [byModel],
  )
  // Attempts of the selected model, newest-completion first; selecting a
  // different model keeps the deepest attempt for it.
  const attemptTree = useMemo<TreeListItemData[]>(
    () =>
      (model ? (byModel.get(model) ?? []) : []).map((r) => ({
        id: r.id,
        label: (
          <Text maxLines={1}>
            {r.caseCount}/{CASES_IN_BENCH} · {r.roundCount}r
          </Text>
        ),
        startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
        isSelected: r.id === runId,
        endContent: r.degenerate ? <Badge variant="red" label="deg" /> : undefined,
        onClick: () => setRunId(r.id),
      })),
    [byModel, model, runId],
  )
  const pickModel = useCallback(
    (tag: string) => {
      setModel(tag)
      setRunId(byModel.get(tag)?.[0]?.id)
    },
    [byModel],
  )

  // Case tree carries the grades inline; artifact files hang off the model tag
  // directory the way the on-disk coder-artifacts/ layout does.
  const caseTree = useMemo<TreeListItemData[]>(
    () =>
      [...new Set(turns.map((t) => t.case))].sort().map((c) => {
        const rounds = turns.filter((t) => t.case === c)
        return {
          id: c,
          label: <Text maxLines={1}>{c}</Text>,
          startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
          isSelected: c === selCase,
          endContent: <GradeButtons value={grades[`case:${c}`]} onChange={(v) => saveGrade(`case:${c}`, v)} />,
          onClick: () => {
            setSelCase(c)
            setTab('chat')
          },
          children: rounds.map((r) => ({
            id: `${c}#${r.round}`,
            label: (
              <Text maxLines={1} size="sm" color="secondary">
                round {r.round} · {r.outcome || 'ok'}
              </Text>
            ),
            startContent: <Icon icon={ChatBubbleLeftRightIcon} size="xsm" />,
            onClick: () => {
              setSelCase(c)
              setTab('chat')
            },
          })),
        }
      }),
    [turns, selCase, grades, saveGrade],
  )

  const fileTree = useMemo<TreeListItemData[]>(() => {
    if (!files.length) return []
    const byTag = new Map<string, string[]>()
    for (const f of files) {
      const i = f.indexOf('/')
      const tag = i < 0 ? '.' : f.slice(0, i)
      const list = byTag.get(tag) ?? []
      list.push(i < 0 ? f : f.slice(i + 1))
      byTag.set(tag, list)
    }
    return [...byTag.entries()].map(([tag, list]) => ({
      id: `dir:${tag}`,
      label: <Text maxLines={1}>{tag}</Text>,
      startContent: <Icon icon={FolderIcon} size="xsm" />,
      isExpanded: true,
      children: list
        .sort()
        .map((name) => ({
          id: `${tag}/${name}`,
          label: <Text maxLines={1}>{name}</Text>,
          startContent: <Icon icon={CodeBracketIcon} size="xsm" />,
          isSelected: `${tag}/${name}` === selFile,
          onClick: () => {
            setSelFile(`${tag}/${name}`)
            setTab('source')
          },
        })),
    }))
  }, [files, selFile])

  return (
    <AppShell
      contentPadding={0}
      height="fill"
      topNav={
        <TopNav
          label="Benchmark grader"
          heading="Benchmark Grader"
          startContent={
            <HStack gap={2} vAlign="center">
              <Selector
                label="Model"
                value={model}
                options={modelOptions}
                onChange={pickModel}
                placeholder="Select model"
                searchPlaceholder="Filter models"
                emptyText="No matching model"
                hasSearch
                size="sm"
                width={280}
              />
              {model && (
                <Badge variant="blue" label={`${byModel.get(model)?.length ?? 0} attempts`} />
              )}
              {run && (
                <>
                  <Badge
                    variant={run.caseCount >= CASES_IN_BENCH ? 'green' : 'neutral'}
                    label={`${run.caseCount}/${CASES_IN_BENCH} cases`}
                  />
                  {run.capped > 0 && <Badge variant="orange" label={`${run.capped} capped`} />}
                  {run.degenerate > 0 && <Badge variant="red" label={`${run.degenerate} degenerate`} />}
                </>
              )}
            </HStack>
          }
          endContent={
            <HStack gap={2}>
              <Token label={`${graded} graded`} />
              <Text size="sm" color="secondary">
                {runId ?? 'no run selected'}
              </Text>
            </HStack>
          }
        />
      }
      sideNav={
        <SideNav resizable={{ defaultWidth: 300, minWidth: 220, maxWidth: 480 }}>
          <SideNavHeading heading="Benchmark Grader" />
          <SideNavSection
            title={model ? `Attempts (${attemptTree.length})` : 'Attempts'}
          >
            {attemptTree.length ? (
              <TreeList items={attemptTree} density="compact" aria-label="Attempts of the selected model" />
            ) : (
              <Text size="sm" color="secondary">
                {model ? 'No attempts recorded for this model.' : 'Pick a model above.'}
              </Text>
            )}
          </SideNavSection>
          <SideNavSection title={`Cases (${caseTree.length})`}>
            <TreeList items={caseTree} density="compact" aria-label="Cases" />
          </SideNavSection>
          <SideNavSection title={`Files (${files.length})`}>
            {files.length ? (
              <TreeList items={fileTree} density="compact" aria-label="Artifact files" />
            ) : (
              <Text size="sm" color="secondary">
                No generated files yet — artifacts land only after all {CASES_IN_BENCH} cases finish.
              </Text>
            )}
          </SideNavSection>
        </SideNav>
      }
    >
      <Layout
        height="fill"
        content={
          <LayoutContent padding={0} label="Review">
            {!runId ? (
              <Centered>Select a model to start grading.</Centered>
            ) : (
              <Layout
                height="fill"
                content={
                  <LayoutPanel isScrollable padding={2} label="Review">
                    <VStack gap={3} align="stretch">
                      <HStack gap={2}>
                        <TabList
                          value={tab}
                          onChange={(v: string) => setTab(v)}
                          aria-label="Review surface"
                        >
                          <Tab value="chat" label="Chat" icon={<Icon icon={ChatBubbleLeftRightIcon} size="sm" />} />
                          <Tab value="source" label="Source" icon={<Icon icon={CodeBracketIcon} size="sm" />} />
                          <Tab value="grade" label="Grade" icon={<Icon icon={ListBulletIcon} size="sm" />} />
                        </TabList>
                      </HStack>

                      {tab === 'chat' &&
                        (selCase ? (
                          <Card>
                            <ChatMessageList density="compact" gap={3} align="top">
                              {caseTurns.length ? (
                                caseTurns.map((t) => (
                                  <Fragment key={`${t.case}#${t.round}`}>
                                    <RoundMessage turn={t} />
                                  </Fragment>
                                ))
                              ) : (
                                <ChatSystemMessage>No rounds recorded for this case.</ChatSystemMessage>
                              )}
                            </ChatMessageList>
                          </Card>
                        ) : (
                          <Centered>Pick a case on the left.</Centered>
                        ))}

                      {tab === 'source' &&
                        (selFile ? (
                          <CodeBlock
                            code={fileSrc ?? '// loading…'}
                            language={langOf(selFile)}
                            tokenizer={shikiTokenize}
                            title={selFile}
                            hasLineNumbers
                            hasCopyButton
                            isWrapped={false}
                            maxHeight="60vh"
                            width="full"
                          />
                        ) : (
                          <Centered>Pick an artifact file to read its source.</Centered>
                        ))}

                      {tab === 'grade' && (
                        <Layout
                          start={
                            <LayoutPanel width="40%" padding={0} label="Rubric">
                              <VStack gap={2} align="stretch" padding={2}>
                                <Heading level={2}>{selCase ?? 'No case'}</Heading>
                                {kase && (
                                  <HStack gap={2}>
                                    <Token label={kase.bucket} />
                                    <Token label={`max ${kase.max_score}`} />
                                  </HStack>
                                )}
                                {claims.length ? (
                                  claims.map((c, i) => (
                                    <Card key={c.id}>
                                      <VStack gap={1} align="stretch">
                                        {i === 0 || claims[i - 1].check !== c.check ? (
                                          <Text size="sm" weight="bold">
                                            {c.check.replace(/_/g, ' ')}
                                          </Text>
                                        ) : null}
                                        <Text size="sm">{c.text}</Text>
                                      </VStack>
                                    </Card>
                                  ))
                                ) : (
                                  <Text size="sm" color="secondary">
                                    No rubric claims for this case.
                                  </Text>
                                )}
                              </VStack>
                            </LayoutPanel>
                          }
                          content={
                            <LayoutPanel padding={2} isScrollable label="Rounds">
                              <VStack gap={2} align="stretch">
                                <HStack gap={2}>
                                  <Text weight="bold">Case grade</Text>
                                  <GradeButtons
                                    value={grades[`case:${selCase}`]}
                                    onChange={(v) => saveGrade(`case:${selCase}`, v)}
                                  />
                                </HStack>
                                <Divider />
                                {caseTurns.map((t) => (
                                  <HStack key={`g${t.round}`} gap={2}>
                                    <Text size="sm" color="secondary">
                                      round {t.round}
                                    </Text>
                                    <GradeButtons
                                      value={grades[`case:${selCase}#${t.round}`]}
                                      onChange={(v) =>
                                        saveGrade(`case:${selCase}#${t.round}`, v)
                                      }
                                    />
                                    <Text size="sm" color="secondary">
                                      {t.outcome} · {num(t.output_tokens)} tok
                                    </Text>
                                  </HStack>
                                ))}
                                <Divider />
                                <Text weight="bold">File grades</Text>
                                {files.map((f) => (
                                  <HStack key={f} gap={2}>
                                    <Icon icon={DocumentTextIcon} size="xsm" />
                                    <Text size="sm" maxLines={1}>
                                      {f}
                                    </Text>
                                    <GradeButtons
                                      value={grades[`file:${f}`]}
                                      onChange={(v) => saveGrade(`file:${f}`, v)}
                                    />
                                  </HStack>
                                ))}
                                {!files.length && (
                                  <Text size="sm" color="secondary">
                                    No artifact files yet.
                                  </Text>
                                )}
                              </VStack>
                            </LayoutPanel>
                          }
                        />
                      )}
                    </VStack>
                  </LayoutPanel>
                }
              />
            )}
          </LayoutContent>
        }
      />
    </AppShell>
  )
}

// Both placeholders are the same shape: centred, generously padded, muted.
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Center minHeight={320} padding={6}>
      <Text color="secondary" justify="center">
        {children}
      </Text>
    </Center>
  )
}

// Wait for the Shiki highlighter before the first paint: CodeBlock's tokenizer
// prop is synchronous, so no block may render before tokens can exist.
if (typeof document !== 'undefined') {
  const root = document.getElementById('root')
  if (root)
    void shikiReady().then(() =>
      createRoot(root).render(
        <Theme theme={neutralTheme}>
          <App />
        </Theme>,
      ),
    )
}
