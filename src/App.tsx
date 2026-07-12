import './App.css'

function App() {
  return (
    <main className="landing-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="TimeLeak home">
          <span className="wordmark-mark" aria-hidden="true" />
          TimeLeak
        </a>
        <span className="mvp-status">
          <span className="status-dot" aria-hidden="true" />
          Buildathon MVP
        </span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">One day. One leak. One repair.</p>
        <h1 id="hero-title">Make room for what matters beyond work.</h1>
        <p className="promise">
          Show us your 24 hours. We find the time you can honestly reclaim and
          protect it for what matters beyond work.
        </p>
        <button className="primary-cta" type="button">
          Find My TimeLeak
          <span aria-hidden="true">→</span>
        </button>
        <p className="scope-note">
          We protect sleep, essential responsibilities, and intentional rest.
        </p>
      </section>
    </main>
  )
}

export default App
