import { useEffect, useMemo, useRef, useState } from 'react'
import {
  colorCheck, colorMatch, colorSelfie, detectUndertone,
  type ColorCheckResult, type ColorMatchResult, type ColorPayload, type ColorSelfieResult, type Undertone, type UndertoneResult,
} from '../lib/ai'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { useBodyProfile } from '../modules/profile/useBodyProfile'
import { colorName } from '../modules/wardrobe/colorFamily'
import { ACCESSORY_TYPES, CATEGORIES, labelOf } from '../modules/wardrobe/options'
import SelfieCapture from '../modules/stylist/SelfieCapture'
import { Select } from '../components/Field'
import Button from '../components/Button'
import Card from '../components/Card'
import type { ClothingItem } from '../types'

const SCHEMES: Record<string, string> = {
  neutral: 'All neutrals', accent: 'One color + neutrals', monochromatic: 'Same color family', analogous: 'Neighbor colors',
  complementary: 'Opposite colors', 'split-complementary': 'Split complementary', triadic: 'Triadic',
  contrasting: 'Contrasting', multicolor: 'Many colors',
}

const payload = (i: ClothingItem): ColorPayload => ({
  id: i.id, color: i.color, category: i.category, subtype: i.subtype ?? null, embedding: i.embedding ?? null,
})

const groupName = (group: string, category: string) =>
  ACCESSORY_TYPES.some(a => a.value === group) ? labelOf(ACCESSORY_TYPES, group) : labelOf(CATEGORIES, category)

function scoreLabel(score: number) {
  if (score >= 80) return { text: 'Great match', cls: 'text-green-700' }
  if (score >= 60) return { text: 'Good match', cls: 'text-amber-700' }
  return { text: 'Risky match', cls: 'text-red-600' }
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span className='inline-flex'>
      {colors.map((c, i) => (
        <span key={i} title={colorName(c)} className='-ml-1 h-5 w-5 rounded-full border border-ink/20 first:ml-0' style={{ background: c }} />
      ))}
    </span>
  )
}

function ItemButton({ item, selected, onClick }: { item: ClothingItem; selected: boolean; onClick: () => void }) {
  return (
    <button type='button' onClick={onClick} aria-pressed={selected}
      className={`rounded-lg border p-1 text-left text-xs transition ${selected ? 'border-brand ring-2 ring-brand' : 'border-ink/10 hover:bg-ink/5'}`}>
      {item.image_url
        ? <img src={item.image_url} alt={item.name} className='aspect-square w-full rounded object-cover' />
        : <div className='aspect-square w-full rounded' style={{ background: item.color }} />}
      <span className='mt-1 flex items-center gap-1'>
        <Swatches colors={[item.color]} />
        <span className='truncate'>{item.name}</span>
      </span>
    </button>
  )
}

