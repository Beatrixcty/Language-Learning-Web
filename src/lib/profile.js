const PROFILE_KEY = 'bealingo-learning-profile'
const SESSION_DATA_KEY = 'bealingo-session-data'

function readStoredProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveLearningProfile(answers) {
  const existingProfile = readStoredProfile() || {}
  const goals = Array.isArray(answers.goal) ? answers.goal : [answers.goal].filter(Boolean)
  const styles = Array.isArray(answers.learningStyle)
    ? answers.learningStyle
    : [answers.learningStyle].filter(Boolean)

  const now = new Date().toISOString()
  const profile = {
    ...existingProfile,
    language: answers.language || existingProfile.language || null,
    languageVariant: answers.languageVariant || existingProfile.languageVariant || null,
    languageRegion: answers.languageRegion || existingProfile.languageRegion || null,
    nativeLanguage: answers.nativeLanguage || existingProfile.nativeLanguage || 'English',
    name: answers.name || existingProfile.name || null,
    level: answers.assessedLevel || answers.selfLevel || answers.level || existingProfile.level || null,
    assessedLevel: answers.assessedLevel || existingProfile.assessedLevel || null,
    selfLevel: answers.selfLevel || existingProfile.selfLevel || null,
    interests: answers.interests || existingProfile.interests || [],
    motivation: answers.motivation || existingProfile.motivation || null,
    correctionStyle: answers.correctionStyle || existingProfile.correctionStyle || null,
    goal: goals.length > 0 ? goals : existingProfile.goal || [],
    goals: goals.length > 0 ? goals : existingProfile.goals || [],
    learningStyle: styles.length > 0 ? styles : existingProfile.learningStyle || [],
    learningStyles: styles.length > 0 ? styles : existingProfile.learningStyles || [],
    primaryStyle: styles[0] || existingProfile.primaryStyle || null,
    styleSettings: answers.styleSettings || existingProfile.styleSettings || {},
    schedule: answers.schedule || existingProfile.schedule || null,
    newMaterialPace: answers.newMaterialPace || existingProfile.newMaterialPace || null,
    quizFrequency: answers.quizFrequency || existingProfile.quizFrequency || null,
    completedSessionDays: Array.isArray(answers.completedSessionDays)
      ? answers.completedSessionDays
      : existingProfile.completedSessionDays || [],
    lastCompletedAt: answers.lastCompletedAt || existingProfile.lastCompletedAt || null,
    lastBatchFeedbackSummary: answers.lastBatchFeedbackSummary || existingProfile.lastBatchFeedbackSummary || null,
    createdAt: existingProfile.createdAt || now,
    updatedAt: now,
  }

  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  window.localStorage.removeItem(SESSION_DATA_KEY)
  return profile
}

export function getLearningProfile() {
  return readStoredProfile()
}

export function hasLearningProfile() {
  return !!getLearningProfile()
}

export function clearLearningProfile() {
  const appKeys = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith('bealingo-') && key !== 'bealingo-active-page') {
      appKeys.push(key)
    }
  }
  appKeys.forEach((key) => window.localStorage.removeItem(key))
}

export function getCompletedSessionCount(profile) {
  return Array.isArray(profile?.completedSessionDays) ? profile.completedSessionDays.length : 0
}

export function isSessionComplete(profile, dayNumber) {
  return Array.isArray(profile?.completedSessionDays) && profile.completedSessionDays.includes(dayNumber)
}

export function markSessionComplete(profile, dayNumber) {
  const completedSessionDays = Array.isArray(profile?.completedSessionDays)
    ? [...profile.completedSessionDays]
    : []
  const completedAt = new Date().toISOString()

  if (!completedSessionDays.includes(dayNumber)) {
    completedSessionDays.push(dayNumber)
    completedSessionDays.sort((a, b) => a - b)
  }

  return saveLearningProfile({
    ...profile,
    completedSessionDays,
    lastCompletedAt: completedAt,
  })
}
