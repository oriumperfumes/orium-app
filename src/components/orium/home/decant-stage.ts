/**
 * Palco 3D dos decants (WebGL2 puro, sem biblioteca): três frasquinhos em
 * escala real — 2, 5 e 10 ml — que o cliente gira com o dedo. O perfume dentro
 * fica sempre nivelado e balança quando o frasco inclina.
 *
 * As medidas (mm) são as mesmas do modelo feito no Higgsfield 3D
 * ("Orium · Decants 2, 5 e 10 ml"): mudar aqui = mudar lá.
 *
 * Só desenha enquanto está na tela e algo se move; parado, não gasta bateria.
 */

export type DecantMl = 2 | 5 | 10;

/** Medidas de cada frasquinho, em milímetros. */
export type VialSpec = {
  ml: DecantMl;
  /** raio externo do vidro */
  R: number;
  /** altura da parte reta do corpo */
  body: number;
  /** altura do ombro (curva até o gargalo) */
  shoulder: number;
  /** raio externo do gargalo */
  neck: number;
  /** espessura da parede e do fundo */
  wall: number;
  base: number;
};

export const VIALS: Record<DecantMl, VialSpec> = {
  2: { ml: 2, R: 6, body: 29, shoulder: 2.2, neck: 3.7, wall: 1, base: 2 },
  5: { ml: 5, R: 8, body: 36, shoulder: 3, neck: 4.6, wall: 1, base: 2.4 },
  10: { ml: 10, R: 10.5, body: 41, shoulder: 4, neck: 5.2, wall: 1.1, base: 2.8 },
};
const NECK_H = 3;
const ORDER: DecantMl[] = [2, 5, 10];

/** altura do líquido (mm, a partir da mesa) para o volume nominal do frasco */
export function fillHeight(v: VialSpec) {
  const r = v.R - v.wall;
  return v.base + (v.ml * 1000) / (Math.PI * r * r);
}
/** altura total do frasquinho com a tampa */
export const totalHeight = (v: VialSpec) => v.body + v.shoulder + NECK_H + 13.5;

/* ───────────────────────── geometria ───────────────────────── */

type Mesh = { vao: WebGLVertexArrayObject; count: number };
type P2 = [number, number];

/** gira um perfil (raio, altura) em torno do eixo → superfície de revolução */
function lathe(profile: P2[], seg = 56) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const n = profile.length;
  // normal do perfil: perpendicular à tangente, apontando para fora
  const pn: P2[] = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)]!;
    const b = profile[Math.min(n - 1, i + 1)]!;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  });
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i]!;
      const [nr, ny] = pn[i]!;
      pos.push(r * sn, y, r * c);
      nor.push(nr * sn, ny, nr * c);
    }
  }
  for (let s = 0; s < seg; s++)
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i;
      const b = (s + 1) * n + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { pos, nor, idx };
}

/** quebra as quinas vivas do perfil (cada canto vira 2 pontos próximos = normais limpas) */
function sharp(points: P2[]): P2[] {
  const out: P2[] = [];
  points.forEach((p, i) => {
    if (i > 0 && i < points.length - 1) {
      const a = points[i - 1]!;
      const b = points[i + 1]!;
      const e = 0.04;
      const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      out.push([p[0] + ((a[0] - p[0]) / la) * e, p[1] + ((a[1] - p[1]) / la) * e]);
      out.push([p[0] + ((b[0] - p[0]) / lb) * e, p[1] + ((b[1] - p[1]) / lb) * e]);
    } else out.push(p);
  });
  return out;
}

/**
 * Quarto de curva entre dois pontos do perfil (cantos arredondados).
 * "r": o raio muda primeiro (fundo → parede). "y": a altura muda primeiro (parede → ombro).
 */
function arc(from: P2, to: P2, first: "r" | "y", steps = 7): P2[] {
  const out: P2[] = [];
  for (let i = 1; i < steps; i++) {
    const a = ((i / steps) * Math.PI) / 2;
    out.push(
      first === "y"
        ? [to[0] + (from[0] - to[0]) * Math.cos(a), from[1] + (to[1] - from[1]) * Math.sin(a)]
        : [from[0] + (to[0] - from[0]) * Math.sin(a), to[1] + (from[1] - to[1]) * Math.cos(a)],
    );
  }
  return out;
}