export default function Colors() {
  const { items } = useWardrobe()
  const { profile, setProfile, save, loading: profileLoading } = useBodyProfile()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // the undertone the user picked here, or the saved one from their profile
  const [chosenUndertone, setChosenUndertone] = useState<Undertone | null>(null)
  const undertone: Undertone = chosenUndertone ?? (profileLoading ? 'neutral' : profile.skin_undertone)

  const [tab, setTab] = useState<'match' | 'check' | 'selfie'>('match')
  const [anchorId, setAnchorId] = useState('')
  const [match, setMatch] = useState<ColorMatchResult | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [check, setCheck] = useState<ColorCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(0)                       // ignore answers that arrive after a newer request

  const [selfie, setSelfie] = useState<UndertoneResult | null>(null)
  const [reading, setReading] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  async function runMatch(id: string, u: Undertone) {
    const anchor = byId.get(id)
    if (!anchor) return
    const mine = ++latest.current
    setBusy(true)
    setError('')
    try {
      const r = await colorMatch(payload(anchor), items.map(payload), u)
      if (mine === latest.current) setMatch(r)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    if (mine === latest.current) setBusy(false)
  }

  function chooseAnchor(id: string) {
    setAnchorId(id)
    setMatch(null)
    void runMatch(id, undertone)
  }

  function changeUndertone(u: Undertone) {
    setChosenUndertone(u)
    setCheck(null)
    if (anchorId) void runMatch(anchorId, u)
  }

  function toggle(id: string) {
    setCheck(null)
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 5 ? p : [...p, id]))
  }

  async function runCheck() {
    setError('')
    setBusy(true)
    try {
      setCheck(await colorCheck(picked.map(id => payload(byId.get(id) as ClothingItem)), undertone))
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    setBusy(false)
  }

  // Judge my outfit: a selfie of the person wearing the clothes
  const [outfitPhoto, setOutfitPhoto] = useState<Blob | null>(null)
  const outfitUrl = useMemo(() => (outfitPhoto ? URL.createObjectURL(outfitPhoto) : ''), [outfitPhoto])
  useEffect(() => () => { if (outfitUrl) URL.revokeObjectURL(outfitUrl) }, [outfitUrl])
  const [useSelfieSkin, setUseSelfieSkin] = useState(true)
  const [judge, setJudge] = useState<ColorSelfieResult | null>(null)

  async function runJudge(photo: Blob, useSkin: boolean, u: Undertone) {
    const mine = ++latest.current
    setBusy(true)
    setError('')
    try {
      const r = await colorSelfie(photo, u, useSkin, items.map(payload))
      if (mine === latest.current) setJudge(r)
    } catch (e) {
      if (mine === latest.current) setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    if (mine === latest.current) setBusy(false)
  }

  function onOutfitPhoto(p: Blob) {
    setOutfitPhoto(p)
    setJudge(null)
    void runJudge(p, useSelfieSkin, undertone)
  }

  function toggleSelfieSkin(on: boolean) {
    setUseSelfieSkin(on)
    if (outfitPhoto) void runJudge(outfitPhoto, on, undertone)
  }

  async function readSelfie(photo: Blob) {
    setReading(true)
    setError('')
    setSelfie(null)
    try {
      const r = await detectUndertone(photo)
      setSelfie(r)
      if (r.undertone) changeUndertone(r.undertone)     // a suggestion: the user can change it below
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    setReading(false)
  }

  async function saveUndertone() {
    const msg = await save({ ...profile, skin_undertone: undertone })
    if (!msg) setProfile({ ...profile, skin_undertone: undertone })
    setSaveNote(msg || 'Saved to your profile.')
  }

  return (
    <div className='mx-auto max-w-5xl space-y-4 p-4'>
      <div>
        <h1 className='text-2xl font-bold'>Color match</h1>
        <p className='text-sm text-muted'>
          Pick a piece and see which of your clothes go with it by color, or check how well the colors of an outfit work together.
        </p>
      </div>

      <Card className='space-y-3'>
        <p className='font-semibold'>Your skin undertone</p>
        <p className='text-sm text-muted'>
          Colors near your face look better or worse depending on your undertone. Take a selfie in daylight and the AI will
          guess it, or just choose it yourself.
        </p>
        <SelfieCapture onPhoto={p => void readSelfie(p)} />
        {reading && <p className='text-sm text-muted'>Reading your selfie...</p>}
        {selfie && (
          <div className='flex items-start gap-3 rounded-lg bg-brand/10 p-2 text-sm'>
            {selfie.color && <span className='mt-0.5 h-8 w-8 shrink-0 rounded-full border border-ink/20' style={{ background: selfie.color }} />}
            <div>
              {selfie.undertone
                ? <p>The AI thinks your undertone is <b>{selfie.undertone}</b>{selfie.confidence ? ` (${Math.round(selfie.confidence * 100)}% sure)` : ''}. Change it below if that does not sound right.</p>
                : <p>{selfie.message}</p>}
              {selfie.undertone && <p className='text-xs text-muted'>{selfie.message} Your photo is not saved.</p>}
            </div>
          </div>
        )}
        <div className='flex flex-wrap items-end gap-3'>
          <div className='w-48'>
            <Select label='Undertone used for scoring' value={undertone} onChange={e => changeUndertone(e.target.value as Undertone)}>
              <option value='neutral'>Neutral / not sure</option>
              <option value='warm'>Warm</option>
              <option value='cool'>Cool</option>
            </Select>
          </div>
          <Button variant='secondary' onClick={() => void saveUndertone()}>Save to my profile</Button>
        </div>
        {saveNote && <p className='text-sm'>{saveNote}</p>}
        <p className='text-xs text-muted'>Saving also stores your body profile from the Try-on page, with its current values.</p>
      </Card>

      <div className='flex gap-2'>
        <Button variant={tab === 'match' ? 'primary' : 'secondary'} onClick={() => setTab('match')}>Find matches</Button>
        <Button variant={tab === 'check' ? 'primary' : 'secondary'} onClick={() => setTab('check')}>Check an outfit</Button>
        <Button variant={tab === 'selfie' ? 'primary' : 'secondary'} onClick={() => setTab('selfie')}>Judge my outfit (selfie)</Button>
      </div>

      {items.length === 0 && <Card>Add some clothes to your wardrobe first.</Card>}
      {error && <p className='text-sm text-red-600'>{error}</p>}

      {tab === 'match' && items.length > 0 && (
        <>
          <Card className='space-y-2'>
            <p className='font-semibold'>1. Choose a piece</p>
            <div className='grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6'>
              {items.map(i => <ItemButton key={i.id} item={i} selected={i.id === anchorId} onClick={() => chooseAnchor(i.id)} />)}
            </div>
          </Card>

          {busy && <p className='text-sm text-muted'>Matching colors...</p>}
          {match && match.groups.length === 0 && !busy && (
            <Card>No other pieces to match with yet. Add a different kind of item, like a bottom or shoes.</Card>
          )}
          {match?.groups.map(g => (
            <Card key={g.group} className='space-y-2'>
              <p className='font-semibold'>Best {groupName(g.group, g.category).toLowerCase()}</p>
              <div className='grid gap-3 sm:grid-cols-3'>
                {g.picks.map(p => {
                  const it = byId.get(p.item_id)
                  const anchor = byId.get(anchorId)
                  if (!it || !anchor) return null
                  const lab = scoreLabel(p.score)
                  return (
                    <div key={p.item_id} className='space-y-1 text-sm'>
                      {it.image_url && <img src={it.image_url} alt={it.name} className='aspect-[4/5] w-full rounded object-cover' />}
                      <p className='font-medium'>{it.name}</p>
                      <p className='flex items-center gap-2'><Swatches colors={[anchor.color, it.color]} />
                        <span className='text-xs text-muted'>{SCHEMES[p.scheme] ?? p.scheme}</span></p>
                      <p className={`font-semibold ${lab.cls}`}>{p.score}/100 · {lab.text}</p>
                      {p.style_score !== null && (
                        <p className='text-xs text-muted'>Color {p.color_score} · Style (learned from outfits) {p.style_score}</p>
                      )}
                      <p className='text-xs'>{p.reason}</p>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </>
      )}

      {tab === 'check' && items.length > 0 && (
        <>
          <Card className='space-y-2'>
            <p className='font-semibold'>Choose 2 to 5 pieces ({picked.length} chosen)</p>
            <div className='grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6'>
              {items.map(i => <ItemButton key={i.id} item={i} selected={picked.includes(i.id)} onClick={() => toggle(i.id)} />)}
            </div>
            <Button onClick={() => void runCheck()} disabled={busy || picked.length < 2}>{busy ? 'Checking...' : 'Check the colors'}</Button>
          </Card>
          {check && (
            <Card className='space-y-2'>
              <p className='flex items-center gap-3'>
                <Swatches colors={picked.map(id => byId.get(id)?.color ?? '#ccc')} />
                <span className={`text-xl font-bold ${scoreLabel(check.score).cls}`}>{check.score}/100</span>
                <span className='text-sm text-muted'>{SCHEMES[check.scheme] ?? check.scheme}</span>
              </p>
              <p className='text-sm'>{check.reason}</p>
              {check.weakest?.item_id && byId.get(check.weakest.item_id) && (
                <p className='text-sm'>
                  <b>{byId.get(check.weakest.item_id)?.name}</b> is the weakest color match. Without it the score would
                  rise by about {check.weakest.gain_if_removed} points.
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'selfie' && (
        <>
          <Card className='space-y-3'>
            <p className='font-semibold'>Take a selfie in your outfit</p>
            <p className='text-sm text-muted'>
              The AI finds each piece you are wearing, reads your skin tone from your face, and tells you how well the colors
              work together and on you. Stand back so your outfit shows, in daylight if you can.
            </p>
            <SelfieCapture onPhoto={onOutfitPhoto} />
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' checked={useSelfieSkin} onChange={e => toggleSelfieSkin(e.target.checked)} />
              Use the skin tone from this selfie (otherwise I use the undertone set above)
            </label>
            {outfitUrl && <img src={outfitUrl} alt='your outfit' className='max-h-72 rounded-lg' />}
            {busy && <p className='text-sm text-muted'>Looking at your outfit...</p>}
            <p className='text-xs text-muted'>Your photo is sent to the AI service to read the clothes and is not saved.</p>
          </Card>

          {judge && judge.pieces.length === 0 && <Card>{judge.message}</Card>}
          {judge && judge.pieces.length > 0 && judge.score !== undefined && (
            <Card className='space-y-3'>
              <div className='flex flex-wrap gap-3'>
                {judge.pieces.map((p, i) => (
                  <div key={i} className={`w-24 text-center text-xs ${judge.weakest?.index === i ? 'rounded-lg ring-2 ring-red-400' : ''}`}>
                    <img src={p.image} alt={groupName(p.subtype ?? p.category, p.category)} className='h-24 w-24 rounded bg-white object-contain' />
                    <p className='mt-1 font-medium'>{groupName(p.subtype ?? p.category, p.category)}</p>
                    <p className='flex items-center justify-center gap-1'><Swatches colors={[p.color]} /><span className='text-muted'>{colorName(p.color)}</span></p>
                    {p.fit && <p className={p.fit === 'suits' ? 'text-green-700' : p.fit === 'less flattering' ? 'text-red-600' : 'text-muted'}>
                      {p.fit === 'neutral' ? 'neutral on you' : `${p.fit} on you`}</p>}
                  </div>
                ))}
              </div>
              <p className='flex flex-wrap items-center gap-3'>
                <span className={`text-xl font-bold ${scoreLabel(judge.score).cls}`}>{judge.score}/100</span>
                <span className='text-sm text-muted'>{SCHEMES[judge.scheme ?? ''] ?? judge.scheme}</span>
              </p>
              <p className='text-sm'>{judge.reason}</p>
              {judge.undertone?.used && (
                <p className='flex items-center gap-2 text-xs text-muted'>
                  {judge.undertone.source === 'selfie' && judge.undertone.estimate && (
                    <span className='h-4 w-4 rounded-full border border-ink/20' style={{ background: judge.undertone.estimate.color }} />
                  )}
                  Undertone used: <b>{judge.undertone.used}</b> ({judge.undertone.source === 'selfie' ? 'read from your selfie' : 'set above'}).
                  Lighting changes this, so correct it above if it is wrong.
                </p>
              )}
              {judge.weakest && judge.pieces[judge.weakest.index] && (
                <p className='text-sm'>
                  The <b>{groupName(judge.pieces[judge.weakest.index].subtype ?? judge.pieces[judge.weakest.index].category, judge.pieces[judge.weakest.index].category).toLowerCase()}</b> (outlined in red)
                  is the weakest color match. Without it the score would rise by about {judge.weakest.gain_if_removed} points.
                </p>
              )}
              {judge.swaps && judge.swaps.length > 0 && (
                <div className='space-y-1'>
                  <p className='text-sm font-semibold'>From your wardrobe, these would look better instead:</p>
                  <div className='flex flex-wrap gap-3'>
                    {judge.swaps.map(sw => {
                      const it = byId.get(sw.item_id)
                      return it ? (
                        <div key={sw.item_id} className='w-24 text-center text-xs'>
                          {it.image_url && <img src={it.image_url} alt={it.name} className='h-24 w-24 rounded object-cover' />}
                          <p className='truncate font-medium'>{it.name}</p>
                          <p className='text-muted'>would score {sw.score}</p>
                        </div>
                      ) : null
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <p className='text-xs text-muted'>
        The color rules come from color theory (the color wheel). The score is a guide, not a verdict, and the undertone
        guess depends on your photo's lighting.
      </p>
    </div>
  )
}
