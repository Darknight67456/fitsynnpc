import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, PerspectiveCamera } from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BodyProfile, Category, ClothingItem } from '../../types'
import {
  computeAvatarDimensions,
  type AvatarDimensions,
} from './avatarMeasurements'
import FashionMannequinModel from './FashionMannequinModel'
import GarmentMesh from './GarmentMesh'
import MannequinPedestal, { PEDESTAL_FLOOR_Y } from './MannequinPedestal'
import FittingRoomStage from './FittingRoomStage'
import { MannequinGenderContext } from './mannequinGender'
import { setMannequinGender, useSelectedMannequinGender } from './mannequinGenderStore'
import { PREVIEW_FRAME_HEIGHT } from './previewFrame'
import type { MannequinGender } from './mannequinMorphs'

// Plain studio colour behind the mannequin in the CatVTON capture (the worker expects a flat background).
const CAPTURE_BACKGROUND = new Color('#ece9e3')

/**
 * Optional real photo of an empty boutique room, shown behind the 3D mannequin.
 * Drop a file at public/fitting-room/backdrop.jpg; until then the 3D room is used.
 */
const BACKDROP_URL = '/fitting-room/backdrop.jpg'

function useBackdropPhoto(url: string): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setReady(true)
    }
    img.onerror = () => {
      if (!cancelled) setReady(false)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return ready
}


export type CameraView = 'front' | 'side' | 'back' | 'reset'
export interface FrontCaptureOptions {
  /** Garment categories left out of this capture only (e.g. outerwear for a layered try-on). */
  hideCategories?: Category[]
}
export type FrontCaptureFn = (options?: FrontCaptureOptions) => Promise<string>

/**
 * Calculates the exact camera distance so the full avatar (0 to topOfHead)
 * occupies ~80% of the visible canvas height and fits comfortably within canvas width.
 */
function computeAutoFrameDistance(
  dims: AvatarDimensions,
  fovDeg: number,
  aspect: number
): number {
  const fovRad = (fovDeg * Math.PI) / 180
  const tanHalfVFov = Math.tan(fovRad / 2)
  const safeAspect = Math.max(0.4, aspect || 1)
  const tanHalfHFov = safeAspect * tanHalfVFov

  // Real HM08 mannequin bounds (height = dims.heightM, arm-span width = height * 0.611)
  // Frame from the castor wheels of the display base up to the top of the head.
  const totalHeight = (dims.bounds.totalHeight || dims.heightM || 1.65) - PEDESTAL_FLOOR_Y
  const totalWidth = Math.max(dims.bounds.totalWidth, totalHeight * 0.611)

  // Target 80% vertical fill (10% margin above head, 10% below feet)
  const targetVerticalFill = 0.80
  const targetHorizontalFill = 0.78

  const requiredVerticalSpan = totalHeight / targetVerticalFill
  const requiredHorizontalSpan = totalWidth / targetHorizontalFill

  const frontSurfaceOffset = Math.max(
    dims.bounds.maxRadius * dims.torsoDepthRatio * 0.4,
    0.08
  )

  const distV = requiredVerticalSpan / (2 * tanHalfVFov) + frontSurfaceOffset
  const distH = requiredHorizontalSpan / (2 * tanHalfHFov) + frontSurfaceOffset

  return Math.max(distV, distH)
}

