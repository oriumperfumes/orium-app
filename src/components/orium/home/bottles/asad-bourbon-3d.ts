/**
 * Lattafa Asad Bourbon (100 ml) em 3D — o modelo feito no Blender pelo dono
 * (corpo em laca conhaque acetinada, faixas de ouro facetado, medalhão com o
 * leão cunhado em relevo, caligrafia, ASAD / BOURBON, Lattafa e tampa).
 *
 * O arquivo fica em `public/3d/asad-bourbon.glb`, já comprimido para o
 * celular (meshopt + malha quantizada + textura WebP; a moeda em relevo foi
 * simplificada de 245 mil para ~37 mil triângulos). Só baixa quando o card
 * chega perto da tela, junto com este código.
 *
 * No Blender o modelo está em metros; aqui vira milímetros (como o estúdio),
 * com a base em y = 0, centralizado e a frente (o medalhão) virada para +z.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export const ASAD_GLB = "/3d/asad-bourbon.glb";

/** medidas do modelo em mm (largura, profundidade, altura) */
export const ASAD_SIZE = { W: 70.1, D: 67.2, H: 158.9, total: 158.9, frame: 1.3 };

export async function buildAsadBourbon(): Promise<THREE.Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(ASAD_GLB);
  const model = gltf.scene;
  model.scale.setScalar(1000);
  model.updateMatrixWorld(true);
  // centraliza no eixo de giro e apoia a base na mesa
  const box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  const group = new THREE.Group();
  group.name = "Asad Bourbon";
  group.add(model);
  return group;
}
