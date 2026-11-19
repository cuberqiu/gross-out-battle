import type { Mode, ResultPayload } from '../shared/types'
import { LOSER_TITLES, WINNER_TITLES, pickTitle, syncIndex, verdictFor } from '../shared/verdicts'

export type ResultInput = {
  code: string
  mode: Mode
  players: { pid: string; name: string }[]
  gross: Record<string, number>
  matches: number
  resolved: number
  bonus: number
  forfeitPid: string | null
  forfeitReason: 'disconnect' | 'leave' | null
  finishedCount: number
}

export function buildResult(input: ResultInput): ResultPayload {
  const index = syncIndex(input.matches, input.resolved, input.bonus)
  const verdict = verdictFor(index)
  const [a, b] = input.players

  if (input.forfeitPid && a && b) {
    const leaver = input.players.find((p) => p.pid === input.forfeitPid) ?? a
    const stayer = input.players.find((p) => p.pid !== leaver.pid) ?? b
    const left = input.forfeitReason === 'leave'
    return {
      headline: left ? `${leaver.name}扔下手绢跑了` : `${leaver.name}临阵脱逃`,
      sub: '大概是去洗澡了。这局提前结束，称号照发。',
      stamp: '逃去洗澡的人',
      stampWho: leaver.name,
      stampTone: 'bad',
      verdict,
      syncIndex: index,
      gross: input.gross,
      forfeit: true,
      cards: [
        { pid: stayer.pid, name: stayer.name, title: '独臭求败', role: 'win' },
        { pid: leaver.pid, name: leaver.name, title: '逃去洗澡的人', role: 'lose' },
      ],
    }
  }

  if (input.mode === 'sync') {
    const title =
      index >= 90 ? '心灵相通的恶心搭档' : index >= 61 ? '臭味相投' : index >= 31 ? '勉强算认识' : '没有默契了本人'
    const headline =
      index >= 90
        ? '恶心都这么同步，是灵魂搭档'
        : index >= 61
          ? '臭味开始互相理解了'
          : index >= 31
            ? '你们还认识，但信号时好时坏'
            : '今天，你们正式没有默契了'
    return {
      headline,
      sub: '这局不比谁更臭，比的是心有没有灵犀。',
      stamp: title,
      stampWho: '你们俩',
      stampTone: index >= 90 ? 'good' : index >= 61 ? 'mid' : 'bad',
      verdict,
      syncIndex: index,
      gross: input.gross,
      forfeit: false,
      cards: input.players.map((p) => ({
        pid: p.pid,
        name: p.name,
        title,
        role: index >= 61 ? 'win' : 'lose',
      })),
    }
  }

  if (!a || !b) {
    return {
      headline: '房间里只剩一股味了',
      sub: '再找一个朋友一起变臭。',
      stamp: '独臭求败',
      stampWho: a?.name ?? '你',
      stampTone: 'mid',
      verdict,
      syncIndex: index,
      gross: input.gross,
      forfeit: false,
      cards: input.players.map((p) => ({ pid: p.pid, name: p.name, title: '独臭求败', role: 'tie' })),
    }
  }

  const ga = input.gross[a.pid] ?? 0
  const gb = input.gross[b.pid] ?? 0
  if (Math.abs(ga - gb) < 0.5) {
    return {
      headline: '今天谁也不比谁香',
      sub: '双臭合璧，建议一起洗澡。',
      stamp: '势均力敌的臭友',
      stampWho: '你们俩',
      stampTone: 'mid',
      verdict,
      syncIndex: index,
      gross: input.gross,
      forfeit: false,
      cards: [a, b].map((p) => ({ pid: p.pid, name: p.name, title: '势均力敌的臭友', role: 'tie' as const })),
    }
  }

  const winner = ga > gb ? a : b
  const loser = winner.pid === a.pid ? b : a
  const seed = `${input.code}:${Math.round(ga)}:${Math.round(gb)}:${input.finishedCount}`
  const loserTitle = input.finishedCount <= 1 ? '今日最臭王' : pickTitle(LOSER_TITLES, `${seed}:l`)
  const winnerTitle = pickTitle(WINNER_TITLES, `${seed}:w`)
  return {
    headline: `${winner.name} 把 ${loser.name} 糊成了传奇`,
    sub: input.mode === 'mixed' ? '臭气分出胜负，默契指数写在下面。' : '擦不掉的，就留着当纪念。',
    stamp: loserTitle,
    stampWho: loser.name,
    stampTone: 'bad',
    verdict,
    syncIndex: index,
    gross: input.gross,
    forfeit: false,
    cards: [
      { pid: winner.pid, name: winner.name, title: winnerTitle, role: 'win' },
      { pid: loser.pid, name: loser.name, title: loserTitle, role: 'lose' },
    ],
  }
}
