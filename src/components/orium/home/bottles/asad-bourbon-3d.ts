/**
 * Lattafa Asad Bourbon (100 ml) em 3D — medidas tiradas da foto de frente do
 * frasco real, com a largura do ombro (Ø 50 mm) como régua (mm, base em y = 0,
 * frente em +z):
 *
 *   133,5 ┬ aro dourado espesso no topo da tampa
 *   129   ┤ tampa terracota acetinada (borda de baixo arredondada)
 *   103   ┤ anel cromado escuro do gargalo (mais estreito)
 *    98,4 ┤ faixa dourada no topo do corpo
 *    93,6 ┤ corpo terracota acetinado: cheio até ~56 mm e afinando até o pé
 *            (Ø 50 → Ø 42), pé arredondado
 *          · "أسد" em caligrafia dourada (Aref Ruqaa)
 *    54   ┤ · moeda Ø 20,5: aro dourado polido + face cobre com a grega e o
 *            leão em relevo (textura tirada do frasco real)
 *          · duas fitas douradas largas e abauladas chegam na moeda por cima e
 *            por baixo e se afastam nas laterais e nas costas
 *    34   ┤ · "ASAD / BOURBON" (Cinzel) e "Lattafa" em dourado
 *     0   ┴ pé
 *
 * Seção redonda (Ø 50). Letras: contornos reais das fontes (OFL), já
 * com o shaping do árabe, aplicados sobre a curvatura do frasco.
 */
import * as THREE from "three";
import glyphs from "./asad-bourbon-glyphs.json";

type GlyphText = { w: number; top: number; bot: number; s: { o: number[][]; h: number[][][] }[] };

export const ASAD_SIZE = { W: 50, D: 50, H: 133.5, total: 133.5 };

const BODY_H = 93.6;
// seção redonda: nas vistas laterais do vídeo a largura é a mesma da frente
const OVAL = 1;
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** raio do corpo na altura y: cheio em cima, afinando de ~56 mm até o pé (medido na foto) */
const bodyR = (y: number) => 21.2 + 3.8 * sstep(0, 56, y);

/** formas 2D do texto: escala (sx, sy) em mm por em, centralizado em x, base em y = 0 */
function textGeometry(t: GlyphText, sx: number, sy: number) {
  const ox = (-t.w * sx) / 2;
  const toV = (p: number[]) => new THREE.Vector2(ox + p[0]! * sx, p[1]! * sy);
  const shapes = t.s.map((s) => {
    const shape = new THREE.Shape(s.o.map(toV));
    shape.holes = s.h.map((h) => new THREE.Path(h.map(toV)));
    return shape;
  });
  return new THREE.ShapeGeometry(shapes);
}

/** "cola" um texto plano na superfície do frasco: x vira ângulo ao redor do eixo */
function wrapOnBody(geo: THREE.BufferGeometry, baseY: number, offsetX = 0, lift = 0.06) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offsetX,
      y = pos.getY(i) + baseY;
    const r = bodyR(y) + lift;
    const a = x / r;
    pos.setXYZ(i, Math.sin(a) * r, y, Math.cos(a) * r);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Fita dourada: perfil abaulado (superelipse, largura × espessura) varrido ao
 * longo de uma volta completa em torno do corpo, com a altura variando pelo
 * ângulo — encostada no corpo (que afina, então o raio acompanha a altura).
 */
function ribbon(yOf: (a: number) => number, width: number, thick: number, steps = 260) {
  const prof: [number, number][] = []; // (u: ao longo da largura, v: para fora)
  const N = 28,
    n = 3.2;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t),
      s = Math.sin(t);
    prof.push([
      Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * (width / 2),
      Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (thick / 2),
    ]);
  }
  const P = prof.length;
  const verts: number[] = [];
  const idx: number[] = [];
  const pt = (a: number) => {
    const y = yOf(a);
    const r = bodyR(y) + thick / 2 + 0.1;
    return new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
  };
  for (let st = 0; st < steps; st++) {
    const a = (st / steps) * Math.PI * 2;
    const p = pt(a);
    const tan = pt(a + 0.002)
      .sub(pt(a - 0.002))
      .normalize();
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const up = new THREE.Vector3().crossVectors(out, tan).normalize(); // na superfície, ~vertical
    const nn = new THREE.Vector3().crossVectors(tan, up).normalize(); // para fora
    for (const [u, v] of prof) {
      verts.push(p.x + up.x * u + nn.x * v, p.y + up.y * u + nn.y * v, p.z + up.z * u + nn.z * v);
    }
  }
  for (let st = 0; st < steps; st++) {
    const s2 = (st + 1) % steps;
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P;
      const a0 = st * P + k,
        a1 = st * P + k2,
        b0 = s2 * P + k,
        b1 = s2 * P + k2;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** perfil de anel (lathe) com cantos arredondados */
function ringProfile(r: number, y0: number, y1: number, round: number, inner = 3) {
  const p: THREE.Vector2[] = [new THREE.Vector2(r - inner, y0)];
  for (let i = 0; i <= 8; i++) {
    const t = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    p.push(new THREE.Vector2(r - round + Math.cos(t) * round, y0 + round + Math.sin(t) * round));
  }
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    p.push(new THREE.Vector2(r - round + Math.cos(t) * round, y1 - round + Math.sin(t) * round));
  }
  p.push(new THREE.Vector2(r - inner, y1));
  return new THREE.LatheGeometry(p, 160);
}

