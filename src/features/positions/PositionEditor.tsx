import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { AiEngine } from '../../ai/engine'
import { AVAILABLE_DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_PARAMS, isDifficulty } from '../../ai/difficulty'
import type { GameRecord, GameRecordsStorage } from '../../persist/gameRecords'
import type { PositionStorage, SavedPosition } from '../../persist/positions'
import { inputFromPosition, positionFromSaved } from '../../persist/positions'
import { analyzePosition, positionFromReplay, type EditTool } from '../../core/position'
import { formatPoint } from '../../lib/coords'
import { cx } from '../../lib/cx'
import { createEditorStore } from '../../store/editorStore'
import { useSettingsStore } from '../../store/settingsStore'
import { Board } from '../../components/board/Board'
import { BoardStage } from '../../components/board/BoardStage'
import { Button } from '../../components/ui/Button'
import { Panel } from '../../components/ui/Panel'
import { PageShell, SIDE_PANEL_CLASS } from '../shell/PageShell'
import { downloadJson } from '../review/download'
import { exportFilename } from '../../persist/transfer/format'
import { parsePositionText, toPositionFile } from '../../persist/transfer/position'
import { ShareLinkDialog, type ShareLinkResult } from '../review/ShareLinkDialog'
import { createPositionShare, shareLink } from '../../sharing/link'

export interface PositionEditorProps {
  readonly engine: AiEngine
  readonly records: GameRecordsStorage
  readonly positions: PositionStorage
  readonly onExit: () => void
  readonly now?: () => number
}

const TOOLS: readonly { value: EditTool; label: string }[] = [
  { value: 'black', label: '黑棋' },
  { value: 'white', label: '白棋' },
  { value: 'erase', label: '擦除' },
]

function recordLabel(record: GameRecord): string {
  const mode = record.mode === 'pve' ? '人机' : '双人'
  return `#${record.seq} · ${mode} · ${record.moves.length} 手`
}

