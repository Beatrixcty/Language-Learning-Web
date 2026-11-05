import { useEffect, useRef, useState } from 'react'
import SessionPage from './pages/SessionPage.jsx'
import { getLearningProfile } from './lib/profile.js'
import { getChatGPTConnectUrl, getChatGPTStatus } from './lib/groq.js'
import {
  getLatestHistoryEntry,
  getPileItems,
  getPileStats,
  getProgressSnapshot,
  recordPracticeResult,
  getStatusLabel,
  getStatusOptions,
  updateCardStatus,
  updateCardCategory,
} from './lib/revision.js'
import './App.css'

const navItems = ['Home', 'Session', 'Knowledge', 'Progress', 'Practice']

const features = [
  {
    tag: '01',
    title: 'You set the rules',
    text: 'Tell the coach your level, your goal, how you like to learn. 2 sentences a day. Flashcards only. Conversations for travel. Your call.',
  },
  {
    tag: '02',
    title: 'It adapts to you, not the other way around',
    text: 'Change your mind mid-week? Ask for more today? Switch styles? Just say it. No curriculum lock-in.',
  },
  {
    tag: '03',
    title: 'It remembers what you struggle with',
    text: 'Every answer tells the coach something. Weak areas come back. Strong ones get out of the way. Your plan evolves.',
  },
]

const quickPageCopy = {
  Knowledge: {
    title: 'Knowledge',
    text: 'Your saved words and short phrases from lessons appear here so you can browse what BeaLingo has already taught you.',
  },
  Progress: {
    title: 'Progress',
    text: 'This page will show progress over time, recurring weak spots, strengths, and how BeaLingo is adapting the plan.',
  },
  Practice: {
    title: 'Practice',
    text: 'This page will be for separate active practice when the user wants extra drills outside the main session flow.',
  },
}