/** tubinho do borrifador: desce do gargalo até quase o fundo, com uma curva leve */
function tube(v: VialSpec, sides = 8, steps = 14) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const top = v.body + v.shoulder + NECK_H;
  const bottom = v.base + 1.2;
  const reach = v.R - v.wall - 1.4;
  const r = 0.5;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const y = top + (bottom - top) * t;
    const x = reach * Math.pow(t, 2.2);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pos.push(x + nx * r, y, nz * r);
      nor.push(nx, 0, nz);
    }
  }
  const w = sides + 1;
  for (let s = 0; s < steps; s++)
    for (let k = 0; k < sides; k++) {
      const a = s * w + k;
      const b = (s + 1) * w + k;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return { pos, nor, idx };
}

function vialGeometry(v: VialSpec) {
  const yS = v.body; // começo do ombro
  const yN = v.body + v.shoulder; // começo do gargalo
  const yT = yN + NECK_H; // boca
  const ri = v.R - v.wall;
  const ni = v.neck - 0.9;
  const glassOuter: P2[] = [[0, 0] as P2, [v.R - 0.9, 0] as P2]
    .concat(arc([v.R - 0.9, 0], [v.R, 0.9], "r", 5))
    .concat([[v.R, 0.9], [v.R, yS]])
    .concat(arc([v.R, yS], [v.neck, yN], "y"))
    .concat(sharp([[v.neck, yN], [v.neck, yT - 0.5], [v.neck + 0.45, yT - 0.5], [v.neck + 0.45, yT], [ni, yT]]));
  const glassInner: P2[] = [[ni, yT] as P2, [ni, yN + 0.2] as P2]
    .concat(arc([ni, yN + 0.2], [ri, yS - 0.4], "r"))
    .concat([[ri, yS - 0.4], [ri, v.base + 0.9]])
    .concat(arc([ri, v.base + 0.9], [ri - 0.9, v.base], "y", 5))
    .concat([[ri - 0.9, v.base], [0, v.base]]);
  // líquido: ocupa o interior até o ombro; o plano de corte define o nível
  const rl = ri - 0.03;
  const liquid: P2[] = [[0, v.base + 0.02] as P2, [rl - 0.9, v.base + 0.02] as P2]
    .concat(arc([rl - 0.9, v.base + 0.02], [rl, v.base + 0.9], "r", 5))
    .concat([[rl, v.base + 0.9], [rl, yS + v.shoulder * 0.4]]);
  // borrifador
  const c0 = yT - 2.6;
  const collarR = v.neck + 1.7;
  const collar: P2[] = sharp([[v.neck + 0.2, c0], [collarR, c0], [collarR, yT + 4.6], [collarR - 0.9, yT + 5.4], [collarR - 0.9, yT + 6.4], [0, yT + 6.4]]);
  const stemR = v.neck * 0.62;
  const stem: P2[] = sharp([[stemR * 0.55, yT + 6.4], [stemR * 0.55, yT + 8], [stemR, yT + 8], [stemR, yT + 11.6], [stemR - 0.5, yT + 12.1], [0, yT + 12.1]]);
  const capR = collarR - 0.15;
  const cap: P2[] = sharp([[capR, yT + 4.7], [capR, yT + 12.6]])
    .concat(arc([capR, yT + 12.6], [capR - 0.9, yT + 13.5], "y", 5))
    .concat([[capR - 0.9, yT + 13.5], [0, yT + 13.5]]);
  return {
    glassOuter: lathe(glassOuter),
    glassInner: lathe(glassInner),
    liquid: lathe(liquid),
    collar: lathe(collar),
    stem: lathe(stem, 32),
    cap: lathe(cap),
    tube: tube(v),
    nozzleY: yT + 9.9,
    stemR,
    collarY: [c0, yT + 4.6] as P2,
  };
}

