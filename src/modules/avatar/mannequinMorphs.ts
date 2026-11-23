import type { BodyProfile } from '../../types'
import { NEUTRAL_BASELINE, sanitizeBodyProfile } from './avatarMeasurements'

export type MannequinGender = 'female' | 'male'

export const MANNEQUIN_GLB_PATHS: Record<MannequinGender, string> = {
  female: '/models/fashion-mannequin.glb',
  male: '/models/fashion-mannequin-male.glb',
}
/** Female model; kept for older imports. */
export const MANNEQUIN_GLB_PATH = MANNEQUIN_GLB_PATHS.female

/**
 * Body measurements the unmorphed mesh already has, per model. Morph weights are the
 * difference from these, so a 96 cm chest is "average" on the male form, not oversized.
 * The male figures are estimates for the MakeHuman male-young ideal-proportions base.
 */
const GENDER_BASELINE: Record<MannequinGender, typeof NEUTRAL_BASELINE> = {
  female: NEUTRAL_BASELINE,
  male: { ...NEUTRAL_BASELINE, weight_kg: 64, chest: 96, waist: 82, hips: 96, shoulder: 44 },
}

export const MORPH_INDEX: Record<string, number> = {
  chest_size: 0,
  waist_size: 1,
  hip_size: 2,
  shoulder_width: 3,
  body_mass: 4,
}

export interface MannequinMorphWeights {
  heightScale: number
  chest_size: number
  waist_size: number
  hip_size: number
  shoulder_width: number
  body_mass: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Converts a validated BodyProfile into bounded glTF morph target weights and height scaling
 * for the MakeHuman HM08 Fashion Mannequin GLB asset (/models/fashion-mannequin.glb).
 */
export function computeMannequinMorphWeights(
  rawProfile?: Partial<BodyProfile> | null,
  gender: MannequinGender = 'female'
): MannequinMorphWeights {
  const p = sanitizeBodyProfile(rawProfile)
  const base = GENDER_BASELINE[gender]

  const heightScale = p.height_cm / base.height_cm

  // Normalize circumference deltas relative to the chosen model's own baseline
  const chestDelta = (p.chest - base.chest) / 28
  const waistDelta = (p.waist - base.waist) / 26
  const hipDelta = (p.hips - base.hips) / 28
  const shoulderDelta = (p.shoulder - base.shoulder) / 9

  const hMeters = p.height_cm / 100
  const bmi = p.weight_kg / (hMeters * hMeters)
  const baseH = base.height_cm / 100
  const baseBmi = base.weight_kg / (baseH * baseH)
  const bmiDelta = (bmi - baseBmi) / 8.5

  return {
    heightScale: clamp(heightScale, 0.80, 1.28),
    chest_size: clamp(chestDelta, -0.85, 1.45),
    waist_size: clamp(waistDelta, -0.85, 1.50),
    hip_size: clamp(hipDelta, -0.85, 1.45),
    shoulder_width: clamp(shoulderDelta, -0.90, 1.35),
    body_mass: clamp(bmiDelta, -0.75, 1.30),
  }
}
