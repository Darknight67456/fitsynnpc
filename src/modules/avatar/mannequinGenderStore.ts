import { useSyncExternalStore } from 'react'
import type { MannequinGender } from './mannequinMorphs'

// The female/male mannequin choice, shared by the 3D scene and the clothes rail.
const GENDER_KEY = 'fitsync.mannequinGender'
const listeners = new Set<() => void>()

function read(): MannequinGender {
  try {
    return localStorage.getItem(GENDER_KEY) === 'male' ? 'male' : 'female'
  } catch {
    return 'female'
  }
}

let current: MannequinGender = read()

export function setMannequinGender(next: MannequinGender) {
  current = next
  try {
    localStorage.setItem(GENDER_KEY, next)
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useSelectedMannequinGender(): MannequinGender {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
