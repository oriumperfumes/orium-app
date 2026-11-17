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
  R: number;
  H: number;
  corner: number;
  neck: number;
  wall: number;
  base: number;
  collarR: number;
  collarH: number;
  actH: number;
  capH: number;
  capR: number;
  tubeA: number;
  tubeR: number;
};

/* Proporções medidas nas fotos e nos vídeos de perto: o 10 ml é atarracado
   (corpo ≈ 1,26× o diâmetro) com fundo de vidro grosso (≈ 4,4 mm); o fino é alto
   (≈ 2,1×) de ombro arredondado. O borrifador é o MESMO nos dois: rosca Ø 12 mm,
   tampa Ø 11,8 × 17,5 mm. Tubinho grosso (Ø ≈ 1,8 mm) com curva forte no fundo. */
const WIDE: Spec = {
  R: 11,
  H: 28,
  corner: 1.8,
  neck: 4.8,
  wall: 1.1,
  base: 4.4,
  collarR: 6.0,
  collarH: 8.0,
  actH: 8.0,
  capH: 17.5,
  capR: 5.9,
  tubeA: 2.7,
  tubeR: 0.92,
};
const SLIM: Spec = {
  R: 8.25,
  H: 35,
  corner: 2.4,
  neck: 4.8,
  wall: 0.95,
  base: 3.0,
  collarR: 6.0,
  collarH: 8.0,
  actH: 8.0,
  capH: 17.5,
  capR: 5.9,
  tubeA: 2.0,
  tubeR: 0.88,
};

export const DECANT_SPECS: Record<DecantMl, Spec> = { 2: SLIM, 5: SLIM, 10: WIDE };

/**
 * cor do perfume: dourado claro e luminoso em todos (absorção por mm, R/G/B),
 * como o perfume real visto nos vídeos. O frasco fino tem menos líquido no
 * caminho da luz, então absorve um pouco mais por mm para dar o mesmo dourado.
 */
const SIGMA: Record<DecantMl, [number, number, number]> = {
  10: [0.0045, 0.058, 0.2],
  5: [0.006, 0.079, 0.27],
  2: [0.006, 0.079, 0.27],
};

const NECK_H = 2.2;

/** Altura do perfume: 10 e 5 ml cheios até o ombro (como no estoque); o de 2 ml
 *  no mesmo frasco fino fica bem abaixo da metade. */
function fillOf(ml: DecantMl, s: Spec) {
  if (ml === 2) return s.base + 9.5;
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
uniform vec3 uWave2;        // modo "sela" (2ª harmônica): amplitude, fase, direção
uniform vec3 uBg;           // cor do card (linear)
uniform vec3 uSigma;        // absorção do perfume por mm
uniform vec4 uC;            // raio da rosca, altura da rosca, altura do atuador, altura da tampa
uniform vec2 uTube;         // curvatura e raio do tubinho
uniform vec3 uCapP;         // base da tampa (espaço do frasco)
uniform vec3 uCapAx;        // eixo da tampa (espaço do frasco)
uniform vec3 uCapW;         // base da tampa no mundo (sombra na mesa)
uniform float uCapR;        // raio da tampa
uniform vec3 uToneFix;
uniform vec2 uJit;           // deslocamento de subpixel (antisserrilhado temporal)
uniform int uN4;            // sempre 4 (limite de laço que o compilador não desenrola)      // correção para o fundo sair exatamente na cor do card

#define AIR 0
#define GLASS 1
#define CAV 2
#define LIQ 3
#define SOLID 4
#define PLAS 5
#define HAZE 6      // tampa: plástico fosco translúcido (névoa leitosa, sem desviar o raio)
#define TUBE 7      // tubinho leitoso

float sdBox2(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }
float smin(float a, float b, float k){ float h = max(k-abs(a-b),0.)/k; return min(a,b) - h*h*k*0.25; }

float outerS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float H = uA.y, yT = uB.w;
  float body = sdBox2(q - vec2(0., H*0.5), vec2(uA.x, H*0.5), uA.z);
  if (p.y < H - 3.) return min(body, H - 1. - p.y);   // longe do gargalo: limite barato
  float neck = sdBox2(q - vec2(0., (H - 1. + yT)*0.5), vec2(uA.w, (yT - H + 1.)*0.5), 0.4);
  return smin(body, neck, 0.9);
}
float innerS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float H = uA.y, w = uB.x, b = uB.y, top = H - 1.3;
  float body = sdBox2(q - vec2(0., (b + top)*0.5), vec2(uA.x - w, (top - b)*0.5), max(uA.z - w, 0.6));
  if (p.y < top - 3.) return min(body, top - 1. - p.y);
  float yN = uB.w + 6.;
  float neck = sdBox2(q - vec2(0., (top - 1. + yN)*0.5), vec2(uA.w - 1.05, (yN - top + 1.)*0.5), 0.2);
  return smin(body, neck, 0.7);
}
// tubinho flexível: desce curvando e encosta no fundo
vec2 tubeC(float y){
  float t = clamp((y - uB.y)/(uA.y - uB.y), 0., 1.);
  float k = 1. - t;
  // quase reto em cima, curva forte embaixo (o tubo é mais comprido que o frasco)
  return vec2(uTube.x*(0.3*sin(t*3.1 + 0.4) + 1.15*k*k*k), uTube.x*0.32*sin(t*2.2 + 1.0)*k);
}
float rodS(vec3 p){
  float y0 = uB.y + 0.35, y1 = uA.y + 0.5;
  float far = length(p.xz) - (uTube.x*1.25 + uTube.y);
  if (far > 0.5) return max(far, max(y0 - p.y, p.y - y1));
  float d = (length(p.xz - tubeC(p.y)) - uTube.y)*0.8;
  return max(d, max(y0 - p.y, p.y - y1));
}
float surfS(vec3 p){
  float r = length(p.xz);
  float ri = uA.x - uB.x;
  float rn = r/ri;
  float wave = 0.;
  // onda que corre de parede a parede + modo "sela" (o perfume sobe em dois lados opostos)
  if (uWave.x > 0.002){
    vec2 wd = vec2(cos(uWave.w), sin(uWave.w));
    wave = uWave.x * sin(dot(p.xz, wd)*uWave.y + uWave.z) * (0.35 + 0.65*rn);
  }
  if (uWave2.x > 0.002){
    // cos(2(a-d)) sem atan: (x²-z²)/r² e 2xz/r²
    vec2 n2 = p.xz/max(r, 1e-3);
    float c2 = n2.x*n2.x - n2.y*n2.y, s2 = 2.*n2.x*n2.y;
    wave += uWave2.x * (c2*cos(2.*uWave2.z) + s2*sin(2.*uWave2.z)) * rn*rn * sin(uWave2.y);
  }
  float men = 0.5*exp(-max(ri - r, 0.)/0.6);   // menisco subindo na parede
  return dot(p - vec3(0., uB.z, 0.), uLiqN) - wave - men;
}
float liqS(vec3 p){ return max(innerS(p), surfS(p)); }

