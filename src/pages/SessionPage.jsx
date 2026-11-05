import { useEffect, useState } from 'react'
import {
  clearLearningProfile,
  getLearningProfile,
  getCompletedSessionCount,
  isSessionComplete,
  markSessionComplete,
  saveLearningProfile,
} from '../lib/profile.js'
import { assessOnboardingSentence, askCoach, fetchVocabList, generateLesson, generatePracticeSession } from '../lib/groq.js'
import {
  addItemsToPile,
  extractItemsFromLesson,
  markCardFamiliar,
  markCardKnown,
  markCardUnknown,
  pickRevisionCards,
  recordLoginDay,
} from '../lib/revision.js'

const baseSteps = [
  'name',
  'language',
  'languageVariant',
  'languageRegion',
  'nativeLanguage',
  'selfLevel',
  'vocabTest',
  'sentenceTask',
  'interests',
  'motivation',
  'correctionStyle',
  'goal',
  'learningStyle',
  'learningStyleDetails',
  'schedule',
  'newMaterialPace',
  'quizFrequency',
]

const learningStyleOptions = [
  'Daily sentences',
  'Flashcards',
  'Conversation scenarios',
]

const languageFollowUps = {
  portuguese: {
    question: 'Would you like Brazilian Portuguese or European Portuguese?',
    placeholder: 'Choose the Portuguese variety...',
    options: ['Brazilian Portuguese', 'European Portuguese'],
  },
  chinese: {
    question: 'Would you like Simplified or Traditional Chinese?',
    placeholder: 'Choose the script and region...',
    options: ['Simplified Chinese', 'Traditional Chinese'],
  },
  english: {
    question: 'Would you like to focus on American English, British English, Australian English, or another variety?',
    placeholder: 'Choose the English variety...',
    options: ['American English', 'British English', 'Australian English', 'Other'],
  },
  spanish: {
    question: 'Would you like Spain Spanish, Latin American Spanish, or another variety?',
    placeholder: 'Choose the Spanish variety...',
    options: ['Spain Spanish', 'Latin American Spanish', 'Other'],
  },
  french: {
    question: 'Would you like France French, Canadian French, African French, or another variety?',
    placeholder: 'Choose the French variety...',
    options: ['France French', 'Canadian French', 'African French', 'Other'],
  },
  german: {
    question: 'Would you like Germany German, Austrian German, Swiss German, or another variety?',
    placeholder: 'Choose the German variety...',
    options: ['Germany German', 'Austrian German', 'Swiss German', 'Other'],
  },
  arabic: {
    question:
      'Would you like Modern Standard Arabic, Egyptian Arabic, Levantine Arabic, Gulf Arabic, Maghrebi Arabic, or another variety?',
    placeholder: 'Choose the Arabic variety...',
    options: ['Modern Standard Arabic', 'Egyptian Arabic', 'Levantine Arabic', 'Gulf Arabic', 'Maghrebi Arabic', 'Other'],
  },
  malay: {
    question: 'Would you like Malay from Malaysia, Indonesian, or another regional variety?',
    placeholder: 'Choose the Malay variety...',
    options: ['Malay (Malaysia)', 'Indonesian', 'Other'],
  },
  norwegian: {
    question: 'Would you like Bokmal, Nynorsk, or another variety?',
    placeholder: 'Choose the Norwegian variety...',
    options: ['Bokmal', 'Nynorsk', 'Other'],
  },
}

const languageRegionFollowUps = {
  'traditional chinese': {
    question: 'Would you like to focus on Hong Kong Chinese or Taiwan Chinese?',
    placeholder: 'Choose the regional focus...',
    options: ['Hong Kong', 'Taiwan'],
  },
  'simplified chinese': {
    question: 'Would you like to focus on Mainland China, Singapore, or Malaysia usage?',
    placeholder: 'Choose the regional focus...',
    options: ['Mainland China', 'Singapore', 'Malaysia'],
  },
}

const knownLanguages = [
  'arabic',
  'chinese',
  'english',
  'french',
  'german',
  'hindi',
  'indonesian',
  'italian',
  'japanese',
  'korean',
  'malay',
  'norwegian',
  'portuguese',
  'russian',
  'spanish',
  'thai',
  'turkish',
  'vietnamese',
]

const languageAliases = {
  brazil: 'portuguese',
  brasil: 'portuguese',
  china: 'chinese',
  hongkong: 'chinese',
  'hong kong': 'chinese',
  taiwan: 'chinese',
  england: 'english',
  britain: 'english',
  uk: 'english',
  usa: 'english',
  america: 'english',
  mexico: 'spanish',
  argentina: 'spanish',
  colombia: 'spanish',
  france: 'french',
  germany: 'german',
  austria: 'german',
  switzerland: 'german',
  malaysia: 'malay',
  indonesia: 'indonesian',
  japan: 'japanese',
  korea: 'korean',
  thailand: 'thai',
  vietnam: 'vietnamese',
  turkey: 'turkish',
  russia: 'russian',
}

const sessionStorageKey = 'bealingo-session-data'
const defaultMessages = [{ role: 'coach', text: 'Hi! What should I call you?' }]
const difficultyTooltip = 'This feedback helps BeaLingo adjust future lessons to your level.'
const MAX_EXTRA_REQUESTS_PER_DAY = 1
const MAX_EXTRA_ITEMS_PER_REQUEST = 3
const EXTRA_LEARNING_ENABLED = false
const MAX_PRACTICE_QUESTIONS = 6
const PRACTICE_CACHE_VERSION = 3
const LESSON_CACHE_VERSION = 4

