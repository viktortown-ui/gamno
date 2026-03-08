import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { resetSwByQueryParamAndReload } from './core/cacheReset'
import { ErrorBoundary } from './ui/ErrorBoundary'

void resetSwByQueryParamAndReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><HashRouter><App /></HashRouter></ErrorBoundary>
  </StrictMode>,
)
