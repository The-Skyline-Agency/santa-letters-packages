// A real paper diorama: every tree, house and ornament is its own sheet standing at its own depth.
// One light casts their shadows onto the sheets behind and follows the pointer; the camera moves
// with the pointer and the scroll, so the layers slide against each other the way cut paper does.
import gsap from 'gsap';
import {
  AmbientLight, BufferAttribute, BufferGeometry, CircleGeometry, Color, DirectionalLight, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshDepthMaterial, MeshLambertMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PointLight,
  Points, RGBADepthPacking, Raycaster, SRGBColorSpace, Scene, ShaderMaterial, ShadowMaterial, Shape, ShapeGeometry,
  TextureLoader, Vector2, Vector3, WebGLRenderer, type Object3D, type Texture,
} from 'three';

export interface Piece {
  /** sprite url */
  src: string;
  /** stand = hinged to the ground; hang = on a string from the ceiling; fly = crosses the sky */
  kind: 'stand' | 'hang' | 'fly';
  x: number;
  z: number;
  /** height in world units (a house is about 1.5) */
  h: number;
  /** ground height for hills; string length for hang; cruising height for fly */
  y?: number;
  /** warm window light + chimney smoke */
  home?: boolean;
  /** clicking it sends a letter flying */
  mail?: boolean;
}
export interface SceneSpec {
  ground: 'shelf' | 'hills';
  pieces: Piece[];
  envelope?: string;
  snow: number;
  /** narrowest slice of the scene, in world units, that must stay visible on a phone */
  minWidth: number;
}
export interface SceneState { pop: number; scroll: number; ready?: () => void }

const CAM = 12;
const GROUND = -1.75;
const WALL = -3.4;
const NIGHT = '#1e4a3c';
const SNOW = '#f6efe2';

const loader = new TextureLoader();
const loaded = new Map<string, Promise<Texture>>();
const load = (url: string) => {
  if (!loaded.has(url)) loaded.set(url, new Promise<Texture>((res, rej) => loader.load(url, (t) => { t.colorSpace = SRGBColorSpace; res(t); }, undefined, rej)));
  return loaded.get(url)!;
};

/** a sheet whose origin is its bottom centre, so it can hinge up from the ground */
function sheet(tex: Texture, h: number, anchor: 'bottom' | 'top' | 'center' = 'bottom') {
  const img = tex.image as { width: number; height: number };
  const w = (h * img.width) / img.height;
  const geo = new PlaneGeometry(w, h);
  geo.translate(0, anchor === 'bottom' ? h / 2 : anchor === 'top' ? -h / 2 : 0, 0);
  const mesh = new Mesh(geo, new MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.04, side: DoubleSide }));
  // the shadow is cut by the sprite's alpha, so a tree casts a tree-shaped shadow
  mesh.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: tex, alphaTest: 0.5 });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function scallopedApron(width: number, drop: number, r: number) {
  const s = new Shape();
  s.moveTo(-width / 2, 0).lineTo(width / 2, 0).lineTo(width / 2, -drop);
  for (let cx = width / 2 - r; cx > -width / 2; cx -= 2 * r) s.absarc(cx, -drop, r, 0, -Math.PI, true);
  s.lineTo(-width / 2, 0);
  return new ShapeGeometry(s, 10);
}

function hill(width: number, base: number, wave: (x: number) => number) {
  const s = new Shape();
  s.moveTo(-width / 2, base);
  for (let x = -width / 2; x <= width / 2; x += 0.25) s.lineTo(x, wave(x));
  s.lineTo(width / 2, base);
  return new ShapeGeometry(s);
}

function star(r: number) {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rad = i % 2 ? r * 0.45 : r;
    s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  return new ShapeGeometry(s);
}

const snowVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime; uniform float uPx; uniform vec3 uBox;
  varying float vFade;
  void main() {
    vec3 p = position;
    p.y = mod(p.y - uTime * (0.25 + aSeed.x * 0.35), uBox.y) - uBox.y * 0.5 + 1.0;
    p.x += sin(uTime * 0.6 + aSeed.y * 30.0) * 0.18;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (0.7 + aSeed.z) * 30.0 / -mv.z;
    vFade = 0.7 + aSeed.w * 0.3;
  }`;
const snowFrag = /* glsl */ `
  precision highp float; varying float vFade;
  void main() {
    float a = smoothstep(0.5, 0.34, length(gl_PointCoord - 0.5)) * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.985, 0.96, 0.915, a);
  }`;

export async function mountPaperScene(el: HTMLElement, spec: SceneSpec, state: SceneState) {
  const textures = await Promise.all(spec.pieces.map((p) => load(p.src)));
  const envelopeTex = spec.envelope ? await load(spec.envelope) : null;

  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  const phone = matchMedia('(max-width: 700px)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  el.append(canvas);

  const scene = new Scene();
  scene.background = new Color(NIGHT);
  const camera = new PerspectiveCamera(30, 1, 0.1, 60);

  scene.add(new AmbientLight('#fff6ea', 1.95));
  const key = new DirectionalLight('#fff1dc', 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -13, right: 13, top: 8, bottom: -7, near: 1, far: 40 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.target.position.set(0, -1, -1.5);
  scene.add(key, key.target);

  // the wall only shows shadows, so the fir green stays one flat colour
  // it starts at ground level: nothing above the shelf may throw a shadow onto the wall under it
  const wall = new Mesh(new PlaneGeometry(60, 30), new ShadowMaterial({ opacity: 0.24 }));
  wall.position.set(0, GROUND + 15, WALL);
  wall.receiveShadow = true;
  scene.add(wall);

  const paper = (color: string) => new MeshLambertMaterial({ color });
  const world = new Group();
  scene.add(world);
  // on hills, a piece stands just behind the next sheet of snow, its foot tucked under that sheet's edge
  const hills: Array<{ z: number; wave: (x: number) => number }> = [];
  const footing = (p: Piece) => (hills.find((l) => l.z > p.z)?.wave(p.x) ?? GROUND) - 0.14;
  const popEase = gsap.parseEase('back.out(1.5)');

  if (spec.ground === 'shelf') {
    const top = new Mesh(new PlaneGeometry(60, 4.2), paper(SNOW));
    top.rotation.x = -Math.PI / 2;
    top.position.set(0, GROUND, WALL + 2.1);
    top.receiveShadow = true;
    const apron = new Mesh(scallopedApron(60, 0.42, 0.24), paper(SNOW));
    apron.position.set(0, GROUND, WALL + 4.2);
    apron.castShadow = true;
    apron.receiveShadow = true;
    // a catcher just behind the apron holds the shelf's own shadow under the scallops
    const under = new Mesh(new PlaneGeometry(60, 6), new ShadowMaterial({ opacity: 0.4 }));
    under.position.set(0, GROUND - 3, WALL + 3.75);
    under.receiveShadow = true;
    world.add(top, apron, under);
  } else {
    // stacked snow hills, each sheet a little nearer and a little lower
    const tones = ['#cbbd9f', '#d9cdb1', '#e6dcc4', '#efe7d4', SNOW];
    tones.forEach((tone, i) => {
      const z = WALL + 1 + i * 0.95, lift = 0.55 - i * 0.3, ph = i * 1.7;
      const wave = (x: number) => GROUND + lift + Math.sin(x * 0.42 + ph) * 0.34 + Math.sin(x * 0.17 + ph * 2.0) * 0.3;
      hills.push({ z, wave });
      const m = new Mesh(hill(60, -8, wave), i === tones.length - 1 ? new MeshBasicMaterial({ color: tone }) : paper(tone));
      m.position.z = z;
      m.castShadow = i > 0;
      m.receiveShadow = true;
      world.add(m);
    });
  }

  // stars are stuck a finger's width off the wall, so each one has its own little shadow
  const starMat = paper('#f3e7cf');
  const stars: Mesh[] = [];
  for (let i = 0; i < 26; i++) {
    const m = new Mesh(star(0.05 + Math.random() * 0.09), starMat);
    m.position.set((Math.random() - 0.5) * 24, GROUND + 1.6 + Math.random() * 6.5, WALL + 0.07);
    m.rotation.z = Math.random() * Math.PI;
    m.castShadow = true;
    stars.push(m);
    world.add(m);
  }

  interface Live { piece: Piece; node: Object3D; body: Mesh; swing?: { a: number; v: number }; base: number }
  const live: Live[] = [];
  const hangers: Live[] = [];
  const flyers: Live[] = [];
  const glow: PointLight[] = [];
  const puffs: Mesh[] = [];

  spec.pieces.forEach((piece, i) => {
    const tex = textures[i];
    if (piece.kind === 'stand') {
      const body = sheet(tex, piece.h);
      const base = spec.ground === 'shelf' ? GROUND : footing(piece);
      body.position.set(piece.x, base, piece.z);
      body.renderOrder = 10 + piece.z;
      world.add(body);
      live.push({ piece, node: body, body, base });
      if (piece.home) {
        const lamp = new PointLight('#ffb347', 2, 3.6, 1.8);
        lamp.position.set(piece.x, base + piece.h * 0.3, piece.z + 0.7);
        glow.push(lamp);
        world.add(lamp);
        for (let n = 0; n < 3; n++) {
          const puff = new Mesh(new CircleGeometry(0.045, 20), new MeshBasicMaterial({ color: '#f3ecdc', transparent: true, opacity: 0 }));
          puff.userData = { x: piece.x + piece.h * 0.22, y: base + piece.h * 0.98, delay: n * 1.3 + i * 0.4 };
          puff.position.z = piece.z - 0.05;
          puffs.push(puff);
          world.add(puff);
        }
      }
    } else if (piece.kind === 'hang') {
      const node = new Group();
      const len = piece.y ?? 2;
      const string = new Mesh(new PlaneGeometry(0.014, len), new MeshBasicMaterial({ color: '#d8c9a8' }));
      string.position.y = -len / 2;
      const body = sheet(tex, piece.h, 'top');
      body.position.y = -len + piece.h * 0.06;
      node.add(string, body);
      node.position.set(piece.x, 0, piece.z);
      world.add(node);
      const item = { piece, node, body, swing: { a: (Math.random() - 0.5) * 0.5, v: 0 }, base: 0 };
      live.push(item);
      hangers.push(item);
    } else {
      const body = sheet(tex, piece.h, 'center');
      body.position.z = piece.z;
      world.add(body);
      flyers.push({ piece, node: body, body, base: 0 });
    }
  });

  let envelope: Mesh | null = null;
  if (envelopeTex) {
    envelope = sheet(envelopeTex, 0.42, 'center');
    envelope.visible = false;
    world.add(envelope);
  }

  const flakes = phone ? Math.round(spec.snow * 0.6) : spec.snow;
  const box = new Vector3(26, 11, 5.5);
  const pos = new Float32Array(flakes * 3), seeds = new Float32Array(flakes * 4);
  for (let i = 0; i < flakes; i++) {
    pos.set([(Math.random() - 0.5) * box.x, Math.random() * box.y, WALL + 0.3 + Math.random() * box.z], i * 3);
    seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const snowGeo = new BufferGeometry();
  snowGeo.setAttribute('position', new BufferAttribute(pos, 3));
  snowGeo.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  const snowUniforms = { uTime: { value: 0 }, uPx: { value: 1 }, uBox: { value: box } };
  const snow = new Points(snowGeo, new ShaderMaterial({ uniforms: snowUniforms, vertexShader: snowVert, fragmentShader: snowFrag, transparent: true, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);

  // ---- framing: fit by height on wide screens, by width on phones, ground kept near the bottom
  let top = 3.2, halfW = 6, reel = 0;
  const frame = { y: 0, h: 6.4 };
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    frame.h = Math.max(7, spec.minWidth / camera.aspect);
    camera.fov = (2 * Math.atan(frame.h / 2 / CAM) * 180) / Math.PI;
    frame.y = GROUND - (spec.ground === 'shelf' ? 1.3 : 1.9) + frame.h / 2;
    top = frame.y + frame.h / 2;
    halfW = (frame.h * camera.aspect) / 2;
    camera.updateProjectionMatrix();
    snowUniforms.uPx.value = renderer.getPixelRatio() * (h / 900);
    // on a narrow screen the strings are pulled up so the ornaments stay clear of the headline
    reel = camera.aspect < 0.9 ? 0.8 : 0;
    hangers.forEach((it) => {
      const side = it.piece.x < 0 ? -1 : 1;
      it.node.position.x = side * Math.max(0.5, halfW * 1.05 - 0.5 - Math.abs(it.piece.x) * (reel ? 0.55 : 1));
    });
  };
  new ResizeObserver(resize).observe(el);
  resize();

  // ---- pointer: camera, light and a ray for hover and click
  const pointer = new Vector2(), eased = new Vector2(), ndc = new Vector2(9, 9);
  const ray = new Raycaster();
  let hovered: Live | null = null;
  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (e.pointerType !== 'touch') pointer.set(ndc.x, ndc.y);
  };
  addEventListener('pointermove', onMove, { passive: true });

  const hop = (it: Live, strength = 1) => {
    if (it.swing) { it.swing.v += (Math.random() > 0.5 ? 1 : -1) * 2.2 * strength; return; }
    gsap.killTweensOf([it.body.scale, it.body.rotation]);
    gsap.timeline()
      .to(it.body.scale, { x: 1 + 0.08 * strength, y: 1 + 0.1 * strength, duration: 0.16, ease: 'power2.out' })
      .to(it.body.rotation, { z: 0.07 * strength * (Math.random() > 0.5 ? 1 : -1), duration: 0.16, ease: 'power2.out' }, 0)
      .to(it.body.scale, { x: 1, y: 1, duration: 0.9, ease: 'elastic.out(1, 0.35)' })
      .to(it.body.rotation, { z: 0, duration: 0.9, ease: 'elastic.out(1, 0.3)' }, '<');
  };
  const post = (it: Live) => {
    if (!envelope) return;
    const from = new Vector3(it.piece.x, it.base + it.piece.h * 0.8, it.piece.z + 0.2);
    gsap.killTweensOf([envelope.position, envelope.rotation]);
    envelope.visible = true;
    envelope.position.copy(from);
    gsap.timeline({ onComplete: () => { envelope!.visible = false; } })
      .to(envelope.position, { y: from.y + 2.6, duration: 0.7, ease: 'power2.out' })
      .to(envelope.position, { x: from.x + 3.5, duration: 1.6, ease: 'power1.inOut' }, 0)
      .to(envelope.rotation, { z: -Math.PI * 2, duration: 1.6, ease: 'power1.inOut' }, 0)
      .to(envelope.position, { y: top + 1, duration: 0.9, ease: 'power2.in' }, 0.7);
    envelope.rotation.z = 0;
  };
  const pick = () => {
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(live.map((l) => l.body), false)[0];
    return hit ? live.find((l) => l.body === hit.object)! : null;
  };
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('a, button, input')) return;
    // a tap sends no pointermove first, so aim the ray from the click itself
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const it = pick();
    if (!it) return;
    hop(it, 1.6);
    if (it.piece.mail) post(it);
  };
  el.parentElement!.addEventListener('click', onClick);

  // ---- the loop
  const lookAt = new Vector3();
  let raf = 0, t = 0, last = performance.now();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    eased.lerp(pointer, 1 - Math.exp(-dt * 2.2));

    // the pointer only nudges the camera: enough to feel the depth, not enough to make the scene swim
    camera.position.set(eased.x * 0.55, frame.y + eased.y * 0.16 + state.scroll * 1.4, CAM - state.scroll * 2.2);
    lookAt.set(eased.x * 0.08, frame.y - state.scroll * 0.6, WALL / 2);
    camera.lookAt(lookAt);
    key.position.set(-5 + eased.x * 3, 7 + eased.y * 1.2, 9);

    // pop-up: each standing sheet hinges up from flat, left to right
    live.forEach((it) => {
      if (it.piece.kind !== 'stand') return;
      const delay = (it.piece.x + 9) / 18 * 0.55 + (it.piece.z - WALL) * 0.03;
      const k = gsap.utils.clamp(0, 1, (1 - state.pop - delay) / 0.4);
      it.body.rotation.x = -(1 - popEase(k)) * (Math.PI / 2);
      it.body.visible = k > 0;
    });
    hangers.forEach((it, i) => {
      const s = it.swing!;
      s.v += (-Math.sin(s.a) * 5.5 - s.v * 0.5) * dt;
      s.a += s.v * dt;
      it.node.rotation.z = s.a + Math.sin(t * 0.7 + i) * 0.035;
      it.node.position.y = top + 0.4 + (it.piece.y ?? 2) * reel + state.pop * 4;
    });
    flyers.forEach((it, i) => {
      const span = halfW * 2 + 8, u = ((t * 0.55 + i * 9) % span) / span;
      it.node.position.x = -halfW - 4 + u * span;
      it.node.position.y = GROUND + (it.piece.y ?? 3.2) + Math.sin(u * Math.PI) * 0.5 + Math.sin(t * 1.6) * 0.05;
      it.node.rotation.z = Math.cos(u * Math.PI) * 0.16 + Math.sin(t * 1.6) * 0.02;
      it.node.visible = state.pop < 0.5;
    });
    stars.forEach((s, i) => s.scale.setScalar((0.82 + Math.sin(t * (0.8 + (i % 5) * 0.25) + i) * 0.18) * (1 - state.pop)));
    glow.forEach((g, i) => { g.intensity = (1.9 + Math.sin(t * 7 + i * 3) * 0.25 + Math.sin(t * 2.3 + i) * 0.45) * (1 - state.pop); });
    puffs.forEach((p) => {
      const u = ((t + p.userData.delay) % 3.9) / 3.9;
      p.position.x = p.userData.x + u * 0.45 + Math.sin(u * 6 + p.userData.delay) * 0.05;
      p.position.y = p.userData.y + u * 1.25;
      p.scale.setScalar(0.6 + u * 1.3);
      (p.material as MeshBasicMaterial).opacity = Math.sin(u * Math.PI) * 0.9 * (1 - state.pop);
    });
    snowUniforms.uTime.value = t;

    const over = state.pop < 0.05 ? pick() : null;
    if (over !== hovered) {
      hovered = over;
      el.parentElement!.style.cursor = over ? 'pointer' : '';
      if (over) hop(over, 0.7);
    }
    renderer.render(scene, camera);
  };
  new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }, { rootMargin: '80px' }).observe(el);

  renderer.render(scene, camera);
  el.classList.add('is-live');
  state.ready?.();
}