/* ───────────────────────── shaders ───────────────────────── */

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uVP;
uniform mat4 uM;
out vec3 vW; out vec3 vN; out vec3 vL;
void main(){
  vec4 w = uM * vec4(aPos,1.0);
  vW = w.xyz; vL = aPos;
  vN = mat3(uM) * aNor;
  gl_Position = uVP * w;
}`;

/** estúdio escuro: uma luz comprida à esquerda (desenha o cilindro), uma caixa
 *  larga à direita, uma de cima, um recorte atrás e o rebatido quente da mesa */
const ENV = `
float band(float x, float c, float w){ float d = abs(x-c); d = min(d, 6.28318-d); return 1.0 - smoothstep(w*0.55, w, d); }
vec3 env(vec3 d){
  float az = atan(d.x, d.z);
  float el = asin(clamp(d.y,-1.0,1.0));
  vec3 c = vec3(0.020) + vec3(0.045)*smoothstep(-0.3,1.0,d.y);
  c += vec3(1.0,0.97,0.92) * 4.2 * band(az,-0.95,0.22) * (1.0 - smoothstep(0.55,0.95,abs(el-0.28)));
  c += vec3(0.95,0.97,1.0) * 1.25 * band(az, 1.10,0.50) * (1.0 - smoothstep(0.35,0.75,abs(el-0.30)));
  c += vec3(1.0) * 1.5 * smoothstep(0.80,0.97,d.y);
  c += vec3(1.0,0.93,0.82) * 2.2 * band(az, 2.75,0.10) * (1.0 - smoothstep(0.45,0.90,abs(el-0.25)));
  c += vec3(0.50,0.27,0.07) * 0.5 * smoothstep(-0.15,-0.9,d.y);
  return c;
}`;

const FS_HEAD = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vL;
uniform vec3 uEye;
uniform float uFade;
out vec4 o;
${ENV}
vec4 pm(vec3 c, float aMin){ c *= uFade; return vec4(c, clamp(max(max(c.r,c.g),max(c.b,aMin*uFade)),0.0,1.0)); }
`;

/** vidro: quase só reflexo; mais forte nas bordas (Fresnel) */
const FS_GLASS = `${FS_HEAD}
uniform float uGain; uniform float uTint;
void main(){
  vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vW);
  float nv = clamp(dot(N,V),0.0,1.0);
  float F = 0.045 + 0.955*pow(1.0-nv,4.2);
  vec3 c = env(reflect(-V,N)) * (F*uGain + 0.035*uGain);
  float edge = pow(1.0-nv,2.6);
  c += vec3(0.75,0.86,0.82) * edge * 0.05 * uGain;
  o = pm(c, edge*0.22 + uTint);
}`;

/** perfume: âmbar luminoso — dourado nas bordas, mais fundo no meio, com a faixa
 *  de luz que o líquido concentra (ele age como lente) do lado oposto à luz */
