import {expect, test} from 'bun:test'

import {
  ALL_MODELS_RUN_ID,
  gradeFor,
  runIdForModel,
  type Artifact,
  type Case,
  type GradeBook,
  type RunSummary,
} from './data'

const runs: RunSummary[] = [
  {id: 'run-a', model: 'model-a', records: 1, cases: 1},
  {id: 'run-b', model: 'model-b', records: 1, cases: 1},
]

test('All models selects the aggregate run', () => {
  expect(runIdForModel('', runs)).toBe(ALL_MODELS_RUN_ID)
  expect(runIdForModel('model-b', runs)).toBe('run-b')
})

test('aggregate cases read grades from their source run', () => {
  const c = {
    id: 'case-a',
    key: 'run-a:case-a',
    runId: 'run-a',
    model: 'model-a',
  } as Case
  const a = {path: 'model-a/tool-written/case-a.py'} as Artifact
  const grades: GradeBook = {
    'run-a': {
      files: {
        'case-a:model-a/tool-written/case-a.py': {
          score: 1,
          note: '',
          at: '2026-10-09T00:00:00Z',
        },
      },
    },
  }

  expect(gradeFor(grades, c, a)?.score).toBe(1)
})
