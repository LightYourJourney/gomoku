import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const LIMIT = 135_000
const dir = 'dist/assets'
let files
try {
  files = readdirSync(dir).filter((name) => /^index-.*\.js$/.test(name))
} catch {
  console.error(`✗ 找不到 ${dir}；先运行 yarn build`)
  process.exit(1)
}
if (files.length !== 1) {
  console.error(`✗ 期望恰好一个入口 JS，实际 ${files.length} 个`)
  process.exit(1)
}
const size = gzipSync(readFileSync(`${dir}/${files[0]}`)).length
if (size > LIMIT) {
  console.error(`✗ 入口 JS gzip ${size} B 超过预算 ${LIMIT} B`)
  process.exit(1)
}
console.log(`✓ 入口 JS gzip ${size} B ≤ ${LIMIT} B（${files[0]}）`)