const FS_LIQUID = `${FS_HEAD}
uniform vec4 uPlane;     // plano do nível, em mundo (normal, d)
uniform float uSurface;  // 1 = passada da superfície (faces de trás)
void main(){
  float h = dot(uPlane.xyz, vW) + uPlane.w;
  if(h > 0.0) discard;
  vec3 V = normalize(uEye - vW);
  vec3 deep = vec3(0.60,0.215,0.015);
  vec3 mid  = vec3(0.86,0.43,0.045);
  vec3 gold = vec3(1.0,0.70,0.22);
  if(uSurface > 0.5){
    // olhando para dentro do corte: é a superfície do perfume
    vec3 N = normalize(uPlane.xyz);
    float nv = clamp(dot(N,V),0.0,1.0);
    float F = 0.03 + 0.97*pow(1.0-nv,5.0);
    vec3 c = mix(mid, gold, 0.55) * (0.62 + 0.5*nv) + env(reflect(-V,N))*F*0.8;
    o = pm(c, 0.97); return;
  }
  vec3 N = normalize(vN);
  float nv = clamp(dot(N,V),0.0,1.0);
  // caminho da luz dentro do líquido: longo no meio (mais fundo), curto na borda (dourado)
  vec3 body = mix(gold, mix(mid, deep, smoothstep(0.55,1.0,nv)), smoothstep(0.0,0.62,nv));
  // lente: a luz da esquerda sai concentrada numa faixa à direita
  float s = dot(N, normalize(vec3(0.78,0.05,0.62)));
  float lens = smoothstep(0.50,0.80,s) * (1.0 - smoothstep(0.86,0.995,s));
  float soft = 0.5 + 0.5*dot(N, normalize(vec3(-0.6,0.3,0.7)));
  vec3 c = body * (0.66 + 0.30*soft) + gold * lens * 0.62;
  // reflexo da luz comprida também aparece no líquido (atrás do vidro)
  c += env(reflect(-V,N)) * 0.05;
  // brilho do menisco, logo abaixo do nível
  c += gold * 0.42 * smoothstep(-1.0, 0.0, h);
  // fundo: o vidro grosso junta luz
  c += gold * 0.30 * (1.0 - smoothstep(0.0, 2.6, vL.y - uPlane.w*0.0 - 2.2));
  o = pm(c, 0.94);
}`;

/** plástico do borrifador: translúcido leitoso (anel) ou branco (pino) */
const FS_PLASTIC = `${FS_HEAD}
uniform vec3 uColor; uniform float uAlpha; uniform float uRibs; uniform vec2 uRibY; uniform vec3 uNozzle;
void main(){
  vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vW);
  float ang = atan(vL.x, vL.z);
  float rib = 1.0;
  if(uRibs > 0.0 && vL.y > uRibY.x + 0.4 && vL.y < uRibY.y - 0.3) rib = 0.74 + 0.26*sin(ang * uRibs);
  float nv = clamp(dot(N,V),0.0,1.0);
  vec3 L = normalize(vec3(-0.75,0.65,0.55));
  float dif = 0.42 + 0.58*clamp(dot(N,L)*0.5+0.5,0.0,1.0);
  float F = 0.05 + 0.95*pow(1.0-nv,4.0);
  vec3 c = (uColor * dif * 0.62 + env(reflect(-V,N)) * (F*0.55 + 0.04)) * rib;
  // furinho do borrifo
  if(uNozzle.z > 0.0){
    float d = length(vec2((abs(ang) ) * uNozzle.z, vL.y - uNozzle.y));
    c *= 0.25 + 0.75*smoothstep(0.35, 0.75, d);
  }
  o = pm(c, uAlpha);
}`;

