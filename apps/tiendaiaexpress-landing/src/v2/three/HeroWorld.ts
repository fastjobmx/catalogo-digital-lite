// Hero 3D world (WebGL): real product photos of the pilot store as thick tiles and three modelled phones
// with real store captures, floating at different depths in a dark space with fog. Nothing moves on its
// own after a short entrance (< 2 s): the scroll flies the camera through the space and a fine pointer
// turns it a little. The sticky hero writes --rise / --c4 on its element; this scene reads them.
import { Fog, Group, MathUtils, PerspectiveCamera, Scene, Vector2 } from 'three'
import { products, screens } from '../../content/media'
import { compile, disposeTree, face, loadTextures, materials, mountRenderer, phone, PHONE_SCREEN, seeded, tile } from './engine'

type Item = { group: Group; base: { x: number; y: number; z: number; rx: number; ry: number; rz: number } }

export default function createHeroWorld(host: HTMLElement, vars: HTMLElement) {
  const scene = new Scene()
  scene.fog = new Fog('#000000', 8, 30)
  const camera = new PerspectiveCamera(34, 1, 0.1, 60)
  const { renderer, dispose: disposeRenderer } = mountRenderer(host, (w, h) => { camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix() })

  const m = materials()
  const photos = products.filter((p) => p.src).map((p) => p.src as string)
  const captures = [screens.home, screens.catalog, screens.product]
  const faces: ReturnType<typeof face>[] = []
  const textures = loadTextures([...photos, ...captures], renderer, (i) => { faces.filter((f) => f.texture === textures[i]).forEach((f) => { f.material.uniforms.ready.value = 1 }) })
  const photoTex = textures.slice(0, photos.length)
  const captureTex = textures.slice(photos.length)

  const rand = seeded(2026)
  const items: Item[] = []
  const world = new Group()
  scene.add(world)
  // Portrait screens (phones): no near pieces at all, so nothing ever crosses the text; only the deep,
  // fogged ones remain. Wide screens: near pieces stay outside the headline's column.
  const wide = host.clientWidth / Math.max(host.clientHeight, 1) > 1
  const place = (group: Group, nearWanted: boolean) => {
    const near = nearWanted && wide
    const side = rand() < 0.5 ? -1 : 1
    const x = near ? side * (3.5 + rand() * 3) : (rand() * 2 - 1) * (wide ? 6.5 : 3.2)
    const y = (rand() * 2 - 1) * (near ? 2.6 : 3.6)
    const z = near ? -1 - rand() * 7 : -9 - rand() * 16
    const base = { x, y, z, rx: (rand() - 0.5) * 0.9, ry: (rand() - 0.5) * 1.4 - side * 0.35, rz: (rand() - 0.5) * 0.5 }
    group.position.set(x, y, z)
    world.add(group)
    items.push({ group, base })
  }
  // Phones get fewer pieces (they are all far away there anyway).
  for (let i = 0; i < (wide ? 16 : 8); i++) {
    const f = face(photoTex[i % photoTex.length], 0.92, 0.92, 0.1)
    faces.push(f)
    const g = tile(m, f, 0.85 + rand() * 0.5)
    place(g, i < 9)
  }
  for (let i = 0; i < 3; i++) {
    const f = face(captureTex[i], PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105, new Vector2(1, 1))
    faces.push(f)
    const g = phone(m, f)
    g.scale.setScalar(1.15)
    place(g, true)
  }

  let px = 0
  let py = 0
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    px = (e.clientX / window.innerWidth) * 2 - 1
    py = (e.clientY / window.innerHeight) * 2 - 1
  }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const s = { cx: 0, cy: 0, z: 9, intro: 0 }
  let active = true
  let compiled = false
  let raf = 0
  let last = performance.now()
  const read = (name: string) => parseFloat(vars.style.getPropertyValue(name)) || 0
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (!active || !compiled) { last = now; return }
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    const rise = read('--rise')
    const c3 = read('--c3')
    const c4 = read('--c4')
    s.intro = MathUtils.damp(s.intro, 1, 2.4, dt)
    // The camera flies into the space with the scroll and drifts toward the pointer.
    s.z = MathUtils.damp(s.z, 9 - rise * 6 - c3 * 2 - c4 * 6, 5, dt)
    s.cx = MathUtils.damp(s.cx, px * 0.7, 3, dt)
    s.cy = MathUtils.damp(s.cy, -py * 0.45, 3, dt)
    camera.position.set(s.cx, s.cy, s.z)
    camera.lookAt(s.cx * 0.3, s.cy * 0.3, s.z - 10)
    const enter = 1 - s.intro
    for (const it of items) {
      const { group, base } = it
      // Entrance: everything arrives from deep space and settles; then scroll turns each piece slightly.
      group.position.set(base.x * (1 + enter * 0.6), base.y, base.z - enter * 14)
      group.rotation.set(base.rx + rise * 0.35, base.ry + rise * 0.6 * Math.sign(base.x || 1), base.rz)
    }
    for (const f of faces) f.material.uniforms.sheen.value = 0.4 + s.cx * 0.3 + rise * 0.5
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
