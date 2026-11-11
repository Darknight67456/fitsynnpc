import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/**
 * Real MakeHuman / MPFB2 HM08 Asset Pipeline & Multi-Mesh GLB Compiler
 * =====================================================================
 * Source Repository: https://github.com/makehumancommunity/mpfb2
 * Asset License: Creative Commons Zero (CC0 1.0 Universal - Public Domain)
 *
 * This script downloads (and locally caches in .cache/mpfb2/) the authentic CC0 MakeHuman
 * HM08 base mesh (`base.obj`), rigging weight tables (`weights.game_engine_with_breast.json`,
 * `weights.default.json`), and official `.target.gz` morph target files, then compiles a
 * multi-mesh binary glTF 2.0 (`public/models/fashion-mannequin.glb`) containing:
 *
 *  0. `MannequinBody`       — Watertight continuous studio mannequin with pristine sculpted faceless head
 *  1. `GarmentTopTshirt`    — Short-sleeve T-shirt extracted from official helper-tights topology
 *  2. `GarmentTopBlouse`    — 3/4-sleeve blouse extracted from official helper-tights topology
 *  3. `GarmentTopLong`      — Long-sleeve shirt/sweater extracted from official helper-tights topology
 *  4. `GarmentTopKurung`    — Tunic / Baju Kurung top extracted from helper-tights + helper-skirt
 *  5. `GarmentTrousers`     — Full-length tailored trousers extracted from helper-tights topology
 *  6. `GarmentShorts`       — Above-knee shorts extracted from helper-tights topology
 *  7. `GarmentSkirtMidi`    — Flared midi skirt extracted from official helper-skirt topology
 *  8. `GarmentSkirtMini`    — Knee-length skirt extracted from official helper-skirt topology
 *  9. `GarmentDressMidi`    — Unified one-piece midi dress (upper helper-tights + helper-skirt)
 * 10. `GarmentDressMaxi`    — Unified one-piece evening/maxi dress (upper helper-tights + full helper-skirt)
 * 11. `GarmentOuterJacket`  — Open-front jacket with lapels & long sleeves
 * 12. `GarmentOuterBlazer`  — Open-front tailored hip-length blazer
 * 13. `GarmentOuterCoat`    — Open-front knee-length trench coat
 * 14. `GarmentShoes`        — Alias to GarmentShoesLoafers for backward compatibility
 * 15. `GarmentShoesLoafers` — Classic tailored loafers / Oxfords with grounded sole, stacked heel, structured upper & almond toe box
 * 16. `GarmentShoesHeels`   — Designer platform pumps / high heels with platform, arched shank, elevated heel seat, stiletto post & rubber tap
 * 17. `GarmentShawl`        — Draped continuous silk shawl / stole mantle mesh
 * 18. `GarmentBelt`         — Waist belt extracted from waist ring of helper-tights
 *
 * Every mesh in the GLB embeds the exact same 5 official MakeHuman morph targets:
 *   0: `chest_size`
 *   1: `waist_size`
 *   2: `hip_size`
 *   3: `shoulder_width`
 *   4: `body_mass`
 */

const CACHE_DIR = path.resolve('.cache/mpfb2')
const BASE_RAW_URL =
  'https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/src/mpfb/data/'

const TARGET_FILES = {
  // Baseline feminine mannequin shape
  femaleCaucasian: 'targets/macrodetails/caucasian-female-young.target.gz',
  femaleAsian: 'targets/macrodetails/asian-female-young.target.gz',
  femaleIdeal:
    'targets/macrodetails/proportions/female-young-averagemuscle-averageweight-idealproportions.target.gz',
  femaleCupMax:
    'targets/breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target.gz',
  femaleCupMin:
    'targets/breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target.gz',
  femaleFirmMax:
    'targets/breast/female-young-averagemuscle-averageweight-averagecup-maxfirmness.target.gz',

  // Facial feature reduction targets for faceless studio mannequin head
  noseDepthDecr: 'targets/nose/nose-scale-depth-decr.target.gz',
  noseVertDecr: 'targets/nose/nose-scale-vert-decr.target.gz',
  noseFlareDecr: 'targets/nose/nose-flaring-decr.target.gz',
  mouthDepthDecr: 'targets/mouth/mouth-scale-depth-decr.target.gz',
  mouthLipDecr: 'targets/mouth/mouth-lowerlip-volume-decr.target.gz',
  eyePushOutL: 'targets/eyes/l-eye-push1-out.target.gz',
  eyePushOutR: 'targets/eyes/r-eye-push1-out.target.gz',
  eyeScaleDecrL: 'targets/eyes/l-eye-scale-decr.target.gz',
  eyeScaleDecrR: 'targets/eyes/r-eye-scale-decr.target.gz',

  // 5 Live Parametric Measurement Morph Targets
  bustIncr: 'targets/torso/measure-bust-circ-incr.target.gz',
  bustDecr: 'targets/torso/measure-bust-circ-decr.target.gz',
  underbustIncr: 'targets/torso/measure-underbust-circ-incr.target.gz',
  waistIncr: 'targets/torso/measure-waist-circ-incr.target.gz',
  waistDecr: 'targets/torso/measure-waist-circ-decr.target.gz',
  stomachIncr: 'targets/stomach/stomach-pregnant-incr.target.gz',
  stomachToneDecr: 'targets/stomach/stomach-tone-decr.target.gz',
  hipsIncr: 'targets/torso/measure-hips-circ-incr.target.gz',
  hipsDecr: 'targets/torso/measure-hips-circ-decr.target.gz',
  buttocksIncr: 'targets/buttocks/buttocks-volume-incr.target.gz',
  shoulderIncr: 'targets/torso/measure-shoulder-dist-incr.target.gz',
  shoulderDecr: 'targets/torso/measure-shoulder-dist-decr.target.gz',
  weightMax:
    'targets/macrodetails/universal-female-young-averagemuscle-maxweight.target.gz',
  weightMin:
    'targets/macrodetails/universal-female-young-averagemuscle-minweight.target.gz',
  thighIncr: 'targets/legs/measure-thigh-circ-incr.target.gz',
  calfIncr: 'targets/legs/measure-calf-circ-incr.target.gz',
  upperarmIncr: 'targets/arms/measure-upperarm-circ-incr.target.gz',
}

async function fetchCached(relPath) {
  const localPath = path.join(CACHE_DIR, relPath)
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath)
  }
  const url = BASE_RAW_URL + relPath
  console.log(`Downloading ${url} ...`)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(localPath), { recursive: true })
  fs.writeFileSync(localPath, buf)
  return buf
}

function parseTargetGz(buf, totalVerts) {
  const text = zlib.gunzipSync(buf).toString('utf8')
  const deltas = new Float32Array(totalVerts * 3)
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 4) continue
    const vIdx = parseInt(parts[0], 10)
    if (vIdx >= 0 && vIdx < totalVerts) {
      deltas[vIdx * 3] += parseFloat(parts[1])
      deltas[vIdx * 3 + 1] += parseFloat(parts[2])
      deltas[vIdx * 3 + 2] += parseFloat(parts[3])
    }
  }
  return deltas
}

function addScaledDeltas(dst, src, weight) {
  if (!src) return
  const len = Math.min(dst.length, src.length)
  for (let i = 0; i < len; i++) {
    dst[i] += src[i] * weight
  }
}

function parseBaseObj(objText) {
  const verts = []
  const uvs = []
  const groups = {
    body: [],
    'helper-tights': [],
    'helper-skirt': [],
  }

  let currentGroup = ''
  for (const rawLine of objText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      verts.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])])
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/)
      uvs.push([parseFloat(p[1]), parseFloat(p[2])])
    } else if (line.startsWith('g ')) {
      currentGroup = line.slice(2).trim()
    } else if (line.startsWith('f ') && groups[currentGroup]) {
      const tokens = line.split(/\s+/).slice(1)
      const face = tokens.map(tok => {
        const [vStr, vtStr] = tok.split('/')
        return {
          v: parseInt(vStr, 10) - 1,
          vt: vtStr ? parseInt(vtStr, 10) - 1 : 0,
        }
      })
      groups[currentGroup].push(face)
    }
  }

  return { verts, uvs, groups }
}

// The lower profile separates the jaw from the neck; the crown follows an ellipsoid.
function buildPristineMannequinHead({
  bodyFaces,
  masterPos,
  totalBodyVerts,
}) {
  // 1. Filter body faces strictly below neck seam (face centroid y <= 1.4005m)
  const isBelowNeck = f => {
    let cy = 0
    for (const c of f) cy += masterPos[c.v * 3 + 1]
    return cy / f.length <= 1.4005
  }
  const bodySubFaces = bodyFaces.filter(isBelowNeck)

  // 2. Extract directed boundary half-edges at the neck seam
  const dEdges = new Map()
  for (const f of bodySubFaces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i].v
      const b = f[(i + 1) % f.length].v
      dEdges.set(`${a}_${b}`, (dEdges.get(`${a}_${b}`) || 0) + 1)
    }
  }

  const boundaryHalfEdges = []
  const nextMap = new Map()
  for (const [dKey] of dEdges.entries()) {
    const [a, b] = dKey.split('_').map(Number)
    if (!dEdges.has(`${b}_${a}`)) {
      boundaryHalfEdges.push([a, b])
      nextMap.set(a, b)
    }
  }

  // 3. Trace the continuous, simple 46-vertex closed neck cycle
  const startV = boundaryHalfEdges[0][0]
  const cycle = [startV]
  let cur = nextMap.get(startV)
  while (cur !== startV && cur !== undefined) {
    cycle.push(cur)
    cur = nextMap.get(cur)
  }

  const N = cycle.length
  let cx0 = 0, cy0 = 0, cz0 = 0
  for (const v of cycle) {
    cx0 += masterPos[v * 3]
    cy0 += masterPos[v * 3 + 1]
    cz0 += masterPos[v * 3 + 2]
  }
  cx0 /= N
  cy0 /= N
  cz0 /= N
  // Level the cut boundary before lofting to avoid folded rings at the neck seam.
  for (const vertex of cycle) masterPos[vertex * 3 + 1] = cy0

  const baseAngles = []
  for (let i = 0; i < N; i++) {
    const v = cycle[i]
    const dx = masterPos[v * 3] - cx0
    const dz = masterPos[v * 3 + 2] - cz0
    baseAngles.push(Math.atan2(dz, dx))
  }

  // Loft a continuous neck, jaw, and rounded crown at the canonical 1.65 m height.
  const K = 48
  const newVerts = []
  const ringVertIndices = [cycle] // Ring 0 is the exact neck boundary cycle!
  const headTopY = 1.650
  const totalH = headTopY - cy0

  const profile = [
    [cy0, 0.040, 0.040, 0.040],
    [1.425, 0.034, 0.037, 0.038],
    [1.442, 0.035, 0.051, 0.045],
    [1.463, 0.050, 0.073, 0.061],
    [1.495, 0.064, 0.081, 0.079],
    [1.535, 0.074, 0.082, 0.089],
    [1.550, 0.075, 0.081, 0.090],
  ]

  for (let k = 1; k < K; k++) {
    const t = k / K
    const y = cy0 + totalH * t
    const cz = cz0 - 0.006
    const cx = cx0

    let radii
    if (y >= 1.550) {
      const dome = Math.sqrt(1 - ((y - 1.550) / 0.100) ** 2)
      radii = [0.075 * dome, 0.081 * dome, 0.090 * dome]
    } else {
      const segment = profile.findIndex((point, i) => i > 0 && y <= point[0])
      const start = profile[segment - 1]
      const end = profile[segment]
      const before = profile[Math.max(0, segment - 2)]
      const after = profile[Math.min(profile.length - 1, segment + 1)]
      const span = end[0] - start[0]
      const u = (y - start[0]) / span
      radii = [1, 2, 3].map(axis => {
        const tangentStart = (end[axis] - before[axis]) / (end[0] - before[0])
        const tangentEnd = (after[axis] - start[axis]) / (after[0] - start[0])
        return (2 * u ** 3 - 3 * u ** 2 + 1) * start[axis]
          + (u ** 3 - 2 * u ** 2 + u) * span * tangentStart
          + (-2 * u ** 3 + 3 * u ** 2) * end[axis]
          + (u ** 3 - u ** 2) * span * tangentEnd
      })
    }
    const [rx, rzFront, rzBack] = radii

    const currentRing = []
    for (let i = 0; i < N; i++) {
      const angle = baseAngles[i]
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const rz = sinA >= 0 ? rzFront : rzBack
      const targetX = cx + rx * cosA
      const targetZ = cz + rz * sinA

      // C1 tangent blending at base of head with original neck seam
      const neckBlend = Math.min(1, (y - cy0) / 0.025)
      const blendWithBase = 1 - neckBlend * neckBlend * (3 - 2 * neckBlend)
      const bVert = cycle[i]
      const finalX = targetX * (1 - blendWithBase) + masterPos[bVert * 3] * blendWithBase
      const finalZ = targetZ * (1 - blendWithBase) + masterPos[bVert * 3 + 2] * blendWithBase

      const newIdx = totalBodyVerts + newVerts.length
      newVerts.push([finalX, y, finalZ])
      currentRing.push(newIdx)
    }
    ringVertIndices.push(currentRing)
  }

  // Skull apex vertex at top of head
  const apexIdx = totalBodyVerts + newVerts.length
  newVerts.push([0.0, headTopY, cz0 - 0.005])

  // 5. Construct quad faces between rings and triangle fan at the apex
  const headFaces = []
  for (let k = 0; k < K - 1; k++) {
    const rBot = ringVertIndices[k]
    const rTop = ringVertIndices[k + 1]
    for (let i = 0; i < N; i++) {
      const nextI = (i + 1) % N
      headFaces.push([
        { v: rBot[nextI], vt: 0 },
        { v: rBot[i], vt: 0 },
        { v: rTop[i], vt: 0 },
        { v: rTop[nextI], vt: 0 },
      ])
    }
  }

  const rLast = ringVertIndices[K - 1]
  for (let i = 0; i < N; i++) {
    const nextI = (i + 1) % N
    headFaces.push([
      { v: rLast[nextI], vt: 0 },
      { v: rLast[i], vt: 0 },
      { v: apexIdx, vt: 0 },
    ])
  }

  console.log(`Pristine mannequin head: ${newVerts.length} vertices, ${headFaces.length} faces welded to ${N}-vertex neck cycle`)

  return {
    subFaces: bodySubFaces,
    headFaces,
    newVerts,
    allBodyFaces: [...bodySubFaces, ...headFaces],
    neckCycle: cycle,
    cz0,
  }
}

