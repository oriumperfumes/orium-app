/**
 * ESTÚDIO 3D DOS FRASCOS — um palco de fotografia de produto em tempo real.
 *
 * O frasco é um modelo 3D de verdade (não fotos): a luz vem de softboxes do
 * próprio estúdio, então os reflexos deslizam pelas faces enquanto ele gira,
 * como num render de produto. Na mesa: sombra de contato suave (calculada a
 * cada quadro a partir do próprio frasco) e um reflexo discreto que some para
 * baixo. O fundo é exatamente a cor do card.
 *
 * Unidades: milímetros. O modelo fica com a base em y = 0 e a frente em +z.
 */
import * as THREE from "three";

export type Studio3D = {
  /** controle para gravar prévias quadro a quadro */
  preview: {
    step: (dt: number) => void;
    spin: (v: number) => void;
    drag: (dx: number) => void;
    stop: () => void;
  };
  setActive: (on: boolean) => void;
  destroy: () => void;
};

export type Studio3DOptions = {
  /** cor do card, sRGB 0–255 */
  bg?: [number, number, number];
  /** altura total do modelo (mm), para enquadrar */
  height: number;
  /** maior medida da base (mm), para a sombra */
  footprint: number;
  autoRotate?: boolean;
  /** ângulo inicial (rad); 0 = de frente */
  yaw?: number;
  onFirstFrame?: () => void;
};

