import { useEffect, useState } from 'react'
import SessionPage from './pages/SessionPage.jsx'
import { getLearningProfile } from './lib/profile.js'
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
    text: 'This page will hold saved words, phrases, explanations, and anything BeaLingo decides is worth bringing back later.',
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
  const [activePage, setActivePage] = useState(() => window.localStorage.getItem('bealingo-active-page') || 'Home')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [hasProfile, setHasProfile] = useState(() => !!getLearningProfile())

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
    if (activePage === 'Home') setHasProfile(!!getLearningProfile())
  }, [activePage])

  const handleNavClick = (page) => {
    setActivePage(page)
    setIsMenuOpen(false)
  }

  return (
    <main className="app-shell">
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
        />
      )}
      {activePage === 'Session' && <SessionPage />}
      {quickPageCopy[activePage] && (
        <PlaceholderPage title={quickPageCopy[activePage].title} text={quickPageCopy[activePage].text} />
      )}
    </main>
  )
}

function HomePage({ hasProfile, onStartLearning }) {
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
          </div>
        </div>

        <div className="preview-panel">
          <div className="chat-mock" aria-label="Example coach conversation">
            <div className="chat-mock-header">
              <div className="chat-mock-avatar" aria-hidden="true">🐝</div>
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

      {!hasProfile && (
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
      )}
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

export default App
