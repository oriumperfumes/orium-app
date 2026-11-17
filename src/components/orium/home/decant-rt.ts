/**
 * DECANT EM TEMPO REAL — vidro, perfume e física de líquido traçados por raio,
 * pixel a pixel, na placa de vídeo do próprio celular (WebGL2, sem biblioteca).
 *
 * Nada aqui é foto ou vídeo: cada quadro calcula a luz atravessando o vidro
 * (refração e reflexo de Fresnel), a cor do perfume pela espessura de líquido
 * atravessada (lei de Beer-Lambert), o reflexo do frasco na mesa e o brilho
 * âmbar que a luz de trás projeta no chão. O nível do perfume é um plano que
 * quer ficar na horizontal do mundo: quando o frasco inclina ou é arrastado,
 * uma mola amortecida faz a superfície balançar, ondular e assentar.
 *
 * Medidas em milímetros, iguais às do modelo de estúdio (2, 5 e 10 ml).
 */

export type DecantMl = 2 | 5 | 10;

/**
 * Medidas reais (mm) dos decants da Orium, tiradas das fotos do estoque:
 * o de 10 ml é o frasco largo; 5 ml e 2 ml usam o MESMO frasco fino — o de
 * 2 ml só tem menos perfume (menos da metade). Vidro reto de ombro chato,
 * gargalo curto, rosca de plástico transparente canelada, atuador e tampa
 * de plástico leitoso, tubinho flexível curvado dentro.
 */
type Spec = {
  R: number; H: number; corner: number; neck: number; wall: number; base: number;
  collarR: number; collarH: number; actH: number; capH: number;
  tubeA: number; tubeR: number;
};

const WIDE: Spec = { R: 11, H: 36, corner: 2.0, neck: 6.6, wall: 1.1, base: 3.4, collarR: 7.6, collarH: 8.5, actH: 9, capH: 19, tubeA: 1.7, tubeR: 0.7 };
const SLIM: Spec = { R: 8.3, H: 37, corner: 1.7, neck: 5.3, wall: 1.0, base: 3.0, collarR: 6.2, collarH: 7.5, actH: 8.5, capH: 17, tubeA: 1.15, tubeR: 0.55 };

export const DECANT_SPECS: Record<DecantMl, Spec> = { 2: SLIM, 5: SLIM, 10: WIDE };

/** cor do perfume: absorção por mm (R, G, B) — âmbar, rosé e champanhe */
const SIGMA: Record<DecantMl, [number, number, number]> = {
  10: [0.008, 0.085, 0.34],
  5: [0.003, 0.034, 0.024],
  2: [0.003, 0.011, 0.05],
};

const NECK_H = 2.2;

/** Altura do perfume para o volume real (cilindro interno), sem passar do ombro. */
function fillOf(ml: DecantMl, s: Spec) {
  const r = s.R - s.wall;
  return Math.min(s.base + (ml * 1000) / (Math.PI * r * r), s.H - 1.3 - 0.45);
}

/* ─────────────────────────────── shaders ─────────────────────────────── */