export function buildAsadBourbon(): THREE.Group {
  const T = glyphs as unknown as Record<"asad" | "bourbon" | "lattafa" | "calligraphy", GlyphText>;
  const root = new THREE.Group();
  const oval = new THREE.Group();
  oval.scale.z = OVAL;
  root.add(oval);

  /* materiais */
  // pintura "soft touch" terracota: acetinada, com um brilho aveludado de lado
  const satin = new THREE.MeshPhysicalMaterial({
    color: "#c2602b",
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.38,
    sheen: 0.45,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color("#ffa86e"),
    envMapIntensity: 1.15,
  });
  // dourado espelhado (fitas, aros, borda da moeda)
  const gold = new THREE.MeshPhysicalMaterial({
    color: "#efc066",
    metalness: 1,
    roughness: 0.055,
    envMapIntensity: 1.4,
  });
  // cromado escuro do anel do gargalo
  const chrome = new THREE.MeshPhysicalMaterial({
    color: "#5f5444",
    metalness: 1,
    roughness: 0.07,
    envMapIntensity: 1.2,
  });
  // folha dourada das letras
  const foil = new THREE.MeshPhysicalMaterial({
    color: "#f0c879",
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  /* corpo: perfil de revolução medido (cheio em cima, afina até o pé redondo) */
  {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0.6)];
    const fillet = 3.2;
    const rb = bodyR(fillet);
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      pts.push(
        new THREE.Vector2(rb - fillet + Math.sin(t) * fillet, fillet - Math.cos(t) * fillet),
      );
    }
    for (let i = 1; i <= 40; i++) {
      const y = fillet + ((BODY_H - fillet) * i) / 40;
      pts.push(new THREE.Vector2(bodyR(y), y));
    }
    pts.push(new THREE.Vector2(18, BODY_H));
    oval.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 160), satin));
  }

  /* faixa dourada no topo do corpo e anel cromado do gargalo */
  oval.add(new THREE.Mesh(ringProfile(25.25, BODY_H, 98.4, 1.0), gold));
  oval.add(new THREE.Mesh(ringProfile(21.6, 98.4, 103, 0.8), chrome));

  /* tampa: terracota com a borda de baixo arredondada para dentro + aro dourado */
  {
    const p: THREE.Vector2[] = [new THREE.Vector2(19.5, 103)];
    const rr = 3.4;
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      p.push(new THREE.Vector2(25.5 - rr + Math.sin(t) * rr, 103 + rr - Math.cos(t) * rr));
    }
    p.push(new THREE.Vector2(25.5, 128.6));
    p.push(new THREE.Vector2(23, 128.6));
    oval.add(new THREE.Mesh(new THREE.LatheGeometry(p, 160), satin));
    // aro dourado espesso no topo, com a borda de cima arredondada
    oval.add(new THREE.Mesh(ringProfile(25.7, 128.5, 133.5, 1.6, 4), gold));
    const top = new THREE.Mesh(new THREE.CircleGeometry(22.2, 128).rotateX(-Math.PI / 2), gold);
    top.position.y = 133.2;
    oval.add(top);
  }

  /* fitas: chegam na moeda por cima e por baixo, abrem nas laterais e atrás */
  // medidas da sobreposição com a foto: largas e grossas, bem próximas — a de
  // cima desce íngreme até a moeda, a de baixo é quase reta; nas laterais os
  // centros ficam a ~19 mm um do outro; encostadas no corpo
  const open = (a: number) => Math.pow(Math.abs(Math.sin(a / 2)), 0.85);
  oval.add(
    new THREE.Mesh(
      ribbon((a) => 58.2 + 10.6 * open(a), 9.4, 2.8),
      gold,
    ),
  );
  oval.add(
    new THREE.Mesh(
      ribbon((a) => 49.6 - 3.6 * open(a), 9.4, 2.8),
      gold,
    ),
  );

  /* moeda: aro dourado polido + face cobre com a grega e o leão em relevo */
  {
    const yc = 53.7,
      R = 10.5;
    const coin = new THREE.Group();
    coin.position.set(0, yc, bodyR(yc) + 2.8 + 1.7);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 3.4, 128).rotateX(Math.PI / 2),
      gold,
    );
    coin.add(rim);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(R - 1.05, 1.05, 20, 128), gold);
    bezel.position.z = 1.7;
    coin.add(bezel);
    const loader = new THREE.TextureLoader();
    const color = loader.load("/3d/asad-coin-color.webp");
    color.colorSpace = THREE.SRGBColorSpace;
    color.anisotropy = 8;
    const relief = loader.load("/3d/asad-coin-relief.webp");
    relief.anisotropy = 8;
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(R - 1.9, 128),
      new THREE.MeshPhysicalMaterial({
        map: color,
        // metal rosé acetinado: a cor aparece (não só o reflexo do estúdio)
        metalness: 0.35,
        roughness: 0.38,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        // o desenho dourado fica em relevo e pega a luz do estúdio
        bumpMap: relief,
        bumpScale: 1.4,
        envMapIntensity: 1.3,
      }),
    );
    face.position.z = 1.74; // à frente da tampa do aro, dentro do filete
    coin.add(face);
    oval.add(coin);
  }

  /* letras em folha dourada, coladas na curvatura (o corpo afina ali) */
  // a caligrafia é a do próprio frasco: vetorizada do vídeo 4K (já em mm)
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.calligraphy, 1, 1.15), 72, -1.8), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.asad, 4.6, 4.6), 34), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.bourbon, 3.1, 3.5), 26.6), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.lattafa, 4.75, 3.7), 20.3), foil));

  return root;
}
