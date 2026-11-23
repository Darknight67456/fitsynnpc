import { useMemo } from 'react'
import { DoubleSide, Mesh, Vector2 } from 'three'
import { useGLTF } from '@react-three/drei'
import type { ClothingItem } from '../../types'
import {
  buildDressLathePoints,
  buildLegLathePoints,
  buildSkirtLathePoints,
  buildSleeveLathePoints,
  buildTorsoLathePoints,
  type AvatarDimensions,
} from './avatarMeasurements'
import { resolveGarmentMaterial } from './garmentMaterials'
import { computeMannequinMorphWeights, MANNEQUIN_GLB_PATHS } from './mannequinMorphs'
import { useMannequinGender } from './mannequinGender'

const SIDES = [-1, 1] as const

interface GarmentMeshProps {
  item: ClothingItem
  dims: AvatarDimensions
  useGlbProxy?: boolean
}

function GarmentMaterial({
  item,
  polygonOffset = false,
  offsetFactor = -1,
}: {
  item: ClothingItem
  polygonOffset?: boolean
  offsetFactor?: number
}) {
  const mat = useMemo(() => resolveGarmentMaterial(item), [item])

  return (
    <meshStandardMaterial
      color={mat.color}
      map={mat.patternTexture}
      roughness={mat.roughness}
      metalness={mat.metalness}
      side={DoubleSide}
      polygonOffset={polygonOffset}
      polygonOffsetFactor={polygonOffset ? offsetFactor : 0}
      polygonOffsetUnits={polygonOffset ? offsetFactor : 0}
    />
  )
}

/**
 * Selects the matching MakeHuman HM08 topology proxy sub-mesh name embedded in
 * `/models/fashion-mannequin.glb` for a given wardrobe item, or null if the item
 * is an external prop accessory (watch, hat, bag).
 */
/** Sleeve length given explicitly in tags (set for demo catalog garments), or null to guess from the name. */
function explicitSleeve(item: ClothingItem): 'long' | 'short' | null {
  const tags = item.tags ?? []
  if (tags.includes('long-sleeve')) return 'long'
  if (tags.includes('short-sleeve') || tags.includes('sleeveless')) return 'short'
  return null
}

/** Catalog garment types worn as a long-sleeved tunic over a separate lower piece. */
// Upper and lower mesh for each two-piece outfit. A floor-length dress mesh stands in for
// a long skirt or sarong; the upper piece is drawn on top of it.
const TWO_PIECE: Record<string, { upper: string; lower: string }> = {
  'type:kurta_set': { upper: 'GarmentTopKurung', lower: 'GarmentTrousers' },
  'type:salwar_kameez': { upper: 'GarmentTopKurung', lower: 'GarmentTrousers' },
  'type:baju_kurung': { upper: 'GarmentTopKurung', lower: 'GarmentDressMaxi' },
  'type:kebaya': { upper: 'GarmentTopKurung', lower: 'GarmentDressMaxi' },
  'type:lehenga': { upper: 'GarmentTopBlouse', lower: 'GarmentDressMaxi' },
}

function twoPieceShape(
  item: ClothingItem
): { upper: string; lower: string; lowerColor: string | null } | null {
  // Only full outfits; a kebaya sold on its own is a "top" and keeps the normal top shape.
  if (item.category !== 'dress') return null
  const tags = item.tags ?? []
  const tag = tags.find(t => t in TWO_PIECE)
  if (!tag) return null
  const lowerColor = tags.find(t => t.startsWith('lower-color:'))?.slice('lower-color:'.length) ?? null
  return { ...TWO_PIECE[tag], lowerColor }
}

