import { useRef, useState } from 'react'
import type { PersistedSession } from '../../persist/storage'
import {
  positionContentKey,
  positionFromSaved,
  type PositionStorage,
  type SavedPosition,
} from '../../persist/positions'
import type { LearningProgress } from '../../persist/progress'
import type {
  GameRecordsStorage,
  ImportRecordsResult,
} from '../../persist/gameRecords'
import { recordContentKey } from '../../persist/recordIdentity'
import {
  MAX_IMPORT_BYTES,
  parseImportText,
  type BackupGameError,
  type BackupPositionError,
  type ImportIssue,
} from '../../persist/transfer/validate'
import {
  GAME_FORMAT_VERSION,
  exportFilename,
  gameContentKey,
  gamePayloadToRecordInput,
  toBackupFile,
  toGamePayload,
  type BackupPosition,
  type BackupPreferences,
  type BackupProgress,
  type BackupSession,
  type GamePayload,
} from '../../persist/transfer/format'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Panel } from '../../components/ui/Panel'
import { Switch } from '../../components/ui/Switch'
import { downloadJson } from './download'

/**
 * 数据管理依赖的宿主能力。
 *
 * 页面容器注入，组件本身不直接连 IndexedDB / localStorage / Zustand——
 * 这一层在测试里可以替换成假实现，也避免把「导入」写成一条无法单测的
 * 浏览器脚本。
 */
export interface DataManagementServices {
  readonly now: () => number
  readonly loadProgress: () => Promise<LearningProgress>
  readonly loadSession: () => PersistedSession | null
  readonly preferences: () => BackupPreferences
  readonly onMergeProgress: (progress: BackupProgress) => Promise<void>
  readonly onRestorePreferences: (preferences: BackupPreferences) => void
  readonly onRestoreSession: (session: BackupSession) => void
}

export interface DataManagementPanelProps {
  readonly storage: GameRecordsStorage
  readonly positions: PositionStorage
  readonly services: DataManagementServices
  /** 导入成功后让棋谱列表重新读盘。 */
  readonly onImported: () => void
  /** 底层存储降级时，导出仍可用，但要说清楚数据来自本次会话。 */
  readonly degraded: boolean
}

type Preview =
  | {
      readonly kind: 'game'
      readonly game: GamePayload
      readonly duplicate: boolean
      readonly warnings: readonly ImportIssue[]
    }
  | {
      readonly kind: 'backup'
      readonly games: readonly GamePayload[]
      readonly gameErrors: readonly BackupGameError[]
      readonly progress: BackupProgress | null
      readonly preferences: BackupPreferences | null
      readonly session: BackupSession | null
      readonly positions: readonly BackupPosition[]
      readonly positionErrors: readonly BackupPositionError[]
      readonly duplicates: number
      readonly warnings: readonly ImportIssue[]
    }

type SectionOutcome = 'merged' | 'restored' | 'skipped' | 'failed' | 'absent'

interface Outcome {
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
}

