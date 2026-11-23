import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import BodyMeasurementsEditor from '../modules/profile/BodyMeasurementsEditor'
import { useBodyProfile } from '../modules/profile/useBodyProfile'

export default function Size() {
  const { profile, setProfile, loading, save } = useBodyProfile()
  const [message, setMessage] = useState('')

  return (
    <>
      <PageHeader title='Size' subtitle='Your measurements shape the fitting room mannequin.' />
      <Card className='max-w-xl space-y-2' aria-labelledby='body-measurements-heading'>
        <h2 id='body-measurements-heading' className='font-semibold'>
          Body measurements
        </h2>
        {loading ? (
          <p className='text-sm text-muted'>Loading your measurements…</p>
        ) : (
          // Remount when the saved profile arrives so the draft starts from it.
          <BodyMeasurementsEditor
            key={profile.user_id || 'default'}
            profile={profile}
            save={save}
            onSaved={p => {
              setProfile(p)
              setMessage('Measurements saved.')
            }}
          />
        )}
        {message && (
          <p className='text-sm text-emerald-700' role='status'>
            {message}
          </p>
        )}
      </Card>
    </>
  )
}