/**
 * Builds dedicated 3D footwear geometry for:
 *  - 'heels'    -> GarmentShoesHeels (Court pumps with low-cut vamp throat, pointed/almond toe box, sculpted arch & stiletto/tapered heel post)
 *  - 'loafers'  -> GarmentShoesLoafers (Tailored penny loafers / Oxfords with moccasin apron, saddle strap, welt & low stacked heel block)
 *  - 'sneakers' -> GarmentShoesSneakers (Athletic court sneakers with padded collar, high tongue, rounded toe bumper & continuous flat cupsole)
 *
 * Derives all station centerlines, widths, heights, and morph deltas directly from the actual
 * MannequinBody foot vertices in `masterPos` and `masterMorphs` so footwear is 100% aligned
 * with the feet and zero toes or heels ever penetrate closed shoes.
 */
function buildFootwearMesh(type = 'loafers', masterPos, masterMorphs) {
  const isHeel = type === 'heels'
  const isSneaker = type === 'sneakers'
  const meshName = isHeel
    ? 'GarmentShoesHeels'
    : isSneaker
    ? 'GarmentShoesSneakers'
    : 'GarmentShoesLoafers'

  // Collect actual left-foot (x > 0, y <= 0.090) vertices from masterPos (base body vertices 0..13379)
  const footVerts = []
  let footMinZ = Infinity
  let footMaxZ = -Infinity
  for (let i = 0; i < 13380; i++) {
    const x = masterPos[i * 3]
    const y = masterPos[i * 3 + 1]
    const z = masterPos[i * 3 + 2]
    if (x > 0 && y <= 0.090) {
      footVerts.push({ i, x, y, z })
      if (z < footMinZ) footMinZ = z
      if (z > footMaxZ) footMaxZ = z
    }
  }

  // Helper to measure actual foot slice bounds at a given longitudinal coordinate z0
  function measureFootSlice(z0) {
    const zClamped = Math.max(footMinZ + 0.003, Math.min(footMaxZ - 0.003, z0))
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    // For dorsal foot height forward of the ankle column (z > 0.068), exclude high ankle shaft
    const yCap = z0 < 0.068 ? 0.072 : 0.085
    for (const fv of footVerts) {
      if (fv.y <= yCap && Math.abs(fv.z - zClamped) <= 0.011) {
        if (fv.x < minX) minX = fv.x
        if (fv.x > maxX) maxX = fv.x
        if (fv.y < minY) minY = fv.y
        if (fv.y > maxY) maxY = fv.y
      }
    }
    if (minX === Infinity) {
      return { minX: 0.145, maxX: 0.195, minY: 0.002, maxY: 0.035 }
    }
    return { minX, maxX, minY, maxY }
  }

  const posArr = []
  const normArr = []
  const uvArr = []
  const indices = []

  const zStart = footMinZ - (isHeel ? 0.012 : isSneaker ? 0.007 : 0.006)
  const zEnd = footMaxZ + (isHeel ? 0.020 : isSneaker ? 0.013 : 0.014)
  const S = 18
  const M = 24

  // Sides: +1 = Left foot (x > 0), -1 = Right foot (x < 0)
  const SIDES = [1, -1]

  for (const side of SIDES) {
    const vOffset = posArr.length / 3
    const stations = []

    for (let sIdx = 0; sIdx < S; sIdx++) {
      const u = sIdx / (S - 1)
      const z = zStart + u * (zEnd - zStart)
      const slice = measureFootSlice(z)

      const latClearance = isHeel ? 0.0068 : isSneaker ? 0.0082 : 0.0065
      let medX = slice.minX - latClearance
      let latX = slice.maxX + latClearance
      let cx = (medX + latX) * 0.5
      let halfW = (latX - medX) * 0.5

      // Rear heel rounding (z < footMinZ + 0.005)
      if (z < footMinZ + 0.006) {
        const tRear = Math.max(0, (footMinZ + 0.006 - z) / (footMinZ + 0.006 - zStart))
        halfW *= 1.0 - 0.38 * tRear * tRear
      }

      // Toe box taper near and beyond footMaxZ
      if (z > footMaxZ - 0.022) {
        const tToe = Math.max(0, (z - (footMaxZ - 0.022)) / (zEnd - (footMaxZ - 0.022)))
        // Shift toe apex gently toward neutral shoe centerline (0.166)
        cx = cx * (1 - tToe * 0.65) + 0.166 * (tToe * 0.65)
        const taperPower = isHeel ? 1.35 : isSneaker ? 1.85 : 1.55
        const minTipHalfW = isHeel ? 0.008 : isSneaker ? 0.018 : 0.013
        if (z > footMaxZ) {
          const tBeyond = (z - footMaxZ) / (zEnd - footMaxZ)
          halfW = halfW * (1 - Math.pow(tBeyond, taperPower)) + minTipHalfW * Math.pow(tBeyond, taperPower)
        }
      }

      // Dorsal height (topY) and collar/throat profile
      let topY = slice.maxY + (isHeel ? 0.0065 : isSneaker ? 0.0110 : 0.0080)
      if (isHeel) {
        if (z < 0.048) {
          // High-rising sculpted pump heel counter at back, sloping down along ankle quarters
          const tBack = Math.max(0, (0.048 - z) / (0.048 - zStart))
          topY = 0.048 + 0.038 * Math.pow(tBack, 0.85)
        } else if (z < 0.124) {
          // Low-cut court pump vamp throat region
          topY = Math.max(slice.maxY + 0.0055, 0.044)
        } else {
          // Closed pointed toe box completely covering all toes
          const tTip = Math.max(0, (z - 0.124) / (zEnd - 0.124))
          topY = Math.max(slice.maxY + 0.0060, 0.036 * (1 - 0.45 * tTip))
        }
      } else if (isSneaker) {
        if (z < 0.058) {
          // Padded athletic ankle collar
          topY = 0.078 + (z < 0.005 ? 0.006 : 0.0)
        } else if (z < 0.112) {
          // High padded sneaker tongue & lace throat
          const tTongue = (z - 0.058) / (0.112 - 0.058)
          topY = Math.max(slice.maxY + 0.011, 0.082 * (1 - tTongue) + 0.056 * tTongue)
        } else {
          const tTip = Math.max(0, (z - 0.112) / (zEnd - 0.112))
          topY = Math.max(slice.maxY + 0.0095, 0.042 * (1 - 0.35 * tTip))
        }
      } else {
        // Loafers / Oxfords
        if (z < 0.055) {
          // Structured dress-shoe heel counter & sub-malleolus quarter dip
          const isQuarterDip = z > 0.015 && z < 0.050
          topY = isQuarterDip ? 0.060 : 0.072
        } else if (z < 0.122) {
          // Raised moccasin apron tongue & penny strap saddle across instep
          const saddleBump = z >= 0.082 && z <= 0.112 ? 0.0045 : 0.0
          topY = Math.max(slice.maxY + 0.0085, 0.054) + saddleBump
        } else {
          const tTip = Math.max(0, (z - 0.122) / (zEnd - 0.122))
          topY = Math.max(slice.maxY + 0.0070, 0.038 * (1 - 0.38 * tTip))
        }
      }

      stations.push({ z, cx: side * cx, halfW, topY, footMaxY: slice.maxY })
    }

    for (let sIdx = 0; sIdx < S; sIdx++) {
      const st = stations[sIdx]
      const z = st.z

      for (let m = 0; m < M; m++) {
        // phi = 0 is top centerline, phi = PI/2 is lateral/medial side, phi = PI is bottom sole centerline
        const phi = (m / M) * Math.PI * 2
        const sinP = Math.sin(phi)
        const cosP = Math.cos(phi)

        let localHalfW = st.halfW
        let y = 0

        if (cosP >= 0) {
          // Upper portion of shoe cross-section (from mid-wall cosP=0 up to dorsal top cosP=1)
          const midWallY = isSneaker ? 0.022 : 0.016
          let targetTopY = st.topY

          if (isHeel && z >= 0.046 && z <= 0.122) {
            // Classic D'Orsay / court pump low-cut vamp throat opening on top center of instep
            // Side walls (|sinP| > 0.55) stay up at quarter height while top center scoops down cleanly
            const throatT = Math.sin(((z - 0.046) / (0.122 - 0.046)) * Math.PI)
            const centerScoop = Math.pow(cosP, 1.4) * throatT
            const lowThroatY = z < 0.085 ? 0.038 : 0.034
            targetTopY = st.topY * (1 - centerScoop) + lowThroatY * centerScoop
          } else if (!isHeel && z >= -0.005 && z <= 0.058) {
            // Ankle opening scoop for loafers and sneakers so ankle enters cleanly
            const ankleT = Math.sin(((z - -0.005) / (0.058 - -0.005)) * Math.PI)
            const centerScoop = Math.pow(cosP, 1.6) * ankleT * 0.22
            targetTopY = st.topY * (1 - centerScoop)
          }

          y = midWallY + (targetTopY - midWallY) * Math.pow(cosP, 0.88)
        } else {
          // Lower portion of shoe cross-section (from mid-wall cosP=0 down to ground sole cosP=-1)
          const midWallY = isSneaker ? 0.022 : 0.016
          const downT = -cosP // 0 at mid-wall, 1 at bottom center

          if (isHeel) {
            // High-heel pump lower architecture:
            // 1. Rear stiletto/sculpted heel post (z <= 0.018): narrows toward ground y = 0.000
            // 2. Arch shank bridge (0.018 < z < 0.092): side walls curve inward & upward to create a distinct visible high-heel arch cutout in side view while inner sole sheath covers plantar foot
            // 3. Forepart sole (z >= 0.092): crisp platform sole grounded at y = 0.000
            if (z <= 0.018) {
              const postNarrow = 1.0 - 0.52 * Math.pow(downT, 0.75)
              localHalfW *= postNarrow
              y = midWallY * (1 - downT)
            } else if (z < 0.086) {
              const archPhase = Math.sin(((z - 0.018) / (0.086 - 0.018)) * Math.PI)
              // Side profile of arch lifts up to y = 0.024 so side camera sees a dramatic high-heel arch gap!
              const sideArchLift = 0.024 * archPhase * (1 - 0.65 * Math.pow(downT, 3))
              if (downT > 0.45) {
                localHalfW *= 1.0 - 0.18 * archPhase * ((downT - 0.45) / 0.55)
              }
              y = Math.max(0.0005, midWallY * (1 - downT) + sideArchLift * (1 - downT * 0.85))
            } else {
              // Welt flare on forepart sole
              localHalfW += 0.0015 * Math.sin(downT * Math.PI)
              y = midWallY * (1 - downT)
            }
          } else if (isSneaker) {
            // Athletic flat rubber cupsole with +3.5mm flared flat sidewall
            localHalfW += 0.0035 * Math.pow(downT, 0.45)
            y = midWallY * (1 - Math.pow(downT, 0.70))
          } else {
            // Loafers: distinct dress welt + 1.8cm stacked heel block (z <= 0.036) + subtle arch waist step (0.036 < z < 0.088)
            const isArchWaist = z > 0.036 && z < 0.088
            const archStep = isArchWaist ? 0.006 * Math.sin(((z - 0.036) / (0.088 - 0.036)) * Math.PI) : 0.0
            localHalfW += (isArchWaist ? -0.0015 : 0.0022) * Math.pow(downT, 0.5)
            y = Math.max(0.000, midWallY * (1 - downT) + archStep * (1 - downT * 0.85))
          }
        }

        const x = st.cx + sinP * localHalfW
        posArr.push(x, y, z)
        normArr.push(0, 1, 0) // Recomputed accurately by finishSurface(mesh)
        uvArr.push(m / M, sIdx / (S - 1))
      }
    }

    for (let sIdx = 0; sIdx < S - 1; sIdx++) {
      const ringA = vOffset + sIdx * M
      const ringB = vOffset + (sIdx + 1) * M
      for (let m = 0; m < M; m++) {
        const nextM = (m + 1) % M
        const a = ringA + m
        const b = ringA + nextM
        const c = ringB + nextM
        const d = ringB + m
        indices.push(a, c, b, a, d, c)
      }
    }

    // Rear heel cap (watertight closure at sIdx = 0)
    const rearCenterIdx = posArr.length / 3
    const st0 = stations[0]
    posArr.push(st0.cx, st0.topY * 0.45, st0.z - 0.003)
    normArr.push(0, 0, -1)
    uvArr.push(0.5, 0)
    for (let m = 0; m < M; m++) {
      const nextM = (m + 1) % M
      const a = vOffset + m
      const b = vOffset + nextM
      indices.push(rearCenterIdx, a, b)
    }

    // Front toe cap (watertight closure at sIdx = S - 1)
    const frontCenterIdx = posArr.length / 3
    const stEnd = stations[S - 1]
    posArr.push(stEnd.cx, stEnd.topY * 0.42, stEnd.z + (isHeel ? 0.006 : 0.004))
    normArr.push(0, 0, 1)
    uvArr.push(0.5, 1)
    const lastRing = vOffset + (S - 1) * M
    for (let m = 0; m < M; m++) {
      const nextM = (m + 1) % M
      const a = lastRing + m
      const b = lastRing + nextM
      indices.push(frontCenterIdx, b, a)
    }
  }

  const vCount = posArr.length / 3
  const typedMorphs = {
    chest_size: new Float32Array(vCount * 3),
    waist_size: new Float32Array(vCount * 3),
    hip_size: new Float32Array(vCount * 3),
    shoulder_width: new Float32Array(vCount * 3),
    body_mass: new Float32Array(vCount * 3),
  }

  // Synchronize morph deltas directly with nearest MannequinBody foot vertex + radial ease on body_mass
  for (let i = 0; i < vCount; i++) {
    const x = posArr[i * 3]
    const y = posArr[i * 3 + 1]
    const z = posArr[i * 3 + 2]
    const absX = Math.abs(x)
    const signX = x >= 0 ? 1 : -1

    let nearestV = footVerts[0]?.i ?? 0
    let bestDistSq = Infinity
    for (const fv of footVerts) {
      const dSq = (fv.x - absX) ** 2 + (fv.y - y) ** 2 + (fv.z - z) ** 2
      if (dSq < bestDistSq) {
        bestDistSq = dSq
        nearestV = fv.i
      }
    }

    for (const [mName, mArr] of Object.entries(typedMorphs)) {
      const src = masterMorphs[mName]
      mArr[i * 3] = signX * src[nearestV * 3]
      mArr[i * 3 + 1] = src[nearestV * 3 + 1]
      mArr[i * 3 + 2] = src[nearestV * 3 + 2]
    }
    const localCx = signX * 0.171
    const dx = x - localCx
    typedMorphs.body_mass[i * 3] += Math.sign(dx || signX) * 0.0018
    typedMorphs.body_mass[i * 3 + 1] += y > 0.015 ? 0.0012 : 0.0
  }

  return {
    name: meshName,
    positions: new Float32Array(posArr),
    normals: new Float32Array(normArr),
    uvs: new Float32Array(uvArr),
    indices: new Uint32Array(indices),
    morphs: typedMorphs,
  }
}

