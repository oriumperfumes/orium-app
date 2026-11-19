/**
 * Armaf Club de Nuit Intense Man (105 ml) em 3D — o modelo feito no Blender
 * pelo dono: vidro negro laqueado com base fumê, tampa em laca preta com os
 * cristais, gola de metal, corrente com o medalhão ARMAF e as impressões
 * "club de nuit intense man" (frente) e "club de nuit" moldado na lateral.
 *
 * O arquivo fica em `public/3d/club-de-nuit.glb`, já comprimido para o
 * celular (meshopt + malha quantizada, sem simplificar a geometria). Só baixa
 * quando o card chega perto da tela, junto com este código.
 *
 * No Blender o modelo está em metros; aqui vira milímetros (como o estúdio),
 * com a base em y = 0 e centralizado no eixo de giro.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export const CDN_GLB = "/3d/club-de-nuit.glb";

/** medidas do modelo em mm (largura, profundidade com o medalhão, altura) */
export const CDN_SIZE = { W: 62.1, D: 42, H: 105.2, total: 105.2 };

export async function buildClubDeNuit(): Promise<THREE.Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(CDN_GLB);
  const model = gltf.scene;
  model.scale.setScalar(1000);
  model.updateMatrixWorld(true);
  // centraliza no eixo de giro e apoia a base na mesa
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  const group = new THREE.Group();
  group.name = "Club de Nuit Intense Man";
  group.add(model);
  return group;
}
