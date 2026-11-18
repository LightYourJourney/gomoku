/**
 * 分享链接的 hash 前缀与取 token。单独成一个**无依赖**的模块：应用启动时（`main.tsx`、
 * `App.tsx`）只需要知道「地址里有没有分享 token」，不该为此把解码、校验那一整套
 * （`link.ts` 依赖的 `persist/transfer`）拉进入口包。
 */
export const SHARE_HASH_PREFIX = '#share='

export function shareTokenFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_HASH_PREFIX) ? hash.slice(SHARE_HASH_PREFIX.length) : null
}
