import type { BodyProfile } from '../../types'

export interface MannequinMaterialConfig {
  color: string
  roughness: number
  metalness: number
}

/**
 * Studio ivory finish for the 3D fashion mannequin, nudged slightly warmer or
 * cooler to follow the user's skin undertone.
 */
export function getMannequinMaterialConfig(
  undertone: BodyProfile['skin_undertone']
): MannequinMaterialConfig {
  const ivoryTone =
    undertone === 'warm'
      ? '#f4efe6'
      : undertone === 'cool'
      ? '#f2f3f5'
      : '#f3f1ed'

  return {
    color: ivoryTone,
    roughness: 0.47,
    metalness: 0,
  }
}