// alturas do borrifador
float yCol(){ return uA.y + 0.15; }
float yAct(){ return yCol() + uC.y + 1.1; }
// rosca de plástico transparente canelada (meio que refrata)
float collarBox(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float lb = max(yCol() - 0.6 - p.y, q.x - uC.x - 0.6);
  if (lb > 0.5) return lb;
  // caneluras só na faixa de baixo (onde os dedos giram); em cima a rosca é lisa
  float band = 1. - smoothstep(0.62, 0.72, (p.y - yCol())/uC.y);
  float rib = 0.075*(0.5 + 0.5*cos(atan(p.x, p.z)*40.))*band;
  return sdBox2(q - vec2(0., yCol() + uC.y*0.5), vec2(uC.x - rib, uC.y*0.5), 0.5);
}
float collarS(vec3 p){ float c = collarBox(p); return c > 0.4 ? c : max(c, -outerS(p)); }
// peças leitosas: anel branco, atuador com o bico, tampa
float ringS(vec3 p){ vec2 q = vec2(length(p.xz), p.y);
  float lb = max(yCol() + uC.y - 0.2 - p.y, q.x - uC.x);
  if (lb > 0.5) return lb;
  return sdBox2(q - vec2(0., yCol() + uC.y + 0.5), vec2(uC.x*0.84, 0.6), 0.3); }
float actS(vec3 p){
  vec2 q = vec2(length(p.xz), p.y);
  float lb = max(yCol() + uC.y - p.y, q.x - uC.x*0.6 - 0.2);
  if (lb > 0.5) return lb;
  float a = sdBox2(q - vec2(0., yAct() + uC.z*0.5), vec2(uC.x*0.6, uC.z*0.5), 1.3);
  float stem = sdBox2(q - vec2(0., yAct() - 0.2), vec2(uC.x*0.3, 0.8), 0.2);
  return min(a, stem);
}
// tampa: cilindro de cantos macios em qualquer posição/eixo (ela sai e pousa na mesa)
float capS(vec3 p){
  vec3 d = p - uCapP;
  float lb = length(d - uCapAx*uC.w*0.5) - length(vec2(uCapR, uC.w*0.5)) - 0.1;
  if (lb > 0.5) return lb;
  float a = dot(d, uCapAx);
  float rr = length(d - a*uCapAx);
  return sdBox2(vec2(rr, a - uC.w*0.5), vec2(uCapR, uC.w*0.5), 1.0);
}
float solidS(vec3 p){ return min(ringS(p), actS(p)); }

/* Todas as formas avaliadas num lugar só (cada uma aparece UMA vez no código
   compilado). "full" = todas (para saber em que meio o ponto está); senão só as
   que limitam o meio atual. */
