import type { BodyProfile } from '../../types'
import { NEUTRAL_BASELINE, sanitizeBodyProfile } from './avatarMeasurements'

export const MANNEQUIN_GLB_PATH = '/models/fashion-mannequin.glb'

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
  rawProfile?: Partial<BodyProfile> | null
): MannequinMorphWeights {
  const p = sanitizeBodyProfile(rawProfile)

  const heightScale = p.height_cm / NEUTRAL_BASELINE.height_cm

  // Normalize circumference deltas relative to NEUTRAL_BASELINE (88 / 72 / 96 / 38)
  const chestDelta = (p.chest - NEUTRAL_BASELINE.chest) / 28
  const waistDelta = (p.waist - NEUTRAL_BASELINE.waist) / 26
  const hipDelta = (p.hips - NEUTRAL_BASELINE.hips) / 28
  const shoulderDelta = (p.shoulder - NEUTRAL_BASELINE.shoulder) / 9

  const hMeters = p.height_cm / 100
  const bmi = p.weight_kg / (hMeters * hMeters)
  const baseH = NEUTRAL_BASELINE.height_cm / 100
  const baseBmi = NEUTRAL_BASELINE.weight_kg / (baseH * baseH)
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
