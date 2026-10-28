import { Input, Select } from '../../components/Field'
import {
  ACCESSORY_TYPES, CATEGORIES, FORMALITY, SEASONS, defaultsFor, materialLabel, materialsFor, patternsFor, typicalLevel,
  type Option, type Tags,
} from './options'
import { colorName } from './colorFamily'

// If an old item has a value that is not in the list, still show it instead of losing it.
const withCurrent = (list: Option[], value: string): Option[] =>
  value && !list.some(o => o.value === value) ? [...list, { value, label: value }] : list

function Choice({ active, onClick, title, hint }: {
  active: boolean; onClick: () => void; title: string; hint?: string
}) {
  return (
    <button type='button' onClick={onClick} aria-pressed={active}
      className={`rounded-lg border p-2 text-left text-sm transition ${
        active ? 'border-brand bg-brand/10 ring-1 ring-brand' : 'border-ink/20 bg-surface hover:bg-ink/5'}`}>
      <span className='block font-medium'>{title}</span>
      {hint && <span className='block text-xs text-muted'>{hint}</span>}
    </button>
  )
}

export default function TagFields({ value, onChange }: { value: Tags; onChange: (t: Tags) => void }) {
  const set = <K extends keyof Tags>(k: K, v: Tags[K]) => onChange({ ...value, [k]: v })

  // Changing the category changes which patterns and materials make sense.
  function pickCategory(category: string) {
    const patternOk = patternsFor(category).some(p => p.value === value.pattern)
    const fabricOk = materialsFor(category).some(m => m.value === value.fabric)
    const d = defaultsFor(category)
    onChange({
      ...value, category,
      subtype: category === 'accessory' ? value.subtype : '',
      pattern: patternOk ? value.pattern : d.pattern,
      fabric: fabricOk ? value.fabric : d.fabric,
    })
  }

  const setLevels = (levels: number[]) =>
    onChange({ ...value, formality_levels: levels, formality: levels.length ? typicalLevel(levels) : value.formality })
  const toggleLevel = (n: number) => {
    const has = value.formality_levels.includes(n)
    if (has && value.formality_levels.length === 1) return        // keep at least one
    setLevels(has ? value.formality_levels.filter(x => x !== n) : [...value.formality_levels, n].sort())
  }
  const allLevels = value.formality_levels.length === 5

  return (
    <div className='space-y-4'>
      <Input label='Name' required placeholder='e.g. Navy blazer' value={value.name}
        onChange={e => set('name', e.target.value)} />

      <div>
        <span className='mb-1 block text-sm font-medium'>Category</span>
        <div className='flex flex-wrap gap-2'>
          {CATEGORIES.map(c => (
            <button key={c.value} type='button' title={c.hint} onClick={() => pickCategory(c.value)}
              aria-pressed={value.category === c.value}
              className={`rounded-full border px-3 py-1 text-sm ${
                value.category === c.value ? 'border-brand bg-brand text-white' : 'border-ink/20 bg-surface hover:bg-ink/5'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <p className='mt-1 text-xs text-muted'>
          {CATEGORIES.find(c => c.value === value.category)?.hint}
        </p>
      </div>

      <div>
        <span className='mb-1 block text-sm font-medium'>Color</span>
        <div className='flex items-center gap-3'>
          <input type='color' aria-label='Color' value={value.color} onChange={e => set('color', e.target.value)}
            className='h-10 w-14 cursor-pointer rounded border border-ink/20' />
          <span className='text-sm'>{colorName(value.color)} <span className='text-muted'>({value.color})</span></span>
        </div>
        <p className='mt-1 text-xs text-muted'>Picked from your photo. Change it if it looks wrong.</p>
      </div>

      {value.category === 'accessory' && (
        <div>
          <span className='mb-1 block text-sm font-medium'>Type of accessory</span>
          <div className='flex flex-wrap gap-2'>
            {ACCESSORY_TYPES.map(t => (
              <button key={t.value} type='button' title={t.hint} onClick={() => set('subtype', t.value)}
                aria-pressed={value.subtype === t.value}
                className={`rounded-full border px-3 py-1 text-sm ${
                  value.subtype === t.value ? 'border-brand bg-brand text-white' : 'border-ink/20 bg-surface hover:bg-ink/5'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className='grid grid-cols-2 gap-3'>
        <Select label='Pattern' value={value.pattern} onChange={e => set('pattern', e.target.value)}>
          {withCurrent(patternsFor(value.category), value.pattern).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select label={materialLabel(value.category)} value={value.fabric} onChange={e => set('fabric', e.target.value)}>
          {withCurrent(materialsFor(value.category), value.fabric).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      <div>
        <span className='mb-1 block text-sm font-medium'>Season (the weather you wear it in)</span>
        <div className='grid grid-cols-2 gap-2'>
          {withCurrent(SEASONS, value.season).map(o => (
            <Choice key={o.value} active={value.season === o.value} title={o.label} hint={o.hint}
              onClick={() => set('season', o.value)} />
          ))}
        </div>
      </div>

      <div>
        <span className='mb-1 block text-sm font-medium'>Where would you wear it? (pick every one that fits)</span>
        <div className='grid gap-2 sm:grid-cols-2'>
          {FORMALITY.map(o => (
            <Choice key={o.value} active={value.formality_levels.includes(Number(o.value))} title={o.label} hint={o.hint}
              onClick={() => toggleLevel(Number(o.value))} />
          ))}
          <Choice active={allLevels} title='All occasions' hint='works for anything, from home to a wedding'
            onClick={() => setLevels(allLevels ? [value.formality] : [1, 2, 3, 4, 5])} />
        </div>
      </div>
    </div>
  )
}