struct S { float o, i, rod, liq, col, sol, cap; };
S evalS(vec3 p, int m, bool full){
  S s = S(1e3, 1e3, 1e3, 1e3, 1e3, 1e3, 1e3);
  if (full || m == AIR || m == GLASS || m == PLAS || m == CAV) s.o = outerS(p);
  if (full || m == GLASS || m == CAV || m == LIQ || m == TUBE){ s.i = innerS(p); s.rod = rodS(p); }
  if (full || m == CAV || m == LIQ) s.liq = max(s.i, surfS(p));
  if (full || m == AIR || m == PLAS || m == CAV){ float cb = collarBox(p); s.col = cb > 0.4 ? cb : max(cb, -s.o); }
  if (full || m == AIR || m == PLAS || m == HAZE) s.sol = solidS(p);
  if (full || m == AIR || m == HAZE) s.cap = capS(p);
  return s;
}
// distância até a fronteira do meio atual (positiva dentro dele)
float distOf(int m, S s){
  if (m == AIR) return min(min(s.o, s.sol), min(s.col, s.cap));
  if (m == HAZE) return min(-s.cap, s.sol);
  if (m == TUBE) return -s.rod;
  if (m == PLAS) return min(-s.col, s.sol);
  if (m == GLASS) return min(-s.o, s.i);
  if (m == CAV) return min(min(-s.i, s.liq), min(s.rod, s.col));
  return min(-s.liq, s.rod);
}
int regionOf(S s){
  if (s.sol < 0.) return SOLID;
  if (s.cap < 0.) return HAZE;
  if (s.col < 0.) return PLAS;
  if (s.o > 0.) return AIR;
  if (s.i > 0.) return GLASS;
  if (s.rod < 0.) return TUBE;
  if (s.liq < 0.) return LIQ;
  return CAV;
}
const vec3 TET[4] = vec3[4](vec3(1.,-1.,-1.), vec3(-1.,-1.,1.), vec3(-1.,1.,-1.), vec3(1.,1.,1.));
vec3 sgrad(vec3 p){
  vec3 g = vec3(0.);
  for (int k = 0; k < uN4; k++) g += TET[k]*solidS(p + TET[k]*0.003);
  return normalize(g);
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

// mesa escura: sombra de contato + cáustica âmbar (luz de trás atravessando o perfume)
vec3 floorBase(vec3 fp){
  float r = length(fp.xz), R = uA.x;
  vec3 base = uBg;
  float shadow = 1. - 0.78*exp(-max(r - R*0.92, 0.)/(R*0.5)) * smoothstep(R*4., R*0.6, r);
  vec2 cp = fp.xz - vec2(R*0.15, -R*1.6);
  vec2 e = cp/vec2(R*0.8, R*1.45);
  float caus = exp(-dot(e, e)*1.6);
  float filled = clamp((uB.z - uB.y)/(uA.y*0.6), 0., 1.);
  // sombra de contato da tampa quando ela está pousada na mesa
  float capOn = 1. - smoothstep(0.2, 4., uCapW.y);
  float dc = length(fp.xz - uCapW.xz);
  shadow *= 1. - 0.7*capOn*exp(-max(dc - uCapR*0.9, 0.)/(uCapR*0.45))*smoothstep(uCapR*4., uCapR*0.5, dc);
  vec3 c = base*shadow + vec3(1.0, 0.55, 0.16)*caus*0.42*filled;
  float far = smoothstep(R*3., R*9., r);
  return mix(c, uBg, far);
}

/* plástico (anel, atuador, tampa): uma única função, chamada de um só lugar */
vec3 solidColor(vec3 p, vec3 rd){
  vec3 n = L2W(sgrad(p)); vec3 v = L2W(rd); vec3 rf = reflect(v, n);
  float ndv = max(dot(-v, n), 0.);
  float fr = fresnel(1., 1.49, ndv);
  int part = ringS(p) < actS(p) ? 0 : 1;   // 0 anel, 1 atuador
  float key = max(dot(n, normalize(vec3(-0.55, 0.65, -0.5))), 0.);
  float fill = max(dot(n, normalize(vec3(0.7, 0.3, -0.4))), 0.);
  float top = smoothstep(0.2, 0.9, n.y);
  float rim = pow(1. - ndv, 1.6);
  // um reflexo e uma transmissão por pixel, com a aspereza de cada peça
  vec3 spec = env(rf, part == 0 ? 0.18 : 0.16) * fr * 1.08;
  vec3 through = env(v, 0.3) * (part == 0 ? 0. : 0.2);
  vec3 c;
  if (part == 0){
    // anel branco fino (opaco, acetinado)
    c = vec3(0.86, 0.86, 0.85)*(0.06 + 0.30*key + 0.10*fill) + spec;
  } else {
    /* atuador: plástico leitoso mais claro, com o miolo branco aparecendo por
       dentro e o bico branco virado para a frente */
    vec3 milk = vec3(0.84, 0.87, 0.90);
    float tca = -dot(p.xz, rd.xz)/max(dot(rd.xz, rd.xz), 1e-4);
    float ax = length(p.xz + rd.xz*max(tca, 0.));
    float core = 1. - smoothstep(1.0, 1.7, ax);
    through = mix(through, vec3(0.22)*(0.4 + 0.6*key), core*0.7);
    c = through + milk*(0.02 + 0.10*key + 0.05*top) + milk*rim*0.12 + spec;
    float ang = atan(p.x, -p.z);
    float nz = 1. - smoothstep(0.75, 1.05, length(vec2(ang*uC.x*0.6, p.y - (yAct() + uC.z - 2.4))));
    c = mix(c, vec3(0.62)*(0.5 + 0.5*key) + vec3(0.05), nz*0.9);
  }
  return c;
}

/* Traça o raio principal e, se ele bater na mesa perto do frasco, continua no
   MESMO laço como raio refletido (o reflexo do frasco na mesa). Um laço só:
   o shader fica pequeno e compila rápido em qualquer placa. Espaço do frasco. */
vec3 render(vec3 ro, vec3 rd){
  vec3 col = vec3(0.), T = vec3(1.);
  int m = AIR; vec3 p = ro; int events = 0; float travel = 0.;
  // cilindro envolvente: quem não passa perto do frasco nem marcha
  float bound = uA.x + 2.2, top = yAct() + uC.z + 2.;
  vec3 capMid = uCapP + uCapAx*uC.w*0.5;
  float capRad = length(vec2(uCapR, uC.w*0.5)) + 1.;
  bool refl = false, floorHit = false, escape = false, solid = false;
  vec3 colP = vec3(0.), TP = vec3(1.), fpP = vec3(0.);
  float floorK = 0.;
  int maxIt = 260, maxEv = 14;
  // ph: 0 = andando; 1..4 = amostras da normal na fronteira; 5 = qual é o próximo meio
  int ph = 0; vec3 pB = vec3(0.), N = vec3(0.);
  for (int i = 0; i < 350; i++){
    if (i >= maxIt){ escape = true; break; }
    vec3 q = p;
    if (ph >= 1 && ph <= 4) q = pB + TET[ph - 1]*0.0025;
    else if (ph == 5) q = pB - N*0.025;
    S sd = evalS(q, m, ph == 5);
    if (ph >= 1 && ph <= 4){
      N += TET[ph - 1]*distOf(m, sd);
      ph++;
      if (ph == 5) N = normalize(N);       // aponta para dentro do meio atual (contra o raio)
      continue;
    }
    if (ph == 5){
      ph = 0;
      int m2 = regionOf(sd);
      if (m2 == m){ p += rd*0.01; continue; }
      if (m2 == SOLID){ solid = true; break; }
      // tampa e tubinho: plástico leitoso fino — a luz passa sem desviar,
      // o reflexo é largo e suave (superfície fosca)
      bool milky = m == HAZE || m2 == HAZE || m == TUBE || m2 == TUBE;
      bool capB = m == HAZE || m2 == HAZE;
      float n1 = milky ? 1. : iorOf(m), n2 = milky ? 1.49 : iorOf(m2);
      float c = max(dot(-rd, N), 0.);
      vec3 tr = milky ? rd : refract(rd, N, n1/n2);
      if (dot(tr, tr) < 1e-6){ rd = reflect(rd, N); p += rd*0.02; events++; continue; }
      float F = fresnel(n1, n2, c) * (milky ? (capB ? 0.85 : 0.3) : 1.);
      col += T * F * env(L2W(reflect(rd, N)), capB ? 0.3 : 0.) * (m == AIR ? (events == 0 ? 1. : 0.7) : 0.55);
      T *= 1. - F;
      rd = tr; m = m2; p += rd*0.02; events++;
      if (events > maxEv){ escape = true; break; }
      continue;
    }
    float d = distOf(m, sd);
    if (m == AIR){
      // chão (plano do mundo y=0) em coordenadas locais: y_w = (uRot*p).y + uPivot.y
      vec3 pw = L2W(p) + uPivot; vec3 dw = L2W(rd);
      float r = length(p.xz);
      vec3 pc = p - capMid;
      bool awayCap = dot(pc, pc) > capRad*capRad && dot(pc, rd) > 0.;
      bool away = ((r > bound + 1. && dot(p.xz, rd.xz) > 0.) || (p.y > top + 2. && rd.y > 0.)) && awayCap;
      if (dw.y < 0.){
        float tf = -pw.y / dw.y;
        // atrás do frasco a mesa vira o fundo infinito do estúdio (ciclorama):
        // quem atravessa o vidro enxerga o painel de luz, não o tampo escuro
        bool behind = events > 0 && (pw + dw*tf).z > -uA.x*0.2;
        if (!behind && (tf < d || (away && tf < 1e4))){
          if (refl) break;                 // o reflexo voltou à mesa: acabou
          vec3 fp = pw + dw*tf;
          floorHit = true; fpP = fp; TP = T; colP = col;
          float rr = length(fp.xz);
          if (events == 0 && rr < uA.x*7.){
            // reflexo do frasco na mesa: mesmo laço, menos passos e eventos
            refl = true;
            vec3 rdw = reflect(dw, vec3(0., 1., 0.));
            floorK = (0.05 + 0.5*pow(1. - max(rdw.y, 0.), 5.)) * exp(-max(rr - uA.x, 0.)/(uA.x*2.2));
            p = W2L(fp + vec3(0., 0.01, 0.) - uPivot); rd = W2L(rdw);
            col = vec3(0.); T = vec3(1.); events = 0; travel = 0.;
            maxIt = i + 90; maxEv = 5;
            continue;
          }
          break;
        }
      }
      if (away || travel > 2000.){
        if (!refl && events == 0) col += T*uBg; else escape = true;
        break;
      }
    }
    if (d < (m == AIR ? 0.006 : 0.004)){ pB = p; N = vec3(0.); ph = 1; continue; }
    if (m == AIR){ p += rd*d; travel += d; continue; }
    float stepd = max(d, m == HAZE ? 0.25 : 0.002);
    if (m == LIQ) T *= exp(-uSigma * stepd);
    else if (m == GLASS) T *= exp(-vec3(0.010, 0.004, 0.008) * stepd);
    else if (m == TUBE){
      // tubinho leitoso: espalha luz branca e deixa passar um pouco do perfume
      col += T*vec3(0.15, 0.147, 0.142)*stepd;
      T *= exp(-vec3(0.6) * stepd);
    }
    else if (m == HAZE){
      // tampa fosca OCA: só a parede (~0,9 mm) é plástico; quanto mais parede
      // no caminho, mais branca (por isso a borda clareia e o miolo fica limpo)
      float wall = 1. - smoothstep(0.75, 1.15, -sd.cap);
      col += T*vec3(0.024, 0.026, 0.029)*stepd*wall;
      T *= exp(-vec3(0.11, 0.105, 0.10) * stepd * wall);
    }
    else if (m == PLAS) T *= exp(-vec3(0.035, 0.032, 0.028) * stepd);
    p += rd*stepd;
  }
  if (solid) col += T*solidColor(pB, rd);
  if (escape) col += T*env(L2W(rd), 0.);
  vec3 base = floorHit ? floorBase(fpP) : vec3(0.);
  if (refl){
    // a mesa reflete o frasco, não o estúdio todo
    vec3 rc = col * (events == 0 ? 0.08 : 1.);
    return colP + TP*(base + rc*floorK);
  }
  return col + T*base;
}

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }

