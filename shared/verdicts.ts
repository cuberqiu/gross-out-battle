export const LOSER_TITLES = [
  '今日最臭王',
  '人形臭袜子',
  '被史莱姆认领',
  '蟑螂贴贴对象',
  '鼻涕泡制造商',
  '全服最该洗澡',
  '没有默契了本人',
  '屏幕垃圾场馆长',
]

export const WINNER_TITLES = [
  '恶心艺术家',
  '臭气指挥官',
  '糊脸冠军',
  '远程投臭高手',
  '朋友克星',
  '臭味导演',
]

export function syncIndex(matches: number, total: number, bonus: number): number {
  const bonusPart = Math.min(40, bonus * 10)
  if (total <= 0) return Math.round(Math.min(100, bonusPart))
  const questionPart = (100 * matches) / total
  return Math.round(Math.min(100, questionPart + bonusPart))
}

export function verdictFor(index: number): string {
  if (index >= 90) return '心灵相通的恶心搭档'
  if (index >= 61) return '臭味相投'
  if (index >= 31) return '勉强算认识'
  return '已经没有默契了'
}

export function pickTitle(list: string[], seed: string): string {
  let h = 2166136261
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619)
  }
  const index = Math.abs(h) % list.length
  return list[index] ?? list[0] ?? ''
}
