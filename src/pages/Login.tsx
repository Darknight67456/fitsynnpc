import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) setError(error.message)
    else nav('/')
  }

  return (
    <form onSubmit={submit} className='mx-auto mt-20 max-w-sm space-y-3 p-4'>
      <h1 className='text-2xl font-bold'>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      <input className='w-full rounded border p-2' type='email' required placeholder='Email'
        value={email} onChange={e => setEmail(e.target.value)} />
      <input className='w-full rounded border p-2' type='password' required minLength={6}
        placeholder='Password (at least 6 characters)'
        value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p className='text-sm text-red-600'>{error}</p>}
      <button className='w-full rounded bg-black p-2 text-white disabled:opacity-50' disabled={busy}>
        {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
      </button>
      <button type='button' className='text-sm underline'
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'No account? Sign up' : 'Have an account? Log in'}
      </button>
    </form>
  )
}