function App() {
  const shellRef = useRef(null)
  const [activePage, setActivePage] = useState(() => window.localStorage.getItem('bealingo-active-page') || 'Home')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [hasProfile, setHasProfile] = useState(() => !!getLearningProfile())
  const [showGoToTop, setShowGoToTop] = useState(() => window.scrollY > 160)
  const [chatGPTConnection, setChatGPTConnection] = useState({
    connected: false,
    provider: 'Groq free tier',
    mode: import.meta.env.VITE_BEALINGO_MODE || 'local',
  })

  useEffect(() => {
    window.localStorage.setItem('bealingo-active-page', activePage)
  }, [activePage])

  useEffect(() => {
    const refresh = () => setHasProfile(!!getLearningProfile())
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    const refreshConnection = () => getChatGPTStatus().then(setChatGPTConnection).catch(() => {})
    refreshConnection()
    window.addEventListener('focus', refreshConnection)
    return () => window.removeEventListener('focus', refreshConnection)
  }, [])

  useEffect(() => {
    if (activePage === 'Home') setHasProfile(!!getLearningProfile())
  }, [activePage])

  useEffect(() => {
    const updateGoToTop = () => setShowGoToTop(window.scrollY > 160)
    updateGoToTop()
    window.addEventListener('scroll', updateGoToTop, { passive: true })
    return () => window.removeEventListener('scroll', updateGoToTop)
  }, [activePage])

  const handleNavClick = (page) => {
    setActivePage(page)
    setIsMenuOpen(false)
  }

  return (
    <main ref={shellRef} className={`app-shell ${activePage !== 'Home' ? 'app-shell-decorated' : ''} ${activePage === 'Session' ? 'app-shell-session' : ''}`}>
      <CharacterDecor activePage={activePage} containerRef={shellRef} />
      <header className="topbar">
        <div className="menu-shell">
          <button
            type="button"
            className="menu-button"
            aria-label="Open navigation menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>

          {isMenuOpen && (
            <nav className="menu-dropdown" aria-label="Main navigation">
              {navItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`menu-link ${activePage === item ? 'active' : ''}`}
                  onClick={() => handleNavClick(item)}
                >
                  {item}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      {activePage === 'Home' && (
        <HomePage
          hasProfile={hasProfile}
          onStartLearning={() => handleNavClick('Session')}
          chatGPTConnection={chatGPTConnection}
        />
      )}
      {activePage === 'Session' && <SessionPage />}
      {activePage === 'Knowledge' && <KnowledgePage />}
      {activePage === 'Progress' && <ProgressPage />}
      {activePage === 'Practice' && <PracticePage />}
      {quickPageCopy[activePage] && activePage !== 'Knowledge' && activePage !== 'Progress' && activePage !== 'Practice' && (
        <PlaceholderPage title={quickPageCopy[activePage].title} text={quickPageCopy[activePage].text} />
      )}
      {showGoToTop && (
        <button type="button" className="go-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          ↑ Top
        </button>
      )}
    </main>
  )
}

const characterSets = {
  Session: [0, 7, 3, 9, 5, 8, 2, 13, 4, 10, 1, 11, 6, 12],
  Knowledge: [2, 3, 5, 6, 7, 8, 12, 13],
  Progress: [0, 2, 5, 6, 7, 9, 10, 11],
  Practice: [1, 3, 4, 5, 8, 10, 12, 13],
}

function CharacterDecor({ activePage, containerRef }) {
  const [sessionCharacterCount, setSessionCharacterCount] = useState(6)
  const characters = [
    ['japanese-kimono', 'japanese-kimono.png'],
    ['chinese-qipao', 'chinese-qipao.png'],
    ['chinese-changshan', 'chinese-changshan.png'],
    ['west-african', 'west-african.png'],
    ['south-asian-kurta', 'south-asian-kurta.png'],
    ['middle-eastern-hijab', 'middle-eastern-hijab.png'],
    ['latin-american', 'latin-american.png'],
    ['european-reader', 'european-reader.png'],
    ['irish-woman', 'irish-woman.png'],
    ['nordic-man', 'nordic-man.png'],
    ['mediterranean-woman', 'mediterranean-woman.png'],
    ['eastern-european-man', 'eastern-european-man.png'],
    ['british-woman', 'british-woman.png'],
    ['french-reader', 'french-reader.png'],
  ]

  useEffect(() => {
    if (activePage !== 'Session' || !containerRef.current) return undefined

    const sessionContent = containerRef.current.querySelector('.session-page')
    if (!sessionContent) return undefined

    const updateCount = () => {
      const height = sessionContent.getBoundingClientRect().height
      const count = height <= 1000 ? 6
        : height <= 1600 ? 8
          : height <= 2200 ? 10
            : height <= 2800 ? 12
              : 14
      setSessionCharacterCount(count)
    }

    updateCount()
    const observer = new ResizeObserver(updateCount)
    observer.observe(sessionContent)
    return () => observer.disconnect()
  }, [activePage, containerRef])

  if (activePage === 'Home') {
    return null
  }

  const characterIndexes = activePage === 'Session'
    ? characterSets.Session.slice(0, sessionCharacterCount)
    : (characterSets[activePage] || characterSets.Session)
  const visibleCharacters = characterIndexes.map((index) => characters[index])
  const sessionRows = Math.ceil(visibleCharacters.length / 2)

  return (
    <div className={`character-decor ${activePage === 'Session' ? 'character-decor-session' : ''}`} aria-hidden="true">
      {visibleCharacters.map(([name, file], index) => (
        <img
          key={name}
          className={`character-sticker character-sticker-slot-${index + 1}`}
          src={`/characters/${file}`}
          alt=""
          style={activePage === 'Session' ? {
            top: `${sessionRows <= 1 ? 6 : 5 + Math.floor(index / 2) * (82 / (sessionRows - 1))}%`,
          } : undefined}
        />
      ))}
    </div>
  )
}

function HomePage({ hasProfile, onStartLearning, chatGPTConnection }) {
  return (
    <>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="brand-mark" aria-label="BeaLingo brand">
            <span className="brand-name">BeaLingo</span>
            <span className="brand-subtitle">Personal language coach</span>
          </div>

          <h1>
            {hasProfile ? (
              <>
                Welcome back.
                <br />
                Ready for today&apos;s session?
              </>
            ) : (
              <>
                Your language coach,
                <br />
                trained by you.
              </>
            )}
          </h1>

          <p className="description">
            {hasProfile
              ? 'Your coach has your plan ready. Jump back in whenever you are.'
              : 'Not a fixed course, a coach you train to teach you better.'}
          </p>

          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={onStartLearning}>
              {hasProfile ? "Continue today's session" : 'Start Learning'}
            </button>
            {chatGPTConnection.mode === 'demo' ? (
              <span className="chatgpt-connected">Public demo · Groq-powered</span>
            ) : chatGPTConnection.connected ? (
              <span className="chatgpt-connected">ChatGPT plan connected{chatGPTConnection.email ? ` · ${chatGPTConnection.email}` : ''}</span>
            ) : (
              <button
                type="button"
                className="secondary-button"
                data-oai-siwc-button
                onClick={() => window.location.assign(getChatGPTConnectUrl())}
              >
                Continue with ChatGPT
              </button>
            )}
          </div>
        </div>

        <div className="preview-panel">
          <div className="chat-mock" aria-label="Example coach conversation">
            <div className="chat-mock-header">
              <div className="chat-mock-avatar" aria-hidden="true">
                <img src="/bea-coach-avatar.png" alt="" />
              </div>
              <div className="chat-mock-identity">
                <strong>BeaLingo</strong>
                <span>
                  <span className="chat-mock-dot" aria-hidden="true" />
                  your coach · online
                </span>
              </div>
            </div>

            <div className="chat-mock-thread">
              <div className="chat-mock-bubble you">I want to learn Portuguese.</div>
              <div className="chat-mock-bubble coach">Cool! What&apos;s the plan?</div>
              <div className="chat-mock-bubble you">
                Beginner. 2 sentences a day, focus on restaurants and travel.
              </div>
              <div className="chat-mock-bubble coach">Flashcards? Quizzes?</div>
              <div className="chat-mock-bubble you">
                Yes. Flashcards for new words, quiz me every Friday.
              </div>
              <div className="chat-mock-bubble coach loading">
                Setting up
                <span className="loading-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
                <span className="loading-bee" aria-hidden="true">🐝</span>
              </div>
            </div>

            <div className="chat-mock-input">
              <span>Message your coach…</span>
              <button type="button" aria-label="Send" tabIndex={-1}>↑</button>
            </div>
          </div>
        </div>
      </section>

      <div className="home-character-showcase" aria-hidden="true">
        <img className="home-character-core" src="/bealingo-group-14.png" alt="" />
      </div>

      <section className="features-section">
        <div className="section-heading">
          <span className="section-tag">What BeaLingo does</span>
          <h2>You train the coach. It learns how to teach you back.</h2>
        </div>

        <div className="feature-grid">
          {features.map((feature, index) => (
            <article key={feature.title} className={`feature-card feature-card-${index + 1}`}>
              <span className="feature-tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function PlaceholderPage({ title, text }) {
  return (
    <section className="placeholder-page">
      <span className="section-tag">Coming next</span>
      <h1 className="session-title">{title}</h1>
      <p className="session-description">{text}</p>
    </section>
  )
}

function KnowledgePage() {
  const [items, setItems] = useState(() => filterKnowledgeItems(getPileItems()))
  const [stats, setStats] = useState(() => getPileStats())
  const [collapsedCategories, setCollapsedCategories] = useState({})
  const [collapsedItems, setCollapsedItems] = useState({})
  const groupedItems = groupKnowledgeItems(items)
  const statusOptions = getStatusOptions()

  useEffect(() => {
    const refresh = () => {
      setItems(filterKnowledgeItems(getPileItems()))
      setStats(getPileStats())
    }

    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    refresh()

    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <section className="placeholder-page knowledge-page">
      <span className="section-tag">Knowledge</span>
      <h1 className="session-title">Saved words and phrases</h1>
      <p className="session-description">
        BeaLingo stores flashcards directly and saves vocabulary from sentence, conversation, and quiz lessons as individual words or short phrases.
      </p>

      <div className="knowledge-stats">
        <div className="summary-item">
          <span>Total saved</span>
          <strong>{items.length}</strong>
        </div>
        <div className="summary-item">
          <span>Needs review</span>
          <strong>{stats.needsReview}</strong>
        </div>
        <div className="summary-item">
          <span>Familiar</span>
          <strong>{stats.familiar}</strong>
        </div>
        <div className="summary-item">
          <span>Mastered</span>
          <strong>{stats.mastered}</strong>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="plan-detail">No saved words yet. Finish a lesson and BeaLingo will start building your knowledge list.</p>
      ) : (
        groupedItems.map(({ category, label, items: categoryItems }) => (
          categoryItems.length > 0 && (
            <section key={category} className="knowledge-section">
              <button
                type="button"
                className="knowledge-section-heading knowledge-toggle"
                onClick={() =>
                  setCollapsedCategories((current) => ({
                    ...current,
                    [category]: current[category] === undefined ? false : !current[category],
                  }))
                }
                aria-expanded={collapsedCategories[category] === undefined ? false : !collapsedCategories[category]}
              >
                <span className="section-tag">{label}</span>
                <strong>{categoryItems.length} {(collapsedCategories[category] ?? true) ? '▸' : '▾'}</strong>
              </button>
              {!(collapsedCategories[category] ?? true) && (
                <div className="knowledge-list">
                  {categoryItems.map((item) => (
                    <article key={item.id} className="session-card knowledge-list-item">
                      <button
                        type="button"
                        className="knowledge-list-row knowledge-toggle"
                        onClick={() =>
                          setCollapsedItems((current) => ({
                            ...current,
                            [item.id]: current[item.id] === undefined ? false : !current[item.id],
                          }))
                        }
                        aria-expanded={collapsedItems[item.id] === undefined ? false : !collapsedItems[item.id]}
                      >
                        <div className="knowledge-list-main">
                          <span className="knowledge-target">{item.front}</span>
                          <span className="knowledge-list-meta">
                            {item.sourceType === 'flashcard' ? 'Flashcard' : label}
                            <select
                              className="knowledge-category-select"
                              value={item.category}
                              aria-label={`Change word type for ${item.front}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                updateCardCategory(item.id, event.target.value)
                                setItems(filterKnowledgeItems(getPileItems()))
                              }}
                            >
                              <option value="noun">Noun</option>
                              <option value="verb">Verb</option>
                              <option value="adjective">Adjective</option>
                            </select>
                          </span>
                        </div>
                        <span className="knowledge-date">
                          {item.addedAt ? `${item.addedAt} ` : ''}{(collapsedItems[item.id] ?? true) ? '▸' : '▾'}
                        </span>
                      </button>
                      {!(collapsedItems[item.id] ?? true) && (
                        <div className="knowledge-item-card">
                          <div className="knowledge-detail-row">
                            <span className="sentence-label">Status</span>
                            <div className="knowledge-status-row">
                              <strong className="knowledge-status-label">{getStatusLabel(item.status)}</strong>
                              <select
                                className="knowledge-status-select"
                                value={item.status}
                                onChange={(event) => {
                                  updateCardStatus(item.id, event.target.value, { source: 'manual' })
                                  setItems(filterKnowledgeItems(getPileItems()))
                                  setStats(getPileStats())
                                }}
                                aria-label={`Change status for ${item.front}`}
                              >
                                {statusOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {getLatestHistoryEntry(item) && (
                            <div className="knowledge-detail-row">
                              <span className="sentence-label">Latest change</span>
                              <p className="knowledge-note">{formatHistoryEntry(getLatestHistoryEntry(item))}</p>
                            </div>
                          )}
                          {item.back && (
                            <div className="knowledge-detail-row">
                              <span className="sentence-label">Source text</span>
                              <p className="knowledge-back">{item.back}</p>
                            </div>
                          )}
                          {item.note && (
                            <div className="knowledge-detail-row">
                              <span className="sentence-label">Meaning</span>
                              <p className="knowledge-note">{item.note}</p>
                            </div>
                          )}
                          {item.exampleTarget && (
                            <div className="knowledge-example">
                              <p>{item.exampleTarget}</p>
                              {item.exampleSource && <p className="flashcard-example-source">{item.exampleSource}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        ))
      )}
    </section>
  )
}

function ProgressPage() {
  const [profile, setProfile] = useState(() => getLearningProfile())
  const [snapshot, setSnapshot] = useState(() => getProgressSnapshot(getLearningProfile()))

  useEffect(() => {
    const refresh = () => {
      const nextProfile = getLearningProfile()
      setProfile(nextProfile)
      setSnapshot(getProgressSnapshot(nextProfile))
    }

    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    refresh()

    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const levelSummary = buildCefrSummary(profile, snapshot)
  const weakSpotCards = buildWeakSpotCards(snapshot)
  const encouragement = getStreakEncouragement(snapshot.currentStreak)

  return (
    <section className="placeholder-page progress-page">
      <span className="section-tag">Progress</span>
      <h1 className="session-title">Your learning at a glance</h1>

      <article className="session-card progress-overview-card">
        <div className="progress-overview-block progress-overview-mastered">
          <span className="section-tag">Mastered</span>
          <strong className="progress-summary-value">{snapshot.stabilitySummary.stableMastered}</strong>
          <p className="progress-summary-copy">Stable over time.</p>
        </div>

        <div className="progress-overview-block progress-overview-level">
          <span className="section-tag">Current level</span>
          <strong className="progress-level-heading">
            {levelSummary.current.code} {levelSummary.current.label}
          </strong>
          <p className="progress-summary-copy">{levelSummary.copy}</p>
          <div className="cefr-track" aria-label={`Progress from ${levelSummary.current.code} toward ${levelSummary.next.code}`}>
            <div className="cefr-track-fill" style={{ width: `${levelSummary.progressPercent}%` }} />
          </div>
          <p className="progress-level-meta">
            {levelSummary.progressPercent}% toward {levelSummary.next.code}
          </p>
        </div>

        <div className="progress-overview-block progress-overview-consistency">
          <span className="section-tag">Consistency</span>
          <strong className="progress-summary-value">{snapshot.currentStreak}</strong>
          <p className="progress-summary-copy">
            {snapshot.currentStreak === 1 ? 'day in a row' : 'days in a row'}
          </p>
          <p className="progress-level-meta">
            {snapshot.completedDays} lessons total. {encouragement}
          </p>
        </div>
      </article>

      {weakSpotCards.length > 0 && (
        <section className="progress-section">
          <div className="card-heading">
            <span className="section-tag">Weak spots</span>
            <h2>Needs a bit more support</h2>
          </div>

          <div className="progress-weakspot-grid">
            {weakSpotCards.map((card) => (
              <article key={card.title} className="session-card progress-detail-card progress-insight-card">
                <h3>{card.title}</h3>
                <p className="progress-suggestion">{card.suggestion}</p>
              </article>
            ))}
          </div>

          {snapshot.weakItems.length > 0 && (
            <article className="session-card progress-detail-card">
              <div className="card-heading">
                <span className="section-tag">Needs attention</span>
                <h3>Items that still need the most support.</h3>
              </div>
              <div className="progress-item-list">
                {snapshot.weakItems.map((item) => (
                  <div key={item.id} className="progress-item-row">
                    <div>
                      <strong>{item.front}</strong>
                      <p>{item.back || item.note || 'Saved vocabulary item'}</p>
                    </div>
                    <span>{formatWeakItemSignal(item)}</span>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}
    </section>
  )
}

function PracticePage() {
  const [profile, setProfile] = useState(() => getLearningProfile())
  const [items, setItems] = useState(() => filterKnowledgeItems(getPileItems()))
  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [results, setResults] = useState([])
  const [isStarted, setIsStarted] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setProfile(getLearningProfile())
      setItems(filterKnowledgeItems(getPileItems()))
    }

    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    refresh()

    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const currentQuestion = questions[currentIndex] || null
  const currentResult = results[currentIndex] || null
  const isComplete = isStarted && questions.length > 0 && results.length === questions.length
  const analysis = isComplete ? buildPracticeAnalysis(questions, results) : null

  const startPractice = () => {
    const generatedQuestions = buildPracticeQuestions(items, profile)
    setQuestions(generatedQuestions)
    setCurrentIndex(0)
    setSelectedAnswer('')
    setResults([])
    setIsStarted(true)
  }

  const handleSubmitAnswer = (rawAnswer) => {
    if (!currentQuestion || currentResult) return
    const answer = String(rawAnswer || '').trim()
    const normalizedUser = normalizePracticeAnswer(answer)
    const normalizedCorrect = normalizePracticeAnswer(currentQuestion.answer)
    const isCorrect = !!normalizedUser && normalizedUser === normalizedCorrect
    const result = {
      itemId: currentQuestion.itemId,
      category: currentQuestion.category,
      type: currentQuestion.type,
      prompt: currentQuestion.prompt,
      answer,
      correctAnswer: currentQuestion.answer,
      isCorrect,
    }

    recordPracticeResult(currentQuestion.itemId, {
      questionType: currentQuestion.type,
      correct: isCorrect,
    })
    setResults((current) => [...current, result])
    setSelectedAnswer(answer)
  }

  const handleNext = () => {
    setSelectedAnswer('')
    setCurrentIndex((current) => current + 1)
  }

  return (
    <section className="placeholder-page practice-page">
      <span className="section-tag">Practice</span>
      <h1 className="session-title">Mixed practice across what you&apos;ve learned.</h1>
      <p className="session-description">
        This is extra study, separate from today&apos;s lesson. BeaLingo mixes familiar material with a light bias toward items that still need more support.
      </p>

      {items.length === 0 ? (
        <p className="plan-detail">Finish a lesson first and BeaLingo will build enough material to practice here.</p>
      ) : !isStarted ? (
        <section className="session-card practice-intro-card">
          <div className="card-heading">
            <span className="section-tag">Ready</span>
            <h2>Start a mixed practice set.</h2>
          </div>
          <p className="plan-detail">
            BeaLingo will choose a balanced set from your saved words and phrases, then give you a short read on what felt strongest and weakest.
          </p>
          <div className="summary-actions">
            <button type="button" className="primary-button" onClick={startPractice}>
              Start practice
            </button>
          </div>
        </section>
      ) : questions.length === 0 ? (
        <section className="session-card practice-intro-card">
          <p className="plan-detail">There wasn&apos;t enough material to build a practice set yet. Finish another lesson and try again.</p>
        </section>
      ) : isComplete ? (
        <section className="practice-results">
          <div className="progress-summary-grid">
            <article className="session-card progress-summary-card">
              <span className="section-tag">Score</span>
              <strong className="progress-summary-value">{analysis.correct}/{analysis.total}</strong>
              <p className="progress-summary-copy">A quick read on how this set felt.</p>
            </article>
            <article className="session-card progress-summary-card">
              <span className="section-tag">Strongest</span>
              <strong className="progress-level-heading">{analysis.strongest.title}</strong>
              <p className="progress-summary-copy">{analysis.strongest.detail}</p>
            </article>
            <article className="session-card progress-summary-card">
              <span className="section-tag">Weakest</span>
              <strong className="progress-level-heading">{analysis.weakest.title}</strong>
              <p className="progress-summary-copy">{analysis.weakest.detail}</p>
            </article>
          </div>

          <article className="session-card progress-detail-card">
            <div className="card-heading">
              <span className="section-tag">Revisit next</span>
              <h3>Items worth another look.</h3>
            </div>
            <div className="progress-item-list">
              {analysis.revisitItems.length > 0 ? analysis.revisitItems.map((item) => (
                <div key={`${item.itemId}-${item.prompt}`} className="progress-item-row">
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.reason}</p>
                  </div>
                  <span>{item.typeLabel}</span>
                </div>
              )) : (
                <p className="plan-detail">Nothing stood out as especially shaky in this set.</p>
              )}
            </div>
          </article>

          <article className="session-card progress-detail-card">
            <div className="card-heading">
              <span className="section-tag">Coach takeaway</span>
              <h3>What BeaLingo noticed.</h3>
            </div>
            <p className="progress-suggestion">{analysis.takeaway}</p>
          </article>

          <div className="summary-actions">
            <button type="button" className="primary-button" onClick={startPractice}>
              Practice again
            </button>
          </div>
        </section>
      ) : (
        <section className="session-card practice-question-card">
          <div className="card-heading">
            <span className="section-tag">Practice</span>
            <h2>Question {currentIndex + 1} of {questions.length}</h2>
          </div>

          <div className="practice-question-body">
            <p className="practice-question-type">{formatPracticeTypeLabel(currentQuestion.type)}</p>
            <p className="sentence-source">{currentQuestion.prompt}</p>

            {!currentResult && currentQuestion.options ? (
              <div className="option-row practice-option-row">
                {currentQuestion.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`option-chip ${selectedAnswer === option ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedAnswer(option)
                      handleSubmitAnswer(option)
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : !currentResult ? (
              <div className="quiz-input practice-input-row">
                <input
                  className="chat-input"
                  type="text"
                  value={selectedAnswer}
                  placeholder="Type your answer..."
                  onChange={(event) => setSelectedAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && selectedAnswer.trim()) handleSubmitAnswer(selectedAnswer)
                  }}
                />
                <button
                  type="button"
                  className="primary-button send-button"
                  disabled={!selectedAnswer.trim()}
                  onClick={() => handleSubmitAnswer(selectedAnswer)}
                >
                  Submit
                </button>
              </div>
            ) : null}

            {currentResult && (
              <div className="practice-feedback-card">
                <p className={`practice-feedback-status ${currentResult.isCorrect ? 'correct' : 'incorrect'}`}>
                  {currentResult.isCorrect ? 'Correct.' : 'Not quite.'}
                </p>
                <div className="sentence-row">
                  <span className="sentence-label">Your answer</span>
                  <p className="knowledge-back">{currentResult.answer || 'Skipped'}</p>
                </div>
                <div className="sentence-row">
                  <span className="sentence-label">Correct answer</span>
                  <p className="sentence-target">{currentQuestion.answer}</p>
                </div>
                <div className="summary-actions">
                  <button type="button" className="primary-button" onClick={handleNext}>
                    {currentIndex + 1 >= questions.length ? 'See analysis' : 'Next question'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  )
}

function filterKnowledgeItems(items) {
  return items.filter((item) => isLikelyWordOrPhrase(item.front))
}

function isLikelyWordOrPhrase(text) {
  const value = String(text || '').trim()
  if (!value) return false
  if (/[.!?;:]/.test(value)) return false
  const tokens = value.split(/\s+/).filter(Boolean)
  return tokens.length <= 5
}

function groupKnowledgeItems(items) {
  const categoryOrder = [
    ['noun', 'Nouns'],
    ['verb', 'Verbs'],
    ['adjective', 'Adjectives'],
  ]

  return categoryOrder.map(([category, label]) => ({
    category,
    label,
    items: items.filter((item) => item.category === category),
  }))
}

function buildCefrSummary(profile, snapshot) {
  const levels = [
    { code: 'A1', label: 'Beginner' },
    { code: 'A2', label: 'Elementary' },
    { code: 'B1', label: 'Intermediate' },
    { code: 'B2', label: 'Upper Intermediate' },
    { code: 'C1', label: 'Advanced' },
    { code: 'C2', label: 'Proficient' },
  ]

  const normalizedLevel = String(profile?.level || profile?.assessedLevel || 'Beginner').trim().toLowerCase()
  const anchorIndex = normalizedLevel === 'advanced'
    ? 4
    : normalizedLevel === 'intermediate'
      ? 2
      : 0

  const { mastered, familiar, needsReview } = snapshot.stats
  const stableMastered = snapshot.stabilitySummary.stableMastered
  const regressions = snapshot.stabilitySummary.regressions
  const practiceAccuracy = snapshot.practiceSummary.totalAnswered > 0 ? snapshot.practiceSummary.accuracy : 0.65
  const practiceOffset = (practiceAccuracy - 0.65) * 10
  const performanceScore = stableMastered * 1.4 + mastered * 0.35 + familiar * 0.4 - needsReview * 1.5 - regressions * 1.2 + practiceOffset
  let currentIndex = anchorIndex

  if (performanceScore <= -4 && anchorIndex > 0) {
    currentIndex = anchorIndex - 1
  } else if (performanceScore >= 4 && anchorIndex < levels.length - 1) {
    currentIndex = anchorIndex + 1
  }

  const progressPercent = clamp(
    currentIndex < anchorIndex
      ? 70 + performanceScore * 6
      : currentIndex > anchorIndex
        ? 25 + (performanceScore - 4) * 7
        : 52 + performanceScore * 8,
    6,
    96,
  )

  let copy = 'This level still fits.'
  if (currentIndex < anchorIndex) {
    copy = 'A slightly easier level may fit better.'
  } else if (currentIndex > anchorIndex) {
    copy = 'You may be ready for a bigger stretch.'
  } else if (snapshot.practiceSummary.totalAnswered > 0) {
    copy = `${(practiceAccuracy * 100).toFixed(0)}% recent practice accuracy.`
  }

  return {
    current: levels[currentIndex],
    next: levels[Math.min(currentIndex + 1, levels.length - 1)],
    progressPercent,
    copy,
  }
}

function buildWeakSpotCards(snapshot) {
  const insights = snapshot.weakSpots
  if (!insights || snapshot.weakItems.length < 2) return []

  const cards = []

  if (insights.weakestFormat) {
    cards.push({
      title: insights.weakestFormat.title,
      suggestion: 'Give these a little more repetition.',
    })
  }

  if (insights.categoryInsight?.count >= 2) {
    cards.push({
      title: `${sentenceCase(insights.categoryInsight.category)}s are still shaky`,
      suggestion: `A few short ${insights.categoryInsight.category} drills should help.`,
    })
  }

  if (cards.length === 0 && insights.practiceInsight?.weakerType && insights.practiceInsight.weakerType.total >= 2) {
    cards.push({
      title: `${formatPracticeTypeLabel(insights.practiceInsight.weakerType.type)} needs more support`,
      suggestion: 'Another round in this format should help.',
    })
  }

  return cards.slice(0, 2)
}

function getStreakEncouragement(streak) {
  if (streak >= 7) return 'You are building a strong rhythm.'
  if (streak >= 3) return 'That steady return is starting to compound.'
  if (streak >= 1) return 'Each finished lesson makes the next one easier to keep.'
  return 'Finish a lesson to start the streak.'
}

function formatWeakItemSignal(item) {
  const practiceMisses = Number(item.practiceIncorrectCount) || 0
  const reviewMisses = Number(item.timesUnknown) || 0
  const regressions = countRegressionsFromItem(item)
  if (practiceMisses > 0 && reviewMisses > 0) {
    return `${reviewMisses} review · ${practiceMisses} practice`
  }
  if (practiceMisses > 0) {
    return `${practiceMisses} practice`
  }
  if (regressions > 0) {
    return `${regressions} slip back`
  }
  return `${reviewMisses} review`
}

function countRegressionsFromItem(item) {
  const history = Array.isArray(item?.reviewHistory) ? item.reviewHistory : []
  let count = 0
  for (const entry of history) {
    if (!entry?.fromStatus || !entry?.toStatus) continue
    if (entry.fromStatus === 'mastered' && entry.toStatus !== 'mastered') count += 1
    if (entry.fromStatus === 'familiar' && entry.toStatus === 'needs-review') count += 1
  }
  return count
}

function sentenceCase(value) {
  const text = String(value || '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function formatHistoryEntry(entry) {
  if (!entry) return ''
  const sourceLabel = entry.source === 'revision' ? 'during review' : entry.source === 'manual' ? 'manually' : 'in the app'
  const dateLabel = entry.date || 'recently'
  if (entry.fromStatus && entry.fromStatus !== entry.toStatus) {
    return `Changed from ${getStatusLabel(entry.fromStatus)} to ${getStatusLabel(entry.toStatus)} ${sourceLabel} on ${dateLabel}.`
  }
  return `Marked ${getStatusLabel(entry.toStatus)} ${sourceLabel} on ${dateLabel}.`
}

function buildPracticeQuestions(items, profile) {
  const eligibleItems = items.filter((item) => item.front && item.back)
  if (eligibleItems.length === 0) return []

  const levelBand = getPracticeLevelBand(profile)
  const targetCount = getPracticeQuestionTarget(levelBand, eligibleItems.length)
  const selectedItems = selectPracticeItems(eligibleItems, targetCount)
  const answerPool = eligibleItems.map((item) => item.back).filter(Boolean)
  const frontPool = eligibleItems.map((item) => item.front).filter(Boolean)

  return selectedItems.map((item, index) => {
    const type = choosePracticeQuestionType(item, levelBand, index)
    if (type === 'short_answer') {
      return {
        itemId: item.id,
        category: item.category,
        type,
        prompt: `Type the target-language word or phrase for: ${item.back}`,
        answer: item.front,
      }
    }

    if (type === 'fill_blank') {
      const prompt = buildFillBlankPrompt(item)
      const options = buildPracticeOptions(item.front, frontPool)
      if (options.length < 2) {
        return {
          itemId: item.id,
          category: item.category,
          type: 'short_answer',
          prompt: `Type the target-language word or phrase for: ${item.back}`,
          answer: item.front,
        }
      }
      return {
        itemId: item.id,
        category: item.category,
        type,
        prompt,
        answer: item.front,
        options,
      }
    }

    const options = buildPracticeOptions(item.back, answerPool)
    if (options.length < 2) {
      return {
        itemId: item.id,
        category: item.category,
        type: 'short_answer',
        prompt: `Type the target-language word or phrase for: ${item.back}`,
        answer: item.front,
      }
    }
    return {
      itemId: item.id,
      category: item.category,
      type: 'multiple_choice',
      prompt: `Choose the correct meaning of: ${item.front}`,
      answer: item.back,
      options,
    }
  })
}

function getPracticeLevelBand(profile) {
  const normalized = String(profile?.level || profile?.assessedLevel || 'Beginner').trim().toLowerCase()
  if (normalized === 'advanced') return 'advanced'
  if (normalized === 'intermediate') return 'intermediate'
  return 'beginner'
}

function getPracticeQuestionTarget(levelBand, totalItems) {
  const base = levelBand === 'advanced' ? 10 : levelBand === 'intermediate' ? 8 : 5
  if (totalItems <= 2) return Math.max(2, totalItems)
  return Math.min(base, Math.max(3, totalItems))
}

function selectPracticeItems(items, count) {
  const byCategory = new Map()
  for (const item of items) {
    const key = item.category || 'other'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(item)
  }

  const categoryOrder = Array.from(byCategory.keys()).sort((a, b) => byCategory.get(b).length - byCategory.get(a).length)
  const selected = []
  const used = new Set()

  while (selected.length < count) {
    let addedThisRound = false
    for (const category of categoryOrder) {
      if (selected.length >= count) break
      const choices = byCategory.get(category).filter((item) => !used.has(item.id))
      if (choices.length === 0) continue
      const picked = chooseWeightedPracticeItem(choices)
      if (!picked) continue
      selected.push(picked)
      used.add(picked.id)
      addedThisRound = true
    }
    if (!addedThisRound) break
  }

  while (selected.length < count && items.length > 0) {
    selected.push(chooseWeightedPracticeItem(items))
  }

  return selected.slice(0, count)
}

function chooseWeightedPracticeItem(items) {
  const weighted = items.map((item) => ({
    item,
    weight: 1 + item.timesUnknown * 0.7 + item.practiceIncorrectCount * 0.55 + (item.status === 'needs-review' ? 1.2 : item.status === 'familiar' ? 0.4 : 0),
  }))
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0)
  let randomValue = Math.random() * totalWeight
  for (const entry of weighted) {
    randomValue -= entry.weight
    if (randomValue <= 0) return entry.item
  }
  return weighted[weighted.length - 1]?.item || null
}

function choosePracticeQuestionType(item, levelBand, index) {
  const canUseShortAnswer = levelBand !== 'beginner'
  const hasExample = Boolean(item.exampleTarget && item.front)
  if (canUseShortAnswer && index % 4 === 3) return 'short_answer'
  if (hasExample && index % 2 === 1) return 'fill_blank'
  return 'multiple_choice'
}

function buildFillBlankPrompt(item) {
  const example = String(item.exampleTarget || '').trim()
  if (example && item.front && example.toLowerCase().includes(item.front.toLowerCase())) {
    const pattern = new RegExp(escapeRegExp(item.front), 'i')
    return `Fill in the blank: ${example.replace(pattern, '____')}`
  }
  return `Complete the phrase: ____ = ${item.back}`
}

function buildPracticeOptions(answer, pool) {
  const options = [answer]
  for (const candidate of pool) {
    const value = String(candidate || '').trim()
    if (value && value.toLowerCase() !== String(answer).trim().toLowerCase() && !options.includes(value)) {
      options.push(value)
    }
    if (options.length === 4) break
  }
  return shuffleArray(options).slice(0, 4)
}

function buildPracticeAnalysis(questions, results) {
  const correct = results.filter((result) => result.isCorrect).length
  const total = questions.length
  const categorySummary = summarizePracticeDimension(results, 'category')
  const typeSummary = summarizePracticeDimension(results, 'type')
  const strongest = categorySummary.best.count > 0
    ? {
        title: `${sentenceCase(categorySummary.best.key)}s`,
        detail: `That category looked strongest in this set, with ${categorySummary.best.correct}/${categorySummary.best.count} answered confidently.`,
      }
    : {
        title: 'Steady overall',
        detail: 'There was not enough signal yet to separate one clear strength.',
      }
  const weakestSource = typeSummary.worst.accuracy < categorySummary.worst.accuracy ? typeSummary.worst : categorySummary.worst
  const weakest = weakestSource.count > 0
    ? {
        title: weakestSource.dimension === 'type' ? formatPracticeTypeLabel(weakestSource.key) : `${sentenceCase(weakestSource.key)}s`,
        detail: buildWeakestDetail(weakestSource, total),
      }
    : {
        title: 'No weak spot yet',
        detail: 'There was not enough signal yet to call out a single weak area.',
      }
  const revisitItems = results
    .filter((result) => !result.isCorrect)
    .slice(0, 4)
    .map((result) => ({
      itemId: result.itemId,
      label: result.correctAnswer,
      reason: buildRevisitReason(result, total),
      typeLabel: formatPracticeTypeLabel(result.type),
    }))

  return {
    correct,
    total,
    strongest,
    weakest,
    revisitItems,
    takeaway: buildPracticeTakeaway(correct, total, revisitItems.length, weakest.title),
  }
}

function summarizePracticeDimension(results, key) {
  const summary = new Map()
  for (const result of results) {
    const bucketKey = result[key] || 'other'
    const current = summary.get(bucketKey) || { key: bucketKey, correct: 0, count: 0, accuracy: 0, dimension: key }
    current.count += 1
    if (result.isCorrect) current.correct += 1
    current.accuracy = current.correct / current.count
    summary.set(bucketKey, current)
  }
  const entries = Array.from(summary.values())
  const best = entries.slice().sort((a, b) => b.accuracy - a.accuracy || b.count - a.count)[0] || { key: '', correct: 0, count: 0, accuracy: 0, dimension: key }
  const worst = entries.slice().sort((a, b) => a.accuracy - b.accuracy || b.count - a.count)[0] || { key: '', correct: 0, count: 0, accuracy: 0, dimension: key }
  return { best, worst }
}

function buildPracticeTakeaway(correct, total, weakCount, weakestTitle) {
  if (total === 0) return 'There was not enough material to judge this set.'
  const ratio = correct / total
  if (ratio >= 0.8) {
    return weakCount === 0
      ? 'Most of this set looked solid. BeaLingo can keep giving you broad mixed review without narrowing too hard.'
      : `Most of this set looked solid. The main thing to keep an eye on is ${weakestTitle.toLowerCase()}.`
  }
  if (ratio >= 0.5) {
    return `You are holding onto a good chunk of the material, but ${weakestTitle.toLowerCase()} still need a little more repetition.`
  }
  return `This set still needs a bit more support. BeaLingo should keep the mix broad, but come back to ${weakestTitle.toLowerCase()} a little sooner.`
}

function buildWeakestDetail(summary, total) {
  if (summary.count <= 1 || total <= 2) {
    return `This is just an early hint from a small set, but ${summary.correct}/${summary.count} landed cleanly here.`
  }

  return `This needed a bit more support in this set, with ${summary.correct}/${summary.count} landing cleanly.`
}

function buildRevisitReason(result, total) {
  const promptType = formatPracticeTypeLabel(result.type).toLowerCase()
  if (total <= 2) {
    return `This one is worth another pass after the ${promptType} prompt.`
  }

  return `This came up as one to revisit after the ${promptType} prompt.`
}

function normalizePracticeAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,!?;:()"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatPracticeTypeLabel(type) {
  if (type === 'fill_blank') return 'Fill in the blank'
  if (type === 'short_answer') return 'Short answer'
  return 'Multiple choice'
}

function shuffleArray(values) {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }
  return copy
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default App