function resolveHm08ProxyMeshName(item: ClothingItem): string | null {
  const nameLower = item.name.toLowerCase()
  const tagsLower = (item.tags ?? []).map(t => t.toLowerCase())
  const subtypeLower = (item.subtype ?? '').toLowerCase()

  if (item.category === 'top') {
    const isKurungOrTunic =
      nameLower.includes('kurung') ||
      nameLower.includes('tunic') ||
      tagsLower.includes('traditional')
    if (isKurungOrTunic) return 'GarmentTopKurung'

    const sleeve = explicitSleeve(item)
    if (sleeve === 'long') return 'GarmentTopLong'
    if (sleeve === 'short') return 'GarmentTopTshirt'

    const isLongSleeveTop =
      nameLower.includes('oxford') ||
      nameLower.includes('sweater') ||
      nameLower.includes('hoodie') ||
      nameLower.includes('cardigan') ||
      nameLower.includes('long sleeve') ||
      (nameLower.includes('shirt') && !nameLower.includes('t-shirt')) ||
      item.season === 'cool'
    if (isLongSleeveTop) return 'GarmentTopLong'

    const isThreeQuarterBlouse =
      nameLower.includes('blouse') || item.fabric === 'silk'
    if (isThreeQuarterBlouse) return 'GarmentTopBlouse'

    return 'GarmentTopTshirt'
  }

  if (item.category === 'bottom') {
    if (nameLower.includes('skirt')) {
      return nameLower.includes('midi') || item.formality >= 3
        ? 'GarmentSkirtMidi'
        : 'GarmentSkirtMini'
    }
    if (nameLower.includes('short') || tagsLower.includes('sportswear')) {
      return 'GarmentShorts'
    }
    return 'GarmentTrousers'
  }

  if (item.category === 'dress') {
    const isMaxiDress =
      nameLower.includes('evening') ||
      nameLower.includes('maxi') ||
      nameLower.includes('gown') ||
      item.formality >= 5
    return isMaxiDress ? 'GarmentDressMaxi' : 'GarmentDressMidi'
  }

  if (item.category === 'outerwear') {
    if (nameLower.includes('trench') || nameLower.includes('coat')) {
      return 'GarmentOuterCoat'
    }
    if (nameLower.includes('blazer')) {
      return 'GarmentOuterBlazer'
    }
    return 'GarmentOuterJacket'
  }

  if (item.category === 'shoes') {
    const tagsLower = (item.tags || []).join(' ').toLowerCase()
    if (
      nameLower.includes('heel') ||
      nameLower.includes('pump') ||
      nameLower.includes('stiletto') ||
      nameLower.includes('wedge') ||
      subtypeLower.includes('heel') ||
      subtypeLower.includes('pump') ||
      tagsLower.includes('heel')
    ) {
      return 'GarmentShoesHeels'
    }
    if (
      nameLower.includes('sneaker') ||
      nameLower.includes('trainer') ||
      nameLower.includes('running') ||
      nameLower.includes('sport') ||
      nameLower.includes('canvas') ||
      nameLower.includes('athletic') ||
      subtypeLower.includes('sneaker') ||
      subtypeLower.includes('trainer') ||
      tagsLower.includes('sneaker') ||
      tagsLower.includes('sport')
    ) {
      return 'GarmentShoesSneakers'
    }
    return 'GarmentShoesLoafers'
  }

  if (item.category === 'accessory') {
    if (subtypeLower === 'belt' || nameLower.includes('belt')) {
      return 'GarmentBelt'
    }
    const isPropAccessory =
      subtypeLower === 'watch' ||
      subtypeLower === 'jewellery' ||
      nameLower.includes('watch') ||
      nameLower.includes('bracelet') ||
      subtypeLower === 'hat' ||
      nameLower.includes('hat') ||
      nameLower.includes('cap') ||
      nameLower.includes('beret') ||
      subtypeLower === 'bag' ||
      nameLower.includes('bag') ||
      nameLower.includes('tote') ||
      nameLower.includes('clutch') ||
      nameLower.includes('purse')
    if (isPropAccessory) return null
    return 'GarmentShawl'
  }

  return null
}

/**
 * Renders an authentic MakeHuman HM08 topology-matched garment proxy sub-mesh
 * extracted from `helper-tights` / `helper-skirt` in `/models/fashion-mannequin.glb`
 * and drives its 5 embedded morph targets in 1:1 lockstep with `MannequinBody`.
 */