function SceneCameraRig({
  dims,
  preset,
  autoRotate,
  onUserOrbitStart,
  onSnapToFront,
  onRegisterFrontCapture,
}: {
  dims: AvatarDimensions
  preset: { view: CameraView; seq: number }
  autoRotate: boolean
  onUserOrbitStart: () => void
  onSnapToFront: () => void
  onRegisterFrontCapture?: (captureFn: FrontCaptureFn) => void
}) {
  const { camera, gl, scene, size } = useThree()
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const initializedRef = useRef(false)

  const fov = camera instanceof PerspectiveCamera ? camera.fov : 35
  const aspect = size.height > 0 ? size.width / size.height : 1
  const fitDist = useMemo(
    () => computeAutoFrameDistance(dims, fov, aspect),
    [dims, fov, aspect]
  )
  const prevFitDistRef = useRef<number>(fitDist)
  const targetY = dims.bounds.centerY + PEDESTAL_FLOOR_Y / 2
  const camY = targetY + dims.bounds.totalHeight * 0.02

  // Register deterministic front-view canvas capture for AI Virtual Try-On
  useEffect(() => {
    if (!onRegisterFrontCapture) return
    const captureFront: FrontCaptureFn = async (options = {}) => {
      onSnapToFront()
      const orbit = controlsRef.current
      const cam = orbit ? orbit.object : camera
      if (orbit) {
        orbit.target.set(0, targetY, 0)
      }
      cam.position.set(0, camY, fitDist)
      cam.lookAt(0, targetY, 0)
      if (orbit) {
        orbit.update()
      }
      // The worker cuts the mannequin out of this picture, so the room and display base
      // are hidden and a flat opaque background is used for the capture only.
      // (A transparent canvas would reach the worker as a black background.)
      const stage = scene.getObjectByName('display-stage')
      const hidden = (options.hideCategories ?? [])
        .map(cat => scene.getObjectByName(`garment-${cat}`))
        .filter((obj): obj is NonNullable<typeof obj> => Boolean(obj && obj.visible))
      const previousBackground = scene.background
      if (stage) stage.visible = false
      for (const obj of hidden) obj.visible = false
      scene.background = CAPTURE_BACKGROUND
      gl.render(scene, cam)
      const dataUrl = gl.domElement.toDataURL('image/png')
      scene.background = previousBackground
      if (stage) stage.visible = true
      for (const obj of hidden) obj.visible = true
      gl.render(scene, cam)
      return dataUrl
    }
    onRegisterFrontCapture(captureFront)
  }, [onRegisterFrontCapture, onSnapToFront, camera, gl, scene, fitDist, targetY, camY])

  // Apply initial framing and respond to explicit Front / Side / Back / Reset buttons
  useEffect(() => {
    const orbit = controlsRef.current
    if (!initializedRef.current || preset.seq > 0) {
      initializedRef.current = true
      const view = preset.view
      const cam = orbit ? orbit.object : camera

      if (orbit) {
        orbit.target.set(0, targetY, 0)
      }

      if (view === 'front' || view === 'reset') {
        cam.position.set(0, camY, fitDist)
      } else if (view === 'back') {
        cam.position.set(0, camY, -fitDist)
      } else if (view === 'side') {
        cam.position.set(fitDist, camY, 0)
      }

      cam.lookAt(0, targetY, 0)
      if (orbit) {
        orbit.update()
      }
    }
  }, [preset, fitDist, targetY, camY, camera])

  // Reframe smoothly whenever fitDist changes (aspect ratio or canvas dimension changes)
  useEffect(() => {
    const orbit = controlsRef.current
    if (!orbit) return

    orbit.target.set(0, targetY, 0)

    if (Math.abs(prevFitDistRef.current - fitDist) > 0.02) {
      prevFitDistRef.current = fitDist
      const cam = orbit.object
      const dir = cam.position.clone().sub(orbit.target)
      if (dir.lengthSq() > 0.0001) {
        dir.normalize().multiplyScalar(fitDist)
        const nextPos = orbit.target.clone().add(dir)
        cam.position.set(nextPos.x, camY, nextPos.z)
      }
      orbit.update()
    }
  }, [fitDist, targetY, camY])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[0, targetY, 0]}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={fitDist * 0.60}
      maxDistance={fitDist * 1.35}
      minPolarAngle={0.22}
      maxPolarAngle={Math.PI / 2 - 0.03}
      autoRotate={autoRotate}
      autoRotateSpeed={2.0}
      onStart={onUserOrbitStart}
    />
  )
}

