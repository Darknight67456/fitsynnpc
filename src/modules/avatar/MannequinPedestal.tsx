/**
 * Round rolling display base the mannequin stands on: a white top, a layered
 * plywood edge, a steel foot plate and four castor wheels underneath.
 * The top surface sits at y = 0 so the mannequin's feet stay where they were;
 * everything else hangs below the floor line, inside the camera's bottom margin.
 */
const TOP_Y = 0
const RADIUS = 0.46
const WHITE_TOP = 0.012
const PLY_LAYER = 0.03
const PLY_GAP = 0.006
const WHEEL_R = 0.022

const plyY1 = TOP_Y - WHITE_TOP - PLY_LAYER / 2
const plyY2 = plyY1 - PLY_LAYER - PLY_GAP
const plyBottom = plyY2 - PLY_LAYER / 2
export const PEDESTAL_FLOOR_Y = plyBottom - 0.012 - WHEEL_R * 2

const CASTER_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]

export default function MannequinPedestal() {
  return (
    <group name='mannequin-pedestal'>
      {/* White laminate top */}
      <mesh position={[0, TOP_Y - WHITE_TOP / 2, 0]} receiveShadow>
        <cylinderGeometry args={[RADIUS, RADIUS, WHITE_TOP, 96]} />
        <meshPhysicalMaterial color='#f4f3ef' roughness={0.35} clearcoat={0.4} clearcoatRoughness={0.3} />
      </mesh>

      {/* Two plywood discs with a dark seam between them */}
      {[plyY1, plyY2].map(y => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[RADIUS - 0.004, RADIUS - 0.004, PLY_LAYER, 96]} />
          <meshStandardMaterial color='#c79a63' roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, plyY1 - PLY_LAYER / 2 - PLY_GAP / 2, 0]}>
        <cylinderGeometry args={[RADIUS - 0.02, RADIUS - 0.02, PLY_GAP, 96]} />
        <meshStandardMaterial color='#4a3a2a' roughness={0.9} />
      </mesh>

      {/* Steel foot plate */}
      <mesh position={[0, TOP_Y + 0.002, 0.01]}>
        <boxGeometry args={[0.2, 0.004, 0.17]} />
        <meshStandardMaterial color='#b9bcc0' metalness={0.6} roughness={0.35} />
      </mesh>

      {/* Castor wheels */}
      {CASTER_ANGLES.map(a => {
        const x = Math.cos(a) * RADIUS * 0.72
        const z = Math.sin(a) * RADIUS * 0.72
        return (
          <group key={a} position={[x, plyBottom, z]}>
            <mesh position={[0, -0.006, 0]}>
              <boxGeometry args={[0.05, 0.012, 0.05]} />
              <meshStandardMaterial color='#9a9ea3' metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.012 - WHEEL_R, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.02, 24]} />
              <meshStandardMaterial color='#2b2d31' roughness={0.6} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
