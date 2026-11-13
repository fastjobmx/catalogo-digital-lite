// WebGL phone (lazy chunk). Plain Three.js: one object does not need a React renderer.
// Modelled in code (no third-party model, no HDR download). Screens are the real SneakerHub
// captures; each stage drives the pose through a PhoneDriver (motion/pose.ts), the same one the
// CSS fallback phone follows. Materials use the brand palette: night body, violet and cyan light.
import { useEffect, useRef } from 'react'
import {
  ACESFilmicToneMapping, CanvasTexture, Clock, ExtrudeGeometry, Group, MathUtils, Mesh, MeshBasicMaterial,
  MeshMatcapMaterial, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShaderMaterial, SRGBColorSpace, Texture,
  TextureLoader, Vector2, WebGLRenderer,
} from 'three'
import type { PhoneDriver } from '../motion/pose'
import { screens, type ScreenKey } from '../content/media'

const BODY = { w: 0.98, h: 2, d: 0.112, r: 0.15 }
const SCREEN = { w: 0.884, h: 0.884 * (844 / 390) }
const FOV = 30
const DIST = 10

const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
// Two real captures cross-faded, rounded-rect mask and a glass sheen that follows the rotation.
const screenFragment = /* glsl */ `
  uniform sampler2D mapA;
  uniform sampler2D mapB;
  uniform float mixv;
  uniform float sheen;
  uniform float ready;
  uniform vec2 size;
  uniform float radius;
  varying vec2 vUv;
  float roundedBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * size;
    float d = roundedBox(p, size * 0.5, radius);
    float alpha = 1.0 - smoothstep(-0.004, 0.0, d);
    vec3 col = mix(texture2D(mapA, vUv).rgb, texture2D(mapB, vUv).rgb, mixv);
    col = mix(vec3(0.98, 0.98, 0.99), col, ready);
    float band = smoothstep(0.2, 0.0, abs(vUv.x * 0.8 + vUv.y * 0.55 - sheen));
    col += band * vec3(0.07, 0.09, 0.1);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

/** Box with rounded corners (XY plane) and bevelled edges, centred on the origin. */
function roundedBox(width: number, height: number, depth: number, radius: number, bevel: number) {
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
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.0005),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 20,
  })
  geometry.center()
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Studio reflections as a matcap drawn in code: brand-coloured softboxes on a lit sphere.
 * Matcaps need no lights and no environment pre-filtering, so they compile quickly.
 */
function studioMatcap(base: [string, string, string], strength = 1) {
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
    g.save()
    g.translate(x, y)
    g.rotate(rotate)
    g.filter = `blur(${blur}px)`
    g.globalAlpha = alpha * strength
    g.fillStyle = color
    g.beginPath()
    g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) / 2)
    g.fill()
    g.restore()
  }
  soft(size * 0.3, size * 0.27, size * 0.36, size * 0.13, '#fafafd', 0.9, 6, -0.6) // key softbox
  soft(size * 0.86, size * 0.52, size * 0.07, size * 0.62, '#12dce7', 0.85, 7) // cyan rim (3D depth)
  soft(size * 0.5, size * 0.92, size * 0.5, size * 0.06, '#c52af1', 0.75, 8) // violet floor bounce
  soft(size * 0.14, size * 0.6, size * 0.05, size * 0.42, '#c52af1', 0.45, 6) // violet fill strip
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function createPhone(textures: Texture[]) {
  const screenMaterial = new ShaderMaterial({
    vertexShader: screenVertex,
    fragmentShader: screenFragment,
    transparent: true,
    toneMapped: false,
    uniforms: {
      mapA: { value: textures[0] },
      mapB: { value: textures[Math.min(1, textures.length - 1)] },
      mixv: { value: 0 },
      sheen: { value: 0.2 },
      ready: { value: 0 },
      size: { value: new Vector2(SCREEN.w, SCREEN.h) },
      radius: { value: 0.105 },
    },
  })
  const frame = new MeshMatcapMaterial({ matcap: studioMatcap(['#4a4a6e', '#1b1b2e', '#06060c']) })
  const glass = new MeshMatcapMaterial({ matcap: studioMatcap(['#2a2a40', '#0b0b13', '#020205'], 0.55) })
  const island = new MeshBasicMaterial({ color: '#030308' })

  const group = new Group()
  const add = (mesh: Mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); group.add(mesh); return mesh }
  add(new Mesh(roundedBox(BODY.w, BODY.h, BODY.d, BODY.r, 0.03), frame))
  add(new Mesh(roundedBox(BODY.w - 0.03, BODY.h - 0.03, 0.004, 0.135, 0.0015), glass), 0, 0, BODY.d / 2 + 0.002)
  add(new Mesh(new PlaneGeometry(SCREEN.w, SCREEN.h), screenMaterial), 0, 0, BODY.d / 2 + 0.0055)
  add(new Mesh(roundedBox(0.27, 0.075, 0.003, 0.0375, 0.001), island), 0, SCREEN.h / 2 - 0.07, BODY.d / 2 + 0.008)
  const longButton = roundedBox(0.02, 0.2, 0.05, 0.009, 0.004)
  const shortButton = roundedBox(0.02, 0.13, 0.05, 0.009, 0.004)
  add(new Mesh(longButton, frame), BODY.w / 2 + 0.006, 0.42, 0)
  add(new Mesh(shortButton, frame), -BODY.w / 2 - 0.006, 0.55, 0)
  add(new Mesh(shortButton, frame), -BODY.w / 2 - 0.006, 0.36, 0)
  return { group, screenMaterial }
}

export default function PhoneCanvas({ onReady, active, drive, screenKeys }: { onReady: () => void; active: boolean; drive: PhoneDriver; screenKeys: ScreenKey[] }) {
  const host = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const driveRef = useRef(drive)
  driveRef.current = drive

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    // Querying compile status blocks the main thread; shaders here are fixed and tested.
    renderer.debug.checkShaderErrors = import.meta.env.DEV
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
    el.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 50)
    camera.position.set(0, 0, DIST)

    const loader = new TextureLoader()
    let loaded = 0
    const textures = screenKeys.map((name) => {
      const t = loader.load(screens[name], () => { loaded += 1 })
      t.colorSpace = SRGBColorSpace
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      return t
    })
    const { group, screenMaterial } = createPhone(textures)
    scene.add(group)

    let width = 0
    let height = 0
    const resize = () => {
      width = el.clientWidth
      height = el.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    // Compile without blocking where the GPU allows it; the CSS phone stays visible meanwhile.
    let compiled = false
    renderer.compileAsync(scene, camera).then(() => { compiled = true }, () => { compiled = true })

    const clock = new Clock()
    const s = { rx: 0, ry: 0, rz: 0, cx: 0.5, cy: 0.5, h: 0.8, intro: 0, ready: 0, first: true }
    let frames = 0
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!activeRef.current || disposed || !compiled) return
      const dt = Math.min(clock.getDelta(), 1 / 20)
      const t = clock.elapsedTime
      const { pose, screen } = driveRef.current(width, height, t)
      if (s.first) { Object.assign(s, pose); s.first = false }
      for (const k of ['rx', 'ry', 'rz', 'cx', 'cy', 'h'] as const) s[k] = MathUtils.damp(s[k], pose[k], 6, dt)
      s.intro = MathUtils.damp(s.intro, 1, 2.6, dt)
      s.ready = MathUtils.damp(s.ready, loaded >= textures.length ? 1 : 0, 5, dt)

      const visH = 2 * DIST * Math.tan(MathUtils.degToRad(FOV / 2))
      const visW = visH * (width / Math.max(height, 1))
      const enter = 1 - s.intro
      group.position.set((s.cx - 0.5) * visW, (0.5 - s.cy) * visH + Math.sin(t * 0.9) * 0.035 - enter * 1.4, -enter * 3)
      group.scale.setScalar((s.h * visH) / BODY.h)
      // Three.js convention; the CSS phone applies rotateX(-rx) rotateY(ry) rotateZ(-rz).
      group.rotation.set(s.rx + enter * 0.5, s.ry + Math.sin(t * 0.5) * 0.015 - enter * 0.9, s.rz + enter * 0.12)
      const count = textures.length
      const index = Math.min(Math.floor(screen), count - 1)
      screenMaterial.uniforms.mapA.value = textures[index % count]
      screenMaterial.uniforms.mapB.value = textures[(index + 1) % count]
      screenMaterial.uniforms.mixv.value = Math.min(1, screen - index)
      screenMaterial.uniforms.sheen.value = 0.55 + group.rotation.y * 1.4
      screenMaterial.uniforms.ready.value = s.ready
      renderer.render(scene, camera)
      frames += 1
      if (frames === 3) onReady()
    }
    loop()

    const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf) }
    renderer.domElement.addEventListener('webglcontextlost', lost)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          if (o.material instanceof MeshMatcapMaterial) o.material.matcap?.dispose()
          o.geometry.dispose()
          const m = o.material as { dispose?: () => void }
          m.dispose?.()
        }
      })
      textures.forEach((t) => t.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
    // onReady and screenKeys are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="absolute inset-0" />
}
