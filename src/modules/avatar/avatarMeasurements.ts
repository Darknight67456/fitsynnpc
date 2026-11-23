import { SplineCurve, Vector2 } from 'three'
import type { BodyProfile } from '../../types'

/**
 * Documented neutral baseline measurements (in cm / kg).
 * Used as fallback when a profile field is missing, NaN, or out of bounds.
 */
export const NEUTRAL_BASELINE: BodyProfile = {
  user_id: '',
  height_cm: 165,
  weight_kg: 58,
  chest: 88,
  waist: 72,
  hips: 96,
  shoulder: 38,
  fit_pref: 'regular',
  skin_undertone: 'neutral',
}

/**
 * Safe anatomical clamping ranges for parametric avatar generation.
 * Prevents geometry collapse or inversion while a user is mid-keystroke in number inputs.
 */
export const MEASUREMENT_BOUNDS = {
  height_cm: { min: 135, max: 210 },
  weight_kg: { min: 35, max: 160 },
  chest: { min: 65, max: 145 },
  waist: { min: 50, max: 135 },
  hips: { min: 68, max: 150 },
  shoulder: { min: 30, max: 56 },
} as const

/** Front-to-back depth ratio (Z / X) for an elliptical human torso cross-section. */
export const TORSO_DEPTH_RATIO = 0.70

/**
 * Elliptical perimeter correction factor:
 * For semi-axes (a, k*a) with k = TORSO_DEPTH_RATIO, perimeter C ≈ 2 * pi * a * sqrt((1 + k^2) / 2).
 */
const ELLIPSE_FACTOR = Math.sqrt((1 + TORSO_DEPTH_RATIO * TORSO_DEPTH_RATIO) / 2)

/**
 * Converts a horizontal body circumference (in cm) into the lateral (X) radius (in meters)
 * of an ellipse whose Z-axis is scaled by TORSO_DEPTH_RATIO.
 */
export function circumferenceToLateralRadius(cm: number): number {
  const meters = cm / 100
  return meters / (2 * Math.PI * ELLIPSE_FACTOR)
}

/**
 * Converts a cylindrical limb circumference (in cm) into a circular radius (in meters).
 */
export function circumferenceToCircleRadius(cm: number): number {
  return cm / (2 * Math.PI * 100)
}

function clampField(
  val: unknown,
  bounds: { min: number; max: number },
  fallback: number
): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.min(bounds.max, Math.max(bounds.min, num))
}

/**
 * Validates and clamps a raw BodyProfile so all measurements are within safe anatomical bounds.
 */
export function sanitizeBodyProfile(
  raw?: Partial<BodyProfile> | null
): BodyProfile {
  if (!raw) return { ...NEUTRAL_BASELINE }

  const undertone =
    raw.skin_undertone === 'warm' ||
    raw.skin_undertone === 'cool' ||
    raw.skin_undertone === 'neutral'
      ? raw.skin_undertone
      : NEUTRAL_BASELINE.skin_undertone

  const fitPref =
    raw.fit_pref === 'slim' ||
    raw.fit_pref === 'regular' ||
    raw.fit_pref === 'loose'
      ? raw.fit_pref
      : NEUTRAL_BASELINE.fit_pref

  return {
    user_id: raw.user_id ?? '',
    height_cm: clampField(raw.height_cm, MEASUREMENT_BOUNDS.height_cm, NEUTRAL_BASELINE.height_cm),
    weight_kg: clampField(raw.weight_kg, MEASUREMENT_BOUNDS.weight_kg, NEUTRAL_BASELINE.weight_kg),
    chest: clampField(raw.chest, MEASUREMENT_BOUNDS.chest, NEUTRAL_BASELINE.chest),
    waist: clampField(raw.waist, MEASUREMENT_BOUNDS.waist, NEUTRAL_BASELINE.waist),
    hips: clampField(raw.hips, MEASUREMENT_BOUNDS.hips, NEUTRAL_BASELINE.hips),
    shoulder: clampField(raw.shoulder, MEASUREMENT_BOUNDS.shoulder, NEUTRAL_BASELINE.shoulder),
    fit_pref: fitPref,
    skin_undertone: undertone,
  }
}

/**
 * Maps skin undertone to a natural 3D mannequin skin color hex.
 */
