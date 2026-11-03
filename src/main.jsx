import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { reloadForStaleChunk } from './lib/staleChunkReload'

// A lazy page's chunk failed to load: almost always because a new version
// was deployed while this tab was open. Reload once to pick it up instead
// of showing the error screen.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForStaleChunk()) event.preventDefault()
})

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
