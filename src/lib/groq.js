const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API request failed (${response.status}): ${text}`)
  }
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function fetchVocabList(targetLanguage) {
  const data = await postJson('/api/vocab-list', { targetLanguage })
  return data.words
}

export async function generateLesson(profile, style, count) {
  const data = await postJson('/api/generate-lesson', { profile, style, count })
  return data
}

export async function generatePracticeSession(profile, lessonContent, count) {
  const data = await postJson('/api/generate-practice', { profile, lessonContent, count })
  if (!Array.isArray(data.questions)) {
    throw new Error('API response missing questions array.')
  }
  return data.questions
}

export async function generateDailySentences(profile, count = 2) {
  const data = await postJson('/api/generate-sentences', { profile, count })
  if (!Array.isArray(data.sentences)) {
    throw new Error('API response missing sentences array.')
  }
  return data.sentences
}

export async function askCoach({ profile, sentences = [], history = [], userMessage }) {
  const data = await postJson('/api/ask-coach', {
    profile,
    sentences,
    history,
    userMessage,
  })
  return data.reply
}
