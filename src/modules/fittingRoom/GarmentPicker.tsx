import { useMemo, useState, type ReactNode } from 'react'
import type { Category, ClothingItem } from '../../types'

export type GarmentSourceId = 'wardrobe' | 'catalog' | 'samples'

export interface GarmentSource {
  id: GarmentSourceId
  label: string
  items: ClothingItem[]
  loading?: boolean
  /** Shown when the source has no items at all. */
  empty: ReactNode
  /** Small print under the tabs, e.g. where these items come from. */
  note?: ReactNode
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'top', label: 'Tops' },
  { value: 'bottom', label: 'Bottoms' },
  { value: 'dress', label: 'Dresses' },
  { value: 'outerwear', label: 'Outerwear' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'accessory', label: 'Accessories' },
]

interface GarmentPickerProps {
  sources: GarmentSource[]
  activeSource: GarmentSourceId
  onSourceChange: (id: GarmentSourceId) => void
  wornIds: Set<string>
  onToggle: (item: ClothingItem) => void
  /** Smaller images to show in the grid, keyed by item id. */
  thumbs?: Map<string, string>
}

/** Clothes rail for the fitting room: pick a source, filter by category, tap to wear. */
export default function GarmentPicker({
  sources,
  activeSource,
  onSourceChange,
  wornIds,
  onToggle,
  thumbs,
}: GarmentPickerProps) {
  const [category, setCategory] = useState<Category | 'all'>('all')
  const source = sources.find(s => s.id === activeSource) ?? sources[0]

  const counts = useMemo(() => {
    const c: Partial<Record<Category, number>> = {}
    for (const item of source.items) c[item.category] = (c[item.category] ?? 0) + 1
    return c
  }, [source.items])

  const visible = category === 'all' ? source.items : source.items.filter(i => i.category === category)

  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
      on ? 'border-ink bg-ink text-white' : 'border-ink/15 text-ink hover:border-ink/40'
    }`

  return (
    <div>
      <div
        className='mb-3 grid rounded-lg border border-ink/15 p-0.5 text-sm'
        style={{ gridTemplateColumns: `repeat(${sources.length}, minmax(0, 1fr))` }}
        role='tablist'
        aria-label='Where to pick clothes from'
      >
        {sources.map(s => (
          <button
            key={s.id}
            type='button'
            role='tab'
            aria-selected={s.id === source.id}
            onClick={() => {
              onSourceChange(s.id)
              setCategory('all')
            }}
            className={`rounded-md px-2 py-1.5 font-medium transition ${
              s.id === source.id ? 'bg-brand text-white' : 'text-ink hover:bg-ink/5'
            }`}
          >
            {s.label}
            {!s.loading && <span className='ml-1 text-xs opacity-75'>{s.items.length}</span>}
          </button>
        ))}
      </div>

      {source.note && <p className='mb-2 text-xs text-muted'>{source.note}</p>}

      <div className='-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1' role='group' aria-label='Filter by category'>
        <button type='button' className={chip(category === 'all')} onClick={() => setCategory('all')} aria-pressed={category === 'all'}>
          All
        </button>
        {CATEGORIES.filter(c => counts[c.value]).map(c => (
          <button
            key={c.value}
            type='button'
            className={chip(category === c.value)}
            onClick={() => setCategory(c.value)}
            aria-pressed={category === c.value}
          >
            {c.label} <span className='opacity-70'>{counts[c.value]}</span>
          </button>
        ))}
      </div>

      {source.loading ? (
        <div className='grid grid-cols-3 gap-2 sm:grid-cols-4' aria-hidden='true'>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className='aspect-[3/4] animate-pulse rounded-lg bg-ink/5' />
          ))}
        </div>
      ) : source.items.length === 0 ? (
        <div className='rounded-lg border border-dashed border-ink/20 p-4 text-sm text-muted'>{source.empty}</div>
      ) : (
        <ul className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
          {visible.map(item => {
            const on = wornIds.has(item.id)
            const img = thumbs?.get(item.id) ?? item.image_url
            return (
              <li key={item.id}>
                <button
                  type='button'
                  onClick={() => onToggle(item)}
                  aria-pressed={on}
                  title={on ? `Take off ${item.name}` : `Wear ${item.name}`}
                  className={`group relative block aspect-[3/4] w-full overflow-hidden rounded-lg border-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    on ? 'border-brand ring-2 ring-brand/30' : 'border-transparent hover:border-ink/25'
                  }`}
                  style={{ backgroundColor: item.color }}
                >
                  {img && <img src={img} alt='' loading='lazy' className='h-full w-full object-cover' />}
                  <span className='absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[11px] font-medium text-white'>
                    {item.name}
                  </span>
                  {on && (
                    <span className='absolute right-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white'>
                      Wearing
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
