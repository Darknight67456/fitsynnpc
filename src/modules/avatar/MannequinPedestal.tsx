/**
 * Square glass plinth the mannequin stands on, as in the boutique concept photo.
 * The top surface sits at y = 0 so the mannequin's feet stay where they were;
 * the plate and the room floor sit just below it.
 */
const GLASS_W = 0.72
const GLASS_D = 0.56
const GLASS_T = 0.022

/** Height of the room floor, just under the glass plate. */
export const PEDESTAL_FLOOR_Y = -GLASS_T - 0.002

export default function MannequinPedestal() {
  return (
    <group name='mannequin-pedestal'>
      <mesh position={[0, -GLASS_T / 2, 0.02]}>
        <boxGeometry args={[GLASS_W, GLASS_T, GLASS_D]} />
        <meshPhysicalMaterial
          color='#e8f1ee'
          transmission={0.92}
          thickness={0.02}
          roughness={0.04}
          ior={1.5}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Slightly green glass edge so the plate reads as glass from the front */}
      <mesh position={[0, -GLASS_T / 2, 0.02 + GLASS_D / 2 + 0.0006]}>
        <planeGeometry args={[GLASS_W, GLASS_T]} />
        <meshBasicMaterial color='#b9d3c9' transparent opacity={0.7} />
      </mesh>
    </group>
  )
}
