import { useEffect } from 'react'
import { useGame } from '../store'

const STEPS = [
  '一个人创建房间，把 4 位房间码或链接发给朋友。两台手机、两台电脑，或者一台电脑开两个窗口，都能玩。',
  '恶心大作战：先点一个道具，再点屏幕。它会飞到对方屏幕上，糊住一块。',
  '对方扔过来的东西粘在你这边。按住摩擦就能擦掉。史莱姆又大又黏，要多擦几下。',
  '烂番茄会晃屏，芥末会把屏幕倒过来两秒，放屁云自带声音，蟑螂贴纸会在屏幕上爬。',
  '默契大考验：两人看到同一道傻题。选同一个，默契 +1；选不一样，就「没有默契了！」，双方屏幕一起遭殃。',
  '战斗里如果你们几乎同时扔出同一种东西，会弹出「居然有默契！」。结算看臭气值和默契指数，再来一局可以马上重开。',
]

export function HowTo() {
  const { closeHelp } = useGame()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHelp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeHelp])

  return (
    <div className="modal-back" onClick={closeHelp}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        data-testid="howto"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">上手只要一分钟</p>
        <h2 id="howto-title">怎么互相恶心</h2>
        <ol className="howto-list">
          {STEPS.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <button type="button" className="btn-go" data-testid="howto-dismiss" onClick={closeHelp}>
          知道了，开始恶心
        </button>
      </div>
    </div>
  )
}
