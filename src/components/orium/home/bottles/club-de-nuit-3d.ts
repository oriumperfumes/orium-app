/**
 * Armaf Club de Nuit Intense Man (105 ml) em 3D — medidas tiradas da foto de
 * frente e da vista lateral do frasco real, com a tampa como régua (mm): corpo
 * 62 × 38 × 75 (largo e baixo) de vidro preto espelhado com cantos macios;
 * anel do gargalo em dois andares (Ø 31 × 6); tampa preta 32 × 31 × 24,6 com dois
 * brilhantes em diagonal em cada face; medalhão de metal grafite Ø 24 × 4,5 com
 * "ARMAF" e um brilhante, pendurado por corrente; "club de nuit intense man"
 * impresso em prata champanhe na frente e "club de nuit" em relevo nas duas
 * laterais (base das letras voltada para a frente).
 *
 * Letras: contornos reais da fonte Jost (licença OFL), extrudados com chanfro.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import glyphs from "./club-de-nuit-glyphs.json";

type GlyphText = { w: number; s: { o: number[][]; h: number[][][] }[] };

export const CDN_SIZE = { W: 62, D: 38, H: 75, total: 75 + 6.1 + 24.6 };

const W = 62,
  D = 38,
  H = 75;
const RING_H = 6.1;
const CAP = { w: 32.2, h: 24.6, d: 31 };

/** formas 2D do texto: escala (sx, sy) em mm por em, origem na linha de base */
function textShapes(t: GlyphText, sx: number, sy: number) {
  const toV = (p: number[]) => new THREE.Vector2(p[0]! * sx, p[1]! * sy);
  return t.s.map((s) => {
    const shape = new THREE.Shape(s.o.map(toV));
    shape.holes = s.h.map((h) => new THREE.Path(h.map(toV)));
    return shape;
  });
}

/** base (u, v, n) → matriz: u = direção da leitura, v = "para cima" da letra, n = para fora */
function basis(u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, origin: THREE.Vector3) {
  return new THREE.Matrix4().makeBasis(u, v, n).setPosition(origin);
}

/** brilhante: lapidação com coroa e pavilhão de 16 facetas (faces planas), em
 *  engaste polido. Cada faceta aponta para um lado: ao girar, pegam as luzes
 *  do estúdio uma de cada vez e o cristal cintila. */
function crystal(r: number, gem: THREE.Material, bezel: THREE.Material) {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0, -r * 0.62),
    new THREE.Vector2(r * 0.55, -r * 0.3),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r * 0.97, r * 0.1),
    new THREE.Vector2(r * 0.78, r * 0.3),
    new THREE.Vector2(r * 0.5, r * 0.42),
    new THREE.Vector2(0, r * 0.44),
  ];
  const geo = new THREE.LatheGeometry(pts, 16).rotateX(Math.PI / 2);
  // facetas levemente desalinhadas: cada uma reflete uma direção diferente
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k),
      y = pos.getY(k);
    const a = Math.atan2(y, x);
    const wob = 1 + 0.06 * Math.sin(a * 5 + 1.3);
    pos.setXY(k, x * wob, y * wob);
  }
  const stone = new THREE.Mesh(geo.toNonIndexed(), gem);
  stone.geometry.computeVertexNormals();
  g.add(stone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.04, r * 0.14, 8, 28), bezel);
  g.add(ring);
  return g;
}

