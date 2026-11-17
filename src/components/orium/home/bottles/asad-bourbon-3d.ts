/**
 * Lattafa Asad Bourbon (100 ml) em 3D — medidas tiradas do vídeo do frasco
 * real, com o corpo (Ø 50 mm) como régua (mm, base em y = 0, frente em +z):
 *
 *   133 ┬ aro dourado espelhado no topo da tampa
 *   129 ┤ tampa caramelo acetinada
 *   103 ┤ anel cromado do gargalo (mais estreito)
 *   100 ┤ faixa dourada no topo do corpo
 *    94 ┤ corpo caramelo acetinado, afinando ~8% até o pé
 *         · "أسد" em caligrafia dourada (Aref Ruqaa)
 *    56 ┤ · duas fitas douradas que se cruzam na frente, na moeda (Ø 19)
 *         · "ASAD / BOURBON" (Cinzel) e "Lattafa" em dourado
 *     0 ┴ pé
 *
 * Seção levemente oval (50 × 44). Letras: contornos reais das fontes (OFL),
 * já com o shaping do árabe, aplicados sobre a curvatura do frasco.
 */
import * as THREE from "three";
import glyphs from "./asad-bourbon-glyphs.json";

type GlyphText = { w: number; top: number; bot: number; s: { o: number[][]; h: number[][][] }[] };

export const ASAD_SIZE = { W: 50, D: 44, H: 133, total: 133 };

const BODY_H = 94.3;
const OVAL = 44 / 50;
/** raio do corpo na altura y (afina ~8% até o pé) */
const bodyR = (y: number) => 23 + 2 * Math.min(1, Math.max(0, y / BODY_H));

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
 * Fita dourada: um perfil retangular de cantos redondos (largura × espessura)
 * varrido ao longo de uma volta completa em torno do corpo, com a altura
 * variando pelo ângulo (as duas fitas se cruzam na frente e abrem atrás).
 */
