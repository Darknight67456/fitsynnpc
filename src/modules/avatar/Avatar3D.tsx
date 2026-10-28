import { Suspense } from 'react'
import { DoubleSide, Vector2 } from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'
import type { BodyProfile, ClothingItem } from '../../types'

// circumference in cm -> radius in metres
const r = (cm: number) => cm / (2 * Math.PI) / 100

// Heights of the body landmarks, as a share of total height.
function levels(p: BodyProfile) {
  const H = p.height_cm / 100
  const leg = H * 0.47
  return {
    H,
    leg,
    waist: leg + H * 0.13,
    chest: leg + H * 0.27,
    shoulder: leg + H * 0.345,
    neck: leg + H * 0.38,
  }
}

// The torso is a "lathe": a profile line spun around the vertical axis.
function torsoPoints(p: BodyProfile, grow = 1) {
  const L = levels(p)
  return [
    new Vector2(r(p.hips) * grow, L.leg),
    new Vector2(r(p.waist) * grow, L.waist),
    new Vector2(r(p.chest) * grow, L.chest),
    new Vector2((p.shoulder / 200) * grow, L.shoulder),
    new Vector2(0.05 * grow, L.neck),
  ]
}

const SIDES = [-1, 1]
const SKIN = '#e8c3a0'

function Body({ p }: { p: BodyProfile }) {
  const L = levels(p)
  return (
    <group>
      <mesh scale={[1, 1, 0.65]}>
        <latheGeometry args={[torsoPoints(p), 48]} />
        <meshStandardMaterial color={SKIN} side={DoubleSide} />
      </mesh>
      {SIDES.map(s => (
        <mesh key={'leg' + s} position={[s * r(p.hips) * 0.55, L.leg / 2, 0]}>
          <cylinderGeometry args={[r(p.hips) * 0.42, r(p.hips) * 0.27, L.leg, 24]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
      ))}
      {SIDES.map(s => (
        <mesh key={'arm' + s} position={[s * (p.shoulder / 200 + 0.03), L.shoulder - L.H * 0.165, 0]}>
          <cylinderGeometry args={[0.04, 0.03, L.H * 0.33, 16]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
      ))}
      <mesh position={[0, L.neck + L.H * 0.07, 0]}>
        <sphereGeometry args={[L.H * 0.07, 32, 32]} />
        <meshStandardMaterial color={SKIN} />
      </mesh>
    </group>
  )
}

// Clothes: use the item's photo as a texture, or its color when it has no photo.
function TexturedFabric({ url }: { url: string }) {
  const map = useTexture(url)
  return <meshStandardMaterial map={map} side={DoubleSide} />
}

function Fabric({ item }: { item: ClothingItem }) {
  return item.image_url
    ? <TexturedFabric url={item.image_url} />
    : <meshStandardMaterial color={item.color} side={DoubleSide} />
}

function Garment({ item, p }: { item: ClothingItem; p: BodyProfile }) {
  const L = levels(p)

  if (item.category === 'top' || item.category === 'outerwear') {
    const grow = item.category === 'outerwear' ? 1.12 : 1.05
    return (
      <mesh scale={[1, 1, 0.65]}>
        <latheGeometry args={[torsoPoints(p, grow), 48]} />
        <Fabric item={item} />
      </mesh>
    )
  }
  if (item.category === 'dress') {
    // one piece: a fitted upper body plus a flared skirt down to about the knee
    const skirtH = L.leg * 0.58
    return (
      <>
        <mesh scale={[1, 1, 0.65]}>
          <latheGeometry args={[torsoPoints(p, 1.05), 48]} />
          <Fabric item={item} />
        </mesh>
        <mesh position={[0, L.leg - skirtH / 2 + 0.02, 0]} scale={[1, 1, 0.75]}>
          <cylinderGeometry args={[r(p.hips) * 1.05, r(p.hips) * 1.45, skirtH, 40, 1, true]} />
          <Fabric item={item} />
        </mesh>
      </>
    )
  }
  if (item.category === 'bottom') {
    return (
      <>
        {SIDES.map(s => (
          <mesh key={s} position={[s * r(p.hips) * 0.55, L.leg / 2, 0]}>
            <cylinderGeometry args={[r(p.hips) * 0.46, r(p.hips) * 0.31, L.leg * 0.95, 24]} />
            <Fabric item={item} />
          </mesh>
        ))}
      </>
    )
  }
  if (item.category === 'shoes') {
    return (
      <>
        {SIDES.map(s => (
          <mesh key={s} position={[s * r(p.hips) * 0.55, 0.04, 0.05]}>
            <boxGeometry args={[0.1, 0.08, 0.28]} />
            <Fabric item={item} />
          </mesh>
        ))}
      </>
    )
  }
  return null
}

export default function Avatar3D({ profile, worn, autoRotate = false }: {
  profile: BodyProfile
  worn: ClothingItem[]
  autoRotate?: boolean
}) {
  return (
    <Canvas camera={{ position: [0, 1.1, 3.2], fov: 40 }} dpr={[1, 2]} className='h-[520px] w-full'>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <Body p={profile} />
      <Suspense fallback={null}>
        {worn.map(item => <Garment key={item.id} item={item} p={profile} />)}
      </Suspense>
      <OrbitControls target={[0, 0.85, 0]} enablePan={false} autoRotate={autoRotate} />
    </Canvas>
  )
}
