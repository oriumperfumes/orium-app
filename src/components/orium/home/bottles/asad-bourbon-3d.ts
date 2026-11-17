/**
 * Lattafa Asad Bourbon (100 ml) em 3D — fiel ao frasco real.
 *
 * SEÇÃO: triângulo de cantos bem arredondados, tirado do contorno da tampa
 * fotografada de cima (série de cossenos; o termo de 3ª harmônica domina).
 * A FRENTE é o lado reto (caligrafia, moeda, ASAD/BOURBON); as COSTAS são a
 * ponta do triângulo. Profundidade ≈ 0,97 da largura. Tudo (corpo, faixa,
 * anel, tampa e fitas) segue esse mesmo contorno.
 *
 * ALTURAS (mm, base em y = 0), medidas na foto de frente com a largura do
 * ombro (50 mm) como régua:
 *   133,5 ┬ filete dourado no topo da tampa; topo terracota com o logo Lattafa
 *   129   ┤ tampa terracota acetinada (borda de baixo arredondada)
 *   103   ┤ anel escuro do gargalo (mais estreito)
 *    98,4 ┤ faixa dourada no topo do corpo
 *    93,6 ┤ corpo terracota acetinado: cheio até ~56 mm, afinando até o pé
 *          · "أسد" (caligrafia do próprio frasco, vetorizada do vídeo 4K)
 *    54   ┤ · moeda Ø 21 na frente (face rosé com a grega e o leão)
 *          · duas fitas douradas grossas: juntas na moeda (frente), abertas
 *            nos lados e se encostando na ponta das costas
 *    34   ┤ · "ASAD / BOURBON" (Cinzel, OFL) e "Lattafa"
 *     0   ┴ pé
 */
import * as THREE from "three";
import glyphs from "./asad-bourbon-glyphs.json";

type GlyphText = { w: number; top: number; bot: number; s: { o: number[][]; h: number[][][] }[] };

export const ASAD_SIZE = { W: 50, D: 48.5, H: 133.5, total: 133.5, frame: 1.3 };

const BODY_H = 93.6;
const SEG = 200;

/* ───────── seção: raio relativo por ângulo (0 = frente, +π/2 = +x) ─────────
   série de cossenos do contorno real, normalizada pela meia-largura (= 1) */
const SECTION = [
  0.96372, 0.00123, 0.00053, -0.09415, 0.00549, -0.00089, 0.00075, -0.00034, -0.00079, 0.00014,
  0.00054,
];
const sec = (phi: number) => SECTION.reduce((s, a, k) => s + a * Math.cos(k * phi), 0);
/** ponto da seção (x, z) com meia-largura `hw` */
const secXZ = (phi: number, hw: number): [number, number] => {
  const r = sec(phi) * hw;
  return [Math.sin(phi) * r, Math.cos(phi) * r];
};
/** normal para fora da seção no ângulo phi (no plano xz) */
const secN = (phi: number): [number, number] => {
  const e = 1e-3;
  const [x0, z0] = secXZ(phi - e, 1),
    [x1, z1] = secXZ(phi + e, 1);
  const tx = x1 - x0,
    tz = z1 - z0;
  const l = Math.hypot(tx, tz) || 1;
  return [-tz / l, tx / l]; // gira a tangente: aponta para fora
};
/* comprimento de arco da seção unitária a partir da frente (para colar textos) */
const ARC = (() => {
  const n = 2000,
    phis: number[] = [],
    arcs: number[] = [];
  let acc = 0,
    [px, pz] = secXZ(-Math.PI, 1);
  for (let i = 0; i <= n; i++) {
    const p = -Math.PI + (2 * Math.PI * i) / n;
    const [x, z] = secXZ(p, 1);
    acc += Math.hypot(x - px, z - pz);
    phis.push(p);
    arcs.push(acc);
    px = x;
    pz = z;
  }
  const a0 = arcs[n / 2]!;
  return { phis, arcs: arcs.map((a) => a - a0) };
})();
/** ângulo da seção onde o arco (em unidades de meia-largura) vale `s` */
const phiAtArc = (s: number) => {
  const { phis, arcs } = ARC;
  let lo = 0,
    hi = arcs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcs[mid]! < s) lo = mid;
    else hi = mid;
  }
  const t = (s - arcs[lo]!) / Math.max(1e-9, arcs[hi]! - arcs[lo]!);
  return phis[lo]! + (phis[hi]! - phis[lo]!) * t;
};

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** meia-largura do corpo na altura y (medida na foto): cheio em cima, afina até o pé */
const bodyHW = (y: number) => 21.2 + 3.8 * sstep(0, 56, y);

