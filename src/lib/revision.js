const PILE_KEY = 'bealingo-revision-pile'
const LOGIN_DAYS_KEY = 'bealingo-login-days'
const STATUS_NEEDS_REVIEW = 'needs-review'
const STATUS_FAMILIAR = 'familiar'
const STATUS_MASTERED = 'mastered'
const MAX_PRACTICE_HISTORY = 40

const STATUS_CONFIG = {
  [STATUS_NEEDS_REVIEW]: {
    label: 'Needs review',
    delayDays: 1,
    weight: 1.8,
  },
  [STATUS_FAMILIAR]: {
    label: 'Familiar',
    delayDays: 4,
    weight: 1,
  },
  [STATUS_MASTERED]: {
    label: 'Mastered',
    delayDays: 14,
    weight: 0.25,
  },
}
const MAX_REVIEW_HISTORY = 40

const ARTICLE_WORDS = new Set(['a', 'an', 'the'])
const DETERMINER_WORDS = new Set([
  'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'some', 'any', 'many', 'much', 'few', 'several', 'another', 'each', 'every',
])
const MODAL_WORDS = new Set([
  'can', 'could', 'should', 'would', 'must', 'may', 'might', 'will', 'shall',
  'need', 'needs', 'want', 'wants', 'have', 'has', 'had',
])
const COMMON_VERBS = new Set([
  'be', 'am', 'is', 'are', 'was', 'were', 'go', 'eat', 'do', 'make', 'take', 'get',
  'come', 'see', 'know', 'want', 'need', 'like', 'love', 'work', 'study', 'speak',
  'learn', 'say', 'tell', 'ask', 'give', 'find', 'think', 'feel', 'leave',
  'transfer', 'recommend', 'review', 'rate',
])
const COMMON_ADJECTIVES = new Set([
  'good', 'bad', 'big', 'small', 'happy', 'sad', 'tired', 'hungry', 'ready', 'important',
  'easy', 'hard', 'beautiful', 'interesting', 'useful', 'possible', 'difficult',
])
const COMMON_ADVERBS = new Set([
  'very', 'really', 'quickly', 'slowly', 'always', 'often', 'never', 'today', 'tomorrow',
  'here', 'there', 'now', 'later',
])

function normalizeForCategory(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,!?;:/\\[\]{}"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeCategoryText(value) {
  return normalizeForCategory(value).split(' ').filter(Boolean)
}

function classifyKnowledgeCategory(front, back = '', note = '') {
  const frontTokens = tokenizeCategoryText(front)
  const glossTokens = tokenizeCategoryText(back)
  const noteText = normalizeForCategory(note)
  const tokens = glossTokens.length > 0 ? glossTokens : frontTokens
  const text = tokens.join(' ')
  const first = tokens[0] || ''
  const last = tokens[tokens.length - 1] || ''

  if (noteText.includes('adjective')) return 'adjective'
  if (noteText.includes('adverb')) return 'adjective'
  if (noteText.includes('verb')) return 'verb'
  if (noteText.includes('noun')) return 'noun'

  if (tokens.length === 0) return 'noun'

  if (text.startsWith('to ')) return 'verb'
  if (first === 'to' && tokens.length > 1) return 'verb'

  if (ARTICLE_WORDS.has(first) || DETERMINER_WORDS.has(first)) return 'noun'
  if (MODAL_WORDS.has(first) && tokens.length > 1) return 'verb'

  if (tokens.length > 1) {
    if (['very', 'really', 'quite', 'too', 'so'].includes(first)) return 'adjective'
    if (first === 'well' || ['reviewed', 'rated'].includes(last)) return 'adjective'
    if (COMMON_VERBS.has(first) || MODAL_WORDS.has(first) || last.endsWith('ing') || last.endsWith('ed')) return 'verb'
    if (last.endsWith('ly')) return 'adjective'
    return 'noun'
  }

  if (COMMON_ADVERBS.has(first) || first.endsWith('ly')) return 'adjective'
  if (
    COMMON_ADJECTIVES.has(first) ||
    /(?:ous|ful|less|able|ible|ive|al|ic|ary|ory|ish|y)$/.test(first)
  ) {
    return 'adjective'
  }
  if (
    COMMON_VERBS.has(first) ||
    /(?:ing|ed|en|fy|ise|ize)$/.test(first)
  ) {
    return 'verb'
  }
  if (/^(i|you|he|she|it|we|they|me|him|her|us|them)$/.test(first)) return 'noun'
  return 'noun'
}

