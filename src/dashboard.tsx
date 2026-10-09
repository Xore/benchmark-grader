// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, useMemo, useEffect, Fragment, type CSSProperties} from 'react';

import {Layout, LayoutContent, LayoutPanel} from '@astryxdesign/core/Layout';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {Text, Heading} from '@astryxdesign/core/Text';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Stack, StackItem, HStack, VStack} from '@astryxdesign/core/Layout';
import {useMediaQuery, useAnnounce} from '@astryxdesign/core/hooks';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Button} from '@astryxdesign/core/Button';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {List, ListItem} from '@astryxdesign/core/List';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Token} from '@astryxdesign/core/Token';
import {Card} from '@astryxdesign/core/Card';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Banner} from '@astryxdesign/core/Banner';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav} from '@astryxdesign/core/TopNav';
import {ContextMenu} from '@astryxdesign/core/ContextMenu';
import {ChatMessage, ChatMessageList, ChatMessageBubble} from '@astryxdesign/core/Chat';
import {Markdown} from '@astryxdesign/core/Markdown';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {tokenize} from './shiki-tokenizer';
import {chunkAnswer} from './answer-chunks';
import {
  listRuns,
  loadRun,
  loadGrades,
  saveGrade,
  saveLineNote,
  promptOf,
  shortSha,
  optionsOf,
  linesOf,
  bytesOf,
  ALL_MODELS_RUN_ID,
  gradeFileKey,
  gradeFor,
  runIdForModel,
  type Artifact,
  type Case,
  type GradeBook,
  type Run,
  type RunSummary,
} from './data';
import {Icon} from '@astryxdesign/core/Icon';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TreeList} from '@astryxdesign/core/TreeList';
import type {TreeListItemData} from '@astryxdesign/core/TreeList';
import {
  FolderIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  CheckIcon,
  XMarkIcon,
  MinusIcon,
} from '@heroicons/react/24/outline';

const styles: Record<string, CSSProperties> = {
  contentFill: {
    height: '100%',
  },
  tabListPadding: {
    paddingTop: 'var(--spacing-2)',
  },
  metadataCompact: {
    gap: 'var(--spacing-1) var(--spacing-3)',
  },
  editorArea: {
    overflow: 'auto',
    minHeight: 0,
  },
  fileExplorer: {
    padding: 'var(--spacing-4)',
    minWidth: 0,
  },
  propertiesPanel: {
    height: '100%',
  },
  propertiesContent: {
    flex: 1,
    minHeight: 0,
  },
};



function buildFileTree(
  cases: Case[],
  selectedId: string,
  onFileClick: (c: Case, a: Artifact) => void,
  // Grade state, so the tree answers "what have I already judged?" at a glance.
  // Without it a passed file and an ungraded file look identical and the only
  // way to find out is to remember -- pure recall over a 40-file case.
  grades: GradeBook,
): TreeListItemData[] {
  const label = (text: string) => <Text maxLines={1}>{text}</Text>;
  return cases.map(c => ({
    id: c.key,
    label: label(c.label ?? c.id),
    description: c.label ? c.runId : undefined,
    startContent: <Icon icon={FolderIcon} size="xsm" />,
    // Bucket as end content, straight from the frozen rubric. The old surface
    // showed it here; without it the tree gives no clue which corpus slice a
    // case belongs to.
    endContent: c.rubric?.bucket ? <Token label={c.rubric.bucket} size="sm" /> : undefined,
    isExpanded: true,
    children: (() => {
      // description only where the basename is ambiguous. Same basename in two
      // dirs does happen (tool-written/parse_record.c vs tool-written/src/),
      // and then the path is the only thing telling them apart. Everywhere else
      // it is pure noise that hard-clipped 18-61px at narrow widths.
      const names = c.artifacts.map(a => a.path.split('/').pop() ?? a.path);
      const dupe = (n: string) => names.filter(x => x === n).length > 1;
      return c.artifacts.map((a, i) => {
      const score = gradeFor(grades, c, a)?.score;
      const name = names[i]!;
      return {
        id: `${c.key}:${a.path}`,
        // Basename label; `description` carries the full path only when the
        // basename repeats (see below). The label used to be the whole path,
        // which clipped every row at EVERY width; the paths remain visible in
        // the panel built to hold them.
        // Same basename twice in one case happens (tool-written/parse_record.c
        // vs tool-written/src/). The parent dir is the only thing that tells
        // them apart, so it goes in the label -- which ellipsises by design.
        // It does NOT go in `description`: TreeListItem renders that in a
        // fixed-width span with no style hook, so a path there hard-clips.
        label: label(dupe(name) ? `${a.path.split('/').slice(-2, -1)[0]}/${name}` : name),
        startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
        // Three distinct states, never two: pass, fail, and not-yet-judged are
        // different decisions and must not collapse into one glyph.
        //
        // The icon is load-bearing, not decoration. StatusDot's own docs say
        // the bare dot "conveys status by colour only, which is not accessible
        // in isolation (WCAG 2.1 SC 1.4.1)". This tree is the reviewer's map
        // of what has already been judged, so colour-only makes an ungraded
        // file and a failed file identical for anyone who cannot separate
        // those two hues. Distinct marks make colour reinforcement again.
        endContent: (
          <StatusDot
            variant={
              score === 1 ? 'success' : score === 0 ? 'error' : 'neutral'
            }
            icon={
              score === 1 ? (
                <CheckIcon />
              ) : score === 0 ? (
                <XMarkIcon />
              ) : (
                <MinusIcon />
              )
            }
            label={
              score === 1
                ? `passed ${name}`
                : score === 0
                  ? `failed ${name}`
                  : `not graded ${name}`
            }
          />
        ),
        isSelected: selectedId === `${c.key}:${a.path}`,
        onClick: () => onFileClick(c, a),
      };
      });
    })(),
  }));
}

