import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import './index.css'
import { bootstrapStore } from './store/useGameStore'
import { shareTokenFromHash } from './sharing/link'

// 先把上次的对局接回来，再挂载界面，避免刷新时闪一下空盘。
bootstrapStore({ resumeAi: shareTokenFromHash(window.location.hash) === null })

const container = document.getElementById('root')
if (container === null) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
