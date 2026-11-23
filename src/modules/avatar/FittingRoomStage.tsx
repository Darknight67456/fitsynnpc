import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  CanvasTexture,
  Color,
  InstancedMesh,
  Object3D,
  Shape,
  SRGBColorSpace,
  Vector2,
} from 'three'
import { PEDESTAL_FLOOR_Y } from './MannequinPedestal'

/**
 * Boutique fitting room around the mannequin, following the team's concept photo:
 * warm plaster wall with an arched alcove, olive tree in a stone pot, a fluted walnut
 * sideboard with framed art and a vase, pale stone floor and a cream rug.
 * The wall is a full circle so every orbit angle still shows a room; the decor sits
 * behind the mannequin where the front camera sees it.
 * Purely decorative: Avatar3D hides it while capturing the front view for CatVTON.
 */
const R = 3.4
const WALL_H = 3.2
const Y0 = PEDESTAL_FLOOR_Y

/** Position + rotation for something standing at `inset` metres in front of the wall at angle `deg` (0 = straight behind). */
function onWall(deg: number, inset: number): { position: [number, number, number]; rotation: [number, number, number] } {
  const a = (deg * Math.PI) / 180
  const r = R - inset
  return { position: [Math.sin(a) * r, Y0, -Math.cos(a) * r], rotation: [0, -a, 0] }
}

function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

// ---------- Arched alcove ----------
function ArchAlcove() {
  const shape = useMemo(() => {
    const w = 1.05
    const straight = 1.85
    const s = new Shape()
    s.moveTo(-w / 2, 0)
    s.lineTo(w / 2, 0)
    s.lineTo(w / 2, straight)
    s.absarc(0, straight, w / 2, 0, Math.PI, false)
    s.lineTo(-w / 2, 0)
    return s
  }, [])
  const { position, rotation } = onWall(33, 0.02)
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <shapeGeometry args={[shape, 48]} />
        <meshStandardMaterial color='#cbbfae' roughness={0.97} />
      </mesh>
    </group>
  )
}