export default function ResizableWorkspacePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  // Which model to review. Runs are per-model by construction, so this is the
  // first axis of navigation -- picking a run without knowing its model tag is
  // how you end up grading a llama run believing it was qwen.
  const [modelTag, setModelTag] = useState('');

  const models = useMemo(
    () => [...new Set(runs.map(r => r.model))].sort(),
    [runs],
  );
  const runsForModel = useMemo(
    () => runs.filter(r => !modelTag || r.model === modelTag),
    [runs, modelTag],
  );
  const [runId, setRunId] = useState('');
  const [cases, setCases] = useState<Case[]>([]);
  const [caseId, setCaseId] = useState('');
  const [picked, setPicked] = useState<{c: Case; a: Artifact} | null>(null);
  const [grades, setGrades] = useState<GradeBook>({});
  const [note, setNote] = useState('');
  const [lineStart, setLineStart] = useState<number | null>(null);
  const [lineEnd, setLineEnd] = useState<number | null>(null);
  const [activePropertiesTab, setActivePropertiesTab] = useState('properties');
  const [viewTab, setViewTab] = useState('chat');
  const [fileFilter, setFileFilter] = useState('');
  // Announced to screen readers after a grade is saved or a bulk action is
  // refused. Grading previously happened with no feedback at all, so a keyboard
  // or screen-reader user had no confirmation that anything persisted.
  // announce() speaks through a persistently-mounted visually-hidden live
  // region, so the message is reliably picked up even though it appears after
  // the click that caused it. Failures go out assertive -- a grading tool that
  // silently drops a write must interrupt, not wait for the screen reader to
  // go idle.
  const announce = useAnnounce();
  const [statusMsg, setStatusMsg] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [confirmBulkReq, setConfirmBulkReq] = useState<{
    caseId: string
    caseLabel: string
    count: number
    skipped: number
  } | null>(null);

  // File search. Matches case id or any artifact path, case-insensitively, so
  // "k8s" finds the case and "audit.py" finds a file. A case survives only if
  // it still has a matching file, so the tree never shows a heading with
  // nothing under it.
  const filter = fileFilter.trim().toLowerCase();
  const visibleCases = useMemo(
    () =>
      filter
        ? cases
            .map(c => ({
              ...c,
              artifacts: c.artifacts.filter(
                a =>
                  c.id.toLowerCase().includes(filter) ||
                  a.path.toLowerCase().includes(filter),
              ),
            }))
            .filter(c => c.artifacts.length > 0)
        : cases,
    [cases, filter],
  );
  const visibleFiles = visibleCases.reduce(
    (n, c) => n + c.artifacts.length,
    0,
  );
  // The single highest-value accelerator for a 40-file case: jump to the next
  // ungraded file instead of re-scanning the tree after every verdict. Built
  // from the SAME visibleCases the tree renders, so the search filter applies
  // and the button can never send you somewhere the tree does not show.
  // ponytail: linear scan on every render -- n is one run's artifacts (<= a few
  // hundred); a per-case memo buys nothing until it measurably hurts.
  const navFiles = useMemo(
    () => visibleCases.flatMap(c => c.artifacts.map(a => ({ c, a }))),
    [visibleCases],
  );
  const nextUngraded = useMemo(() => {
    const flat = visibleCases.flatMap(c =>
      c.artifacts.map(a => ({c, a})),
    );
    const start = picked
      ? flat.findIndex(
          ({c, a}) => c.key === picked.c.key && a.path === picked.a.path,
        ) + 1
      : 0;
    // Wrap around: at the end of the list, "next ungraded" means the first one
    // you have not reached yet, not "nothing left".
    for (const pass of [flat.slice(start), flat.slice(0, start)]) {
      const hit = pass.find(
        ({c, a}) => gradeFor(grades, c, a)?.score == null,
      );
      if (hit) return hit;
    }
    return null;
  }, [visibleCases, picked, grades]);
  // ponytail: must NOT live inside the `viewTab === 'source'` branch -- a
  // hook called conditionally makes React throw "Rendered fewer hooks than
  // expected" and the whole app unmounts, which reads as "the server crashed".
  const tokenizer = useMemo(
    () => (c: string, l: string) => tokenize(c, l),
    [],
  )

  const fileTree = useMemo(
    () =>
      buildFileTree(
        visibleCases,
        picked ? `${picked.c.key}:${picked.a.path}` : '',
        (c, a) => {
          // ponytail: clicking a file must also move the case, or the transcript
          // pane keeps showing whichever case was last picked in the top nav.
          setPicked({c, a});
          setCaseId(c.key);
          setNote(gradeFor(grades, c, a)?.note ?? '');
        },
        grades,
      ),
    // grades is read inside the handler: without it in the deps the memo keeps
    // a closure over the grades that existed when it was built, and selecting a
    // file after grading shows a stale (usually empty) note.
    // grades: the tree renders grade state, so it must rebuild when a grade
    // lands, not only when the selection moves.
    [visibleCases, picked, grades],
  );

  // ponytail: one fetch on mount + on run switch. No polling; a benchmark run
  // is finished by the time it is worth grading.
  useEffect(() => {
    listRuns()
      .then(rs => {
        setRuns(rs);
        // Default to the newest run of the first model that has data, so the
        // app opens on something reviewable instead of an empty run.
        const first = rs.filter(r => r.records > 0)[0] ?? rs[0];
        if (first) {
          setModelTag(first.model);
          setRunId(first.id);
        }
      })
      .catch(() => setRuns([]));
  }, []);

  // A model selects its newest run; All models selects the aggregate endpoint.
  // Leaving the stale run id selected would show the previous model's data.
  useEffect(() => {
    const target = runIdForModel(modelTag, runs);
    if (target && target !== runId) setRunId(target);
  }, [modelTag, runs]);

  useEffect(() => {
    if (!runId) return;
    setPicked(null);
    setFileFilter('');
    // ponytail: capture the id and drop late responses instead of an
    // AbortController -- same guarantee, no teardown plumbing. Without this, a
    // slow response for the run you just LEFT overwrites the current one, and
    // otherwise the panes can show a run the selectors no longer name.
    const mine = runId;
    const stale = () => mine !== runId;
    loadRun(runId)
      .then(r => {
        if (stale()) return;
        setRun(r);
        setCases(r.cases);
        setCaseId(r.cases[0]?.key ?? '');
      })
      .catch(() => {
        if (stale()) return;
        setRun(null);
        setCases([]);
      });
    loadGrades()
      .then(g => {
        if (stale()) return;
        setGrades(g);
      })
      .catch(() => {
        if (stale()) return;
        setGrades({});
      });
  }, [runId]);

  // P1-2: selecting a case should show what you are grading against.
  //
  // The rubric is the input to the decision, not a property of the artifact,
  // but it shared a four-way segmented control with Properties / History /
  // Note -- all of which are per FILE. So the panel's subject silently changed
  // with the tab, and the criteria stayed one click away while the reviewer
  // read code in the middle pane and graded from priors. Put the rubric up
  // front when the case changes; Properties is still one click away.
  useEffect(() => {
    setActivePropertiesTab(curCase?.rubric ? 'rubric' : 'properties');
    // ponytail: keyed on caseId only. Reading curCase here would re-fire on
    // every grade save, yanking the reviewer off the panel they are using.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // P1: changing case must clear the selected file. Both case Selectors used to
  // call setCaseId alone, so `picked` survived -- the Transcript pane showed the
  // new case while the Source pane and the inspector header still described the
  // previous case's file. In a tool whose whole job is pairing a judgment with a
  // specific artifact, two panes disagreeing is the worst possible failure.
  useEffect(() => {
    // Skip when the new caseId is exactly the case of the file just picked:
    // clicking a tree row sets both, and clearing here would undo the click.
    if (picked?.c.key === caseId) return;
    setPicked(null);
    setLineStart(null);
    setLineEnd(null);
    // ponytail: clear the note HERE, not at each call site. The note is
    // persisted by `grade(..., withNote = note)`, so a note left over from the
    // previous file was silently saved onto the next file's grade. Every path
    // that moves the selection routes through this effect, so one reset here
    // covers the case selector, "Next ungraded" and J/K navigation alike.
    setNote('');
  }, [caseId, picked?.c.key]);

  // ponytail: the note is passed in, not read from state. Reading `note` here
  // means a grade made from the tree/context menu silently attaches whatever
  // text happened to be in the note box for a DIFFERENT file.
  // One place that decides politeness, so no call site can forget it.
  const say = (msg: string) => {
    setStatusMsg(msg);
    announce(msg, msg.startsWith('NOT SAVED') ? 'assertive' : 'polite');
  };

  const grade = (c: Case, a: Artifact, score: number | null, withNote = note) =>
    saveGrade(c.runId, gradeFileKey(c, a), score, withNote)
      .then(g => {
        setGrades(g);
        // Announce, and say what was saved. A silently-swallowed rejection used
        // to make a failed write look exactly like a successful one, which for
        // a grading tool is the worst possible failure mode: the reviewer walks
        // away believing their decisions persisted.
        say(
          score == null
            ? `Cleared grade for ${a.path}`
            : `${score === 1 ? 'Passed' : 'Failed'} ${a.path}`,
        );
      })
      .catch(e =>
        say(`NOT SAVED: ${a.path} — ${e?.message ?? 'write failed'}`),
      );

  // ponytail: one window-level keydown instead of per-component handlers --
  // shortcuts belong to the app, not to whichever pane happens to be mounted.
  // Skipped a keymap registry; add when a binding needs remapping.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from a field the reviewer is typing in.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p' && picked) { e.preventDefault(); grade(picked.c, picked.a, 1); }
      else if (k === 'f' && picked) { e.preventDefault(); grade(picked.c, picked.a, 0); }
      else if (k === 'c' && picked) { e.preventDefault(); grade(picked.c, picked.a, null); }
      else if ((k === 'j' || k === 'k') && navFiles.length) {
        e.preventDefault();
        const i = navFiles.findIndex(
          x => x.c.key === picked?.c.key && x.a.path === picked?.a.path,
        );
        // j = next, k = previous; wrap at both ends so the tree is a loop.
        const n = (i < 0 ? -1 : i) + (k === 'j' ? 1 : -1);
        const next = navFiles[((n % navFiles.length) + navFiles.length) % navFiles.length];
        setPicked({ c: next.c, a: next.a });
        setCaseId(next.c.key);
        setNote(gradeFor(grades, next.c, next.a)?.note ?? '');
        // Land on the SOURCE pane, not whatever tab was showing. Moving
        // selection without moving the view means you grade the new file
        // against the previous file's transcript -- the two panes disagree,
        // which is the exact failure this tool cannot afford. The
        // "Next ungraded" button already does this; j/k must match it.
        setViewTab('source');
      } else if (e.key === 'Enter' && nextUngraded) {
        e.preventDefault();
        setPicked({ c: nextUngraded.c, a: nextUngraded.a });
        setCaseId(nextUngraded.c.key);
        setNote(gradeFor(grades, nextUngraded.c, nextUngraded.a)?.note ?? '');
        setViewTab('source');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, navFiles, grades, nextUngraded, note]);

  /** Note anchored to a line range; falls back to the whole-file note. */
  const rangeNote = (c: Case, a: Artifact) => {
    const g = gradeFor(grades, c, a);
    return g?.lineNotes?.find(
      n =>
        n.lineStart === (lineStart ?? undefined) &&
        n.lineEnd === (lineEnd ?? undefined),
    )?.note;
  };

  const saveRangeNote = (c: Case, a: Artifact) =>
    saveLineNote(
      c.runId,
      gradeFileKey(c, a),
      lineStart ?? undefined,
      lineEnd ?? undefined,
      note,
    )
      .then(g => {
        setGrades(g);
        say(
          lineStart != null
            ? `Saved note on ${a.path} lines ${lineStart}${
                lineEnd != null && lineEnd !== lineStart ? `-${lineEnd}` : ''
              }`
            : `Saved note on ${a.path}`,
        );
      })
      .catch(e =>
        say(`NOT SAVED: note on ${a.path} — ${e?.message ?? 'write failed'}`),
      );

  // `!= null`, not truthiness. A range is falsy the moment either endpoint is 0,
  // so any annotation touching the first line -- [0,0], [0,12] -- saved fine and
  // then highlighted nothing. Measured over 6 ranges: the truthy test lost 3
  // ([0,0] among them), and a reviewer annotating from the top of the file has
  // no way to tell that from the highlight simply not working.
  const highlight =
    lineStart != null && lineEnd != null
      ? Array.from(
          {length: Math.abs(lineEnd - lineStart) + 1},
          (_, i) => Math.min(lineStart, lineEnd) + i,
        )
      : undefined;

  // "Grade all files" bulk-marks every file in the case as PASS. That is a
  // destructive one-click shortcut to a fully-passed case, so it asks first and
  // says exactly what it will do. Only ungraded files are touched -- an
  // accidental re-run must not silently overwrite human decisions.
  // Single entry point for bulk-passing. Both the top-nav button and the file
  // context menu call this, so the confirm + ungraded-only rule cannot be
  // bypassed by one of them and enforced by the other.
  const requestBulkPass = (targetCaseId: string) => {
    const cur = cases.find(c => c.key === targetCaseId);
    if (!cur) return;
    const ungraded = cur.artifacts.filter(
      a => gradeFor(grades, cur, a)?.score == null,
    );
    // Everything already graded: there is nothing to confirm, say so instead of
    // opening a dialog that can only fail.
    if (!ungraded.length) {
      // Refusal, not a failure: a confirm dialog that can only fail is worse
      // than saying why there is nothing to do.
      const msg = `${cur.id}: all ${cur.artifacts.length} file(s) already graded.`;
      setBulkMsg(msg);
      announce(msg);
      return;
    }
    setBulkMsg(null);
    setConfirmBulkReq({
      caseId: cur.key,
      caseLabel: cur.label ?? cur.id,
      count: ungraded.length,
      skipped: cur.artifacts.length - ungraded.length,
    });
  };

  const gradeAll = () => requestBulkPass(caseId);

  const curCase = cases.find(c => c.key === caseId);
  const totalFiles = cases.reduce((n, c) => n + c.artifacts.length, 0);

  // real per-file facts for the inspector, replacing demo PROPERTIES
  const PROPERTIES = picked
    ? [
        {label: 'Case', value: picked.c.id},
        {label: 'Path', value: picked.a.path},
        {label: 'Language', value: picked.a.lang},
        {label: 'Lines', value: String(linesOf(picked.a.source))},
        {label: 'Size', value: bytesOf(picked.a.source)},
        {label: 'Attempts', value: String(picked.c.attempts.length)},
        {
      label: 'Grade',
      // Was String(score), so the reviewer saw "1" / "0" / "ungraded" -- raw
      // storage values in a judgment tool.
      // Was an IIFE destructuring its argument -- which threw when the file has
      // no grade at all, i.e. exactly the common case on a fresh run.
      value: (() => {
        const score = gradeFor(grades, picked.c, picked.a)?.score;
        return score === 1 ? 'Passed' : score === 0 ? 'Failed' : 'Not graded';
      })(),
    },
    {
      label: 'Graded at',
      // Was the raw ISO string ("2026-10-04T02:52:33.412Z"), printed verbatim
      // into a 320px panel where it wraps. Timestamp renders it as a readable
      // local time with the full value still available.
      value: (() => {
        const at = gradeFor(grades, picked.c, picked.a)?.at;
        return at ? <Timestamp value={at} format="date_time" /> : 'not graded';
      })(),
    },
      ]
    : [];

  // "History" listed every artifact in the run with the ATTEMPT timestamp --
  // the model's recorded_at -- which is not a review history at all. A
  // reviewer opening it is asking "what have I judged, and when"; the attempt
  // time answers neither, all 40 rows looked identical, and .slice(0, 40)
  // dropped the remainder with no indication that anything was missing.
  //
  // Grade.at is the real answer. Sort newest first so the top of the list is
  // the work you just did, and say so explicitly when the list is truncated.
  const GRADED = cases
    .flatMap(c =>
      c.artifacts.map(a => {
        const g = gradeFor(grades, c, a);
        return g?.at
          ? {
              key: `${c.key}:${a.path}`,
              label: `${c.id} / ${a.path.split('/').pop()}`,
              at: g.at as string,
              score: g.score,
            }
          : null;
      }),
    )
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const HISTORY_SHOWN = 40;
  const HISTORY_ITEMS = GRADED.slice(0, HISTORY_SHOWN);

  const startPanel = useResizable({
    defaultSize: 256,
    minSize: 160,
    maxSize: 400,
    collapsible: true,
    collapsedSize: 50,
  });

  const endPanel = useResizable({
    defaultSize: 320,
    minSize: 180,
    maxSize: 500,
    collapsible: true,
    collapsedSize: 50,
  });

  // The file tree drops out below 900px, not 768: between those two widths the
// 256px tree plus the 320px properties panel left the content column ~200px,
// which is unusable for reading a transcript or a source file. The panel
// widths below are share-of-viewport for the same reason.
  const isMobile = useMediaQuery('(max-width: 900px)');

  // Below 900px the tree and the properties panel cannot both keep their
  // desktop pixel widths, so the TREE gives up its width first: it renders
  // collapsed to its 50px handle and the reviewer reopens it from there.
  // It is NOT unmounted -- that left no way to pick a file at all on a
  // phone, since the case selector in the top nav chooses a case, not a file.
  useEffect(() => {
    if (isMobile) startPanel.collapse();
    else startPanel.expand();
  }, [isMobile]);

  return (
    <AppShell
      contentPadding={0}
      // P3: the save confirmation used to be one lowercase Text sharing an
      // HStack with the progress bar and a destructive button, where the ONLY
      // difference between "saved" and "lost your work" was a font weight. A
      // banner sits above the selectors, where a reviewer's eye already is when
      // they click Pass, and it persists instead of being replaced by the next
      // message.
      banner={
        statusMsg ? (
          <Banner
            status={statusMsg.startsWith('NOT SAVED') ? 'error' : 'success'}
            container="card"
            title={statusMsg}
            onDismiss={() => setStatusMsg('')}
          />
        ) : undefined
      }
      topNav={
        <TopNav
          label="Benchmark grader"
          startContent={
            <HStack gap={3} wrap={isMobile ? 'wrap' : 'nowrap'} width="100%">
            {/* level={1} renders a real <h1>. The <Text> that was here
                rendered a <span>, so the app shipped zero top-level headings
                and a screen reader had no document title to jump to.
                TopNavHeading looks like the obvious choice but does not emit a
                heading element — verified in TopNavHeading.js, it renders
                spans and divs only. */}
            <Heading level={1}>Benchmark Grader</Heading>
            <Selector
              label="Select model"
              size="sm"
              width={isMobile ? '100%' : 180}
              value={modelTag}
                placeholder="All models"
                options={[
                  {value: '', label: 'All models'},
                  ...models.map(m => ({value: m, label: m})),
                ]}
                onChange={setModelTag}
              />
              <Selector
                label="Select run"
                size="sm"
                width={isMobile ? '100%' : 260}
                value={runId}
                placeholder="Select a run"
                // Grouped by model tag so a re-run of the same model sits next
                // to its siblings instead of in an undifferentiated id list.
                options={[
                  ...(!modelTag
                    ? [{
                        value: ALL_MODELS_RUN_ID,
                        label: 'All model runs',
                        description: `${models.length} models · ${runs.length} runs`,
                      }]
                    : []),
                  ...Object.entries(
                    runsForModel.reduce<Record<string, typeof runsForModel>>((acc, r) => {
                      (acc[r.model] ??= []).push(r);
                      return acc;
                    }, {}),
                  ).map(([model, rs]) => ({
                    type: 'section' as const,
                    key: model,
                    title: `${model} (${rs.length} run${rs.length === 1 ? '' : 's'})`,
                    options: rs.map(r => ({
                      value: r.id,
                      label: r.id,
                      description: `${r.records} records · ${r.cases} cases`,
                    })),
                  })),
                ]}
                onChange={setRunId}
              />
              <Selector
                label="Select case"
                size="sm"
                width={isMobile ? '100%' : 240}
                value={caseId}
                placeholder="Select a case"
                // visibleCases, not cases: fileFilter hides cases with no
                // matching file, so offering every case here let a reviewer
                // search down to one and still be handed the other 39.
                options={visibleCases.map(c => ({
                  value: c.key,
                  label: c.label ?? c.id,
                  description: c.label
                    ? `${c.runId} · ${c.artifacts.length} files`
                    : `${c.artifacts.length} files`,
                }))}
                onChange={setCaseId}
              />
            </HStack>
          }
          endContent={
            <HStack gap={3}>
              {/* No ProgressBar here.

                  Measured, not guessed: with the bar present the row is
                  75 + 12 + 54 = 141px -- exactly the width TopNav's endContent
                  slot allows. Hiding the bar and nothing else grows the button
                  from 54px to 81px, which is the width "Grade all" actually
                  needs. So the bar was not decoration next to the button; it
                  was consuming the whole slot and the primary action was the
                  thing that got squeezed to "Gr…" at every width, 1600
                  included.

                  Nothing is lost. The bar was labelled "N/M graded", and every
                  file row in the tree already carries a pass/fail/not-graded
                  StatusDot -- so the remaining work is legible per file, which
                  is how a reviewer actually tracks it, rather than as one
                  digit pair in the nav. */}
              <Button
                label="Grade all"
                size="sm"
                onClick={gradeAll}
                isDisabled={!cases.find(c => c.key === caseId)}
              />
            </HStack>
          }
        />
      }>
      <Layout
      height="fill"
      content={
        <LayoutContent padding={0}>
          <Layout
            height="fill"
            start={(
                <>
                  {!startPanel.isCollapsed && (
                    <LayoutPanel
                      width={startPanel.size}
                      hasDivider={false}
                      padding={0}>
                      <Stack
                        direction="vertical"
                        style={styles.fileExplorer}
                        gap={2}>
                        {/* P2-6: the sidebar used to repeat the top nav's
                            run selector, case selector and progress bar over
                            the same state, with a DIFFERENT summary string
                            ("N records" here vs "N records . M cases" up
                            there) and no model grouping on one of them. Two
                            edit points for one value, disagreeing on how to
                            describe it -- the classic way a reviewer ends up
                            convinced they are in a different run than the one
                            on screen. Navigation belongs to the top nav; this
                            panel's job is search and the tree. */}

                        <TextInput
                          label="Search files"
                          isLabelHidden
                          value={fileFilter}
                          placeholder="Search cases and files"
                          size="md"
                          startIcon={MagnifyingGlassIcon}
                          onChange={setFileFilter}
                        />
                        {fileFilter.trim() ? (
                          <Text type="supporting" color="secondary">
                            {visibleFiles} of {totalFiles} files match
                            {' '}
                            <Button
                              label="Clear"
                              size="sm"
                              variant="ghost"
                              onClick={() => setFileFilter('')}
                            />
                          </Text>
                        ) : null}
                        {/* aria-label, not a raw wrapper: TreeList renders
                            role="tree" and the contract already forwards
                            aria-label through to it. Without it the tree is
                            announced as an unnamed list of buttons. */}
                        <TreeList
                          items={fileTree}
                          density="compact"
                          aria-label="Cases and files"
                        />
                      </Stack>
                    </LayoutPanel>
                  )}
                  <ResizeHandle
                    direction="horizontal"
                    hasDivider
                    isAlwaysVisible={false}
                    resizable={startPanel.props}
                    label="Resize file explorer"
                  />
                </>
              )
            }
            content={
              <LayoutContent padding={0}>
                <Layout
                  height="fill"
                  content={
                    <LayoutContent padding={0}>
                      <Stack direction="vertical" style={styles.contentFill}>
                        <TabList
                          // `role="tablist"` switches Astryx from its
                          // navigation pattern (plain buttons under a
                          // `<nav>`) to the real tab widget: `role="tab"`
                          // + `aria-selected` + roving tabindex on each item,
                          // and arrow-key navigation. Each Tab names its
                          // panel so `aria-controls` has a real target.
                          role="tablist"
                          value={viewTab}
                          onChange={setViewTab}
                          size="sm"
                          hasDivider
                          style={styles.tabListPadding}>
                          <Tab label="Transcript" value="chat" panelId="view-panel-chat" />
                          <Tab label="Prompt" value="prompt" panelId="view-panel-prompt" />
                          <Tab label="Source" value="source" panelId="view-panel-source" />
                          <Tab label="Run info" value="info" panelId="view-panel-info" />
                        </TabList>
                        <StackItem size="fill" style={styles.editorArea}>
                          {/* One panel element, id'd to match the active
                              Tab's `panelId`. Without it every tab's
                              `aria-controls` points at nothing. */}
                          <LayoutContent
                            role="tabpanel"
                            id={`view-panel-${viewTab}`}
                            padding={0}
                            isScrollable={false}
                            style={styles.editorArea}>
                          {viewTab === 'chat' && (
                            <Stack direction="vertical" padding={3} gap={3}>
                              {curCase ? (
                                <>
                                  <ChatMessageList density="compact">
                                    {/* One PAIR per round: that round's user
                                        prompt, then that round's assistant
                                        reply, interleaved.

                                        This used to render
                                        `promptOf(attempts[0])` -- a single
                                        message above all eight replies -- so a
                                        reviewer saw one prompt and concluded
                                        the grader "only shows the first
                                        prompt". Every attempt carries its own
                                        system+user pair for the same case and
                                        the prompt grows with each retry, so
                                        all of them belong in the transcript. */}
                                    {/* Case-level artifact summary. This is
                                        NOT per-round: the files belong to the
                                        case, and repeating the same list once
                                        per attempt was noise. */}
                                    {curCase.artifacts.length === 0 ? (
                                      // ponytail: the runner writes no
                                      // coder-artifacts/ when every response
                                      // failed to parse (response.raw === '').
                                      // Saying "0 generated files" there reads
                                      // as a finished, empty run; it is not.
                                      <Text type="supporting">
                                        No artifacts:{' '}
                                        {curCase.attempts.every(a => !a.response?.raw)
                                          ? 'every model response failed to parse (response.raw is empty), so the runner wrote no files'
                                          : 'the runner has not written coder-artifacts/ yet'}
                                        .
                                      </Text>
                                    ) : (
                                      <Stack direction="vertical" gap={1}>
                                        <Text>
                                          {curCase.artifacts.length} generated file
                                          {curCase.artifacts.length === 1 ? '' : 's'}
                                        </Text>
                                        {curCase.artifacts.map(a => (
                                          <HStack key={a.path}>
                                            <Text>{a.path.split('/').pop()}</Text>
                                            <Button
                                              label={
                                                // Three states, not two. This label
                                                // used to collapse a FAILED file
                                                // into "Grade", making a deliberate
                                                // rejection look identical to an
                                                // untouched file -- so a reviewer
                                                // re-grades what they rejected.
                                                gradeFor(grades, curCase, a)?.score === 1
                                                  ? 'Passed'
                                                  : gradeFor(grades, curCase, a)?.score === 0
                                                    ? 'Failed'
                                                    : 'Not graded'
                                              }
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => {
                                                setPicked({c: curCase, a});
                                                setViewTab('source');
                                              }}
                                            />
                                          </HStack>
                                        ))}
                                      </Stack>
                                    )}
                                    {/* One assistant message PER ROUND, not one
                                        wrapping all of them. In a single bubble
                                        "Round 1 ... Round 8" ran together and
                                        you could not tell where one attempt
                                        ended and the next began -- which is the
                                        whole reason the round numbers exist.
                                        The prompt is the only shared context, so
                                        it stays its own message above. */}
                                    {curCase.attempts.map((at, i) => (
                                      <Fragment key={i}>
                                      <ChatMessage
                                        sender="user"
                                        name={`Prompt — round ${at.round ?? i + 1}`}>
                                        <ChatMessageBubble>
                                          <Markdown density="compact">
                                            {promptOf(at) ||
                                              '(no prompt captured)'}
                                          </Markdown>
                                        </ChatMessageBubble>
                                      </ChatMessage>
                                      <ChatMessage
                                        sender="assistant"
                                        name={`Round ${at.round ?? i + 1}`}>
                                        <ChatMessageBubble>
                                          <VStack gap={2}>
                                            {/* Round and VERDICT share one line:
                                                they are what the reviewer is
                                                judging. The four telemetry
                                                numbers behind them used to be
                                                dot-appended to that same
                                                sentence -- five facts with no
                                                hierarchy, where you read tokens
                                                instead of the verdict. */}
                                            <HStack gap={2}>
                                              <Text type="supporting" color="secondary">
                                                Round {at.round ?? i + 1}
                                              </Text>
                                              <Token
                                                label={at.outcome ?? 'unknown'}
                                                size="sm"
                                              />
                                            </HStack>
                                            {at.timing &&
                                              (at.timing.output_tokens != null ||
                                                at.timing.prompt_tokens != null ||
                                                at.timing.tokens_per_second != null ||
                                                at.timing.done_reason) && (
                                                <Collapsible
                                                  trigger={
                                                    <Text type="supporting" color="secondary">
                                                      Timing
                                                    </Text>
                                                  }
                                                  defaultIsOpen={false}>
                                                  <Text type="supporting" color="secondary">
                                                    {[
                                                      at.timing.output_tokens != null &&
                                                        `${at.timing.output_tokens} out tok`,
                                                      at.timing.prompt_tokens != null &&
                                                        `${at.timing.prompt_tokens} in tok`,
                                                      at.timing.tokens_per_second != null &&
                                                        `${at.timing.tokens_per_second} tok/s`,
                                                      at.timing.done_reason &&
                                                        `stop: ${at.timing.done_reason}`,
                                                    ]
                                                      .filter(Boolean)
                                                      .join(' · ')}
                                                  </Text>
                                                </Collapsible>
                                              )}
                                            {at.error ? (
                                              <Banner
                                                status="error"
                                                title="Request failed"
                                                collapsible={false}>
                                                {at.error}
                                              </Banner>
                                            ) : null}
                                            {/* Everything else the transcript
                                                recorded but the transcript pane
                                                did not surface: which slot and
                                                workflow produced it, the
                                                inference options that decide
                                                reproducibility, and the sha256
                                                hashes that pin the prompt
                                                contract. Two runs of the same
                                                model look identical here unless
                                                you can see that one ran with
                                                temperature=0,num_ctx=24576 and
                                                a different prompt contract --
                                                which is the only way to tell a
                                                regression from a changed
                                                harness. Collapsed by default:
                                                a reviewer reading the answer
                                                first should not have to pass
                                                four hex strings to reach it. */}
                                            <Collapsible
                                              trigger={
                                                <Text
                                                  type="supporting"
                                                  color="secondary">
                                                  Record
                                                </Text>
                                              }
                                              defaultIsOpen={false}>
                                              <MetadataList
                                                label={{position: 'top'}}
                                                columns="multi">
                                                <MetadataListItem
                                                  label="Slot"
                                                  children={
                                                    at.slot ?? 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Workflow"
                                                  children={
                                                    at.workflow ?? 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Benchmark"
                                                  children={
                                                    at.benchmark ?? 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Provenance"
                                                  children={
                                                    at.provenance ?? 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Operator"
                                                  children={
                                                    at.operator ?? 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Tier"
                                                  children={
                                                    at.reproducibility?.tier ??
                                                    'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Engine"
                                                  children={
                                                    at.reproducibility?.engine ??
                                                    'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Model digest"
                                                  children={shortSha(
                                                    at.model?.digest,
                                                  )}
                                                />
                                                <MetadataListItem
                                                  label="Inference options"
                                                  children={
                                                    optionsOf(
                                                      at.request?.body?.options,
                                                    ) || 'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="Request sha256"
                                                  children={shortSha(
                                                    at.request?.body_sha256,
                                                  )}
                                                />
                                                <MetadataListItem
                                                  label="Prompt contract"
                                                  children={
                                                    at.reproducibility
                                                      ?.prompt_contract
                                                      ?.prompt_contract_version ??
                                                    'unrecorded'
                                                  }
                                                />
                                                <MetadataListItem
                                                  label="System prompt sha256"
                                                  children={shortSha(
                                                    at.reproducibility
                                                      ?.prompt_contract
                                                      ?.system_prompt_sha256,
                                                  )}
                                                />
                                                <MetadataListItem
                                                  label="Rubric claims"
                                                  children={
                                                    at.claim_ids?.length
                                                      ? at.claim_ids.join(', ')
                                                      : 'none recorded'
                                                  }
                                                />
                                              </MetadataList>
                                            </Collapsible>
                                            {at.degenerate ||
                                            at.repetition_ratio != null ? (
                                              <HStack gap={2}>
                                                <StatusDot
                                                  variant={at.degenerate ? 'error' : 'warning'}
                                                  label={
                                                    at.degenerate
                                                      ? 'degenerate output'
                                                      : 'repetition detected'
                                                  }
                                                />
                                                <Text type="supporting" color="secondary">
                                                  {at.degenerate
                                                    ? 'Degenerate output — repeating loop, grade this fail'
                                                    : `Repetition ratio ${(at.repetition_ratio ?? 0).toFixed(2)}`}
                                                </Text>
                                              </HStack>
                                            ) : null}
                                            {/* The model answer itself. The
                                                artifact list above only names the
                                                files the runner wrote; the text
                                                the model actually produced is the
                                                thing under review, and
                                                response.raw holds it. Old builds
                                                dropped this entirely, so the
                                                transcript pane showed filenames
                                                with no output behind them. */}
                                            {at.response?.raw ? (
                                              chunkAnswer(at.response.raw).map((chunk, j) =>
                                                chunk.kind === 'code' ? (
                                                  <CodeBlock
                                                    key={j}
                                                    code={chunk.text}
                                                    // chunkAnswer strips the fences
                                                    // and keeps no language, so the
                                                    // case's artifact language is the
                                                    // only real signal. It is wrong
                                                    // for a fenced block in a second
                                                    // language -- fixing that means
                                                    // carrying `lang` through
                                                    // chunkAnswer.
                                                    language={
                                                      curCase.artifacts[0]?.lang ?? 'plaintext'
                                                    }
                                                    tokenizer={tokenizer}
                                                    hasLineNumbers
                                                    hasCopyButton
                                                    size="sm"
                                                    maxHeight={420}
                                                  />
                                                ) : (
                                                  <Markdown key={j} density="compact">
                                                    {chunk.text}
                                                  </Markdown>
                                                ),
                                              )
                                            ) : (
                                              <Text type="supporting" color="secondary">
                                                (empty response)
                                              </Text>
                                            )}
                                          </VStack>
                                        </ChatMessageBubble>
                                      </ChatMessage>
                                      </Fragment>
                                    ))}
                                  </ChatMessageList>
                                </>
                              ) : (
                                <Text>Select a case to see its transcript</Text>
                              )}
                            </Stack>
                          )}
                          {viewTab === 'prompt' && (
                            // Every round's prompt, not just round 1's --
                            // the same truncation the transcript tab had.
                            // Labelled per round, because the retry prompts
                            // grow and read as one wall otherwise.
                            <Stack direction="vertical" gap={3}>
                              {curCase?.attempts.map((at, i) => (
                                <Stack key={i} direction="vertical" gap={1}>
                                  <Text type="supporting" color="secondary">
                                    Round {at.round ?? i + 1}
                                  </Text>
                                  <CodeBlock
                                    code={promptOf(at) || '(no prompt captured)'}
                                    language="markdown"
                                    container="section"
                                    hasCopyButton={false}
                                    size="sm"
                                  />
                                </Stack>
                              ))}
                            </Stack>
                          )}
                          {viewTab === 'info' && (
                            <Stack direction="vertical" gap={4} padding={4}>
                              {/* Run-level facts first. A reviewer must know
                                  WHICH model produced this and whether the
                                  output is degenerate before reading a line of
                                  it -- otherwise a looping transcript gets
                                  graded on the merits of its first paragraph. */}
                              <MetadataList>
                                <MetadataListItem
                                  label="Run"
                                  children={run?.id ?? (runId || '-')}
                                />
                                <MetadataListItem
                                  label="Models"
                                  children={
                                    run?.models?.join(', ') ||
                                    curCase?.attempts[0]?.model?.tag ||
                                    'unknown'
                                  }
                                />
                                <MetadataListItem
                                  label="Records"
                                  children={String(run?.records ?? 0)}
                                />
                                {/* run.json: WHICH benchmark produced these
                                    answers and whether the model actually ran
                                    them. `provenance: live_model` vs a
                                    replayed fixture is the difference between
                                    a real result and a cached one, and it was
                                    in the run dir the whole time, unread. */}
                                {run?.meta && (
                                  <MetadataListItem
                                    label="Benchmark"
                                    children={
                                      run.meta.benchmark ?? 'unrecorded'
                                    }
                                  />
                                )}
                                {run?.meta?.provenance && (
                                  <MetadataListItem
                                    label="Provenance"
                                    children={
                                      run.meta.provenance +
                                      (run.meta.operator
                                        ? ` (${run.meta.operator})`
                                        : '')
                                    }
                                  />
                                )}
                                {run?.meta?.started_at && (
                                  <MetadataListItem
                                    label="Started"
                                    children={
                                      <Timestamp
                                        value={run.meta.started_at}
                                        format="date_time"
                                      />
                                    }
                                  />
                                )}
                                {/* Wrong rubric is silent. The grader loads
                                    coder_cases_v1_rubric.json by default, but
                                    the triage/revdeck/sessions slots ship no
                                    rubric under those names, so every case
                                    renders `No rubric for this case` with no
                                    hint that a 64-case rubric was loaded and
                                    simply does not describe these cases. Say
                                    it plainly instead. */}
                                {run?.rubricCoverage &&
                                  run.rubricCoverage.matched === 0 && (
                                    <MetadataListItem
                                      label="Rubric"
                                      children={`no match — ${run.rubricCoverage.file} covers ${run.rubricCoverage.loaded} other cases`}
                                    />
                                  )}
                                <MetadataListItem
                                  label="Degenerate"
                                  children={
                                    run?.diagnostics?.degenerate
                                      ? `${run.diagnostics.degenerate} record(s) flagged`
                                      : 'none'
                                  }
                                />
                                <MetadataListItem
                                  label="Max repetition"
                                  children={
                                    run?.diagnostics?.maxRepetitionRatio != null
                                      ? run.diagnostics.maxRepetitionRatio.toFixed(2)
                                      : 'not recorded'
                                  }
                                />
                              </MetadataList>
                              {run?.buckets &&
                              Object.keys(run.buckets).length > 0 ? (
                                <Stack direction="vertical" gap={2}>
                                  <Heading level={2}>Buckets covered</Heading>
                                  <MetadataList>
                                    {Object.entries(run.buckets).map(([b, n]) => (
                                      <MetadataListItem
                                        key={b}
                                        label={b}
                                        children={`${n} case(s)`}
                                      />
                                    ))}
                                  </MetadataList>
                                </Stack>
                              ) : null}
                              <MetadataList>
                              <MetadataListItem label="Case" children={curCase?.id ?? '-'} />
                              <MetadataListItem
                                label="Attempts"
                                children={String(curCase?.attempts.length ?? 0)}
                              />
                              <MetadataListItem
                                label="Artifacts"
                                children={String(curCase?.artifacts.length ?? 0)}
                              />
                              <MetadataListItem
                                label="Model"
                                children={curCase?.attempts[0]?.model?.tag ?? 'unknown'}
                              />
                              <MetadataListItem
                                label="Recorded"
                                children={
                                  curCase?.attempts[0]?.recorded_at ? (
                                    <Timestamp
                                      value={curCase.attempts[0].recorded_at}
                                      format="date_time"
                                    />
                                  ) : (
                                    '-'
                                  )
                                }
                              />
                              </MetadataList>
                            </Stack>
                          )}
                          {viewTab === 'source' && (
                          // P1-4: this used to hold a 200px file list beside
                          // the code. Two things had to change together:
                          //  - the list is gone (the tree already lists files
                          //    WITH grade marks; that one showed none), and
                          //  - the horizontal Stack went with it, because a
                          //    single-child horizontal Stack collapses to its
                          //    content. Left in place it would have SHRUNK the
                          //    viewer to ~200px rather than widening it.
                          // The vertical Stack is what the other tabs use and
                          // is what gives ContextMenu a full-width parent to
                          // resolve CodeBlock's width="100%" against -- without
                          // it the block measures 202px, its longest line.
                          <Stack direction="vertical" width="fill" gap={1}>
                          {/* The rubric was a mutually exclusive rail tab, so
                              the reviewer could see the anchors OR grade,
                              never both -- every file was scored from memory.
                              Collapsed by default: always present, never in
                              the way. The rail tab stays as a full view. */}
                          {curCase?.rubric && (
                            <Collapsible
                              trigger={
                                <Text type="supporting" color="secondary">
                                  Rubric:{' '}
                                  {curCase.rubric.bucket ?? 'unbucketed'}, max{' '}
                                  {curCase.rubric.max_score ?? '?'}
                                </Text>
                              }
                              defaultIsOpen={false}>
                              <Stack direction="vertical" gap={2}>
                                {Object.entries(
                                  curCase.rubric.pass_anchors ?? {},
                                ).map(([check, anchors]) => (
                                  <Stack key={check} direction="vertical" gap={1}>
                                    <Text weight="bold">
                                      {check.replace(/_/g, ' ')}
                                    </Text>
                                    {anchors.map((a, i) => (
                                      <Text key={i} type="supporting">
                                        {a}
                                      </Text>
                                    ))}
                                  </Stack>
                                ))}
                              </Stack>
                            </Collapsible>
                          )}
                          <ContextMenu
                            label="File actions"
                            items={
                              picked
                                ? [
                                    {label: 'Pass', onClick: () => grade(picked.c, picked.a, 1)},
                                    {label: 'Fail', onClick: () => grade(picked.c, picked.a, 0)},
                                    {label: 'Clear grade', onClick: () => grade(picked.c, picked.a, null)},
                                    {type: 'divider'},
                                    {
                                      label: lineStart != null
                                        ? 'Note on lines'
                                        : 'Note on whole file',
                                      onClick: () =>
                                        setActivePropertiesTab('note'),
                                    },
                                    {
                                      label: 'Grade all files in case',
                                      onClick: () => {
                                        // Routed through gradeAll's confirm
                                        // dialog. This menu item used to pass
                                        // every file instantly, which is the
                                        // same destructive one-click shortcut
                                        // the top-nav button was fixed for.
                                        setCaseId(picked.c.key);
                                        requestBulkPass(picked.c.key);
                                      },
                                    },
                                  ]
                                : []
                            }>
                          <CodeBlock
                            code={picked?.a.source ?? ''}
                            language={picked?.a.lang ?? 'plaintext'}
                            title={picked?.a.path}
                            container="section"
                            hasLanguageLabel={false}
                            hasLineNumbers
                            highlightLines={highlight}
                            tokenizer={tokenizer}
                            // MUST be 'spans', not the 'auto' default.
                            //
                            // 'auto' renders tokens through the CSS Custom
                            // Highlight API whenever the browser has it (Chrome
                            // does). That paints the highlighting onto an EMPTY
                            // <code> element -- the text lives in
                            // CSS.highlights, not in the DOM -- so the source
                            // viewer renders a bare title bar with no code at
                            // all. SSR and the old verification could never see
                            // it because neither has CSS.highlights, so
                            // renderToString happily produced a full <pre>.
                            // 'spans' emits real <span> children and works
                            // everywhere.
                            highlightMode="spans"
                            hasCopyButton
                            size="sm"
                            width="100%"
                          />
                          </ContextMenu>
                          </Stack>
                          )}
                          </LayoutContent>
                        </StackItem>
                      </Stack>
                    </LayoutContent>
                  }
                  end={
                    // P4: this panel holds the Pass/Fail controls. Gating it on
                    // isMobile made grading impossible below 768px -- not merely
                    // cramped, since the reviewer has no other way to record a
                    // verdict. It now always renders; the start panel (the file
                    // tree) still collapses on mobile, since browsing without
                    // grading is survivable.
                    (
                      <>
                        <ResizeHandle
                          direction="horizontal"
                          hasDivider
                          isReversed
                          isAlwaysVisible={false}
                          resizable={endPanel.props}
                          label="Resize properties panel"
                        />
                        {!endPanel.isCollapsed && (
                          <LayoutPanel
                            // ponytail: a fixed 320px panel left the content
                            // column 69px wide on a 390px phone -- the source
                            // viewer fit one line per screen. A share of the
                            // row keeps the panel usable and leaves the
                            // transcript/source at least half the width. On
                            // desktop this is exactly the dragged pixel size.
                            width={isMobile ? '45%' : endPanel.size}
                            hasDivider={false}
                            padding={4}>
                            <Stack
                              direction="vertical"
                              gap={3}
                              style={styles.propertiesPanel}>
                              <SegmentedControl
                                label="Properties panel sections"
                                value={activePropertiesTab}
                                onChange={setActivePropertiesTab}
                                size="sm"
                                layout="fill">
                                <SegmentedControlItem
                                  label="Properties"
                                  value="properties"
                                />
                                <SegmentedControlItem
                                  label="History"
                                  value="history"
                                />
                                <SegmentedControlItem
                                  label="Rubric"
                                  value="rubric"
                                />
                                <SegmentedControlItem
                                  label="Note"
                                  value="note"
                                />
                              </SegmentedControl>
                              {activePropertiesTab === 'rubric' ? (
                                // Pass anchors the reviewer grades against.
                                // The rubric is frozen server-side and attached
                                // per case; without this panel you are scoring
                                // against nothing.
                                <Stack direction="vertical" gap={2}>
                                  {curCase?.rubric ? (
                                    <>
                                      <HStack gap={2}>
                                        <Token
                                          label={
                                            curCase.rubric.bucket ?? 'unbucketed'
                                          }
                                        />
                                        <Token
                                          label={`max ${curCase.rubric.max_score ?? '?'}`}
                                        />
                                      </HStack>
                                      {Object.entries(
                                        curCase.rubric.pass_anchors ?? {},
                                      ).map(([check, anchors]) => (
                                        <Card key={check}>
                                          <Stack direction="vertical" gap={1}>
                                            <Text weight="bold">
                                              {check.replace(/_/g, ' ')}
                                            </Text>
                                            {anchors.map((a, i) => (
                                              <Text
                                                key={i}
                                                type="supporting">
                                                • {a}
                                              </Text>
                                            ))}
                                          </Stack>
                                        </Card>
                                      ))}
                                    </>
                                  ) : (
                                    <Text type="supporting" color="secondary">
                                      No rubric for this case.
                                    </Text>
                                  )}
                                </Stack>
                              ) : activePropertiesTab === 'note' ? (
                                <Stack direction="vertical" gap={3}>
                                  {picked ? (
                                    <>
                                      <HStack gap={2}>
                                        <NumberInput
                                          label="Line start"
                                          size="sm"
                                          value={lineStart}
                                          onChange={v => setLineStart(v)}
                                        />
                                        <NumberInput
                                          label="Line end"
                                          size="sm"
                                          value={lineEnd}
                                          onChange={v => setLineEnd(v)}
                                        />
                                      </HStack>
                                      <TextArea
                                        label="Note"
                                        value={note}
                                        onChange={v => setNote(v)}
                                      />
                                      <Button
                                        label={
                                          lineStart
                                            ? 'Save note on lines'
                                            : 'Save note on file'
                                        }
                                        size="sm"
                                        onClick={() => saveRangeNote(picked.c, picked.a)}
                                      />
                                      {rangeNote(picked.c, picked.a) !== undefined && (
                                        <Text>
                                          Saved: {rangeNote(picked.c, picked.a)}
                                        </Text>
                                      )}
                                    </>
                                  ) : (
                                    <Text>Select a file to annotate</Text>
                                  )}
                                </Stack>
                              ) : activePropertiesTab === 'properties' ? (
                                <Stack
                                  direction="vertical"
                                  gap={3}
                                  style={styles.propertiesContent}>
                                  <Stack direction="vertical" gap={1}>
                                    {/* Filename in the heading, full artifact
                                        path underneath: the path is what you need
                                        to trace the file back to the run, and
                                        `activeFile` was duplicate state for
                                        `picked` that went stale on a case switch. */}
                                    <Heading level={2} maxLines={1}>
                                      {picked
                                        ? (picked.a.path.split('/').pop() ?? picked.a.path)
                                        : 'No file selected'}
                                    </Heading>
                                    <Text
                                      color="secondary"
                                      type="supporting"
                                      maxLines={1}>
                                      {/* Was a literal `src/components/{activeFile}`,
                                          which rendered as that exact string -- a
                                          fabricated path prefix that does not exist.
                                          Artifact paths are already tier-relative and
                                          model-tagged; inventing a prefix breaks
                                          traceability, so show the real one. */}
                                      {picked?.a.path ?? 'No file selected'}
                                    </Text>
                                  </Stack>
                                  {/*
                                    The grade buttons and the shortcut line
                                    used to live INSIDE this MetadataList.
                                    A MetadataList is a <dl> whose grid only
                                    understands <dt>/<dd> pairs, so those raw
                                    HStack/Span children broke the track math:
                                    every <dt> ballooned to 479px and all eight
                                    <dd> values were pushed to x=1791 at width
                                    0 -- the actual values were laid out 175px
                                    outside the 320px panel and unreadable.
                                    The list now holds only the facts; the
                                    controls sit above it.
                                  */}
                                  {picked && (
                                    <HStack gap={2}>
                                        <Button
                                          label="Pass"
                                          size="sm"
                                          onClick={() => grade(picked.c, picked.a, 1)}
                                        />
                                        <Button
                                          label="Fail"
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => grade(picked.c, picked.a, 0)}
                                        />
                                        <Button
                                          label="Clear"
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => grade(picked.c, picked.a, null)}
                                        />
                                        {/* Grade all deliberately lives in the
                                            TopNav and the file ContextMenu only.
                                            A third copy here sat 8px from
                                            "Fail" -- an irreversible bulk write
                                            reading as a peer of a single-file
                                            verdict. */}
                                        {/* Advances selection after a verdict
                                            instead of making the reviewer
                                            re-find their place in the tree.
                                            Disabled when every VISIBLE file is
                                            already graded -- which is honest:
                                            the search filter can hide ungraded
                                            files, and this button must not claim
                                            there is nothing left when the tree in
                                            front of you is not the whole run. */}
                                        <Button
                                          label={
                                            nextUngraded
                                              ? `Next ungraded: ${nextUngraded.a.path.split('/').pop()}`
                                              : 'All files graded'
                                          }
                                          size="sm"
                                          variant="secondary"
                                          isDisabled={!nextUngraded}
                                          onClick={() => {
                                            if (!nextUngraded) return;
                                            setPicked({c: nextUngraded.c, a: nextUngraded.a});
                                            setCaseId(nextUngraded.c.key);
                                            setViewTab('source');
                                          }}
                                        />
                                      </HStack>
                                    )}
                                    {/* Shortcuts existed only as a code comment.
                                        Its own row below the button row, NOT
                                        inside the HStack: in-row it took width
                                        from Pass/Fail/Clear and crushed them to
                                        15/11/16px at the cramped viewport. */}
                                    {picked && (
                                      <Text type="supporting" color="secondary">
                                        Keys: P pass · F fail · C clear · J/K
                                        next/prev · Enter next ungraded
                                      </Text>
                                    )}
                                  <MetadataList
                                    style={styles.metadataCompact}
                                    // Label ABOVE value, not beside it. The
                                    // side-by-side default builds a
                                    // `grid-template-columns` from the
                                    // widest LABEL, so in a narrow panel the
                                    // label ate the whole track and the value
                                    // column resolved to `0px` -- at 390px
                                    // every fact rendered as an invisible
                                    // zero-width <dd>. Stacked labels give the
                                    // value the full width at any panel size.
                                    label={{position: 'top'}}>
                                    {PROPERTIES.map(prop => (
                                      <MetadataListItem
                                        key={prop.label}
                                        label={prop.label}>
                                        {prop.value}
                                      </MetadataListItem>
                                    ))}
                                  </MetadataList>
                                </Stack>
                              ) : (
                                <Stack direction="vertical" gap={1}>
                                  <List>
                                    {HISTORY_ITEMS.map(item => (
                                      <ListItem
                                        key={item.key}
                                        label={item.label}
                                        endContent={
                                          <Text
                                            type="supporting"
                                            color="secondary"
                                            maxLines={1}>
                                            {item.at.slice(0, 16).replace('T', ' ')}
                                          </Text>
                                        }
                                        startContent={
                                          <StatusDot
                                            variant={
                                              item.score === 1
                                                ? 'success'
                                                : item.score === 0
                                                  ? 'error'
                                                  : 'neutral'
                                            }
                                            icon={
                                              item.score === 1 ? (
                                                <CheckIcon />
                                              ) : item.score === 0 ? (
                                                <XMarkIcon />
                                              ) : (
                                                <MinusIcon />
                                              )
                                            }
                                            label={
                                              item.score === 1
                                                ? `passed ${item.label}`
                                                : item.score === 0
                                                  ? `failed ${item.label}`
                                                  : `not graded ${item.label}`
                                            }
                                          />
                                        }
                                      />
                                    ))}
                                    {GRADED.length > HISTORY_SHOWN && (
                                      <ListItem
                                        label={`and ${
                                          GRADED.length - HISTORY_SHOWN
                                        } more graded file${
                                          GRADED.length - HISTORY_SHOWN === 1
                                            ? ''
                                            : 's'
                                        }`}
                                      />
                                    )}
                                    {GRADED.length === 0 && (
                                      <ListItem label="No files graded yet" />
                                    )}
                                  </List>
                                </Stack>
                              )}
                            </Stack>
                          </LayoutPanel>
                        )}
                      </>
                    )
                  }
                />
              </LayoutContent>
            }
          />
        </LayoutContent>
      }
    />
    {/* Bulk-passing a case is irreversible in practice (it writes PASS to every
        file), so it goes through AlertDialog instead of firing on one click. */}
    {bulkMsg && (
      <Banner
        status="info"
        container="card"
        title="Nothing to grade"
        description={bulkMsg}
        onDismiss={() => setBulkMsg(null)}
      />
    )}
    {confirmBulkReq && (
      <AlertDialog
        title={`Pass all ${confirmBulkReq.count} file${confirmBulkReq.count === 1 ? '' : 's'} in ${confirmBulkReq.caseLabel}?`}
        description={
          confirmBulkReq.skipped > 0
            ? `This marks ${confirmBulkReq.count} file(s) as PASS and leaves ${confirmBulkReq.skipped} already-graded file(s) untouched. Grades are saved immediately and can be changed per file afterwards.`
            : 'This marks every file in the case as PASS. Grades are saved immediately and can be changed per file afterwards.'
        }
        actionLabel="Pass all files"
        isOpen
        onOpenChange={open => {
          if (!open) setConfirmBulkReq(null);
        }}
        onAction={() => {
          const req = confirmBulkReq;
          setConfirmBulkReq(null);
          if (!req) return;
          const cur = cases.find(c => c.key === req.caseId);
          // Ungraded only: a bulk pass must never overwrite a human decision
          // that was already made on some of the case's files.
          cur?.artifacts.forEach(a => {
            if (gradeFor(grades, cur, a)?.score == null)
              grade(cur, a, 1, gradeFor(grades, cur, a)?.note ?? '');
          });
        }}
      />
    )}
    </AppShell>
  );
}