function ribbon(yOf: (a: number) => number, width: number, thick: number, steps = 220) {
  const prof: [number, number][] = []; // (u: ao longo da largura, v: para fora)
  const segs = 6,
    rr = thick / 2;
  const hw = width / 2 - rr;
  for (let i = 0; i <= segs; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / segs;
    prof.push([hw + Math.cos(t) * rr, Math.sin(t) * rr]);
  }
  for (let i = 0; i <= segs; i++) {
    const t = Math.PI / 2 + (Math.PI * i) / segs;
    prof.push([-hw + Math.cos(t) * rr, Math.sin(t) * rr]);
  }
  const P = prof.length;
  const verts: number[] = [];
  const idx: number[] = [];
  const pt = (a: number) => {
    const y = yOf(a);
    const r = bodyR(y) + thick / 2 + 0.15;
    return new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r);
  };
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    const p = pt(a);
    const tan = pt(a + 0.002).sub(pt(a - 0.002)).normalize();
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const up = new THREE.Vector3().crossVectors(out, tan).normalize(); // na superfície, ~vertical
    const n = new THREE.Vector3().crossVectors(tan, up).normalize(); // para fora
    for (const [u, v] of prof) {
      verts.push(p.x + up.x * u + n.x * v, p.y + up.y * u + n.y * v, p.z + up.z * u + n.z * v);
    }
  }
  for (let s = 0; s < steps; s++) {
    const s2 = (s + 1) % steps;
    for (let k = 0; k < P; k++) {
      const k2 = (k + 1) % P;
      const a0 = s * P + k,
        a1 = s * P + k2,
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

/** face da moeda: marfim com gregas e roseta gravadas em dourado (desenhada aqui, sem imagem) */
function coinFace(): { gold: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.strokeStyle = g.fillStyle = "#fff";
  g.lineCap = "square";
  // dois filetes
  g.lineWidth = 7;
  g.beginPath();
  g.arc(0, 0, 232, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 168, 0, Math.PI * 2);
  g.stroke();
  // grega (meandro) entre os filetes
  const N = 22;
  g.lineWidth = 6;
  for (let i = 0; i < N; i++) {
    g.save();
    g.rotate((i / N) * Math.PI * 2);
    g.beginPath();
    g.moveTo(-14, -180);
    g.lineTo(-14, -218);
    g.lineTo(18, -218);
    g.lineTo(18, -192);
    g.lineTo(0, -192);
    g.lineTo(0, -205);
    g.stroke();
    g.restore();
  }
  // roseta central (juba estilizada): pétalas em duas camadas + miolo
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? 12 : 16,
      r0 = layer ? 52 : 70,
      r1 = layer ? 118 : 150;
    g.lineWidth = layer ? 6 : 4;
    for (let i = 0; i < n; i++) {
      g.save();
      g.rotate(((i + layer * 0.5) / n) * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, -r0);
      g.quadraticCurveTo(26, -(r0 + r1) / 2, 0, -r1);
      g.quadraticCurveTo(-26, -(r0 + r1) / 2, 0, -r0);
      g.stroke();
      g.restore();
    }
  }
  g.beginPath();
  g.arc(0, 0, 38, 0, Math.PI * 2);
  g.fill();
  const gold = new THREE.CanvasTexture(c);
  gold.colorSpace = THREE.NoColorSpace;
  gold.anisotropy = 4;
  const bump = new THREE.CanvasTexture(c);
  bump.anisotropy = 4;
  return { gold, bump };
}

export function buildAsadBourbon(): THREE.Group {
  const T = glyphs as unknown as Record<"asad" | "bourbon" | "lattafa" | "arabic", GlyphText>;
  const root = new THREE.Group();
  const oval = new THREE.Group();
  oval.scale.z = OVAL;
  root.add(oval);

  /* materiais */
  // pintura acetinada "soft touch" caramelo
  const satin = new THREE.MeshPhysicalMaterial({
    color: "#a8703f",
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.32,
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#f6c68c"),
    envMapIntensity: 1.1,
  });
  // dourado espelhado (fitas, aros, moeda)
  const gold = new THREE.MeshPhysicalMaterial({
    color: "#f1c56c",
    metalness: 1,
    roughness: 0.07,
    envMapIntensity: 1.35,
  });
  // dourado do anel do gargalo: mais escuro (cromado com tom ouro)
  const goldDark = new THREE.MeshPhysicalMaterial({
    color: "#a88a55",
    metalness: 1,
    roughness: 0.12,
    envMapIntensity: 1.2,
  });
  // folha dourada das letras: um pouco menos espelhada
  const foil = new THREE.MeshPhysicalMaterial({
    color: "#f0c879",
    metalness: 1,
    roughness: 0.14,
    envMapIntensity: 1.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  /* corpo (perfil de revolução: pé arredondado, afinando para baixo) */
  {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    const rb = bodyR(0),
      fillet = 2.6;
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(rb - fillet + Math.sin(t) * fillet, fillet - Math.cos(t) * fillet));
    }
    for (let i = 1; i <= 24; i++) {
      const y = fillet + ((BODY_H - fillet) * i) / 24;
      pts.push(new THREE.Vector2(bodyR(y), y));
    }
    pts.push(new THREE.Vector2(17, BODY_H));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), satin);
    oval.add(body);
  }

  /* faixa dourada no topo do corpo (bordas arredondadas) */
  const ringProfile = (r: number, y0: number, y1: number, round: number) => {
    const p: THREE.Vector2[] = [new THREE.Vector2(r - 3, y0)];
    for (let i = 0; i <= 6; i++) {
      const t = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      p.push(new THREE.Vector2(r - round + Math.cos(t) * round, y0 + round + Math.sin(t) * round));
    }
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * (Math.PI / 2);
      p.push(new THREE.Vector2(r - round + Math.cos(t) * round, y1 - round + Math.sin(t) * round));
    }
    p.push(new THREE.Vector2(r - 3, y1));
    return new THREE.LatheGeometry(p, 128);
  };
  oval.add(new THREE.Mesh(ringProfile(25.35, 94.3, 100.1, 1.1), gold));
  // anel do gargalo, mais estreito
  oval.add(new THREE.Mesh(ringProfile(18.6, 100.1, 103.1, 0.6), goldDark));

  /* tampa: caramelo acetinado + aro dourado no topo */
  {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(25.4, 25.4, 25.8, 128, 1, true), satin);
    cap.position.y = 103.1 + 25.8 / 2;
    oval.add(cap);
    // fundo da tampa (aparece por baixo, sobre o anel)
    const under = new THREE.Mesh(new THREE.RingGeometry(18.6, 25.4, 96).rotateX(Math.PI / 2), satin);
    under.position.y = 103.1;
    oval.add(under);
    oval.add(new THREE.Mesh(ringProfile(25.55, 128.9, 133, 1.4), gold));
    const top = new THREE.Mesh(new THREE.CircleGeometry(24.2, 96).rotateX(-Math.PI / 2), gold);
    top.position.y = 132.75;
    oval.add(top);
  }

  /* duas fitas douradas: cruzam na frente (na moeda), abrem até 26 mm atrás */
  const yc = 55.6,
    A = 26;
  const open = (a: number) => (A * (1 - Math.cos(a))) / 2;
  oval.add(new THREE.Mesh(ribbon((a) => yc + open(a), 6.2, 2.0), gold));
  oval.add(new THREE.Mesh(ribbon((a) => yc - open(a), 6.2, 2.0), gold));

  /* moeda: aro dourado polido + face marfim com ornamentos dourados */
  {
    const R = 9.5,
      zf = bodyR(yc) + 3.6;
    const coin = new THREE.Group();
    coin.position.set(0, yc, zf);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.8, 96).rotateX(Math.PI / 2), gold);
    coin.add(rim);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(R - 0.9, 0.9, 16, 96), gold);
    bezel.position.z = 1.4;
    coin.add(bezel);
    const { gold: pattern, bump } = coinFace();
    const ivory = new THREE.MeshPhysicalMaterial({
      color: "#efe4cc",
      roughness: 0.42,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      bumpMap: bump,
      bumpScale: -0.6,
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(R - 1.6, 96), ivory);
    face.position.z = 1.42;
    coin.add(face);
    const engr = new THREE.Mesh(
      new THREE.CircleGeometry(R - 1.6, 96),
      new THREE.MeshPhysicalMaterial({
        color: "#c99436",
        metalness: 1,
        roughness: 0.3,
        alphaMap: pattern,
        transparent: true,
        depthWrite: false,
      }),
    );
    engr.position.z = 1.45;
    coin.add(engr);
    oval.add(coin);
  }

  /* letras em folha dourada, coladas na curvatura */
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.arabic, 16.4, 19), 72.5, 1.6), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.asad, 4.7, 4.7), 37.2), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.bourbon, 3.0, 3.25), 30.4), foil));
  oval.add(new THREE.Mesh(wrapOnBody(textGeometry(T.lattafa, 4.6, 3.1), 24.6), foil));

  return root;
}