const VALID_KNOWLEDGE_CATEGORIES = new Set(['noun', 'verb', 'adjective'])

function normalizeKnowledgeCategory(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return VALID_KNOWLEDGE_CATEGORIES.has(normalized) ? normalized : ''
}

function normalizePileItem(item) {
  const normalizedStatus = normalizeStatus(item.status)
  const explicitCategory = item.categorySource === 'model' || item.categorySource === 'manual'
    ? normalizeKnowledgeCategory(item.partOfSpeech || item.category)
    : ''
  return {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    front: item.front || '',
    back: item.back || '',
    note: item.note || '',
    exampleTarget: item.exampleTarget || '',
    exampleSource: item.exampleSource || '',
    category: explicitCategory || classifyKnowledgeCategory(item.front, item.back, item.note),
    categorySource: item.categorySource || 'heuristic',
    sourceType: item.sourceType || 'vocabulary',
    addedAt: item.addedAt || new Date().toISOString().slice(0, 10),
    lastReviewed: item.lastReviewed || null,
    status: normalizedStatus,
    hiddenUntilLoginDay: item.hiddenUntilLoginDay ?? null,
    timesKnown: Number.isFinite(item.timesKnown) ? item.timesKnown : 0,
    timesUnknown: Number.isFinite(item.timesUnknown) ? item.timesUnknown : 0,
    reviewHistory: normalizeReviewHistory(item.reviewHistory),
    practiceHistory: normalizePracticeHistory(item.practiceHistory),
    practiceCorrectCount: Number.isFinite(item.practiceCorrectCount) ? item.practiceCorrectCount : 0,
    practiceIncorrectCount: Number.isFinite(item.practiceIncorrectCount) ? item.practiceIncorrectCount : 0,
  }
}

function normalizeReviewHistory(history) {
  if (!Array.isArray(history)) return []

  return history
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const toStatus = normalizeStatus(entry.toStatus || entry.status)
      const fromStatus = entry.fromStatus ? normalizeStatus(entry.fromStatus) : null
      return {
        at: String(entry.at || '').trim() || null,
        date: String(entry.date || '').trim() || null,
        loginDay: Number.isFinite(entry.loginDay) ? entry.loginDay : null,
        source: String(entry.source || '').trim() || 'system',
        fromStatus,
        toStatus,
      }
    })
    .filter(Boolean)
    .slice(-MAX_REVIEW_HISTORY)
}

function normalizePracticeHistory(history) {
  if (!Array.isArray(history)) return []

  return history
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      return {
        at: String(entry.at || '').trim() || null,
        date: String(entry.date || '').trim() || null,
        loginDay: Number.isFinite(entry.loginDay) ? entry.loginDay : null,
        questionType: String(entry.questionType || '').trim() || 'unknown',
        correct: entry.correct === true,
      }
    })
    .filter(Boolean)
    .slice(-MAX_PRACTICE_HISTORY)
}

function normalizeStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'known') return STATUS_MASTERED
  if (normalized === 'active') return STATUS_FAMILIAR
  if (normalized === STATUS_NEEDS_REVIEW || normalized === STATUS_FAMILIAR || normalized === STATUS_MASTERED) {
    return normalized
  }
  return STATUS_FAMILIAR
}

function loadPile() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PILE_KEY)) || []
    return Array.isArray(parsed) ? parsed.map(normalizePileItem) : []
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
  const existingEntries = new Set(pile.map((p) => `${p.front.toLowerCase()}::${p.back.toLowerCase()}`))
  let added = 0

  for (const item of items) {
    const front = item.front || item.target || item.word || ''
    const back = item.back || item.source || item.translation || ''
    const entryKey = `${front.toLowerCase()}::${back.toLowerCase()}`
    if (!front || existingEntries.has(entryKey)) continue

    pile.push(normalizePileItem({
      front,
      back,
      note: item.note || item.meaning || '',
      exampleTarget: item.exampleTarget || '',
      exampleSource: item.exampleSource || '',
      category: normalizeKnowledgeCategory(item.partOfSpeech || item.category) || classifyKnowledgeCategory(front, back, item.note || item.meaning || ''),
      categorySource: item.partOfSpeech ? 'model' : 'heuristic',
      sourceType: item.sourceType || 'vocabulary',
    }))
    existingEntries.add(entryKey)
    added += 1
  }

  savePile(pile)
  return added
}

