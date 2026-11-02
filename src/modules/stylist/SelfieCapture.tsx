import { useEffect, useRef, useState } from 'react'
import Button from '../../components/Button'

// Take a selfie with the camera, or choose a photo from the device.
export default function SelfieCapture({ onPhoto }: { onPhoto: (photo: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')

  const stop = () => {
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
    setLive(false)
  }
  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()) }, [])   // turn the camera off when leaving the page

  async function start() {
    setError('')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      setLive(true)
      // the <video> element exists after the next render
      requestAnimationFrame(() => {
        if (video.current && stream.current) {
          video.current.srcObject = stream.current
          void video.current.play()
        }
      })
    } catch {
      setError('Could not open the camera. Allow camera access in the browser, or choose a photo instead.')
    }
  }

  function snap() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob(b => { if (b) { onPhoto(b); stop() } }, 'image/jpeg', 0.9)
  }

  return (
    <div className='space-y-2'>
      {live ? (
        <>
          <video ref={video} playsInline muted className='max-h-96 w-full rounded-lg bg-black object-contain' style={{ transform: 'scaleX(-1)' }} />
          <div className='flex gap-2'>
            <Button type='button' onClick={snap}>Take photo</Button>
            <Button type='button' variant='secondary' onClick={stop}>Cancel</Button>
          </div>
          <p className='text-xs text-muted'>Stand back so your whole outfit is in view, in good light.</p>
        </>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          <Button type='button' onClick={() => void start()}>Open camera</Button>
          <label className='cursor-pointer rounded-lg border border-ink/20 bg-surface px-4 py-2 text-sm font-semibold hover:bg-ink/5'>
            Choose a photo
            <input type='file' accept='image/*' className='hidden'
              onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = '' }} />
          </label>
        </div>
      )}
      {error && <p className='text-sm text-red-600'>{error}</p>}
    </div>
  )
}
