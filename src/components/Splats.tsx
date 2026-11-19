import { useEffect, useRef } from 'react'
import { itemById } from '../../shared/items'
import type { Splat } from '../../shared/types'
import { ItemArt } from '../art'
import { crawlOffsets } from '../crawl'

const SIZE: Record<string, number> = {
  sock: 92,
  tomato: 104,
  snot: 96,
  slime: 126,
  fart: 118,
  roach: 84,
  wasabi: 108,
  leftover: 114,
}

export function Splats({ splats }: { splats: Splat[] }) {
  return (
    <>
      {splats.map((splat) => (
        <SplatView key={splat.id} splat={splat} />
      ))}
    </>
  )
}

function SplatView({ splat }: { splat: Splat }) {
  const item = itemById(splat.itemId)
  const ref = useRef<HTMLDivElement>(null)
  const crawling = item?.effect === 'crawl'

  useEffect(() => {
    if (!crawling) return
    let frame = 0
    const start = performance.now()
    const loop = (time: number) => {
      const s = (time - start) / 1000
      const x = Math.sin(s * 2.4) * 68 + Math.sin(s * 0.7) * 24
      const y = Math.cos(s * 1.7) * 34 + ((s * 26) % 72) - 30
      crawlOffsets.set(splat.id, { x, y })
      const el = ref.current
      if (el) {
        el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${splat.rot + Math.sin(s * 3) * 14}deg)`
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      crawlOffsets.delete(splat.id)
    }
  }, [crawling, splat.id, splat.rot])

  if (!item) return null
  const size = SIZE[item.id] ?? 96
  const ratio = splat.maxHealth <= 0 ? 0 : Math.max(0, splat.health) / splat.maxHealth
  return (
    <div
      ref={ref}
      className={`splat fx-${item.effect}`}
      data-testid="splat"
      data-item={item.id}
      data-punishment={splat.fromPunishment ? 'true' : 'false'}
      style={{
        left: `${splat.x * 100}%`,
        top: `${splat.y * 100}%`,
        opacity: 0.38 + ratio * 0.62,
        transform: crawling ? undefined : `translate(-50%, -50%) rotate(${splat.rot}deg)`,
      }}
    >
      <div className="sticker" style={{ background: item.color, width: size, height: size }}>
        <ItemArt id={item.id} size={size * 0.72} />
        {item.effect === 'drip' && <i className="drip" />}
        {item.effect === 'stink' && <i className="stink-lines" />}
      </div>
    </div>
  )
}