export function buildClubDeNuit(): THREE.Group {
  const root = new THREE.Group();
  const T = glyphs as unknown as Record<"front" | "intense" | "armaf", GlyphText>;

  /* materiais */
  // vidro preto envernizado: base escura + verniz espelhado
  const glassBlack = new THREE.MeshPhysicalMaterial({
    color: "#050505",
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    specularIntensity: 1,
    ior: 1.52,
    envMapIntensity: 1.35,
  });
  const capBlack = new THREE.MeshPhysicalMaterial({
    color: "#060606",
    roughness: 0.1,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.4,
  });
  const ringMetal = new THREE.MeshPhysicalMaterial({
    color: "#141416",
    metalness: 0.9,
    roughness: 0.26,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
  });
  const gunmetal = new THREE.MeshPhysicalMaterial({
    color: "#2a2b2f",
    metalness: 1,
    roughness: 0.27,
    envMapIntensity: 1.25,
  });
  const gunPolish = new THREE.MeshPhysicalMaterial({
    color: "#9a9ba0",
    metalness: 1,
    roughness: 0.1,
    envMapIntensity: 1.3,
  });
  const champagne = new THREE.MeshPhysicalMaterial({
    color: "#d8ccb3",
    metalness: 1,
    roughness: 0.32,
    envMapIntensity: 1.15,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // cristal: quase espelho, muito brilho e um toque de cor (dispersão) nas facetas
  const gem = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    metalness: 0.85,
    roughness: 0.0,
    envMapIntensity: 4.5,
    flatShading: true,
    iridescence: 0.6,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [200, 600],
  });
  const bezel = new THREE.MeshPhysicalMaterial({
    color: "#c9c9cc",
    metalness: 1,
    roughness: 0.18,
    envMapIntensity: 1.4,
  });

  /* corpo */
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 2.6), glassBlack);
  body.position.y = H / 2;
  root.add(body);

  /* anel do gargalo (dois andares, com caneluras finas no de cima) */
  const ringLow = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.6, 3.4, 72), ringMetal);
  ringLow.position.y = H + 1.7;
  root.add(ringLow);
  const ringTop = new THREE.Mesh(new THREE.CylinderGeometry(14.0, 14.2, 2.7, 72), ringMetal);
  ringTop.position.y = H + 3.4 + 1.35;
  root.add(ringTop);

  /* tampa com brilhantes em diagonal nas quatro faces */
  const cap = new THREE.Mesh(new RoundedBoxGeometry(CAP.w, CAP.h, CAP.d, 5, 1.6), capBlack);
  const capY = H + RING_H + CAP.h / 2;
  cap.position.y = capY;
  root.add(cap);
  const stoneR = 2.15;
  const faces: { n: THREE.Vector3; u: THREE.Vector3; half: number; depth: number }[] = [
    {
      n: new THREE.Vector3(0, 0, 1),
      u: new THREE.Vector3(1, 0, 0),
      half: CAP.w / 2,
      depth: CAP.d / 2,
    },
    {
      n: new THREE.Vector3(1, 0, 0),
      u: new THREE.Vector3(0, 0, -1),
      half: CAP.d / 2,
      depth: CAP.w / 2,
    },
    {
      n: new THREE.Vector3(0, 0, -1),
      u: new THREE.Vector3(-1, 0, 0),
      half: CAP.w / 2,
      depth: CAP.d / 2,
    },
    {
      n: new THREE.Vector3(-1, 0, 0),
      u: new THREE.Vector3(0, 0, 1),
      half: CAP.d / 2,
      depth: CAP.w / 2,
    },
  ];
  for (const f of faces) {
    const inset = 3.9;
    for (const [su, sv] of [
      [-1, 1],
      [1, -1],
    ] as const) {
      const c = crystal(stoneR, gem, bezel);
      const p = f.n
        .clone()
        .multiplyScalar(f.depth + 0.15)
        .add(f.u.clone().multiplyScalar(su * (f.half - inset)));
      c.position.set(p.x, capY + sv * (CAP.h / 2 - inset), p.z);
      c.lookAt(c.position.clone().add(f.n));
      root.add(c);
    }
  }

  /* impressão da frente: "club de nuit" + "intense man" (prata champanhe) */
  {
    const frontM = basis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-W / 2 + 5, 6.1, D / 2 + 0.03),
    );
    const big = new THREE.ShapeGeometry(textShapes(T.front, 6.6, 6.6));
    const small = new THREE.ShapeGeometry(textShapes(T.intense, 3.3, 4.9)).translate(
      6.6 * T.front.w + 1.6,
      0,
      0,
    );
    const geo = mergeGeometries([big, small])!.applyMatrix4(frontM);
    root.add(new THREE.Mesh(geo, champagne));
  }

  /* "club de nuit" em relevo nas laterais (preto brilhante, com chanfro) */
  {
    const em = 13.8;
    const shapes = textShapes(T.front, em, em);
    const extr = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.35,
      bevelEnabled: true,
      bevelThickness: 0.28,
      bevelSize: 0.24,
      bevelSegments: 3,
      curveSegments: 1,
    });
    const len = T.front.w * em;
    const start = (H - len) / 2;
    // base das letras a ~14 mm da quina da frente
    const baseZ = D / 2 - 14;
    // lado esquerdo (x−): lê de baixo para cima
    const left = extr
      .clone()
      .applyMatrix4(
        basis(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(-W / 2 + 0.05, start, baseZ),
        ),
      );
    // lado direito (x+): lê de cima para baixo
    const right = extr
      .clone()
      .applyMatrix4(
        basis(
          new THREE.Vector3(0, -1, 0),
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(W / 2 - 0.05, H - start, baseZ),
        ),
      );
    root.add(new THREE.Mesh(left, glassBlack));
    root.add(new THREE.Mesh(right, glassBlack));
    extr.dispose();
  }

  /* medalhão + corrente */
  {
    const R = 12,
      T2 = 4.5;
    const med = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, T2, 72).rotateX(Math.PI / 2),
      gunmetal,
    );
    med.add(disc);
    // aro polido na borda da face
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.6, 0.55, 10, 72), gunPolish);
    rim.position.z = T2 / 2;
    med.add(rim);
    // "ARMAF" polido em relevo baixo
    const armafEm = 4.7;
    const armaf = new THREE.ExtrudeGeometry(textShapes(T.armaf, armafEm, armafEm), {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.08,
      bevelSegments: 2,
      curveSegments: 1,
    }).translate((-T.armaf.w * armafEm) / 2, -armafEm * 0.34, T2 / 2);
    med.add(new THREE.Mesh(armaf, gunPolish));
    const st = crystal(1.7, gem, bezel);
    st.position.set(R * 0.55, -R * 0.5, T2 / 2 + 0.2);
    med.add(st);
    // argola no topo
    const eye = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.38, 8, 20), gunmetal);
    eye.position.set(0, R + 1.1, 0);
    eye.rotation.y = Math.PI / 2;
    med.add(eye);
    const medY = H - 32;
    med.position.set(0.8, medY, D / 2 + T2 / 2 + 0.25);
    med.rotation.x = -0.04;
    root.add(med);

    // corrente: elos alternados ao longo de uma curva do anel até a argola
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, H + 2.2, 14.6),
      new THREE.Vector3(0, H + 0.9, D / 2 - 2.5),
      new THREE.Vector3(0.2, H - 1.2, D / 2 + 0.9),
      new THREE.Vector3(0.5, H - 9, D / 2 + 1.2),
      new THREE.Vector3(0.8, medY + R + 2.4, D / 2 + T2 / 2 + 0.3),
    ]);
    const linkGeo = new THREE.TorusGeometry(0.62, 0.2, 6, 14).scale(1, 1.55, 1);
    const n = Math.round(path.getLength() / 1.55);
    const links: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = path.getPointAt(t);
      const tan = path.getTangentAt(t).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, tan);
      const twist = new THREE.Quaternion().setFromAxisAngle(tan, i % 2 ? Math.PI / 2 : 0);
      const m = new THREE.Matrix4().compose(p, twist.multiply(q), new THREE.Vector3(1, 1, 1));
      links.push(linkGeo.clone().applyMatrix4(m));
    }
    root.add(new THREE.Mesh(mergeGeometries(links)!, gunmetal));
    linkGeo.dispose();
  }

  return root;
}
