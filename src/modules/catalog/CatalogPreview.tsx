import { useEffect, useState } from 'react'
import Button from '../../components/Button'
import type { Category } from '../../types'
import { CATEGORY_OPTIONS, FLAG_LABEL, GENDER_OPTIONS, SLEEVE_OPTIONS, codeLabel } from './catalogLabels'
import { clearReview, saveReview } from './catalogReview'
import type { CatalogItem, GarmentGender, ReviewStatus, SleeveLength } from './catalogTypes'
import { tryOnBlockReason } from './demoGarment'

interface Props {
  item: CatalogItem
  onClose: () => void
  onUseForTryOn: (item: CatalogItem) => void
}

/** Large preview + review form for one demo catalog item. Mount with key={item.id}. */
export default function CatalogPreview({ item, onClose, onUseForTryOn }: Props) {
  const [category, setCategory] = useState<Category | ''>(item.category ?? '')
  const [name, setName] = useState(item.local?.name ?? item.review.name ?? '')
  const [sleeve, setSleeve] = useState<SleeveLength | ''>(item.sleeveLength ?? '')
  const [rights, setRights] = useState(item.rightsConfirmed)
  const [gender, setGender] = useState<GarmentGender | ''>(item.genderConfirmed ? item.gender : '')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sleeveRelevant = category === 'top' || category === 'outerwear' || category === 'dress'
  const blockReason = tryOnBlockReason(item)

  function save(status: ReviewStatus) {
    saveReview(item.id, {
      status,
      category: category || null,
      name: name.trim(),
      sleeve_length: sleeveRelevant && sleeve ? sleeve : null,
      rights_confirmed: rights,
      gender: gender || null,
    })
    setSaved(
      status === 'approved'
        ? 'Saved as approved (this browser only).'
        : status === 'rejected'
          ? 'Marked as rejected.'
          : 'Saved as pending.'
    )
  }

  return (
    <div
      className='fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-3'
      onClick={onClose}
      role='dialog'
      aria-modal='true'
      aria-label={`Preview ${item.displayName}`}
    >
      <div
        className='flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-lg md:flex-row'
        onClick={e => e.stopPropagation()}
      >
        <div className='flex min-h-0 flex-1 items-center justify-center bg-page p-3'>
          <img
            src={item.imageUrl}
            alt={item.displayName}
            width={item.width}
            height={item.height}
            className='max-h-[45vh] w-auto max-w-full rounded-lg object-contain md:max-h-[85vh]'
          />
        </div>

        <div className='w-full space-y-3 overflow-y-auto p-4 md:w-80'>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              <h2 className='truncate text-base font-bold'>{item.displayName}</h2>
              <p className='text-xs text-muted'>{item.origin.label}</p>
            </div>
            <button className='text-sm text-muted hover:text-ink' onClick={onClose} aria-label='Close preview'>
              Close
            </button>
          </div>

          <p className='rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-950'>
            {item.origin.detail}
          </p>

          {item.flags.length > 0 && (
            <div className='flex flex-wrap gap-1'>
              {item.flags.map(f => (
                <span key={f} className='rounded-full border border-ink/15 px-2 py-0.5 text-[10px] text-muted'>
                  {FLAG_LABEL[f] ?? f}
                </span>
              ))}
            </div>
          )}

          {item.details && (
            <dl className='space-y-1 text-[11px]'>
              <div>
                <dt className='inline text-muted'>Type: </dt>
                <dd className='inline font-medium'>
                  {codeLabel(item.details.garment_type)} · {codeLabel(item.details.item_kind)}
                </dd>
              </div>
              <div>
                <dt className='text-muted'>Occasions</dt>
                <dd>
                  <ul className='mt-0.5 space-y-0.5'>
                    {item.details.occasions.map(o => (
                      <li key={o.code}>
                        <span className='font-medium'>{codeLabel(o.code)}</span>
                        {o.condition && <span className='text-muted'> ({o.condition})</span>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className='inline text-muted'>Themes: </dt>
                <dd className='inline'>{item.details.themes.map(codeLabel).join(', ')}</dd>
              </div>
              {item.details.review_note && (
                <div className='rounded-lg bg-amber-50 p-2 text-amber-950'>
                  <dt className='font-semibold'>Check before approving</dt>
                  <dd>{item.details.review_note}</dd>
                </div>
              )}
            </dl>
          )}

          {item.suggested.category && (
            <p className='text-[11px] text-muted'>
              Suggested: <span className='font-medium text-ink'>{item.suggested.category}</span>
              {item.suggested.sleeve_length && ` · ${item.suggested.sleeve_length.replace('_', ' ')}`}
              {item.suggested.note && ` · ${item.suggested.note}`} ({item.suggested.by})
            </p>
          )}

          <div className='space-y-2 border-t border-ink/10 pt-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-muted'>Review</p>

            <label className='block text-xs font-medium'>
              Category
              <select
                className='mt-1 w-full rounded-lg border border-ink/20 bg-surface px-2 py-1.5 text-sm'
                value={category}
                onChange={e => setCategory(e.target.value as Category | '')}
              >
                <option value=''>Not set</option>
                {CATEGORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {sleeveRelevant && (
              <label className='block text-xs font-medium'>
                Sleeve length (used by CatVTON masking)
                <select
                  className='mt-1 w-full rounded-lg border border-ink/20 bg-surface px-2 py-1.5 text-sm'
                  value={sleeve}
                  onChange={e => setSleeve(e.target.value as SleeveLength | '')}
                >
                  <option value=''>Not set (auto)</option>
                  {SLEEVE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className='block text-xs font-medium'>
              Gender
              <select
                className='mt-1 w-full rounded-lg border border-ink/20 bg-surface px-2 py-1.5 text-sm'
                value={gender}
                onChange={e => setGender(e.target.value as GarmentGender | '')}
              >
                <option value=''>Not set (using {item.genderConfirmed ? 'unisex' : item.gender})</option>
                {GENDER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className='block text-xs font-medium'>
              Display name
              <input
                className='mt-1 w-full rounded-lg border border-ink/20 bg-surface px-2 py-1.5 text-sm'
                value={name}
                maxLength={80}
                placeholder='e.g. Navy striped polo'
                onChange={e => setName(e.target.value)}
              />
            </label>

            <label className='flex items-start gap-2 text-xs'>
              <input
                type='checkbox'
                className='mt-0.5'
                checked={rights}
                onChange={e => setRights(e.target.checked)}
              />
              <span>
                I confirm the team has the right to use this image (owner consent, or our own photo or edit).
              </span>
            </label>

            <div className='flex flex-wrap gap-2 pt-1'>
              <Button onClick={() => save('approved')} disabled={!category}>
                Approve
              </Button>
              <Button variant='secondary' onClick={() => save('pending')}>
                Save as pending
              </Button>
              <Button variant='ghost' className='text-red-700' onClick={() => save('rejected')}>
                Reject
              </Button>
            </div>
            {item.local && (
              <button
                className='text-[11px] text-muted underline hover:text-ink'
                onClick={() => {
                  clearReview(item.id)
                  setSaved('Local review cleared.')
                }}
              >
                Clear my review for this item
              </button>
            )}
            {saved && (
              <p className='text-[11px] text-emerald-700' role='status'>
                {saved}
              </p>
            )}
          </div>

          <div className='space-y-1 border-t border-ink/10 pt-3'>
            <Button className='w-full' onClick={() => onUseForTryOn(item)} disabled={blockReason !== null}>
              Use in AI Try-On
            </Button>
            {blockReason && <p className='text-[11px] text-muted'>{blockReason}.</p>}
            {!blockReason && !item.rightsConfirmed && (
              <p className='text-[11px] text-amber-800'>
                Rights not confirmed: allowed for the local mock preview only.
              </p>
            )}
          </div>

          <details className='text-[11px] text-muted'>
            <summary className='cursor-pointer'>Source details</summary>
            <p className='mt-1 break-all'>File: {item.source_path}</p>
            <p className='break-all'>SHA-256: {item.original_sha256.slice(0, 16)}…</p>
            <p>
              Web image: {item.width}×{item.height}, {Math.round(item.bytes / 1024)} KB
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}