const VS = `#version 300 es
in vec2 aP; out vec2 vUv;
void main(){ vUv = aP*0.5+0.5; gl_Position = vec4(aP,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform vec2 uRes;
uniform vec3 uEye; uniform mat3 uCam; uniform float uFocal;
uniform mat3 uRot;          // local -> mundo (rotação do frasco)
uniform vec3 uPivot;        // base do frasco no mundo
uniform vec4 uA;            // R, H (topo do ombro), raio da quina, raio do gargalo
uniform vec4 uB;            // parede, fundo, nível do perfume, yT (boca)
uniform vec3 uLiqN;         // normal do perfume, no espaço do frasco
uniform vec4 uWave;         // amplitude, número de onda, fase, direção
uniform vec3 uBg;           // cor do card (linear)
uniform sampler2D uLabel;
uniform float uLabelOn;
uniform vec3 uSigma;        // absorção do perfume por mm
uniform vec4 uC;            // raio da rosca, altura da rosca, altura do atuador, altura da tampa
uniform vec2 uTube;         // curvatura e raio do tubinho
uniform float uCap;         // 0 = tampado, 1 = tampa fora

#define AIR 0
#define GLASS 1
#define CAV 2
#define LIQ 3
#define SOLID 4
#define PLAS 5

float sdBox2(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }
float smin(float a, float b, float k){ float h = max(k-abs(a-b),0.)/k; return min(a,b) - h*h*k*0.25; }

float outerS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float H = uA.y, yT = uB.w;
  float body = sdBox2(q - vec2(0., H*0.5), vec2(uA.x, H*0.5), uA.z);
  float neck = sdBox2(q - vec2(0., (H - 1. + yT)*0.5), vec2(uA.w, (yT - H + 1.)*0.5), 0.4);
  return smin(body, neck, 0.9);
}
float innerS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float H = uA.y, w = uB.x, b = uB.y, top = H - 1.3;
  float body = sdBox2(q - vec2(0., (b + top)*0.5), vec2(uA.x - w, (top - b)*0.5), max(uA.z - w, 0.6));
  float yN = uB.w + 6.;
  float neck = sdBox2(q - vec2(0., (top - 1. + yN)*0.5), vec2(uA.w - 1.05, (yN - top + 1.)*0.5), 0.2);
  return smin(body, neck, 0.7);
}
// tubinho flexível: desce curvando e encosta no fundo
vec2 tubeC(float y){
  float t = clamp((y - uB.y)/(uA.y - uB.y), 0., 1.);
  float k = 1. - t;
  return vec2(uTube.x*sin(t*2.6 + 0.5)*(0.3 + 0.9*k*k), uTube.x*0.45*sin(t*1.9 + 1.2)*k);
}
float rodS(vec3 p){
  float y0 = uB.y + 0.35, y1 = uA.y + 0.5;
  float d = (length(p.xz - tubeC(p.y)) - uTube.y)*0.8;
  return max(d, max(y0 - p.y, p.y - y1));
}
float surfS(vec3 p){
  float r = length(p.xz);
  float ri = uA.x - uB.x;
  vec2 wd = vec2(cos(uWave.w), sin(uWave.w));
  float wave = uWave.x * sin(dot(p.xz, wd)*uWave.y + uWave.z) * (0.4 + 0.6*r/ri);
  float men = 0.32*exp(-max(ri - r, 0.)/0.45);   // menisco subindo na parede
  return dot(p - vec3(0., uB.z, 0.), uLiqN) - wave - men;
}
float liqS(vec3 p){ return max(innerS(p), surfS(p)); }

// alturas do borrifador
float yCol(){ return uA.y + 0.15; }
float yAct(){ return yCol() + uC.y + 1.1; }
// rosca de plástico transparente canelada (meio que refrata)
float collarBox(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float rib = 0.11*(0.5 + 0.5*cos(atan(p.x, p.z)*56.));
  return sdBox2(q - vec2(0., yCol() + uC.y*0.5), vec2(uC.x - rib, uC.y*0.5), 0.5);
}
float collarS(vec3 p){ return max(collarBox(p), -outerS(p)); }
// peças leitosas: anel branco, atuador com o bico, tampa
float ringS(vec3 p){ vec2 q = vec2(length(p.xz), p.y); return sdBox2(q - vec2(0., yCol() + uC.y + 0.5), vec2(uC.x*0.84, 0.6), 0.3); }
float actS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float a = sdBox2(q - vec2(0., yAct() + uC.z*0.5), vec2(uC.x*0.6, uC.z*0.5), 1.3);
  float stem = sdBox2(q - vec2(0., yAct() - 0.2), vec2(uC.x*0.3, 0.8), 0.2);
  return min(a, stem);
}
float capS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float y0 = yCol() + uC.y + 0.25 + uCap*75.;
  return sdBox2(q - vec2(0., y0 + uC.w*0.5), vec2(uC.x - 0.12, uC.w*0.5), 1.0);
}
float solidS(vec3 p){ return min(min(ringS(p), actS(p)), capS(p)); }

int region(vec3 p){
  if (solidS(p) < 0.) return SOLID;
  if (collarS(p) < 0.) return PLAS;
  if (outerS(p) > 0.) return AIR;
  if (innerS(p) > 0. || rodS(p) < 0.) return GLASS;
  if (liqS(p) < 0.) return LIQ;
  return CAV;
}
// distância até a fronteira do meio atual (positiva dentro dele)
float bdist(int m, vec3 p){
  if (m == AIR) return min(min(outerS(p), solidS(p)), collarS(p));
  if (m == PLAS) return min(-collarS(p), solidS(p));
  if (m == GLASS){ float r = rodS(p); return r < 0. ? -r : min(-outerS(p), innerS(p)); }
  if (m == CAV) return min(min(-innerS(p), liqS(p)), min(rodS(p), collarS(p)));
  return min(-liqS(p), rodS(p));
}
vec3 bgrad(int m, vec3 p){
  const vec2 k = vec2(1.,-1.); const float h = 0.0025;
  return normalize(k.xyy*bdist(m,p+k.xyy*h) + k.yyx*bdist(m,p+k.yyx*h) + k.yxy*bdist(m,p+k.yxy*h) + k.xxx*bdist(m,p+k.xxx*h));
}
vec3 sgrad(vec3 p){
  const vec2 k = vec2(1.,-1.); const float h = 0.003;
  return normalize(k.xyy*solidS(p+k.xyy*h) + k.yyx*solidS(p+k.yyx*h) + k.yxy*solidS(p+k.yxy*h) + k.xxx*solidS(p+k.xxx*h));
}
float iorOf(int m){ return m == GLASS ? 1.5 : (m == LIQ ? 1.36 : (m == PLAS ? 1.49 : 1.0)); }

/* estúdio: fundo quase preto, duas softboxes altas nas laterais, uma no teto
   e um painel quente atrás do frasco (é ele que acende o âmbar). s = suavidade */
float box(float az, float c, float w, float el, float e0, float e1, float s){
  float a = 1. - smoothstep(w, w + s, abs(az - c));
  float b = smoothstep(e0 - s, e0, el) * (1. - smoothstep(e1, e1 + s, el));
  return a*b;
}
vec3 env(vec3 d, float s){
  float az = atan(d.x, d.z), el = asin(clamp(d.y, -1., 1.));
  vec3 c = uBg*0.6 + vec3(0.006)*(1. + d.y);
  c += box(az, -1.32, 0.13, el, -0.25, 0.95, 0.03 + s) * vec3(3.4);
  c += box(az, 1.40, 0.09, el, -0.20, 0.85, 0.03 + s) * vec3(2.2);
  c += smoothstep(0.80 - s, 0.86, d.y) * vec3(1.6);
  // painel quente atrás: forte no centro, caindo nas bordas
  c += box(az, 0., 0.32, el, -0.45, 0.75, 0.26 + s) * vec3(1.0, 0.88, 0.70) * (0.55 + 1.5*exp(-az*az*14.));
  c += box(abs(az), 2.75, 0.30, el, 0.0, 0.5, 0.15 + s) * vec3(0.35);   // rebatedor frontal fraco
  return c;
}

float fresnel(float n1, float n2, float c){
  float r0 = (n1-n2)/(n1+n2); r0 *= r0;
  return r0 + (1.-r0)*pow(1.-c, 5.);
}

vec3 L2W(vec3 v){ return uRot * v; }
vec3 W2L(vec3 v){ return v * uRot; }

/* Traça um raio (no espaço do frasco). Retorna cor; hitFloor diz se terminou na mesa. */
vec3 trace(vec3 ro, vec3 rd, bool primary, out bool hitFloor, out vec3 floorP, out vec3 Tout, out int evOut, out vec3 dirOut){
  hitFloor = false; floorP = vec3(0.); Tout = vec3(0.); evOut = 0; dirOut = vec3(0.);
  vec3 col = vec3(0.), T = vec3(1.);
  int m = AIR; vec3 p = ro; int events = 0; float travel = 0.;
  // cilindro envolvente: quem não passa perto do frasco nem marcha
  float bound = uA.x + 2.2, top = yCol() + uC.y + uC.w + uCap*80. + 2.;
  for (int i = 0; i < 220; i++){
    if (m == AIR){
      float d = bdist(AIR, p);
      // chão (plano do mundo y=0) em coordenadas locais: y_w = (uRot*p).y + uPivot.y
      vec3 pw = L2W(p) + uPivot; vec3 dw = L2W(rd);
      float r = length(p.xz);
      bool away = (r > bound + 1. && dot(p.xz, rd.xz) > 0.) || (p.y > top + 2. && rd.y > 0.);
      if (dw.y < 0.){
        float tf = -pw.y / dw.y;
        // atrás do frasco a mesa vira o fundo infinito do estúdio (ciclorama):
        // quem atravessa o vidro enxerga o painel de luz, não o tampo escuro
        bool behind = events > 0 && (pw + dw*tf).z > -uA.x*0.2;
        if (!behind && (tf < d || (away && tf < 1e4))){ hitFloor = true; floorP = pw + dw*tf; Tout = T; evOut = events; dirOut = dw; return col; }
      }
      if (away || travel > 2000.){
        col += T * (primary && events == 0 ? uBg : env(L2W(rd), 0.));
        return col;
      }
      if (d < 0.006){
        int m2 = region(p + rd*0.03);
        if (m2 == SOLID){
          // plástico leitoso (anel, atuador, tampa): reflexo suave + luz de trás atravessando
          vec3 n = L2W(sgrad(p)); vec3 v = L2W(rd); vec3 rf = reflect(v, n);
          float fr = fresnel(1., 1.49, max(dot(-v, n), 0.));
          float dr = ringS(p), da = actS(p), dc = capS(p);
          int part = (dr < da && dr < dc) ? 0 : (da < dc ? 1 : 2);
          vec3 milky = part == 0 ? vec3(0.93, 0.93, 0.92) : vec3(0.86, 0.89, 0.92);
          float trans = part == 0 ? 0.22 : (part == 1 ? 0.5 : 0.62);
          float key = max(dot(n, normalize(vec3(-0.55, 0.65, -0.5))), 0.);
          vec3 c = milky*(0.035 + 0.16*key) + milky*env(v, 0.5)*trans*0.5 + env(rf, part == 2 ? 0.22 : 0.12)*fr*1.3;
          if (part == 1){
            // bico branco do borrifador, virado para a frente
            float ang = atan(p.x, -p.z);
            float nz = 1. - smoothstep(0.9, 1.25, length(vec2(ang*uC.x*0.6, p.y - (yAct() + uC.z - 2.4))));
            c = mix(c, vec3(0.80), nz*0.85);
          }
          col += T * c * (1. - fr*0.3);
          return col;
        }
        vec3 N = L2W(bgrad(AIR, p));   // normal apontando para fora do vidro/plástico
        vec3 v = L2W(rd);
        float c = max(dot(-v, N), 0.);
        float n2 = iorOf(m2 == AIR ? GLASS : m2);
        float F = fresnel(1., n2, c);
        col += T * F * env(reflect(v, N), 0.) * (events == 0 ? 1. : 0.7);
        // estampa ORIUM (tinta branca no vidro), só na face de fora
        if (uLabelOn > 0.5 && m2 != PLAS){
          float ang = atan(p.x, -p.z);
          vec2 uv = vec2(0.5 + ang/1.5, (p.y - uA.y*0.36)/(uA.y*0.26));
          if (uv.x > 0. && uv.x < 1. && uv.y > 0. && uv.y < 1.){
            float a = texture(uLabel, vec2(uv.x, 1.-uv.y)).r;
            float lit = 0.55 + 0.45*max(dot(N, normalize(vec3(-0.6,0.5,-0.6))), 0.);
            // tinta preta serigrafada: fosca, com um brilho leve da luz
            col += T * a * (1.-F) * vec3(0.018) * (0.6 + lit);
            T *= 1. - a*0.995;
          }
        }
        T *= 1. - F;
        rd = W2L(refract(v, N, 1./n2)); m = (m2 == PLAS) ? PLAS : GLASS; p += rd*0.02; events++;
        continue;
      }
      p += rd*d; travel += d;
      continue;
    }
    float d = bdist(m, p);
    if (d < 0.004){
      vec3 nOut = -bgrad(m, p);           // sai do meio atual
      int m2 = region(p + nOut*0.02);
      if (m2 == m) { p += rd*0.01; continue; }
      if (m2 == SOLID){ col += T*vec3(0.75)*env(L2W(rd), 0.5)*0.35; return col; }
      float n1 = iorOf(m), n2 = iorOf(m2);
      vec3 N = -nOut; // normal contra o raio
      float c = max(dot(-rd, N), 0.);
      vec3 tr = refract(rd, N, n1/n2);
      if (dot(tr, tr) < 1e-6){ rd = reflect(rd, N); p += rd*0.02; events++; continue; }
      float F = fresnel(n1, n2, c);
      col += T * F * env(L2W(reflect(rd, N)), 0.02) * 0.55;
      T *= 1. - F;
      rd = tr; m = m2; p += rd*0.02; events++;
      if (events > 14) { col += T * env(L2W(rd), 0.); return col; }
      continue;
    }
    float stepd = max(d, 0.002);
    if (m == LIQ) T *= exp(-uSigma * stepd);
    else if (m == GLASS){
      if (rodS(p) < 0.){ T *= exp(-vec3(0.16) * stepd); col += T*vec3(0.010)*stepd; }   // tubinho leitoso
      else T *= exp(-vec3(0.010, 0.004, 0.008) * stepd);
    }
    else if (m == PLAS) T *= exp(-vec3(0.035, 0.032, 0.028) * stepd);
    p += rd*stepd;
  }
  col += T * env(L2W(rd), 0.);
  return col;
}

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }

// mesa escura: sombra de contato + cáustica âmbar (luz de trás atravessando o perfume)
vec3 floorBase(vec3 fp){
  float r = length(fp.xz), R = uA.x;
  vec3 base = uBg;
  float shadow = 1. - 0.78*exp(-max(r - R*0.92, 0.)/(R*0.5)) * smoothstep(R*4., R*0.6, r);
  vec2 cp = fp.xz - vec2(R*0.15, -R*1.6);
  vec2 e = cp/vec2(R*0.8, R*1.45);
  float caus = exp(-dot(e, e)*1.6);
  float filled = clamp((uB.z - uB.y)/(uA.y*0.6), 0., 1.);
  vec3 c = base*shadow + vec3(1.0, 0.55, 0.16)*caus*0.55*filled;
  float far = smoothstep(R*3., R*9., r);
  return mix(c, uBg, far);
}

void main(){
  vec2 q = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;
  vec3 rdw = normalize(uCam * vec3(q, uFocal));
  vec3 ro = W2L(uEye - uPivot), rd = W2L(rdw);
  bool hf; vec3 fp, Tf, df; int ev;
  vec3 col = trace(ro, rd, true, hf, fp, Tf, ev, df);
  bool bgOnly = false;
  if (hf){
    vec3 c2 = floorBase(fp);
    float r = length(fp.xz), R = uA.x;
    if (ev == 0 && r < R*7.){
      // reflexo do frasco na mesa
      vec3 rr = reflect(df, vec3(0.,1.,0.));
      bool hf2; vec3 fp2, T2, d2; int ev2;
      vec3 refl = trace(W2L(fp + vec3(0.,0.01,0.) - uPivot), W2L(rr), false, hf2, fp2, T2, ev2, d2);
      if (ev2 == 0) refl *= 0.08;   // a mesa reflete o frasco, não o estúdio todo
      float fr = 0.05 + 0.5*pow(1. - max(rr.y, 0.), 5.);
      c2 += refl * fr * exp(-max(r - R, 0.)/(R*2.2));
    }
    col += Tf * c2;
    bgOnly = ev == 0 && r > R*9.;
  }
  vec3 outc = pow(aces(col * 1.05), vec3(1./2.2));
  vec3 bgs = pow(uBg, vec3(1./2.2));
  float isBg = ((!hf && length(col - uBg) < 1e-4) || bgOnly) ? 1. : 0.;
  outColor = vec4(mix(outc, bgs, isBg), 1.);
}`;

