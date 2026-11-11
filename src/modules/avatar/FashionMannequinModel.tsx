import { useEffect, useMemo } from 'react'
import { DoubleSide, Mesh, MeshStandardMaterial } from 'three'
import { useGLTF } from '@react-three/drei'
import type { BodyProfile } from '../../types'
import { getMannequinMaterialConfig } from './mannequinMaterials'
import {
  computeMannequinMorphWeights,
  MANNEQUIN_GLB_PATH,
} from './mannequinMorphs'

interface FashionMannequinModelProps {
  profile: BodyProfile
}

// The subdivided body and clothing share the five measurement morphs in the GLB.
export default function FashionMannequinModel({ profile }: FashionMannequinModelProps) {
  const gltf = useGLTF(MANNEQUIN_GLB_PATH)

  const weights = useMemo(() => computeMannequinMorphWeights(profile), [profile])
  const matConfig = useMemo(
    () => getMannequinMaterialConfig(profile.skin_undertone),
    [profile.skin_undertone]
  )

  // Extract the MannequinBody mesh geometry from the multi-mesh GLB scene
  const geometry = useMemo(() => {
    let found: Mesh['geometry'] | null = null
    gltf.scene.traverse(obj => {
      if ((obj as Mesh).isMesh && (obj.name === 'MannequinBody' || !found)) {
        if (obj.name === 'MannequinBody') {
          found = (obj as Mesh).geometry
        } else if (!found) {
          found = (obj as Mesh).geometry
        }
      }
    })
    return found
  }, [gltf.scene])

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: matConfig.color,
        roughness: matConfig.roughness,
        metalness: matConfig.metalness,
        side: DoubleSide,
      }),
    [matConfig]
  )

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  if (!geometry) return null

  return (
    <group
      name='fashion-mannequin-hm08'
      scale={[1, weights.heightScale, 1]}
    >
      <mesh
        geometry={geometry}
        material={material}
        morphTargetInfluences={[
          weights.chest_size,
          weights.waist_size,
          weights.hip_size,
          weights.shoulder_width,
          weights.body_mass,
        ]}
        castShadow
        receiveShadow
      />
    </group>
  )
}

useGLTF.preload(MANNEQUIN_GLB_PATH)
