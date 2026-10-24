import { create } from 'zustand'
import type { AiEngine } from '../ai/engine'
import type { Difficulty, SearchResponse } from '../ai/types'
import {
  analyzePosition,
  applyEdit,
  boardsEqual,
  clearPosition,
  createPosition,
  setNextPlayer as withNextPlayer,
  type EditTool,
  type Position,
  type PositionProvenance,
} from '../core/position'
import type { Point } from '../core/types'
import { nextRequestId } from './requestCounter'

export interface EditorSnapshot {
  readonly position: Position
  readonly provenance: PositionProvenance | null
}

export interface EditorAnalysis {
  readonly status: 'idle' | 'running' | 'done' | 'error'
  readonly requestId: number | null
  readonly version: number | null
  /** 发起这次分析时选中的档位；结果展示必须用它，不能用当前下拉值。 */
  readonly difficulty: Difficulty | null
  readonly response: SearchResponse | null
  readonly error: string | null
}

const IDLE_ANALYSIS: EditorAnalysis = {
  status: 'idle',
  requestId: null,
  version: null,
  difficulty: null,
  response: null,
  error: null,
}

const MAX_HISTORY = 200

export interface EditorStore {
  readonly position: Position
  readonly tool: EditTool
  readonly provenance: PositionProvenance | null
  readonly history: readonly EditorSnapshot[]
  readonly future: readonly EditorSnapshot[]
  /** 分析档位；与盘面编辑分开，但切换档位也会让在飞响应失效。 */
  readonly difficulty: Difficulty
  /** 每次编辑或档位变化递增；AI 响应必须与发起时的值一致才允许写入。 */
  readonly version: number
  readonly analysis: EditorAnalysis

  setTool(tool: EditTool): void
  setDifficulty(difficulty: Difficulty): void
  edit(point: Point): void
  setNextPlayer(player: 1 | 2): void
  clear(): void
  undo(): void
  redo(): void
  load(position: Position, provenance: PositionProvenance | null): void
  analyze(): void
}

/**
 * 局面编辑器状态。
 *
 * **与 gameStore 完全分离**：这里没有正式棋局、没有 `applyMove`、没有入库回调；
 * 编辑历史是编辑器自己的快照栈，不是棋谱手顺。分析响应只写本 store，
 * 任何编辑或档位变化都会递增 `version` 并清空分析，旧响应因此不可能落到新局面上。
 */
export function createEditorStore(engine: AiEngine) {
  return create<EditorStore>()((set, get) => {
    const push = (
      position: Position,
      provenance: PositionProvenance | null,
    ): void => {
      const current = get()
      if (
        boardsEqual(current.position.board, position.board) &&
        current.position.nextPlayer === position.nextPlayer &&
        current.provenance === provenance
      ) {
        return
      }
      set({
        position,
        provenance,
        history: [
          ...current.history,
          { position: current.position, provenance: current.provenance },
        ].slice(-MAX_HISTORY),
        future: [],
        version: current.version + 1,
        analysis: IDLE_ANALYSIS,
      })
    }

    return {
      position: createPosition(),
      tool: 'black',
      provenance: null,
      history: [],
      future: [],
      difficulty: 'medium',
      version: 0,
      analysis: IDLE_ANALYSIS,

      setTool(tool) {
        set({ tool })
      },

      setDifficulty(difficulty) {
        const current = get()
        if (current.difficulty === difficulty) return
        // 档位变了，旧结果与在飞响应都不再对应当前选择。
        set({
          difficulty,
          version: current.version + 1,
          analysis: IDLE_ANALYSIS,
        })
      },

      edit(point) {
        const current = get()
        const next = applyEdit(current.position, point, current.tool)
        if (boardsEqual(current.position.board, next.board)) return
        // 自由编辑之后，原有棋谱手顺不再能证明当前盘面。
        push(next, null)
      },

      setNextPlayer(player) {
        const current = get()
        if (current.position.nextPlayer === player) return
        // 改下一手会让已知手顺不再与当前快照一致；不能再声称可重放。
        push(withNextPlayer(current.position, player), null)
      },

      clear() {
        const current = get()
        const next = clearPosition(current.position)
        if (boardsEqual(current.position.board, next.board)) return
        push(next, null)
      },

      undo() {
        const current = get()
        const previous = current.history[current.history.length - 1]
        if (previous === undefined) return
        set({
          position: previous.position,
          provenance: previous.provenance,
          history: current.history.slice(0, -1),
          future: [
            { position: current.position, provenance: current.provenance },
            ...current.future,
          ].slice(0, MAX_HISTORY),
          version: current.version + 1,
          analysis: IDLE_ANALYSIS,
        })
      },

      redo() {
        const current = get()
        const next = current.future[0]
        if (next === undefined) return
        set({
          position: next.position,
          provenance: next.provenance,
          history: [
            ...current.history,
            { position: current.position, provenance: current.provenance },
          ].slice(-MAX_HISTORY),
          future: current.future.slice(1),
          version: current.version + 1,
          analysis: IDLE_ANALYSIS,
        })
      },

      load(position, provenance) {
        set((current) => ({
          position,
          provenance,
          history: [],
          future: [],
          version: current.version + 1,
          analysis: IDLE_ANALYSIS,
        }))
      },

      analyze() {
        const current = get()
        if (current.analysis.status === 'running') return

        const report = analyzePosition(current.position)
        if (!report.searchable) {
          set({
            analysis: {
              ...IDLE_ANALYSIS,
              status: 'error',
              difficulty: current.difficulty,
              error: `当前局面不能分析：${report.issues.join('；')}`,
            },
          })
          return
        }

        const requestId = nextRequestId()
        const version = current.version
        const difficulty = current.difficulty
        set({
          analysis: {
            ...IDLE_ANALYSIS,
            status: 'running',
            requestId,
            version,
            difficulty,
          },
        })

        void engine
          .search({
            requestId,
            gameVersion: version,
            board: new Uint8Array(current.position.board),
            player: current.position.nextPlayer,
            difficulty,
            purpose: 'hint',
          })
          .then(
            (response) => {
              const latest = get()
              if (
                latest.version !== version ||
                latest.analysis.requestId !== requestId ||
                response.gameVersion !== version
              ) {
                return
              }
              set({
                analysis: {
                  status: 'done',
                  requestId,
                  version,
                  difficulty,
                  response,
                  error: null,
                },
              })
            },
            (error: unknown) => {
              const latest = get()
              if (
                latest.version !== version ||
                latest.analysis.requestId !== requestId
              ) {
                return
              }
              set({
                analysis: {
                  status: 'error',
                  requestId,
                  version,
                  difficulty,
                  response: null,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            },
          )
      },
    }
  })
}
