import { useState } from 'react'
import type { Mode } from '../../shared/types'
import { normalizeCode } from '../../shared/types'
import { ItemArt } from '../art'
import { MuteButton } from '../bits'
import { useGame } from '../store'

const NAMES = ['臭臭侠', '番茄投手', '鼻涕泡泡', '袜子成精', '香菜反对者', '榴莲勇士']

const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: 'gross', name: '恶心大作战', desc: '60 秒互扔臭东西，看谁把对方的屏幕糊得更满。' },
  { id: 'sync', name: '默契大考验', desc: '同一道傻题。选一样就默契 +1；选不一样就一起被糊，并听见「没有默契了」。' },
  { id: 'mixed', name: '混合加倍', desc: '扔一会儿，考一会儿。臭气和默契一起结算。' },
]

export function Lobby() {
  const game = useGame()
  const [name, setName] = useState(() => localStorage.getItem('gross-name') || '')
  const [code, setCode] = useState(() => normalizeCode(new URLSearchParams(location.search).get('room') || ''))
  const [mode, setMode] = useState<Mode>('gross')
  const ready = game.connected && name.trim().length > 0

  return (
    <div className="lobby" data-testid="lobby-screen">
      <div className="floaters" aria-hidden="true">
        <span style={{ left: '6%', animationDelay: '0s' }}>🧦</span>
        <span style={{ left: '18%', animationDelay: '1.2s' }}>🍅</span>
        <span style={{ left: '78%', animationDelay: '0.4s' }}>🪳</span>
        <span style={{ left: '88%', animationDelay: '1.8s' }}>💨</span>
      </div>
      <div className="lobby-inner">
        <header className="hero">
          <p className="eyebrow">两人在线 · 卡通级臭 · 不伤身</p>
          <h1>
            互相恶心
            <br />
            大作战
          </h1>
          <p className="tagline">把臭袜子、烂番茄和蟑螂贴纸，精准投到朋友的屏幕上。选错答案的话，你们会一起想起那句：没有默契了。</p>
          <div className="mascot" aria-hidden="true">
            <ItemArt id="sock" size={84} />
            <ItemArt id="tomato" size={96} />
            <ItemArt id="slime" size={88} />
            <ItemArt id="roach" size={74} />
          </div>
        </header>
        <section className="panel">
          <div className="panel-top">
            <h2>先报上外号</h2>
            <MuteButton />
          </div>
          <label className="field">
            <span>你的外号</span>
            <input
              data-testid="nickname"
              maxLength={12}
              value={name}
              placeholder="比如 臭臭侠"
              autoComplete="nickname"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="chips">
            {NAMES.map((chip) => (
              <button key={chip} type="button" onClick={() => setName(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <div className="modes" role="radiogroup" aria-label="玩法">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mode"
                data-testid={`mode-${item.id}`}
                data-selected={mode === item.id ? 'true' : 'false'}
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
              >
                <strong>{item.name}</strong>
                <small>{item.desc}</small>
              </button>
            ))}
          </div>
          {code.length === 4 && <p className="invite">朋友把房间 {code} 递过来了，填好外号就能加入。</p>}
          <button
            type="button"
            className="btn-go"
            data-testid="create-room"
            disabled={!ready}
            onClick={() => game.createRoom(name, mode)}
          >
            {game.connected ? '创建房间，开始恶心' : '正在接通臭气频道…'}
          </button>
          <form
            className="join-row"
            onSubmit={(event) => {
              event.preventDefault()
              if (ready && code.length === 4) game.joinRoom(name, code)
            }}
          >
            <input
              data-testid="room-code-input"
              value={code}
              placeholder="4位房间码"
              aria-label="房间码"
              maxLength={4}
              autoCapitalize="characters"
              onChange={(event) => setCode(normalizeCode(event.target.value))}
            />
            <button type="submit" data-testid="join-room" disabled={!ready || code.length !== 4}>
              加入
            </button>
          </form>
          <button type="button" className="text-btn" data-testid="open-howto" onClick={game.openHelp}>
            怎么玩
          </button>
          <p className="fine">请只对愿意一起变臭的朋友使用。臭是画出来的，声音是算出来的。</p>
        </section>
      </div>
    </div>
  )
}
