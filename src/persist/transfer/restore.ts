import type { GameRecordsStorage, ImportRecordsResult } from '../gameRecords'
import { positionContentKey, type PositionStorage } from '../positions'
import {
  gamePayloadToRecordInput,
  type BackupPosition,
  type BackupPreferences,
  type BackupProgress,
  type BackupSession,
  type GamePayload,
} from './format'

/** 备份里一段的结果。`absent` = 文件里没有这一段；`skipped` = 有，但用户没选。 */
export type SectionOutcome = 'merged' | 'restored' | 'skipped' | 'failed' | 'absent'

/** 一次导入的分项结果——界面逐项如实说明。 */
export interface RestoreOutcome {
  readonly imported: number
  readonly duplicates: number
  readonly invalid: number
  readonly persisted: boolean
  readonly storage: ImportRecordsResult['storage']
  readonly progress: SectionOutcome
  readonly preferences: SectionOutcome
  readonly session: SectionOutcome
  readonly positionsImported: number
  readonly positionsDuplicates: number
  readonly positionsFailed: number
  readonly positionsMemory: number
}

/** 要导入什么：单盘文件只有一局；完整备份还有四段，各带「用户选没选」。 */
export type RestorePlan =
  | { readonly kind: 'game'; readonly game: GamePayload }
  | {
      readonly kind: 'backup'
      readonly games: readonly GamePayload[]
      /** 文件里没通过校验的棋谱条数，原样带进结果。 */
      readonly invalid: number
      readonly progress: BackupProgress | null
      readonly preferences: BackupPreferences | null
      readonly session: BackupSession | null
      readonly positions: readonly BackupPosition[]
      readonly include: {
        readonly progress: boolean
        readonly preferences: boolean
        readonly session: boolean
        readonly positions: boolean
      }
    }

/** 导入要写到的地方。全部注入：这段策略不认识组件、store 与浏览器。 */
export interface RestoreDeps {
  readonly records: Pick<GameRecordsStorage, 'importMany'>
  readonly positions: Pick<PositionStorage, 'list' | 'save'>
  readonly mergeProgress: (progress: BackupProgress) => Promise<void>
  readonly restorePreferences: (preferences: BackupPreferences) => void
  readonly restoreSession: (session: BackupSession) => void
  readonly now: () => number
}

export type RestoreResult =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly outcome: RestoreOutcome }

/** 一段（进度 / 偏好 / 会话）：文件里没有、没选、成功、失败四种。成功时进度记「合并」，其余记「恢复」。 */
async function restoreSection<T>(
  value: T | null,
  include: boolean,
  apply: (value: T) => void | Promise<void>,
  done: 'merged' | 'restored',
): Promise<SectionOutcome> {
  if (value === null) return 'absent'
  if (!include) return 'skipped'
  try {
    await apply(value)
    return done
  } catch {
    return 'failed'
  }
}

/**
 * 把一份已校验的导入计划写进去（评估报告 §5.5：数据安全的核心策略，不住在组件里）。
 *
 * - **不做半恢复**：备份的棋谱段整笔失败（典型是配额）时，后面的进度 / 偏好 / 会话 / 局面一律不动——
 *   否则用户会得到「棋谱一条没进去，当前对局却已被存档覆盖」。单盘棋谱没有别的段，照常给分项结果。
 * - 其余各段**各自独立成败**，一段失败不连累别的段。
 * - 局面逐条去重（与库里已有的、以及文件内彼此重复的）、逐条写；单条失败只计这一条，列不出已有局面整段计失败。
 */
export async function restoreImport(plan: RestorePlan, deps: RestoreDeps): Promise<RestoreResult> {
  const games = plan.kind === 'game' ? [plan.game] : plan.games

  let records: ImportRecordsResult
  try {
    records = await deps.records.importMany(games.map(gamePayloadToRecordInput))
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  if (records.storage === 'failed' && plan.kind === 'backup') {
    return { ok: false, error: '棋谱库写入失败（可能是空间不足）；为避免只导入一半，其余各段均未改动' }
  }

  let progress: SectionOutcome = 'absent'
  let preferences: SectionOutcome = 'absent'
  let session: SectionOutcome = 'absent'
  let positionsImported = 0
  let positionsDuplicates = 0
  let positionsFailed = 0
  let positionsMemory = 0

  if (plan.kind === 'backup') {
    progress = await restoreSection(plan.progress, plan.include.progress, deps.mergeProgress, 'merged')
    preferences = await restoreSection(plan.preferences, plan.include.preferences, deps.restorePreferences, 'restored')
    session = await restoreSection(plan.session, plan.include.session, deps.restoreSession, 'restored')

    if (plan.positions.length > 0 && plan.include.positions) {
      try {
        // 内容身份只看盘面、轮到谁、来源手顺三项（`positionContentKey`），标题与时间不参与。
        const existing = new Set((await deps.positions.list()).records.map(positionContentKey))
        for (const entry of plan.positions) {
          const key = positionContentKey(entry)
          if (existing.has(key)) {
            positionsDuplicates += 1
            continue
          }
          try {
            const saved = await deps.positions.save(
              {
                title: entry.title ?? '',
                cells: entry.cells,
                nextPlayer: entry.nextPlayer,
                provenance: entry.provenance,
              },
              null,
              deps.now,
            )
            existing.add(key)
            positionsImported += 1
            if (!saved.persisted) positionsMemory += 1
          } catch {
            positionsFailed += 1
          }
        }
      } catch {
        positionsFailed += plan.positions.length
      }
    }
  }

  return {
    ok: true,
    outcome: {
      imported: records.imported,
      duplicates: records.duplicates,
      invalid: plan.kind === 'backup' ? plan.invalid : 0,
      persisted: records.persisted,
      storage: records.storage,
      progress,
      preferences,
      session,
      positionsImported,
      positionsDuplicates,
      positionsFailed,
      positionsMemory,
    },
  }
}