export function getSkinColor(undertone: BodyProfile['skin_undertone']): string {
  switch (undertone) {
    case 'warm':
      return '#dfa97e'
    case 'cool':
      return '#ecc6b3'
    case 'neutral':
    default:
      return '#e6bc98'
  }
}

/**
 * Maps user fit preference ('slim' | 'regular' | 'loose') to a subtle garment radial ease factor.
 */
export function getFitEaseFactor(fitPref: string): number {
  switch (fitPref) {
    case 'slim':
      return 0.985
    case 'loose':
      return 1.045
    case 'regular':
    default:
      return 1.01
  }
}

export interface AvatarDimensions {
  profile: BodyProfile
  heightM: number
  torsoDepthRatio: number
  fitEase: number
  skinColor: string
  shoulderHalfWidth: number
  hipJointX: number
  armAngleRad: number
  armLength: number
  bounds: {
    minY: number
    maxY: number
    totalHeight: number
    centerY: number
    totalWidth: number
    maxRadius: number
  }
  levels: {
    ground: number
    ankle: number
    calfPeak: number
    knee: number
    crotch: number
    hip: number
    waist: number
    underbust: number
    chest: number
    shoulder: number
    neckBase: number
    neckTop: number
    headCenter: number
    topOfHead: number
  }
  radii: {
    hips: number
    waist: number
    underbust: number
    chest: number
    shoulderLathe: number
    neckBase: number
    neckTop: number
    headWidth: number
    headHeight: number
    headDepth: number
    thighTop: number
    midThigh: number
    knee: number
    calf: number
    ankle: number
    deltoid: number
    upperArm: number
    elbow: number
    forearm: number
    wrist: number
  }
}

/**
 * Computes all anatomical 3D landmarks, limb thicknesses, and bounding box dimensions (in meters)
 * from a BodyProfile. Synchronized with /models/fashion-mannequin.glb coordinates and morph targets.
 */
export function computeAvatarDimensions(rawProfile?: Partial<BodyProfile> | null): AvatarDimensions {
  const p = sanitizeBodyProfile(rawProfile)
  const H = p.height_cm / 100

  // Circumference-derived lateral torso radii (for elliptical LatheGeometry)
  const hipsR = circumferenceToLateralRadius(p.hips)
  const waistR = circumferenceToLateralRadius(p.waist)
  const chestR = circumferenceToLateralRadius(p.chest)
  const underbustR = waistR * 0.52 + chestR * 0.48

  // Shoulder is entered as linear biacromial breadth in cm (e.g., 38 cm -> 0.19 m half-width).
  const shoulderHalfWidth = Math.max(chestR * 1.02, p.shoulder / 200)

  // Upper torso lathe radius reaches out to meet the inner deltoid smoothly
  const shoulderLatheR = Math.min(
    Math.max(chestR * 0.98, shoulderHalfWidth * 0.92),
    chestR * 1.24
  )

  const neckBaseR = Math.max(0.052, Math.min(0.070, shoulderLatheR * 0.37))
  const neckTopR = neckBaseR * 0.85

  // Weight BMI factor influences limb fullness within realistic anatomical bounds
  const bmi = p.weight_kg / (H * H)
  const limbFactor = Math.min(1.24, Math.max(0.88, 0.74 + (bmi / 21.5) * 0.28))

  // Smooth, proportional leg radii
  const thighTopR = Math.max(0.074, hipsR * 0.51 * limbFactor)
  const midThighR = thighTopR * 0.87
  const kneeR = thighTopR * 0.67
  const calfR = thighTopR * 0.69
  const ankleR = thighTopR * 0.45

  // Smooth, proportional arm radii
  const upperArmR = Math.max(0.044, (H * 0.0275 + chestR * 0.06) * limbFactor)
  const deltoidR = upperArmR * 1.12
  const elbowR = upperArmR * 0.82
  const forearmR = upperArmR * 0.85
  const wristR = upperArmR * 0.62

  // Vertical anatomical landmarks along the Y axis (ground = 0)
  const ankle = H * 0.048
  const calfPeak = H * 0.178
  const knee = H * 0.275
  const crotch = H * 0.468
  const hip = H * 0.522
  const waist = H * 0.612
  const underbust = H * 0.678
  const chest = H * 0.722
  const shoulder = H * 0.812
  const neckBase = H * 0.846
  const neckTop = H * 0.884

  const headHeight = H * 0.066
  const headWidth = headHeight * 0.77
  const headDepth = headHeight * 0.87
  const headCenter = neckTop + headHeight * 0.75
  const topOfHead = H

  const armAngleRad = 0.135
  const armLength = H * 0.345
  const hipJointX = Math.max(thighTopR * 0.90, hipsR * 0.46)

  // Exact bounding box for camera auto-framing
  const armSpanHalf =
    shoulderHalfWidth + Math.sin(armAngleRad) * armLength + upperArmR * 1.2
  const hipSpanHalf = hipJointX + thighTopR
  const totalWidth = Math.max(armSpanHalf, hipSpanHalf) * 2
  const maxRadius = Math.max(hipsR, chestR, shoulderHalfWidth)

  return {
    profile: p,
    heightM: H,
    torsoDepthRatio: TORSO_DEPTH_RATIO,
    fitEase: getFitEaseFactor(p.fit_pref),
    skinColor: getSkinColor(p.skin_undertone),
    shoulderHalfWidth,
    hipJointX,
    armAngleRad,
    armLength,
    bounds: {
      minY: 0,
      maxY: topOfHead,
      totalHeight: topOfHead,
      centerY: topOfHead * 0.5,
      totalWidth,
      maxRadius,
    },
    levels: {
      ground: 0,
      ankle,
      calfPeak,
      knee,
      crotch,
      hip,
      waist,
      underbust,
      chest,
      shoulder,
      neckBase,
      neckTop,
      headCenter,
      topOfHead,
    },
    radii: {
      hips: hipsR,
      waist: waistR,
      underbust: underbustR,
      chest: chestR,
      shoulderLathe: shoulderLatheR,
      neckBase: neckBaseR,
      neckTop: neckTopR,
      headWidth,
      headHeight,
      headDepth,
      thighTop: thighTopR,
      midThigh: midThighR,
      knee: kneeR,
      calf: calfR,
      ankle: ankleR,
      deltoid: deltoidR,
      upperArm: upperArmR,
      elbow: elbowR,
      forearm: forearmR,
      wrist: wristR,
    },
  }
}

