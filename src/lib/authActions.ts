import { supabase } from './supabase'

// Everything the login screens can do. Supabase sends the emails and handles Google.
const origin = () => window.location.origin

export const signInEmail = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password })

export const signUpEmail = (email: string, password: string) =>
  supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin() } })

export const signInGoogle = () =>
  supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin() } })

export const sendReset = (email: string) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin()}/reset-password` })

export const resendConfirmation = (email: string) =>
  supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: origin() } })

export const setNewPassword = (password: string) => supabase.auth.updateUser({ password })

/** Turns Supabase's technical messages into something a user can act on. */
export function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Please confirm your email first. Check your inbox for our message.'
  if (m.includes('already registered')) return 'That email already has an account. Try logging in instead.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Please wait a few minutes and try again.'
  if (m.includes('same password') || m.includes('different from the old')) return 'Choose a password you have not used before.'
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return 'Google sign-in is not switched on yet. Ask the app owner to enable it.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Could not reach the server. Check your internet connection.'
  return message
}

/** At least 8 characters with a letter and a number. */
export function passwordProblem(password: string): string {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number.'
  return ''
}
