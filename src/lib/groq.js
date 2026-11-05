const API_BASE = import.meta.env.VITE_API_BASE || ''

export function getChatGPTConnectUrl() {
  return `${API_BASE}/api/chatgpt/connect`
}

export async function getChatGPTStatus() {
  const response = await fetch(`${API_BASE}/api/chatgpt/status`)
  if (!response.ok) return { connected: false, provider: 'Groq free tier' }
  return response.json()
}

async function postJson(path, body) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 75_000)

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API request failed (${response.status}): ${text}`)
    }
    const data = await response.json()
    if (data.error) throw new Error(data.error)
    return data
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The lesson is taking too long to prepare. Please try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function fetchVocabList(targetLanguage) {
  const data = await postJson('/api/vocab-list', { targetLanguage })
  return data.words
}

export async function assessOnboardingSentence({ targetLanguage, nativeLanguage, sentence }) {
  return postJson('/api/assess-sentence', { targetLanguage, nativeLanguage, sentence })
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
