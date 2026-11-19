const ink = '#1b1028'

export function ItemArt({ id, size = 72 }: { id: string; size?: number }) {
  return (
    <svg className="art" width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      {draw(id)}
    </svg>
  )
}

function draw(id: string) {
  switch (id) {
    case 'tomato':
      return (
        <>
          <circle cx="40" cy="46" r="22" fill="#ef3d32" stroke={ink} strokeWidth="3" />
          <path d="M28 30c6-10 18-10 24 0" fill="#3aaa3a" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
          <circle cx="33" cy="44" r="3" fill="#ffd0c8" />
          <path d="M22 58c6 6 10 4 12-2" fill="none" stroke="#ffd15c" strokeWidth="3" strokeLinecap="round" />
        </>
      )
    case 'snot':
      return (
        <>
          <ellipse cx="40" cy="40" rx="20" ry="18" fill="#b8f7cf" stroke={ink} strokeWidth="3" opacity="0.95" />
          <ellipse cx="33" cy="34" rx="6" ry="4" fill="#fff" opacity="0.85" />
          <ellipse cx="40" cy="62" rx="6" ry="8" fill="#9ae8bc" stroke={ink} strokeWidth="3" />
        </>
      )
    case 'slime':
      return (
        <>
          <path
            d="M16 46c0-16 10-26 24-26 16 0 26 12 24 26 4 4 4 12-2 16-8 6-32 8-44 0-6-4-6-12-2-16z"
            fill="#c6f24a"
            stroke={ink}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="32" cy="44" r="3" fill={ink} />
          <circle cx="48" cy="44" r="3" fill={ink} />
          <path d="M34 54c4 3 8 3 12 0" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="28" cy="34" rx="5" ry="3" fill="#fff" opacity="0.7" />
        </>
      )
    case 'fart':
      return (
        <>
          <ellipse cx="30" cy="46" rx="16" ry="12" fill="#d9ff9a" stroke={ink} strokeWidth="3" />
          <ellipse cx="48" cy="40" rx="18" ry="14" fill="#c8f56a" stroke={ink} strokeWidth="3" />
          <ellipse cx="38" cy="30" rx="12" ry="10" fill="#eaffc0" stroke={ink} strokeWidth="3" />
          <path d="M18 22c4-6 8-4 8 0" fill="none" stroke="#7dce45" strokeWidth="3" strokeLinecap="round" />
        </>
      )
    case 'roach':
      return (
        <>
          <ellipse cx="42" cy="46" rx="18" ry="12" fill="#8a5a32" stroke={ink} strokeWidth="3" />
          <circle cx="24" cy="44" r="10" fill="#a56b3d" stroke={ink} strokeWidth="3" />
          <circle cx="21" cy="42" r="3" fill="#fff" stroke={ink} strokeWidth="2" />
          <circle cx="28" cy="42" r="3" fill="#fff" stroke={ink} strokeWidth="2" />
          <circle cx="21" cy="42" r="1.4" fill={ink} />
          <circle cx="28" cy="42" r="1.4" fill={ink} />
          <path d="M16 34c-6-8-4-14 2-16M22 32c-2-10 4-16 8-14" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M36 38l-8-10M40 36l-2-12M48 38l8-10M52 44l12-4M48 52l10 8M36 54l-8 10" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )
    case 'wasabi':
      return (
        <>
          <path
            d="M40 8l6 16 16 2-12 10 4 16-14-8-14 8 4-16L18 26l16-2z"
            fill="#e6ff55"
            stroke={ink}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="40" cy="36" r="6" fill="#b6e034" stroke={ink} strokeWidth="3" />
        </>
      )
    case 'leftover':
      return (
        <>
          <path d="M18 30h44l-4 32H22z" fill="#ffd08a" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
          <path d="M28 30c0-8 24-8 24 0" fill="none" stroke={ink} strokeWidth="3" />
          <path d="M30 44c6 4 8 4 14-2M28 54c8 3 12 1 18-4" fill="none" stroke="#ef6a3c" strokeWidth="3" strokeLinecap="round" />
          <path d="M34 18c4 4 8 4 12 0" fill="none" stroke="#7dce45" strokeWidth="3" strokeLinecap="round" />
        </>
      )
    default:
      return (
        <>
          <path
            d="M28 12h16a8 8 0 0 1 8 8v18l10 6a10 10 0 0 1-4 18H34a10 10 0 0 1-10-8v-6h-4V22a10 10 0 0 1 8-10z"
            fill="#f0c79a"
            stroke={ink}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M30 20v16" stroke="#d7a56e" strokeWidth="3" strokeLinecap="round" />
          <path d="M56 16c6-2 10 4 6 8M62 28c4 0 6 6 2 8" fill="none" stroke="#67c23a" strokeWidth="3" strokeLinecap="round" />
        </>
      )
  }
}