/**
 * "Torno" com a seção triangular: cada ponto do perfil (meia-largura, altura)
 * vira um anel com o contorno real. Fecha em cima/embaixo quando hw = 0.
 */
function shapedLathe(profile: [number, number][], seg = SEG) {
  const verts: number[] = [];
  const idx: number[] = [];
  const P = profile.length;
  for (const [hw, y] of profile) {
    for (let i = 0; i < seg; i++) {
      const [x, z] = secXZ((i / seg) * Math.PI * 2, hw);
      verts.push(x, y, z);
    }
  }
  for (let j = 0; j < P - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      const a = j * seg + i,
        b = j * seg + i2,
        c = (j + 1) * seg + i,
        d = (j + 1) * seg + i2;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** perfil de anel com cantos arredondados (para o shapedLathe) */
function ringProfile(
  hw: number,
  y0: number,
  y1: number,
  round: number,
  inner = 3,
): [number, number][] {
  const p: [number, number][] = [[hw - inner, y0]];
  for (let i = 0; i <= 8; i++) {
    const t = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    p.push([hw - round + Math.cos(t) * round, y0 + round + Math.sin(t) * round]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    p.push([hw - round + Math.cos(t) * round, y1 - round + Math.sin(t) * round]);
  }
  p.push([hw - inner, y1]);
  return p;
}

/** formas 2D do texto: escala (sx, sy), centralizado em x, base em y = 0 */
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

/** "cola" um texto plano na superfície: x (mm) vira arco ao longo da seção a partir da frente */
function wrapOnBody(geo: THREE.BufferGeometry, baseY: number, offsetX = 0, lift = 0.06) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offsetX,
      y = pos.getY(i) + baseY;
    const hw = bodyHW(y);
    const phi = phiAtArc(x / hw);
    const [sx, sz] = secXZ(phi, hw);
    const [nx, nz] = secN(phi);
    pos.setXYZ(i, sx + nx * lift, y, sz + nz * lift);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Fita dourada: perfil abaulado (superelipse, largura × espessura) varrido ao
 * redor do corpo, encostado na superfície triangular, com a altura do centro
 * variando pelo ângulo.
 */
function ribbon(yOf: (a: number) => number, width: number, thick: number, steps = 320) {
  const prof: [number, number][] = [];
  const N = 30,
    n = 3.4;
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
    const [x, z] = secXZ(a, bodyHW(y));
    const [nx, nz] = secN(a);
    const off = thick / 2 + 0.1;
    return new THREE.Vector3(x + nx * off, y, z + nz * off);
  };
  for (let st = 0; st < steps; st++) {
    const a = (st / steps) * Math.PI * 2;
    const p = pt(a);
    const tan = pt(a + 0.002)
      .sub(pt(a - 0.002))
      .normalize();
    const [nx, nz] = secN(a);
    const out = new THREE.Vector3(nx, 0, nz);
    const up = new THREE.Vector3().crossVectors(out, tan).normalize();
    const nn = new THREE.Vector3().crossVectors(tan, up).normalize();
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

export function buildAsadBourbon(): THREE.Group {
  const T = glyphs as unknown as Record<
    "asad" | "bourbon" | "lattafa" | "calligraphy" | "logo",
    GlyphText
  >;
  const root = new THREE.Group();

  /* materiais */
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
  const gold = new THREE.MeshPhysicalMaterial({
    color: "#efc066",
    metalness: 1,
    roughness: 0.055,
    envMapIntensity: 1.4,
  });
  const chrome = new THREE.MeshPhysicalMaterial({
    color: "#5f5444",
    metalness: 1,
    roughness: 0.07,
    envMapIntensity: 1.2,
  });
  const foil = new THREE.MeshPhysicalMaterial({
    color: "#f0c879",
    metalness: 1,
    roughness: 0.16,
    envMapIntensity: 1.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  /* corpo */
  {
    const prof: [number, number][] = [[0, 0.6]];
    const fillet = 3.2,
      hb = bodyHW(fillet);
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      prof.push([hb - fillet + Math.sin(t) * fillet, fillet - Math.cos(t) * fillet]);
    }
    for (let i = 1; i <= 40; i++) {
      const y = fillet + ((BODY_H - fillet) * i) / 40;
      prof.push([bodyHW(y), y]);
    }
    prof.push([18, BODY_H], [0, BODY_H]);
    root.add(new THREE.Mesh(shapedLathe(prof), satin));
  }

  /* faixa dourada no topo do corpo e anel escuro do gargalo */
  root.add(new THREE.Mesh(shapedLathe(ringProfile(25.25, BODY_H, 98.4, 1.0)), gold));
  root.add(new THREE.Mesh(shapedLathe(ringProfile(21.6, 98.4, 103, 0.8)), chrome));

  /* tampa: borda de baixo arredondada, filete dourado no topo, topo terracota com o logo */
  {
    const prof: [number, number][] = [
      [0, 103],
      [19.5, 103],
    ];
    const rr = 3.4;
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      prof.push([25.5 - rr + Math.sin(t) * rr, 103 + rr - Math.cos(t) * rr]);
    }
    prof.push([25.5, 129.8]);
    root.add(new THREE.Mesh(shapedLathe(prof), satin));
    // filete dourado arredondado na borda de cima
    root.add(new THREE.Mesh(shapedLathe(ringProfile(25.7, 129.6, 133.5, 1.5, 2.6)), gold));
    // topo terracota (levemente abaixo do filete)
    const topProf: [number, number][] = [
      [0, 133.1],
      [23.4, 133.1],
    ];
    root.add(new THREE.Mesh(shapedLathe(topProf), satin));
    // logo Lattafa dourado no topo, lido de quem está de frente
    const logo = textGeometry(T.logo, 1, 1).translate(0, -T.logo.top / 2, 0);
    logo.rotateX(-Math.PI / 2);
    logo.translate(0, 133.16, 0);
    root.add(new THREE.Mesh(logo, foil));
  }

  /* fitas grossas: juntas na moeda (frente), abertas nos lados, se encostando
     na ponta das costas. Centros medidos na foto de frente (no canto, ±65°:
     68 e 47 mm; na frente: 58,7 e 49,1 mm). */
  const W = 9.6,
    TH = 3.8;
  const k = (a: number) => Math.pow(Math.abs(Math.sin(a)), 0.9);
  const center = (a: number) => 53.9 + 3.6 * k(a);
  // meia-separação: nas costas = meia-largura (as fitas se encostam); na frente
  // um pouco menos (passam por trás da moeda); nos lados, abertas
  const half = (a: number) => W / 2 + 6.0 * k(a) - 0.3 * Math.max(0, Math.cos(a));
  root.add(
    new THREE.Mesh(
      ribbon((a) => center(a) + half(a), W, TH),
      gold,
    ),
  );
  root.add(
    new THREE.Mesh(
      ribbon((a) => center(a) - half(a), W, TH),
      gold,
    ),
  );

  /* moeda na frente (lado reto) */
  {
    const yc = 53.7,
      R = 10.5;
    const coin = new THREE.Group();
    const front = secXZ(0, bodyHW(yc))[1];
    coin.position.set(0, yc, front + TH + 1.7);
    coin.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3.4, 128).rotateX(Math.PI / 2), gold));
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
        metalness: 0.35,
        roughness: 0.38,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2,
        bumpMap: relief,
        bumpScale: 1.4,
        envMapIntensity: 1.3,
      }),
    );
    face.position.z = 1.74;
    coin.add(face);
    root.add(coin);
  }

  /* letras em folha dourada, coladas no lado reto da frente */
  root.add(new THREE.Mesh(wrapOnBody(textGeometry(T.calligraphy, 1, 1.15), 72, -1.8), foil));
  root.add(new THREE.Mesh(wrapOnBody(textGeometry(T.asad, 4.6, 4.6), 34), foil));
  root.add(new THREE.Mesh(wrapOnBody(textGeometry(T.bourbon, 3.1, 3.5), 26.6), foil));
  root.add(new THREE.Mesh(wrapOnBody(textGeometry(T.lattafa, 4.75, 3.7), 20.3), foil));

  return root;
}
