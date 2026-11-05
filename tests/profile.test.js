import assert from 'node:assert/strict'
import test from 'node:test'


class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  get length() {
    return this.values.size
  }

  key(index) {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }
}


globalThis.window = { localStorage: new MemoryStorage() }

const {
  clearLearningProfile,
  getLearningProfile,
  markSessionComplete,
  saveLearningProfile,
} = await import('../src/lib/profile.js')

test.beforeEach(() => window.localStorage.clear())

test('finishing a session persists completion and feedback state', () => {
  const initial = saveLearningProfile({
    name: 'Learner',
    language: 'spanish',
    nativeLanguage: 'English',
    selfLevel: 'beginner',
    goal: ['Travel conversations'],
    learningStyle: ['Daily sentences'],
  })
  const feedback = { date: '2026-09-16', nextLevel: 'Beginner' }
  const completed = markSessionComplete({ ...initial, lastBatchFeedbackSummary: feedback }, 1)

  assert.deepEqual(completed.completedSessionDays, [1])
  assert.equal(typeof completed.lastCompletedAt, 'string')
  assert.deepEqual(completed.lastBatchFeedbackSummary, feedback)
  assert.deepEqual(getLearningProfile().completedSessionDays, [1])
})

test('saving preference changes preserves completed sessions', () => {
  const completed = markSessionComplete(saveLearningProfile({ language: 'french' }), 1)
  const updated = saveLearningProfile({ ...completed, goal: ['Reading'] })

  assert.deepEqual(updated.completedSessionDays, [1])
  assert.equal(updated.goal[0], 'Reading')
})

test('starting over removes BeaLingo learning data but preserves the active page', () => {
  window.localStorage.setItem('bealingo-active-page', 'Session')
  window.localStorage.setItem('bealingo-revision-pile', '[{"front":"hola"}]')
  window.localStorage.setItem('unrelated-key', 'keep')
  saveLearningProfile({ language: 'spanish' })

  clearLearningProfile()

  assert.equal(getLearningProfile(), null)
  assert.equal(window.localStorage.getItem('bealingo-revision-pile'), null)
  assert.equal(window.localStorage.getItem('bealingo-active-page'), 'Session')
  assert.equal(window.localStorage.getItem('unrelated-key'), 'keep')
})