export function extractItemsFromLesson(lessonContent) {
  if (!lessonContent) return []
  const items = []
  const pushVocabItems = (entries, sourceType) => {
    for (const vocab of entries || []) {
      items.push({
        front: vocab.front,
        back: vocab.back,
        note: vocab.note,
        exampleTarget: vocab.exampleTarget,
        exampleSource: vocab.exampleSource,
        partOfSpeech: vocab.partOfSpeech,
        category: vocab.category,
        sourceType,
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
        partOfSpeech: f.partOfSpeech,
        category: f.category,
        sourceType: 'flashcard',
      })
    }
  }

  if (lessonContent.sentences) {
    for (const sentence of lessonContent.sentences) {
      pushVocabItems(sentence.focusVocabulary, 'lesson-vocabulary')
    }
  }

  if (lessonContent.scenario?.exchanges) {
    for (const exchange of lessonContent.scenario.exchanges) {
      pushVocabItems(exchange.focusVocabulary, 'lesson-vocabulary')
    }
  }

  if (lessonContent.questions) {
    for (const question of lessonContent.questions) {
      pushVocabItems(question.focusVocabulary, 'lesson-vocabulary')
    }
  }

  if (items.length === 0 && lessonContent.vocabulary) {
    for (const vocab of lessonContent.vocabulary) {
      items.push({
        front: vocab.front,
        back: vocab.back,
        note: vocab.note,
        exampleTarget: vocab.exampleTarget,
        exampleSource: vocab.exampleSource,
        partOfSpeech: vocab.partOfSpeech,
        category: vocab.category,
        sourceType: 'lesson-vocabulary',
      })
    }
  }

  return items
}