export default function Avatar3D({
  profile,
  worn,
  autoRotate = false,
  onAutoRotateChange,
  onRegisterFrontCapture,
  showProfileBadge = true,
  note,
}: {
  profile: BodyProfile
  worn: ClothingItem[]
  autoRotate?: boolean
  onAutoRotateChange?: (spinning: boolean) => void
  onRegisterFrontCapture?: (captureFn: FrontCaptureFn) => void
  /** Show height/weight/tone in the corner (off when the page shows its own summary). */
  showProfileBadge?: boolean
  /** Extra corner note, e.g. "Approximate 3D Preview". */
  note?: string
}) {
  const dims = useMemo(() => computeAvatarDimensions(profile), [profile])
  const [preset, setPreset] = useState<{ view: CameraView; seq: number }>({
    view: 'front',
    seq: 0,
  })
  const [manualOrbited, setManualOrbited] = useState(false)
  const gender = useSelectedMannequinGender()
  const hasBackdrop = useBackdropPhoto(BACKDROP_URL)
  const chooseGender = (next: MannequinGender) => setMannequinGender(next)

  // Only highlight a preset button when not auto-rotating and not manually orbited away
  const activeView: 'front' | 'side' | 'back' | null =
    autoRotate || manualOrbited
      ? null
      : preset.view === 'reset'
        ? 'front'
        : preset.view

  const triggerView = useCallback(
    (view: CameraView) => {
      // Pause auto-rotation when user selects an explicit camera preset
      if (autoRotate && onAutoRotateChange) {
        onAutoRotateChange(false)
      }
      setManualOrbited(false)
      setPreset(prev => ({ view, seq: prev.seq + 1 }))
    },
    [autoRotate, onAutoRotateChange]
  )

  const handleSnapToFront = useCallback(() => {
    triggerView('front')
  }, [triggerView])

  const handleUserOrbitStart = () => {
    setManualOrbited(true)
    if (autoRotate) onAutoRotateChange?.(false)
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-ink/10 bg-gradient-to-b from-[#f5f3ef] via-[#edeae3] to-[#e1dcd3] ${PREVIEW_FRAME_HEIGHT}`}
      data-testid='avatar-viewport'
      style={
        hasBackdrop
          ? { backgroundImage: `url(${BACKDROP_URL})`, backgroundSize: 'cover', backgroundPosition: 'center bottom' }
          : undefined
      }
    >
      {note && (
        <div className='pointer-events-none absolute bottom-3 right-3 z-10 rounded-lg border border-ink/10 bg-white/90 px-2 py-1 text-[11px] font-medium text-muted shadow-sm'>
          {note}
        </div>
      )}

      {/* Top-left parametric profile summary badge */}
      {showProfileBadge && (
      <div className='pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-ink/10 bg-white/90 px-2.5 py-1.5 text-xs text-ink shadow-sm backdrop-blur-sm'>
        <span className='font-semibold text-brand'>{dims.profile.height_cm} cm</span>
        <span className='text-muted'>·</span>
        <span>{dims.profile.weight_kg} kg</span>
        <span className='hidden text-muted sm:inline'>·</span>
        <span className='hidden capitalize sm:inline'>{dims.profile.skin_undertone} tone</span>
        <span className='hidden text-muted sm:inline'>·</span>
        <span className='hidden capitalize sm:inline'>{dims.profile.fit_pref} fit</span>
      </div>
      )}

      {/* Top-right interactive camera view buttons */}
      <div className='absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-ink/10 bg-white/90 p-1 shadow-sm backdrop-blur-sm'>
        {(['front', 'side', 'back', 'reset'] as const).map(v => {
          const isActive = v !== 'reset' && activeView === v
          return (
            <button
              key={v}
              type='button'
              onClick={() => triggerView(v)}
              aria-pressed={isActive}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${isActive
                  ? 'bg-brand text-white shadow-xs'
                  : 'text-ink hover:bg-ink/5'
                }`}
              title={`Switch camera to ${v} view`}
            >
              {v}
            </button>
          )
        })}
      </div>

      {/* Bottom-left mannequin body choice */}
      <div
        className='absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-ink/10 bg-white/90 p-1 shadow-sm backdrop-blur-sm'
        role='radiogroup'
        aria-label='Mannequin body'
      >
        {(['female', 'male'] as const).map(g => (
          <button
            key={g}
            type='button'
            role='radio'
            aria-checked={gender === g}
            onClick={() => chooseGender(g)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
              gender === g ? 'bg-ink text-white' : 'text-ink hover:bg-ink/5'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <Canvas
        frameloop='demand'
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{
          position: [0, dims.bounds.centerY, 3.35],
          fov: 35,
          near: 0.08,
          far: 30,
        }}
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <ambientLight intensity={0.25} />
        <hemisphereLight args={['#fffcf5', '#9d9690', 0.65]} />
        <directionalLight position={[-3, 4, 4]} intensity={2.4} color='#fff6e8' />
        <directionalLight position={[3, 2, 1]} intensity={0.7} color='#e6efff' />
        <directionalLight position={[1, 3, -3]} intensity={1.6} />
        <Environment resolution={128}>
          <Lightformer position={[-3, 3, 3]} rotation={[0, Math.PI / 4, 0]} scale={[3, 5, 1]} intensity={3} />
          <Lightformer position={[3, 2, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[2, 4, 1]} intensity={1.5} />
          <Lightformer position={[0, 4, -3]} rotation={[0, Math.PI, 0]} scale={[3, 3, 1]} intensity={2} />
        </Environment>
        <MannequinGenderContext.Provider value={gender}>
        <group name='display-stage'>
          {!hasBackdrop && (
            <Suspense fallback={null}>
              <FittingRoomStage />
            </Suspense>
          )}
          <ContactShadows position={[0, PEDESTAL_FLOOR_Y, 0]} opacity={0.5} scale={4} blur={2.2} far={2.5} resolution={512} color='#3d3a36' />
          <MannequinPedestal />
        </group>

        {/* High-Quality GLB Studio Mannequin with Morph Targets (and Procedural Fallback) */}
        <Suspense fallback={null}>
          <FashionMannequinModel profile={dims.profile} />
        </Suspense>

        {/* Equipped Modular Garments */}
        <Suspense fallback={null}>
          {worn.map(item => (
            <group key={item.id} name={`garment-${item.category}`}>
              <GarmentMesh item={item} dims={dims} />
            </group>
          ))}
        </Suspense>

        {/* Dynamic Auto-Framing Camera & Bounded OrbitControls */}
        <SceneCameraRig
          dims={dims}
          preset={preset}
          autoRotate={autoRotate}
          onUserOrbitStart={handleUserOrbitStart}
          onSnapToFront={handleSnapToFront}
          onRegisterFrontCapture={onRegisterFrontCapture}
        />
        </MannequinGenderContext.Provider>
      </Canvas>
    </div>
  )
}