/**
 * Computes smooth per-vertex normals on the master vertex array using a given list of quad/tri faces.
 */
function computeMasterVertexNormals(positions, facesList, totalVerts) {
  const normals = new Float32Array(totalVerts * 3)
  for (const faces of facesList) {
    for (const f of faces) {
      const i0 = f[0].v * 3
      const i1 = f[1].v * 3
      const i2 = f[2].v * 3
      const ax = positions[i1] - positions[i0]
      const ay = positions[i1 + 1] - positions[i0 + 1]
      const az = positions[i1 + 2] - positions[i0 + 2]
      const bx = positions[i2] - positions[i0]
      const by = positions[i2 + 1] - positions[i0 + 1]
      const bz = positions[i2 + 2] - positions[i0 + 2]
      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx
      for (const corner of f) {
        const vi = corner.v * 3
        normals[vi] += nx
        normals[vi + 1] += ny
        normals[vi + 2] += nz
      }
    }
  }
  for (let v = 0; v < totalVerts; v++) {
    const idx = v * 3
    const len =
      Math.hypot(normals[idx], normals[idx + 1], normals[idx + 2]) || 1
    normals[idx] /= len
    normals[idx + 1] /= len
    normals[idx + 2] /= len
  }

  return normals
}

/**
 * Compiles a subset of faces into an indexed glTF sub-mesh with its own positions,
 * smooth normals, UVs, indices, and 5 morph targets.
 */