function issueSummary(issues: readonly ImportIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path}：${issue.message}`)
    .join('；')
}

function sectionLabel(section: SectionOutcome, verb: '合并' | '恢复'): string {
  switch (section) {
    case 'merged':
      return `${verb}完成`
    case 'restored':
      return '已恢复'
    case 'skipped':
      return '未选择'
    case 'failed':
      return '失败'
    case 'absent':
      return '文件中没有'
  }
}

function backupPositionOf(record: SavedPosition): BackupPosition {
  const position = positionFromSaved(record)
  return {
    title: record.title === '' ? null : record.title,
    cells: [...position.board],
    nextPlayer: position.nextPlayer,
    provenance: record.provenance,
  }
}

export function DataManagementPanel({
  storage,
  positions,
  services,
  onImported,
  degraded,
}: DataManagementPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [withProgress, setWithProgress] = useState(true)
  const [withPreferences, setWithPreferences] = useState(false)
  const [withSession, setWithSession] = useState(false)
  const [withPositions, setWithPositions] = useState(true)

  function fail(message: string): void {
    setError(message)
    setOutcome(null)
  }

  async function existingKeys(): Promise<Set<string>> {
    const { records } = await storage.list()
    return new Set(records.map((record) => recordContentKey(record)))
  }

  async function openPreview(file: File): Promise<void> {
    setError(null)
    setOutcome(null)

    if (file.size > MAX_IMPORT_BYTES) {
      fail(`文件超过 ${MAX_IMPORT_BYTES} 字节，拒绝读取`)
      return
    }

    let parsed: ReturnType<typeof parseImportText>
    try {
      parsed = parseImportText(await file.text())
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
      return
    }
    if (!parsed.ok) {
      fail(issueSummary(parsed.errors))
      return
    }

    setBusy(true)
    try {
      const keys = await existingKeys()
      if (parsed.kind === 'game') {
        setPending({
          kind: 'game',
          game: parsed.game,
          duplicate: keys.has(gameContentKey(parsed.game)),
          warnings: parsed.warnings,
        })
      } else {
        let duplicates = 0
        for (const game of parsed.games) {
          const key = gameContentKey(game)
          if (keys.has(key)) duplicates += 1
          else keys.add(key)
        }
        setPending({
          kind: 'backup',
          games: parsed.games,
          gameErrors: parsed.gameErrors,
          progress: parsed.progress,
          preferences: parsed.preferences,
          session: parsed.session,
          positions: parsed.positions,
          positionErrors: parsed.positionErrors,
          duplicates,
          warnings: parsed.warnings,
        })
        setWithProgress(parsed.progress !== null)
        setWithPreferences(false)
        setWithSession(false)
        setWithPositions(parsed.positions.length > 0)
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport(): Promise<void> {
    if (pending === null) return

    const games = pending.kind === 'game' ? [pending.game] : pending.games
    const invalid = pending.kind === 'backup' ? pending.gameErrors.length : 0
    setBusy(true)
    setError(null)

    let recordsResult: ImportRecordsResult
    try {
      recordsResult = await storage.importMany(games.map(gamePayloadToRecordInput))
    } catch (err) {
      setPending(null)
      fail(err instanceof Error ? err.message : String(err))
      setBusy(false)
      return
    }

    let progress: SectionOutcome = 'absent'
    let preferences: SectionOutcome = 'absent'
    let session: SectionOutcome = 'absent'
    let positionsImported = 0
    let positionsDuplicates = 0
    let positionsFailed = 0

    if (pending.kind === 'backup') {
      if (pending.progress !== null) {
        if (!withProgress) progress = 'skipped'
        else {
          try {
            await services.onMergeProgress(pending.progress)
            progress = 'merged'
          } catch {
            progress = 'failed'
          }
        }
      }

      if (pending.preferences !== null) {
        if (!withPreferences) preferences = 'skipped'
        else {
          try {
            services.onRestorePreferences(pending.preferences)
            preferences = 'restored'
          } catch {
            preferences = 'failed'
          }
        }
      }

      if (pending.session !== null) {
        if (!withSession) session = 'skipped'
        else {
          try {
            services.onRestoreSession(pending.session)
            session = 'restored'
          } catch {
            session = 'failed'
          }
        }
      }

      if (pending.positions.length > 0 && withPositions) {
        {
          try {
            const existing = new Set(
              (await positions.list()).records.map((record) =>
                positionContentKey({
                  cells: record.cells,
                  nextPlayer: record.nextPlayer,
                  provenance: record.provenance,
                }),
              ),
            )
            for (const entry of pending.positions) {
              const key = positionContentKey({
                cells: entry.cells,
                nextPlayer: entry.nextPlayer,
                provenance: entry.provenance,
              })
              if (existing.has(key)) {
                positionsDuplicates += 1
                continue
              }
              try {
                await positions.save(
                  {
                    title: entry.title ?? '',
                    cells: entry.cells,
                    nextPlayer: entry.nextPlayer,
                    provenance: entry.provenance,
                  },
                  null,
                  services.now,
                )
                existing.add(key)
                positionsImported += 1
              } catch {
                positionsFailed += 1
              }
            }
          } catch {
            positionsFailed += pending.positions.length
          }
        }
      }
    }

    setOutcome({
      imported: recordsResult.imported,
      duplicates: recordsResult.duplicates,
      invalid,
      persisted: recordsResult.persisted,
      storage: recordsResult.storage,
      progress,
      preferences,
      session,
      positionsImported,
      positionsDuplicates,
      positionsFailed,
    })
    setPending(null)
    setBusy(false)
    onImported()
  }

  async function exportableGames(
    records: readonly Parameters<typeof toGamePayload>[0][],
    skipped: number,
  ): Promise<{ games: GamePayload[]; dropped: number }> {
    const games: GamePayload[] = []
    let dropped = skipped
    for (const record of records) {
      try {
        games.push(toGamePayload(record))
      } catch {
        dropped += 1
      }
    }
    return { games, dropped }
  }

  async function exportGames(): Promise<void> {
    setError(null)
    setExportNotice(null)
    try {
      const { records, skipped } = await storage.list()
      const { games, dropped } = await exportableGames(records, skipped)
      if (games.length === 0) {
        fail(
          dropped > 0
            ? `没有可导出的完整棋谱；已跳过 ${dropped} 条损坏/未结束记录`
            : '棋谱库是空的，没有可导出的棋谱',
        )
        return
      }
      downloadJson(
        exportFilename('games', services.now),
        toBackupFile({ games }),
      )
      setExportNotice(`已导出 ${games.length} 条${dropped > 0 ? `，跳过 ${dropped} 条损坏/未结束记录` : ''}。`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportBackup(): Promise<void> {
    setError(null)
    setExportNotice(null)
    try {
      const { records, skipped } = await storage.list()
      const progress = await services.loadProgress()
      const session = services.loadSession()
      const positionList = await positions.list()
      if (positionList.degraded) {
        fail('局面库当前不可用，无法生成完整备份；请先恢复 IndexedDB 或使用局面文件单独导出')
        return
      }
      const { games, dropped } = await exportableGames(records, skipped)
      downloadJson(
        exportFilename('backup', services.now),
        toBackupFile({
          games,
          progress,
          preferences: services.preferences(),
          session,
          positions: positionList.records.map(backupPositionOf),
        }),
      )
      setExportNotice(`已导出 ${games.length} 条棋谱、${positionList.records.length} 个局面${dropped > 0 ? `；跳过 ${dropped} 条损坏/未结束记录` : ''}。`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }

  const invalidSection = (code: 'bad_progress' | 'bad_preferences' | 'bad_session'): boolean =>
    pending?.kind === 'backup' && pending.warnings.some((warning) => warning.code === code)
  const previewImportable =
    pending === null
      ? 0
      : pending.kind === 'game'
        ? pending.duplicate
          ? 0
          : 1
        : pending.games.length - pending.duplicates
  const canImport =
    pending !== null &&
    (pending.kind === 'game' ||
      previewImportable > 0 ||
      (pending.kind === 'backup' &&
        ((withProgress && pending.progress !== null) ||
          (withPreferences && pending.preferences !== null) ||
          (withSession && pending.session !== null) ||
          (withPositions && pending.positions.length > 0))))

  return (
    <Panel title="数据管理" bodyClassName="space-y-3">
      <p className="text-xs text-faint">
        数据只保存在本机浏览器。换设备或清缓存前，先导出完整备份；导入只做合并，
        不会删除现有棋谱。
      </p>
      <p data-testid="backup-scope" className="text-xs text-warn">
        完整备份包含棋谱、学习进度、显示偏好、上次会话和自定义局面。
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void exportGames()}>
          导出全部棋谱
        </Button>
        <Button size="sm" onClick={() => void exportBackup()}>
          完整备份
        </Button>
        <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()}>
          导入文件
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          data-testid="import-file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) void openPreview(file)
          }}
        />
      </div>

      {degraded && (
        <p data-testid="data-degraded" className="text-xs text-warn">
          当前浏览器不允许持久化，导出的内容只来自本次会话；刷新后可能丢失。
        </p>
      )}

      {error !== null && (
        <p role="alert" data-testid="import-error" className="text-xs text-danger">
          {error}
        </p>
      )}

      {exportNotice !== null && (
        <p role="status" data-testid="export-notice" className="text-xs text-muted">
          {exportNotice}
        </p>
      )}

      {outcome !== null && (
        <div
          role="status"
          data-testid="import-result"
          className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted"
        >
          <p className="font-medium text-fg">
            已导入 {outcome.imported} 条，跳过重复 {outcome.duplicates} 条
            {outcome.invalid > 0 ? `，无效 ${outcome.invalid} 条` : ''}。
          </p>
          {outcome.progress !== 'absent' && (
            <p>学习/残局进度：{sectionLabel(outcome.progress, '合并')}</p>
          )}
          {outcome.preferences !== 'absent' && (
            <p>显示偏好：{outcome.preferences === 'restored' ? '已恢复' : sectionLabel(outcome.preferences, '恢复')}</p>
          )}
          {outcome.session !== 'absent' && (
            <p>当前对局会话：{outcome.session === 'restored' ? '已恢复' : sectionLabel(outcome.session, '恢复')}</p>
          )}
          {(outcome.positionsImported > 0 || outcome.positionsDuplicates > 0 || outcome.positionsFailed > 0) && (
            <p>
              自定义局面：导入 {outcome.positionsImported} 个，跳过重复 {outcome.positionsDuplicates} 个
              {outcome.positionsFailed > 0 ? `，失败 ${outcome.positionsFailed} 个` : ''}
            </p>
          )}
          {outcome.storage === 'memory' && (
            <p className="mt-1 text-warn">
              这次只写进了内存兜底：本次会话可用，刷新后可能丢失。
            </p>
          )}
          {outcome.storage === 'failed' && (
            <p className="mt-1 text-danger">
              没有写入任何棋谱：浏览器存储不可用或事务失败；旧数据未变。
            </p>
          )}
        </div>
      )}

      <Modal
        open={pending !== null}
        title="导入预览"
        onClose={() => {
          if (!busy) setPending(null)
        }}
        footer={
          <>
            <Button block disabled={busy} onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              block
              variant="primary"
              disabled={busy || !canImport}
              onClick={() => void confirmImport()}
            >
              {busy ? '处理中…' : pending?.kind === 'game' && pending.duplicate ? '跳过重复' : '确认导入'}
            </Button>
          </>
        }
      >
        {pending !== null && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-faint">
              本阶段只提供<strong>合并</strong>，不提供替换；导入不会删除任何现有棋谱。
            </p>

            {pending.kind === 'game' ? (
              <div data-testid="import-preview">
                <p className="text-xs text-faint">
                  格式：gomoku-lab.game v{GAME_FORMAT_VERSION}
                </p>
                <p>
                  单盘棋谱 · {pending.game.moves.length} 手 ·{' '}
                  {pending.game.mode === 'pve' ? '人机' : '双人'} ·{' '}
                  {pending.game.ending.type === 'resign' ? '认输' : pending.game.ending.type === 'draw' ? '和棋' : '五连'}
                </p>
                {pending.duplicate && (
                  <p className="mt-1 text-warn">这条棋谱已经在库里，导入时会跳过。</p>
                )}
              </div>
            ) : (
              <div data-testid="import-preview" className="space-y-1">
                <p>备份格式版本：2</p>
                <p>
                  棋谱 {pending.games.length + pending.gameErrors.length} 条：可导入{' '}
                  {pending.games.length - pending.duplicates} 条，重复 {pending.duplicates} 条，
                  无效 {pending.gameErrors.length} 条。
                </p>
                <p>
                  自定义局面 {pending.positions.length + pending.positionErrors.length} 个：可导入{' '}
                  {pending.positions.length} 个，无效 {pending.positionErrors.length} 个。
                </p>
                {pending.positionErrors.slice(0, 3).map((entry) => (
                  <p key={entry.index} className="text-warn">
                    第 {entry.index + 1} 个局面：{issueSummary(entry.errors)}
                  </p>
                ))}
                {pending.gameErrors.slice(0, 3).map((entry) => (
                  <p key={entry.index} className="text-warn">
                    第 {entry.index + 1} 条：{issueSummary(entry.errors)}
                  </p>
                ))}
              </div>
            )}

            {pending.kind === 'backup' && (
              <div className="space-y-2 border-t border-border pt-2">
                <p className="text-xs text-muted">
                  将写入：棋谱库；进度 / 偏好 / 会话按下列选择处理。
                </p>
                <p className="text-xs font-medium text-muted">可选的恢复内容</p>
                {pending.progress !== null ? (
                  <Switch
                    checked={withProgress}
                    onChange={setWithProgress}
                    label="合并学习与残局进度"
                    description="只添加完成项，不删除本地记录"
                  />
                ) : invalidSection('bad_progress') ? (
                  <p className="text-xs text-danger">学习进度段无效，已跳过。</p>
                ) : (
                  <p className="text-xs text-faint">文件中没有学习进度。</p>
                )}
                {pending.preferences !== null ? (
                  <Switch
                    checked={withPreferences}
                    onChange={setWithPreferences}
                    label="恢复显示偏好"
                    description="主题、坐标与音效；默认不改本地设置"
                  />
                ) : invalidSection('bad_preferences') ? (
                  <p className="text-xs text-danger">显示偏好段无效，已跳过。</p>
                ) : (
                  <p className="text-xs text-faint">文件中没有显示偏好。</p>
                )}
                {pending.session !== null ? (
                  <Switch
                    checked={withSession}
                    onChange={setWithSession}
                    label="恢复上次对局会话"
                    description="会替换当前保存的对局（可能已结束）；默认关闭"
                  />
                ) : invalidSection('bad_session') ? (
                  <p className="text-xs text-danger">对局会话段无效，已跳过。</p>
                ) : (
                  <p className="text-xs text-faint">文件中没有对局会话。</p>
                )}
                {pending.positions.length > 0 ? (
                  <Switch
                    checked={withPositions}
                    onChange={setWithPositions}
                    label="导入自定义局面"
                    description="按盘面/下一手/已知手顺去重，不删除现有局面"
                  />
                ) : (
                  <p className="text-xs text-faint">文件中没有自定义局面。</p>
                )}
              </div>
            )}

            {pending.warnings.length > 0 && (
              <p className="text-xs text-faint">
                有 {pending.warnings.length} 条警告（未知字段或无效可选段），已忽略；不会按猜测解释。
              </p>
            )}
          </div>
        )}
      </Modal>
    </Panel>
  )
}
