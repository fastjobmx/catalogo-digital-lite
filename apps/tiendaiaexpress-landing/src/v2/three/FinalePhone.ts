// Finale in real 3D (WebGL, tablet and desktop): next to the product on its stage, a modelled phone with
// the real pilot store comes forward out of the dark, stands on the reflective floor and turns to face you
// as the scroll moves through the scene: the product and the store where it is sold. No autonomous motion.
import { Group, MathUtils, MeshMatcapMaterial, PerspectiveCamera, Scene } from 'three'
import { compile, disposeTree, face, loadTextures, materials, mountRenderer, phone, PHONE, PHONE_SCREEN } from './engine'

const FOV = 30
const DIST = 10

export default function createFinalePhone(host: HTMLElement, capture: string, progress: () => number) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60)
  camera.position.set(0, 0.2, DIST)
  camera.lookAt(0, 0, 0)
  let aspect = 16 / 9
  const { renderer, dispose: disposeRenderer } = mountRenderer(host, (w, h) => { aspect = w / Math.max(h, 1); camera.aspect = aspect; camera.updateProjectionMatrix() })

  const m = materials()
  const [texture] = loadTextures([capture], renderer, () => { screen.material.uniforms.ready.value = 1; mirrorScreen.material.uniforms.ready.value = 1 })
  const screen = face(texture, PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105)
  const mirrorScreen = face(texture, PHONE_SCREEN.w, PHONE_SCREEN.h, 0.105)
  mirrorScreen.material.uniforms.opacity.value = 0.22
  mirrorScreen.material.uniforms.fade.value = 1
  const reflectionBody = new MeshMatcapMaterial({ matcap: m.body.matcap, transparent: true, opacity: 0.18, depthWrite: false })

  const rig = new Group()
  const p = phone(m, screen)
  const q = phone({ ...m, body: reflectionBody, glass: reflectionBody }, mirrorScreen)
  rig.add(p)
  scene.add(rig)
  const mirror = new Group()
  mirror.add(q)
  scene.add(mirror)

  let px = 0
  const onPointer = (e: PointerEvent) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') px = (e.clientX / window.innerWidth) * 2 - 1 }
  window.addEventListener('pointermove', onPointer, { passive: true })

  const s = { k: 0, cx: 0 }
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
    s.k = MathUtils.damp(s.k, MathUtils.clamp((progress() - 0.1) / 0.55, 0, 1), 5, dt)
    s.cx = MathUtils.damp(s.cx, px * 0.3, 3, dt)
    const k = smooth(s.k)
    const visH = 2 * DIST * Math.tan(MathUtils.degToRad(FOV / 2))
    const visW = visH * aspect
    const floor = -visH * 0.16
    const scale = (visH * 0.42) / PHONE.h
    const x = visW * 0.3
    const y = floor + (PHONE.h * scale) / 2 + 0.08
    p.scale.setScalar(scale)
    q.scale.setScalar(scale)
    rig.position.set(MathUtils.lerp(x * 1.35, x, k), y, MathUtils.lerp(-9, 0.3, k))
    rig.rotation.set(MathUtils.lerp(0.25, 0.02, k), MathUtils.lerp(2.4, -0.42, k) + s.cx, MathUtils.lerp(0.12, 0, k))
    // The reflection mirrors the phone across the floor; it shows once the phone has come forward.
    mirror.position.set(rig.position.x, 2 * floor - rig.position.y, rig.position.z)
    mirror.rotation.set(-rig.rotation.x, rig.rotation.y, -rig.rotation.z)
    mirror.scale.set(1, -1, 1)
    mirror.visible = k > 0.2
    screen.material.uniforms.sheen.value = 0.35 + rig.rotation.y * 1.1
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