function buildSubMesh({
  name,
  faces,
  masterPos: masterPosIn,
  masterNormals,
  masterUvs,
  masterMorphs: masterMorphsIn,
  masterArmWeights,
  normalOffset = 0.0,
  vertexTransform = null,
  boundaryAlign = null,
  clipPlanes = null,
  normalizeGarmentUvs = name !== 'MannequinBody',
  layer = null,
}) {
  // Garment layers carry body-relative shell positions and body-synced morph deltas
  const masterPos = layer ? layer.pos : masterPosIn
  const masterMorphs = layer ? layer.morphs : masterMorphsIn
  let posArr = []
  let uvArr = []
  let indices = []
  let armWeights = []
  let morphArrs = {
    chest_size: [],
    waist_size: [],
    hip_size: [],
    shoulder_width: [],
    body_mass: [],
  }

  const cornerMap = new Map()
  let sourceIndices = []

  function getOrAddVertex(vIdx, vtIdx) {
    // When normalizeGarmentUvs is active, weld by 3D vertex index vIdx so clipping operates on unified 3D topology
    const key = normalizeGarmentUvs ? String(vIdx) : `${vIdx}_${vtIdx}`
    if (cornerMap.has(key)) return cornerMap.get(key)

    const newIdx = posArr.length / 3
    cornerMap.set(key, newIdx)
    sourceIndices.push(vIdx)

    let x = masterPos[vIdx * 3]
    let y = masterPos[vIdx * 3 + 1]
    let z = masterPos[vIdx * 3 + 2]

    const nx = masterNormals[vIdx * 3]
    const ny = masterNormals[vIdx * 3 + 1]
    const nz = masterNormals[vIdx * 3 + 2]

    if (normalOffset !== 0) {
      const origX = x
      x += nx * normalOffset
      y += ny * normalOffset
      z += nz * normalOffset
      // Prevent inward cleft normals near the spine/gluteal midline from pushing vertices across x = 0
      if (Math.abs(origX) < 0.0015) {
        x = 0
      } else if (origX * x < 0 || Math.abs(x) < Math.abs(origX)) {
        x = origX
      }
    }

    if (vertexTransform) {
      const res = vertexTransform(x, y, z, vIdx, nx, ny, nz)
      x = res[0]
      y = res[1]
      z = res[2]
    }

    posArr.push(x, y, z)
    armWeights.push(masterArmWeights?.[vIdx] ?? 0)
    const uv = masterUvs[vtIdx] || [0.5, 0.5]
    uvArr.push(uv[0], 1.0 - uv[1])

    for (const mName of Object.keys(morphArrs)) {
      const mSrc = masterMorphs[mName]
      morphArrs[mName].push(
        mSrc[vIdx * 3],
        mSrc[vIdx * 3 + 1],
        mSrc[vIdx * 3 + 2]
      )
    }

    return newIdx
  }

  for (const face of faces) {
    if (face.length === 4) {
      const a = getOrAddVertex(face[0].v, face[0].vt)
      const b = getOrAddVertex(face[1].v, face[1].vt)
      const c = getOrAddVertex(face[2].v, face[2].vt)
      const d = getOrAddVertex(face[3].v, face[3].vt)
      indices.push(a, b, c, a, c, d)
    } else if (face.length === 3) {
      const a = getOrAddVertex(face[0].v, face[0].vt)
      const b = getOrAddVertex(face[1].v, face[1].vt)
      const c = getOrAddVertex(face[2].v, face[2].vt)
      indices.push(a, b, c)
    }
  }

  // Exact Sutherland-Hodgman iso-contour mesh clipping for clean hemlines, sleeve cuffs & necklines
  if (clipPlanes && clipPlanes.length > 0) {
    for (const plane of clipPlanes) {
      const nVerts = posArr.length / 3
      const d = []
      for (let v = 0; v < nVerts; v++) {
        const x = posArr[v * 3]
        const y = posArr[v * 3 + 1]
        const z = posArr[v * 3 + 2]
        const aw = armWeights[v]
        let val = plane.eval(x, y, z, aw, sourceIndices[v])
        if (Math.abs(val) < (plane.snapEps ?? 0.0028)) {
          val = 0
          if (plane.snap) {
            const snapped = plane.snap(x, y, z, aw)
            posArr[v * 3] = snapped[0]
            posArr[v * 3 + 1] = snapped[1]
            posArr[v * 3 + 2] = snapped[2]
          }
        }
        d.push(val)
      }

      const splitCache = new Map()
      const getSplitVertex = (a, b) => {
        const u = Math.min(a, b)
        const v = Math.max(a, b)
        const key = `${u}_${v}`
        if (splitCache.has(key)) return splitCache.get(key)

        const du = d[u]
        const dv = d[v]
        const t = du / (du - dv)
        const newIdx = posArr.length / 3

        let nx = posArr[u * 3] + t * (posArr[v * 3] - posArr[u * 3])
        let ny = posArr[u * 3 + 1] + t * (posArr[v * 3 + 1] - posArr[u * 3 + 1])
        let nz = posArr[u * 3 + 2] + t * (posArr[v * 3 + 2] - posArr[u * 3 + 2])
        const naw = armWeights[u] + t * (armWeights[v] - armWeights[u])
        if (plane.snap) {
          const snapped = plane.snap(nx, ny, nz, naw)
          nx = snapped[0]
          ny = snapped[1]
          nz = snapped[2]
        }

        posArr.push(nx, ny, nz)
        armWeights.push(naw)
        uvArr.push(
          uvArr[u * 2] + t * (uvArr[v * 2] - uvArr[u * 2]),
          uvArr[u * 2 + 1] + t * (uvArr[v * 2 + 1] - uvArr[u * 2 + 1])
        )
        sourceIndices.push(t < 0.5 ? sourceIndices[u] : sourceIndices[v])
        d.push(0)

        for (const mName of Object.keys(morphArrs)) {
          const mArr = morphArrs[mName]
          mArr.push(
            mArr[u * 3] + t * (mArr[v * 3] - mArr[u * 3]),
            mArr[u * 3 + 1] + t * (mArr[v * 3 + 1] - mArr[u * 3 + 1]),
            mArr[u * 3 + 2] + t * (mArr[v * 3 + 2] - mArr[u * 3 + 2])
          )
        }

        splitCache.set(key, newIdx)
        return newIdx
      }

      const nextIndices = []
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]]
        const d0 = d[tri[0]]
        const d1 = d[tri[1]]
        const d2 = d[tri[2]]

        if (d0 <= 0 && d1 <= 0 && d2 <= 0) continue
        if (d0 >= 0 && d1 >= 0 && d2 >= 0) {
          nextIndices.push(tri[0], tri[1], tri[2])
          continue
        }

        const rawPoly = []
        for (let e = 0; e < 3; e++) {
          const a = tri[e]
          const b = tri[(e + 1) % 3]
          const da = d[a]
          const db = d[b]
          if (da >= 0) rawPoly.push(a)
          if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
            rawPoly.push(getSplitVertex(a, b))
          }
        }

        const poly = []
        for (const idx of rawPoly) {
          if (poly.length === 0 || poly[poly.length - 1] !== idx) {
            poly.push(idx)
          }
        }
        if (poly.length > 1 && poly[poly.length - 1] === poly[0]) {
          poly.pop()
        }

        if (poly.length === 3) {
          nextIndices.push(poly[0], poly[1], poly[2])
        } else if (poly.length === 4) {
          const [p0, p1, p2, p3] = poly
          const diag02 = Math.hypot(
            posArr[p0 * 3] - posArr[p2 * 3],
            posArr[p0 * 3 + 1] - posArr[p2 * 3 + 1],
            posArr[p0 * 3 + 2] - posArr[p2 * 3 + 2]
          )
          const diag13 = Math.hypot(
            posArr[p1 * 3] - posArr[p3 * 3],
            posArr[p1 * 3 + 1] - posArr[p3 * 3 + 1],
            posArr[p1 * 3 + 2] - posArr[p3 * 3 + 2]
          )
          if (diag02 <= diag13) {
            nextIndices.push(p0, p1, p2, p0, p2, p3)
          } else {
            nextIndices.push(p0, p1, p3, p1, p2, p3)
          }
        }
      }
      indices = nextIndices
    }

    // Compact unreferenced vertices after clipping
    const usedMap = new Map()
    const cPos = []
    const cUv = []
    const cArm = []
    const cSrc = []
    const cMorphs = {
      chest_size: [],
      waist_size: [],
      hip_size: [],
      shoulder_width: [],
      body_mass: [],
    }
    const cIndices = []

    for (const oldIdx of indices) {
      let newIdx = usedMap.get(oldIdx)
      if (newIdx === undefined) {
        newIdx = cPos.length / 3
        usedMap.set(oldIdx, newIdx)
        cPos.push(posArr[oldIdx * 3], posArr[oldIdx * 3 + 1], posArr[oldIdx * 3 + 2])
        cUv.push(uvArr[oldIdx * 2], uvArr[oldIdx * 2 + 1])
        cArm.push(armWeights[oldIdx])
        cSrc.push(sourceIndices[oldIdx])
        for (const mName of Object.keys(cMorphs)) {
          cMorphs[mName].push(
            morphArrs[mName][oldIdx * 3],
            morphArrs[mName][oldIdx * 3 + 1],
            morphArrs[mName][oldIdx * 3 + 2]
          )
        }
      }
      cIndices.push(newIdx)
    }

    posArr = cPos
    uvArr = cUv
    armWeights = cArm
    sourceIndices = cSrc
    morphArrs = cMorphs
    indices = cIndices
  }

  // Smooth garment boundaries to eliminate saw-tooth edge artifacts
  if (boundaryAlign) {
    const edgeCount = new Map()
    for (let i = 0; i < indices.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        const a = indices[i + j]
        const b = indices[i + ((j + 1) % 3)]
        const k = a < b ? `${a}_${b}` : `${b}_${a}`
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
      }
    }
    const boundaryVerts = new Set()
    for (const [k, count] of edgeCount.entries()) {
      if (count === 1) {
        const [a, b] = k.split('_').map(Number)
        boundaryVerts.add(a)
        boundaryVerts.add(b)
      }
    }

    for (let vi = 0; vi < posArr.length / 3; vi++) {
      if (!boundaryVerts.has(vi)) continue
      const idx = vi * 3
      const x = posArr[idx]
      const y = posArr[idx + 1]
      const z = posArr[idx + 2]
      const res = boundaryAlign(x, y, z, vi)
      if (res) {
        posArr[idx] = res[0]
        posArr[idx + 1] = res[1]
        posArr[idx + 2] = res[2]
      }
    }
  }

  // Compute isotropic, seam-consistent garment UVs.
  // Skirts use 360-degree cylindrical UVs with center-back seam; sleeve/leg garments use front/back pattern UVs.
  if (normalizeGarmentUvs && posArr.length > 0) {
    let maxY = -Infinity
    for (let i = 1; i < posArr.length; i += 3) {
      if (posArr[i] > maxY) maxY = posArr[i]
    }
    const nVerts = posArr.length / 3
    const isCylindricalSkirt = name.startsWith('GarmentSkirt')

    if (isCylindricalSkirt) {
      for (let v = 0; v < nVerts; v++) {
        const x = posArr[v * 3]
        const y = posArr[v * 3 + 1]
        const z = posArr[v * 3 + 2]
        const theta = Math.atan2(x, z - 0.025)
        const u = 0.5 + theta / (2 * Math.PI)
        const vCoord = (maxY - y) / 0.65
        uvArr[v * 2] = u
        uvArr[v * 2 + 1] = vCoord
      }

      const backCloneCache = new Map()
      const cloneWithShiftedU = (vOrig, uShift) => {
        const key = `${vOrig}_${uShift}`
        if (backCloneCache.has(key)) return backCloneCache.get(key)
        const newIdx = posArr.length / 3
        posArr.push(posArr[vOrig * 3], posArr[vOrig * 3 + 1], posArr[vOrig * 3 + 2])
        uvArr.push(uvArr[vOrig * 2] + uShift, uvArr[vOrig * 2 + 1])
        armWeights.push(armWeights[vOrig])
        sourceIndices.push(sourceIndices[vOrig])
        for (const mName of Object.keys(morphArrs)) {
          morphArrs[mName].push(
            morphArrs[mName][vOrig * 3],
            morphArrs[mName][vOrig * 3 + 1],
            morphArrs[mName][vOrig * 3 + 2]
          )
        }
        backCloneCache.set(key, newIdx)
        return newIdx
      }

      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i]
        const i1 = indices[i + 1]
        const i2 = indices[i + 2]
        const u0 = uvArr[i0 * 2]
        const u1 = uvArr[i1 * 2]
        const u2 = uvArr[i2 * 2]
        const maxDu = Math.max(Math.abs(u0 - u1), Math.abs(u1 - u2), Math.abs(u2 - u0))
        if (maxDu > 0.5) {
          const cx = (posArr[i0 * 3] + posArr[i1 * 3] + posArr[i2 * 3]) / 3
          for (let k = 0; k < 3; k++) {
            const vi = indices[i + k]
            const uVal = uvArr[vi * 2]
            if (cx >= 0 && uVal < 0.25) {
              indices[i + k] = cloneWithShiftedU(vi, +1.0)
            } else if (cx < 0 && uVal > 0.75) {
              indices[i + k] = cloneWithShiftedU(vi, -1.0)
            }
          }
        }
      }
    } else {
      // Front/back curvi-planar pattern unwrapping for tops, dresses, outerwear & trousers
      const computeFrontUv = (x, y, z) => {
        const zMid = 0.018 - 0.10 * Math.max(0, Math.abs(x) - 0.14)
        const dz = Math.abs(z - zMid)
        const sideWrap = Math.sign(x || 1) * Math.max(0, 0.075 - Math.min(0.075, dz)) * 0.42
        const u = 0.5 + (x + sideWrap) / 0.62
        const vCoord = (maxY - y) / 0.62
        return [u, vCoord]
      }
      const computeBackUv = (x, y, z) => {
        const zMid = 0.018 - 0.10 * Math.max(0, Math.abs(x) - 0.14)
        const dz = Math.abs(z - zMid)
        const sideWrap = Math.sign(x || 1) * Math.max(0, 0.075 - Math.min(0.075, dz)) * 0.42
        const u = 0.5 - (x + sideWrap) / 0.62
        const vCoord = (maxY - y) / 0.62
        return [u, vCoord]
      }

      for (let v = 0; v < nVerts; v++) {
        const [u, vCoord] = computeFrontUv(posArr[v * 3], posArr[v * 3 + 1], posArr[v * 3 + 2])
        uvArr[v * 2] = u
        uvArr[v * 2 + 1] = vCoord
      }

      const backPanelCache = new Map()
      const getBackPanelVert = vOrig => {
        if (backPanelCache.has(vOrig)) return backPanelCache.get(vOrig)
        const newIdx = posArr.length / 3
        const x = posArr[vOrig * 3]
        const y = posArr[vOrig * 3 + 1]
        const z = posArr[vOrig * 3 + 2]
        posArr.push(x, y, z)
        const [bu, bv] = computeBackUv(x, y, z)
        uvArr.push(bu, bv)
        armWeights.push(armWeights[vOrig])
        sourceIndices.push(sourceIndices[vOrig])
        for (const mName of Object.keys(morphArrs)) {
          morphArrs[mName].push(
            morphArrs[mName][vOrig * 3],
            morphArrs[mName][vOrig * 3 + 1],
            morphArrs[mName][vOrig * 3 + 2]
          )
        }
        backPanelCache.set(vOrig, newIdx)
        return newIdx
      }

      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i]
        const i1 = indices[i + 1]
        const i2 = indices[i + 2]
        const cx = (posArr[i0 * 3] + posArr[i1 * 3] + posArr[i2 * 3]) / 3
        const cz = (posArr[i0 * 3 + 2] + posArr[i1 * 3 + 2] + posArr[i2 * 3 + 2]) / 3
        const zMid = 0.018 - 0.10 * Math.max(0, Math.abs(cx) - 0.14)
        if (cz < zMid) {
          indices[i] = getBackPanelVert(i0)
          indices[i + 1] = getBackPanelVert(i1)
          indices[i + 2] = getBackPanelVert(i2)
        }
      }
    }
  }

  // Recompute clean smooth vertex normals for this sub-mesh
  const vCount = posArr.length / 3
  const normals = new Float32Array(posArr.length)
  // Accumulate by original master vIdx so UV seams have zero normal discontinuities!
  const masterNormalAccum = new Map()

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    const ax = posArr[ib] - posArr[ia]
    const ay = posArr[ib + 1] - posArr[ia + 1]
    const az = posArr[ib + 2] - posArr[ia + 2]
    const bx = posArr[ic] - posArr[ia]
    const by = posArr[ic + 1] - posArr[ia + 1]
    const bz = posArr[ic + 2] - posArr[ia + 2]
    const fnx = ay * bz - az * by
    const fny = az * bx - ax * bz
    const fnz = ax * by - ay * bx
    normals[ia] += fnx
    normals[ia + 1] += fny
    normals[ia + 2] += fnz
    normals[ib] += fnx
    normals[ib + 1] += fny
    normals[ib + 2] += fnz
    normals[ic] += fnx
    normals[ic + 1] += fny
    normals[ic + 2] += fnz
  }

  // Weld normals across identical 3D positions (UV seams)
  for (let v = 0; v < vCount; v++) {
    const px = Math.round(posArr[v * 3] * 10000)
    const py = Math.round(posArr[v * 3 + 1] * 10000)
    const pz = Math.round(posArr[v * 3 + 2] * 10000)
    const pKey = `${px}_${py}_${pz}`
    const cur = masterNormalAccum.get(pKey) || [0, 0, 0]
    cur[0] += normals[v * 3]
    cur[1] += normals[v * 3 + 1]
    cur[2] += normals[v * 3 + 2]
    masterNormalAccum.set(pKey, cur)
  }

  for (let v = 0; v < vCount; v++) {
    const px = Math.round(posArr[v * 3] * 10000)
    const py = Math.round(posArr[v * 3 + 1] * 10000)
    const pz = Math.round(posArr[v * 3 + 2] * 10000)
    const pKey = `${px}_${py}_${pz}`
    const [nx, ny, nz] = masterNormalAccum.get(pKey)
    const len = Math.hypot(nx, ny, nz) || 1
    normals[v * 3] = nx / len
    normals[v * 3 + 1] = ny / len
    normals[v * 3 + 2] = nz / len
  }



  const typedMorphs = {}
  for (const mName of Object.keys(morphArrs)) {
    typedMorphs[mName] = new Float32Array(morphArrs[mName])
  }

  return {
    name,
    positions: new Float32Array(posArr),
    normals,
    uvs: new Float32Array(uvArr),
    indices: new Uint32Array(indices),
    morphs: typedMorphs,
    armWeights: new Float32Array(armWeights),
  }
}

