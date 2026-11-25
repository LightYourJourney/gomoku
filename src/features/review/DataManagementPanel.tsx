import { useRef, useState } from 'react'
import type { PersistedSession } from '../../persist/storage'
import {
  positionFromSaved,
  type PositionStorage,
  type SavedPosition,
} from '../../persist/positions'
import type { LearningProgress } from '../../persist/progress'
import type {
  GameRecord,
  GameRecordsStorage,
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
  toBackupFile,
  type BackupFile,
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
import { downloadJsonText, toJsonText } from './download'
import { restoreImport, type RestoreOutcome, type SectionOutcome } from '../../persist/transfer/restore'

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
      readonly formatVersion: number
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
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null)
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
          formatVersion: parsed.formatVersion,
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
    setBusy(true)
    setError(null)

    // 恢复策略（不做半恢复、各段独立成败、局面逐条去重）住在 `restoreImport` 里，这里只把预览与开关交给它。
    const result = await restoreImport(
      pending.kind === 'game'
        ? { kind: 'game', game: pending.game }
        : {
            kind: 'backup',
            games: pending.games,
            invalid: pending.gameErrors.length,
            progress: pending.progress,
            preferences: pending.preferences,
            session: pending.session,
            positions: pending.positions,
            include: {
              progress: withProgress,
              preferences: withPreferences,
              session: withSession,
              positions: withPositions,
            },
          },
      {
        records: storage,
        positions,
        mergeProgress: (progress) => services.onMergeProgress(progress),
        restorePreferences: (preferences) => services.onRestorePreferences(preferences),
        restoreSession: (session) => services.onRestoreSession(session),
        now: services.now,
      },
    )

    setPending(null)
    if (!result.ok) {
      fail(result.error)
      setBusy(false)
      return
    }
    setOutcome(result.outcome)
    setBusy(false)
    onImported()
  }

  function exportableGames(
    records: readonly GameRecord[],
    skipped: number,
  ): { games: GamePayload[]; dropped: number } {
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

  /**
   * 导出前自检：**本程序导不回来的文件不下载。**
   *
   * 导入有上限（局数、总手数、局面数、文件大小……），导出原先不查——大库用户拿到
   * 的是一份「成功」却恢复不了的备份，而他可能正拿它当清数据前的保险。
   * 直接拿导入解析器量**将要下载的那份文本**：口径与导入逐字一致，不必在两处各抄一遍上限。
   * 解析器有「接近 10 MiB 不卡死」的用例钉着，导出本来就要整份序列化，多一次解析是同量级开销。
   */
  function downloadIfRestorable(filename: string, file: BackupFile): boolean {
    const text = toJsonText(file)
    const check = parseImportText(text)
    if (!check.ok) {
      fail(
        `这份文件超出了导入上限，本程序导不回来，所以没有下载：${check.errors
          .map((issue) => issue.message)
          .join('；')}。请先删掉一部分棋谱或局面再导出。`,
      )
      return false
    }
    /*
     * 整体 ok 还不够：可选段（进度 / 偏好 / 会话）校验不过时解析器只是「跳过、记一条告警」，
     * 单局 / 单个局面坏了也只是不导入那一条。导出的东西每一条都必须原样导得回来——
     * 少一段、少一局都是这份备份在悄悄缩水（分支来源键超长那次就是会话段被跳过）。
     */
    const lost: string[] = []
    if (check.kind === 'backup') {
      if (check.games.length !== file.games.length) lost.push(`${file.games.length - check.games.length} 局棋谱`)
      if (check.positions.length !== (file.positions?.length ?? 0)) lost.push('部分局面')
      if (file.progress !== undefined && check.progress === null) lost.push('学习进度段')
      if (file.preferences !== undefined && check.preferences === null) lost.push('显示偏好段')
      if (file.session !== undefined && file.session !== null && check.session === null) lost.push('进行中的对局（会话段）')
    }
    if (lost.length > 0) {
      fail(`这份文件导回来会丢掉${lost.join('、')}，所以没有下载。这是本程序的缺陷，请反馈。`)
      return false
    }
    downloadJsonText(filename, text)
    return true
  }

  async function exportGames(): Promise<void> {
    setError(null)
    setExportNotice(null)
    try {
      const { records, skipped, degraded: recordsDegraded } = await storage.list()
      // 降级时 records 来自内存兜底（通常是空的）：照常导出会得到一份「成功」的空备份，
      // 而用户可能正是拿它当清数据前的保险。与局面库同一口径：拒绝，并说清楚原因。
      if (recordsDegraded) {
        fail(
          '棋谱库当前不可用（浏览器不允许持久化或被其他标签页占用），无法导出棋谱；请恢复存储后重试',
        )
        return
      }
      const { games, dropped } = exportableGames(records, skipped)
      if (games.length === 0) {
        fail(
          dropped > 0
            ? `没有可导出的完整棋谱；已跳过 ${dropped} 条损坏/未结束记录`
            : '棋谱库是空的，没有可导出的棋谱',
        )
        return
      }
      if (!downloadIfRestorable(exportFilename('games', services.now), toBackupFile({ games }))) return
      setExportNotice(`已导出 ${games.length} 条${dropped > 0 ? `，跳过 ${dropped} 条损坏/未结束记录` : ''}。`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }

  async function exportBackup(): Promise<void> {
    setError(null)
    setExportNotice(null)
    try {
      const { records, skipped, degraded: recordsDegraded } = await storage.list()
      if (recordsDegraded) {
        fail(
          '棋谱库当前不可用（浏览器不允许持久化或被其他标签页占用），无法生成完整备份；请恢复存储后重试',
        )
        return
      }
      const progress = await services.loadProgress()
      const session = services.loadSession()
      const positionList = await positions.list()
      if (positionList.degraded) {
        fail('局面库当前不可用，无法生成完整备份；请先恢复 IndexedDB 或使用局面文件单独导出')
        return
      }
      const { games, dropped } = exportableGames(records, skipped)
      const backup = toBackupFile({
        games,
        progress,
        preferences: services.preferences(),
        session,
        positions: positionList.records.map(backupPositionOf),
      })
      if (!downloadIfRestorable(exportFilename('backup', services.now), backup)) return
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
              {outcome.positionsMemory > 0 ? `，其中 ${outcome.positionsMemory} 个仅本次会话可用` : ''}
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
                <p>备份格式版本：{pending.formatVersion}</p>
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
