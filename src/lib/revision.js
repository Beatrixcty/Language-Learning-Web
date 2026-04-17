const PILE_KEY = 'bealingo-revision-pile'
const LOGIN_DAYS_KEY = 'bealingo-login-days'

function loadPile() {
  try {
    return JSON.parse(window.localStorage.getItem(PILE_KEY)) || []
  } catch {
    return []
  }
}

function savePile(pile) {
  window.localStorage.setItem(PILE_KEY, JSON.stringify(pile))
}

function getLoginDayCount() {
  const days = getLoginDays()
  return days.length
}

function getLoginDays() {
  try {
    return JSON.parse(window.localStorage.getItem(LOGIN_DAYS_KEY)) || []
  } catch {
    return []
  }
}

export function recordLoginDay() {
  const today = new Date().toISOString().slice(0, 10)
  const days = getLoginDays()
  if (!days.includes(today)) {
    days.push(today)
    window.localStorage.setItem(LOGIN_DAYS_KEY, JSON.stringify(days))
  }
  return days.length
}

export function addItemsToPile(items) {
  const pile = loadPile()
  const existingFronts = new Set(pile.map((p) => p.front))
  let added = 0

  for (const item of items) {
    const front = item.front || item.target || item.word || ''
    const back = item.back || item.source || item.translation || ''
    if (!front || existingFronts.has(front)) continue

    pile.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      front,
      back,
      note: item.note || item.meaning || '',
      exampleTarget: item.exampleTarget || '',
      exampleSource: item.exampleSource || '',
      addedAt: new Date().toISOString().slice(0, 10),
      lastReviewed: null,
      status: 'active',
      hiddenUntilLoginDay: null,
      timesKnown: 0,
      timesUnknown: 0,
    })
    existingFronts.add(front)
    added += 1
  }

  savePile(pile)
  return added
}

export function extractItemsFromLesson(lessonContent) {
  if (!lessonContent) return []
  const items = []

  if (lessonContent.sentences) {
    for (const s of lessonContent.sentences) {
      items.push({
        front: s.target,
        back: s.source,
        note: s.meaning,
        exampleTarget: s.exampleTarget,
        exampleSource: s.exampleSource,
      })
    }
  }

  if (lessonContent.flashcards) {
    for (const f of lessonContent.flashcards) {
      items.push({
        front: f.front,
        back: f.back,
        note: f.note,
        exampleTarget: f.exampleTarget,
        exampleSource: f.exampleSource,
      })
    }
  }

  if (lessonContent.scenario) {
    for (const ex of lessonContent.scenario.exchanges || []) {
      if (ex.lineTarget) {
        items.push({
          front: ex.lineTarget,
          back: ex.lineSource,
          note: ex.note || '',
        })
      }
    }
  }

  if (lessonContent.questions) {
    for (const q of lessonContent.questions) {
      items.push({
        front: q.prompt,
        back: q.answer,
      })
    }
  }

  return items
}

export function pickRevisionCards(count = 6) {
  const pile = loadPile()
  const currentLoginDay = getLoginDayCount()

  const available = pile.filter((item) => {
    if (item.status === 'known' && item.hiddenUntilLoginDay !== null) {
      return currentLoginDay >= item.hiddenUntilLoginDay
    }
    return true
  })

  if (available.length === 0) return []

  const weighted = available.map((item) => {
    let weight = 1.0
    if (item.timesKnown > 0) {
      weight = Math.max(0.15, 1.0 / (1 + item.timesKnown))
    }
    if (item.timesUnknown > 0) {
      weight = Math.min(2.0, weight + item.timesUnknown * 0.3)
    }
    return { item, weight }
  })

  const selected = []
  const used = new Set()
  const target = Math.min(count, available.length)

  for (let i = 0; i < target; i++) {
    const remaining = weighted.filter((w) => !used.has(w.item.id))
    if (remaining.length === 0) break
    const totalWeight = remaining.reduce((sum, w) => sum + w.weight, 0)
    let rand = Math.random() * totalWeight
    for (const w of remaining) {
      rand -= w.weight
      if (rand <= 0) {
        selected.push(w.item)
        used.add(w.item.id)
        break
      }
    }
  }

  return selected
}

export function markCardKnown(cardId) {
  const pile = loadPile()
  const currentLoginDay = getLoginDayCount()
  const card = pile.find((p) => p.id === cardId)
  if (card) {
    card.status = 'known'
    card.timesKnown += 1
    card.lastReviewed = new Date().toISOString().slice(0, 10)
    card.hiddenUntilLoginDay = currentLoginDay + 7
  }
  savePile(pile)
}

export function markCardUnknown(cardId) {
  const pile = loadPile()
  const card = pile.find((p) => p.id === cardId)
  if (card) {
    card.status = 'active'
    card.timesUnknown += 1
    card.lastReviewed = new Date().toISOString().slice(0, 10)
    card.hiddenUntilLoginDay = null
  }
  savePile(pile)
}

export function getPileStats() {
  const pile = loadPile()
  return {
    total: pile.length,
    active: pile.filter((p) => p.status === 'active').length,
    known: pile.filter((p) => p.status === 'known').length,
  }
}