export function pickRevisionCards(count = 6) {
  const pile = loadPile()
  const currentLoginDay = getLoginDayCount()

  const available = pile.filter((item) => {
    if (item.hiddenUntilLoginDay !== null) {
      return currentLoginDay >= item.hiddenUntilLoginDay
    }
    return true
  })

  if (available.length === 0) return []

  const weighted = available.map((item) => {
    let weight = STATUS_CONFIG[item.status]?.weight ?? 1
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
  updateCardStatus(cardId, STATUS_MASTERED, { recordReview: true, source: 'revision' })
}

export function markCardUnknown(cardId) {
  updateCardStatus(cardId, STATUS_NEEDS_REVIEW, { recordReview: true, source: 'revision' })
}

export function markCardFamiliar(cardId) {
  updateCardStatus(cardId, STATUS_FAMILIAR, { recordReview: true, source: 'revision' })
}

export function updateCardStatus(cardId, nextStatus, options = {}) {
  const pile = loadPile()
  const currentLoginDay = getLoginDayCount()
  const normalizedStatus = normalizeStatus(nextStatus)
  const card = pile.find((p) => p.id === cardId)
  if (card) {
    const previousStatus = normalizeStatus(card.status)
    card.status = normalizedStatus
    if (options.recordReview) {
      card.lastReviewed = new Date().toISOString().slice(0, 10)
    }
    card.hiddenUntilLoginDay = currentLoginDay + (STATUS_CONFIG[normalizedStatus]?.delayDays ?? 4)
    if (options.recordReview && normalizedStatus === STATUS_MASTERED) {
      card.timesKnown += 1
    }
    if (options.recordReview && normalizedStatus === STATUS_NEEDS_REVIEW) {
      card.timesUnknown += 1
    }
    if (shouldAppendHistory(previousStatus, normalizedStatus, options)) {
      card.reviewHistory = appendHistoryEntry(card.reviewHistory, {
        at: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        loginDay: currentLoginDay,
        source: options.source || (options.recordReview ? 'revision' : 'manual'),
        fromStatus: previousStatus,
        toStatus: normalizedStatus,
      })
    }
  }
  savePile(pile)
}

export function updateCardCategory(cardId, nextCategory) {
  const category = normalizeKnowledgeCategory(nextCategory)
  if (!category) return
  const pile = loadPile()
  const card = pile.find((item) => item.id === cardId)
  if (!card) return
  card.category = category
  card.categorySource = 'manual'
  savePile(pile)
}

function shouldAppendHistory(previousStatus, nextStatus, options) {
  if (previousStatus !== nextStatus) return true
  return options.recordReview === true
}

function appendHistoryEntry(history, entry) {
  const normalized = normalizeReviewHistory(history)
  return [...normalized, entry].slice(-MAX_REVIEW_HISTORY)
}

export function getPileStats() {
  const pile = loadPile()
  return {
    total: pile.length,
    needsReview: pile.filter((p) => p.status === STATUS_NEEDS_REVIEW).length,
    familiar: pile.filter((p) => p.status === STATUS_FAMILIAR).length,
    mastered: pile.filter((p) => p.status === STATUS_MASTERED).length,
  }
}

export function getPileItems() {
  return loadPile().sort((a, b) => {
    if (a.front.toLowerCase() < b.front.toLowerCase()) return -1
    if (a.front.toLowerCase() > b.front.toLowerCase()) return 1
    return 0
  })
}

export function getStatusOptions() {
  return [
    { value: STATUS_NEEDS_REVIEW, label: STATUS_CONFIG[STATUS_NEEDS_REVIEW].label },
    { value: STATUS_FAMILIAR, label: STATUS_CONFIG[STATUS_FAMILIAR].label },
    { value: STATUS_MASTERED, label: STATUS_CONFIG[STATUS_MASTERED].label },
  ]
}

export function getStatusLabel(status) {
  return STATUS_CONFIG[normalizeStatus(status)]?.label || STATUS_CONFIG[STATUS_FAMILIAR].label
}

export function getLatestHistoryEntry(item) {
  const history = normalizeReviewHistory(item?.reviewHistory)
  return history.length > 0 ? history[history.length - 1] : null
}

export function recordPracticeResult(itemId, result) {
  const pile = loadPile()
  const currentLoginDay = getLoginDayCount()
  const card = pile.find((p) => p.id === itemId)
  if (card) {
    card.practiceHistory = [
      ...normalizePracticeHistory(card.practiceHistory),
      {
        at: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        loginDay: currentLoginDay,
        questionType: result?.questionType || 'unknown',
        correct: result?.correct === true,
      },
    ].slice(-MAX_PRACTICE_HISTORY)
    if (result?.correct) card.practiceCorrectCount += 1
    else card.practiceIncorrectCount += 1
  }
  savePile(pile)
}

export function getProgressSnapshot(profile) {
  const pile = loadPile()
  const stats = getPileStats()
  const completedDays = Array.isArray(profile?.completedSessionDays) ? profile.completedSessionDays.length : 0
  const currentStreak = getCurrentStreak(profile?.completedSessionDays)
  const practiceSummary = buildPracticeSummary(pile)
  const stabilitySummary = buildStabilitySummary(pile)
  const weakItems = pile
    .filter((item) => getWeaknessScore(item) > 0)
    .sort((a, b) => {
      const scoreA = getWeaknessScore(a)
      const scoreB = getWeaknessScore(b)
      if (scoreB !== scoreA) return scoreB - scoreA
      return a.front.localeCompare(b.front)
    })
    .slice(0, 4)

  return {
    stats,
    completedDays,
    currentStreak,
    practiceSummary,
    stabilitySummary,
    weakSpots: buildWeakSpotInsights(pile, practiceSummary),
    weakItems,
  }
}

function getWeaknessScore(item) {
  let score = item.timesUnknown * 2
  if (item.status === STATUS_NEEDS_REVIEW) score += 2
  if (item.category === 'phrase') score += 0.25
  score += Math.min((item.reviewHistory || []).filter((entry) => entry.toStatus === STATUS_NEEDS_REVIEW).length * 0.35, 2)
  score += Math.min((item.practiceHistory || []).filter((entry) => entry.correct === false).length * 0.5, 2.5)
  if (countStatusRegressions(item.reviewHistory) > 0) score += 1
  return score
}

function buildWeakSpotInsights(pile, practiceSummary) {
  const items = pile.filter((item) => getWeaknessScore(item) > 0)
  if (items.length === 0) return null

  const phraseItems = items.filter((item) => item.category === 'phrase')
  const wordItems = items.filter((item) => item.category !== 'phrase')
  const weakestFormat = phraseItems.length > wordItems.length
    ? {
        title: 'Phrases need more support',
        detail: `${phraseItems.length} phrase items are still shaky compared with ${wordItems.length} single words.`,
        suggestion: 'A few extra short phrase reviews will help those chunks stick faster.',
      }
    : {
        title: 'Single words need more support',
        detail: `${wordItems.length} word items still need work compared with ${phraseItems.length} phrases.`,
        suggestion: 'Quick repetition on core words should make the rest of the lesson feel lighter.',
      }

  const categoryCounts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1
    return acc
  }, {})
  const weakestCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]
  const categoryInsight = weakestCategory
    ? {
        category: weakestCategory[0],
        count: weakestCategory[1],
      }
    : null

  const practiceInsight = practiceSummary.totalAnswered > 0
    ? {
        accuracy: practiceSummary.accuracy,
        weakerType: practiceSummary.weakerType,
      }
    : null

  const regressionCount = items.filter((item) => countStatusRegressions(item.reviewHistory) > 0).length

  return {
    weakestFormat,
    categoryInsight,
    practiceInsight,
    regressionCount,
  }
}

