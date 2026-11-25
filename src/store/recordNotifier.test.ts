import { describe, expect, it } from 'vitest'
import { createGame, resign } from '../core/game'
import { BLACK } from '../core/types'
import { createRecordNotifier, type GameEndInput } from './recordNotifier'

/** 一个可以手动兑现每次写入的假存储。 */
function deferredSaves() {
  const calls: GameEndInput[] = []
  const resolvers: Array<(seq: number) => void> = []
  const onGameEnd = (input: GameEndInput): Promise<number> => {
    calls.push(input)
    return new Promise<number>((resolve) => resolvers.push(resolve))
  }
  return { calls, resolvers, onGameEnd }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('入库链在开新局时的局号隔离', () => {
  const playing = createGame()
  const context = { game: playing, mode: 'pve' as const, humanColor: BLACK, difficulty: 'easy' as const, branch: null }

  it('排队中的旧局写入仍替换旧局自己上一次入库的那条（不因 reset 变成新增）', async () => {
    const saves = deferredSaves()
    const notifier = createRecordNotifier(saves.onGameEnd, () => {})

    // 终局 → 第一次写入在飞；悔棋重下再终局 → 第二次写入排队
    notifier.notifyGameEnd(context, resign(playing, BLACK))
    notifier.notifyGameEnd(context, resign(playing, BLACK))
    // 第一次写入兑现之前开了新局
    notifier.reset()
    saves.resolvers[0](41)
    await flush()

    expect(saves.calls).toHaveLength(2)
    // 旧局的第二次写入必须替换掉第一次那条，否则同一局在库里留两条
    expect(saves.calls[1].replacesSeq).toBe(41)
  })

  it('新局的首次写入不继承上一局的号', async () => {
    const saves = deferredSaves()
    const notifier = createRecordNotifier(saves.onGameEnd, () => {})

    notifier.notifyGameEnd(context, resign(playing, BLACK))
    saves.resolvers[0](7)
    await flush()
    notifier.reset()
    notifier.notifyGameEnd(context, resign(playing, BLACK))

    expect(saves.calls[1].replacesSeq).toBeNull()
  })
})
