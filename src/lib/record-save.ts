/**
 * 终局入库的进度，供对局结束时的界面显示。
 *
 * `absent` 只出现在「恢复了一局已经结束的存档」：那不是刚刚入库，而是查过库之后
 * 确认不在里面。`idle` 表示既没有动作、也没有结论（进行中，或查不了）。
 */
export type RecordSaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'absent'
