import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import type { Category } from '../types'
import CatalogPreview from '../modules/catalog/CatalogPreview'
import { CATEGORY_OPTIONS, FLAG_LABEL, GENDER_OPTIONS, SOURCE_OPTIONS } from '../modules/catalog/catalogLabels'
import { buildReviewExport, importReviews } from '../modules/catalog/catalogReview'
import type { CatalogItem, GarmentGender, ReviewStatus } from '../modules/catalog/catalogTypes'
import { tryOnBlockReason } from '../modules/catalog/demoGarment'
import { useDemoCatalog } from '../modules/catalog/useDemoCatalog'

type CategoryFilter = 'all' | Category | 'none'
type SourceFilter = (typeof SOURCE_OPTIONS)[number]['value']
type StatusFilter = 'all' | ReviewStatus

const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-red-100 text-red-900',
}

export default function DemoCatalog() {
  const { file, items, state, error } = useDemoCatalog()
  const navigate = useNavigate()
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [gender, setGender] = useState<'all' | GarmentGender>('all')
  const [readyOnly, setReadyOnly] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const importRef = useRef<HTMLInputElement | null>(null)

  const counts = useMemo(() => {
    const byCategory: Record<string, number> = {}
    for (const i of items) {
      const key = i.category ?? 'none'
      byCategory[key] = (byCategory[key] ?? 0) + 1
    }
    return {
      byCategory,
      ready: items.filter(i => tryOnBlockReason(i) === null).length,
      approved: items.filter(i => i.status === 'approved').length,
      rights: items.filter(i => i.rightsConfirmed).length,
      unconfirmedCategory: items.filter(i => !i.categoryConfirmed).length,
    }
  }, [items])

  const visible = useMemo(
    () =>
      items.filter(i => {
        if (category === 'none' ? i.category !== null : category !== 'all' && i.category !== category) return false
        if (source === 'team' && !i.source_group.startsWith('team_photos')) return false
        if (source !== 'all' && source !== 'team' && i.source_group !== source) return false
        if (status !== 'all' && i.status !== status) return false
        if (gender !== 'all' && i.gender !== gender) return false
        if (readyOnly && tryOnBlockReason(i) !== null) return false
        return true
      }),
    [items, category, source, status, gender, readyOnly]
  )

  const preview = previewId ? items.find(i => i.id === previewId) ?? null : null
  const closePreview = useCallback(() => setPreviewId(null), [])

  function sendToTryOn(item: CatalogItem) {
    navigate(`/visualizer?demoGarment=${encodeURIComponent(item.id)}`)
  }

  function exportReview() {
    const data = buildReviewExport({
      dataset: file?.source_manifest.dataset ?? null,
      version: file?.source_manifest.version ?? null,
    })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fitsync-demo-catalog-review-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${Object.keys(data.reviews).length} review decision(s).`)
  }

  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const { imported, skipped } = importReviews(JSON.parse(await f.text()))
      setNotice(`Imported ${imported} review decision(s)${skipped ? `, skipped ${skipped} invalid` : ''}.`)
    } catch {
      setNotice('That file is not a valid review export.')
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? 'border-brand bg-brand text-white' : 'border-ink/15 bg-surface text-ink hover:bg-ink/5'
    }`

  return (
    <>
      <PageHeader
        title='Demo catalog'
        subtitle='Prepared team clothing dataset for demos and AI Try-On. Separate from your private wardrobe.'
      >
        {state === 'ready' && (
          <>
            <Button variant='secondary' onClick={exportReview}>
              Export review
            </Button>
            <Button variant='secondary' onClick={() => importRef.current?.click()}>
              Import review
            </Button>
            <input ref={importRef} type='file' accept='application/json' className='hidden' onChange={onImportFile} />
          </>
        )}
      </PageHeader>

      {state === 'loading' && <p className='text-sm text-muted'>Loading demo catalog…</p>}

      {state === 'missing' && (
        <Card className='space-y-2 text-sm'>
          <p className='font-semibold'>Demo catalog is not installed on this machine.</p>
          <p className='text-muted'>
            The catalog images are kept out of git until rights are confirmed. Build them locally with:
          </p>
          <pre className='overflow-x-auto whitespace-pre-wrap rounded-lg bg-page p-2 text-xs'>
            {'python scripts/build_demo_catalog.py --dataset "Dataset Cloth.zip" --manifest FitSync_Cloth_manifest.json --out public/demo-catalog'}
          </pre>
        </Card>
      )}

      {state === 'error' && (
        <Card className='border-red-300 bg-red-50 text-sm text-red-900' role='alert'>
          {error}
        </Card>
      )}

      {state === 'ready' && file && (
        <div className='space-y-4'>
          <div className='rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950'>
            <p className='font-semibold'>Review required before any production import</p>
            <p className='mt-1 leading-relaxed'>
              {items.length} items from “{file.source_manifest.dataset}” ({file.source_manifest.version}).{' '}
              {counts.unconfirmedCategory} still have unconfirmed categories, {items.length - counts.rights} have
              unconfirmed rights, {counts.approved} approved. {file.excluded.length} dataset file(s) left out
              (not selected by the team, or mannequin references). Review decisions stay in this browser until
              exported. Nothing here is saved to Supabase.
            </p>
          </div>

          <Card className='space-y-3'>
            <div className='flex flex-wrap gap-1.5' role='group' aria-label='Filter by category'>
              <button className={chip(category === 'all')} onClick={() => setCategory('all')}>
                All ({items.length})
              </button>
              {CATEGORY_OPTIONS.map(o => (
                <button key={o.value} className={chip(category === o.value)} onClick={() => setCategory(o.value)}>
                  {o.label} ({counts.byCategory[o.value] ?? 0})
                </button>
              ))}
              <button className={chip(category === 'none')} onClick={() => setCategory('none')}>
                Uncategorized ({counts.byCategory.none ?? 0})
              </button>
            </div>

            <div className='flex flex-wrap items-center gap-3 text-xs'>
              <label className='flex items-center gap-1.5'>
                Source
                <select
                  className='rounded-lg border border-ink/20 bg-surface px-2 py-1'
                  value={source}
                  onChange={e => setSource(e.target.value as SourceFilter)}
                >
                  {SOURCE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='flex items-center gap-1.5'>
                Review
                <select
                  className='rounded-lg border border-ink/20 bg-surface px-2 py-1'
                  value={status}
                  onChange={e => setStatus(e.target.value as StatusFilter)}
                >
                  <option value='all'>All</option>
                  <option value='pending'>Pending</option>
                  <option value='approved'>Approved</option>
                  <option value='rejected'>Rejected</option>
                </select>
              </label>
              <label className='flex items-center gap-1.5'>
                Gender
                <select
                  className='rounded-lg border border-ink/20 bg-surface px-2 py-1'
                  value={gender}
                  onChange={e => setGender(e.target.value as 'all' | GarmentGender)}
                >
                  <option value='all'>All</option>
                  {GENDER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='flex items-center gap-1.5'>
                <input type='checkbox' checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} />
                AI Try-On ready only ({counts.ready})
              </label>
              <span className='ml-auto text-muted'>{visible.length} shown</span>
            </div>
            {notice && (
              <p className='text-xs text-emerald-700' role='status'>
                {notice}
              </p>
            )}
          </Card>

          {visible.length === 0 ? (
            <Card className='text-sm text-muted'>No items match these filters.</Card>
          ) : (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
              {visible.map(item => {
                const block = tryOnBlockReason(item)
                return (
                  <Card key={item.id} className='flex flex-col gap-2 p-2'>
                    <button
                      type='button'
                      className='overflow-hidden rounded-lg bg-page'
                      onClick={() => setPreviewId(item.id)}
                      aria-label={`Preview ${item.displayName}`}
                    >
                      <img
                        src={item.thumbUrl}
                        alt={item.displayName}
                        width={item.thumb_width}
                        height={item.thumb_height}
                        loading='lazy'
                        className='aspect-[3/4] w-full object-cover'
                      />
                    </button>
                    <div className='min-w-0 space-y-1'>
                      <p className='truncate text-xs font-semibold' title={item.displayName}>
                        {item.displayName}
                      </p>
                      <div className='flex flex-wrap gap-1 text-[10px]'>
                        <span
                          className={`rounded-full px-1.5 py-0.5 ${
                            item.categoryConfirmed ? 'bg-brand/10 text-brand' : 'border border-dashed border-ink/30 text-muted'
                          }`}
                          title={item.categoryConfirmed ? 'Category confirmed' : 'Suggested category, not confirmed'}
                        >
                          {item.category ?? 'no category'}
                          {!item.categoryConfirmed && item.category ? '?' : ''}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 ${STATUS_STYLE[item.status]}`}>{item.status}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 ${
                            item.genderConfirmed ? 'bg-ink/5 text-ink' : 'border border-dashed border-ink/30 text-muted'
                          }`}
                          title={item.genderConfirmed ? 'Gender set' : 'Suggested gender, not confirmed yet'}
                        >
                          {item.gender}
                          {item.genderConfirmed ? '' : '?'}
                        </span>
                        <span className='rounded-full bg-ink/5 px-1.5 py-0.5 text-muted'>{item.origin.label}</span>
                        {!item.rightsConfirmed && (
                          <span className='rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-900'>rights pending</span>
                        )}
                      </div>
                      {item.flags.includes('third_party_graphic') && (
                        <p className='text-[10px] text-muted'>{FLAG_LABEL.third_party_graphic}</p>
                      )}
                    </div>
                    <div className='mt-auto flex gap-1.5'>
                      <Button variant='secondary' className='flex-1 px-2 py-1 text-xs' onClick={() => setPreviewId(item.id)}>
                        Review
                      </Button>
                      <Button
                        className='flex-1 px-2 py-1 text-xs'
                        disabled={block !== null}
                        title={block ?? 'Send to AI Try-On'}
                        onClick={() => sendToTryOn(item)}
                      >
                        Try on
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          <p className='text-xs text-muted'>
            Want your own clothes? Add them in your private <Link to='/' className='text-brand underline'>Wardrobe</Link>.
          </p>
        </div>
      )}

      {preview && (
        <CatalogPreview key={preview.id} item={preview} onClose={closePreview} onUseForTryOn={sendToTryOn} />
      )}
    </>
  )
}
