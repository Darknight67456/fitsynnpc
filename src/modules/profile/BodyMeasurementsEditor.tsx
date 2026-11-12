import { useState } from 'react'
import Button from '../../components/Button'
import type { BodyProfile } from '../../types'
import BodyProfileForm from './BodyProfileForm'

/**
 * Shared body measurements form with Save and Cancel. Edits a draft, so Cancel leaves
 * the saved measurements (and the mannequin) unchanged.
 */
export default function BodyMeasurementsEditor({
  profile,
  save,
  onSaved,
  onCancel,
}: {
  profile: BodyProfile
  /** Persists the profile; returns an error message or '' on success. */
  save: (p: BodyProfile) => Promise<string>
  onSaved: (p: BodyProfile) => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState(profile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    const err = await save(draft)
    setBusy(false)
    if (err) {
      setError(`Could not save measurements: ${err}`)
      return
    }
    onSaved(draft)
  }

  return (
    <form
      className='space-y-3'
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className='text-sm text-muted'>The mannequin is built from these numbers only. No body photo is taken.</p>
      <BodyProfileForm profile={draft} onChange={setDraft} />
      {error && (
        <p className='text-sm text-red-700' role='alert'>
          {error}
        </p>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button type='submit' disabled={busy}>
          {busy ? 'Saving…' : 'Save measurements'}
        </Button>
        {onCancel && (
          <Button type='button' variant='secondary' onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