void main(){
  vec2 q = (gl_FragCoord.xy + uJit - 0.5*uRes) / uRes.y;
  vec3 rdw = normalize(uCam * vec3(q, uFocal));
  vec3 col = render(W2L(uEye - uPivot), W2L(rdw));
  // mesmo mapeamento de tons para tudo + correção: a cor do card sai exata,
  // então a mesa some no fundo sem linha de horizonte
  vec3 outc = pow(aces(col * 1.05), vec3(1./2.2)) + uToneFix;
  // perto das bordas a cena funde na cor exata do card: a mesa e o brilho
  // nunca terminam num corte reto (o canvas não aparece como um retângulo)
  float edge = smoothstep(0., 0.08, vUv.x) * smoothstep(0., 0.08, 1. - vUv.x)
             * smoothstep(0., 0.10, vUv.y) * smoothstep(0., 0.05, 1. - vUv.y);
  outColor = vec4(mix(pow(uBg, vec3(1./2.2)), outc, edge), 1.);
}`;

/* ─────────────────────────────── matemática ─────────────────────────────── */

type V3 = [number, number, number];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Matriz 3x3 (coluna a coluna, como o WebGL espera) de yaw (Y), depois inclinações em X e Z. */
function rotMat(yaw: number, tx: number, tz: number): Float32Array {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const cx = Math.cos(tx),
    sx = Math.sin(tx);
  const cz = Math.cos(tz),
    sz = Math.sin(tz);
  // R = Rz * Rx * Ry
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const Rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  const m = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r]! * b[c * 3 + k]!;
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
  preview: {
    step: (dt: number) => void;
    /** inclinação comandada (como o dedo arrastando) e, opcional, velocidade de giro */
    push: (x: number, z: number, yawVel?: number) => void;
    /** giro contínuo (rad/s) */
    spin: (v: number) => void;
    cap: (open: boolean) => void;
    stop: () => void;
  };
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

export function createDecantRT(
  canvas: HTMLCanvasElement,
  opts: DecantRTOptions = {},
): DecantRT | null {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
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
  const vs = sh(gl.VERTEX_SHADER, VS),
    fs = sh(gl.FRAGMENT_SHADER, FS);
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
    res: U("uRes"),
    eye: U("uEye"),
    cam: U("uCam"),
    focal: U("uFocal"),
    rot: U("uRot"),
    pivot: U("uPivot"),
    a: U("uA"),
    b: U("uB"),
    liqN: U("uLiqN"),
    wave: U("uWave"),
    bg: U("uBg"),
    wave2: U("uWave2"),
    sigma: U("uSigma"),
    c: U("uC"),
    tube: U("uTube"),
    capP: U("uCapP"),
    capAx: U("uCapAx"),
    capW: U("uCapW"),
    capR: U("uCapR"),
    toneFix: U("uToneFix"),
    n4: U("uN4"),
    jit: U("uJit"),
  };

  /* ── antisserrilhado temporal: cada quadro sai com um deslocamento de
     subpixel diferente e é acumulado com os anteriores (peso que se adapta ao
     movimento: parado = acumula muito, arrastando = quase só o quadro novo) ── */
  const BLEND_FS = `#version 300 es