/* ─────────────────────────────── matemática ─────────────────────────────── */

type V3 = [number, number, number];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Matriz 3x3 (coluna a coluna, como o WebGL espera) de yaw (Y), depois inclinações em X e Z. */
function rotMat(yaw: number, tx: number, tz: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cx = Math.cos(tx), sx = Math.sin(tx);
  const cz = Math.cos(tz), sz = Math.sin(tz);
  // R = Rz * Rx * Ry
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const Rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  const m = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r]! * b[c * 3 + k]!;
    return o;
  };
  return new Float32Array(m(Rz, m(Rx, Ry)));
}
/** aplica a transposta (mundo -> local) */
function toLocal(M: Float32Array, v: V3): V3 {
  return [
    M[0]! * v[0] + M[1]! * v[1] + M[2]! * v[2],
    M[3]! * v[0] + M[4]! * v[1] + M[5]! * v[2],
    M[6]! * v[0] + M[7]! * v[1] + M[8]! * v[2],
  ];
}

/* ─────────────────────────────── palco ─────────────────────────────── */

export type DecantRT = {
  /** controle manual para gravar prévias (quadro a quadro) */
  preview: { step: (dt: number) => void; push: (x: number, z: number, yawVel?: number) => void; stop: () => void };
  setSize: (ml: DecantMl) => void;
  /** empurrão no líquido (ex.: ao trocar de tamanho) */
  nudge: (strength?: number) => void;
  destroy: () => void;
};

