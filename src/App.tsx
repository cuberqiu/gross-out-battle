import { HowTo } from './components/HowTo'
import { Lobby } from './screens/Lobby'
import { Play } from './screens/Play'
import { Result } from './screens/Result'
import { Waiting } from './screens/Waiting'
import { useGame } from './store'

export function App() {
  const game = useGame()
  const inMatch = game.phase !== 'lobby' && game.phase !== 'waiting' && game.phase !== 'result'
  return (
    <div className="world" data-testid="app" data-phase={game.phase} data-connected={game.connected ? 'yes' : 'no'}>
      {game.help && <HowTo />}
      {game.toast && (
        <div className="toast" data-testid="toast" role="status">
          {game.toast}
        </div>
      )}
      {game.phase === 'lobby' && <Lobby />}
      {game.phase === 'waiting' && <Waiting />}
      {game.phase === 'result' && <Result />}
      {inMatch && <Play />}
    </div>
  )
}
