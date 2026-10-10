import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 工程的 vitest 没有开 globals，react-testing-library 的自动清理不会生效，
// 这里显式注册，否则上一个用例渲染的 DOM 会留在 document 里污染后续断言。
afterEach(cleanup)
