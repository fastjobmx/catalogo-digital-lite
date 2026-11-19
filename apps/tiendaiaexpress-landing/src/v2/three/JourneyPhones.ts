// The buyer's journey in real 3D (WebGL, desktop): three modelled phones with the real product page, the
// real cart and the order message as the merchant receives it. Each phone lands exactly where its step is
// laid out (it reads the position of the step's CSS phone, which stays in the page for layout and screen
// readers). The scroll brings them in from a stack in depth, opens them into a fan and then turns them to
// face you; a fine pointer moves the camera a little. No autonomous motion.
import { Group, MathUtils, PerspectiveCamera, Scene } from 'three'
import { compile, disposeTree, face, loadTextures, materials, mountRenderer, phone, PHONE, PHONE_SCREEN } from './engine'

const FOV = 30
const DIST = 12

export default function createJourneyPhones(host: HTMLElement, captures: string[], targets: () => HTMLElement[], progress: () => number) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60)
  camera.position.set(0, 0, DIST)
  let width = 1
  let height = 1
  const { renderer, dispose: disposeRenderer } = mountRenderer(host, (w, h) => { width = w; height = h; camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix() })

  const m = materials()
  const faces: ReturnType<typeof face>[] = []
  const textures = loadTextures(captures, renderer, (i) => { faces.filter((f) => f.texture === textures[i]).forEach((f) => { f.material.uniforms.ready.value = 1 }) })
  const phones: Group[] = captures.map((_, i) => {
    const f = face(textures[i], PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105)
    faces.push(f)
    const p = phone(m, f)
    scene.add(p)
    return p
  })

  let px = 0
  let py = 0
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    px = (e.clientX / window.innerWidth) * 2 - 1
    py = (e.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const s = { cx: 0, cy: 0, k: 0 }
  let active = true
  let compiled = false
  let raf = 0
  let last = performance.now()
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (!active || !compiled) { last = now; return }
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    const p = progress()
    // 0 → 1 while the section comes in: the stack opens; 1 → 2 while it is read: the fan turns to face you.
    s.k = MathUtils.damp(s.k, MathUtils.clamp((p - 0.04) / 0.34, 0, 1) + MathUtils.clamp((p - 0.42) / 0.25, 0, 1), 5, dt)
    s.cx = MathUtils.damp(s.cx, px * 0.35, 3, dt)
    s.cy = MathUtils.damp(s.cy, -py * 0.25, 3, dt)
    camera.position.set(s.cx, s.cy, DIST)
    camera.lookAt(s.cx * 0.2, s.cy * 0.2, 0)
    const hostRect = host.getBoundingClientRect()
    const visH = 2 * DIST * Math.tan(MathUtils.degToRad(FOV / 2))
    const unit = visH / Math.max(height, 1)
    const open = smooth(Math.min(1, s.k))
    const face2 = smooth(Math.max(0, s.k - 1))
    targets().forEach((el, i) => {
      const g = phones[i]
      if (!g) return
      const r = el.getBoundingClientRect()
      const x = (r.left + r.width / 2 - hostRect.left - width / 2) * unit
      const y = (height / 2 - (r.top + r.height / 2 - hostRect.top)) * unit
      const scale = (r.height * unit) / PHONE.h
      const side = i - 1 // -1, 0, 1
      // Closed: stacked in the middle, deep and turned; open: in place, fanned toward the centre.
      g.position.set(MathUtils.lerp(side * 0.25, x, open), MathUtils.lerp(-1.4 - Math.abs(side) * 0.2, y, open), MathUtils.lerp(-5 - Math.abs(side) * 1.2, side === 0 ? 0.6 : 0, open))
      g.scale.setScalar(scale)
      const fanY = -side * MathUtils.lerp(0.42, 0.14, face2)
      g.rotation.set(MathUtils.lerp(0.5, 0.03, open), MathUtils.lerp(-side * 1.1 + 0.6, fanY, open), MathUtils.lerp(side * 0.18, 0, open))
      faces[i].material.uniforms.sheen.value = 0.35 + g.rotation.y * 1.2
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
      disposeRenderer()
    },
  }
}
