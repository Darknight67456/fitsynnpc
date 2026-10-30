import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendly, passwordProblem, setNewPassword } from '../lib/authActions'
import PasswordInput from '../components/PasswordInput'
import Button from '../components/Button'
import Card from '../components/Card'

// The page the "reset your password" email links to. Supabase signs the user in from the link, then they pick a new password.
export default function ResetPassword() {
  const { user, loading } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const problem = passwordProblem(password)
    if (problem) { setError(problem); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    const { error } = await setNewPassword(password)
    setBusy(false)
    if (error) { setError(friendly(error.message)); return }
    setDone(true)
    setTimeout(() => nav('/', { replace: true }), 1500)
  }

  return (
    <div className='mx-auto mt-12 max-w-sm space-y-4 p-4'>
      <h1 className='text-center text-3xl font-bold text-brand'>FitSync</h1>
      <Card className='space-y-4'>
        <h2 className='text-xl font-bold'>Choose a new password</h2>
        {loading && <p className='text-sm text-muted'>Checking your link...</p>}
        {!loading && !user && (
          <>
            <p className='text-sm'>This reset link has expired or was already used. Ask for a new one.</p>
            <Link to='/login' className='text-sm font-semibold underline'>Back to log in</Link>
          </>
        )}
        {!loading && user && !done && (
          <form onSubmit={e => void submit(e)} className='space-y-3'>
            <PasswordInput label='New password' value={password} onChange={setPassword} autoComplete='new-password'
              placeholder='At least 8 characters, with a letter and a number' />
            <PasswordInput label='Confirm new password' value={confirm} onChange={setConfirm} autoComplete='new-password' />
            {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
            <Button className='w-full' disabled={busy}>{busy ? 'Saving...' : 'Save new password'}</Button>
          </form>
        )}
        {done && <p role='status' className='rounded-lg bg-brand/10 p-2 text-sm'>Your password is changed. Taking you to the app...</p>}
      </Card>
    </div>
  )
}
