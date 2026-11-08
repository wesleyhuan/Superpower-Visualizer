import React from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import { App } from './App'
import { ErrorBoundary, AppCrashFallback } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallback={(error) => <AppCrashFallback error={error} />}>
    <App />
  </ErrorBoundary>,
)
