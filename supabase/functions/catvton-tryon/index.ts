// FitSync Module 4: secure proxy from the browser to the CatVTON RunPod Serverless worker.
//
// Secrets (set with `supabase secrets set`, never in VITE_* or frontend code):
//   RUNPOD_API_KEY       RunPod API key
//   RUNPOD_ENDPOINT_ID   Serverless endpoint id running runpod-worker/
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_ANON_KEY.
//
// Two request shapes:
//   1. Start a job:  { person_image, garment_image, category, sleeve_length, garment_source, garment_id, ... }
//   2. Check a job:  { job_id }   (job_id is the signed token returned by call 1)
// Replies: { status: 'success', image_base64, metrics } | { status: 'pending', job_id, runpod_status } | { status: 'error', message }

import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CATEGORIES = new Set(['upper_body', 'lower_body', 'dresses'])
const SLEEVES = new Set(['auto', 'sleeveless', 'short_sleeve', 'long_sleeve'])
const SOURCES = new Set(['wardrobe', 'demo_catalog'])
// Base64 text of an 8 MB image; the worker itself rejects anything over 15 MB.
const MAX_IMAGE_CHARS = 11_000_000
// Wait this long for a warm worker before handing the browser a job id to poll.
const INLINE_WAIT_MS = 20_000

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
const fail = (message: string, status = 400) => reply({ status: 'error', message }, status)

function isImageDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:image/') && v.length <= MAX_IMAGE_CHARS
}

// The job id is signed with the user's id so one user cannot poll another user's result.
async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(sig).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
}
async function signJob(jobId: string, userId: string, secret: string) {
  return `${jobId}.${await hmac(`${userId}:${jobId}`, secret)}`
}
async function verifyJob(token: string, userId: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const jobId = token.slice(0, dot)
  return (await hmac(`${userId}:${jobId}`, secret)) === token.slice(dot + 1) ? jobId : null
}

interface RunPodStatus {
  id: string
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'
  output?: { status?: string; message?: string; image_base64?: string; metrics?: Record<string, unknown> }
  error?: string
}

async function runpod(path: string, apiKey: string, init?: RequestInit): Promise<RunPodStatus> {
  const res = await fetch(`https://api.runpod.ai/v2/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`RunPod returned HTTP ${res.status}`)
  return (await res.json()) as RunPodStatus
}

async function toReply(job: RunPodStatus, userId: string, apiKey: string) {
  if (job.status === 'COMPLETED') {
    const out = job.output ?? {}
    if (out.status !== 'success' || !out.image_base64) {
      return fail(out.message || 'The GPU worker could not dress the mannequin with this garment.', 502)
    }
    return reply({ status: 'success', image_base64: out.image_base64, metrics: out.metrics ?? {} })
  }
  if (job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS') {
    return reply({ status: 'pending', job_id: await signJob(job.id, userId, apiKey), runpod_status: job.status })
  }
  console.error('RunPod job ended', job.status, job.error)
  return fail('The GPU job did not finish. Try again in a moment.', 502)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return fail('Use POST.', 405)

  const apiKey = Deno.env.get('RUNPOD_API_KEY')
  const endpointId = Deno.env.get('RUNPOD_ENDPOINT_ID')
  if (!apiKey || !endpointId) return fail('AI try-on is not configured on the server yet.', 503)

  // Who is calling? Uses the caller's own session, so RLS applies to every query below.
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return fail('Please log in again.', 401)
  const userId = userData.user.id

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('The request body is not valid JSON.')
  }

  try {
    // 2. Check a running job
    if (typeof body.job_id === 'string') {
      const jobId = await verifyJob(body.job_id, userId, apiKey)
      if (!jobId) return fail('Unknown try-on job.', 403)
      const job = await runpod(`${endpointId}/status/${encodeURIComponent(jobId)}`, apiKey)
      return toReply(job, userId, apiKey)
    }

    // 1. Start a job: validate everything before spending GPU time
    const { person_image, garment_image, category, garment_source, garment_id } = body
    const sleeve = body.sleeve_length ?? 'auto'
    if (!isImageDataUrl(person_image)) return fail('The mannequin photo is missing or too large.')
    if (!isImageDataUrl(garment_image)) return fail('The garment photo is missing or too large.')
    if (typeof category !== 'string' || !CATEGORIES.has(category)) return fail('Unsupported garment category.')
    if (typeof sleeve !== 'string' || !SLEEVES.has(sleeve)) return fail('Unsupported sleeve length.')
    if (typeof garment_source !== 'string' || !SOURCES.has(garment_source)) return fail('Unknown garment source.')

    // Wardrobe garments must belong to the caller (RLS hides other users' rows).
    if (garment_source === 'wardrobe') {
      if (typeof garment_id !== 'string') return fail('Missing garment id.')
      const { data: owned, error } = await supabase.from('clothing_items').select('id').eq('id', garment_id).maybeSingle()
      if (error || !owned) return fail('That garment is not in your wardrobe.', 403)
    }

    const steps = Math.min(50, Math.max(10, Number(body.num_inference_steps) || 25))
    const guidance = Math.min(7.5, Math.max(0, Number(body.guidance_scale) || 2.5))
    const seed = Number.isInteger(body.seed) ? body.seed : 42

    const started = await runpod(`${endpointId}/run`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        input: {
          person_image,
          garment_image,
          category,
          sleeve_length: sleeve,
          masking_strategy: 'auto',
          mask_refinement: 'fitsync',
          reframe_person: true,
          repaint: true,
          num_inference_steps: steps,
          guidance_scale: guidance,
          seed,
        },
        // Drop the job if no worker picks it up within 10 minutes.
        policy: { ttl: 600_000 },
      }),
    })

    // A warm worker often finishes in seconds; return the image directly when it does.
    let job = started
    const until = Date.now() + INLINE_WAIT_MS
    while ((job.status === 'IN_QUEUE' || job.status === 'IN_PROGRESS') && Date.now() < until) {
      await new Promise(r => setTimeout(r, 2000))
      job = await runpod(`${endpointId}/status/${encodeURIComponent(started.id)}`, apiKey)
    }
    return toReply(job, userId, apiKey)
  } catch (err) {
    console.error('catvton-tryon failed', err)
    return fail('The GPU service is not reachable right now. Try again in a moment.', 502)
  }
})