function Hm08ProxyGarmentMesh({
  meshName,
  item,
  dims,
  offsetFactor: offsetOverride,
}: {
  meshName: string
  item: ClothingItem
  dims: AvatarDimensions
  /** Depth bias; more negative draws in front of overlapping garments. */
  offsetFactor?: number
}) {
  const gender = useMannequinGender()
  const gltf = useGLTF(MANNEQUIN_GLB_PATHS[gender])
  const weights = useMemo(
    () => computeMannequinMorphWeights(dims.profile, gender),
    [dims.profile, gender]
  )

  const geometry = useMemo(() => {
    let found: Mesh['geometry'] | null = null
    gltf.scene.traverse(obj => {
      if ((obj as Mesh).isMesh && obj.name === meshName) {
        found = (obj as Mesh).geometry
      }
    })
    return found
  }, [gltf.scene, meshName])

  // Apply fit_pref ease as a subtle morph offset on body_mass (+0.15 for loose, -0.08 for slim)
  const fitMassBonus =
    dims.profile.fit_pref === 'loose'
      ? 0.16
      : dims.profile.fit_pref === 'slim'
      ? -0.06
      : 0.02

  if (!geometry) return null

  const offsetFactor =
    offsetOverride ??
    (item.category === 'outerwear'
      ? -2
      : item.category === 'accessory'
      ? -3
      : -1)

  const isBelt = meshName === 'GarmentBelt'

  return (
    <group
      name={`hm08-garment-${meshName}-${item.id}`}
      scale={[1, weights.heightScale, 1]}
    >
      <mesh
        geometry={geometry}
        morphTargetInfluences={[
          weights.chest_size,
          weights.waist_size,
          weights.hip_size,
          weights.shoulder_width,
          weights.body_mass + fitMassBonus,
        ]}
        castShadow
        receiveShadow
      >
        <GarmentMaterial item={item} polygonOffset offsetFactor={offsetFactor} />
      </mesh>

      {/* Gold buckle accent on HM08 waist belt */}
      {isBelt && (
        <mesh position={[0, 0.985, 0.118 + weights.waist_size * 0.028]}>
          <boxGeometry args={[0.036, 0.032, 0.010]} />
          <meshStandardMaterial color='#d4af37' metalness={0.78} roughness={0.22} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Modular, silhouette-aware 3D garment renderer.
 * When `useGlbProxy` is true (default for the HM08 Studio Mannequin), garments attach
 * using the authentic MakeHuman `helper-tights` & `helper-skirt` topology sub-meshes
 * embedded in `/models/fashion-mannequin.glb` with synchronized morph targets.
 * When in `'classic'` procedural avatar mode (`useGlbProxy = false`), falls back to
 * spline lathe geometries.
 */
export default function GarmentMesh({
  item,
  dims,
  useGlbProxy = true,
}: GarmentMeshProps) {
  const gender = useMannequinGender()
  const { levels: L, radii: R, torsoDepthRatio, fitEase } = dims
  const nameLower = item.name.toLowerCase()
  const tagsLower = (item.tags ?? []).map(t => t.toLowerCase())
  const subtypeLower = (item.subtype ?? '').toLowerCase()

  const hm08MeshName = useMemo(
    () => (useGlbProxy ? resolveHm08ProxyMeshName(item) : null),
    [useGlbProxy, item]
  )

  // Determine top/outerwear sleeve & hem characteristics for classic lathe fallback
  const isKurungOrTunic =
    nameLower.includes('kurung') ||
    nameLower.includes('tunic') ||
    tagsLower.includes('traditional')

  const sleeve = explicitSleeve(item)
  const guessedLongSleeve =
    nameLower.includes('oxford') ||
    nameLower.includes('sweater') ||
    nameLower.includes('hoodie') ||
    nameLower.includes('cardigan') ||
    nameLower.includes('long sleeve') ||
    (nameLower.includes('shirt') && !nameLower.includes('t-shirt')) ||
    item.season === 'cool'
  const isLongSleeveTop = isKurungOrTunic || (sleeve !== null ? sleeve === 'long' : guessedLongSleeve)

  const isThreeQuarterBlouse =
    !isLongSleeveTop && (nameLower.includes('blouse') || item.fabric === 'silk')

  const hasStructuredCollar =
    nameLower.includes('oxford') ||
    nameLower.includes('polo') ||
    nameLower.includes('shirt') ||
    nameLower.includes('hoodie') ||
    item.category === 'outerwear'

  const isLongCoat =
    item.category === 'outerwear' &&
    (nameLower.includes('trench') || nameLower.includes('coat'))

  const isBlazer =
    item.category === 'outerwear' && nameLower.includes('blazer')

  const isSkirt =
    item.category === 'bottom' && nameLower.includes('skirt')

  const isShorts =
    item.category === 'bottom' &&
    (nameLower.includes('short') || tagsLower.includes('sportswear'))

  const isMaxiDress =
    item.category === 'dress' &&
    (nameLower.includes('evening') ||
      nameLower.includes('maxi') ||
      nameLower.includes('gown') ||
      item.formality >= 5)

  // Classic procedural fallback geometries
  const topScale = 1.055 * fitEase
  const topBottomY = isKurungOrTunic ? L.knee + 0.07 : undefined
  const topPoints = useMemo(
    () =>
      buildTorsoLathePoints(dims, topScale, {
        startAtHip: !isKurungOrTunic,
        bottomY: topBottomY,
        closeBottom: false,
        closeTop: false,
        bustClearance: 0.018,
      }),
    [dims, topScale, isKurungOrTunic, topBottomY]
  )

  const topSleeveFraction = isLongSleeveTop
    ? 0.90
    : isThreeQuarterBlouse
    ? 0.56
    : 0.35

  const topSleevePoints = useMemo(
    () => buildSleeveLathePoints(dims, topSleeveFraction, topScale * 1.02),
    [dims, topSleeveFraction, topScale]
  )

  const outerScale = 1.115 * fitEase
  const outerBottomY = isLongCoat
    ? L.knee + 0.05
    : isBlazer
    ? L.crotch - 0.01
    : undefined

  const outerPoints = useMemo(
    () =>
      buildTorsoLathePoints(dims, outerScale, {
        startAtHip: !isLongCoat && !isBlazer,
        bottomY: outerBottomY,
        closeBottom: false,
        closeTop: false,
        bustClearance: 0.022,
      }),
    [dims, outerScale, isLongCoat, isBlazer, outerBottomY]
  )

  const outerSleevePoints = useMemo(
    () => buildSleeveLathePoints(dims, 0.92, outerScale * 1.03),
    [dims, outerScale]
  )

  const dressScale = 1.055 * fitEase
  const dressPoints = useMemo(
    () => buildDressLathePoints(dims, dressScale, isMaxiDress, 0.018),
    [dims, dressScale, isMaxiDress]
  )
  const dressSleevePoints = useMemo(
    () =>
      buildSleeveLathePoints(
        dims,
        isMaxiDress ? 0.22 : 0.30,
        dressScale * 1.02
      ),
    [dims, isMaxiDress, dressScale]
  )

  const bottomScale = 1.045 * fitEase
  const skirtPoints = useMemo(
    () =>
      buildSkirtLathePoints(
        dims,
        bottomScale * 1.02,
        nameLower.includes('midi') || item.formality >= 3
      ),
    [dims, bottomScale, nameLower, item.formality]
  )

  const pelvisPoints = useMemo(
    () => [
      new Vector2((R.hips + 0.012) * 0.56 * bottomScale, L.crotch - 0.008),
      new Vector2((R.hips + 0.014) * 0.94 * bottomScale, (L.crotch + L.hip) * 0.5),
      new Vector2((R.hips + 0.014) * 1.03 * bottomScale, L.hip),
      new Vector2(
        ((R.hips + 0.012) * 0.56 + (R.waist + 0.008) * 0.44) * bottomScale,
        (L.hip + L.waist) * 0.5
      ),
      new Vector2((R.waist + 0.008) * 1.015 * bottomScale, L.waist + 0.006),
    ],
    [R.hips, R.waist, L.crotch, L.hip, L.waist, bottomScale]
  )

  const legCutScale =
    nameLower.includes('cargo') || nameLower.includes('linen')
      ? 1.14 * fitEase
      : nameLower.includes('slim')
      ? 1.055 * fitEase
      : 1.085 * fitEase

  const pantLegPoints = useMemo(
    () =>
      buildLegLathePoints(dims, legCutScale, {
        bottomY: isShorts ? L.knee + 0.055 : L.ankle,
        openBottom: true,
      }),
    [dims, legCutScale, isShorts, L.knee, L.ankle]
  )

  // Two-piece traditional outfits stored as one catalog "dress": draw the long tunic and the
  // separate lower garment (draped trousers for a kurta set, a long skirt for baju kurung).
  const twoPiece = useGlbProxy ? twoPieceShape(item) : null
  if (twoPiece) {
    return (
      <group name={`garment-two-piece-${item.id}`}>
        <Hm08ProxyGarmentMesh
          meshName={twoPiece.lower}
          item={{ ...item, category: 'bottom', color: twoPiece.lowerColor ?? item.color }}
          dims={dims}
        />
        {/* Pushed further forward so the tunic or blouse always covers the skirt's bodice. */}
        <Hm08ProxyGarmentMesh meshName={twoPiece.upper} item={item} dims={dims} offsetFactor={-2} />
      </group>
    )
  }

  // If HM08 topology proxy mesh is active for this item, render the morph-synced GLB sub-mesh
  if (hm08MeshName) {
    return (
      <Hm08ProxyGarmentMesh
        meshName={hm08MeshName}
        item={item}
        dims={dims}
      />
    )
  }

  // --- PROP ACCESSORIES (Watch, Hat, Bag) OR CLASSIC LATHE FALLBACK ---

  if (item.category === 'accessory') {
    const isBelt = subtypeLower === 'belt' || nameLower.includes('belt')
    const isWatchOrBracelet =
      subtypeLower === 'watch' ||
      subtypeLower === 'jewellery' ||
      nameLower.includes('watch') ||
      nameLower.includes('bracelet')
    const isHat =
      subtypeLower === 'hat' ||
      nameLower.includes('hat') ||
      nameLower.includes('cap') ||
      nameLower.includes('beret')
    const isBag =
      subtypeLower === 'bag' ||
      nameLower.includes('bag') ||
      nameLower.includes('tote') ||
      nameLower.includes('clutch') ||
      nameLower.includes('purse')

    if (isBelt) {
      const beltR = (R.waist + 0.012) * 1.06 * fitEase
      return (
        <group name={`garment-accessory-belt-${item.id}`}>
          <mesh
            position={[0, L.waist + 0.005, 0]}
            scale={[1, 1, torsoDepthRatio * 1.07]}
            castShadow
          >
            <cylinderGeometry args={[beltR, beltR, 0.026, 48, 1, true]} />
            <GarmentMaterial item={item} polygonOffset offsetFactor={-3} />
          </mesh>
          <mesh position={[0, L.waist + 0.005, beltR * torsoDepthRatio * 1.08]}>
            <boxGeometry args={[0.036, 0.032, 0.008]} />
            <meshStandardMaterial color='#d4af37' metalness={0.75} roughness={0.25} />
          </mesh>
        </group>
      )
    }

    if (isWatchOrBracelet) {
      // Match the shoulder rotation baked into the GLB, then apply its vertical scale.
      const armRelaxAngle = 0.40
      const shoulderMorph = computeMannequinMorphWeights(dims.profile, gender).shoulder_width
      const wristX = -0.43828 - 0.043423 * shoulderMorph + 0.17
      const wristY = 1.00214 - 1.34
      const wx = useGlbProxy
        ? -0.17 + Math.cos(armRelaxAngle) * wristX - Math.sin(armRelaxAngle) * wristY
        : -(dims.shoulderHalfWidth * 0.95 + Math.sin(dims.armAngleRad) * dims.armLength * 0.9)
      const wy = useGlbProxy
        ? (1.34 + Math.sin(armRelaxAngle) * wristX + Math.cos(armRelaxAngle) * wristY) * (dims.heightM / 1.65)
        : L.shoulder - Math.cos(dims.armAngleRad) * dims.armLength * 0.9
      const wz = useGlbProxy ? 0.16905 : 0.018
      const rotZ = useGlbProxy ? -0.35 : -dims.armAngleRad

      return (
        <group
          name={`garment-accessory-watch-${item.id}`}
          position={[wx, wy, wz]}
          rotation={[useGlbProxy ? -0.78 : 0, 0, rotZ]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[R.wrist * 1.12, 0.007, 16, 32]} />
            <GarmentMaterial item={item} />
          </mesh>
        </group>
      )
    }

    if (isHat) {
      const hatY = useGlbProxy
        ? 1.595 * (dims.heightM / 1.65)
        : L.topOfHead - R.headHeight * 0.28
      const hatZ = useGlbProxy ? 0.042 : 0
      return (
        <group
          name={`garment-accessory-hat-${item.id}`}
          position={[0, hatY, hatZ]}
        >
          <mesh scale={[1, 0.65, 1.12]} castShadow>
            <sphereGeometry
              args={[R.headWidth * 1.14, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58]}
            />
            <GarmentMaterial item={item} />
          </mesh>
          <mesh position={[0, -0.005, 0.01]} rotation={[-0.08, 0, 0]} scale={[1.45, 1, 1.55]}>
            <cylinderGeometry args={[R.headWidth * 1.15, R.headWidth * 1.22, 0.006, 36]} />
            <GarmentMaterial item={item} />
          </mesh>
        </group>
      )
    }

    if (isBag) {
      const bagX = useGlbProxy
        ? 0.34 * (dims.heightM / 1.65)
        : dims.shoulderHalfWidth + 0.055
      const bagY = L.hip - 0.02
      return (
        <group name={`garment-accessory-bag-${item.id}`} position={[bagX, bagY, 0.03]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.065, 0.16, 0.21]} />
            <GarmentMaterial item={item} />
          </mesh>
          <mesh position={[0, 0.11, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.055, 0.006, 12, 24, Math.PI]} />
            <GarmentMaterial item={item} />
          </mesh>
        </group>
      )
    }

    const shawlTopR = R.neckBase * 1.22 * fitEase
    const shawlMidR = R.shoulderLathe * 0.96 * fitEase
    const shawlBottomR = (R.chest + 0.022) * 1.06 * fitEase
    const shawlPoints = [
      new Vector2(shawlBottomR, L.chest + 0.015),
      new Vector2(shawlMidR, L.shoulder + 0.008),
      new Vector2(shawlTopR, L.neckBase + 0.024),
      new Vector2(shawlTopR * 0.92, L.neckTop - 0.004),
    ]

    return (
      <group name={`garment-accessory-shawl-${item.id}`}>
        <mesh scale={[1, 1, torsoDepthRatio * 1.08]} castShadow receiveShadow>
          <latheGeometry args={[shawlPoints, 48]} />
          <GarmentMaterial item={item} polygonOffset offsetFactor={-3} />
        </mesh>
      </group>
    )
  }

  // --- CLASSIC PROCEDURAL MODE FALLBACKS ---

  if (item.category === 'top') {
    return (
      <group name={`garment-top-${item.id}`}>
        <mesh scale={[1, 1, torsoDepthRatio * 1.06]} castShadow receiveShadow>
          <latheGeometry args={[topPoints, 64]} />
          <GarmentMaterial item={item} polygonOffset offsetFactor={-1} />
        </mesh>

        {hasStructuredCollar && (
          <mesh
            position={[0, L.neckBase + 0.008, 0]}
            scale={[1, 1, torsoDepthRatio * 0.98]}
          >
            <cylinderGeometry
              args={[
                R.neckBase * 1.18 * topScale,
                R.neckBase * 1.14 * topScale,
                0.024,
                36,
                1,
                true,
              ]}
            />
            <GarmentMaterial item={item} polygonOffset offsetFactor={-1} />
          </mesh>
        )}

        {SIDES.map(s => (
          <group
            key={`top-sleeve-${s}`}
            position={[s * (dims.shoulderHalfWidth * 0.95), L.shoulder, 0]}
            rotation={[0, 0, s * dims.armAngleRad]}
          >
            <mesh scale={[1, 1, 0.94]} castShadow receiveShadow>
              <latheGeometry args={[topSleevePoints, 36]} />
              <GarmentMaterial item={item} polygonOffset offsetFactor={-1} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }

  if (item.category === 'outerwear') {
    const phiStart = 0.30
    const phiLength = Math.PI * 2 - 0.60

    return (
      <group name={`garment-outerwear-${item.id}`}>
        <mesh scale={[1, 1, torsoDepthRatio * 1.07]} castShadow receiveShadow>
          <latheGeometry args={[outerPoints, 64, phiStart, phiLength]} />
          <GarmentMaterial item={item} polygonOffset offsetFactor={-2} />
        </mesh>

        <mesh
          position={[0, L.neckBase + 0.012, 0]}
          scale={[1, 1, torsoDepthRatio * 0.98]}
        >
          <cylinderGeometry
            args={[
              R.neckBase * 1.24 * outerScale,
              R.neckBase * 1.18 * outerScale,
              0.032,
              36,
              1,
              true,
              phiStart,
              phiLength,
            ]}
          />
          <GarmentMaterial item={item} polygonOffset offsetFactor={-2} />
        </mesh>

        {SIDES.map(s => (
          <group
            key={`outer-sleeve-${s}`}
            position={[s * (dims.shoulderHalfWidth * 0.95), L.shoulder, 0]}
            rotation={[0, 0, s * dims.armAngleRad]}
          >
            <mesh scale={[1, 1, 0.96]} castShadow receiveShadow>
              <latheGeometry args={[outerSleevePoints, 36]} />
              <GarmentMaterial item={item} polygonOffset offsetFactor={-2} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }

  if (item.category === 'dress') {
    return (
      <group name={`garment-dress-${item.id}`}>
        <mesh scale={[1, 1, torsoDepthRatio * 1.06]} castShadow receiveShadow>
          <latheGeometry args={[dressPoints, 64]} />
          <GarmentMaterial item={item} polygonOffset offsetFactor={-1} />
        </mesh>

        {SIDES.map(s => (
          <group
            key={`dress-sleeve-${s}`}
            position={[s * (dims.shoulderHalfWidth * 0.95), L.shoulder, 0]}
            rotation={[0, 0, s * dims.armAngleRad]}
          >
            <mesh scale={[1, 1, 0.94]} castShadow receiveShadow>
              <latheGeometry args={[dressSleevePoints, 32]} />
              <GarmentMaterial item={item} polygonOffset offsetFactor={-1} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }

  if (item.category === 'bottom') {
    if (isSkirt) {
      return (
        <group name={`garment-skirt-${item.id}`}>
          <mesh scale={[1, 1, torsoDepthRatio * 1.06]} castShadow receiveShadow>
            <latheGeometry args={[skirtPoints, 64]} />
            <GarmentMaterial item={item} />
          </mesh>
        </group>
      )
    }

    return (
      <group name={`garment-bottom-${item.id}`}>
        <mesh scale={[1, 1, torsoDepthRatio * 1.06]} castShadow receiveShadow>
          <latheGeometry args={[pelvisPoints, 56]} />
          <GarmentMaterial item={item} />
        </mesh>

        {SIDES.map(s => (
          <mesh
            key={`pant-leg-${s}`}
            position={[s * dims.hipJointX, 0, 0]}
            scale={[1, 1, 0.96]}
            castShadow
            receiveShadow
          >
            <latheGeometry args={[pantLegPoints, 36]} />
            <GarmentMaterial item={item} />
          </mesh>
        ))}
      </group>
    )
  }

  if (item.category === 'shoes') {
    const isHeels = nameLower.includes('heel')
    return (
      <group name={`garment-shoes-${item.id}`}>
        {SIDES.map(s => (
          <group key={`shoe-${s}`} position={[s * (dims.hipJointX + s * 0.005), 0, 0]}>
            <mesh
              position={[0, L.ankle * 0.50, 0.044]}
              scale={[0.96, 0.62, 2.05]}
              castShadow
              receiveShadow
            >
              <sphereGeometry args={[R.ankle * 1.28, 24, 24]} />
              <GarmentMaterial item={item} />
            </mesh>
            <mesh position={[0, 0.012, 0.044]} scale={[0.92, 1, 1.98]}>
              <cylinderGeometry args={[R.ankle * 1.20, R.ankle * 1.22, 0.022, 24]} />
              <GarmentMaterial item={item} />
            </mesh>
            {isHeels && (
              <mesh position={[0, 0.026, -0.024]}>
                <cylinderGeometry args={[0.014, 0.011, 0.052, 16]} />
                <GarmentMaterial item={item} />
              </mesh>
            )}
          </group>
        ))}
      </group>
    )
  }

  return null
}
