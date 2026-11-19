import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { MuteButton, playersOf } from '../bits'
import { useGame } from '../store'

const MODE_NAME = { gross: '恶心大作战', sync: '默契大考验', mixed: '混合加倍' }

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function Waiting() {
  const game = useGame()
  const snapshot = game.snapshot
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!snapshot) return
    const next = `${location.origin}${location.pathname}?room=${snapshot.code}`
    setLink(next)
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, next, {
      width: 168,
      margin: 1,
      color: { dark: '#1b1028', light: '#fff8ea' },
    }).catch(() => undefined)
  }, [snapshot])

  if (!snapshot) return null
  const { me, opp } = playersOf(snapshot)
  const full = Boolean(opp?.connected)

  return (
    <div className="wait" data-testid="waiting-screen">
      <div className="wait-card">
        <div className="panel-top">
          <p className="eyebrow">{MODE_NAME[snapshot.mode]}</p>
          <MuteButton />
        </div>
        <h1>把码发给那个没有默契的朋友</h1>
        <p className="code" data-testid="room-code">
          {snapshot.code}
        </p>
        <canvas ref={canvasRef} data-testid="qr" />
        <p className="share-url" data-testid="share-url">
          {link}
        </p>
        <div className="row">
          <button
            type="button"
            data-testid="copy-code"
            onClick={() => void copyText(snapshot.code).then((ok) => game.flash(ok ? '房间码已复制' : '复制失败，请手动选择'))}
          >
            复制房间码
          </button>
          <button
            type="button"
            data-testid="copy-link"
            onClick={() => void copyText(link).then((ok) => game.flash(ok ? '链接已复制' : '复制失败，请手动选择'))}
          >
            复制链接
          </button>
          <button
            type="button"
            data-testid="share"
            onClick={() => {
              const payload = { title: '互相恶心大作战', text: `房间码 ${snapshot.code}，来互相恶心`, url: link }
              if (navigator.share) {
                navigator.share(payload).catch(() => void copyText(link))
              } else {
                void copyText(link).then((ok) => game.flash(ok ? '链接已复制' : '先自己把链接发出去'))
              }
            }}
          >
            发给朋友
          </button>
        </div>
        <ul className="roster">
          {snapshot.players.map((player) => (
            <li key={player.pid} data-testid="player" data-connected={player.connected ? 'yes' : 'no'}>
              <span className="avatar">{player.name.slice(0, 1)}</span>
              <span>{player.name}</span>
              {player.pid === snapshot.you && <em>你</em>}
              {player.host && <em>房主</em>}
              {!player.connected && <em>掉线</em>}
            </li>
          ))}
        </ul>
        <p className="status">{full ? '人齐了。捏住鼻子。' : '还差一个愿意被恶心的朋友…'}</p>
        {me?.host ? (
          <button type="button" className="btn-go" data-testid="start-game" disabled={!full} onClick={game.startGame}>
            开臭！
          </button>
        ) : (
          <p className="wait-host" data-testid="wait-host">
            等房主开臭
          </p>
        )}
        <div className="row">
          <button type="button" className="text-btn" onClick={game.openHelp}>
            怎么玩
          </button>
          <button type="button" className="text-btn" data-testid="leave" onClick={game.leave}>
            回大厅
          </button>
        </div>
      </div>
    </div>
  )
}
