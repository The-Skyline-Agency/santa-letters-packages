// Route plate: a flat illustration plus its depth map, drawn so the near paper hills slide
// further than the far ones as the pointer and the scroll move. No relighting: the depth map's
// steep edges turned it into dark rims.
import { Camera, Mesh, PlaneGeometry, Scene, ShaderMaterial, TextureLoader, Vector2, WebGLRenderer, type Texture } from 'three';

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap; uniform sampler2D uDepth;
  uniform vec2 uOff; uniform vec2 uCover;
  varying vec2 vUv;
  const float FOCUS = 0.35;
  void main() {
    // cover-fit like object-fit: cover, then zoom a touch so shifted edges never show
    vec2 base = (vUv - 0.5) * uCover / 1.05 + 0.5;
    float d = texture2D(uDepth, base).r;
    vec2 uv = base + uOff * (d - FOCUS);
    d = texture2D(uDepth, uv).r;
    gl_FragColor = texture2D(uMap, base + uOff * (d - FOCUS));
  }
`;

const pointer = new Vector2();
let listening = false;
const load = (url: string) => new Promise<Texture>((res, rej) => new TextureLoader().load(url, res, undefined, rej));

export async function mountDiorama(el: HTMLElement) {
  const [map, depth] = await Promise.all([load(el.dataset.color!), load(el.dataset.depth!)]);
  const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.domElement.setAttribute('aria-hidden', 'true');
  el.append(renderer.domElement);

  const uniforms = { uMap: { value: map }, uDepth: { value: depth }, uOff: { value: new Vector2() }, uCover: { value: new Vector2(1, 1) } };
  const scene = new Scene();
  const plate = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, depthTest: false }));
  plate.frustumCulled = false;
  scene.add(plate);
  const camera = new Camera();

  const img = map.image as { width: number; height: number };
  const resize = () => {
    renderer.setSize(el.clientWidth, el.clientHeight, false);
    const box = el.clientWidth / el.clientHeight, art = img.width / img.height;
    uniforms.uCover.value.set(Math.min(1, box / art), Math.min(1, art / box));
  };
  new ResizeObserver(resize).observe(el);
  resize();

  if (!listening) {
    listening = true;
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    }, { passive: true });
  }
  const eased = new Vector2();
  let raf = 0, last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    eased.lerp(pointer, 1 - Math.exp(-dt * 4));
    const rect = el.getBoundingClientRect();
    const scroll = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - innerHeight / 2) / innerHeight));
    uniforms.uOff.value.set(eased.x * 0.022, -eased.y * 0.014 - scroll * 0.03);
    renderer.render(scene, camera);
  };
  new IntersectionObserver(([entry]) => {
    cancelAnimationFrame(raf);
    if (entry.isIntersecting) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }, { rootMargin: '100px' }).observe(el);

  renderer.render(scene, camera);
  el.classList.add('is-live');
}