export type DecantRTOptions = {
  ml?: DecantMl;
  /** cor do card em sRGB 0–255 */
  bg?: [number, number, number];
  autoRotate?: boolean;
  onFirstFrame?: () => void;
  onCapChange?: (open: boolean) => void;
};

function labelCanvas(ml: DecantMl) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "600 92px 'Inter', 'Helvetica Neue', Arial, sans-serif";
  // espaçamento largo, como gravação de vidro
  const word = "ORIUM";
  const spacing = 26;
  const widths = [...word].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (word.length - 1);
  let x = 256 - total / 2;
  g.textAlign = "left";
  [...word].forEach((ch, i) => {
    g.fillText(ch, x, 104);
    x += widths[i]! + spacing;
  });
  g.fillRect(206, 168, 100, 3);
  g.textAlign = "center";
  g.font = "500 44px 'Inter', 'Helvetica Neue', Arial, sans-serif";
  g.fillText(`${ml} ml`, 256, 214);
  return c;
}

export function createDecantRT(canvas: HTMLCanvasElement, opts: DecantRTOptions = {}): DecantRT | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  if (!gl) return null;

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("[decant-rt]", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aP");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[decant-rt]", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    res: U("uRes"), eye: U("uEye"), cam: U("uCam"), focal: U("uFocal"), rot: U("uRot"), pivot: U("uPivot"),
    a: U("uA"), b: U("uB"), liqN: U("uLiqN"), wave: U("uWave"), bg: U("uBg"), label: U("uLabel"), labelOn: U("uLabelOn"), sigma: U("uSigma"), c: U("uC"), tube: U("uTube"), cap: U("uCap"),
  };
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uploadLabel = (ml: DecantMl) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas(ml));
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  const bg = (opts.bg ?? [22, 22, 22]).map((c) => Math.pow(c / 255, 2.2)) as V3;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── estado físico ── */
  let ml: DecantMl = opts.ml ?? 5;
  uploadLabel(ml);
  const targetOf = (m: DecantMl) => {
    const sp = DECANT_SPECS[m];
    const [sr, sg, sb] = SIGMA[m];
    return { ...sp, fill: fillOf(m, sp), sr, sg, sb };
  };
  const spec = targetOf(ml);
  const specV = Object.fromEntries(Object.keys(spec).map((k) => [k, 0])) as Record<keyof typeof spec, number>;
  // tampa: 0 = no lugar, 1 = fora (toque no frasco abre e fecha)
  let capOpen = false, cap = 0, capV = 0;
  let yaw = -0.35, yawV = opts.autoRotate === false || reduced ? 0 : 0.22;
  // inclinação do frasco (rad) e velocidade — mola para ficar em pé
  let tiltX = 0, tiltZ = 0, tiltXV = 0, tiltZV = 0;
  let pushX = 0, pushZ = 0; // inclinação comandada pelo dedo
  // líquido: desvio do plano em relação à horizontal do mundo (mola amortecida)
  let sx = 0, sz = 0, sxv = 0, szv = 0;
  let wavePhase = 0, waveAmp = 0, waveDir = 0;
  let dragging = false, lastX = 0, lastY = 0, lastT = 0, dragVX = 0, dragVY = 0;
  let idleSpin = opts.autoRotate === false || reduced ? 0 : 0.22;
  let idleFor = 0;
  let deviceTiltX = 0, deviceTiltZ = 0;

  const resize = () => {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2) * quality;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  let quality = 1;

  /* ── entrada ── */
  let downX = 0, downY = 0, downT = 0;
  const onDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    downT = performance.now();
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    dragVX = dragVY = 0;
    canvas.setPointerCapture?.(e.pointerId);
    wake();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastT) / 1000;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    const w = canvas.clientWidth || 300;
    yaw += (dx / w) * Math.PI * 1.6;
    yawV = ((dx / w) * Math.PI * 1.6) / dt;
    dragVX = dragVX * 0.6 + (dx / dt) * 0.4;
    dragVY = dragVY * 0.6 + (dy / dt) * 0.4;
    // o frasco "vai junto" com o dedo: inclina contra o movimento
    pushZ = Math.max(-0.3, Math.min(0.3, -dragVX * 0.00045));
    pushX = Math.max(-0.22, Math.min(0.22, dragVY * 0.00035));
    idleFor = 0;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    // toque rápido sem arrastar: abre/fecha a tampa
    if (dragging && Math.hypot(e.clientX - downX, e.clientY - downY) < 7 && performance.now() - downT < 350) {
      capOpen = !capOpen;
      if (!capOpen) szv += 0.8; // a tampa encaixando dá um tranquinho no perfume
      opts.onCapChange?.(capOpen);
    }
    dragging = false;
    pushX = pushZ = 0;
    wake();
  };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.style.touchAction = "pan-y";

  // inclinar o celular também mexe o perfume (Android libera direto; iOS só após permissão)
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    deviceTiltZ = Math.max(-0.35, Math.min(0.35, (-e.gamma * Math.PI) / 180 * 0.5));
    deviceTiltX = Math.max(-0.25, Math.min(0.25, ((e.beta - 45) * Math.PI) / 180 * 0.35));
    wake();
  };
  window.addEventListener("deviceorientation", onOrient);

  /* ── loop ── */
  let raf = 0, visible = true, running = false, first = true, last = performance.now();
  let frameMs = 16, frames = 0;
  const io = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([en]) => {
        visible = !!en?.isIntersecting;
        if (visible) wake();
      })
    : null;
  io?.observe(canvas);
  const onVis = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", onVis);

  const physics = (dt: number) => {
    // tamanho: mola criticamente amortecida em cada medida
    const target = targetOf(ml);
    // tampa: sobe rápido e some; ao fechar, desce e assenta com um quiquezinho
    const ck = capOpen ? 60 : 110, cc = capOpen ? 14 : 13;
    capV += (ck * ((capOpen ? 1 : 0) - cap) - cc * capV) * dt;
    cap += capV * dt;
    const k = 90, c = 2 * Math.sqrt(k) * 0.82;
    (Object.keys(target) as Array<keyof typeof target>).forEach((key) => {
      const a = k * (target[key] - spec[key]) - c * specV[key];
      specV[key] += a * dt;
      spec[key] += specV[key] * dt;
    });
    // giro: inércia + giro ocioso bem lento
    if (!dragging) {
      idleFor += dt;
      const want = idleFor > 2.5 ? idleSpin : 0;
      yawV += (want - yawV) * Math.min(1, dt * (idleFor > 2.5 ? 0.8 : 2.2));
      yaw += yawV * dt;
    }
    // inclinação do frasco: mola com um pouco de sobra (balança e volta)
    const tk = 140, tc = 9;
    const gx = pushX + deviceTiltX, gz = pushZ + deviceTiltZ;
    const ax = tk * (gx - tiltX) - tc * tiltXV;
    const az = tk * (gz - tiltZ) - tc * tiltZV;
    tiltXV += ax * dt;
    tiltZV += az * dt;
    tiltX += tiltXV * dt;
    tiltZ += tiltZV * dt;
    // líquido: atrasado em relação ao vidro (inércia) — o plano é empurrado pela
    // aceleração angular do frasco e volta para a horizontal oscilando
    const lk = 75, lc = 2.2;
    const lax = lk * (0 - sx) - lc * sxv - ax * 0.55;
    const laz = lk * (0 - sz) - lc * szv - az * 0.55;
    sxv += lax * dt;
    szv += laz * dt;
    sx += sxv * dt;
    sz += szv * dt;
    sx = Math.max(-0.5, Math.min(0.5, sx));
    sz = Math.max(-0.5, Math.min(0.5, sz));
    // ondinhas: ganham energia com o tranco e somem devagar
    const energy = Math.hypot(sxv, szv) + Math.abs(yawV - idleSpin) * 0.06;
    waveAmp += (Math.min(0.55, energy * 0.18) - waveAmp) * Math.min(1, dt * 3);
    waveAmp *= Math.exp(-dt * 0.9);
    wavePhase += dt * 11;
    if (energy > 0.05) waveDir = Math.atan2(szv, sxv);
  };

  const settled = () =>
    !dragging &&
    Math.abs(tiltXV) + Math.abs(tiltZV) + Math.abs(sxv) + Math.abs(szv) < 0.002 &&
    waveAmp < 0.004 &&
    Object.values(specV).every((v) => Math.abs(v) < 0.001) &&
    Math.abs(capV) < 0.001 &&
    (idleSpin === 0 || reduced);

  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) {
      running = false;
      return;
    }
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // passos fixos: a física não depende da taxa de quadros
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120);
      physics(h);
      dt -= h;
    }
    draw();
    // qualidade adaptativa: se o aparelho sofre, baixa a resolução
    const t1 = performance.now();
    frameMs = frameMs * 0.9 + (t1 - now) * 0.1;
    if (++frames % 30 === 0) {
      if (frameMs > 22 && quality > 0.55) quality -= 0.1;
      else if (frameMs < 9 && quality < 1) quality += 0.05;
    }
    if (first) {
      first = false;
      opts.onFirstFrame?.();
    }
    if (settled()) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (running || !visible) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const draw = () => {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    const R = rotMat(yaw, tiltX, tiltZ);
    // o frasco rola sobre a borda da base: sobe o pivô para a quina tocar a mesa
    // ponto mais baixo da quina arredondada (raio 1,1 mm) toca exatamente a mesa
    const cosT = Math.min(1, Math.max(-1, R[4]!));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const lift = (spec.R - 1.1) * sinT - 1.1 * cosT + 1.1;
    // câmera de produto: tele, um pouco acima, enquadrando o maior frasco
    const eye: V3 = [0, 34, -178];
    const target: V3 = [0, 29, 0];
    const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const r = norm(cross([0, 1, 0], f));
    const up = cross(f, r);
    const camM = new Float32Array([r[0], r[1], r[2], up[0], up[1], up[2], f[0], f[1], f[2]]);
    const aspect = canvas.width / canvas.height;
    const vfov = (24 * Math.PI) / 180 * (aspect < 0.9 ? 1.12 : 1);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform3f(u.eye, eye[0], eye[1], eye[2]);
    gl.uniformMatrix3fv(u.cam, false, camM);
    gl.uniform1f(u.focal, 0.5 / Math.tan(vfov / 2));
    gl.uniformMatrix3fv(u.rot, false, R);
    gl.uniform3f(u.pivot, 0, lift, 0);
    const yT = spec.H + NECK_H;
    gl.uniform4f(u.a, spec.R, spec.H, spec.corner, spec.neck);
    gl.uniform4f(u.b, spec.wall, spec.base, spec.fill, yT);
    gl.uniform4f(u.c, spec.collarR, spec.collarH, spec.actH, spec.capH);
    gl.uniform2f(u.tube, spec.tubeA, spec.tubeR);
    gl.uniform1f(u.cap, Math.max(0, cap));
    // o perfume quer ficar nivelado no MUNDO: normal = cima + desvio da mola
    const nW = norm([sx, 1, sz]);
    const nL = toLocal(R, nW);
    gl.uniform3f(u.liqN, nL[0], nL[1], nL[2]);
    gl.uniform4f(u.wave, waveAmp, 0.55, wavePhase, waveDir);
    gl.uniform3f(u.bg, bg[0], bg[1], bg[2]);
    gl.uniform1f(u.labelOn, 1);
    gl.uniform3f(u.sigma, spec.sr, spec.sg, spec.sb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.label, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  wake();

  return {
    preview: {
      step(dt: number) {
        let left = dt;
        while (left > 0) {
          const h = Math.min(left, 1 / 120);
          physics(h);
          left -= h;
        }
        draw();
      },
      push(x: number, z: number, yawVel?: number) {
        pushX = x;
        pushZ = z;
        dragging = x !== 0 || z !== 0;
        if (yawVel != null) yawV = yawVel;
        idleFor = 0;
      },
      stop() {
        cancelAnimationFrame(raf);
        running = false;
        visible = false;
      },
    },
    setSize(next) {
      if (next === ml) return;
      ml = next;
      uploadLabel(ml);
      // troca de frasco dá um tranco leve no perfume
      szv += 1.6;
      sxv -= 0.6;
      idleFor = 0;
      wake();
    },
    nudge(s = 1) {
      szv += 2 * s;
      wake();
    },
    destroy() {
      cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("deviceorientation", onOrient);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
