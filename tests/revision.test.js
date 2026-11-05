import test from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null },
    setItem(key, value) { storage.set(key, value) },
  },
}

const { addItemsToPile, extractItemsFromLesson } = await import('../src/lib/revision.js')

test('lesson extraction preserves explicit part of speech', () => {
  const [item] = extractItemsFromLesson({
    vocabulary: [{ front: 'viajar', back: 'to travel', partOfSpeech: 'verb' }],
  })
  assert.equal(item.partOfSpeech, 'verb')
})

test('explicit part of speech wins and legacy categories are folded into the three supported groups', () => {
  storage.clear()
  addItemsToPile([
    { front: 'correr', back: 'run', partOfSpeech: 'verb' },
    { front: '旺角站', back: 'Mong Kok station', category: 'phrase' },
  ])
  const pile = JSON.parse(storage.get('bealingo-revision-pile'))
  assert.equal(pile[0].category, 'verb')
  assert.equal(pile[1].category, 'noun')
})