precision mediump float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCur, uHist; uniform float uA;
void main(){ o = mix(texture(uHist, vUv), texture(uCur, vUv), uA); }`;
  const bfs = sh(gl.FRAGMENT_SHADER, BLEND_FS);
  const bvs = sh(gl.VERTEX_SHADER, VS);
  if (!bfs || !bvs) return null;
  const blendProg = gl.createProgram()!;
  gl.attachShader(blendProg, bvs);
  gl.attachShader(blendProg, bfs);
  gl.bindAttribLocation(blendProg, 0, "aP");
  gl.linkProgram(blendProg);
  const bu = {
    cur: gl.getUniformLocation(blendProg, "uCur"),
    hist: gl.getUniformLocation(blendProg, "uHist"),
    a: gl.getUniformLocation(blendProg, "uA"),
  };
  type Target = { tex: WebGLTexture; fb: WebGLFramebuffer };
  let targets: Target[] = [];
  let tw = 0,
    th = 0,
    histIdx = 0,
    histValid = false;
  const makeTarget = (w: number, h: number): Target => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb };
  };
  const ensureTargets = (w: number, h: number) => {
    if (w === tw && h === th && targets.length) return;
    targets.forEach((t) => {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    });
    targets = [makeTarget(w, h), makeTarget(w, h), makeTarget(w, h)];
    tw = w;
    th = h;
    histValid = false;
  };
  // sequência de Halton (2, 3): 16 posições de subpixel bem espalhadas
  const halton = (i: number, b: number) => {
    let f = 1,
      r = 0;
    while (i > 0) {
      f /= b;
      r += f * (i % b);
      i = Math.floor(i / b);
    }
    return r;
  };
  let jitIdx = 0;
  /** movimento na tela (px por quadro, aproximado) — decide o peso do quadro novo */
  let motionPx = 0;
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const bg = (opts.bg ?? [22, 22, 22]).map((c) => Math.pow(c / 255, 2.2)) as V3;
  const aces = (x: number) =>
    Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
  const toneFix = bg.map((c) => Math.pow(c, 1 / 2.2) - Math.pow(aces(c * 1.05), 1 / 2.2)) as V3;
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── estado físico ── */
  let ml: DecantMl = opts.ml ?? 5;
  const targetOf = (m: DecantMl) => {
    const sp = DECANT_SPECS[m];
    const [sr, sg, sb] = SIGMA[m];
    return { ...sp, fill: fillOf(m, sp), sr, sg, sb };
  };
  const spec = targetOf(ml);
  const specV = Object.fromEntries(Object.keys(spec).map((k) => [k, 0])) as Record<
    keyof typeof spec,
    number
  >;
  // tampa: 0 = no lugar, 1 = fora (toque no frasco abre e fecha)
  let capOpen = false,
    capT = 0; // progresso linear do caminho da tampa (0 no frasco, 1 na mesa)
  let yaw = -0.35,
    yawV = opts.autoRotate === false || reduced ? 0 : 0.22;
  // inclinação do frasco (rad) e velocidade — mola para ficar em pé
  let tiltX = 0,
    tiltZ = 0,
    tiltXV = 0,
    tiltZV = 0;
  let pushX = 0,
    pushZ = 0; // inclinação comandada pelo dedo
  // líquido: desvio do plano em relação à horizontal do mundo (mola amortecida)
  let sx = 0,
    sz = 0,
    sxv = 0,
    szv = 0;
  let wavePhase = 0,
    waveAmp = 0,
    waveDir = 0,
    w2Amp = 0,
    w2Phase = 0,
    w2Dir = 0;
  let dragging = false,
    lastX = 0,
    lastY = 0,
    lastT = 0,
    dragVX = 0,
    dragVY = 0;
  let idleSpin = opts.autoRotate === false || reduced ? 0 : 0.22;
  let idleFor = 0;
  let deviceTiltX = 0,
    deviceTiltZ = 0;

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
  let downX = 0,
    downY = 0,
    downT = 0;
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
    const dx = e.clientX - lastX,
      dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    const w = canvas.clientWidth || 300;
    yaw += (dx / w) * Math.PI * 1.6;
    yawV = ((dx / w) * Math.PI * 1.6) / dt;
    dragVX = dragVX * 0.6 + (dx / dt) * 0.4;
    dragVY = dragVY * 0.6 + (dy / dt) * 0.4;
    // o frasco "vai junto" com o dedo: inclina contra o movimento
    // inclinação contida: o frasco balança no dedo, nunca parece que vai cair
    pushZ = Math.max(-0.16, Math.min(0.16, -dragVX * 0.00032));
    pushX = Math.max(-0.12, Math.min(0.12, dragVY * 0.00026));
    idleFor = 0;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    // toque rápido sem arrastar: abre/fecha a tampa
    if (
      dragging &&
      Math.hypot(e.clientX - downX, e.clientY - downY) < 7 &&
      performance.now() - downT < 350
    ) {
      capOpen = !capOpen;
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
    deviceTiltZ = Math.max(-0.35, Math.min(0.35, ((-e.gamma * Math.PI) / 180) * 0.5));
    deviceTiltX = Math.max(-0.25, Math.min(0.25, (((e.beta - 45) * Math.PI) / 180) * 0.35));
    wake();
  };
  window.addEventListener("deviceorientation", onOrient);

  /* ── loop ── */
  let raf = 0,
    visible = true,
    running = false,
    first = true,
    last = performance.now();
  let converge = 0;
  let frameMs = 16,
    frames = 0,
    tick = 0;
  const io =
    typeof IntersectionObserver === "function"
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
    if (capOpen && capT < 1) capT = Math.min(1, capT + dt / 1.05);
    else if (!capOpen && capT > 0) {
      capT = Math.max(0, capT - dt / 0.95);
      if (capT === 0) {
        // a tampa encaixando dá um tranquinho no perfume
        szv += 0.9;
        sxv -= 0.3;
      }
    }
    const k = 90,
      c = 2 * Math.sqrt(k) * 0.82;
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
    const tk = 140,
      tc = 9;
    const gx = pushX + deviceTiltX,
      gz = pushZ + deviceTiltZ;
    const ax = tk * (gx - tiltX) - tc * tiltXV;
    const az = tk * (gz - tiltZ) - tc * tiltZV;
    tiltXV += ax * dt;
    tiltZV += az * dt;
    tiltX += tiltXV * dt;
    tiltZ += tiltZV * dt;
    // líquido: atrasado em relação ao vidro (inércia) — o plano é empurrado pela
    // aceleração angular do frasco e volta para a horizontal oscilando
    const lk = 75,
      lc = 2.2;
    const lax = lk * (0 - sx) - lc * sxv - ax * 0.55;
    const laz = lk * (0 - sz) - lc * szv - az * 0.55;
    sxv += lax * dt;
    szv += laz * dt;
    sx += sxv * dt;
    sz += szv * dt;
    sx = Math.max(-0.5, Math.min(0.5, sx));
    sz = Math.max(-0.5, Math.min(0.5, sz));
    // ondinhas: ganham energia com o tranco e somem devagar
    // ondas: ganham energia com o tranco e assentam devagar (proporcionais ao raio)
    const energy = Math.hypot(sxv, szv) + Math.abs(yawV - idleSpin) * 0.05;
    const ri = spec.R - spec.wall;
    waveAmp += (Math.min(0.11 * ri, energy * 0.045 * ri) - waveAmp) * Math.min(1, dt * 4);
    waveAmp *= Math.exp(-dt * 0.75);
    wavePhase += dt * 9.5;
    if (energy > 0.05) waveDir = Math.atan2(szv, sxv);
    // modo sela: a mais lenta das ondas, a última a parar
    w2Amp += (Math.min(0.08 * ri, energy * 0.03 * ri) - w2Amp) * Math.min(1, dt * 2.5);
    w2Amp *= Math.exp(-dt * 0.55);
    w2Phase += dt * 7.2;
    if (energy > 0.05) w2Dir = waveDir + 0.6;
    // velocidade das bordas na tela (px/s): decide o peso do antisserrilhado
    const pxPerMm = (canvas.height || 300) / 78;
    const sizeMoving = Object.values(specV).reduce((a2, v) => a2 + Math.abs(v), 0);
    const capMoving = capOpen ? (capT < 1 ? 40 : 0) : capT > 0 ? 40 : 0;
    motionRate =
      (Math.abs(yawV) * spec.R +
        (Math.abs(tiltXV) + Math.abs(tiltZV)) * spec.H +
        (Math.abs(sxv) + Math.abs(szv)) * spec.R * 0.6 +
        (waveAmp + w2Amp) * 8 +
        sizeMoving * 0.5 +
        capMoving) *
      pxPerMm;
  };
  let motionRate = 0;
  let lastShapeKey = 0;

  const settled = () =>
    !dragging &&
    Math.abs(tiltXV) + Math.abs(tiltZV) + Math.abs(sxv) + Math.abs(szv) < 0.002 &&
    waveAmp < 0.004 &&
    w2Amp < 0.004 &&
    Object.values(specV).every((v) => Math.abs(v) < 0.001) &&
    (capOpen ? capT >= 1 : capT <= 0) &&
    (idleSpin === 0 || reduced);

  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) {
      running = false;
      return;
    }
    const gap = now - last;
    let dt = Math.min(0.05, gap / 1000);
    last = now;
    // qualidade adaptativa: o intervalo entre quadros inclui o tempo da placa de
    // vídeo; se passar de ~19 ms (abaixo de ~52 fps), baixa a resolução
    if (gap > 0 && gap < 200) {
      frameMs = frameMs * 0.85 + gap * 0.15;
      if (++frames % 20 === 0) {
        if (frameMs > 19 && quality > 0.5) quality = Math.max(0.5, quality - 0.12);
        else if (frameMs < 17.4 && quality < 1 && frames > 120)
          quality = Math.min(1, quality + 0.04);
      }
    }
    // passos fixos: a física não depende da taxa de quadros
    while (dt > 0) {
      const h = Math.min(dt, 1 / 120);
      physics(h);
      dt -= h;
    }
    // só girando sozinho (ninguém tocando, perfume parado): 30 quadros por
    // segundo bastam e poupam metade da bateria; ao tocar, volta a 60
    const calm =
      !dragging &&
      Math.abs(tiltXV) + Math.abs(tiltZV) + Math.abs(sxv) + Math.abs(szv) < 0.02 &&
      waveAmp < 0.01 &&
      w2Amp < 0.01 &&
      (capOpen ? capT >= 1 : capT <= 0) &&
      Object.values(specV).every((v) => Math.abs(v) < 0.01);
    if (first || !calm || (++tick & 1) === 0) draw();
    if (first) {
      first = false;
      opts.onFirstFrame?.();
    }
    // parado de verdade: ainda desenha ~20 quadros para a imagem convergir
    // (bordas lisas), depois para de gastar bateria
    if (settled()) {
      if (++converge > 20) {
        running = false;
        converge = 0;
        return;
      }
    } else converge = 0;
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
    gl.useProgram(prog);
    ensureTargets(canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[2]!.fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    jitIdx = (jitIdx % 16) + 1;
    gl.uniform2f(u.jit, halton(jitIdx, 2) - 0.5, halton(jitIdx, 3) - 0.5);
    const R = rotMat(yaw, tiltX, tiltZ);
    // o frasco rola sobre a borda da base: sobe o pivô para a quina tocar a mesa
    // ponto mais baixo da quina arredondada (raio 1,1 mm) toca exatamente a mesa
    const cosT = Math.min(1, Math.max(-1, R[4]!));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const lift = (spec.R - 1.1) * sinT - 1.1 * cosT + 1.1;
    // câmera de produto: tele, um pouco acima, enquadrando o maior frasco
    const eye: V3 = [0, 36, -185];
    const target: V3 = [0, 27.5, 0];
    const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const r = norm(cross([0, 1, 0], f));
    const up = cross(f, r);
    const camM = new Float32Array([r[0], r[1], r[2], up[0], up[1], up[2], f[0], f[1], f[2]]);
    const aspect = canvas.width / canvas.height;
    const vfov = ((24 * Math.PI) / 180) * (aspect < 0.9 ? 1.12 : 1);
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
    // tampa: sobe reta até livrar o atuador, faz um arco para o lado e pousa
    // em pé na mesa; ao fechar, refaz o caminho ao contrário
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const sm = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const uu = ease(capT);
    const seatY = spec.H + 0.15 + spec.collarH + 0.25;
    const axB: V3 = [R[3]!, R[4]!, R[5]!];
    const seatW: V3 = [R[3]! * seatY, R[4]! * seatY + lift, R[5]! * seatY];
    const rise = sm(0, 0.36, uu) * (spec.actH + 2.2);
    const side = sm(0.3, 0.84, uu),
      drop = sm(0.5, 1, uu);
    const restW: V3 = [spec.R + spec.capR + 9, 0, 4];
    const hi: V3 = [seatW[0] + axB[0] * rise, seatW[1] + axB[1] * rise, seatW[2] + axB[2] * rise];
    const capW: V3 = [
      hi[0] + (restW[0] - hi[0]) * side,
      hi[1] + (0 - hi[1]) * drop + 5 * Math.sin(Math.PI * side) * (1 - drop * 0.6),
      hi[2] + (restW[2] - hi[2]) * side,
    ];
    const lean = 0.22 * Math.sin(Math.PI * side);
    const capAxW = norm([
      axB[0] * (1 - side) + lean,
      axB[1] * (1 - side) + side,
      axB[2] * (1 - side),
    ]);
    const capL = toLocal(R, [capW[0], capW[1] - lift, capW[2]]);
    const capAxL = toLocal(R, capAxW);
    gl.uniform3f(u.capP, capL[0], capL[1], capL[2]);
    gl.uniform3f(u.capAx, capAxL[0], capAxL[1], capAxL[2]);
    gl.uniform3f(u.capW, capW[0], capW[1], capW[2]);
    gl.uniform1f(u.capR, spec.capR);
    gl.uniform3f(u.toneFix, toneFix[0], toneFix[1], toneFix[2]);
    gl.uniform1i(u.n4, 4);
    gl.uniform3f(u.wave2, w2Amp, w2Phase, w2Dir);
    // o perfume quer ficar nivelado no MUNDO: normal = cima + desvio da mola
    const nW = norm([sx, 1, sz]);
    const nL = toLocal(R, nW);
    gl.uniform3f(u.liqN, nL[0], nL[1], nL[2]);
    gl.uniform4f(u.wave, waveAmp, 0.55, wavePhase, waveDir);
    gl.uniform3f(u.bg, bg[0], bg[1], bg[2]);
    gl.uniform3f(u.sigma, spec.sr, spec.sg, spec.sb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // acumula: parado ≈ média dos últimos ~10 quadros (bordas lisas); em
    // movimento o quadro novo pesa mais (sem rastro)
    motionPx = motionRate / 60;
    // mudança brusca de forma (troca de tamanho): recomeça o acúmulo, sem fantasma
    const shapeKey = spec.R * 7 + spec.H + spec.fill * 3;
    if (Math.abs(shapeKey - lastShapeKey) > 0.6) histValid = false;
    lastShapeKey = shapeKey;
    const a = histValid ? Math.min(1, 0.1 + motionPx * 0.45) : 1;
    const src = targets[histIdx]!,
      dst = targets[1 - histIdx]!;
    gl.useProgram(blendProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[2]!.tex);
    gl.uniform1i(bu.cur, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(bu.hist, 1);
    gl.uniform1f(bu.a, a);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // mostra
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dst.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, tw, th, 0, 0, tw, th, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    histIdx = 1 - histIdx;
    histValid = true;
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
        if (yawVel != null) yawV = yawVel;
      },
      spin(v: number) {
        idleSpin = v;
        idleFor = 3;
      },
      cap(open: boolean) {
        capOpen = open;
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
