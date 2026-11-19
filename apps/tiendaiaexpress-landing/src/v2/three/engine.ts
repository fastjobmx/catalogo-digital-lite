// Shared WebGL pieces for the V2 3D scenes (plain Three.js, already a dependency of the site; loaded as a
// lazy chunk only by /home-v2). Everything is modelled in code: no third-party models, no HDR downloads.
// Textures are the real captures and product photos already in the site.
import {
  ACESFilmicToneMapping, CanvasTexture, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshMatcapMaterial,
  PlaneGeometry, ShaderMaterial, Shape, SRGBColorSpace, Texture, TextureLoader, Vector2, WebGLRenderer,
} from 'three'

export const PHONE = { w: 0.98, h: 2, d: 0.112, r: 0.15 }
export const PHONE_SCREEN = { w: 0.884, h: 0.884 * (844 / 390) }

const shared = new Map<string, ExtrudeGeometry>()
/** Rounded box (XY plane) with bevelled edges, centred on the origin. Built once per size and shared by
 * every mesh that uses it (building extrusions is the costly part on slow phones). */
export function roundedBox(width: number, height: number, depth: number, radius: number, bevel: number) {
  const key = [width, height, depth, radius, bevel].join(':')
  let geometry = shared.get(key)
  if (!geometry) { geometry = buildRoundedBox(width, height, depth, radius, bevel); geometry.userData.shared = true; shared.set(key, geometry) }
  return geometry
}
function buildRoundedBox(width: number, height: number, depth: number, radius: number, bevel: number) {
  const w = width / 2 - bevel
  const h = height / 2 - bevel
  const r = Math.min(radius, w, h)
  const shape = new Shape()
  shape.moveTo(-w + r, -h)
  shape.lineTo(w - r, -h)
  shape.quadraticCurveTo(w, -h, w, -h + r)
  shape.lineTo(w, h - r)
  shape.quadraticCurveTo(w, h, w - r, h)
  shape.lineTo(-w + r, h)
  shape.quadraticCurveTo(-w, h, -w, h - r)
  shape.lineTo(-w, -h + r)
  shape.quadraticCurveTo(-w, -h, -w + r, -h)
  const geometry = new ExtrudeGeometry(shape, { depth: Math.max(depth - bevel * 2, 0.0005), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 16 })
  geometry.center()
  geometry.computeVertexNormals()
  return geometry
}

/** Studio reflections drawn in code as a matcap: a white key softbox, a lime rim (the brand) and a floor bounce. */
export function studioMatcap(base: [string, string, string], strength = 1, rim = '#d9ff18') {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const c = size / 2
  const sphere = g.createRadialGradient(c * 0.82, c * 0.72, size * 0.05, c, c, c)
  sphere.addColorStop(0, base[0])
  sphere.addColorStop(0.55, base[1])
  sphere.addColorStop(1, base[2])
  g.fillStyle = sphere
  g.fillRect(0, 0, size, size)
  const soft = (x: number, y: number, w: number, h: number, color: string, alpha: number, blur: number, rotate = 0) => {
    g.save(); g.translate(x, y); g.rotate(rotate); g.filter = `blur(${blur}px)`; g.globalAlpha = alpha * strength
    g.fillStyle = color; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2); g.fill(); g.restore()
  }
  soft(size * 0.3, size * 0.27, size * 0.36, size * 0.13, '#fafafd', 0.9, 6, -0.6)
  soft(size * 0.86, size * 0.52, size * 0.06, size * 0.6, rim, 0.7, 7)
  soft(size * 0.5, size * 0.93, size * 0.5, size * 0.06, '#ffffff', 0.35, 8)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

const faceVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
// A photo or capture on a rounded face, with a glass sheen that follows the rotation, a dim factor (depth)
// and, for floor reflections, an opacity that fades away from the floor.
const faceFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float ready;
  uniform float sheen;
  uniform float dim;
  uniform vec2 size;
  uniform float radius;
  uniform vec2 cover;
  uniform float opacity;
  uniform float fade;
  varying vec2 vUv;
  float roundedBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * size;
    float d = roundedBox(p, size * 0.5, radius);
    float alpha = 1.0 - smoothstep(-0.004, 0.0, d);
    vec2 uv = (vUv - 0.5) * cover + 0.5;
    vec3 col = mix(vec3(0.93, 0.93, 0.95), texture2D(map, uv).rgb, ready);
    float band = smoothstep(0.22, 0.0, abs(vUv.x * 0.8 + vUv.y * 0.55 - sheen));
    col += band * vec3(0.08);
    // fade > 0: a floor reflection that disappears away from the floor (vUv.y = 0 touches it).
    alpha *= opacity * mix(1.0, 1.0 - smoothstep(0.0, 0.32, vUv.y), fade);
    gl_FragColor = vec4(col * dim, alpha);
    #include <colorspace_fragment>
  }
