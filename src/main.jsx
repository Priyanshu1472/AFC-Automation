import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fade out the boot splash once the app has had a moment to paint.
// The delay keeps the intro animation legible on fast loads; the
// fallback timer guarantees the node is gone even if transitionend
// never fires.
{
  const splash = document.getElementById('app-splash')
  if (splash) {
    setTimeout(() => {
      splash.classList.add('is-hidden')
      splash.addEventListener('transitionend', () => splash.remove(), { once: true })
      setTimeout(() => splash.remove(), 1600)
    }, 1300)
  }
}