/** mesa: sombra de contato e a luz âmbar que atravessa o perfume */
const VS_FLOOR = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uVP; uniform vec3 uC; uniform float uS;
out vec2 vU;
void main(){ vU = aPos.xz; gl_Position = uVP * vec4(uC + aPos*uS, 1.0); }`;
const FS_FLOOR = `#version 300 es
precision highp float;
in vec2 vU; uniform float uFade; uniform float uFill;
out vec4 o;
void main(){
  float r = length(vU);
  float contact = (1.0 - smoothstep(0.16, 0.42, r)) * 0.55;
  // a luz vem da esquerda: a mancha dourada cai para a direita
  vec2 q = vU - vec2(0.30, -0.06);
  float glow = exp(-dot(q*vec2(1.5,2.0), q*vec2(1.5,2.0)) * 3.2) * uFill;
  vec3 c = vec3(1.0,0.56,0.13) * glow * 0.42 * uFade;
  o = vec4(c, clamp(contact*uFade + max(c.r,c.g), 0.0, 1.0));
}`;

/* ───────────────────────── matrizes ───────────────────────── */

type M4 = Float32Array;
const m4 = () => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
function mul(a: M4, b: M4) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return o;
}
function perspective(fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function lookAt(e: number[], t: number[]) {
  const z = norm([e[0]! - t[0]!, e[1]! - t[1]!, e[2]! - t[2]!]);
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  const m = m4();
  m[0] = x[0]!; m[4] = x[1]!; m[8] = x[2]!;
  m[1] = y[0]!; m[5] = y[1]!; m[9] = y[2]!;
  m[2] = z[0]!; m[6] = z[1]!; m[10] = z[2]!;
  m[12] = -(x[0]! * e[0]! + x[1]! * e[1]! + x[2]! * e[2]!);
  m[13] = -(y[0]! * e[0]! + y[1]! * e[1]! + y[2]! * e[2]!);
  m[14] = -(z[0]! * e[0]! + z[1]! * e[1]! + z[2]! * e[2]!);
  return m;
}
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};
/** modelo: posição na mesa, giro em Y e inclinação (X e Z) em torno da base */
function model(x: number, z: number, yaw: number, tiltX: number, tiltZ: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX);
  const cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
  const ry = m4(); ry[0] = cy; ry[2] = -sy; ry[8] = sy; ry[10] = cy;
  const rx = m4(); rx[5] = cx; rx[6] = sx; rx[9] = -sx; rx[10] = cx;
  const rz = m4(); rz[0] = cz; rz[1] = sz; rz[4] = -sz; rz[5] = cz;
  const t = m4(); t[12] = x; t[14] = z;
  return mul(t, mul(rz, mul(rx, ry)));
}

/* ───────────────────────── palco ───────────────────────── */

export type DecantStage = {
  /** traz um tamanho para a frente */
  select: (ml: DecantMl) => void;
  /** liga/desliga o desenho (fora da tela = parado) */
  setActive: (on: boolean) => void;
  destroy: () => void;
};

export type StageOptions = {
  initial?: DecantMl;
  onSelect?: (ml: DecantMl) => void;
  /** primeira interação do cliente (para medir uso) */
  onInteract?: () => void;
  reducedMotion?: boolean;
};

type Vial = {
  spec: VialSpec;
  geo: ReturnType<typeof vialGeometry>;
  meshes: Record<"glassOuter" | "glassInner" | "liquid" | "collar" | "stem" | "cap" | "tube", Mesh>;
  x: number; // posição atual na mesa
  focus: number; // 0 = ao lado, 1 = na frente
  yaw: number;
  // inclinação e balanço do líquido
  tx: number; tz: number; vtx: number; vtz: number;
  sx: number; sz: number; vsx: number; vsz: number;
};

const GAP = 30;

/** Monta o palco no canvas. Devolve null se o aparelho não tiver WebGL2. */
export function createDecantStage(canvas: HTMLCanvasElement, opts: StageOptions = {}): DecantStage | null {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "low-power" });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const program = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i)!.name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };

  let pGlass: ReturnType<typeof program>, pLiquid: typeof pGlass, pPlastic: typeof pGlass, pFloor: typeof pGlass;
  try {
    pGlass = program(VS, FS_GLASS);
    pLiquid = program(VS, FS_LIQUID);
    pPlastic = program(VS, FS_PLASTIC);
    pFloor = program(VS_FLOOR, FS_FLOOR);
  } catch {
    return null;
  }

  const upload = (g: { pos: number[]; nor: number[]; idx: number[] }): Mesh => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.nor), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.idx.length };
  };
  const floor = upload({ pos: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], nor: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], idx: [0, 2, 1, 0, 3, 2] });

  let selected = ORDER.indexOf(opts.initial ?? 5);
  const vials: Vial[] = ORDER.map((ml, i) => {
    const spec = VIALS[ml];
    const geo = vialGeometry(spec);
    return {
      spec,
      geo,
      meshes: {
        glassOuter: upload(geo.glassOuter),
        glassInner: upload(geo.glassInner),
        liquid: upload(geo.liquid),
        collar: upload(geo.collar),
        stem: upload(geo.stem),
        cap: upload(geo.cap),
        tube: upload(geo.tube),
      },
      x: (i - selected) * GAP,
      focus: i === selected ? 1 : 0,
      yaw: 0.6 + i * 0.9,
      tx: 0, tz: 0, vtx: 0, vtz: 0,
      sx: 0, sz: 0, vsx: 0, vsz: 0,
    };
  });

  /* ── estado ── */
  let active = false;
  let raf = 0;
  let last = 0;
  let w = 0, h = 0;
  let spin = 0; // velocidade de giro (inércia)
  let targetTx = 0, targetTz = 0;
  let dragging = false;
  let idleT = 0;
  let settle = 2.5; // segundos de animação restantes depois de mexer
  let interacted = false;
  const reduced = !!opts.reducedMotion;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width * dpr));
    const nh = Math.max(1, Math.round(r.height * dpr));
    if (nw !== w || nh !== h) {
      w = canvas.width = nw;
      h = canvas.height = nh;
      wake(0.2);
    }
  };

  const camera = () => {
    const aspect = w / h;
    const fov = (20 * Math.PI) / 180;
    // enquadra a altura do maior frasco e, em telas estreitas, os três lado a lado
    const needH = 76;
    const needW = GAP * 2 + 34;
    const dist = Math.max(needH / 2 / Math.tan(fov / 2), needW / 2 / Math.tan(fov / 2) / aspect);
    const eye = [0, 31 + dist * 0.2, dist];
    const vp = mul(perspective(fov, aspect, dist * 0.3, dist * 3), lookAt(eye, [0, 29, 0]));
    return { vp, eye };
  };

  const useP = (prog: ReturnType<typeof program>, cam: ReturnType<typeof camera>, fade: number, M?: M4) => {
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u["uVP"]!, false, cam.vp);
    if (M) gl.uniformMatrix4fv(prog.u["uM"]!, false, M);
    if (prog.u["uEye"]) gl.uniform3fv(prog.u["uEye"], cam.eye);
    gl.uniform1f(prog.u["uFade"]!, fade);
  };
  const draw = (m: Mesh) => {
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
  };

  const render = () => {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const cam = camera();

    // de trás para frente
    const order = vials.map((v, i) => i).sort((a, b) => vials[a]!.focus - vials[b]!.focus);
    for (const i of order) {
      const v = vials[i]!;
      const z = (v.focus - 1) * 16;
      const fade = 0.42 + 0.58 * v.focus;
      const M = model(v.x, z, v.yaw, v.tx, v.tz);

      // mesa
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(pFloor.p);
      gl.uniformMatrix4fv(pFloor.u["uVP"]!, false, cam.vp);
      gl.uniform3f(pFloor.u["uC"]!, v.x, 0, z);
      gl.uniform1f(pFloor.u["uS"]!, v.spec.R * 3.4);
      gl.uniform1f(pFloor.u["uFade"]!, fade);
      gl.uniform1f(pFloor.u["uFill"]!, 1);
      draw(floor);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE);

      // 1. vidro de trás
      gl.depthMask(false);
      gl.cullFace(gl.FRONT);
      useP(pGlass, cam, fade, M);
      gl.uniform1f(pGlass.u["uGain"]!, 0.42);
      gl.uniform1f(pGlass.u["uTint"]!, 0.0);
      draw(v.meshes.glassOuter);

      // 2. tubinho
      gl.disable(gl.CULL_FACE);
      useP(pPlastic, cam, fade, M);
      gl.uniform3f(pPlastic.u["uColor"]!, 0.95, 0.93, 0.88);
      gl.uniform1f(pPlastic.u["uAlpha"]!, 0.5);
      gl.uniform1f(pPlastic.u["uRibs"]!, 0);
      gl.uniform3f(pPlastic.u["uNozzle"]!, 0, 0, 0);
      draw(v.meshes.tube);
      gl.enable(gl.CULL_FACE);

      // 3. perfume (o plano do nível fica sempre na horizontal do mundo, com o balanço)
      const up = norm([v.sx, 1, v.sz]);
      const fh = fillHeight(v.spec);
      const p0 = [M[4]! * fh + M[12]!, M[5]! * fh + M[13]!, M[6]! * fh + M[14]!];
      useP(pLiquid, cam, fade, M);
      gl.uniform4f(pLiquid.u["uPlane"]!, up[0]!, up[1]!, up[2]!, -(up[0]! * p0[0]! + up[1]! * p0[1]! + up[2]! * p0[2]!));
      // primeiro as faces de trás (viram a superfície onde a frente foi cortada), depois a frente
      gl.depthMask(false);
      gl.cullFace(gl.FRONT);
      gl.uniform1f(pLiquid.u["uSurface"]!, 1);
      draw(v.meshes.liquid);
      gl.depthMask(true);
      gl.cullFace(gl.BACK);
      gl.uniform1f(pLiquid.u["uSurface"]!, 0);
      draw(v.meshes.liquid);

      // 4. parede interna do vidro
      gl.depthMask(false);
      useP(pGlass, cam, fade, M);
      gl.uniform1f(pGlass.u["uGain"]!, 0.30);
      gl.uniform1f(pGlass.u["uTint"]!, 0.0);
      gl.cullFace(gl.FRONT);
      draw(v.meshes.glassInner);

      // 5. borrifador: pino branco, anel leitoso com frisos, tampa transparente
      gl.depthMask(true);
      gl.cullFace(gl.BACK);
      useP(pPlastic, cam, fade, M);
      gl.uniform3f(pPlastic.u["uColor"]!, 1.5, 1.48, 1.42);
      gl.uniform1f(pPlastic.u["uAlpha"]!, 1);
      gl.uniform1f(pPlastic.u["uRibs"]!, 0);
      gl.uniform3f(pPlastic.u["uNozzle"]!, 0, v.geo.nozzleY, v.geo.stemR);
      draw(v.meshes.stem);
      gl.depthMask(false);
      gl.uniform3f(pPlastic.u["uColor"]!, 0.90, 0.87, 0.80);
      gl.uniform1f(pPlastic.u["uAlpha"]!, 0.62);
      gl.uniform1f(pPlastic.u["uRibs"]!, 34);
      gl.uniform2f(pPlastic.u["uRibY"]!, v.geo.collarY[0], v.geo.collarY[1]);
      gl.uniform3f(pPlastic.u["uNozzle"]!, 0, 0, 0);
      gl.cullFace(gl.FRONT);
      draw(v.meshes.collar);
      gl.cullFace(gl.BACK);
      draw(v.meshes.collar);
      useP(pGlass, cam, fade, M);
      gl.uniform1f(pGlass.u["uGain"]!, 0.5);
      gl.uniform1f(pGlass.u["uTint"]!, 0.03);
      gl.cullFace(gl.FRONT);
      draw(v.meshes.cap);
      gl.cullFace(gl.BACK);
      gl.uniform1f(pGlass.u["uGain"]!, 1.0);
      gl.uniform1f(pGlass.u["uTint"]!, 0.05);
      draw(v.meshes.cap);

      // 6. vidro da frente
      gl.uniform1f(pGlass.u["uGain"]!, 1.15);
      gl.uniform1f(pGlass.u["uTint"]!, 0.0);
      draw(v.meshes.glassOuter);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  };

  const step = (dt: number) => {
    let moving = false;
    idleT += dt;
    vials.forEach((v, i) => {
      // posição e foco: mola suave até o lugar
      const tx = (i - selected) * GAP;
      const k = 1 - Math.exp(-dt * 7.5);
      v.x += (tx - v.x) * k;
      const tf = i === selected ? 1 : 0;
      v.focus += (tf - v.focus) * k;
      if (Math.abs(tx - v.x) > 0.02 || Math.abs(tf - v.focus) > 0.004) moving = true;

      // giro: o da frente segue o dedo (com inércia); todos giram devagar parados
      const idle = reduced ? 0 : 0.35;
      v.yaw += (i === selected ? spin : 0) * dt + idle * dt * (dragging && i === selected ? 0 : 1);

      // inclinação: mola amortecida até o alvo (só o da frente inclina)
      const gx = i === selected ? targetTx : 0;
      const gz = i === selected ? targetTz + (reduced ? 0 : Math.sin(idleT * 0.9 + i) * 0.035) : 0;
      v.vtx += ((gx - v.tx) * 60 - v.vtx * 11) * dt;
      v.vtz += ((gz - v.tz) * 60 - v.vtz * 11) * dt;
      v.tx += v.vtx * dt;
      v.tz += v.vtz * dt;

      // líquido: a superfície atrasa e balança (mola pouco amortecida)
      const ax = -v.vtz * 0.5 - (tx - v.x) * 0.012;
      const az = v.vtx * 0.5;
      v.vsx += ((ax - v.sx) * 95 - v.vsx * 5.2) * dt;
      v.vsz += ((az - v.sz) * 95 - v.vsz * 5.2) * dt;
      v.sx = Math.max(-0.5, Math.min(0.5, v.sx + v.vsx * dt));
      v.sz = Math.max(-0.5, Math.min(0.5, v.sz + v.vsz * dt));
      if (Math.abs(v.vsx) + Math.abs(v.vsz) + Math.abs(v.vtx) + Math.abs(v.vtz) > 0.003) moving = true;
    });
    if (!dragging) spin *= Math.exp(-dt * 2.2);
    if (Math.abs(spin) > 0.02) moving = true;
    return moving;
  };

  const frame = (t: number) => {
    raf = 0;
    if (!active) return;
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    resize();
    const moving = step(dt);
    render();
    settle = moving || dragging ? 1.2 : settle - dt;
    // com "reduzir movimento", para de desenhar quando tudo assentou
    if (!reduced || settle > 0) raf = requestAnimationFrame(frame);
    else last = 0;
  };
  const wake = (s = 1.2) => {
    settle = Math.max(settle, s);
    if (active && !raf) raf = requestAnimationFrame(frame);
  };

  /* ── dedo / mouse ── */
  let px = 0, py = 0, sx0 = 0, sy0 = 0, moved = false, pid = -1;
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    moved = false;
    pid = e.pointerId;
    px = sx0 = e.clientX;
    py = sy0 = e.clientY;
    spin = 0;
    wake();
  };
  const move = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pid) return;
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    if (!moved && Math.hypot(e.clientX - sx0, e.clientY - sy0) > 6) {
      moved = true;
      try {
        canvas.setPointerCapture(pid);
      } catch {
        /* sem captura: segue pelo evento do canvas */
      }
      if (!interacted) {
        interacted = true;
        opts.onInteract?.();
      }
    }
    if (!moved) return;
    const v = vials[selected]!;
    v.yaw += dx * 0.012;
    spin = spin * 0.6 + (dx * 0.012) / 0.016 * 0.4;
    // arrastar inclina o frasco na direção do dedo
    targetTz = Math.max(-0.42, Math.min(0.42, targetTz - dx * 0.0035));
    targetTx = Math.max(-0.3, Math.min(0.3, targetTx + dy * 0.004));
    wake();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    dragging = false;
    targetTx = 0;
    targetTz = 0;
    if (!moved) {
      // toque simples: escolhe o frasco tocado
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const cam = camera();
      let best = selected, bd = 1e9;
      vials.forEach((v, i) => {
        const cx = (cam.vp[0]! * v.x + cam.vp[12]!) / (cam.vp[3]! * v.x + cam.vp[15]!);
        const d = Math.abs(cx - nx);
        if (d < bd) { bd = d; best = i; }
      });
      if (best !== selected && bd < 0.3) {
        select(ORDER[best]!);
        opts.onSelect?.(ORDER[best]!);
      }
    }
    wake(2);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => wake(0.3)) : null;
  ro?.observe(canvas);
  const lost = (e: Event) => {
    e.preventDefault();
    active = false;
  };
  canvas.addEventListener("webglcontextlost", lost);

  function select(ml: DecantMl) {
    const i = ORDER.indexOf(ml);
    if (i < 0 || i === selected) return;
    selected = i;
    targetTx = 0;
    targetTz = 0;
    // o frasco que chega dá um giro de entrada
    spin = reduced ? 0 : 3.2;
    wake(2);
  }

  return {
    select,
    setActive(on) {
      if (on === active) return;
      active = on;
      last = 0;
      if (on) wake(1.5);
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    destroy() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("webglcontextlost", lost);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