`

export type Face = { material: ShaderMaterial; texture: Texture }

/** A rounded face showing an image (object-fit: cover by `cover`, top-aligned for phone captures). */
export function face(texture: Texture, width: number, height: number, radius: number, cover = new Vector2(1, 1)): Face {
  const material = new ShaderMaterial({
    vertexShader: faceVertex, fragmentShader: faceFragment, transparent: true, toneMapped: false,
    uniforms: { map: { value: texture }, ready: { value: 0 }, sheen: { value: 0.3 }, dim: { value: 1 }, size: { value: new Vector2(width, height) }, radius: { value: radius }, cover: { value: cover }, opacity: { value: 1 }, fade: { value: 0 } },
  })
  return { material, texture }
}

export type Materials = { body: MeshMatcapMaterial; glass: MeshMatcapMaterial; island: MeshBasicMaterial; card: MeshMatcapMaterial }
export function materials(): Materials {
  return {
    body: new MeshMatcapMaterial({ matcap: studioMatcap(['#55555c', '#1e1e22', '#060607']) }),
    glass: new MeshMatcapMaterial({ matcap: studioMatcap(['#2b2b30', '#0c0c0f', '#020203'], 0.55) }),
    island: new MeshBasicMaterial({ color: '#030304' }),
    card: new MeshMatcapMaterial({ matcap: studioMatcap(['#ffffff', '#e3e3e8', '#a8a8b0'], 0.7) }),
  }
}

/** A modelled phone (body, glass, screen with a real capture, island, buttons). */
export function phone(m: Materials, screen: Face) {
  const group = new Group()
  const add = (mesh: Mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); group.add(mesh); return mesh }
  add(new Mesh(roundedBox(PHONE.w, PHONE.h, PHONE.d, PHONE.r, 0.03), m.body))
  add(new Mesh(roundedBox(PHONE.w - 0.03, PHONE.h - 0.03, 0.004, 0.135, 0.0015), m.glass), 0, 0, PHONE.d / 2 + 0.002)
  add(new Mesh(planeGeometry(PHONE_SCREEN.w, PHONE_SCREEN.h), screen.material), 0, 0, PHONE.d / 2 + 0.0055)
  add(new Mesh(roundedBox(0.27, 0.075, 0.003, 0.0375, 0.001), m.island), 0, PHONE_SCREEN.h / 2 - 0.07, PHONE.d / 2 + 0.008)
  add(new Mesh(roundedBox(0.02, 0.2, 0.05, 0.009, 0.004), m.body), PHONE.w / 2 + 0.006, 0.42, 0)
  add(new Mesh(roundedBox(0.02, 0.13, 0.05, 0.009, 0.004), m.body), -PHONE.w / 2 - 0.006, 0.5, 0)
  return group
}

/** A thick product tile: a pale rounded slab with the product photo on its face. */
export function tile(m: Materials, photo: Face, size = 1) {
  const group = new Group()
  group.add(new Mesh(roundedBox(1, 1, 0.09 / size, 0.12, 0.025), m.card))
  const front = new Mesh(planeGeometry(0.92, 0.92), photo.material)
  front.position.z = 0.047 / size
  group.add(front)
  group.scale.setScalar(size)
  return group
}
const planes = new Map<string, PlaneGeometry>()
/** Shared flat faces. */
function planeGeometry(w: number, h: number) {
  const key = `${w}:${h}`
  let g = planes.get(key)
  if (!g) { g = new PlaneGeometry(w, h); g.userData.shared = true; planes.set(key, g) }
  return g
}

/** Loads images as colour textures; calls back as each one is ready (the face fades in from a blank). */
export function loadTextures(urls: string[], renderer: WebGLRenderer, onEach: (index: number) => void) {
  const loader = new TextureLoader()
  return urls.map((url, i) => {
    const t = loader.load(url, () => onEach(i))
    t.colorSpace = SRGBColorSpace
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    return t
  })
}

/** Renderer on a host element: transparent, ACES, capped pixel ratio, resized with its host. */
export function mountRenderer(host: HTMLElement, onResize: (w: number, h: number) => void) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  // Phones: a lighter canvas (fewer pixels to shade); the screens stay sharp enough at 1.25.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.25 : 1.75))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.debug.checkShaderErrors = import.meta.env.DEV
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  host.appendChild(renderer.domElement)
  const resize = () => { const w = host.clientWidth; const h = host.clientHeight; renderer.setSize(w, h, false); onResize(w, h) }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  const lost = (e: Event) => e.preventDefault()
  renderer.domElement.addEventListener('webglcontextlost', lost)
  return {
    renderer,
    dispose() { ro.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); renderer.domElement.remove() },
  }
}

/** Compiles the scene's shaders without blocking where the GPU allows it; resolves either way. */
export function compile(renderer: WebGLRenderer, scene: Parameters<WebGLRenderer['compileAsync']>[0], camera: Parameters<WebGLRenderer['compileAsync']>[1]) {
  return renderer.compileAsync(scene, camera).catch(() => undefined)
}

/** Disposes every geometry, material and texture under a root. */
export function disposeTree(root: { traverse: (cb: (o: unknown) => void) => void }) {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return
    // Shared geometries stay for the other scenes (and the next mount); they are small.
    if (!o.geometry.userData.shared) o.geometry.dispose()
    const mat = o.material as { dispose?: () => void; matcap?: Texture | null; uniforms?: { map?: { value?: Texture } } }
    mat.matcap?.dispose()
    mat.uniforms?.map?.value?.dispose()
    mat.dispose?.()
  })
}

/** A tiny deterministic random (the layout is the same on every visit). */
export function seeded(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