// Subdivide the uniformly coloured body across welded UV seams. Apply the same
// linear stencils to every morph delta and pose weight so measurements stay coherent.
function subdivideBody(mesh) {
  const vertexMap = new Map()
  const remap = []
  const fields = { positions: [], armWeights: [], ...Object.fromEntries(
    Object.keys(mesh.morphs).map(name => [name, []])
  ) }
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const key = Array.from(mesh.positions.slice(i * 3, i * 3 + 3), n => n.toFixed(7)).join(',')
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertexMap.size)
      fields.positions.push(...mesh.positions.slice(i * 3, i * 3 + 3))
      fields.armWeights.push(mesh.armWeights[i])
      for (const name of Object.keys(mesh.morphs)) {
        fields[name].push(...mesh.morphs[name].slice(i * 3, i * 3 + 3))
      }
    }
    remap.push(vertexMap.get(key))
  }
  const triangles = Array.from(mesh.indices, index => remap[index])
  const count = vertexMap.size
  const neighbours = Array.from({ length: count }, () => new Set())
  const boundary = Array.from({ length: count }, () => [])
  const edges = new Map()
  const edgeKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`
  for (let i = 0; i < triangles.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = triangles[i + j]
      const b = triangles[i + (j + 1) % 3]
      const opposite = triangles[i + (j + 2) % 3]
      neighbours[a].add(b)
      neighbours[b].add(a)
      const key = edgeKey(a, b)
      if (!edges.has(key)) edges.set(key, { a, b, opposite: [], index: count + edges.size })
      edges.get(key).opposite.push(opposite)
    }
  }
  for (const edge of edges.values()) {
    if (edge.opposite.length === 1) {
      boundary[edge.a].push(edge.b)
      boundary[edge.b].push(edge.a)
    }
  }
  const refined = {}
  for (const [name, values] of Object.entries(fields)) {
    const size = name === 'armWeights' ? 1 : 3
    const output = new Float32Array((count + edges.size) * size)
    for (let i = 0; i < count; i++) {
      const ring = boundary[i].length === 2 ? boundary[i] : [...neighbours[i]]
      const beta = boundary[i].length === 2 ? 1 / 8 : ring.length === 3 ? 3 / 16 : 3 / (8 * ring.length)
      for (let axis = 0; axis < size; axis++) {
        let value = values[i * size + axis] * (1 - ring.length * beta)
        for (const neighbour of ring) value += values[neighbour * size + axis] * beta
        output[i * size + axis] = value
      }
    }
    for (const edge of edges.values()) {
      for (let axis = 0; axis < size; axis++) {
        const sum = values[edge.a * size + axis] + values[edge.b * size + axis]
        output[edge.index * size + axis] = edge.opposite.length === 2
          ? 3 / 8 * sum + 1 / 8 * (values[edge.opposite[0] * size + axis] + values[edge.opposite[1] * size + axis])
          : sum / 2
      }
    }
    refined[name] = output
  }
  const indices = []
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.slice(i, i + 3)
    const ab = edges.get(edgeKey(a, b)).index
    const bc = edges.get(edgeKey(b, c)).index
    const ca = edges.get(edgeKey(c, a)).index
    indices.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
  }
  mesh.positions = refined.positions
  mesh.armWeights = refined.armWeights
  mesh.indices = new Uint32Array(indices)
  mesh.uvs = new Float32Array(mesh.positions.length / 3 * 2)
  for (const name of Object.keys(mesh.morphs)) mesh.morphs[name] = refined[name]
}

function computeSurfaceNormals(positions, indices) {
  const faces = []
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([{ v: indices[i] }, { v: indices[i + 1] }, { v: indices[i + 2] }])
  }
  const normals = computeMasterVertexNormals(positions, [faces], positions.length / 3)
  const seams = new Map()
  for (let i = 0; i < positions.length; i += 3) {
    const key = Array.from(positions.slice(i, i + 3), n => n.toFixed(7)).join(',')
    if (!seams.has(key)) seams.set(key, [])
    seams.get(key).push(i)
  }
  for (const offsets of seams.values()) {
    const sum = [0, 0, 0]
    for (const offset of offsets) {
      for (let axis = 0; axis < 3; axis++) sum[axis] += normals[offset + axis]
    }
    const length = Math.hypot(...sum) || 1
    for (const offset of offsets) {
      for (let axis = 0; axis < 3; axis++) normals[offset + axis] = sum[axis] / length
    }
  }
  return normals
}

function finishSurface(mesh) {
  const source = mesh.positions.slice()
  const pose = (positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      const weight = Math.min(1, mesh.armWeights?.[i / 3] ?? 0)
      const side = Math.sign(source[i])
      const angle = -side * 0.40
      const x = positions[i] - side * 0.17
      const y = positions[i + 1] - 1.34
      positions[i] += weight * (Math.cos(angle) * x - Math.sin(angle) * y - x)
      positions[i + 1] += weight * (Math.sin(angle) * x + Math.cos(angle) * y - y)
    }
  }
  pose(mesh.positions)
  mesh.normals = computeSurfaceNormals(mesh.positions, mesh.indices)
  mesh.morphNormals = {}
  for (const [name, delta] of Object.entries(mesh.morphs)) {
    const target = Float32Array.from(source, (value, i) => value + delta[i])
    pose(target)
    const normals = computeSurfaceNormals(target, mesh.indices)
    mesh.morphs[name] = Float32Array.from(target, (value, i) => value - mesh.positions[i])
    mesh.morphNormals[name] = Float32Array.from(normals, (value, i) => value - mesh.normals[i])
  }
}

/**
 * Generates an authentic continuous draped silk shawl / stole mantle mesh.
 * Loops around the back of the neck, drapes over both shoulders, and hangs down the front.
 * Uses a continuous parametric ribbon grid (40 x 6 quads, 1 island, 0 interior holes).
 * Synchronized with the 5 MakeHuman morph targets for 1:1 body scaling.
 */
function buildDrapedShawlMesh() {
  // Key spline guide points along the centerline of the shawl drape
  // Coordinates are in metric space, layer L5 (+22..+28mm outside body/outerwear)
  const guidePoints = [
    // Right front tail
    { x: 0.075, y: 1.155, z: 0.142, w: 0.090 },
    // Right lower chest
    { x: 0.090, y: 1.230, z: 0.138, w: 0.110 },
    // Right clavicle / chest
    { x: 0.118, y: 1.310, z: 0.115, w: 0.125 },
    // Right shoulder crest
    { x: 0.175, y: 1.378, z: 0.015, w: 0.135 },
    // Right back neck / shoulder
    { x: 0.110, y: 1.405, z: -0.075, w: 0.110 },
    // Center back neck
    { x: 0.000, y: 1.415, z: -0.092, w: 0.095 },
    // Left back neck / shoulder
    { x: -0.110, y: 1.405, z: -0.075, w: 0.110 },
    // Left shoulder crest
    { x: -0.175, y: 1.378, z: 0.015, w: 0.135 },
    // Left clavicle / chest
    { x: -0.118, y: 1.310, z: 0.115, w: 0.125 },
    // Left lower chest
    { x: -0.090, y: 1.230, z: 0.138, w: 0.110 },
    // Left front tail
    { x: -0.075, y: 1.155, z: 0.142, w: 0.090 },
  ]

  // Catmull-Rom spline interpolation for smooth 3D curve
  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )
  }

  function getSplinePoint(t) {
    const n = guidePoints.length - 1
    const scaledT = t * n
    const idx = Math.min(Math.floor(scaledT), n - 1)
    const localT = scaledT - idx
    const p0 = guidePoints[Math.max(0, idx - 1)]
    const p1 = guidePoints[idx]
    const p2 = guidePoints[Math.min(n, idx + 1)]
    const p3 = guidePoints[Math.min(n, idx + 2)]

    return {
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, localT),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, localT),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, localT),
      w: catmullRom(p0.w, p1.w, p2.w, p3.w, localT),
    }
  }

  const uSteps = 40
  const vSteps = 6
  const posArr = []
  const uvArr = []
  const indices = []

  const morphArrs = {
    chest_size: [],
    waist_size: [],
    hip_size: [],
    shoulder_width: [],
    body_mass: [],
  }

  for (let ui = 0; ui <= uSteps; ui++) {
    const u = ui / uSteps
    const pt = getSplinePoint(u)
    const ptAhead = getSplinePoint(Math.min(1.0, u + 0.01))
    const ptBehind = getSplinePoint(Math.max(0.0, u - 0.01))

    // Tangent vector
    const tx = ptAhead.x - ptBehind.x
    const ty = ptAhead.y - ptBehind.y
    const tz = ptAhead.z - ptBehind.z
    const tLen = Math.hypot(tx, ty, tz) || 1
    const tanX = tx / tLen, tanY = ty / tLen, tanZ = tz / tLen

    // Approximate body outward surface normal at (pt.x, pt.y, pt.z)
    let nx = pt.x
    let ny = 0.25 * (pt.y - 1.35)
    let nz = pt.z - 0.02
    const nLen = Math.hypot(nx, ny, nz) || 1
    nx /= nLen
    ny /= nLen
    nz /= nLen

    // Binormal = cross(tangent, normal)
    let bx = tanY * nz - tanZ * ny
    let by = tanZ * nx - tanX * nz
    let bz = tanX * ny - tanY * nx
    const bLen = Math.hypot(bx, by, bz) || 1
    bx /= bLen
    by /= bLen
    bz /= bLen

    for (let vi = 0; vi <= vSteps; vi++) {
      const vNorm = vi / vSteps - 0.5 // -0.5 .. +0.5 across width
      const widthOffset = vNorm * pt.w
      // Subtle convex camber arch across the ribbon for fabric body
      const camber = (1.0 - 4.0 * vNorm * vNorm) * 0.006

      const x = pt.x + bx * widthOffset + nx * camber
      const y = pt.y + by * widthOffset + ny * camber
      const z = pt.z + bz * widthOffset + nz * camber

      posArr.push(x, y, z)
      uvArr.push(u, vi / vSteps)

      // Morph deltas synchronized with anatomical regions
      const absX = Math.abs(x)
      const signX = x >= 0 ? 1 : -1
      const shFactor = Math.min(1.0, Math.max(0.0, absX / 0.18))
      morphArrs.shoulder_width.push(signX * 0.024 * shFactor, 0, 0)

      const chestFactor = z > 0.06 ? Math.min(1.0, (z - 0.06) / 0.08) : 0
      morphArrs.chest_size.push(0, 0, 0.022 * chestFactor)

      morphArrs.waist_size.push(0, 0, 0)
      morphArrs.hip_size.push(0, 0, 0)

      morphArrs.body_mass.push(x * 0.022, 0, z * 0.018)
    }
  }

  // Create indexed quad triangles
  const rowStride = vSteps + 1
  for (let ui = 0; ui < uSteps; ui++) {
    for (let vi = 0; vi < vSteps; vi++) {
      const p00 = ui * rowStride + vi
      const p01 = p00 + 1
      const p10 = (ui + 1) * rowStride + vi
      const p11 = p10 + 1
      indices.push(p00, p01, p11, p00, p11, p10)
    }
  }

  // Compute smooth surface normals
  const vCount = posArr.length / 3
  const normals = new Float32Array(posArr.length)
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    const ax = posArr[ib] - posArr[ia]
    const ay = posArr[ib + 1] - posArr[ia + 1]
    const az = posArr[ib + 2] - posArr[ia + 2]
    const bx = posArr[ic] - posArr[ia]
    const by = posArr[ic + 1] - posArr[ia + 1]
    const bz = posArr[ic + 2] - posArr[ia + 2]
    const fnx = ay * bz - az * by
    const fny = az * bx - ax * bz
    const fnz = ax * by - ay * bx
    normals[ia] += fnx
    normals[ia + 1] += fny
    normals[ia + 2] += fnz
    normals[ib] += fnx
    normals[ib + 1] += fny
    normals[ib + 2] += fnz
    normals[ic] += fnx
    normals[ic + 1] += fny
    normals[ic + 2] += fnz
  }
  for (let v = 0; v < vCount; v++) {
    const idx = v * 3
    const len = Math.hypot(normals[idx], normals[idx + 1], normals[idx + 2]) || 1
    normals[idx] /= len
    normals[idx + 1] /= len
    normals[idx + 2] /= len
  }

  const typedMorphs = {}
  for (const mName of Object.keys(morphArrs)) {
    typedMorphs[mName] = new Float32Array(morphArrs[mName])
  }

  return {
    name: 'GarmentShawl',
    positions: new Float32Array(posArr),
    normals,
    uvs: new Float32Array(uvArr),
    indices: new Uint32Array(indices),
    morphs: typedMorphs,
  }
}

function computeMinMaxVec3(arr) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < arr.length; i += 3) {
    if (arr[i] < min[0]) min[0] = arr[i]
    if (arr[i + 1] < min[1]) min[1] = arr[i + 1]
    if (arr[i + 2] < min[2]) min[2] = arr[i + 2]
    if (arr[i] > max[0]) max[0] = arr[i]
    if (arr[i + 1] > max[1]) max[1] = arr[i + 1]
    if (arr[i + 2] > max[2]) max[2] = arr[i + 2]
  }
  return { min, max }
}

async function main() {
  console.log('--- Fetching CC0 MakeHuman HM08 Base Mesh & Official Targets ---')
  const baseObjBuf = await fetchCached('3dobjs/base.obj')
  const gameWeightsBuf = await fetchCached(
    'rigs/standard/weights.game_engine_with_breast.json'
  )
  const defaultWeightsBuf = await fetchCached(
    'rigs/standard/weights.default.json'
  )

  const targetBufs = {}
  for (const [key, relPath] of Object.entries(TARGET_FILES)) {
    targetBufs[key] = await fetchCached(relPath)
  }

  const { verts, uvs, groups } = parseBaseObj(baseObjBuf.toString('utf8'))
  const gameWeights = JSON.parse(gameWeightsBuf.toString('utf8'))
  const defaultWeights = JSON.parse(defaultWeightsBuf.toString('utf8'))

  let totalVerts = verts.length
  console.log(
    `Parsed HM08 base.obj: ${totalVerts} total vertices (${groups.body.length} body quads, ${groups['helper-tights'].length} helper-tights quads, ${groups['helper-skirt'].length} helper-skirt quads)`
  )

  // Parse all target delta buffers
  const targets = {}
  for (const [key, buf] of Object.entries(targetBufs)) {
    targets[key] = parseTargetGz(buf, totalVerts)
  }

  // 1. Build Master Baseline Positions (in MakeHuman decimeter space first)
  const rawPos = new Float32Array(totalVerts * 3)
  for (let i = 0; i < totalVerts; i++) {
    rawPos[i * 3] = verts[i][0]
    rawPos[i * 3 + 1] = verts[i][1]
    rawPos[i * 3 + 2] = verts[i][2]
  }

  // Bake feminine studio mannequin baseline (blend Caucasian + Asian female young + ideal proportions + firm bust)
  addScaledDeltas(rawPos, targets.femaleCaucasian, 0.55)
  addScaledDeltas(rawPos, targets.femaleAsian, 0.45)
  addScaledDeltas(rawPos, targets.femaleIdeal, 0.65)
  addScaledDeltas(rawPos, targets.femaleFirmMax, 0.45)

  // Bake facial feature reduction targets to flatten nose/lips/eye sockets before Laplacian smoothing
  addScaledDeltas(rawPos, targets.noseDepthDecr, 0.95)
  addScaledDeltas(rawPos, targets.noseVertDecr, 0.65)
  addScaledDeltas(rawPos, targets.noseFlareDecr, 0.85)
  addScaledDeltas(rawPos, targets.mouthDepthDecr, 0.90)
  addScaledDeltas(rawPos, targets.mouthLipDecr, 0.90)
  addScaledDeltas(rawPos, targets.eyePushOutL, 0.65)
  addScaledDeltas(rawPos, targets.eyePushOutR, 0.65)
  addScaledDeltas(rawPos, targets.eyeScaleDecrL, 0.85)
  addScaledDeltas(rawPos, targets.eyeScaleDecrR, 0.85)

  // Convert to canonical FitSync metric coordinates (feet grounded at y = 0, total height = 1.65 m)
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < 13380; i++) {
    const y = rawPos[i * 3 + 1]
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const metricScale = 1.65 / (maxY - minY)

  let masterPos = new Float32Array(totalVerts * 3)
  for (let i = 0; i < totalVerts; i++) {
    masterPos[i * 3] = rawPos[i * 3] * metricScale
    masterPos[i * 3 + 1] = (rawPos[i * 3 + 1] - minY) * metricScale
    masterPos[i * 3 + 2] = rawPos[i * 3 + 2] * metricScale
  }

  // 2. Build Pristine Mannequin Head (sculpted, faceless, welded seamlessly to neck seam)
  const headResult = buildPristineMannequinHead({
    bodyFaces: groups.body,
    masterPos,
    totalBodyVerts: totalVerts,
  })

  // Expand master vertex arrays with new pristine head sculpture vertices
  const baseVertsCount = totalVerts
  const expandedTotalVerts = baseVertsCount + headResult.newVerts.length
  const expandedMasterPos = new Float32Array(expandedTotalVerts * 3)
  expandedMasterPos.set(masterPos)
  for (let i = 0; i < headResult.newVerts.length; i++) {
    const vIdx = baseVertsCount + i
    expandedMasterPos[vIdx * 3] = headResult.newVerts[i][0]
    expandedMasterPos[vIdx * 3 + 1] = headResult.newVerts[i][1]
    expandedMasterPos[vIdx * 3 + 2] = headResult.newVerts[i][2]
    // UV projection for head vertices
    const dx = headResult.newVerts[i][0]
    const dz = headResult.newVerts[i][2] - headResult.cz0
    const u = 0.5 + Math.atan2(dx, dz) / (2 * Math.PI)
    const v = (headResult.newVerts[i][1] - 1.40) / 0.25
    uvs.push([u, v])
  }

  // 3. Build the 5 Official Morph Target Delta Arrays (scaled to meters)
  const masterMorphs = {
    chest_size: new Float32Array(expandedTotalVerts * 3),
    waist_size: new Float32Array(expandedTotalVerts * 3),
    hip_size: new Float32Array(expandedTotalVerts * 3),
    shoulder_width: new Float32Array(expandedTotalVerts * 3),
    body_mass: new Float32Array(expandedTotalVerts * 3),
  }

  // chest_size: combines official measure-bust-circ-incr + measure-underbust-circ-incr + femaleCupMax
  addScaledDeltas(masterMorphs.chest_size, targets.bustIncr, metricScale * 1.45)
  addScaledDeltas(
    masterMorphs.chest_size,
    targets.underbustIncr,
    metricScale * 0.55
  )
  addScaledDeltas(
    masterMorphs.chest_size,
    targets.femaleCupMax,
    metricScale * 0.55
  )

  // waist_size: combines official measure-waist-circ-incr + stomach-pregnant-incr
  addScaledDeltas(
    masterMorphs.waist_size,
    targets.waistIncr,
    metricScale * 1.55
  )
  addScaledDeltas(
    masterMorphs.waist_size,
    targets.stomachIncr,
    metricScale * 0.35
  )

  // hip_size: combines official measure-hips-circ-incr + buttocks-volume-incr
  addScaledDeltas(masterMorphs.hip_size, targets.hipsIncr, metricScale * 1.55)
  addScaledDeltas(
    masterMorphs.hip_size,
    targets.buttocksIncr,
    metricScale * 0.70
  )

  // shoulder_width: official measure-shoulder-dist-incr
  addScaledDeltas(
    masterMorphs.shoulder_width,
    targets.shoulderIncr,
    metricScale * 1.65
  )

  // body_mass: combines official maxweight - minweight + thigh/calf/upperarm circumference
  addScaledDeltas(masterMorphs.body_mass, targets.weightMax, metricScale * 0.55)
  addScaledDeltas(
    masterMorphs.body_mass,
    targets.weightMin,
    -metricScale * 0.35
  )
  addScaledDeltas(masterMorphs.body_mass, targets.thighIncr, metricScale * 0.50)
  addScaledDeltas(masterMorphs.body_mass, targets.calfIncr, metricScale * 0.45)
  addScaledDeltas(
    masterMorphs.body_mass,
    targets.upperarmIncr,
    metricScale * 0.50
  )

  // Carry neck deformation into the new head rings to keep the welded transition smooth.
  for (let i = 0; i < headResult.newVerts.length - 1; i++) {
    const vertex = baseVertsCount + i
    const neckVertex = headResult.neckCycle[i % headResult.neckCycle.length]
    const blend = Math.max(0, 1 - (expandedMasterPos[vertex * 3 + 1] - 1.40) / 0.06)
    for (const delta of Object.values(masterMorphs)) {
      for (let axis = 0; axis < 3; axis++) delta[vertex * 3 + axis] = delta[neckVertex * 3 + axis] * blend
    }
  }

  // Compute master normals across the body and garment helpers.
  const masterNormals = computeMasterVertexNormals(
    expandedMasterPos,
    [headResult.allBodyFaces, groups['helper-tights'], groups['helper-skirt']],
    expandedTotalVerts
  )

  // Use expanded positions & count
  masterPos = expandedMasterPos
  totalVerts = expandedTotalVerts

  // 4. Build Bone Weight Lookup Maps for Clean Anatomical Garment Partitioning
  const wGame = gameWeights.weights || {}
  const getWeightMap = boneNames => {
    const map = new Float32Array(totalVerts)
    for (const b of boneNames) {
      for (const [idx, w] of wGame[b] || []) {
        if (idx < totalVerts) map[idx] += w
      }
    }
    return map
  }

  const armWeights = getWeightMap([
    'upperarm_l',
    'upperarm_r',
    'lowerarm_l',
    'lowerarm_r',
    'hand_l',
    'hand_r',
    ...Object.keys(wGame).filter(name => /^(thumb|index|middle|ring|pinky)_/.test(name)),
  ])
  const lowerArmWeights = getWeightMap([
    'lowerarm_l',
    'lowerarm_r',
    'hand_l',
    'hand_r',
    ...Object.keys(wGame).filter(name => /^(thumb|index|middle|ring|pinky)_/.test(name)),
  ])
  const legWeights = getWeightMap([
    'thigh_l',
    'thigh_r',
    'calf_l',
    'calf_r',
    'foot_l',
    'foot_r',
    'ball_l',
    'ball_r',
  ])
  const footWeights = getWeightMap([
    'foot_l',
    'foot_r',
    'ball_l',
    'ball_r',
  ])
  const neckClavWeights = getWeightMap([
    'neck_01',
    'clavicle_l',
    'clavicle_r',
    'spine_03',
  ])

  // Helper to filter faces by a vertex predicate (keeps face if >= 3 corners match)
  const filterFaces = (faces, pred) =>
    faces.filter(f => f.filter(c => pred(c.v)).length >= 3)

  // Compute topological ring index (0..19) on helper-skirt from top waist (0) to ankle hem (19)
  const skirtAdj = new Map()
  for (let i = 18002; i <= 18721; i++) skirtAdj.set(i, new Set())
  const skirtEdgeCount = new Map()
  for (const f of groups['helper-skirt']) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i].v
      const b = f[(i + 1) % f.length].v
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      skirtEdgeCount.set(k, (skirtEdgeCount.get(k) || 0) + 1)
      skirtAdj.get(a)?.add(b)
      skirtAdj.get(b)?.add(a)
    }
  }
  const skirtTopSeeds = []
  for (const [k, c] of skirtEdgeCount.entries()) {
    if (c === 1) {
      const [a, b] = k.split('_').map(Number)
      if (masterPos[a * 3 + 1] > 0.5 && !skirtTopSeeds.includes(a))
        skirtTopSeeds.push(a)
      if (masterPos[b * 3 + 1] > 0.5 && !skirtTopSeeds.includes(b))
        skirtTopSeeds.push(b)
    }
  }
  const skirtRingDist = new Map()
  const bfsQ = [...skirtTopSeeds]
  skirtTopSeeds.forEach(v => skirtRingDist.set(v, 0))
  while (bfsQ.length) {
    const u = bfsQ.shift()
    for (const v of skirtAdj.get(u) || []) {
      if (!skirtRingDist.has(v)) {
        skirtRingDist.set(v, skirtRingDist.get(u) + 1)
        bfsQ.push(v)
      }
    }
  }

  // --- EXTRACT AUTHENTIC TOPOLOGY-MATCHED GARMENT SUB-MESHES ---

  // Upper bodice candidate predicate (includes a 6.5cm margin past the hem & cuff so clipPlanes slices every straddling quad cleanly)
  const armAxisDist = (x, y, z) =>
    (Math.abs(x) - 0.17) * 0.652 + (1.34 - y) * 0.658 + z * 0.377

  const isUpperGarmentCandidate = (vIdx, maxArmDist, minTorsoY = 0.82) => {
    const x = Math.abs(masterPos[vIdx * 3])
    const y = masterPos[vIdx * 3 + 1]
    const z = masterPos[vIdx * 3 + 2]
    const isArm = armWeights[vIdx] > 0.25
    const isLeg = legWeights[vIdx] > 0.55

    if (isLeg && y < minTorsoY) return false
    if (isArm) {
      return armAxisDist(x, y, z) <= maxArmDist + 0.075
    }
    return y >= minTorsoY && y <= 1.425
  }

  const makeUpperClipPlanes = ({ hemY, cuffDist, neckStyle = 'crew' }) => [
    // 1. Exact horizontal torso hem plane (y >= hemY for torso region)
    {
      eval: (x, y, z, aw) => (aw > 0.35 ? 1.0 : y - hemY),
      snap: (x, y, z, aw) => (aw > 0.35 ? [x, y, z] : [x, hemY, z]),
      snapEps: 0.003,
    },
    // 2. Exact perpendicular sleeve cuff plane along arm axis
    {
      eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : cuffDist - armAxisDist(x, y, z)),
      snapEps: 0.003,
    },
    // 3. Smooth scoop / crew neckline contour plane
    {
      eval: (x, y, z, aw) => {
        if (aw > 0.15 || y < 1.28 || Math.abs(x) > 0.125) return 1.0
        const neckY =
          neckStyle === 'scoop'
            ? z > 0.015
              ? 1.334 + 0.062 * Math.min(1.25, Math.pow(x / 0.098, 2))
              : 1.386
            : z > 0.015
            ? 1.352 + 0.044 * Math.min(1.25, Math.pow(x / 0.092, 2))
            : 1.392
        return neckY - y
      },
      snapEps: 0.0025,
    },
  ]

  // 0: MannequinBody (Continuous watertight studio mannequin with pristine sculpted faceless head)
  const meshBody = buildSubMesh({
    name: 'MannequinBody',
    faces: headResult.allBodyFaces,
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.0,
    normalizeGarmentUvs: false,
  })

  // 1: GarmentTopTshirt (Short-sleeve T-shirt from helper-tights with exact iso-clipped hem & cuffs)
  const meshTopTshirt = buildSubMesh({
    name: 'GarmentTopTshirt',
    faces: filterFaces(groups['helper-tights'], v =>
      isUpperGarmentCandidate(v, 0.140, 0.815)
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.012,
    vertexTransform: (x, y, z) => {
      // Bridge across posterior gluteal cleft at lower back so hem forms a smooth outer curve
      if (z < -0.075 && Math.abs(x) < 0.048 && y < 0.98) {
        const w = (1 - Math.abs(x) / 0.048) * Math.min(1, (0.98 - y) / 0.08)
        return [x, y, Math.min(z, z * (1 - w) + -0.105 * w)]
      }
      return [x, y, z]
    },
    clipPlanes: makeUpperClipPlanes({
      hemY: 0.885,
      cuffDist: 0.140,
      neckStyle: 'crew',
    }),
  })

  // 2: GarmentTopBlouse (3/4-sleeve relaxed blouse from helper-tights with exact iso-clipped hem & cuffs)
  const meshTopBlouse = buildSubMesh({
    name: 'GarmentTopBlouse',
    faces: filterFaces(groups['helper-tights'], v =>
      isUpperGarmentCandidate(v, 0.275, 0.820)
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.014,
    vertexTransform: (x, y, z, vIdx) => {
      // Smooth tailored peplum/A-line blouse drape over waist and upper hips (torso only)
      const aw = armWeights[vIdx] ?? 0
      let outX = x
      let outZ = z
      if (outZ < -0.075 && Math.abs(outX) < 0.048 && y < 0.98) {
        const w = (1 - Math.abs(outX) / 0.048) * Math.min(1, (0.98 - y) / 0.08)
        outZ = Math.min(outZ, outZ * (1 - w) + -0.105 * w)
      }
      if (y < 1.16 && aw < 0.35) {
        const torsoWeight = Math.max(0, 1 - aw / 0.35)
        const t = Math.min(1.2, Math.max(0, (1.16 - y) / 0.265))
        const flare = 1.0 + Math.pow(t, 1.15) * 0.082 * torsoWeight
        const cz = 0.025
        return [outX * flare, y, cz + (outZ - cz) * flare]
      }
      return [outX, y, outZ]
    },
    clipPlanes: makeUpperClipPlanes({
      hemY: 0.895,
      cuffDist: 0.275,
      neckStyle: 'scoop',
    }),
  })

  // 3: GarmentTopLong (Long-sleeve shirt / sweater from helper-tights with exact iso-clipped hem & cuffs)
  const meshTopLong = buildSubMesh({
    name: 'GarmentTopLong',
    faces: filterFaces(groups['helper-tights'], v =>
      isUpperGarmentCandidate(v, 0.395, 0.805)
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.012,
    vertexTransform: (x, y, z) => {
      if (z < -0.075 && Math.abs(x) < 0.048 && y < 0.98) {
        const w = (1 - Math.abs(x) / 0.048) * Math.min(1, (0.98 - y) / 0.08)
        return [x, y, Math.min(z, z * (1 - w) + -0.106 * w)]
      }
      return [x, y, z]
    },
    clipPlanes: makeUpperClipPlanes({
      hemY: 0.875,
      cuffDist: 0.395,
      neckStyle: 'crew',
    }),
  })

  // 4: GarmentTopKurung (Long-sleeve tunic / Baju Kurung top combining upper bodice + knee-length tunic skirt)
  const kurungBodiceFaces = filterFaces(groups['helper-tights'], v =>
    isUpperGarmentCandidate(v, 0.395, 0.910)
  )
  const kurungTunicFaces = filterFaces(
    groups['helper-skirt'],
    v => (skirtRingDist.get(v) ?? 99) <= 10
  )
  const meshTopKurung = buildSubMesh({
    name: 'GarmentTopKurung',
    faces: [...kurungBodiceFaces, ...kurungTunicFaces],
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.014,
    vertexTransform: (x, y, z, vIdx) => {
      if (skirtRingDist.has(vIdx)) {
        const ring = skirtRingDist.get(vIdx) ?? 0
        const cz = 0.030
        const flare = 1.04 + Math.pow(ring / 10, 1.15) * 0.14
        const backEase = z < 0.01 && ring <= 5 ? -0.012 * (1 - ring / 6) : 0.0
        return [x * flare, y, cz + (z - cz) * flare + backEase]
      }
      return [x, y, z]
    },
    clipPlanes: [
      {
        eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : 0.395 - armAxisDist(x, y, z)),
        snapEps: 0.003,
      },
    ],
  })

  // 5: GarmentTrousers (Full-length classic denim jeans / trousers from helper-tights waist to ankle)
  const meshTrousers = buildSubMesh({
    name: 'GarmentTrousers',
    faces: filterFaces(groups['helper-tights'], v => {
      const y = masterPos[v * 3 + 1]
      const isArm = armWeights[v] > 0.25
      return !isArm && y >= 0.065 && y <= 1.045
    }),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.006,
    vertexTransform: (x, y, z) => {
      // Classic straight-leg denim silhouette from knee down to hem
      if (y < 0.65) {
        const signX = x >= 0 ? 1 : -1
        const legCenter = signX * (0.105 + (0.65 - y) * 0.11)
        const dx = x - legCenter
        const dz = z - 0.015
        const curR = Math.hypot(dx, dz)
        const targetMinR = 0.068 + Math.max(0, y - 0.15) * 0.015
        if (curR < targetMinR && curR > 0.001) {
          const factor = targetMinR / curR
          return [legCenter + dx * factor, y, 0.015 + dz * factor]
        }
      }
      return [x, y, z]
    },
    clipPlanes: [
      {
        eval: (x, y) => 1.012 - y,
        snap: (x, _y, z) => [x, 1.012, z],
        snapEps: 0.003,
      },
      {
        eval: (x, y) => y - 0.092,
        snap: (x, _y, z) => [x, 0.092, z],
        snapEps: 0.003,
      },
    ],
  })

  // 6: GarmentShorts (Tailored shorts from helper-tights waist to mid-thigh)
  const meshShorts = buildSubMesh({
    name: 'GarmentShorts',
    faces: filterFaces(groups['helper-tights'], v => {
      const y = masterPos[v * 3 + 1]
      const isArm = armWeights[v] > 0.25
      return !isArm && y >= 0.505 && y <= 1.045
    }),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.005,
    clipPlanes: [
      {
        eval: (x, y) => 1.010 - y,
        snap: (x, _y, z) => [x, 1.010, z],
        snapEps: 0.003,
      },
      {
        eval: (x, y) => y - 0.548,
        snap: (x, _y, z) => [x, 0.548, z],
        snapEps: 0.003,
      },
    ],
  })

  // Shared helper for sculpting a clean, level-waisted, level-hemmed A-line skirt from helper-skirt rings
  const transformSkirtVertex = (x, y, z, vIdx, maxRing, maxFlare, targetHemY) => {
    const ring = skirtRingDist.get(vIdx) ?? 0
    const tRing = Math.min(1, ring / maxRing)
    const cz = 0.030
    // Tailored waist/hip ease + smooth A-line flare around anatomical pelvis center (0, 0.030)
    const baseEase = 1.032
    const flare = baseEase + Math.pow(tRing, 1.32) * (maxFlare + 0.025)
    // Posterior hip/buttock clearance so subdivided MannequinBody never pokes through upper back of skirt
    const backEase = z < 0.015 && ring <= 6 ? -0.015 * (1 - ring / 7) : 0.0
    // Level top waistband (rings 0..2 -> y = 0.992) and level lower hem (ring == maxRing -> targetHemY)
    let outY = y
    if (ring === 0) {
      outY = 0.992
    } else if (ring === 1) {
      outY = y * 0.55 + 0.968 * 0.45
    } else if (ring === maxRing) {
      outY = targetHemY
    } else if (ring === maxRing - 1) {
      outY = y * 0.5 + (targetHemY + 0.038) * 0.5
    }
    return [x * flare, outY, cz + (z - cz) * flare + backEase]
  }

  // 7: GarmentSkirtMidi (Flared A-line midi skirt from official helper-skirt rings 0..14)
  const meshSkirtMidi = buildSubMesh({
    name: 'GarmentSkirtMidi',
    faces: filterFaces(
      groups['helper-skirt'],
      v => (skirtRingDist.get(v) ?? 99) <= 14
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.008,
    vertexTransform: (x, y, z, vIdx) =>
      transformSkirtVertex(x, y, z, vIdx, 14, 0.28, 0.388),
  })

  // 8: GarmentSkirtMini (Above-knee A-line skirt from official helper-skirt rings 0..9)
  const meshSkirtMini = buildSubMesh({
    name: 'GarmentSkirtMini',
    faces: filterFaces(
      groups['helper-skirt'],
      v => (skirtRingDist.get(v) ?? 99) <= 9
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.008,
    vertexTransform: (x, y, z, vIdx) =>
      transformSkirtVertex(x, y, z, vIdx, 9, 0.17, 0.615),
  })

  // 9: GarmentDressMidi (Unified continuous one-piece midi dress: bodice down to waist + flared midi skirt)
  const dressBodiceFaces = filterFaces(groups['helper-tights'], v =>
    isUpperGarmentCandidate(v, 0.140, 0.920)
  )
  const dressMidiSkirtFaces = filterFaces(
    groups['helper-skirt'],
    v => (skirtRingDist.get(v) ?? 99) <= 14
  )
  const meshDressMidi = buildSubMesh({
    name: 'GarmentDressMidi',
    faces: [...dressBodiceFaces, ...dressMidiSkirtFaces],
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.009,
    vertexTransform: (x, y, z, vIdx) => {
      if (skirtRingDist.has(vIdx)) {
        return transformSkirtVertex(x, y, z, vIdx, 14, 0.29, 0.388)
      }
      return [x, y, z]
    },
    clipPlanes: [
      {
        eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : 0.140 - armAxisDist(x, y, z)),
        snapEps: 0.003,
      },
    ],
  })

  // 10: GarmentDressMaxi (Unified continuous one-piece evening/maxi gown: cap-sleeve bodice + full-length flared skirt)
  const dressMaxiBodiceFaces = filterFaces(groups['helper-tights'], v =>
    isUpperGarmentCandidate(v, 0.085, 0.920)
  )
  const meshDressMaxi = buildSubMesh({
    name: 'GarmentDressMaxi',
    faces: [...dressMaxiBodiceFaces, ...groups['helper-skirt']],
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.009,
    vertexTransform: (x, y, z, vIdx) => {
      if (skirtRingDist.has(vIdx)) {
        return transformSkirtVertex(x, y, z, vIdx, 19, 0.36, 0.125)
      }
      return [x, y, z]
    },
    clipPlanes: [
      {
        eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : 0.085 - armAxisDist(x, y, z)),
        snapEps: 0.003,
      },
    ],
  })

  // Open-front predicate for outerwear (clips a clean center-front opening so inner top/dress shows through)
  const isNotCenterFrontOpening = (f, gapHalfWidth = 0.034) => {
    let frontCenterCount = 0
    for (const c of f) {
      const x = masterPos[c.v * 3]
      const z = masterPos[c.v * 3 + 2]
      if (z > 0.03 && Math.abs(x) < gapHalfWidth) {
        frontCenterCount++
      }
    }
    return frontCenterCount < 2
  }

  // 11: GarmentOuterJacket (Open-front waist/hip jacket with exact iso-clipped hem & cuffs)
  const meshOuterJacket = buildSubMesh({
    name: 'GarmentOuterJacket',
    faces: filterFaces(groups['helper-tights'], v =>
      isUpperGarmentCandidate(v, 0.395, 0.815)
    ).filter(f => isNotCenterFrontOpening(f, 0.034)),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.026,
    clipPlanes: makeUpperClipPlanes({
      hemY: 0.885,
      cuffDist: 0.395,
      neckStyle: 'crew',
    }),
    boundaryAlign: (x, y, z) => {
      if (z > 0.03 && Math.abs(x) < 0.055 && y < 1.32) {
        const signX = x >= 0 ? 1 : -1
        return [signX * 0.036, y, z]
      }
      return [x, y, z]
    },
  })

  // 12: GarmentOuterBlazer (Open-front tailored blazer extending over hips)
  const blazerUpperFaces = filterFaces(groups['helper-tights'], v =>
    isUpperGarmentCandidate(v, 0.395, 0.915)
  )
  const blazerLowerFaces = filterFaces(
    groups['helper-skirt'],
    v => (skirtRingDist.get(v) ?? 99) <= 4
  )
  const meshOuterBlazer = buildSubMesh({
    name: 'GarmentOuterBlazer',
    faces: [...blazerUpperFaces, ...blazerLowerFaces].filter(f =>
      isNotCenterFrontOpening(f, 0.036)
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.026,
    clipPlanes: [
      {
        eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : 0.395 - armAxisDist(x, y, z)),
        snapEps: 0.003,
      },
    ],
  })

  // 13: GarmentOuterCoat (Open-front long trench coat extending to knee)
  const coatLowerFaces = filterFaces(
    groups['helper-skirt'],
    v => (skirtRingDist.get(v) ?? 99) <= 11
  )
  const meshOuterCoat = buildSubMesh({
    name: 'GarmentOuterCoat',
    faces: [...blazerUpperFaces, ...coatLowerFaces].filter(f =>
      isNotCenterFrontOpening(f, 0.038)
    ),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.027,
    vertexTransform: (x, y, z, vIdx) => {
      if (skirtRingDist.has(vIdx)) {
        const ring = skirtRingDist.get(vIdx) ?? 0
        const flare = 1.03 + (ring / 11) * 0.14
        return [x * flare, y, z * flare]
      }
      return [x, y, z]
    },
    clipPlanes: [
      {
        eval: (x, y, z, aw) => (aw < 0.18 ? 1.0 : 0.395 - armAxisDist(x, y, z)),
        snapEps: 0.003,
      },
    ],
  })

  // 14: GarmentShoesLoafers (Classic tailored loafers / Oxfords aligned to actual MannequinBody feet)
  const meshShoesLoafers = buildFootwearMesh('loafers', masterPos, masterMorphs)

  // 15: GarmentShoesHeels (Court high-heel pumps aligned to actual MannequinBody feet)
  const meshShoesHeels = buildFootwearMesh('heels', masterPos, masterMorphs)

  // 16: GarmentShoesSneakers (Athletic / casual court sneakers aligned to actual MannequinBody feet)
  const meshShoesSneakers = buildFootwearMesh('sneakers', masterPos, masterMorphs)

  // Alias GarmentShoes to GarmentShoesLoafers for full backward compatibility
  const meshShoes = {
    ...meshShoesLoafers,
    name: 'GarmentShoes',
  }

  // 17: GarmentShawl (Authentic continuous parametric draped silk shawl / stole mantle mesh)
  const meshShawl = buildDrapedShawlMesh()

  // 18: GarmentBelt (Tailored waist belt around natural waist ring of helper-tights)
  const meshBelt = buildSubMesh({
    name: 'GarmentBelt',
    faces: filterFaces(groups['helper-tights'], v => {
      const y = masterPos[v * 3 + 1]
      const isArm = armWeights[v] > 0.2
      return !isArm && y >= 0.940 && y <= 1.030
    }),
    masterPos,
    masterNormals,
    masterArmWeights: armWeights,
    masterUvs: uvs,
    masterMorphs,
    normalOffset: 0.018,
    clipPlanes: [
      {
        eval: (x, y) => 1.012 - y,
        snap: (x, _y, z) => [x, 1.012, z],
        snapEps: 0.0025,
      },
      {
        eval: (x, y) => y - 0.962,
        snap: (x, _y, z) => [x, 0.962, z],
        snapEps: 0.0025,
      },
    ],
  })

  const allMeshes = [
    meshBody,
    meshTopTshirt,
    meshTopBlouse,
    meshTopLong,
    meshTopKurung,
    meshTrousers,
    meshShorts,
    meshSkirtMidi,
    meshSkirtMini,
    meshDressMidi,
    meshDressMaxi,
    meshOuterJacket,
    meshOuterBlazer,
    meshOuterCoat,
    meshShoes,
    meshShoesLoafers,
    meshShoesHeels,
    meshShoesSneakers,
    meshShawl,
    meshBelt,
  ]

  subdivideBody(meshBody)

  // Enforce strict radial garment layering hierarchy around torso/hip axis (cx = 0, cz = 0.025):
  // MannequinBody < Bottoms (Skirts/Trousers/Shorts) < Untucked Tops (Blouse/Tshirt/Long/Kurung) < Outerwear
  {
    const cz = 0.025
    const Y_MIN = 0.80
    const Y_MAX = 1.15
    const NY = 36
    const NTHETA = 72

    const buildRadialEnvelope = (meshes, yLo, yHi) => {
      const grid = new Float32Array(NY * NTHETA)
      for (const m of meshes) {
        const pos = m.positions
        const idx = m.indices
        // Sample both vertices and triangle centroids/edge midpoints so flat triangle faces are bounded
        const addSample = (sx, sy, sz) => {
          if (sy < yLo || sy > yHi || Math.abs(sx) > 0.24) return
          const yi = Math.max(0, Math.min(NY - 1, Math.floor(((sy - Y_MIN) / (Y_MAX - Y_MIN)) * NY)))
          const th = Math.atan2(sx, sz - cz)
          const ti = ((Math.floor(((th + Math.PI) / (2 * Math.PI)) * NTHETA) % NTHETA) + NTHETA) % NTHETA
          const r = Math.hypot(sx, sz - cz)
          for (let dy = -1; dy <= 1; dy++) {
            const nyi = yi + dy
            if (nyi < 0 || nyi >= NY) continue
            for (let dt = -2; dt <= 2; dt++) {
              const nti = (ti + dt + NTHETA) % NTHETA
              const cell = nyi * NTHETA + nti
              if (r > grid[cell]) grid[cell] = r
            }
          }
        }
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i] * 3
          const b = idx[i + 1] * 3
          const c = idx[i + 2] * 3
          const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
          const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
          const cxp = pos[c], cy = pos[c + 1], czp = pos[c + 2]
          addSample(ax, ay, az)
          addSample(bx, by, bz)
          addSample(cxp, cy, czp)
          addSample((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5)
          addSample((bx + cxp) * 0.5, (by + cy) * 0.5, (bz + czp) * 0.5)
          addSample((cxp + ax) * 0.5, (cy + ay) * 0.5, (czp + az) * 0.5)
          addSample((ax + bx + cxp) / 3, (ay + by + cy) / 3, (az + bz + czp) / 3)
        }
      }
      // Smooth angularly and vertically so target radial clearance surface is silky-smooth
      const smoothed = new Float32Array(NY * NTHETA)
      for (let yi = 0; yi < NY; yi++) {
        for (let ti = 0; ti < NTHETA; ti++) {
          let sum = 0
          let wSum = 0
          for (let dy = -1; dy <= 1; dy++) {
            const nyi = Math.max(0, Math.min(NY - 1, yi + dy))
            const wy = dy === 0 ? 2 : 1
            for (let dt = -2; dt <= 2; dt++) {
              const nti = (ti + dt + NTHETA) % NTHETA
              const wt = 3 - Math.abs(dt)
              const val = grid[nyi * NTHETA + nti]
              if (val > 0) {
                sum += val * wy * wt
                wSum += wy * wt
              }
            }
          }
          const orig = grid[yi * NTHETA + ti]
          smoothed[yi * NTHETA + ti] = Math.max(orig, wSum > 0 ? sum / wSum : 0)
        }
      }
      return (y, theta) => {
        const yf = ((y - Y_MIN) / (Y_MAX - Y_MIN)) * NY - 0.5
        const yi0 = Math.max(0, Math.min(NY - 1, Math.floor(yf)))
        const yi1 = Math.max(0, Math.min(NY - 1, yi0 + 1))
        const ty = Math.max(0, Math.min(1, yf - yi0))
        const tf = ((theta + Math.PI) / (2 * Math.PI)) * NTHETA
        const ti0 = ((Math.floor(tf) % NTHETA) + NTHETA) % NTHETA
        const ti1 = (ti0 + 1) % NTHETA
        const tt = tf - Math.floor(tf)
        const v00 = smoothed[yi0 * NTHETA + ti0]
        const v01 = smoothed[yi0 * NTHETA + ti1]
        const v10 = smoothed[yi1 * NTHETA + ti0]
        const v11 = smoothed[yi1 * NTHETA + ti1]
        const v0 = v00 * (1 - tt) + v01 * tt
        const v1 = v10 * (1 - tt) + v11 * tt
        return v0 * (1 - ty) + v1 * ty
      }
    }

    const bottomEnvelope = buildRadialEnvelope(
      [meshSkirtMidi, meshSkirtMini, meshTrousers, meshShorts],
      0.84,
      1.015
    )

    const topMeshesToClear = [meshTopBlouse, meshTopTshirt, meshTopLong, meshTopKurung]
    for (const tm of topMeshesToClear) {
      const pos = tm.positions
      const nVerts = pos.length / 3
      for (let v = 0; v < nVerts; v++) {
        const x = pos[v * 3]
        const y = pos[v * 3 + 1]
        const z = pos[v * 3 + 2]
        // Only adjust torso vertices in the waist/hip overlap zone (exclude arms at |x| > 0.215)
        if (y < 0.85 || y > 1.09 || Math.abs(x) > 0.215) continue
        const theta = Math.atan2(x, z - cz)
        const rCur = Math.hypot(x, z - cz)
        if (rCur < 0.01) continue

        // Evaluate bottom envelope at clamped height min(y, 0.985) so top drapes smoothly across waist
        const sampleY = Math.min(y, 0.985)
        const rBot = bottomEnvelope(sampleY, theta)
        if (rBot <= 0) continue

        // Smooth vertical fade above y = 0.992 up to y = 1.09
        const fade =
          y <= 0.992
            ? 1.0
            : Math.max(0, 0.5 * (1 + Math.cos(Math.PI * ((y - 0.992) / (1.09 - 0.992)))))
        const margin = 0.0085
        const rTarget = rCur * (1 - fade) + Math.max(rCur, rBot + margin) * fade
        if (rTarget > rCur) {
          const scale = rTarget / rCur
          pos[v * 3] = x * scale
          pos[v * 3 + 2] = cz + (z - cz) * scale
        }
      }
    }

    // Ensure outerwear clears both tops and bottoms in the waist/hip zone
    const innerEnvelope = buildRadialEnvelope(
      [meshTopBlouse, meshTopTshirt, meshTopLong, meshSkirtMidi, meshTrousers],
      0.81,
      1.12
    )
    for (const om of [meshOuterJacket, meshOuterBlazer, meshOuterCoat]) {
      const pos = om.positions
      const nVerts = pos.length / 3
      for (let v = 0; v < nVerts; v++) {
        const x = pos[v * 3]
        const y = pos[v * 3 + 1]
        const z = pos[v * 3 + 2]
        if (y < 0.81 || y > 1.12 || Math.abs(x) > 0.225) continue
        const theta = Math.atan2(x, z - cz)
        const rCur = Math.hypot(x, z - cz)
        if (rCur < 0.01) continue
        const rInner = innerEnvelope(y, theta)
        if (rInner > 0 && rCur < rInner + 0.007) {
          const scale = (rInner + 0.007) / rCur
          pos[v * 3] = x * scale
          pos[v * 3 + 2] = cz + (z - cz) * scale
        }
      }
    }
  }

  for (const mesh of allMeshes) finishSurface(mesh)

  for (const m of allMeshes) {
    console.log(
      `  SubMesh [${m.name.padEnd(20)}]: ${String(
        m.positions.length / 3
      ).padStart(6)} verts, ${String(m.indices.length / 3).padStart(6)} tris`
    )
  }

  // Export all 17 meshes into a single binary glTF 2.0 (.glb) file
  const outPath = path.resolve('public/models/fashion-mannequin.glb')
  exportMultiMeshGlb(allMeshes, outPath)
}

function exportMultiMeshGlb(meshes, outPath) {
  const bufferViews = []
  const accessors = []
  const chunks = []
  let byteOffset = 0

  function appendBuffer(typedArray, target) {
    const buf = Buffer.from(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength
    )
    const pad = (4 - (buf.length % 4)) % 4
    const padded = pad > 0 ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf
    const viewIdx = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: buf.length,
      ...(target ? { target } : {}),
    })
    chunks.push(padded)
    byteOffset += padded.length
    return viewIdx
  }

  const gltfMeshes = []
  const gltfNodes = []
  const nodeIndices = []
  const targetNames = [
    'chest_size',
    'waist_size',
    'hip_size',
    'shoulder_width',
    'body_mass',
  ]

  for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
    const m = meshes[mIdx]
    const vCount = m.positions.length / 3
    const iCount = m.indices.length

    // Position accessor
    const posView = appendBuffer(m.positions, 34962)
    const posBounds = computeMinMaxVec3(m.positions)
    const posAcc = accessors.length
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: vCount,
      type: 'VEC3',
      min: posBounds.min,
      max: posBounds.max,
    })

    // Normal accessor
    const normView = appendBuffer(m.normals, 34962)
    const normAcc = accessors.length
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count: vCount,
      type: 'VEC3',
    })

    // UV accessor
    const uvView = appendBuffer(m.uvs, 34962)
    const uvAcc = accessors.length
    accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: vCount,
      type: 'VEC2',
    })

    // Index accessor
    const idxView = appendBuffer(m.indices, 34963)
    const idxAcc = accessors.length
    accessors.push({
      bufferView: idxView,
      componentType: 5125,
      count: iCount,
      type: 'SCALAR',
    })

    // Morph target POSITION accessors
    const targets = []
    for (const tName of targetNames) {
      const mArr = m.morphs[tName]
      const mView = appendBuffer(mArr, 34962)
      const mBounds = computeMinMaxVec3(mArr)
      const mAcc = accessors.length
      accessors.push({
        bufferView: mView,
        componentType: 5126,
        count: vCount,
        type: 'VEC3',
        min: mBounds.min,
        max: mBounds.max,
      })
      const normalView = appendBuffer(m.morphNormals[tName], 34962)
      const normalAcc = accessors.length
      accessors.push({ bufferView: normalView, componentType: 5126, count: vCount, type: 'VEC3' })
      targets.push({ POSITION: mAcc, NORMAL: normalAcc })
    }

    gltfMeshes.push({
      name: m.name,
      primitives: [
        {
          attributes: {
            POSITION: posAcc,
            NORMAL: normAcc,
            TEXCOORD_0: uvAcc,
          },
          indices: idxAcc,
          material: 0,
          targets,
        },
      ],
      weights: [0, 0, 0, 0, 0],
      extras: {
        targetNames,
      },
    })

    gltfNodes.push({
      name: m.name,
      mesh: mIdx,
    })
    nodeIndices.push(mIdx)
  }

  const binBuffer = Buffer.concat(chunks)

  const gltf = {
    asset: {
      version: '2.0',
      generator:
        'FitSync MakeHuman HM08 CC0 Multi-Mesh & Morph Compiler (CC0 1.0 Universal)',
      copyright:
        'CC0 1.0 Universal (Public Domain) — MakeHuman Community / MPFB2 HM08 Mesh & Targets',
    },
    scene: 0,
    scenes: [{ name: 'FitSyncHM08MannequinScene', nodes: nodeIndices }],
    nodes: gltfNodes,
    materials: [
      {
        name: 'StudioIvoryMannequin',
        pbrMetallicRoughness: {
          baseColorFactor: [0.95, 0.94, 0.92, 1.0],
          metallicFactor: 0.03,
          roughnessFactor: 0.38,
        },
        doubleSided: true,
      },
    ],
    meshes: gltfMeshes,
    buffers: [{ byteLength: binBuffer.length }],
    bufferViews,
    accessors,
  }

  const jsonStr = JSON.stringify(gltf)
  const jsonPad = (4 - (Buffer.byteLength(jsonStr) % 4)) % 4
  const jsonBuf = Buffer.from(jsonStr + ' '.repeat(jsonPad), 'utf8')

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuffer.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binBuffer.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuffer])
  )
  console.log(
    `\nSuccessfully compiled ${outPath}: ${(totalLength / (1024 * 1024)).toFixed(
      2
    )} MB (${meshes.length} meshes, 5 morph targets per mesh)`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
