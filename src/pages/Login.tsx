import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  friendly, passwordProblem, resendConfirmation, sendReset, signInEmail, signInGoogle, signUpEmail,
} from '../lib/authActions'
import { Input } from '../components/Field'
import PasswordInput from '../components/PasswordInput'
import Button from '../components/Button'
import Card from '../components/Card'

type Mode = 'login' | 'signup' | 'forgot'

const TITLE: Record<Mode, string> = { login: 'Log in', signup: 'Create your account', forgot: 'Reset your password' }

export default function Login() {
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)     // show "resend confirmation email"
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to='/' replace />    // already logged in (also after coming back from Google)

  function go(next: Mode) {
    setMode(next)
    setError('')
    setNotice('')
    setNeedsConfirm(false)
    setPassword('')
    setConfirm('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setNeedsConfirm(false)
    const cleanEmail = email.trim()

    if (mode === 'signup') {
      const problem = passwordProblem(password)
      if (problem) { setError(problem); return }
      if (password !== confirm) { setError('The two passwords do not match.'); return }
    }

    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await signInEmail(cleanEmail, password)
        if (error) {
          setError(friendly(error.message))
          setNeedsConfirm(error.message.toLowerCase().includes('not confirmed'))
        }
        // on success the auth listener sets the user and this page redirects
      } else if (mode === 'signup') {
        const { data, error } = await signUpEmail(cleanEmail, password)
        if (error) setError(friendly(error.message))
        else if (data.user && data.user.identities?.length === 0) setError(friendly('User already registered'))
        else if (!data.session) {
          setNotice('Almost done! We sent a confirmation link to your email. Open it, then come back and log in.')
          setNeedsConfirm(true)
          setMode('login')
          setPassword('')
          setConfirm('')
        }
      } else {
        const { error } = await sendReset(cleanEmail)
        if (error) setError(friendly(error.message))
        else setNotice('If that email has an account, we sent a link to reset the password. Check your inbox and spam folder.')
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : 'Something went wrong.'))
    }
    setBusy(false)
  }

  async function google() {
    setError('')
    const { error } = await signInGoogle()                     // the browser leaves for Google, then comes back logged in
    if (error) setError(friendly(error.message))
  }

  async function resend() {
    setError('')
    const { error } = await resendConfirmation(email.trim())
    if (error) setError(friendly(error.message))
    else setNotice('We sent the confirmation email again.')
  }

  return (
    <div className='mx-auto mt-12 max-w-sm space-y-4 p-4'>
      <h1 className='text-center text-3xl font-bold text-brand'>FitSync</h1>
      <Card className='space-y-4'>
        <h2 className='text-xl font-bold'>{TITLE[mode]}</h2>
        {mode === 'forgot' && (
          <p className='text-sm text-muted'>Enter your email and we will send you a link to choose a new password.</p>
        )}

        {mode !== 'forgot' && (
          <>
            <Button type='button' variant='secondary' className='flex w-full items-center justify-center gap-2' onClick={() => void google()}>
              <svg width='18' height='18' viewBox='0 0 48 48' aria-hidden='true'>
                <path fill='#EA4335' d='M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z' />
                <path fill='#4285F4' d='M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z' />
                <path fill='#FBBC05' d='M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z' />
                <path fill='#34A853' d='M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z' />
              </svg>
              Continue with Google
            </Button>
            <div className='flex items-center gap-2 text-xs text-muted'>
              <span className='h-px flex-1 bg-ink/15' /> or use your email <span className='h-px flex-1 bg-ink/15' />
            </div>
          </>
        )}

        <form onSubmit={e => void submit(e)} className='space-y-3'>
          <Input label='Email' type='email' required autoComplete='email' value={email} onChange={e => setEmail(e.target.value)} />
          {mode !== 'forgot' && (
            <PasswordInput label='Password' value={password} onChange={setPassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters, with a letter and a number' : undefined} />
          )}
          {mode === 'signup' && (
            <PasswordInput label='Confirm password' value={confirm} onChange={setConfirm} autoComplete='new-password' />
          )}

          {error && <p role='alert' className='text-sm text-red-600'>{error}</p>}
          {notice && <p role='status' className='rounded-lg bg-brand/10 p-2 text-sm'>{notice}</p>}
          {needsConfirm && email.trim() && (
            <button type='button' className='text-sm underline' onClick={() => void resend()}>Resend the confirmation email</button>
          )}

          <Button className='w-full' disabled={busy}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Sign up' : 'Send reset link'}
          </Button>
        </form>

        <div className='space-y-1 text-center text-sm'>
          {mode === 'login' && (
            <>
              <button type='button' className='underline' onClick={() => go('forgot')}>Forgot your password?</button>
              <p>No account? <button type='button' className='font-semibold underline' onClick={() => go('signup')}>Sign up</button></p>
            </>
          )}
          {mode === 'signup' && (
            <p>Already have an account? <button type='button' className='font-semibold underline' onClick={() => go('login')}>Log in</button></p>
          )}
          {mode === 'forgot' && (
            <button type='button' className='underline' onClick={() => go('login')}>Back to log in</button>
          )}
        </div>
      </Card>
    </div>
  )
}