/**
 * Generates a smooth, high-resolution Vector2 profile for Three.js LatheGeometry
 * representing the torso from the lower pelvis/crotch up to the base of the neck.
 */
export function buildTorsoLathePoints(
  dims: AvatarDimensions,
  radialScale = 1,
  options?: {
    startAtHip?: boolean
    bottomY?: number
    topY?: number
    includeNeck?: boolean
    closeBottom?: boolean
    closeTop?: boolean
    bustClearance?: number
  }
): Vector2[] {
  const { levels: L, radii: R } = dims
  const startAtHip = options?.startAtHip ?? false
  const includeNeck = options?.includeNeck ?? false
  const closeBottom = options?.closeBottom ?? !startAtHip
  const closeTop = options?.closeTop ?? true
  const bustAllowance = options?.bustClearance ?? 0

  const keyPoints: Vector2[] = []

  if (options?.bottomY !== undefined && options.bottomY < L.hip) {
    const t = Math.max(0, Math.min(1, (L.hip - options.bottomY) / (L.hip - L.knee)))
    const hemR = (R.hips + bustAllowance * 0.5) * (1 + t * 0.14) * radialScale
    keyPoints.push(new Vector2(hemR, options.bottomY))
    keyPoints.push(new Vector2((R.hips + bustAllowance * 0.5) * 1.02 * radialScale, (options.bottomY + L.hip) * 0.5))
  } else if (!startAtHip) {
    keyPoints.push(new Vector2(R.hips * 0.52 * radialScale, L.crotch))
    keyPoints.push(new Vector2((R.hips + bustAllowance * 0.4) * 0.88 * radialScale, L.crotch * 0.6 + L.hip * 0.4))
  }

  keyPoints.push(new Vector2((R.hips + bustAllowance * 0.45) * radialScale, L.hip))
  keyPoints.push(
    new Vector2(
      (R.hips * 0.58 + R.waist * 0.42 + bustAllowance * 0.3) * radialScale,
      L.hip * 0.55 + L.waist * 0.45
    )
  )
  keyPoints.push(new Vector2((R.waist + bustAllowance * 0.25) * radialScale, L.waist))
  keyPoints.push(new Vector2((R.underbust + bustAllowance * 0.5) * radialScale, L.underbust))
  keyPoints.push(new Vector2((R.chest * 1.03 + bustAllowance) * radialScale, L.chest))
  keyPoints.push(new Vector2((R.shoulderLathe + bustAllowance * 0.4) * radialScale, L.shoulder))
  keyPoints.push(new Vector2(R.neckBase * 1.12 * radialScale, L.neckBase))

  if (includeNeck) {
    keyPoints.push(new Vector2(R.neckTop * radialScale, L.neckTop))
    keyPoints.push(new Vector2(R.neckTop * 0.92 * radialScale, L.headCenter - R.headHeight * 0.32))
  }

  const curve = new SplineCurve(keyPoints)
  const sampled = curve.getPoints(36)

  const result: Vector2[] = []
  if (closeBottom) {
    result.push(new Vector2(0.001, sampled[0].y))
  }
  result.push(...sampled)
  if (closeTop) {
    result.push(new Vector2(0.001, sampled[sampled.length - 1].y))
  }
  return result
}

