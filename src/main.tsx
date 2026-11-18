import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import './index.css'
import { appEngine, bootstrapStore } from './store/useGameStore'
import { shareTokenFromHash } from './sharing/token'
import { preloadAllPages, preloadPage } from './features/shell/pages'
import { useNavigationStore } from './store/navigationStore'

// 先把上次的对局接回来，再挂载界面，避免刷新时闪一下空盘。
bootstrapStore({ resumeAi: shareTokenFromHash(window.location.hash) === null })

const container = document.getElementById('root')
if (container === null) throw new Error('找不到 #root 挂载点')

const shared = shareTokenFromHash(window.location.hash) !== null
// 先下好地址要去的那一页再挂载（理由见 features/shell/lazyPage.ts）；下不来也照常挂载，由那一页的错误边界说。
void preloadPage(shared ? 'share' : useNavigationStore.getState().route.page).then(() => {
  createRoot(container).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
  preloadAllPages()
  // 落子 Worker 按需创建；挂载之后先建好，第一手不必等它下载、启动（见 ai/lanes.ts 的 warmUp）。
  appEngine.warmUp()
})
