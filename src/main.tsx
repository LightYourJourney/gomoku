import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { bootstrapStore } from './store/useGameStore'

// 先把上次的对局接回来，再挂载界面，避免刷新时闪一下空盘。
bootstrapStore()

const container = document.getElementById('root')
if (container === null) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
