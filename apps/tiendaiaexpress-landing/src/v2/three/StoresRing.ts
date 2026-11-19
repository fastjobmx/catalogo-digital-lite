// Real stores as a 3D carousel (WebGL): six modelled phones with the real captures of the authorized
// stores, standing on a ring with a soft floor reflection. The scroll turns the ring so each store comes to
// the front in turn; a fine pointer tilts the camera. No autonomous motion.
import { Group, MathUtils, MeshMatcapMaterial, PerspectiveCamera, Scene } from 'three'
import { compile, disposeTree, face, loadTextures, materials, mountRenderer, phone, PHONE, PHONE_SCREEN } from './engine'

export default function createStoresRing(host: HTMLElement, captures: string[], progress: () => number) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 60)
  const { renderer, dispose: disposeRenderer } = mountRenderer(host, (w, h) => {
    camera.aspect = w / Math.max(h, 1)
    // Narrow screens: step back so the front phone and its neighbours fit.
    camera.position.z = w < 640 ? 11.5 : 8.6
    camera.updateProjectionMatrix()
  })

  const m = materials()
  const faces: ReturnType<typeof face>[] = []
  const reflections: ReturnType<typeof face>[] = []
  const textures = loadTextures(captures, renderer, (i) => { [...faces, ...reflections].filter((f) => f.texture === textures[i]).forEach((f) => { f.material.uniforms.ready.value = 1 }) })
  const n = captures.length
  const R = 2.5
  const SCALE = 1.3
  const ring = new Group()
  const mirror = new Group()
  scene.add(ring)
  scene.add(mirror)
  const reflectionBody = new MeshMatcapMaterial({ matcap: m.body.matcap, transparent: true, opacity: 0.06, depthWrite: false })
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const f = face(textures[i], PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105)
    faces.push(f)
    const p = phone(m, f)
    p.scale.setScalar(SCALE)
    p.position.set(Math.sin(a) * R, 0, Math.cos(a) * R)
    p.rotation.y = a
    ring.add(p)
    // Floor reflection: the same phone upside down, faint and fading away from the floor.
    const rf = face(textures[i], PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105)
    rf.material.uniforms.opacity.value = 0.13
    rf.material.uniforms.fade.value = 1
    reflections.push(rf)
    const q = phone({ ...m, body: reflectionBody, glass: reflectionBody }, rf)
    q.scale.setScalar(SCALE)
    q.position.copy(p.position)
    q.rotation.y = a
    mirror.add(q)
  }
  mirror.scale.y = -1
  mirror.position.y = -PHONE.h * SCALE - 0.04
  let px = 0
  let py = 0
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    const r = host.getBoundingClientRect()
    px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
    py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const s = { turn: 0, cx: 0, cy: 0 }
  let active = true
  let compiled = false
  let raf = 0
  let last = performance.now()
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (!active || !compiled) { last = now; return }
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    // From entering the screen to leaving it the ring makes five steps: every store comes to the front.
    const target = -MathUtils.clamp((progress() - 0.18) / 0.62, 0, 1) * ((n - 1) / n) * Math.PI * 2
    s.turn = MathUtils.damp(s.turn, target, 4, dt)
    s.cx = MathUtils.damp(s.cx, px * 0.8, 3, dt)
    s.cy = MathUtils.damp(s.cy, py * 0.3, 3, dt)
    ring.rotation.y = s.turn
    mirror.rotation.y = s.turn
    ring.position.z = -R
    mirror.position.z = -R
    camera.position.x = s.cx
    camera.position.y = 0.9 - s.cy
    camera.lookAt(0, -0.25, -R * 0.4)
    faces.forEach((f, i) => {
      // Phones turned away get darker (depth); the one in front is fully lit.
      const a = (i / n) * Math.PI * 2 + s.turn
      const facing = (Math.cos(a) + 1) / 2
      f.material.uniforms.dim.value = 0.35 + 0.65 * facing
      f.material.uniforms.sheen.value = 0.3 + Math.sin(a) * 0.6
      reflections[i].material.uniforms.dim.value = 0.35 + 0.65 * facing
    })
    renderer.render(scene, camera)
  }
  compile(renderer, scene, camera).then(() => { compiled = true })
  raf = requestAnimationFrame(loop)

  return {
    setActive(on: boolean) { active = on },
    dispose() {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      disposeTree(scene)
      reflectionBody.dispose()
      disposeRenderer()
    },
  }
}