function buildPracticeSummary(pile) {
  const allEntries = pile.flatMap((item) => (item.practiceHistory || []).map((entry) => ({ ...entry, item })))
  const totalAnswered = allEntries.length
  const correct = allEntries.filter((entry) => entry.correct).length
  const byType = allEntries.reduce((acc, entry) => {
    const key = entry.questionType || 'unknown'
    const current = acc[key] || { total: 0, correct: 0 }
    current.total += 1
    if (entry.correct) current.correct += 1
    acc[key] = current
    return acc
  }, {})
  const weakerType = Object.entries(byType)
    .map(([type, stats]) => ({ type, accuracy: stats.total > 0 ? stats.correct / stats.total : 0, total: stats.total }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)[0] || null

  return {
    totalAnswered,
    accuracy: totalAnswered > 0 ? correct / totalAnswered : 0,
    correct,
    weakerType,
  }
}

function buildStabilitySummary(pile) {
  const itemsWithReviewHistory = pile.filter((item) => (item.reviewHistory || []).length > 0)
  const stableMastered = pile.filter((item) => isStableMastery(item)).length
  const regressions = pile.reduce((sum, item) => sum + countStatusRegressions(item.reviewHistory), 0)

  return {
    trackedItems: itemsWithReviewHistory.length,
    stableMastered,
    regressions,
  }
}

function isStableMastery(item) {
  const history = item.reviewHistory || []
  if (item.status !== STATUS_MASTERED) return false
  if (history.length < 2) return false
  const recent = history.slice(-3)
  return recent.filter((entry) => entry.toStatus === STATUS_MASTERED).length >= 2
}

function countStatusRegressions(history) {
  const entries = Array.isArray(history) ? history : []
  let count = 0
  for (const entry of entries) {
    if (!entry?.fromStatus || !entry?.toStatus) continue
    if (entry.fromStatus === STATUS_MASTERED && entry.toStatus !== STATUS_MASTERED) count += 1
    if (entry.fromStatus === STATUS_FAMILIAR && entry.toStatus === STATUS_NEEDS_REVIEW) count += 1
  }
  return count
}

function getCurrentStreak(completedSessionDays) {
  if (!Array.isArray(completedSessionDays) || completedSessionDays.length === 0) return 0
  const sortedDays = [...completedSessionDays].sort((a, b) => a - b)
  let streak = 1
  for (let index = sortedDays.length - 1; index > 0; index -= 1) {
    if (sortedDays[index] - sortedDays[index - 1] !== 1) break
    streak += 1
  }
  return streak
}

export {
  STATUS_NEEDS_REVIEW,
  STATUS_FAMILIAR,
  STATUS_MASTERED,
}
