import { createContext, useContext } from 'react'
import type { MannequinGender } from './mannequinMorphs'

/** Which mannequin model (female or male) the 3D scene and its garments use. */
export const MannequinGenderContext = createContext<MannequinGender>('female')

export const useMannequinGender = () => useContext(MannequinGenderContext)
