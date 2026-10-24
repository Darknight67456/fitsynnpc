import { Input, Select } from '../../components/Field'
import type { BodyProfile } from '../../types'

type NumberKey = 'height_cm' | 'weight_kg' | 'chest' | 'waist' | 'hips' | 'shoulder'

const FIELDS: { key: NumberKey; label: string }[] = [
  { key: 'height_cm', label: 'Height (cm)' },
  { key: 'weight_kg', label: 'Weight (kg)' },
  { key: 'chest', label: 'Chest (cm)' },
  { key: 'waist', label: 'Waist (cm)' },
  { key: 'hips', label: 'Hips (cm)' },
  { key: 'shoulder', label: 'Shoulder width (cm)' },
]

export default function BodyProfileForm({ profile, onChange }: {
  profile: BodyProfile
  onChange: (p: BodyProfile) => void
}) {
  return (
    <div className='grid grid-cols-2 gap-3'>
      {FIELDS.map(f => (
        <Input key={f.key} label={f.label} type='number' min={1} value={profile[f.key]}
          onChange={e => onChange({ ...profile, [f.key]: Number(e.target.value) })} />
      ))}
      <Select label='Skin undertone' value={profile.skin_undertone}
        onChange={e => onChange({ ...profile, skin_undertone: e.target.value as BodyProfile['skin_undertone'] })}>
        <option value='warm'>warm</option>
        <option value='cool'>cool</option>
        <option value='neutral'>neutral</option>
      </Select>
      <Select label='Fit preference' value={profile.fit_pref}
        onChange={e => onChange({ ...profile, fit_pref: e.target.value })}>
        <option value='slim'>slim</option>
        <option value='regular'>regular</option>
        <option value='loose'>loose</option>
      </Select>
    </div>
  )
}