/** 旧 v1 局面没有时间；不要用 1970 年假装知道。 */
function savedAtLabel(record: SavedPosition): string {
  if (record.updatedAt === null) return '时间未知（旧记录）'
  const date = new Date(record.updatedAt)
  if (Number.isNaN(date.getTime())) return '时间未知（无效时间）'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function PositionEditor({
  engine,
  records,
  positions,
  onExit,
  now = Date.now,
}: PositionEditorProps) {
  const [editor] = useState(() => createEditorStore(engine))
  const state = useStore(editor)
  const showCoords = useSettingsStore((settings) => settings.showCoords)

  const [recordsList, setRecordsList] = useState<readonly GameRecord[]>([])
  const [saved, setSaved] = useState<readonly SavedPosition[]>([])
  const [positionsDegraded, setPositionsDegraded] = useState(false)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [title, setTitle] = useState('未命名局面')
  const [recordSeq, setRecordSeq] = useState('')
  const [ply, setPly] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void records.list().then((result) => {
      if (alive) setRecordsList(result.records)
    })
    void positions.list().then((result) => {
      if (alive) {
        setSaved(result.records)
        setPositionsDegraded(result.degraded)
      }
    })
    return () => {
      alive = false
    }
  }, [records, positions])

  const report = analyzePosition(state.position)
  const selectedSaved = saved.find((entry) => entry.id === savedId) ?? null
  const analysis = state.analysis
  const shownDifficulty = analysis.difficulty ?? state.difficulty
  const candidates = analysis.status === 'done' ? (analysis.response?.candidates ?? []) : []
  const marks = candidates.map((candidate, index) => ({
    point: candidate.move,
    label: String(index + 1),
  }))

  function flash(message: string): void {
    setNotice(message)
    setError(null)
  }

  function fail(message: string): void {
    setError(message)
    setNotice(null)
  }

  function loadSaved(record: SavedPosition): void {
    editor.getState().load(positionFromSaved(record), record.provenance)
    setSavedId(record.id)
    setTitle(record.title)
    setConfirmDelete(false)
    flash(`已打开「${record.title}」`)
  }

  function loadRecordPly(): void {
    const record = recordsList.find((entry) => String(entry.seq) === recordSeq)
    if (record === undefined) {
      fail('先选择一局棋谱')
      return
    }
    const n = Number(ply)
    if (!Number.isInteger(n) || n < 0 || n > record.moves.length) {
      fail(`手数必须在 0–${record.moves.length} 之间`)
      return
    }
    const loaded = positionFromReplay(record.moves, record.firstPlayer, n)
    editor.getState().load(loaded.position, loaded.provenance)
    setSavedId(null)
    setConfirmDelete(false)
    setTitle(`棋谱 #${record.seq} 第 ${n} 手`)
    flash(`已载入棋谱 #${record.seq} 第 ${n} 手`)
  }

  async function save(): Promise<void> {
    const clean = title.trim() === '' ? '未命名局面' : title.trim()
    const result = await positions.save(
      inputFromPosition(state.position, clean, state.provenance),
      savedId,
      now,
    )
    setSavedId(result.record.id)
    setConfirmDelete(false)
    setTitle(result.record.title)
    const list = await positions.list()
    setSaved(list.records)
    flash(
      result.persisted
        ? `已保存「${result.record.title}」`
        : '只写进了内存兜底：本次会话可用，刷新后可能丢失',
    )
  }

  async function deleteSaved(): Promise<void> {
    if (savedId === null) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const target = selectedSaved
    const result = await positions.delete(savedId)
    const name = target?.title ?? '局面'
    if (!result.deleted) {
      // 不能把当前选择清掉：记录可能仍在库里，刷新列表会把它藏起来。
      setConfirmDelete(false)
      fail(`删除「${name}」失败：局面库不可用，记录可能仍在`)
      return
    }
    const list = await positions.list()
    setSaved(list.records)
    setSavedId(null)
    setConfirmDelete(false)
    if (result.persisted) {
      flash(`已删除「${name}」`)
    } else {
      flash(`只删了本次会话的「${name}」：刷新后可能仍在`)
    }
  }

  function sharePosition(): ShareLinkResult {
    return shareLink(
      createPositionShare(
        state.position,
        title.trim() || '未命名局面',
        state.provenance,
      ),
      { origin: window.location.origin, pathname: window.location.pathname },
    )
  }

  function exportPosition(): void {
    try {
      downloadJson(
        exportFilename('position', now),
        toPositionFile(state.position, title.trim() || null, state.provenance),
      )
      flash('局面文件已导出')
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }

  async function importPosition(file: File): Promise<void> {
    try {
      const parsed = parsePositionText(await file.text())
      if (!parsed.ok) {
        fail(parsed.errors.map((issue) => `${issue.path}：${issue.message}`).join('；'))
        return
      }
      editor.getState().load(parsed.position, parsed.provenance)
      setSavedId(null)
      setConfirmDelete(false)
      setTitle(parsed.title ?? '导入的局面')
      flash('局面文件已导入')
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }

  const nextPlayerLabel = state.position.nextPlayer === 1 ? '黑棋' : '白棋'

  return (
    <PageShell
      key="position-editor"
      variant="flush"
      toolbar={
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Button onClick={onExit}>← 棋谱列表</Button>
          <h1 className="truncate text-xl font-semibold text-fg">局面研究</h1>
        </div>
      }
    >
      <BoardStage>
        <Board
          board={state.position.board}
          lastMove={null}
          winLine={report.wins[0]?.points ?? null}
          nextPlayer={state.position.nextPlayer}
          showCoords={showCoords}
          interactive
          editMode
          onPlay={() => {}}
          onEdit={(point) => editor.getState().edit(point)}
          marks={marks}
        />
      </BoardStage>

      <aside className={cx('order-2 space-y-3 px-3 pb-4 wide-layout:order-2', SIDE_PANEL_CLASS)}>
        <Panel title="编辑工具" bodyClassName="space-y-3">
          <div role="group" aria-label="编辑工具" className="flex flex-wrap gap-2">
            {TOOLS.map((tool) => (
              <Button
                key={tool.value}
                size="sm"
                variant={state.tool === tool.value ? 'primary' : 'secondary'}
                aria-pressed={state.tool === tool.value}
                aria-label={`工具：${tool.label}`}
                onClick={() => editor.getState().setTool(tool.value)}
              >
                {tool.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-faint">下一手</span>
            <div role="group" aria-label="下一手颜色" className="flex gap-2">
              <Button
                size="sm"
                variant={state.position.nextPlayer === 1 ? 'primary' : 'secondary'}
                aria-pressed={state.position.nextPlayer === 1}
                aria-label="下一手：黑棋"
                onClick={() => editor.getState().setNextPlayer(1)}
              >
                黑棋
              </Button>
              <Button
                size="sm"
                variant={state.position.nextPlayer === 2 ? 'primary' : 'secondary'}
                aria-pressed={state.position.nextPlayer === 2}
                aria-label="下一手：白棋"
                onClick={() => editor.getState().setNextPlayer(2)}
              >
                白棋
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={state.history.length === 0}
              onClick={() => editor.getState().undo()}
            >
              撤销
            </Button>
            <Button
              size="sm"
              disabled={state.future.length === 0}
              onClick={() => editor.getState().redo()}
            >
              重做
            </Button>
            {/* 清空可撤销；danger 留给不可撤销的“删除已保存局面”。 */}
            <Button size="sm" variant="secondary" onClick={() => editor.getState().clear()}>
              清空
            </Button>
          </div>

          <p className="text-xs text-faint">
            当前工具：{TOOLS.find((tool) => tool.value === state.tool)?.label}； 下一手：
            {nextPlayerLabel}。点击或回车可编辑任意交叉点。
          </p>
        </Panel>

        <Panel title="局面信息" bodyClassName="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-faint">棋子</span>
            <span className="font-mono tabular-nums">
              黑 {report.black} / 白 {report.white}
            </span>
          </div>
          <p data-testid="position-kind" className="text-xs">
            {state.provenance === null ? (
              <span className="text-warn">自由摆盘</span>
            ) : (
              <span className="text-muted">来自棋谱第 {state.provenance.ply} 手（已知手顺）</span>
            )}
          </p>
          {report.issues.length === 0 ? (
            <p className="text-xs text-faint">
              静态检查通过。它不证明存在合法历史；自由摆盘仍可保存研究。
            </p>
          ) : (
            <ul role="alert" data-testid="position-issues" className="space-y-1 text-xs text-warn">
              {report.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="AI 分析" bodyClassName="space-y-2">
          <label className="block text-xs text-faint">
            分析档位
            <select
              aria-label="分析档位"
              value={state.difficulty}
              disabled={analysis.status === 'running'}
              onChange={(event) => {
                if (isDifficulty(event.target.value)) {
                  editor.getState().setDifficulty(event.target.value)
                }
              }}
              className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {AVAILABLE_DIFFICULTIES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {DIFFICULTY_LABELS[difficulty]}
                </option>
              ))}
            </select>
          </label>
          <Button
            block
            variant="primary"
            disabled={!report.searchable || analysis.status === 'running'}
            onClick={() => editor.getState().analyze()}
          >
            {analysis.status === 'running' ? '分析中…' : '分析当前局面'}
          </Button>
          {!report.searchable && (
            <p className="text-xs text-faint">当前局面不满足搜索条件，先处理上方提示。</p>
          )}
          {analysis.status === 'done' && analysis.response !== null && (
            <div data-testid="position-analysis" className="space-y-1 text-xs">
              <p className="text-faint">
                引擎：{DIFFICULTY_LABELS[shownDifficulty]} · 深度 {analysis.response.depth} 层 ·
                节点 {analysis.response.nodes} · {analysis.response.elapsedMs} ms · 结论{' '}
                {analysis.response.confidence === 'exact' ? '精确' : '启发式'}
              </p>
              <details className="text-faint">
                <summary className="cursor-pointer">技术细节</summary>
                <p data-testid="position-analysis-budget" className="mt-1">
                  时间预算：{DIFFICULTY_PARAMS[shownDifficulty].budgetMs}ms
                </p>
              </details>
              <ul className="space-y-1">
                {candidates.map((candidate, index) => (
                  <li key={`${candidate.move.x}-${candidate.move.y}`}>
                    {index + 1}. {formatPoint(candidate.move)} · 评分 {candidate.score}
                  </li>
                ))}
              </ul>
              {analysis.response.confidence === 'heuristic' && (
                <p className="text-warn">预算内未搜完，这一手是启发式建议，不保证最优。</p>
              )}
            </div>
          )}
          {analysis.status === 'error' && analysis.error !== null && (
            <p role="alert" data-testid="position-analysis-error" className="text-xs text-warn">
              {analysis.error}
            </p>
          )}
        </Panel>

        <Panel title="保存与研究" bodyClassName="space-y-3">
          <label className="block text-xs text-faint">
            局面名称
            <input
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void save()}>
              保存局面
            </Button>
            <Button size="sm" onClick={exportPosition}>
              导出局面文件
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              导入局面文件
            </Button>
            <Button size="sm" onClick={() => setShareOpen(true)}>
              分享局面
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="position-file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void importPosition(file)
              }}
            />
          </div>

          <label className="block text-xs text-faint">
            打开已保存局面
            <select
              value={savedId === null ? '' : String(savedId)}
              onChange={(event) => {
                const record = saved.find((entry) => String(entry.id) === event.target.value)
                if (record !== undefined) loadSaved(record)
              }}
              className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
            >
              <option value="">选择…</option>
              {saved.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
            </select>
          </label>

          {selectedSaved !== null && (
            <div className="space-y-2">
              <p data-testid="position-saved-at" className="text-xs text-faint">
                最近保存：{savedAtLabel(selectedSaved)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={confirmDelete ? 'danger' : 'secondary'}
                  onClick={() => void deleteSaved()}
                >
                  {confirmDelete ? '确认删除' : '删除已保存局面'}
                </Button>
                {confirmDelete && (
                  <Button size="sm" onClick={() => setConfirmDelete(false)}>
                    取消
                  </Button>
                )}
              </div>
              {confirmDelete && (
                <p className="text-xs text-warn">
                  删除的是已保存记录；当前棋盘仍保留，可重新保存。
                </p>
              )}
            </div>
          )}

          <div className="border-t border-border pt-2">
            <p className="text-xs font-medium text-muted">从合法棋谱载入某一手</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                aria-label="棋谱"
                value={recordSeq}
                onChange={(event) => {
                  setRecordSeq(event.target.value)
                  const record = recordsList.find(
                    (entry) => String(entry.seq) === event.target.value,
                  )
                  setPly(record === undefined ? '0' : String(record.moves.length))
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg"
              >
                <option value="">选择棋谱…</option>
                {recordsList.map((record) => (
                  <option key={record.seq} value={record.seq}>
                    {recordLabel(record)}
                  </option>
                ))}
              </select>
              <input
                aria-label="载入手数"
                type="number"
                min={0}
                max={999}
                value={ply}
                onChange={(event) => setPly(event.target.value)}
                className="w-20 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg"
              />
              <Button size="sm" onClick={loadRecordPly}>
                载入
              </Button>
            </div>
          </div>

          {positionsDegraded && (
            <p data-testid="position-degraded" className="text-xs text-warn">
              当前浏览器不允许持久化：保存的局面只在本次会话可用，刷新后可能丢失。
            </p>
          )}
          {error !== null && (
            <p role="alert" data-testid="position-error" className="text-xs text-danger">
              {error}
            </p>
          )}
          {notice !== null && (
            <p role="status" data-testid="position-notice" className="text-xs text-muted">
              {notice}
            </p>
          )}
        </Panel>
      </aside>

      <ShareLinkDialog
        open={shareOpen}
        title="分享局面"
        onClose={() => setShareOpen(false)}
        options={[
          {
            id: 'position',
            label: '分享当前局面',
            description:
              state.provenance === null
                ? '自由摆盘；接收者可保存为自定义局面'
                : `来自棋谱第 ${state.provenance.ply} 手；接收者可保存为自定义局面`,
            generate: sharePosition,
          },
        ]}
      />
    </PageShell>
  )
}