// ---------- Fluted walnut sideboard with art and vase ----------
function useArtTexture() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 400
    const g = c.getContext('2d')
    if (!g) return null
    g.fillStyle = '#efe4d3'
    g.fillRect(0, 0, 300, 400)
    g.fillStyle = '#c98d5f'
    g.beginPath()
    g.ellipse(120, 300, 110, 150, 0, Math.PI, 0)
    g.fill()
    g.fillRect(10, 300, 220, 90)
    g.fillStyle = '#d6a23c'
    g.beginPath()
    g.arc(210, 120, 38, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#1f2a22'
    g.fillStyle = '#1f2a22'
    g.lineWidth = 5
    g.beginPath()
    g.moveTo(150, 360)
    g.quadraticCurveTo(155, 250, 150, 170)
    g.stroke()
    for (let i = 0; i < 5; i++) {
      const y = 330 - i * 34
      for (const dir of [-1, 1]) {
        g.beginPath()
        g.ellipse(150 + dir * 34, y - 8, 34, 12, dir * -0.6, 0, Math.PI * 2)
        g.fill()
      }
    }
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

function Sideboard() {
  const art = useArtTexture()
  const W = 1.3
  const H = 0.6
  const D = 0.42
  const LEG = 0.08
  const flutes = 26
  const { position, rotation } = onWall(24, D / 2 + 0.03)
  const walnut = '#7b4f2f'
  return (
    <group position={position} rotation={rotation}>
      {/* Body */}
      <mesh position={[0, LEG + H / 2, 0]}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color={walnut} roughness={0.55} />
      </mesh>
      {/* Top board */}
      <mesh position={[0, LEG + H + 0.015, 0]}>
        <boxGeometry args={[W + 0.04, 0.03, D + 0.03]} />
        <meshStandardMaterial color='#6e4529' roughness={0.5} />
      </mesh>
      {/* Fluted front */}
      {Array.from({ length: flutes }, (_, i) => {
        const x = -W / 2 + 0.06 + (i * (W - 0.12)) / (flutes - 1)
        return (
          <mesh key={i} position={[x, LEG + H / 2, D / 2]}>
            <cylinderGeometry args={[0.02, 0.02, H - 0.08, 10, 1, false, -Math.PI / 2, Math.PI]} />
            <meshStandardMaterial color='#83563a' roughness={0.5} />
          </mesh>
        )
      })}
      {/* Legs */}
      {[-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}${sz}`} position={[sx * (W / 2 - 0.06), LEG / 2, sz * (D / 2 - 0.05)]}>
            <boxGeometry args={[0.05, LEG, 0.05]} />
            <meshStandardMaterial color='#5b3a22' roughness={0.6} />
          </mesh>
        ))
      )}

      {/* Framed art leaning on the wall */}
      <group position={[-0.18, LEG + H + 0.03, -D / 2 + 0.06]} rotation={[-0.08, 0, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.46, 0.6, 0.025]} />
          <meshStandardMaterial color='#c9a77c' roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.3, 0.014]}>
          <planeGeometry args={[0.38, 0.52]} />
          {art ? <meshStandardMaterial map={art} roughness={0.9} /> : <meshStandardMaterial color='#efe4d3' />}
        </mesh>
      </group>

      {/* Amber glass vase with a few green sprigs */}
      <group position={[0.32, LEG + H + 0.03, 0.02]}>
        <mesh position={[0, 0.1, 0]}>
          <sphereGeometry args={[0.085, 24, 16]} />
          <meshPhysicalMaterial color='#8a4f22' roughness={0.15} transmission={0.4} thickness={0.05} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.025, 0.035, 0.06, 16]} />
          <meshPhysicalMaterial color='#8a4f22' roughness={0.15} transparent opacity={0.85} />
        </mesh>
        {[-0.5, 0, 0.45].map((tilt, i) => (
          <mesh key={i} position={[Math.sin(tilt) * 0.08, 0.32, 0]} rotation={[0, 0, -tilt]}>
            <cylinderGeometry args={[0.004, 0.004, 0.26, 6]} />
            <meshStandardMaterial color='#5f6d48' />
          </mesh>
        ))}
        <Leaves count={40} seed={11} center={[0, 0.4, 0]} spread={[0.14, 0.12, 0.08]} scale={0.6} />
      </group>
    </group>
  )
}

// ---------- Olive tree ----------
function Leaves({
  count,
  seed,
  center,
  spread,
  scale = 1,
}: {
  count: number
  seed: number
  center: [number, number, number]
  spread: [number, number, number]
  scale?: number
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const rnd = random(seed)
    const dummy = new Object3D()
    const color = new Color()
    for (let i = 0; i < count; i++) {
      // Gaussian-ish cloud of leaves around the branch tip
      const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5
      dummy.position.set(center[0] + g() * spread[0], center[1] + g() * spread[1], center[2] + g() * spread[2])
      dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI)
      // Olive leaf: about 5 cm long, 1.2 cm wide, very thin
      const s = (0.8 + rnd() * 0.5) * scale
      dummy.scale.set(0.012 * s, 0.004 * s, 0.05 * s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      color.set(rnd() > 0.5 ? '#76845c' : '#8a9670').offsetHSL(0, 0, (rnd() - 0.5) * 0.06)
      mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [count, seed, center, spread, scale])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      {/* A long thin leaf: squashed, stretched sphere */}
      <sphereGeometry args={[1, 6, 4]} />
      <meshStandardMaterial roughness={0.8} />
    </instancedMesh>
  )
}

function OliveTree() {
  const pot = useMemo(
    () =>
      [
        [0.0, 0],
        [0.24, 0],
        [0.3, 0.08],
        [0.33, 0.3],
        [0.31, 0.52],
        [0.29, 0.56],
        [0.0, 0.56],
      ].map(([x, y]) => new Vector2(x, y)),
    []
  )
  const { position } = onWall(-38, 0.75)
  const branches: { tip: [number, number, number]; len: number; rot: [number, number, number] }[] = [
    { tip: [-0.35, 1.75, 0.05], len: 0.55, rot: [0, 0, 0.7] },
    { tip: [0.3, 1.95, -0.05], len: 0.5, rot: [0, 0, -0.6] },
    { tip: [-0.2, 2.25, 0.1], len: 0.45, rot: [0.2, 0, 0.4] },
    { tip: [0.18, 2.4, 0.05], len: 0.4, rot: [-0.1, 0, -0.35] },
    { tip: [0.02, 2.6, 0], len: 0.3, rot: [0, 0, 0] },
  ]
  return (
    <group position={position}>
      <mesh>
        <latheGeometry args={[pot, 40]} />
        <meshStandardMaterial color='#c6a684' roughness={0.9} />
      </mesh>
      {/* Soil */}
      <mesh position={[0, 0.53, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.29, 32]} />
        <meshStandardMaterial color='#4a3a2c' roughness={1} />
      </mesh>
      {/* Trunk */}
      <mesh position={[0, 0.53 + 0.8, 0]} rotation={[0, 0, 0.04]}>
        <cylinderGeometry args={[0.022, 0.04, 1.6, 10]} />
        <meshStandardMaterial color='#5c4632' roughness={0.9} />
      </mesh>
      {branches.map((b, i) => (
        <group key={i}>
          <mesh position={[b.tip[0] / 2, b.tip[1] - b.len / 2, b.tip[2] / 2]} rotation={b.rot}>
            <cylinderGeometry args={[0.008, 0.016, b.len, 6]} />
            <meshStandardMaterial color='#5c4632' roughness={0.9} />
          </mesh>
          <Leaves count={230} seed={100 + i} center={b.tip} spread={[0.32, 0.26, 0.22]} scale={1} />
        </group>
      ))}
    </group>
  )
}

export default function FittingRoomStage() {
  return (
    <group name='fitting-room'>
      {/* Pale stone floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y0 - 0.002, 0]}>
        <circleGeometry args={[R + 0.2, 96]} />
        <meshStandardMaterial color='#d4cdc2' roughness={0.85} />
      </mesh>
      {/* Cream rug under the mannequin */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y0 - 0.0005, 0.35]}>
        <planeGeometry args={[2.6, 1.9]} />
        <meshStandardMaterial color='#ebe5db' roughness={1} />
      </mesh>

      {/* Warm plaster wall, seen from inside */}
      <mesh position={[0, Y0 + WALL_H / 2, 0]}>
        <cylinderGeometry args={[R, R, WALL_H, 128, 1, true]} />
        <meshStandardMaterial color='#d8cdbf' roughness={0.97} side={BackSide} />
      </mesh>

      <ArchAlcove />
      <Sideboard />
      <OliveTree />

      {/* Warm window light from the left, plus soft fill */}
      <pointLight position={[-2.2, Y0 + 2.4, 1.4]} intensity={6} distance={8} decay={1.5} color='#fff0da' />
      <pointLight position={[1.8, Y0 + 2.2, 0.8]} intensity={2.5} distance={7} decay={1.6} color='#ffe9cf' />
    </group>
  )
}