/**
 * Generates a single continuous, seam-free arm + hand LatheGeometry profile.
 */
export function buildArmLathePoints(
  dims: AvatarDimensions,
  radialScale = 1
): Vector2[] {
  const { radii: R, armLength } = dims
  const handLen = armLength * 0.145
  const totalLen = armLength + handLen

  const keyPoints: Vector2[] = [
    new Vector2(0.001, R.deltoid * 0.88),
    new Vector2(R.deltoid * 0.72 * radialScale, R.deltoid * 0.62),
    new Vector2(R.deltoid * radialScale, R.deltoid * 0.12),
    new Vector2(R.upperArm * radialScale, -armLength * 0.18),
    new Vector2(R.upperArm * 0.92 * radialScale, -armLength * 0.35),
    new Vector2(R.elbow * radialScale, -armLength * 0.48),
    new Vector2(R.forearm * radialScale, -armLength * 0.62),
    new Vector2(R.forearm * 0.84 * radialScale, -armLength * 0.80),
    new Vector2(R.wrist * radialScale, -armLength * 0.96),
    new Vector2(R.wrist * 1.12 * radialScale, -armLength - handLen * 0.38),
    new Vector2(R.wrist * 0.82 * radialScale, -armLength - handLen * 0.78),
    new Vector2(R.wrist * 0.35 * radialScale, -totalLen * 0.985),
    new Vector2(0.001, -totalLen),
  ]

  const curve = new SplineCurve(keyPoints)
  return curve.getPoints(36)
}

/**
 * Generates a smooth sleeve LatheGeometry profile starting at the shoulder origin (y = 0)
 * down to the specified sleeveFraction of armLength.
 */
export function buildSleeveLathePoints(
  dims: AvatarDimensions,
  sleeveFraction: number,
  radialScale = 1.08
): Vector2[] {
  const { radii: R, armLength } = dims
  const len = armLength * Math.max(0.2, Math.min(0.96, sleeveFraction))

  const rAtEnd =
    sleeveFraction <= 0.45
      ? R.upperArm * 1.02 * radialScale
      : R.wrist * 1.24 * radialScale

  const midR =
    sleeveFraction <= 0.45
      ? R.upperArm * 1.06 * radialScale
      : R.elbow * 1.10 * radialScale

  const keyPoints: Vector2[] = [
    new Vector2(0.001, R.deltoid * 0.94 * radialScale),
    new Vector2(R.deltoid * 0.82 * radialScale, R.deltoid * 0.60 * radialScale),
    new Vector2(R.deltoid * 1.05 * radialScale, 0),
    new Vector2(midR, -len * 0.55),
    new Vector2(rAtEnd, -len),
  ]

  const curve = new SplineCurve(keyPoints)
  return curve.getPoints(22)
}

/**
 * Generates a single continuous leg LatheGeometry profile from ankle to upper thigh/hip socket.
 */