function renderDifficultyButtons(itemKey, markItemDifficulty, stopPropagation = false) {
  const withStop = (handler) => (event) => {
    if (stopPropagation) event.stopPropagation()
    handler()
  }

  return (
    <>
      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too hard.`} onClick={withStop(() => markItemDifficulty(itemKey, 'hard'))}>Too hard</button>
      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Just right.`} onClick={withStop(() => markItemDifficulty(itemKey, 'just-right'))}>Just right</button>
      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too easy.`} onClick={withStop(() => markItemDifficulty(itemKey, 'easy'))}>Too easy</button>
    </>
  )
}

export default function SessionPage() {
  const [restoredSession] = useState(() => getSavedSessionData())
  const [savedProfile, setSavedProfile] = useState(() => getLearningProfile())
  const [stepIndex, setStepIndex] = useState(restoredSession.stepIndex)
  const [inputValue, setInputValue] = useState(restoredSession.inputValue)
  const [answers, setAnswers] = useState(restoredSession.answers)
  const [selectedOptions, setSelectedOptions] = useState(restoredSession.selectedOptions)
  const [pendingLanguageSuggestion, setPendingLanguageSuggestion] = useState(restoredSession.pendingLanguageSuggestion)
  const [messages, setMessages] = useState(restoredSession.messages)
  const [isCoachTyping, setIsCoachTyping] = useState(false)
  const [vocabData, setVocabData] = useState(restoredSession.vocabData)
  const [vocabSelections, setVocabSelections] = useState(() => new Set(restoredSession.vocabSelections))

  useEffect(() => {
    if (savedProfile || restoredSession.stepIndex < baseSteps.length) return
    const recoveredProfile = saveLearningProfile(restoredSession.answers)
    setSavedProfile(recoveredProfile)
  }, [restoredSession, savedProfile])

  const stepKey = baseSteps[stepIndex]
  const currentStep = getStepConfig(stepKey, answers)
  const isVocabStep = stepKey === 'vocabTest' && vocabData
  const canSubmit =
    !isCoachTyping &&
    (stepKey === 'sentenceTask'
      ? !!inputValue.trim()
      : !!currentStep &&
        (currentStep.multiSelect ? selectedOptions.length > 0 || inputValue.trim() : inputValue.trim()))
  const handleLetsGo = () => {
    const profile = saveLearningProfile(answers)
    setSavedProfile(profile)
  }

  const handleResetProfile = () => {
    clearLearningProfile()
    setSavedProfile(null)
    setStepIndex(0)
    setAnswers({})
    setSelectedOptions([])
    setPendingLanguageSuggestion(null)
    setMessages(defaultMessages)
    setVocabData(null)
    setVocabSelections(new Set())
  }

  useEffect(() => {
    if (savedProfile) return
    window.localStorage.setItem(sessionStorageKey, JSON.stringify({
      stepIndex,
      inputValue,
      answers,
      selectedOptions,
      pendingLanguageSuggestion,
      messages,
      vocabData,
      vocabSelections: [...vocabSelections],
    }))
  }, [
    answers,
    inputValue,
    messages,
    pendingLanguageSuggestion,
    savedProfile,
    selectedOptions,
    stepIndex,
    vocabData,
    vocabSelections,
  ])

  if (savedProfile) {
    return (
      <ReturningUserPlaceholder
        profile={savedProfile}
        onReset={handleResetProfile}
        onProfileChange={setSavedProfile}
      />
    )
  }

  const submitResolvedStep = (step, displayValue, canonicalValue = displayValue) => {
    const updatedAnswers =
      step.key === 'learningStyleDetails'
        ? {
            ...answers,
            styleSettings: {
              ...(answers.styleSettings || {}),
              [step.styleKey]: canonicalValue,
            },
          }
        : step.key === 'goalPrimary'
          ? {
              ...answers,
              goalPrimary: canonicalValue,
            }
          : step.key === 'learningStylePrimary'
            ? {
                ...answers,
                learningStylePrimary: canonicalValue,
              }
        : { ...answers, [step.key]: canonicalValue }
    const normalizedAnswer = Array.isArray(canonicalValue)
      ? canonicalValue.map((item) => normalizeAnswer(item))
      : normalizeAnswer(canonicalValue)

    setAnswers(updatedAnswers)
    setMessages((current) => [...current, { role: 'user', text: displayValue }])
    setInputValue('')
    setSelectedOptions([])
    setIsCoachTyping(true)

    if (step.key === 'selfLevel') {
      startVocabTest(updatedAnswers)
      return
    }

    if (step.key === 'learningStyleDetails') {
      const moreDetails = getLearningStyleAmountStep(updatedAnswers)
      if (moreDetails) {
        window.setTimeout(() => {
          setMessages((current) => [...current, { role: 'coach', text: moreDetails.question }])
          setIsCoachTyping(false)
        }, 700)
        return
      }
    }

    const nextStepKey = findNextStep(stepIndex, updatedAnswers)

    window.setTimeout(() => {
      if (!nextStepKey) {
        const profile = saveLearningProfile(updatedAnswers)
        setMessages((current) => [...current, { role: 'coach', text: 'Perfect. Your preferences are saved and your first lesson is ready.' }])
        setStepIndex(baseSteps.length)
        setIsCoachTyping(false)
        setSavedProfile(profile)
        return
      }

      const nextQuestion = getStepConfig(nextStepKey, {
        ...updatedAnswers,
        _lastAnswerNormalized: normalizedAnswer,
      }).question

      setMessages((current) => [...current, { role: 'coach', text: nextQuestion }])
      setStepIndex(baseSteps.indexOf(nextStepKey))
      setIsCoachTyping(false)
    }, 700)
  }

  const startVocabTest = async (updatedAnswers) => {
    const targetLanguage = buildLanguageSummary(updatedAnswers) || updatedAnswers.language || 'target language'
    setIsCoachTyping(true)
    try {
      const words = await fetchVocabList(targetLanguage)
      if (!Array.isArray(words) || words.length < 5) throw new Error('not enough words')
      setVocabData(words)
      setVocabSelections(new Set())
      setMessages((current) => [
        ...current,
        { role: 'coach', text: 'Let me show you some words. Tap the ones you recognise, then hit Done.' },
      ])
      setStepIndex(baseSteps.indexOf('vocabTest'))
      setIsCoachTyping(false)
    } catch {
      setMessages((current) => [
        ...current,
        { role: 'coach', text: `I couldn't load the vocab check. Let's move on.` },
      ])
      setIsCoachTyping(false)
      advanceAfterVocab(updatedAnswers)
    }
  }

  const submitVocabResult = (knownOverride = null) => {
    const total = vocabData.length
    const known = Number.isFinite(knownOverride) ? knownOverride : vocabSelections.size
    const pct = Math.round((known / total) * 100)

    let vocabLevel
    if (pct < 30) vocabLevel = 'beginner'
    else if (pct <= 70) vocabLevel = 'intermediate'
    else vocabLevel = 'advanced'

    const updatedAnswers = {
      ...answers,
      vocabScore: pct,
      vocabLevel,
    }
    setAnswers(updatedAnswers)
    setMessages((current) => [
      ...current,
      { role: 'user', text: `I know ${known} out of ${total} words (${pct}%)` },
      { role: 'coach', text: `Got it! Now write me one sentence in ${buildLanguageSummary(answers) || 'your target language'} — about anything you want.` },
    ])
    setVocabData(null)
    setStepIndex(baseSteps.indexOf('sentenceTask'))
  }

  const submitSentenceTask = async (text) => {
    const displayLanguage = buildLanguageSummary(answers) || answers.language || 'your target language'
    setIsCoachTyping(true)
    let assessment
    try {
      assessment = await assessOnboardingSentence({
        targetLanguage: displayLanguage,
        nativeLanguage: answers.nativeLanguage || 'English',
        sentence: text,
      })
    } catch {
      setMessages((current) => [
        ...current,
        { role: 'user', text },
        { role: 'coach', text: "I couldn't check that sentence just now. Please try it once more." },
      ])
      setIsCoachTyping(false)
      return
    }

    if (assessment.verdict === 'wrong_language' || assessment.verdict === 'not_meaningful') {
      setMessages((current) => [
        ...current,
        { role: 'user', text },
        { role: 'coach', text: assessment.feedback || `Please try another sentence in ${displayLanguage}.` },
      ])
      setIsCoachTyping(false)
      return
    }

    // Kept as an offline fallback path; a successful AI assessment above is authoritative.
    if (!assessment) {
    const targetLanguage = (buildLanguageSummary(answers) || answers.language || '').toLowerCase()

    const hasHan = /[\u4e00-\u9fff]/.test(text)
    const hasKana = /[\u3040-\u30ff]/.test(text)
    const hasHangul = /[\uac00-\ud7a3]/.test(text)
    const hasArabic = /[\u0600-\u06ff]/.test(text)
    const hasCyrillic = /[\u0400-\u04ff]/.test(text)
    const hasDevanagari = /[\u0900-\u097f]/.test(text)
    const hasThai = /[\u0e00-\u0e7f]/.test(text)
    const hasNonLatin = hasHan || hasKana || hasHangul || hasArabic || hasCyrillic || hasDevanagari || hasThai

    const needsNonLatin = ['chinese', 'japanese', 'korean', 'arabic', 'russian', 'hindi', 'thai'].some(
      (lang) => targetLanguage.includes(lang)
    )

    if (needsNonLatin && !hasNonLatin) {
      setMessages((current) => [
        ...current,
        { role: 'user', text },
        { role: 'coach', text: `Hmm, that looks like English. Try writing in ${buildLanguageSummary(answers) || 'your target language'} — even one word is fine!` },
      ])
      setInputValue('')
      return
    }

    const isLatin = !needsNonLatin
    if (isLatin) {
      const onlyEnglishCommon = /^[a-zA-Z\s.,!?'"()-]+$/.test(text)
      const commonEnglish = ['hello', 'hi', 'how are you', 'my name is', 'i am', 'the', 'is', 'are', 'this is']
      const looksEnglish = onlyEnglishCommon && commonEnglish.some((w) => text.toLowerCase().includes(w))
      if (looksEnglish && !['english'].some((l) => targetLanguage.includes(l))) {
        setMessages((current) => [
          ...current,
          { role: 'user', text },
          { role: 'coach', text: `That looks like English. Try writing in ${buildLanguageSummary(answers) || 'your target language'}!` },
        ])
        setInputValue('')
        return
      }
    }

    const words = text.trim().split(/\s+/).filter(Boolean)
    const wordCount = needsNonLatin ? text.replace(/\s/g, '').length : words.length

    if ((!needsNonLatin && wordCount < 2) || (needsNonLatin && wordCount < 2)) {
      setMessages((current) => [
        ...current,
        { role: 'user', text },
        { role: 'coach', text: 'Try writing a full sentence, not just a single word!' },
      ])
      setInputValue('')
      return
    }

    }

    const sentenceLevel = assessment.level || 'beginner'

    const selfLevel = answers.selfLevel || 'beginner'
    const vocabLevel = answers.vocabLevel || 'beginner'
    const scores = { beginner: 1, intermediate: 2, advanced: 3 }
    const placementScore = (
      scores[sentenceLevel] * 0.5
      + scores[vocabLevel] * 0.3
      + scores[selfLevel.toLowerCase()] * 0.2
    )
    let assessedLevel
    if (placementScore < 1.5) assessedLevel = 'Beginner'
    else if (placementScore < 2.5) assessedLevel = 'Intermediate'
    else assessedLevel = 'Advanced'

    const updatedAnswers = {
      ...answers,
      sentenceTask: text,
      sentenceLevel,
      assessedLevel,
      level: assessedLevel,
    }
    setAnswers(updatedAnswers)
    const correctionNote = assessment.verdict === 'imperfect' && assessment.correction
      ? `${assessment.feedback} A natural correction is: ${assessment.correction}`
      : assessment.feedback
    setMessages((current) => [
      ...current,
      { role: 'user', text },
      { role: 'coach', text: `${correctionNote ? `${correctionNote} ` : ''}I'll start you at ${assessedLevel}. We can always adjust as we go.` },
    ])
    setIsCoachTyping(false)
    advanceAfterVocab(updatedAnswers)
  }

  const advanceAfterVocab = (updatedAnswers) => {
    const sentenceIdx = baseSteps.indexOf('sentenceTask')
    const nextStepKey = findNextStep(sentenceIdx, updatedAnswers)
    if (!nextStepKey) {
      setMessages((current) => [...current, { role: 'coach', text: 'Perfect. I have enough to start shaping your setup.' }])
      setStepIndex(baseSteps.length)
      return
    }
    const nextQuestion = getStepConfig(nextStepKey, updatedAnswers).question
    setMessages((current) => [...current, { role: 'coach', text: nextQuestion }])
    setStepIndex(baseSteps.indexOf(nextStepKey))
  }

  const submitAnswer = (rawValue) => {
    const trimmed = rawValue.trim()

    if (stepKey === 'sentenceTask' && !isCoachTyping && trimmed) {
      setInputValue('')
      if (trimmed === "I can't write a sentence yet") {
        const updatedAnswers = {
          ...answers,
          sentenceTask: '',
          sentenceLevel: 'beginner',
          assessedLevel: 'Beginner',
          level: 'Beginner',
        }
        setAnswers(updatedAnswers)
        setMessages((current) => [
          ...current,
          { role: 'user', text: trimmed },
          { role: 'coach', text: "No worries at all! I'll start you at Beginner. We can always adjust as we go." },
        ])
        advanceAfterVocab(updatedAnswers)
        return
      }
      submitSentenceTask(trimmed)
      return
    }

    if (!currentStep || isCoachTyping) return

    if (currentStep.key === 'language' && pendingLanguageSuggestion) {
      const normalizedReply = normalizeAnswer(trimmed)

      if (['yes', 'yeah', 'y', 'correct'].includes(normalizedReply)) {
        setPendingLanguageSuggestion(null)
        submitResolvedStep(currentStep, pendingLanguageSuggestion.label, pendingLanguageSuggestion.canonical)
        return
      }

      if (['no', 'n', 'nope'].includes(normalizedReply)) {
        setMessages((current) => [
          ...current,
          { role: 'user', text: trimmed },
          { role: 'coach', text: 'No problem. Please enter the language you wish to learn.' },
        ])
        setInputValue('')
        setPendingLanguageSuggestion(null)
        return
      }

      setMessages((current) => [
        ...current,
        { role: 'user', text: trimmed },
        { role: 'coach', text: `Please answer yes or no. Did you mean ${pendingLanguageSuggestion.label}?` },
      ])
      setInputValue('')
      return
    }

    if (currentStep.key === 'language') {
      const resolution = resolveLanguageInput(trimmed)

      if (resolution.status === 'invalid') {
        setMessages((current) => [
          ...current,
          { role: 'user', text: trimmed },
          { role: 'coach', text: 'Please enter the language you wish to learn.' },
        ])
        setInputValue('')
        return
      }

      if (resolution.status === 'suggest') {
        setMessages((current) => [
          ...current,
          { role: 'user', text: trimmed },
          { role: 'coach', text: `Do you mean ${resolution.label}?` },
        ])
        setInputValue('')
        setPendingLanguageSuggestion({
          canonical: resolution.canonical,
          label: resolution.label,
        })
        return
      }

      setPendingLanguageSuggestion(null)
      submitResolvedStep(currentStep, resolution.label, resolution.canonical)
      return
    }

    if (currentStep.multiSelect) {
      const mergedSelections = mergeSelections(currentStep.options || [], selectedOptions, trimmed)

      if (mergedSelections.length === 0) {
        return
      }

      submitResolvedStep(currentStep, mergedSelections.join(', '), mergedSelections)
      return
    }

    if (!trimmed) return

    submitResolvedStep(currentStep, trimmed)
  }

  const handleEditChanges = () => {
    setStepIndex(0)
    setInputValue('')
    setSelectedOptions([])
    setPendingLanguageSuggestion(null)
    setIsCoachTyping(false)
    setAnswers({})
    setVocabData(null)
    setVocabSelections(new Set())
    setMessages([{ role: 'coach', text: "Of course. Let us start over. What should I call you?" }])
  }

  const handleBack = () => {
    if (isCoachTyping || stepIndex <= 0) return

    let previousIndex = stepIndex - 1
    while (previousIndex > 0) {
      const previousKey = baseSteps[previousIndex]
      if (previousKey === 'languageVariant' && !languageFollowUps[normalizeAnswer(answers.language || '')]) {
        previousIndex -= 1
        continue
      }
      if (previousKey === 'languageRegion' && !languageRegionFollowUps[normalizeAnswer(answers.languageVariant || '')]) {
        previousIndex -= 1
        continue
      }
      break
    }

    const previousKey = baseSteps[previousIndex]
    const previousQuestion = getStepConfig(previousKey, answers)?.question || defaultMessages[0].text
    const nextAnswers = { ...answers }
    delete nextAnswers[previousKey]
    if (previousKey === 'vocabTest') {
      delete nextAnswers.vocabScore
      delete nextAnswers.vocabLevel
    }
    if (previousKey === 'sentenceTask') {
      delete nextAnswers.sentenceTask
      delete nextAnswers.sentenceLevel
      delete nextAnswers.assessedLevel
      delete nextAnswers.level
    }

    setAnswers(nextAnswers)
    setStepIndex(previousIndex)
    setInputValue('')
    setSelectedOptions([])
    setPendingLanguageSuggestion(null)
    setVocabData(null)
    setVocabSelections(new Set())
    setMessages((current) => [...current, { role: 'coach', text: `Let’s go back. ${previousQuestion}` }])

    if (previousKey === 'vocabTest') {
      startVocabTest(nextAnswers)
    }
  }

  return (
    <section className="session-page">
      <div className="session-header">
        <div>
          <span className="section-tag">Session</span>
          <h1 className="session-title">Tell your coach how you learn best.</h1>
          <p className="session-description">
            BeaLingo should guide this one step at a time and quietly build your learning profile in the background.
          </p>
        </div>
      </div>

      <section className="session-card setup-card">
        <div className="card-heading">
          <span className="section-tag">Setup chat</span>
          <h2>Start your first conversation with BeaLingo.</h2>
          <div className="setup-progress" aria-label={`Setup progress: step ${Math.min(stepIndex + 1, baseSteps.length)} of ${baseSteps.length}`}>
            <span>Step {Math.min(stepIndex + 1, baseSteps.length)} of {baseSteps.length}</span>
            <progress value={Math.min(stepIndex + 1, baseSteps.length)} max={baseSteps.length} />
          </div>
        </div>

        <div className="chat-thread setup-thread">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
              {message.text}
            </div>
          ))}

          {isCoachTyping && (
            <div className="chat-bubble coach typing-bubble" aria-label="BeaLingo is thinking">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        {isVocabStep && !isCoachTyping && (
          <div className="vocab-test-area">
            <div className="option-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              {vocabData.map((word, i) => (
                <button
                  key={i}
                  type="button"
                  className={`option-chip ${vocabSelections.has(i) ? 'selected' : ''}`}
                  onClick={() => {
                    setVocabSelections((prev) => {
                      const next = new Set(prev)
                      if (next.has(i)) next.delete(i)
                      else next.add(i)
                      return next
                    })
                  }}
                >
                  {word.word}
                </button>
              ))}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                className="primary-button"
                onClick={() => submitVocabResult()}
              >
                Done
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setVocabSelections(new Set())
                  submitVocabResult(0)
                }}
              >
                I don&apos;t know any
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setVocabSelections(new Set(vocabData.map((_, index) => index)))
                  submitVocabResult(vocabData.length)
                }}
              >
                I know it all
              </button>
            </div>
          </div>
        )}

        {currentStep?.options && !isCoachTyping && !isVocabStep && (
          <div className="option-row">
            {currentStep.options.map((option) => (
              <button
                key={option}
                type="button"
                className={`option-chip ${currentStep.multiSelect && selectedOptions.includes(option) ? 'selected' : ''}`}
                onClick={() => {
                  if (currentStep.multiSelect) {
                    setSelectedOptions((current) =>
                      current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
                    )
                    return
                  }

                  submitAnswer(option)
                }}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {pendingLanguageSuggestion && !isCoachTyping && (
          <div className="option-row">
            <button type="button" className="option-chip" onClick={() => submitAnswer('yes')}>
              Yes
            </button>
            <button type="button" className="option-chip" onClick={() => submitAnswer('no')}>
              No
            </button>
          </div>
        )}

        <div className="chat-input-shell">
          {stepIndex > 0 && (
            <button type="button" className="secondary-button setup-back-button" onClick={handleBack} disabled={isCoachTyping}>
              Back
            </button>
          )}
          <div className="chat-input-row">
            <input
              className="chat-input"
              type="text"
              value={inputValue}
              placeholder={
                stepKey === 'sentenceTask'
                  ? 'Write a sentence...'
                  : currentStep
                    ? currentStep.placeholder
                    : 'Setup complete for now.'
              }
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitAnswer(inputValue)
              }}
              disabled={(!currentStep && stepKey !== 'sentenceTask') || isVocabStep || isCoachTyping}
            />
            <button
              type="button"
              className="primary-button send-button"
              onClick={() => submitAnswer(inputValue)}
              disabled={!canSubmit}
            >
              Send
            </button>
          </div>
        </div>

        {!currentStep && !isCoachTyping && !isVocabStep && stepKey !== 'sentenceTask' && (
          <section className="summary-card">
            <div className="card-heading">
              <span className="section-tag">Coach summary</span>
              <h3>Here&apos;s what I learned about you.</h3>
            </div>

            <div className="summary-grid">
              <div className="summary-item">
                <span>Language</span>
                <strong>{buildLanguageSummary(answers)}</strong>
              </div>
<div className="summary-item">
                <span>Level</span>
                <strong>{answers.assessedLevel || sentenceCase(answers.selfLevel)}</strong>
              </div>
              {answers.name && (
                <div className="summary-item">
                  <span>Name</span>
                  <strong>{answers.name}</strong>
                </div>
              )}
              {answers.interests && (
                <div className="summary-item">
                  <span>Interests</span>
                  <strong>{joinAnswerList(answers.interests)}</strong>
                </div>
              )}
              {answers.motivation && (
                <div className="summary-item">
                  <span>Motivation</span>
                  <strong>{answers.motivation}</strong>
                </div>
              )}
              {answers.correctionStyle && (
                <div className="summary-item">
                  <span>Correction style</span>
                  <strong>{answers.correctionStyle}</strong>
                </div>
              )}
              <div className="summary-item">
                <span>Goals</span>
                <strong>{joinAnswerList(answers.goal)}</strong>
              </div>
              <div className="summary-item">
                <span>Learning styles</span>
                <strong>{joinAnswerList(answers.learningStyle)}</strong>
              </div>
              <div className="summary-item">
                <span>Schedule</span>
                <strong>{answers.schedule}</strong>
              </div>
              <div className="summary-item">
                <span>Quiz rhythm</span>
                <strong>{answers.quizFrequency}</strong>
              </div>
            </div>

            <div className="summary-actions">
              <button type="button" className="primary-button" onClick={handleLetsGo}>
                Let&apos;s go
              </button>
              <button type="button" className="secondary-button" onClick={handleEditChanges}>
                Start again
              </button>
            </div>
          </section>
        )}
      </section>
    </section>
  )
}

function ReturningUserPlaceholder({ profile, onReset, onProfileChange }) {
  return <DailySession profile={profile} onReset={onReset} onProfileChange={onProfileChange} />
}

function DailySession({ profile, onReset, onProfileChange }) {
  const languageLabel = formatLanguageLabel(profile)
  const completedSessionCount = getCompletedSessionCount(profile)
  const todayKey = getTodayKey()
  const completedToday = isSameStudyDate(profile.lastCompletedAt, todayKey)
  const dayNumber = computeDayNumber(profile, todayKey)
  const sessionCompleted = completedToday || isSessionComplete(profile, dayNumber)
  const isDayOne = dayNumber === 1
  const [sessionPlan] = useState(() => ({
    learningStyle: Array.isArray(profile.learningStyle)
      ? profile.learningStyle
      : [profile.learningStylePrimary || profile.primaryStyle || 'daily sentences'],
    styleSettings: profile.styleSettings || {},
    schedule: profile.schedule,
  }))
  const allStyles = sessionPlan.learningStyle
  const todayStyleIndex = (dayNumber - 1) % allStyles.length
  const currentStyleName = allStyles[todayStyleIndex] || 'Daily sentences'
  const primaryStyle = currentStyleName.toLowerCase()
  const desiredCount = getDesiredCountForStyle({ ...profile, styleSettings: sessionPlan.styleSettings }, currentStyleName)
  const sessionKey = `bealingo-daily-day-${dayNumber}-v${LESSON_CACHE_VERSION}`
  const extraSessionKey = `bealingo-daily-extra-day-${dayNumber}`
  const practiceSessionKey = `bealingo-daily-practice-day-${dayNumber}-v${PRACTICE_CACHE_VERSION}`
  const extraUsageKey = `bealingo-extra-usage-${todayKey}`
  const completionBadgeKey = `bealingo-completed-badge-${todayKey}`
  const scheduleAllowsNewLesson = isScheduledStudyDay(sessionPlan.schedule, new Date())

  const [lesson, setLesson] = useState(() => {
    try {
      const raw = window.localStorage.getItem(sessionKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed && parsed.content) return parsed
      window.localStorage.removeItem(sessionKey)
      return null
    } catch {
      return null
    }
  })
  const [lessonError, setLessonError] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [flippedCards, setFlippedCards] = useState(new Set())

  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([
    { role: 'coach', text: "Ask me anything about today's lesson." },
  ])
  const [isCoachThinking, setIsCoachThinking] = useState(false)
  const [extraMaterials, setExtraMaterials] = useState(() => {
    if (!EXTRA_LEARNING_ENABLED) return []
    try {
      const raw = window.localStorage.getItem(extraSessionKey)
      return raw ? removeDuplicateExtraMaterials(JSON.parse(raw), lesson?.content) : []
    } catch {
      return []
    }
  })

  const [revisionCards] = useState(() => completedSessionCount === 0 ? [] : pickRevisionCards(6))
  const [revisionIndex, setRevisionIndex] = useState(0)
  const [revisionDone, setRevisionDone] = useState(completedSessionCount === 0 || sessionCompleted)
  const [revisionFlipped, setRevisionFlipped] = useState(false)

  const [itemFeedback, setItemFeedback] = useState({})
  const [quizState, setQuizState] = useState({})
  const [quizInputs, setQuizInputs] = useState({})
  const [practiceQuestions, setPracticeQuestions] = useState(() => {
    try {
      const raw = window.localStorage.getItem(practiceSessionKey)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [practiceVisible, setPracticeVisible] = useState(false)
  const [isPracticeLoading, setIsPracticeLoading] = useState(false)
  const [practiceError, setPracticeError] = useState(null)
  const [practiceQuizState, setPracticeQuizState] = useState({})
  const [practiceQuizInputs, setPracticeQuizInputs] = useState({})
  const [extraUsageCount, setExtraUsageCount] = useState(() => {
    try {
      return parseInt(window.localStorage.getItem(extraUsageKey) || '0', 10) || 0
    } catch {
      return 0
    }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [editGoals, setEditGoals] = useState(Array.isArray(profile.goal) ? profile.goal : [])
  const [editStyles, setEditStyles] = useState(Array.isArray(profile.learningStyle) ? profile.learningStyle : [])
  const [editStyleSettings, setEditStyleSettings] = useState(profile.styleSettings || {})
  const [allowExtraLesson, setAllowExtraLesson] = useState(false)
  const [justCompleted, setJustCompleted] = useState(() => {
    try {
      return window.localStorage.getItem(completionBadgeKey) === '1' || sessionCompleted
    } catch {
      return sessionCompleted
    }
  })

  useEffect(() => {
    recordLoginDay()
  }, [])

  useEffect(() => {
    if (!EXTRA_LEARNING_ENABLED) {
      window.localStorage.removeItem(extraSessionKey)
      return
    }
    window.localStorage.setItem(extraSessionKey, JSON.stringify(extraMaterials))
  }, [extraMaterials, extraSessionKey])

  useEffect(() => {
    window.localStorage.setItem(practiceSessionKey, JSON.stringify(practiceQuestions))
  }, [practiceQuestions, practiceSessionKey])

  useEffect(() => {
    window.localStorage.setItem(extraUsageKey, String(extraUsageCount))
  }, [extraUsageCount, extraUsageKey])

  useEffect(() => {
    if (justCompleted || sessionCompleted) {
      window.localStorage.setItem(completionBadgeKey, '1')
    } else {
      window.localStorage.removeItem(completionBadgeKey)
    }
  }, [completionBadgeKey, justCompleted, sessionCompleted])

  const hasStartedLesson = !!lesson
  // A learner should always receive the first lesson immediately after setup.
  // Their chosen schedule controls later study days, not the onboarding payoff.
  const canLoadLesson = completedSessionCount === 0
    || sessionCompleted
    || hasStartedLesson
    || scheduleAllowsNewLesson
    || allowExtraLesson
  const practiceSourceContent = buildPracticeSourceContent(
    lesson?.content || {},
    EXTRA_LEARNING_ENABLED ? extraMaterials : [],
  )

  useEffect(() => {
    if (lesson || !canLoadLesson || sessionCompleted) return
    let cancelled = false
    setIsLoading(true)
    setLessonError(null)
    generateLesson(profile, primaryStyle, desiredCount)
      .then((result) => {
        if (cancelled) return
        setLesson(result)
        setIsLoading(false)
        window.localStorage.setItem(sessionKey, JSON.stringify(result))
        const items = extractItemsFromLesson(result.content || result)
        if (items.length > 0) addItemsToPile(items)
      })
      .catch((error) => {
        if (cancelled) return
        setLessonError(error.message)
        setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [canLoadLesson, lesson, profile, primaryStyle, desiredCount, sessionCompleted, sessionKey])

  const markItemDifficulty = (index, rating) => {
    setItemFeedback((current) => ({ ...current, [index]: rating }))
  }

  const advanceRevision = () => {
    setRevisionFlipped(false)
    if (revisionIndex + 1 >= revisionCards.length) {
      setRevisionDone(true)
    } else {
      setRevisionIndex(revisionIndex + 1)
    }
  }

  const handleAsk = async (prefilledText = '') => {
    const text = (typeof prefilledText === 'string' && prefilledText ? prefilledText : chatInput).trim()
    if (!text || isCoachThinking) return
    setChatMessages((prev) => [...prev, { role: 'user', text }])
    setChatInput('')
    setIsCoachThinking(true)

      const extraRequest = parseExtraPracticeRequest(text)
    try {
      if (extraRequest) {
        if (!EXTRA_LEARNING_ENABLED) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: 'coach',
              text: 'BeaLingo includes one learning session per day. Come back on your next study day for new material.',
            },
          ])
          return
        }
        if (extraUsageCount >= MAX_EXTRA_REQUESTS_PER_DAY) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: 'coach',
              text: `You’ve reached today’s extra practice limit. I can still help explain the lesson, but I won’t generate more extra sets until your next study day.`,
            },
          ])
          return
        }
        const excludeItems = collectTaughtItems(lesson?.content, extraMaterials)
        const result = await generateLesson(
          { ...profile, excludeItems },
          extraRequest.style,
          extraRequest.count,
        )
        const extraContent = trimGeneratedContent(result?.content || {}, extraRequest.style, extraRequest.count)
        const items = extractItemsFromLesson(extraContent)
        if (items.length > 0) addItemsToPile(items)

        setExtraMaterials((current) => [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: extraRequest.label,
            count: extraRequest.count,
            style: extraRequest.style,
            content: extraContent,
          },
        ])
        setExtraUsageCount((current) => current + 1)
        setPracticeQuestions([])
        setPracticeVisible(false)
        setPracticeError(null)
        setPracticeQuizInputs({})
        setPracticeQuizState({})
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'coach',
            text: `I added ${extraRequest.label.toLowerCase()}. It will not change your normal lesson plan, and I saved the new items to your knowledge pile too.`,
          },
        ])
        return
      }

      const historyForGroq = chatMessages.slice(1)
      const reply = await askCoach({
        profile,
        sentences: [
          ...(lesson?.content?.sentences || lesson?.content?.flashcards || []),
          ...extraMaterials.flatMap((extra) => extra.content?.sentences || extra.content?.flashcards || []),
        ],
        history: historyForGroq,
        userMessage: text,
      })
      setChatMessages((prev) => [...prev, { role: 'coach', text: reply }])
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'coach', text: `Something went wrong: ${error.message}` },
      ])
    } finally {
      setIsCoachThinking(false)
    }
  }

  const handleRegenerate = () => {
    window.localStorage.removeItem(sessionKey)
    window.localStorage.removeItem(extraSessionKey)
    window.localStorage.removeItem(practiceSessionKey)
    setLesson(null)
    setLessonError(null)
    setFlippedCards(new Set())
    setExtraMaterials([])
    setPracticeQuestions([])
    setPracticeVisible(false)
    setPracticeError(null)
    setPracticeQuizInputs({})
    setPracticeQuizState({})
  }

  const handleCompleteSession = () => {
    if (sessionCompleted || justCompleted) return
    const feedbackSummary = evaluateLessonFeedback(itemFeedback, profile.level, todayKey)
    const latestProfile = getLearningProfile() || profile
    const updatedProfile = {
      ...latestProfile,
      level: feedbackSummary.nextLevel,
      assessedLevel: feedbackSummary.nextLevel,
      lastBatchFeedbackSummary: feedbackSummary,
    }
    const completedProfile = markSessionComplete(updatedProfile, dayNumber)
    onProfileChange?.(completedProfile)
    setRevisionDone(true)
    setJustCompleted(true)
  }

  const handlePracticeToggle = async () => {
    if (practiceVisible) {
      setPracticeVisible(false)
      return
    }

    if (practiceQuestions.length > 0) {
      setPracticeVisible(true)
      return
    }

    if (!lesson?.content || isPracticeLoading) return

    setIsPracticeLoading(true)
    setPracticeError(null)
    try {
      const count = getPracticeQuestionCount(practiceSourceContent, desiredCount)
      const questions = await generatePracticeSession(profile, practiceSourceContent, count)
      setPracticeQuestions(questions.slice(0, count))
      setPracticeVisible(true)
    } catch (error) {
      setPracticeError(error.message)
    } finally {
      setIsPracticeLoading(false)
    }
  }

  const content = lesson?.content || {}
  const batchFeedbackSummary = isSameStudyDate(profile?.lastBatchFeedbackSummary?.date, todayKey)
    ? profile.lastBatchFeedbackSummary
    : null
  const styleLabel = primaryStyle.includes('flashcard') ? 'flashcards'
    : primaryStyle.includes('conversation') ? 'conversation'
    : primaryStyle.includes('quiz') ? 'quiz'
    : 'sentences'

  return (
    <section className="session-page">
      <div className="session-header daily-header">
        <span className="section-tag">Day {dayNumber}</span>
        <h1 className="session-title">
          {isDayOne
            ? `Your first ${languageLabel} ${styleLabel}.`
            : `Today's ${languageLabel} lesson.`}
        </h1>
        <p className="session-description">
          {isDayOne
            ? 'No revision yet — that starts after you complete your first lesson. Read through, and ask your coach anything below.'
            : sessionCompleted
              ? 'You already finished today’s lesson. Your next one will unlock on your next eligible study day.'
              : scheduleAllowsNewLesson || hasStartedLesson || allowExtraLesson
                ? 'Revision and new material are ready. Ask your coach anything below.'
                : `Today is outside your ${String(profile.schedule || 'saved').toLowerCase()} schedule, so no new lesson is loaded unless you ask for one.`}
        </p>
      </div>

      {!sessionCompleted && !hasStartedLesson && !scheduleAllowsNewLesson && !allowExtraLesson && (
        <section className="session-card revision-card">
          <div className="card-heading">
            <span className="section-tag">Off schedule</span>
            <h2>No new lesson is scheduled for today.</h2>
          </div>
          <p className="plan-detail">
            Your preference is <strong>{sessionPlan.schedule || 'Every day'}</strong>. BeaLingo will wait until your next scheduled study day before creating a new lesson.
          </p>
          <div className="summary-actions">
            <button type="button" className="secondary-button" onClick={() => setAllowExtraLesson(true)}>
              Give me a lesson anyway
            </button>
          </div>
        </section>
      )}

      {sessionCompleted && !lesson && (
        <section className="session-card revision-card">
          <div className="card-heading">
            <span className="section-tag">Done for today</span>
            <h2>You finished this lesson.</h2>
          </div>
          <p className="plan-detail">
            BeaLingo recorded your progress. Your next lesson will appear the next time you log in on an eligible study day.
          </p>
          {batchFeedbackSummary && (
            <p className="plan-detail">
              {batchFeedbackSummary.message}
            </p>
          )}
        </section>
      )}

      {!sessionCompleted && completedSessionCount > 0 && !revisionDone && revisionCards.length > 0 && (
        <section className="session-card revision-card">
          <div className="card-heading">
            <span className="section-tag">Revision</span>
            <h2>Quick review before today&apos;s lesson ({revisionIndex + 1}/{revisionCards.length})</h2>
          </div>

          {(() => {
            const card = revisionCards[revisionIndex]
            if (!card) return null
            return (
              <div className="revision-flashcard-area">
                <button
                  type="button"
                  className={`flashcard revision-fc ${revisionFlipped ? 'flipped' : ''}`}
                  onClick={() => setRevisionFlipped(!revisionFlipped)}
                  style={{ width: '100%', maxWidth: '480px', margin: '0 auto' }}
                >
                  <div className="flashcard-front">
                    <p className="flashcard-word">{card.front}</p>
                    <span className="flashcard-hint">tap to reveal</span>
                  </div>
                  <div className="flashcard-back">
                    <p className="flashcard-translation">{card.back}</p>
                    {card.note && <p className="flashcard-note">{card.note}</p>}
                    {card.exampleTarget && (
                      <div className="flashcard-example">
                        <p>{card.exampleTarget}</p>
                        <p className="flashcard-example-source">{card.exampleSource}</p>
                      </div>
                    )}
                  </div>
                </button>

                {revisionFlipped && (
                  <div className="revision-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        markCardUnknown(card.id)
                        advanceRevision()
                      }}
                    >
                      Needs review
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        markCardFamiliar(card.id)
                        advanceRevision()
                      }}
                    >
                      Familiar
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        markCardKnown(card.id)
                        advanceRevision()
                      }}
                    >
                      Mastered
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
        </section>
      )}

      {!sessionCompleted && completedSessionCount > 0 && revisionDone && revisionCards.length > 0 && (
        <section className="session-card revision-card">
          <div className="card-heading">
            <span className="section-tag">Revision complete</span>
            <h2>Nice! Here&apos;s today&apos;s new lesson.</h2>
          </div>
        </section>
      )}

      {(lesson || (!sessionCompleted && canLoadLesson)) && (completedSessionCount === 0 || revisionDone || revisionCards.length === 0 || sessionCompleted) && (
      <section className="session-card sentences-card">
        <div className="card-heading">
          <span className="section-tag">New today</span>
          <h2>
            {isLoading && !lesson
              ? `Preparing your ${styleLabel}...`
              : lessonError
                ? 'Something went wrong.'
                : `${styleLabel.charAt(0).toUpperCase() + styleLabel.slice(1)} to learn`}
          </h2>
        </div>

        {!isLoading && !lessonError && (
          <p className="feedback-help">
            Why these buttons? `Too hard`, `Just right`, and `Too easy` help BeaLingo adjust future lessons to your level.
          </p>
        )}

        {isLoading && (
          <div className="lesson-loading-state" role="status" aria-live="polite">
            <p className="plan-detail">Your coach is writing fresh {languageLabel} content for you...</p>
            <span className="lesson-loading" aria-label="Loading lesson">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </span>
          </div>
        )}

        {lessonError && (
          <div className="sentence-error">
            <p className="plan-detail">{lessonError}</p>
            <button type="button" className="secondary-button" onClick={handleRegenerate}>
              Try again
            </button>
          </div>
        )}

        {!practiceVisible && content.sentences && (
          <ol className="sentence-list">
            {content.sentences.map((sentence, index) => (
              <li key={`s-${index}`} className="sentence-card">
                <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="sentence-row">
                  <span className="sentence-label">Source</span>
                  <p className="sentence-source">{sentence.source}</p>
                </div>
                <div className="sentence-row">
                  <span className="sentence-label">Target</span>
                  <p className="sentence-target">{sentence.target}</p>
                </div>
                <div className="sentence-row">
                  <span className="sentence-label">Meaning</span>
                  <p className="sentence-meaning">{sentence.meaning}</p>
                </div>
                <div className="sentence-row example">
                  <span className="sentence-label">Example</span>
                  <p className="sentence-example-target">{sentence.exampleTarget}</p>
                  <p className="sentence-example-source">{sentence.exampleSource}</p>
                </div>
                <div className="item-feedback">
                  {itemFeedback[`s-${index}`] ? (
                    <span className="feedback-done">Marked: {itemFeedback[`s-${index}`]}</span>
                  ) : (
                    <>
                      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too hard.`} onClick={() => markItemDifficulty(`s-${index}`, 'hard')}>Too hard</button>
                      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Just right.`} onClick={() => markItemDifficulty(`s-${index}`, 'just-right')}>Just right</button>
                      <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too easy.`} onClick={() => markItemDifficulty(`s-${index}`, 'easy')}>Too easy</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Flashcards */}
        {!practiceVisible && content.flashcards && (
          <div className="flashcard-grid">
            {content.flashcards.map((card, index) => {
              const isFlipped = flippedCards.has(index)
              return (
                <button
                  key={`fc-${index}`}
                  type="button"
                  className={`flashcard ${isFlipped ? 'flipped' : ''}`}
                  onClick={() => setFlippedCards((prev) => {
                    const next = new Set(prev)
                    if (next.has(index)) next.delete(index)
                    else next.add(index)
                    return next
                  })}
                >
                  <div className="flashcard-front">
                    <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                    <p className="flashcard-word">{card.front}</p>
                    <span className="flashcard-hint">tap to flip</span>
                  </div>
                  <div className="flashcard-back">
                    <p className="flashcard-translation">{card.back}</p>
                    {card.note && <p className="flashcard-note">{card.note}</p>}
                    {card.exampleTarget && (
                      <div className="flashcard-example">
                        <p>{card.exampleTarget}</p>
                        <p className="flashcard-example-source">{card.exampleSource}</p>
                      </div>
                    )}
                    {isFlipped && (
                      <div className="item-feedback">
                        {itemFeedback[`fc-${index}`] ? (
                          <span className="feedback-done">Marked: {itemFeedback[`fc-${index}`]}</span>
                        ) : (
                          <>
                            <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too hard.`} onClick={(e) => { e.stopPropagation(); markItemDifficulty(`fc-${index}`, 'hard') }}>Too hard</button>
                            <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Just right.`} onClick={(e) => { e.stopPropagation(); markItemDifficulty(`fc-${index}`, 'just-right') }}>Just right</button>
                            <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too easy.`} onClick={(e) => { e.stopPropagation(); markItemDifficulty(`fc-${index}`, 'easy') }}>Too easy</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Conversation scenario */}
        {!practiceVisible && content.scenario && (
          <div className="conversation-scenario">
            <p className="scenario-setup">{content.scenario.setup}</p>
            <div className="scenario-exchanges">
              {(content.scenario.exchanges || []).map((ex, index) => (
                <div key={`ex-${index}`} className="scenario-exchange">
                  <span className="scenario-speaker">{ex.speaker}</span>
                  <p className="scenario-line-target">{ex.lineTarget}</p>
                  <p className="scenario-line-source">{ex.lineSource}</p>
                  {ex.note && <p className="scenario-note">{ex.note}</p>}
                  <div className="item-feedback">
                    {itemFeedback[`ex-${index}`] ? (
                      <span className="feedback-done">Marked: {itemFeedback[`ex-${index}`]}</span>
                    ) : (
                      <>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too hard.`} onClick={() => markItemDifficulty(`ex-${index}`, 'hard')}>Too hard</button>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Just right.`} onClick={() => markItemDifficulty(`ex-${index}`, 'just-right')}>Just right</button>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too easy.`} onClick={() => markItemDifficulty(`ex-${index}`, 'easy')}>Too easy</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quiz */}
        {!practiceVisible && content.questions && (
          <ol className="sentence-list">
            {content.questions.map((q, index) => {
              const state = quizState[index] || 'unanswered'
              const userAnswer = quizInputs[index] || ''
              const isCorrect = state === 'answered' && userAnswer.trim().toLowerCase() === (q.answer || '').trim().toLowerCase()
              const hasOptions = Array.isArray(q.options) && q.options.length > 0

              const submitQuizAnswer = (answer) => {
                setQuizInputs((prev) => ({ ...prev, [index]: answer }))
                setQuizState((prev) => ({ ...prev, [index]: 'answered' }))
              }

              return (
                <li key={`q-${index}`} className="sentence-card">
                  <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="sentence-row">
                    <span className="sentence-label">Question</span>
                    <p className="sentence-source">{q.prompt}</p>
                  </div>

                  {state === 'unanswered' && (
                    <>
                      <div className="item-feedback" style={{ marginTop: '8px', borderTop: 'none', paddingTop: '0' }}>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too hard.`} onClick={() => markItemDifficulty(`q-${index}`, 'hard')}>Too hard</button>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Just right.`} onClick={() => markItemDifficulty(`q-${index}`, 'just-right')}>Just right</button>
                        <button type="button" className="feedback-btn" aria-label={`${difficultyTooltip} Too easy.`} onClick={() => markItemDifficulty(`q-${index}`, 'easy')}>Too easy</button>
                        <button type="button" className="feedback-btn" onClick={() => {
                          setQuizState((prev) => ({ ...prev, [index]: 'answered' }))
                          setQuizInputs((prev) => ({ ...prev, [index]: '' }))
                        }}>I don&apos;t know</button>
                      </div>

                      {hasOptions ? (
                        <div className="quiz-options" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              className="option-chip"
                              onClick={() => submitQuizAnswer(opt)}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="quiz-input" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <input
                            className="chat-input"
                            type="text"
                            value={userAnswer}
                            placeholder="Type your answer..."
                            onChange={(e) => setQuizInputs((prev) => ({ ...prev, [index]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && userAnswer.trim()) submitQuizAnswer(userAnswer.trim())
                            }}
                          />
                          <button
                            type="button"
                            className="primary-button send-button"
                            disabled={!userAnswer.trim()}
                            onClick={() => submitQuizAnswer(userAnswer.trim())}
                          >
                            Submit
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {state === 'answered' && (
                    <div style={{ marginTop: '12px' }}>
                      {userAnswer ? (
                        <div className="sentence-row">
                          <span className="sentence-label">Your answer</span>
                          <p style={{ fontWeight: 600, color: isCorrect ? '#22c55e' : '#ef4444' }}>
                            {userAnswer} {isCorrect ? ' — Correct!' : ' — Not quite'}
                          </p>
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Skipped</p>
                      )}
                      <div className="sentence-row">
                        <span className="sentence-label">Correct answer</span>
                        <p className="sentence-target">{q.answer}</p>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {EXTRA_LEARNING_ENABLED && !practiceVisible && extraMaterials.length > 0 && (
          <div className="extra-materials-stack">
            {extraMaterials.map((extra, extraIndex) => (
              <section key={extra.id} className="session-card extra-material-card">
                <div className="card-heading">
                  <span className="section-tag">Learn more</span>
                  <h3>{extra.label}</h3>
                </div>
                {renderExtraMaterialContent(
                  extra,
                  extraIndex,
                  flippedCards,
                  setFlippedCards,
                  itemFeedback,
                  markItemDifficulty,
                  quizState,
                  setQuizState,
                  quizInputs,
                  setQuizInputs,
                )}
              </section>
            ))}
          </div>
        )}

        {EXTRA_LEARNING_ENABLED && !isLoading && !lessonError && lesson && (
          <section className="learn-more-card">
            <div className="card-heading">
              <span className="section-tag">Learn more</span>
              <h3>Want extra material today?</h3>
            </div>
            <p className="plan-detail">
              Ask for more flashcards, sentences, quizzes, or conversation practice.
            </p>
            <p className="learn-more-note">
              Limit: up to {MAX_EXTRA_REQUESTS_PER_DAY} extra requests per study day, with up to {MAX_EXTRA_ITEMS_PER_REQUEST} items each.
            </p>
            {extraUsageCount >= MAX_EXTRA_REQUESTS_PER_DAY && (
              <p className="learn-more-note" role="status">
                You’ve used today’s extra material. Another Learn more batch will be available on your next study day.
              </p>
            )}
            <div className="summary-actions">
              <button
                type="button"
                className="secondary-button"
                title={`You can ask for extra practice up to ${MAX_EXTRA_REQUESTS_PER_DAY} times per study day, with up to ${MAX_EXTRA_ITEMS_PER_REQUEST} items each.`}
                onClick={() => handleAsk(`3 more ${styleLabel}`)}
                disabled={isCoachThinking || extraUsageCount >= MAX_EXTRA_REQUESTS_PER_DAY}
              >
                {isCoachThinking
                  ? 'Adding...'
                  : extraUsageCount >= MAX_EXTRA_REQUESTS_PER_DAY
                    ? 'Daily extra used'
                    : 'Learn more'}
              </button>
            </div>
          </section>
        )}

        {!isLoading && !lessonError && lesson && (
          <section className="practice-launch-card">
            <div className="card-heading">
              <span className="section-tag">Practice</span>
              <h3>Practice what you learnt today</h3>
            </div>
            <p className="plan-detail">
              Open a short review round based on today&apos;s lesson. While practice is open, the teaching material will be hidden.
            </p>
            <div className="summary-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={handlePracticeToggle}
                disabled={isPracticeLoading}
              >
                {practiceVisible ? 'Back to lesson' : isPracticeLoading ? 'Preparing practice...' : 'Reveal practice'}
              </button>
            </div>
            {practiceError && <p className="plan-detail">{practiceError}</p>}
          </section>
        )}

        {practiceVisible && (
          <section className="session-card practice-session-card">
            <div className="card-heading">
              <span className="section-tag">Practice</span>
              <h3>Use what you learnt today</h3>
            </div>

            {practiceQuestions.length > 0 ? (
              <ol className="sentence-list">
                {practiceQuestions.map((question, index) => {
                  const state = practiceQuizState[index] || 'unanswered'
                  const userAnswer = practiceQuizInputs[index] || ''
                  const hasOptions = Array.isArray(question.options) && question.options.length > 0
                  const isCorrect =
                    state === 'answered' && userAnswer.trim().toLowerCase() === (question.answer || '').trim().toLowerCase()

                  const submitPracticeAnswer = (answer) => {
                    setPracticeQuizInputs((prev) => ({ ...prev, [index]: answer }))
                    setPracticeQuizState((prev) => ({ ...prev, [index]: 'answered' }))
                  }

                  return (
                    <li key={`practice-${index}`} className="sentence-card">
                      <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                      <div className="sentence-row">
                        <span className="sentence-label">Practice</span>
                        <p className="sentence-source">{question.prompt}</p>
                      </div>

                      {state === 'unanswered' && (
                        <>
                          {hasOptions ? (
                            <div className="quiz-options" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                              {question.options.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className="option-chip"
                                  onClick={() => submitPracticeAnswer(option)}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="quiz-input" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                              <input
                                className="chat-input"
                                type="text"
                                value={userAnswer}
                                placeholder="Type your answer..."
                                onChange={(event) => setPracticeQuizInputs((prev) => ({ ...prev, [index]: event.target.value }))}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && userAnswer.trim()) submitPracticeAnswer(userAnswer.trim())
                                }}
                              />
                              <button
                                type="button"
                                className="primary-button send-button"
                                disabled={!userAnswer.trim()}
                                onClick={() => submitPracticeAnswer(userAnswer.trim())}
                              >
                                Submit
                              </button>
                            </div>
                          )}

                          <div className="summary-actions" style={{ marginTop: '12px' }}>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                setPracticeQuizState((prev) => ({ ...prev, [index]: 'answered' }))
                                setPracticeQuizInputs((prev) => ({ ...prev, [index]: '' }))
                              }}
                            >
                              I don&apos;t know
                            </button>
                          </div>
                        </>
                      )}

                      {state === 'answered' && (
                        <div style={{ marginTop: '12px' }}>
                          {userAnswer ? (
                            <div className="sentence-row">
                              <span className="sentence-label">Your answer</span>
                              <p style={{ fontWeight: 600, color: isCorrect ? '#22c55e' : '#ef4444' }}>
                                {userAnswer} {isCorrect ? ' — Correct!' : ' — Not quite'}
                              </p>
                            </div>
                          ) : (
                            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Skipped</p>
                          )}
                          <div className="sentence-row">
                            <span className="sentence-label">Correct answer</span>
                            <p className="sentence-target">{question.answer}</p>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="plan-detail">No practice questions yet.</p>
            )}
          </section>
        )}

        <div className="inline-coach-chat">
          <div className="card-heading">
            <span className="section-tag">Ask your coach</span>
            <h3>Questions about today&apos;s lesson?</h3>
          </div>

          <div className="inline-chat-thread">
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                {message.text}
              </div>
            ))}
            {isCoachThinking && (
              <div className="chat-bubble coach typing-bubble" aria-label="Coach is thinking">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <div className="chat-input-shell">
            <div className="chat-input-row">
              <input
                className="chat-input"
                type="text"
                value={chatInput}
                placeholder={`Ask anything about today's ${styleLabel}...`}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleAsk()
                }}
              />
              <button
                type="button"
                className="primary-button send-button"
                onClick={handleAsk}
                disabled={!chatInput.trim() || isCoachThinking}
              >
                {isCoachThinking ? 'Thinking...' : 'Ask'}
              </button>
            </div>
          </div>
        </div>

        {lesson && !isLoading && !lessonError && (
          <div className="summary-actions" style={{ marginTop: '20px' }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleCompleteSession}
              disabled={sessionCompleted || justCompleted}
            >
              {sessionCompleted || justCompleted ? 'Finished today' : "Finish today's lesson"}
            </button>
            {(sessionCompleted || justCompleted) && <span className="completion-confetti">🎉</span>}
          </div>
        )}

        {lesson && !isLoading && !lessonError && (
          <p className="plan-detail" style={{ marginTop: '10px' }}>
            {sessionCompleted || justCompleted
              ? "You've finished today's lesson. Come back tomorrow for another lesson."
              : 'Mark this when you have finished the lesson. BeaLingo uses it to decide when to unlock your next revision and lesson day.'}
          </p>
        )}
      </section>
      )}

      <div className="summary-actions">
        <button type="button" className="secondary-button" onClick={() => setShowSettings(!showSettings)}>
          {showSettings ? 'Close settings' : 'Change preferences'}
        </button>
        <button type="button" className="secondary-button" onClick={onReset}>
          Start over
        </button>
      </div>

      {showSettings && (
        <section className="session-card settings-card">
          <div className="card-heading">
            <span className="section-tag">Preferences</span>
            <h2>Update your learning preferences</h2>
          </div>

          <p className="plan-detail">
            Changes saved here will apply from your next lesson onward. Today&apos;s lesson will stay the same.
          </p>

          <div className="settings-group">
            <h3>Goals</h3>
            <div className="option-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              {['Travel conversations', 'Everyday speaking', 'Grammar accuracy', 'Work communication', 'Understanding media'].map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`option-chip ${editGoals.includes(g) ? 'selected' : ''}`}
                  onClick={() => setEditGoals((prev) =>
                    prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <h3>Learning styles</h3>
            <div className="option-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              {['Daily sentences', 'Flashcards', 'Conversation scenarios'].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`option-chip ${editStyles.includes(s) ? 'selected' : ''}`}
                  onClick={() => setEditStyles((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {editStyles.map((style) => {
            const quantityPreference = getStyleQuantityPreference(style)
            if (!quantityPreference) return null
            return (
              <div className="settings-group" key={`quantity-${style}`}>
                <h3>{quantityPreference.question}</h3>
                <div className="option-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                  {quantityPreference.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`option-chip ${editStyleSettings[style] === option ? 'selected' : ''}`}
                      onClick={() => setEditStyleSettings((current) => ({ ...current, [style]: option }))}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="summary-actions" style={{ marginTop: '16px' }}>
            <button
              type="button"
              className="primary-button"
              disabled={
                editGoals.length === 0
                || editStyles.length === 0
                || editStyles.some((style) => !editStyleSettings[style])
              }
              onClick={() => {
                const latestProfile = getLearningProfile() || profile
                const updated = saveLearningProfile({
                  ...latestProfile,
                  goal: editGoals,
                  goals: editGoals,
                  learningStyle: editStyles,
                  learningStyles: editStyles,
                  styleSettings: editStyleSettings,
                })
                onProfileChange?.(updated)
                setShowSettings(false)
              }}
            >
              Save changes
            </button>
          </div>
        </section>
      )}
    </section>
  )
}

function formatLanguageLabel(profile) {
  return (
    [profile.language, profile.languageVariant, profile.languageRegion]
      .filter(Boolean)
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
      .join(' · ') || 'your language'
  )
}

function computeDayNumber(profile, todayKey = getTodayKey()) {
  const completedCount = getCompletedSessionCount(profile)
  return isSameStudyDate(profile?.lastCompletedAt, todayKey)
    ? Math.max(1, completedCount)
    : completedCount + 1
}

function getTodayKey() {
  return getLocalDateKey(new Date())
}

function isSameStudyDate(isoString, dateKey) {
  if (typeof isoString !== 'string') return false
  const date = new Date(isoString)
  return !Number.isNaN(date.getTime()) && getLocalDateKey(date) === dateKey
}

function getLocalDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isScheduledStudyDay(schedule, date) {
  const normalized = String(schedule || 'Every day').trim().toLowerCase()
  const weekday = date.getDay()
  const isWeekend = weekday === 0 || weekday === 6

  if (!normalized || normalized === 'every day') return true
  if (normalized === 'weekdays only') return !isWeekend
  if (normalized === 'a few times a week') return !isWeekend
  if (normalized === 'specific schedule') return true
  return true
}

function parseExtraPracticeRequest(text) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return null

  const wantsMore = /\b(more|extra|learn more|another)\b/.test(normalized)
  if (!wantsMore) return null

  const countMatch = normalized.match(/\b(\d{1,2})\b/)
  const count = countMatch ? Math.min(Math.max(parseInt(countMatch[1], 10), 1), MAX_EXTRA_ITEMS_PER_REQUEST) : 5

  if (/\bflashcards?\b/.test(normalized)) {
    return {
      style: 'flashcards',
      count,
      label: `${count} extra ${count === 1 ? 'flashcard' : 'flashcards'} for today`,
    }
  }

  if (/\b(sentences?|phrases?)\b/.test(normalized)) {
    return {
      style: 'daily sentences',
      count,
      label: `${count} extra ${count === 1 ? 'sentence' : 'sentences'} for today`,
    }
  }

  if (/\b(quizzes?|quiz questions?)\b/.test(normalized)) {
    return {
      style: 'quiz',
      count,
      label: `${count} extra ${count === 1 ? 'quiz question' : 'quiz questions'} for today`,
    }
  }

  if (/\b(conversations?|dialogues?|scenarios?)\b/.test(normalized)) {
    return {
      style: 'conversation scenarios',
      count,
      label: `${count} extra conversation ${count === 1 ? 'exchange' : 'exchanges'} for today`,
    }
  }

  return null
}

function collectContentItemKeys(content) {
  const keys = []
  for (const card of content?.flashcards || []) keys.push(card?.front)
  for (const sentence of content?.sentences || []) keys.push(sentence?.target || sentence?.source)
  for (const question of content?.questions || []) keys.push(question?.prompt)
  for (const exchange of content?.scenario?.exchanges || []) keys.push(exchange?.lineTarget)
  return keys.filter(Boolean).map((item) => String(item).trim().toLocaleLowerCase())
}

function collectTaughtItems(baseContent, extraMaterials) {
  return [
    ...collectContentItemKeys(baseContent),
    ...(extraMaterials || []).flatMap((extra) => collectContentItemKeys(extra?.content)),
  ]
}

function removeDuplicateExtraMaterials(materials, baseContent) {
  if (!Array.isArray(materials)) return []
  const seen = new Set(collectContentItemKeys(baseContent))

  return materials.flatMap((extra) => {
    const content = extra?.content || {}
    const keepUnique = (items, keyFor) => (items || []).filter((item) => {
      const key = String(keyFor(item) || '').trim().toLocaleLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    const cleaned = {
      ...content,
      flashcards: keepUnique(content.flashcards, (item) => item?.front),
      sentences: keepUnique(content.sentences, (item) => item?.target || item?.source),
      questions: keepUnique(content.questions, (item) => item?.prompt),
    }
    if (content.scenario) {
      cleaned.scenario = {
        ...content.scenario,
        exchanges: keepUnique(content.scenario.exchanges, (item) => item?.lineTarget),
      }
    }
    return collectContentItemKeys(cleaned).length > 0 ? [{ ...extra, content: cleaned }] : []
  })
}

function trimGeneratedContent(content, style, count) {
  const safeCount = Math.max(1, count || 1)
  const normalizedStyle = String(style || '').toLowerCase()

  if (content?.flashcards || normalizedStyle.includes('flashcard')) {
    return {
      ...content,
      flashcards: Array.isArray(content?.flashcards) ? content.flashcards.slice(0, safeCount) : [],
    }
  }

  if (content?.sentences || normalizedStyle.includes('sentence')) {
    return {
      ...content,
      sentences: Array.isArray(content?.sentences) ? content.sentences.slice(0, safeCount) : [],
    }
  }

  if (content?.questions || normalizedStyle.includes('quiz')) {
    return {
      ...content,
      questions: Array.isArray(content?.questions) ? content.questions.slice(0, safeCount) : [],
    }
  }

  if (content?.scenario || normalizedStyle.includes('conversation')) {
    const scenario = content?.scenario || {}
    return {
      ...content,
      scenario: {
        ...scenario,
        exchanges: Array.isArray(scenario.exchanges) ? scenario.exchanges.slice(0, safeCount) : [],
      },
    }
  }

  return content
}

function buildPracticeSourceContent(baseContent, extraMaterials) {
  const combined = {
    sentences: [...(baseContent?.sentences || [])],
    flashcards: [...(baseContent?.flashcards || [])],
    questions: [...(baseContent?.questions || [])],
    practice: [...(baseContent?.practice || [])],
    scenario: baseContent?.scenario
      ? { ...baseContent.scenario, exchanges: [...(baseContent.scenario.exchanges || [])] }
      : null,
  }

  for (const extra of extraMaterials || []) {
    if (Array.isArray(extra?.content?.sentences)) {
      combined.sentences.push(...extra.content.sentences)
    }
    if (Array.isArray(extra?.content?.flashcards)) {
      combined.flashcards.push(...extra.content.flashcards)
    }
    if (Array.isArray(extra?.content?.questions)) {
      combined.questions.push(...extra.content.questions)
    }
    if (Array.isArray(extra?.content?.practice)) {
      combined.practice.push(...extra.content.practice)
    }
    if (Array.isArray(extra?.content?.scenario?.exchanges)) {
      if (!combined.scenario) {
        combined.scenario = {
          setup: extra.content.scenario.setup || "Extra conversation practice",
          exchanges: [],
        }
      }
      combined.scenario.exchanges.push(...extra.content.scenario.exchanges)
    }
  }

  return combined
}

function getPracticeQuestionCount(content, fallbackCount) {
  if (Array.isArray(content?.practice) && content.practice.length > 0) return Math.min(content.practice.length, MAX_PRACTICE_QUESTIONS)
  if (Array.isArray(content?.sentences) && content.sentences.length > 0) return Math.min(content.sentences.length, MAX_PRACTICE_QUESTIONS)
  if (Array.isArray(content?.flashcards) && content.flashcards.length > 0) return Math.min(content.flashcards.length, MAX_PRACTICE_QUESTIONS)
  if (Array.isArray(content?.questions) && content.questions.length > 0) return Math.min(content.questions.length, MAX_PRACTICE_QUESTIONS)
  if (Array.isArray(content?.scenario?.exchanges) && content.scenario.exchanges.length > 0) {
    return Math.min(content.scenario.exchanges.length, MAX_PRACTICE_QUESTIONS)
  }
  return Math.min(Math.max(1, fallbackCount || 3), MAX_PRACTICE_QUESTIONS)
}

function renderExtraMaterialContent(
  extra,
  extraIndex,
  flippedCards,
  setFlippedCards,
  itemFeedback,
  markItemDifficulty,
  quizState,
  setQuizState,
  quizInputs,
  setQuizInputs,
) {
  if (extra.content?.flashcards) {
    return (
      <div className="flashcard-grid">
        {extra.content.flashcards.map((card, index) => {
          const flipKey = `extra-${extra.id}-${index}`
          const feedbackKey = `extra-fc-${extraIndex}-${index}`
          const isFlipped = flippedCards.has(flipKey)
          return (
            <button
              key={`extra-fc-${extra.id}-${index}`}
              type="button"
              className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={() => setFlippedCards((prev) => {
                const next = new Set(prev)
                if (next.has(flipKey)) next.delete(flipKey)
                else next.add(flipKey)
                return next
              })}
            >
              <div className="flashcard-front">
                <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
                <p className="flashcard-word">{card.front}</p>
                <span className="flashcard-hint">tap to flip</span>
              </div>
              <div className="flashcard-back">
                <p className="flashcard-translation">{card.back}</p>
                {card.note && <p className="flashcard-note">{card.note}</p>}
                {card.exampleTarget && (
                  <div className="flashcard-example">
                    <p>{card.exampleTarget}</p>
                    <p className="flashcard-example-source">{card.exampleSource}</p>
                  </div>
                )}
                {isFlipped && (
                  <div className="item-feedback">
                    {itemFeedback[feedbackKey] ? (
                      <span className="feedback-done">Marked: {itemFeedback[feedbackKey]}</span>
                    ) : renderDifficultyButtons(feedbackKey, markItemDifficulty, true)}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  if (extra.content?.sentences) {
    return (
      <ol className="sentence-list">
        {extra.content.sentences.map((sentence, index) => {
          const feedbackKey = `extra-s-${extraIndex}-${index}`
          return (
            <li key={`extra-s-${extra.id}-${index}`} className="sentence-card">
              <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="sentence-row">
                <span className="sentence-label">Source</span>
                <p className="sentence-source">{sentence.source}</p>
              </div>
              <div className="sentence-row">
                <span className="sentence-label">Target</span>
                <p className="sentence-target">{sentence.target}</p>
              </div>
              <div className="sentence-row">
                <span className="sentence-label">Meaning</span>
                <p className="sentence-meaning">{sentence.meaning}</p>
              </div>
              <div className="sentence-row example">
                <span className="sentence-label">Example</span>
                <p className="sentence-example-target">{sentence.exampleTarget}</p>
                <p className="sentence-example-source">{sentence.exampleSource}</p>
              </div>
              <div className="item-feedback">
                {itemFeedback[feedbackKey] ? (
                  <span className="feedback-done">Marked: {itemFeedback[feedbackKey]}</span>
                ) : renderDifficultyButtons(feedbackKey, markItemDifficulty)}
              </div>
            </li>
          )
        })}
      </ol>
    )
  }

  if (extra.content?.scenario) {
    return (
      <div className="conversation-scenario">
        <p className="scenario-setup">{extra.content.scenario.setup}</p>
        <div className="scenario-exchanges">
          {(extra.content.scenario.exchanges || []).map((exchange, index) => {
            const feedbackKey = `extra-ex-${extraIndex}-${index}`
            return (
              <div key={`extra-ex-${extra.id}-${index}`} className="scenario-exchange">
                <span className="scenario-speaker">{exchange.speaker}</span>
                <p className="scenario-line-target">{exchange.lineTarget}</p>
                <p className="scenario-line-source">{exchange.lineSource}</p>
                {exchange.note && <p className="scenario-note">{exchange.note}</p>}
                <div className="item-feedback">
                  {itemFeedback[feedbackKey] ? (
                    <span className="feedback-done">Marked: {itemFeedback[feedbackKey]}</span>
                  ) : renderDifficultyButtons(feedbackKey, markItemDifficulty)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (extra.content?.questions) {
    return (
      <ol className="sentence-list">
        {extra.content.questions.map((question, index) => {
          const quizKey = `extra-q-${extraIndex}-${index}`
          const state = quizState[quizKey] || 'unanswered'
          const userAnswer = quizInputs[quizKey] || ''
          const isCorrect =
            state === 'answered' && userAnswer.trim().toLowerCase() === (question.answer || '').trim().toLowerCase()
          const hasOptions = Array.isArray(question.options) && question.options.length > 0

          const submitQuizAnswer = (answer) => {
            setQuizInputs((prev) => ({ ...prev, [quizKey]: answer }))
            setQuizState((prev) => ({ ...prev, [quizKey]: 'answered' }))
          }

          return (
            <li key={`extra-q-${extra.id}-${index}`} className="sentence-card">
              <span className="sentence-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="sentence-row">
                <span className="sentence-label">Question</span>
                <p className="sentence-source">{question.prompt}</p>
              </div>

              {state === 'unanswered' && (
                <>
                  <div className="item-feedback" style={{ marginTop: '8px', borderTop: 'none', paddingTop: '0' }}>
                    {itemFeedback[quizKey] ? (
                      <span className="feedback-done">Marked: {itemFeedback[quizKey]}</span>
                    ) : renderDifficultyButtons(quizKey, markItemDifficulty)}
                    <button
                      type="button"
                      className="feedback-btn"
                      onClick={() => {
                        setQuizState((prev) => ({ ...prev, [quizKey]: 'answered' }))
                        setQuizInputs((prev) => ({ ...prev, [quizKey]: '' }))
                      }}
                    >
                      I don&apos;t know
                    </button>
                  </div>

                  {hasOptions ? (
                    <div className="quiz-options" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                      {question.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="option-chip"
                          onClick={() => submitQuizAnswer(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="quiz-input" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <input
                        className="chat-input"
                        type="text"
                        value={userAnswer}
                        placeholder="Type your answer..."
                        onChange={(event) => setQuizInputs((prev) => ({ ...prev, [quizKey]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && userAnswer.trim()) submitQuizAnswer(userAnswer.trim())
                        }}
                      />
                      <button
                        type="button"
                        className="primary-button send-button"
                        disabled={!userAnswer.trim()}
                        onClick={() => submitQuizAnswer(userAnswer.trim())}
                      >
                        Submit
                      </button>
                    </div>
                  )}
                </>
              )}

              {state === 'answered' && (
                <div style={{ marginTop: '12px' }}>
                  {userAnswer ? (
                    <div className="sentence-row">
                      <span className="sentence-label">Your answer</span>
                      <p style={{ fontWeight: 600, color: isCorrect ? '#22c55e' : '#ef4444' }}>
                        {userAnswer} {isCorrect ? ' — Correct!' : ' — Not quite'}
                      </p>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Skipped</p>
                  )}
                  <div className="sentence-row">
                    <span className="sentence-label">Correct answer</span>
                    <p className="sentence-target">{question.answer}</p>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    )
  }

  return <p className="plan-detail">I generated extra material, but there was nothing to display.</p>
}

function evaluateLessonFeedback(itemFeedback, currentLevel, todayKey) {
  const ratings = Object.values(itemFeedback)
  const counts = {
    hard: ratings.filter((rating) => rating === 'hard').length,
    justRight: ratings.filter((rating) => rating === 'just-right').length,
    easy: ratings.filter((rating) => rating === 'easy').length,
  }

  const current = normalizeLevel(currentLevel)
  let direction = 'keep'

  if (counts.hard >= 2 && counts.hard > counts.easy && counts.hard > counts.justRight) {
    direction = 'down'
  } else if (counts.easy >= 2 && counts.easy > counts.hard && counts.easy > counts.justRight) {
    direction = 'up'
  }

  const nextLevel = getAdjustedLevel(current, direction)

  let message = 'Most of this batch felt about right, so BeaLingo will keep the same level next time.'
  if (ratings.length === 0) {
    message = 'No difficulty feedback was marked, so BeaLingo will keep the same level for the next lesson.'
  } else if (direction === 'down' && nextLevel !== current) {
    message = `This batch looked too hard overall, so BeaLingo will lower the next lesson from ${current} to ${nextLevel}.`
  } else if (direction === 'up' && nextLevel !== current) {
    message = `This batch looked too easy overall, so BeaLingo will raise the next lesson from ${current} to ${nextLevel}.`
  } else if (direction !== 'keep' && nextLevel === current) {
    message = `This batch looked ${direction === 'up' ? 'too easy' : 'too hard'} overall, but you are already at the ${current.toLowerCase()} limit, so BeaLingo will keep the same level.`
  }

  return {
    date: todayKey,
    counts,
    currentLevel: current,
    nextLevel,
    direction,
    message,
  }
}

function normalizeLevel(level) {
  const normalized = String(level || 'Beginner').trim().toLowerCase()
  if (normalized === 'advanced') return 'Advanced'
  if (normalized === 'intermediate') return 'Intermediate'
  return 'Beginner'
}

function getAdjustedLevel(currentLevel, direction) {
  const levels = ['Beginner', 'Intermediate', 'Advanced']
  const currentIndex = levels.indexOf(normalizeLevel(currentLevel))
  if (direction === 'up') return levels[Math.min(currentIndex + 1, levels.length - 1)]
  if (direction === 'down') return levels[Math.max(currentIndex - 1, 0)]
  return levels[Math.max(currentIndex, 0)]
}

function getDesiredCountForStyle(profile, styleName) {
  const settings = profile.styleSettings || {}
  const setting = settings[styleName] || ''
  const parsed = parseInt(setting, 10)
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 50) return parsed
  if (setting === 'Short exchange') return 2
  if (setting === 'Medium dialogue') return 4
  if (setting === 'Longer scenario') return 6
  const lower = styleName.toLowerCase()
  if (lower.includes('flashcard')) return 5
  if (lower.includes('quiz')) return 5
  if (lower.includes('conversation')) return 4
  return 2
}

function getStyleQuantityPreference(styleName) {
  const normalizedStyle = normalizeAnswer(styleName)
  if (normalizedStyle === 'daily sentences') {
    return {
      question: 'How many new sentences would you like in a lesson?',
      options: ['1 sentence', '2 sentences', '3 sentences', '5 sentences'],
    }
  }
  if (normalizedStyle === 'flashcards') {
    return {
      question: 'How many flashcards would you like in a lesson?',
      options: ['3 flashcards', '5 flashcards', '8 flashcards', '10 flashcards'],
    }
  }
  if (normalizedStyle === 'conversation scenarios') {
    return {
      question: 'How long would you like each conversation lesson?',
      options: ['Short exchange', 'Medium dialogue', 'Longer scenario'],
    }
  }
  if (normalizedStyle === 'quizzes') {
    return {
      question: 'How many questions would you like in each quiz?',
      options: ['3 questions', '5 questions', '8 questions', '10 questions'],
    }
  }
  return null
}

function getStepConfig(stepKey, answers) {
  switch (stepKey) {
    case 'language':
      return {
        key: 'language',
        question: `Nice to meet you${answers.name ? ', ' + answers.name : ''}. What language would you like to learn?`,
        placeholder: 'Type the language you want to learn...',
      }
    case 'languageVariant': {
      const language = normalizeAnswer(answers.language || '')
      const followUp = languageFollowUps[language]
      return followUp ? { key: 'languageVariant', ...followUp } : null
    }
    case 'languageRegion': {
      const selectedVariant = normalizeAnswer(answers.languageVariant || '')
      const followUp = languageRegionFollowUps[selectedVariant]
      return followUp ? { key: 'languageRegion', ...followUp } : null
    }
    case 'nativeLanguage':
      return {
        key: 'nativeLanguage',
        question: "Got it. And what's your native language? I'll use it to explain meanings and give translations.",
        placeholder: 'Type your native language...',
        options: ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Mandarin Chinese', 'Cantonese'],
      }
    case 'selfLevel':
      return {
        key: 'selfLevel',
        question: 'How would you describe your level right now?',
        placeholder: 'Choose the one that fits best...',
        options: ['Beginner', 'Intermediate', 'Advanced'],
      }
    case 'vocabTest':
      return null
    case 'sentenceTask':
      return {
        key: 'sentenceTask',
        question: `Write me one sentence in ${buildLanguageSummary(answers) || 'your target language'} — about anything you want.`,
        placeholder: 'Write a sentence...',
        options: ["I can't write a sentence yet"],
      }
    case 'name':
      return {
        key: 'name',
        question: "Hi! What should I call you?",
        placeholder: 'Type your name or nickname...',
      }
    case 'interests':
      return {
        key: 'interests',
        question: `Nice. What kind of topics do you enjoy${answers.name ? ', ' + answers.name : ''}? I'll use them to make examples feel like you. You can pick a few or type your own.`,
        placeholder: 'Type topics you enjoy, or use the options...',
        options: ['Food', 'Travel', 'Movies', 'Music', 'Sports', 'Tech', 'Work', 'Family', 'Books', 'Fitness'],
        multiSelect: true,
      }
    case 'motivation':
      return {
        key: 'motivation',
        question: 'What is driving this right now? It helps me pace the material.',
        placeholder: 'Tell me what is motivating you...',
        options: [
          'Trip coming up',
          'Moving abroad',
          'Work need',
          'Connect with family or partner',
          'Just for fun',
          'Long-term hobby',
        ],
      }
    case 'correctionStyle':
      return {
        key: 'correctionStyle',
        question: 'When you make mistakes, how would you like me to correct you?',
        placeholder: 'Pick the correction style you prefer...',
        options: [
          'Correct every mistake',
          'Only significant ones',
          'Let me finish first, then notes',
        ],
      }
    case 'goal':
      return {
        key: 'goal',
        question: buildGoalQuestion(),
        placeholder: 'Describe what you want to be able to do...',
        options: [
          'Travel conversations',
          'Everyday speaking',
          'Grammar accuracy',
          'Work communication',
          'Understanding media',
          'Other',
        ],
        multiSelect: true,
      }
    case 'goalPrimary':
      return getPrimarySelectionStep(
        'goalPrimary',
        answers.goal,
        'You picked a few goals. Which one should I focus on most at first?',
      )
    case 'learningStyle':
      return {
        key: 'learningStyle',
        question: 'Got it. How do you learn best? You can choose more than one.',
        placeholder: 'Type your preferred ways to learn, or use the options...',
        options: learningStyleOptions,
        multiSelect: true,
      }
    case 'learningStylePrimary':
      return getPrimarySelectionStep(
        'learningStylePrimary',
        answers.learningStyle,
        'You picked a few learning styles. Which one should I build your sessions around most?',
      )
    case 'learningStyleDetails':
      return getLearningStyleAmountStep(answers)
    case 'schedule':
      return {
        key: 'schedule',
        question: 'Noted. Would you like to study every day, or follow a specific schedule?',
        placeholder: 'Tell me your preferred schedule...',
        options: ['Every day', 'Weekdays only', 'A few times a week', 'Specific schedule'],
      }
    case 'newMaterialPace':
      return {
        key: 'newMaterialPace',
        question: 'When should I introduce new material?',
        placeholder: 'Tell me how you want new material to appear...',
        options: [
          'Give me something new every day',
          'Mix in new content regularly',
          "Only move on once I have learned the current set",
        ],
      }
    case 'quizFrequency':
      return {
        key: 'quizFrequency',
        question: 'How often would you like little quiz check-ins?',
        placeholder: 'Choose a quiz rhythm...',
        options: ['Every session', 'A few times a week', 'Once a week', 'Only when I ask'],
      }
    default:
      return null
  }
}

function findNextStep(currentIndex, updatedAnswers) {
  for (let index = currentIndex + 1; index < baseSteps.length; index += 1) {
    const nextKey = baseSteps[index]

    if (nextKey === 'vocabTest' || nextKey === 'sentenceTask') continue

    if (nextKey === 'languageVariant') {
      const language = normalizeAnswer(updatedAnswers.language || '')
      if (!languageFollowUps[language]) continue
    }

    if (nextKey === 'languageRegion') {
      const variant = normalizeAnswer(updatedAnswers.languageVariant || '')
      if (!languageRegionFollowUps[variant]) continue
    }


    if (nextKey === 'learningStyleDetails') {
      const learningStyleStep = getLearningStyleAmountStep(updatedAnswers)
      if (!learningStyleStep) continue
    }

    return nextKey
  }

  return null
}

function normalizeAnswer(value) {
  return value.trim().toLowerCase()
}



function getSavedSessionData() {
  const fallback = {
    stepIndex: 0,
    inputValue: '',
    answers: {},
    selectedOptions: [],
    pendingLanguageSuggestion: null,
    messages: defaultMessages,
    vocabData: null,
    vocabSelections: [],
  }

  try {
    const raw = window.localStorage.getItem(sessionStorageKey)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    return {
      stepIndex: Number.isInteger(parsed.stepIndex) ? parsed.stepIndex : 0,
      inputValue: typeof parsed.inputValue === 'string' ? parsed.inputValue : '',
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      selectedOptions: Array.isArray(parsed.selectedOptions) ? parsed.selectedOptions : [],
      pendingLanguageSuggestion: parsed.pendingLanguageSuggestion || null,
      messages: Array.isArray(parsed.messages) && parsed.messages.length > 0 ? parsed.messages : defaultMessages,
      vocabData: Array.isArray(parsed.vocabData) ? parsed.vocabData : null,
      vocabSelections: Array.isArray(parsed.vocabSelections) ? parsed.vocabSelections : [],
    }
  } catch {
    return fallback
  }
}

function resolveLanguageInput(value) {
  const normalized = normalizeAnswer(value)
  const exact = knownLanguages.find((language) => language === normalized)

  if (exact) {
    return { status: 'valid', canonical: exact, label: toTitleCase(exact) }
  }

  const aliasMatch = languageAliases[normalized]
  if (aliasMatch) {
    return { status: 'suggest', canonical: aliasMatch, label: toTitleCase(aliasMatch) }
  }

  const bestMatch = knownLanguages
    .map((language) => ({
      language,
      distance: levenshtein(normalized, language),
      startsClose:
        normalized.length >= 4 &&
        (language.startsWith(normalized) ||
          normalized.startsWith(language.slice(0, Math.min(language.length, normalized.length)))),
    }))
    .sort((a, b) => {
      if (a.startsClose !== b.startsClose) return a.startsClose ? -1 : 1
      return a.distance - b.distance
    })[0]

  const typoThreshold =
    normalized.length >= 8 ? 4 : normalized.length >= 6 ? 3 : normalized.length >= 4 ? 2 : 1

  if (bestMatch && (bestMatch.startsClose || bestMatch.distance <= typoThreshold)) {
    return {
      status: 'suggest',
      canonical: bestMatch.language,
      label: toTitleCase(bestMatch.language),
    }
  }

  return { status: 'invalid' }
}

function toTitleCase(value) {
  return value
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function levenshtein(a, b) {
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0))

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[rows - 1][cols - 1]
}

function buildGoalQuestion() {
  return "Let's decide on our plan. What would you like to be able to do with this language?"
}

function buildLanguageSummary(answers) {
  return [answers.language, answers.languageVariant, answers.languageRegion]
    .filter(Boolean)
    .map((item) => toTitleCase(item))
    .join(' · ')
}

function joinAnswerList(value) {
  return Array.isArray(value) ? value.join(', ') : value
}

function sentenceCase(value) {
  if (!value) {
    return value
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function getLearningStyleAmountStep(answers) {
  const selectedStyles = Array.isArray(answers.learningStyle) ? answers.learningStyle : []
  const styleSettings = answers.styleSettings || {}
  const nextStyle = selectedStyles.find((style) => !styleSettings[style])

  if (!nextStyle) {
    return null
  }

  const normalizedStyle = normalizeAnswer(nextStyle)

  if (normalizedStyle === 'daily sentences') {
    return {
      key: 'learningStyleDetails',
      styleKey: nextStyle,
      question: 'How many new sentences would you like in a typical lesson?',
      placeholder: 'Tell me how many sentences you want...',
      options: ['1 sentence', '2 sentences', '3 sentences', '5 sentences'],
    }
  }

  if (normalizedStyle === 'flashcards') {
    return {
      key: 'learningStyleDetails',
      styleKey: nextStyle,
      question: 'How many flashcards would you like in a set?',
      placeholder: 'Tell me how many flashcards you want...',
      options: ['3 flashcards', '5 flashcards', '8 flashcards', '10 flashcards'],
    }
  }

  if (normalizedStyle === 'conversation scenarios') {
    return {
      key: 'learningStyleDetails',
      styleKey: nextStyle,
      question: 'How long would you like each conversation practice to be?',
      placeholder: 'Tell me the conversation length you prefer...',
      options: ['Short exchange', 'Medium dialogue', 'Longer scenario'],
    }
  }

  if (normalizedStyle === 'quizzes') {
    return {
      key: 'learningStyleDetails',
      styleKey: nextStyle,
      question: 'How many questions should each quiz check-in have?',
      placeholder: 'Tell me how long you want each quiz to be...',
      options: ['3 questions', '5 questions', '8 questions', '10 questions'],
    }
  }

  return null
}

function mergeSelections(knownOptions, selectedOptions, typedValue) {
  const fromText = typedValue
    ? typedValue
        .split(/,|\+| and /i)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => matchKnownOption(knownOptions, item) || item)
    : []

  return Array.from(new Set([...selectedOptions, ...fromText]))
}

function matchKnownOption(options, value) {
  const normalized = normalizeAnswer(value)
  return options.find((option) => normalizeAnswer(option) === normalized) || null
}

function getPrimarySelectionStep(key, values, question) {
  if (!Array.isArray(values) || values.length <= 1) {
    return null
  }

  return {
    key,
    question,
    placeholder: 'Choose the main focus...',
    options: values,
  }
}
