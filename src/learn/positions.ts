import type { BoardSpec } from './types'

/** 字符画写成一行行字符串，读起来就是棋盘的样子。 */
export function board(...lines: string[]): BoardSpec {
  return { lines }
}

/** 空行，用来给棋盘留白。 */
export const BLANK = '...............'

/**
 * 一个反复用到的局面：黑棋横向是一条被两头堵死的眠三，纵向还有两颗子，
 * 交点 (7,7) 空着。
 *
 * 落在交点上是一手**四三**——横向成冲四、纵向成活三，五手内强制取胜。
 * 它被四处内容共用：第 7 节讲四三、第 8 节讲这一手如何开启一条强制取胜
 * 路线（讲解页与练习各一处）、题库里的「四三」与「冲四开场」两道题。
 * **抄四遍的话改一处必漏三处**，所以放在这里。
 *
 * 白棋那几颗子只用来配平手数，都不参与威胁。
 */
export const FOUR_THREE = board(
  BLANK,
  '.....W.........',
  BLANK,
  BLANK,
  '.......B.......',
  '.......B.......',
  BLANK,
  '..W.BBB.W......',
  BLANK,
  BLANK,
  '....W..........',
  BLANK,
  '..........W....',
  BLANK,
  BLANK,
)