export function buildLegLathePoints(
  dims: AvatarDimensions,
  radialScale = 1,
  options?: { bottomY?: number; openBottom?: boolean }
): Vector2[] {
  const { levels: L, radii: R } = dims
  const thighTopY = L.hip * 0.98
  const midThighY = (thighTopY + L.knee) * 0.52
  const bottomY = options?.bottomY ?? L.ankle
  const openBottom = options?.openBottom ?? false

  const keyPoints: Vector2[] = []

  if (bottomY <= L.ankle + 0.01) {
    keyPoints.push(new Vector2(R.ankle * radialScale, L.ankle))
    keyPoints.push(new Vector2(R.calf * 0.88 * radialScale, (L.ankle + L.calfPeak) * 0.5))
    keyPoints.push(new Vector2(R.calf * 1.03 * radialScale, L.calfPeak))
    keyPoints.push(new Vector2(R.knee * 0.98 * radialScale, L.knee))
  } else {
    keyPoints.push(new Vector2(R.midThigh * 0.98 * radialScale, bottomY))
  }

  keyPoints.push(new Vector2(R.midThigh * 1.02 * radialScale, midThighY))
  keyPoints.push(new Vector2(R.thighTop * 1.01 * radialScale, thighTopY - 0.02))
  keyPoints.push(new Vector2(R.thighTop * 0.62 * radialScale, thighTopY + 0.018))

  const curve = new SplineCurve(keyPoints)
  const sampled = curve.getPoints(28)

  const result: Vector2[] = []
  if (!openBottom) {
    result.push(new Vector2(0.001, sampled[0].y))
  }
  result.push(...sampled)
  result.push(new Vector2(0.001, sampled[sampled.length - 1].y))
  return result
}

/**
 * Generates a single unified, continuous Dress LatheGeometry profile from the hem
 * (midi or maxi/evening length) through the flared skirt, hips, waist, bust, and neckline.
 */
export function buildDressLathePoints(
  dims: AvatarDimensions,
  radialScale = 1.06,
  isMaxi = false,
  bustClearance = 0.018
): Vector2[] {
  const { levels: L, radii: R } = dims
  const hemY = isMaxi ? L.ankle + 0.025 : (L.knee + L.calfPeak) * 0.48
  const flareFactor = isMaxi ? 1.48 : 1.40

  const keyPoints: Vector2[] = [
    new Vector2(R.hips * flareFactor * radialScale, hemY),
    new Vector2(R.hips * (1 + (flareFactor - 1) * 0.62) * radialScale, (hemY + L.hip) * 0.48),
    new Vector2((R.hips * 1.09 + bustClearance * 0.5) * radialScale, L.hip),
    new Vector2((R.hips * 0.52 + R.waist * 0.48 + bustClearance * 0.3) * radialScale, (L.hip + L.waist) * 0.5),
    new Vector2((R.waist * 1.02 + bustClearance * 0.25) * radialScale, L.waist),
    new Vector2((R.underbust * 1.02 + bustClearance * 0.5) * radialScale, L.underbust),
    new Vector2((R.chest * 1.04 + bustClearance) * radialScale, L.chest),
    new Vector2((R.shoulderLathe + bustClearance * 0.4) * radialScale, L.shoulder),
    new Vector2(R.neckBase * 1.18 * radialScale, L.neckBase - 0.008),
  ]

  const curve = new SplineCurve(keyPoints)
  return curve.getPoints(44)
}

/**
 * Generates a single continuous Skirt LatheGeometry profile from the flared hem
 * up through the hip contour to the fitted high waistband.
 */
export function buildSkirtLathePoints(
  dims: AvatarDimensions,
  radialScale = 1.055,
  isMidi = true
): Vector2[] {
  const { levels: L, radii: R } = dims
  const hemY = isMidi ? (L.knee + L.calfPeak) * 0.52 : L.knee + 0.03
  const flare = isMidi ? 1.38 : 1.28

  const keyPoints: Vector2[] = [
    new Vector2((R.hips + 0.01) * flare * radialScale, hemY),
    new Vector2((R.hips + 0.01) * (1 + (flare - 1) * 0.55) * radialScale, (hemY + L.hip) * 0.5),
    new Vector2((R.hips + 0.01) * 1.06 * radialScale, L.hip),
    new Vector2((R.hips * 0.55 + R.waist * 0.45 + 0.008) * radialScale, (L.hip + L.waist) * 0.5),
    new Vector2((R.waist + 0.006) * 1.02 * radialScale, L.waist + 0.01),
  ]

  const curve = new SplineCurve(keyPoints)
  return curve.getPoints(32)
}