/* ───────────── ambiente: estúdio escuro com softboxes ───────────── */

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  // sala escura com um degradê leve (o "ar" do estúdio aparece no reflexo)
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec3 vP; void main(){
        float y = vP.y;
        vec3 c = mix(vec3(0.05,0.045,0.04), vec3(0.22,0.22,0.24), smoothstep(-0.2, 0.9, y));
        // atrás da câmera: uma parede clara logo abaixo do horizonte. Numa face
        // vertical o reflexo desce (a câmera está acima): o alto da face pega a
        // parede, a base pega o chão dourado; ao girar, o brilho desliza
        float el = asin(clamp(y, -1., 1.)), az = atan(vP.x, vP.z);
        float win = 1. - smoothstep(0.35, 1.1, abs(az - 0.25));
        float band = smoothstep(-0.22, -0.03, el) * (1. - smoothstep(0.2, 0.6, el));
        c += vec3(0.80, 0.81, 0.84) * band * win * 1.7;
        gl_FragColor = vec4(c, 1.);
      }`,
    }),
  );
  env.add(room);
  const panel = (
    w: number,
    h: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    pos: THREE.Vector3Tuple,
  ) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(...pos);
    m.lookAt(0, 60, 0);
    env.add(m);
    return m;
  };
  // softboxes laterais largas e suaves: numa face plana (espelho) elas dão um
  // brilho acetinado que cresce e some ao girar — nunca um clarão branco
  panel(150, 520, "#ffffff", 2.1, [-360, 140, 220]);
  // recorte à direita: faixa estreita, levemente fria
  panel(120, 520, "#eef2ff", 1.7, [380, 130, -40]);
  // faixa fina e forte: desenha o filete de luz nas quinas arredondadas
  panel(9, 360, "#ffffff", 9, [250, 150, 330]);
  // teto: softbox grande e suave
  panel(420, 300, "#ffffff", 6, [0, 480, 40]);
  // contra-luz quente atrás (a mesma luz âmbar do card de decants)
  panel(300, 220, "#ffd9a8", 3.5, [0, 170, -400]);
  // piso âmbar: a base do frasco reflete um dourado quente, como na mesa real
  {
    const f = new THREE.Mesh(
      new THREE.CircleGeometry(700, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#a8875a").multiplyScalar(0.7) }),
    );
    f.position.y = -240;
    env.add(f);
  }
  // pontos pequenos e muito fortes: fazem os cristais e as quinas cintilarem
  for (const [x, y, z, k] of [
    [-220, 260, 300, 60],
    [260, 300, 220, 50],
    [-80, 420, -200, 40],
    [320, 90, -260, 45],
    [-330, 60, -120, 40],
  ] as const) {
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(7, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffffff").multiplyScalar(k) }),
    );
    sp.position.set(x, y, z);
    env.add(sp);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02, 1, 2000);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose?.();
  });
  return rt;
}

/* ───────────── sombra de contato (do exemplo oficial do three.js) ───────────── */

function contactShadow(renderer: THREE.WebGLRenderer, size: number, res = 256) {
  const group = new THREE.Group();
  const rt = new THREE.WebGLRenderTarget(res, res);
  rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(res, res);
  rtBlur.texture.generateMipmaps = false;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: rt.texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  plane.renderOrder = 2;
  plane.scale.y = -1;
  plane.position.y = 0.02;
  group.add(plane);
  const blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2));
  blurPlane.visible = false;
  group.add(blurPlane);
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, 38);
  cam.rotation.x = Math.PI / 2;
  group.add(cam);
  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = { value: 1.35 };
    shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );",
    )}`;
  };
  depthMat.depthTest = false;
  depthMat.depthWrite = false;
  const blurMat = (horizontal: boolean) =>
    new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, h: { value: 1 / res } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float h; varying vec2 vUv;
        void main(){
          vec4 s = vec4(0.);
          vec2 d = ${horizontal ? "vec2(h, 0.)" : "vec2(0., h)"};
          s += texture2D(tDiffuse, vUv - 4.*d)*0.051; s += texture2D(tDiffuse, vUv - 3.*d)*0.0918;
          s += texture2D(tDiffuse, vUv - 2.*d)*0.12245; s += texture2D(tDiffuse, vUv - d)*0.1531;
          s += texture2D(tDiffuse, vUv)*0.1633;
          s += texture2D(tDiffuse, vUv + d)*0.1531; s += texture2D(tDiffuse, vUv + 2.*d)*0.12245;
          s += texture2D(tDiffuse, vUv + 3.*d)*0.0918; s += texture2D(tDiffuse, vUv + 4.*d)*0.051;
          gl_FragColor = s;
        }`,
      depthTest: false,
    });
  const hBlur = blurMat(true),
    vBlur = blurMat(false);
  const blur = (amount: number) => {
    blurPlane.visible = true;
    blurPlane.material = hBlur;
    hBlur.uniforms.tDiffuse!.value = rt.texture;
    hBlur.uniforms.h!.value = amount / res;
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurPlane, cam);
    blurPlane.material = vBlur;
    vBlur.uniforms.tDiffuse!.value = rtBlur.texture;
    vBlur.uniforms.h!.value = amount / res;
    renderer.setRenderTarget(rt);
    renderer.render(blurPlane, cam);
    blurPlane.visible = false;
  };
  const update = (scene: THREE.Scene, hide: THREE.Object3D[]) => {
    const bg = scene.background;
    scene.background = null;
    hide.forEach((o) => (o.visible = false));
    plane.visible = false;
    scene.overrideMaterial = depthMat;
    const clear = renderer.getClearAlpha();
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    blur(1.6);
    blur(0.6);
    renderer.setRenderTarget(null);
    renderer.setClearAlpha(clear);
    hide.forEach((o) => (o.visible = true));
    plane.visible = true;
    scene.background = bg;
  };
  const dispose = () => {
    rt.dispose();
    rtBlur.dispose();
    depthMat.dispose();
    hBlur.dispose();
    vBlur.dispose();
    plane.geometry.dispose();
    (plane.material as THREE.Material).dispose();
    blurPlane.geometry.dispose();
  };
  return { group, update, dispose };
}

/* ───────────── palco ───────────── */

export function createStudio3D(
  canvas: HTMLCanvasElement,
  model: THREE.Object3D,
  opts: Studio3DOptions,
): Studio3D | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  const bgSrgb = opts.bg ?? [12, 12, 12];
  const bgColor = new THREE.Color().setRGB(
    bgSrgb[0] / 255,
    bgSrgb[1] / 255,
    bgSrgb[2] / 255,
    THREE.SRGBColorSpace,
  );
  renderer.setClearColor(bgColor, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const envRT = studioEnvironment(renderer);
  scene.environment = envRT.texture;

  // giro: o frasco gira num pivô; o reflexo é uma cópia espelhada embaixo da mesa
  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);
  const mirror = new THREE.Group();
  mirror.add(model.clone(true));
  mirror.scale.y = -1;
  scene.add(mirror);

  // mesa: cobre o reflexo com a cor exata do card, deixando ~18% dele aparecer
  // perto da base e sumindo para baixo e para as bordas
  const floorMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    toneMapped: false,
    uniforms: {
      uBg: { value: new THREE.Vector3(bgSrgb[0] / 255, bgSrgb[1] / 255, bgSrgb[2] / 255) },
      uBaseY: { value: 0 },
      uFade: { value: 120 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uBg; uniform float uBaseY, uFade; uniform vec2 uRes;
      void main(){
        float below = uBaseY - gl_FragCoord.y;
        float a = mix(0.80, 1.0, smoothstep(0., uFade, below));
        vec2 uv = gl_FragCoord.xy/uRes;
        float side = smoothstep(0.0, 0.18, uv.x)*smoothstep(0.0, 0.18, 1.-uv.x);
        a = mix(1.0, a, side);
        gl_FragColor = vec4(uBg, a);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), floorMat);
  floor.renderOrder = 1;
  scene.add(floor);

  const shadow = contactShadow(renderer, opts.footprint * 2.6);
  scene.add(shadow.group);

  // câmera de produto: tele, um pouco acima
  const H = opts.height;
  const camera = new THREE.PerspectiveCamera(20, 1, 10, 5000);
  const target = new THREE.Vector3(0, H * 0.47, 0);

  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let yaw = opts.yaw ?? -0.5,
    yawV = 0;
  let idleSpin = opts.autoRotate === false || reduced ? 0 : 0.32;
  let idleFor = 3;
  let tilt = 0,
    tiltV = 0,
    tiltWant = 0; // olhar um pouco de cima/de baixo ao arrastar na vertical
  let dragging = false,
    lastX = 0,
    lastY = 0,
    lastT = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300,
      h = canvas.clientHeight || 300;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // enquadra a altura do frasco + espaço para o reflexo
    const fitH = H * 1.42;
    const dist = fitH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const el = THREE.MathUtils.degToRad(7 + tilt * 10);
    camera.position.set(0, target.y + Math.sin(el) * dist, Math.cos(el) * dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    // linha da base na tela, para o degradê da mesa
    const p = new THREE.Vector3(0, 0, opts.footprint * 0.3).project(camera);
    floorMat.uniforms.uBaseY!.value = ((p.y + 1) / 2) * h * dpr;
    floorMat.uniforms.uFade!.value = H * 0.55 * ((h * dpr) / fitH);
    floorMat.uniforms.uRes!.value.set(w * dpr, h * dpr);
  };

  /* entrada */
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    yawV = 0;
    canvas.setPointerCapture?.(e.pointerId);
    wake();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastT) / 1000;
    const w = canvas.clientWidth || 300;
    const d = ((e.clientX - lastX) / w) * Math.PI * 1.7;
    yaw += d;
    yawV = yawV * 0.4 + (d / dt) * 0.6;
    tiltWant = Math.max(
      -1,
      Math.min(1, tiltWant + ((e.clientY - lastY) / (canvas.clientHeight || 300)) * 1.6),
    );
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
    idleFor = 0;
    wake();
  };
  const onUp = () => {
    dragging = false;
    tiltWant = 0;
    wake();
  };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  canvas.style.touchAction = "pan-y";

  const physics = (dt: number) => {
    if (!dragging) {
      idleFor += dt;
      yawV *= Math.exp(-dt * 2.4);
      const spin = idleFor > 1.8 ? idleSpin : 0;
      yaw += (yawV + spin * Math.min(1, (idleFor - 1.8) * 0.6)) * dt;
    }
    // inclinação da câmera: mola suave de volta ao normal
    const k = 60,
      c = 2 * Math.sqrt(k) * 0.9;
    tiltV += (k * (tiltWant - tilt) - c * tiltV) * dt;
    tilt += tiltV * dt;
  };

  let first = true;
  const draw = () => {
    resize();
    pivot.rotation.y = yaw;
    mirror.rotation.y = yaw;
    shadow.update(scene, [mirror, floor]);
    renderer.render(scene, camera);
    if (first) {
      first = false;
      opts.onFirstFrame?.();
    }
  };

  /* laço: só desenha visível e ativo; parado de verdade, para de desenhar */
  let raf = 0,
    visible = true,
    active = true,
    running = false,
    last = performance.now(),
    tick = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!visible || !active || document.hidden) {
      running = false;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    physics(dt);
    // girando sozinho: 30 quadros bastam (poupa bateria); no dedo: 60
    const calm = !dragging && Math.abs(yawV) < 0.05 && Math.abs(tiltV) < 0.01;
    if (first || !calm || (++tick & 1) === 0) draw();
    const still = calm && (idleSpin === 0 || reduced) && Math.abs(tilt) < 0.001;
    if (still && !first) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  const wake = () => {
    if (running || !visible || !active) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
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
      spin(v: number) {
        idleSpin = v;
        idleFor = 5;
      },
      drag(dx: number) {
        yaw += dx;
        yawV = dx * 30;
        idleFor = 0;
      },
      stop() {
        cancelAnimationFrame(raf);
        running = false;
        visible = false;
      },
    },
    setActive(on: boolean) {
      active = on;
      if (on) wake();
    },
    destroy() {
      cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      shadow.dispose();
      envRT.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
