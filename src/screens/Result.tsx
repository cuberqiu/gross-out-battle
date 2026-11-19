import { playersOf } from '../bits'
import { useGame } from '../store'

export function Result() {
  const game = useGame()
  const snapshot = game.snapshot
  if (!snapshot?.result) return null
  const result = snapshot.result
  const { me, opp } = playersOf(snapshot)
  const max = Math.max(1, ...result.cards.map((card) => result.gross[card.pid] ?? 0))

  return (
    <div className="result-page">
      <section className="result" data-testid="result-screen">
        <p className="eyebrow">本局结算</p>
        <h1 data-testid="result-headline">{result.headline}</h1>
        <p className="sub">{result.sub}</p>
        <div className={`stamp tone-${result.stampTone}`} data-testid="result-stamp">
          {result.stamp}
        </div>
        <p className="stamp-who">颁给 {result.stampWho}</p>
        <p className="verdict" data-testid="result-verdict">
          默契指数 <strong data-testid="result-sync">{result.syncIndex}</strong>% · {result.verdict}
        </p>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${result.syncIndex}%` }} />
        </div>
        <ul className="scoreboard">
          {result.cards.map((card) => (
            <li key={card.pid} data-role={card.role}>
              <div className="who">
                <b>{card.name}</b>
                {card.pid === snapshot.you && <em>你</em>}
                <small>{card.role === 'win' ? '胜' : card.role === 'lose' ? '负' : '平'}</small>
              </div>
              <div className="bar">
                <span style={{ width: `${((result.gross[card.pid] ?? 0) / max) * 100}%` }} />
              </div>
              <strong data-testid="result-gross">{result.gross[card.pid] ?? 0}</strong>
              <em className="title">{card.title}</em>
            </li>
          ))}
        </ul>
        <div className="result-actions">
          <button
            type="button"
            className="btn-go"
            data-testid="rematch"
            disabled={Boolean(me?.rematch) || !opp?.connected}
            onClick={game.rematch}
          >
            {!opp?.connected ? '对方还没回来' : me?.rematch ? '等待对方擦完手…' : '再来一局'}
          </button>
          <button type="button" className="text-btn" data-testid="leave" onClick={game.leave}>
            回大厅
          </button>
        </div>
      </section>
    </div>
  )
}
