// Scene 1 + 2 · ONE product stage from the hero to the result (Fase G, approved concept A).
// The same DOM — the store (dominant) and the private admin chat (subordinate) — stays on screen while
// the page scrolls (CSS sticky). The scroll position gives a progress t (0…1) that drives everything,
// reversibly: the hero copy leaves, the stage settles, then 1 · the request, 2 · the summary and
// confirmation, 3 · the store shows the new price. Nothing plays by itself: «Ver el cambio» (and the hero's
// «Ver cómo funciona» link) plays the sequence once without moving the page; any wheel or touch gives
// control back to the scroll. Static mode (reduced motion or no JS): the stage at rest and a visible
// triptych with the three moments (also the screen-reader version in motion mode).
// SIMULATION: real products and prices of the SneakerHub Premium pilot store; illustrative messages;
// nothing leaves the page. Flow as the real assistant: summary with Confirmar / Corregir / Cancelar.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { site } from '../config/site'
import { products } from '../content/media'
import { Icon } from '../components/ui/Icon'
import { Cta } from './ui'
import floorArt from '../assets/v2/finale-stage.webp'
import turnClip from '../assets/v2/hero-turn.mp4'
import { useScene3D } from './three/useScene3D'
import { Price, REQUEST, SIM, STAGES, money, pilotName, storeHost, target } from './sim'

const GRID = ['ASTRAL-03', 'NORD-02', 'VANTA-01', 'KINETIK-06'].map((sku) => products.find((p) => p.sku === sku)).filter((p): p is (typeof products)[number] => Boolean(p))

const MOMENTS = [
  { label: '1 de 3', title: 'Un mensaje.', body: `Le escribes al asistente, en WhatsApp o Telegram, como a un colaborador: «${REQUEST}».` },
  { label: '2 de 3', title: 'Lo confirmas.', body: `Te muestra un resumen: ${money(SIM.oldPrice)} → ${money(SIM.newPrice)}. Nada se guarda hasta que tocas Confirmar; también puedes corregir o cancelar.` },
  { label: '3 de 3', title: 'Tu tienda, actualizada.', body: `En tu tienda, ${SIM.name} pasa a ${money(SIM.newPrice)}. Tus clientes ven el precio nuevo; ellos no hablan con el asistente.` },
]

const clamp = (n: number) => Math.min(1, Math.max(0, n))
/** Simulation stage for a progress t (keys of sim.STAGES). The request is there from the start. */
const stageAt = (t: number) => (t < 0.25 ? 1 : t < 0.43 ? 2 : t < 0.62 ? 3 : t < 0.72 ? 4 : t < 0.8 ? 5 : 6)
const momentAt = (t: number) => (t < 0.17 ? -1 : t < 0.45 ? 0 : t < 0.72 ? 1 : 2)
const PLAY_MS = 4800
/** Share of the sticky track used by the story; the rest is the "portal" (the camera enters the store's
 * white screen and the page turns light). Keep in sync with --hs-story in depth.css. */
export const STORY_SHARE = 0.72
const motionOn = () => typeof document !== 'undefined' && document.documentElement.classList.contains('motion')

function Store({ stage }: { stage: number }) {
  const updated = stage >= 6
  return (
    <div className="hs-store">
      <p className="hs-url">{storeHost}</p>
      <div className="hs-shead"><strong>{pilotName}</strong><span className="on">Todo</span><span>Urbano</span><span>Running</span><span>Accesorios</span><em>Carrito (0)</em></div>
      <ul className="hs-grid">
        {GRID.map((p) => {
          const isTarget = p.sku === target.sku
          return (
            <li key={p.sku} className={`hs-card ${isTarget ? 'is-target' : ''}`} data-updated={isTarget ? updated : undefined}>
              {isTarget ? <span className="hs-ring" /> : null}
              {isTarget ? (
                <span className="hs-photo">
                  <img src={p.src} alt="" width={480} height={480} loading="eager" decoding="async" />
                  {/* 3D: once the price is updated, the product lifts out of its card and turns (a clip made
                      with Google Flow from this same product photo, moved by the scroll; it never plays alone). */}
                  <video className="hs-turn" muted playsInline preload="none" tabIndex={-1} disablePictureInPicture />
                </span>
              ) : <img src={p.src} alt="" width={480} height={480} loading="eager" decoding="async" />}
              <div>
                <p className="hs-name">{p.name}</p>
                <p className="hs-price">
                  {isTarget && updated ? <s>{money(SIM.oldPrice)}</s> : null}
                  {isTarget ? <Price updated={updated} /> : <span>{money(p.price)}</span>}
                  {isTarget && updated ? <span className="hs-tag v2-pop">Actualizado</span> : null}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Chat({ stage }: { stage: number }) {
  return (
    <div className="hs-chat">
      <div className="hs-chead"><i /><span><b>Asistente TiendIA</b><small>Chat privado de administración</small></span></div>
      <ul className="hs-msgs">
        <li className={`hs-me ${stage >= 1 && stage < 6 ? 'v2-bubble' : 'hs-hide'}`}>{REQUEST}</li>
        <li className="hs-slot">
          {stage === 2 ? <span className="hs-typing v2-bubble v2-typing"><span /><span /><span /></span> : null}
          <div className={`hs-bot hs-sum ${stage >= 3 && stage < 6 ? 'v2-bubble' : 'hs-hide'}`}>
            <small>Resumen del cambio</small>
            <div>{SIM.name}</div>
            <div className="pp"><s>{money(SIM.oldPrice)}</s> → {money(SIM.newPrice)}</div>
            <div className="hs-btns"><span className={stage >= 4 ? 'is-on' : ''}>Confirmar</span><span>Corregir</span><span>Cancelar</span></div>
          </div>
        </li>
        <li className={`hs-me ${stage >= 4 ? 'v2-bubble' : 'hs-hide'}`}>Confirmar</li>
        <li className={`hs-bot ${stage >= 5 ? 'v2-bubble' : 'hs-hide'}`}>✓ Listo, precio actualizado.</li>
      </ul>
    </div>
  )
}

export function HeroStory() {
  const section = useRef<HTMLElement>(null)
  const sticky = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const playRaf = useRef(0)
  const [stage, setStage] = useState(1)
  const [moment, setMoment] = useState(-1)
  const [copyOff, setCopyOff] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Real 3D (WebGL): the product space behind the hero, loaded after the page is idle on capable devices.
  const world = useRef<HTMLDivElement>(null)
  const worldReady = useScene3D(world, (el) => import('./three/HeroWorld').then((m) => m.default(el, sticky.current!)))

  const turnReady = useRef(false)
  const turnT = useRef(0)

  /** Turns the product (0…1 of the clip). Only seeks; the clip is never played. */
  const seekTurn = useCallback((k: number) => {
    const v = section.current?.querySelector<HTMLVideoElement>('.hs-turn')
    if (!v || !turnReady.current || !v.duration) return
    const at = k * (v.duration - 0.05)
    if (Math.abs(v.currentTime - at) > 0.03) v.currentTime = at
  }, [])

  const apply = useCallback((t: number, portal = 0) => {
    const el = sticky.current
    if (!el) return
    el.style.setProperty('--rise', clamp(t / 0.17).toFixed(4))
    el.style.setProperty('--c2', clamp((t - 0.45) / 0.2).toFixed(4))
    el.style.setProperty('--c3', clamp((t - 0.74) / 0.16).toFixed(4))
    el.style.setProperty('--c4', clamp(portal).toFixed(4))
    // The product turns from the moment the price changes until the camera enters the screen.
    turnT.current = clamp((t - 0.8) / 0.2) * 0.55 + clamp(portal) * 0.45
    seekTurn(turnT.current)
    setStage(stageAt(t))
    setMoment(momentAt(t))
    setCopyOff(t > 0.12)
    setAtEnd(t >= 0.999)
  }, [])

  const fromScroll = useCallback(() => {
    raf.current = 0
    const el = section.current
    if (!el || playRaf.current) return
    const travel = el.offsetHeight - window.innerHeight
    const r = travel > 0 ? clamp(-el.getBoundingClientRect().top / travel) : 0
    apply(clamp(r / STORY_SHARE), (r - STORY_SHARE) / (1 - STORY_SHARE))
  }, [apply])

  const stop = useCallback(() => {
    if (!playRaf.current) return
    cancelAnimationFrame(playRaf.current)
    playRaf.current = 0
    setPlaying(false)
  }, [])

  /** Plays the whole sequence once, in place (the page does not move). requestAnimationFrame pauses by
   * itself in a hidden tab; any wheel or touch hands control back to the scroll. */
  const play = useCallback(() => {
    if (!motionOn()) return
    stop()
    setPlaying(true)
    const start = performance.now()
    const step = (now: number) => {
      const k = clamp((now - start) / PLAY_MS)
      apply(k)
      playRaf.current = k < 1 ? requestAnimationFrame(step) : 0
      if (k >= 1) setPlaying(false)
    }
    playRaf.current = requestAnimationFrame(step)
  }, [apply, stop])

  /** The portal zooms into the centre of the product photo: measured in the stage's own (untransformed)
   * coordinates, so it is exact at every width. */
  const aimPortal = useCallback(() => {
    const stage = section.current?.querySelector<HTMLElement>('.hs-stage')
    let node = section.current?.querySelector<HTMLElement>('.hs-card.is-target .hs-photo') ?? null
    if (!stage || !node) return
    let x = node.offsetWidth / 2
    let y = node.offsetHeight / 2
    while (node && node !== stage) {
      x += node.offsetLeft
      y += node.offsetTop
      node = node.offsetParent as HTMLElement | null
    }
    if (node !== stage) return
    stage.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`
    // …and brings that point to the centre of the screen while it zooms (the stage is pinned at --pin-y).
    const pinY = parseFloat(getComputedStyle(section.current!).getPropertyValue('--pin-y')) || 0
    stage.style.setProperty('--pdx', `${Math.round(window.innerWidth / 2 - ((window.innerWidth - stage.offsetWidth) / 2 + x))}px`)
    stage.style.setProperty('--pdy', `${Math.round(window.innerHeight / 2 - (pinY + y))}px`)
  }, [])

  useEffect(() => {
    if (!motionOn()) return
    aimPortal()
    const onScroll = () => { if (!raf.current) raf.current = requestAnimationFrame(fromScroll) }
    const onResize = () => { aimPortal(); onScroll() }
    const takeOver = () => { if (playRaf.current) { stop(); onScroll() } }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('wheel', takeOver, { passive: true })
    window.addEventListener('touchstart', takeOver, { passive: true })
    fromScroll()
    // The turn clip (about 1.5 MB) is fetched once the page has loaded and is idle, then played from memory
    // (scrubbing works on any server). Until it is ready, the product photo stays.
    const v = section.current?.querySelector<HTMLVideoElement>('.hs-turn')
    let blobUrl = ''
    let gone = false
    const onReady = () => { turnReady.current = true; section.current?.setAttribute('data-turn', 'ready'); seekTurn(turnT.current) }
    v?.addEventListener('loadeddata', onReady)
    const load = () => {
      if (!v) return
      fetch(turnClip)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => { if (gone) return; blobUrl = URL.createObjectURL(b); v.src = blobUrl; v.load() })
        .catch(() => { /* the photo stays */ })
    }
    const idle = window.setTimeout(load, 1800)
    return () => {
      gone = true
      window.clearTimeout(idle)
      v?.removeEventListener('loadeddata', onReady)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('wheel', takeOver)
      window.removeEventListener('touchstart', takeOver)
      cancelAnimationFrame(raf.current)
      cancelAnimationFrame(playRaf.current)
    }
  }, [fromScroll, stop, seekTurn, aimPortal])

  const onExplain = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!motionOn()) return // static mode: a plain jump to the triptych
    e.preventDefault()
    play()
  }

  return (
    <section ref={section} id="inicio" aria-labelledby="inicio-title" className="hs" data-stage={stage} data-stage-key={STAGES[stage].key} data-moment={moment} data-playing={playing}>
      <div ref={sticky} className="hs-sticky" data-copy={copyOff ? 'off' : 'on'} data-v2-tilt="">
        <div ref={world} className="hs-world" data-ready={worldReady ? 'true' : undefined} aria-hidden="true" />
        <div className="hs-copy">
          <p className="hs-kicker v2-enter" style={{ ['--d' as string]: 0 }}>Tu tienda online con IA. Tu control por chat.</p>
          <h1 id="inicio-title" className="hs-h1 v2-enter" style={{ ['--d' as string]: 80 }}><span>Tu tienda.</span> <span>Bajo tu control.</span></h1>
          <p className="hs-lead v2-enter" style={{ ['--d' as string]: 160 }}>Tus clientes compran en tu tienda. Tú actualizas productos, precios y existencias desde un chat privado.</p>
          <div className="hs-ctas v2-enter" style={{ ['--d' as string]: 240 }}>
            <Cta href={site.trialUrl} size="lg" external>Crear mi tienda gratis</Cta>
            <Cta href="#como-funciona" variant="quiet" onClick={onExplain}>Ver cómo funciona</Cta>
          </div>
          <p className="hs-trial v2-enter" style={{ ['--d' as string]: 300 }}><span className="sr-only">Condiciones de la prueba gratis: </span><span className="hs-trial-long">Prueba gratis de {site.trial.days} días · Sin tarjeta de crédito · Hasta {site.trial.products} productos</span><span className="hs-trial-short" aria-hidden="true">{site.trial.days} días gratis · Sin tarjeta · Hasta {site.trial.products} productos</span></p>
        </div>

        <div className="hs-narr" aria-hidden="true">
          {MOMENTS.map((m, n) => <p key={m.title} className={moment === n ? 'on' : ''}><small>{m.label}</small><strong>{m.title}</strong></p>)}
        </div>

        <div className="hs-stagewrap v2-enter-stage" style={{ ['--d' as string]: 380 }}>
          <div className="hs-stage">
            <div className="hs-floor has-art" aria-hidden="true" style={{ ['--hs-floor-art' as string]: `url(${floorArt})` }} />
            {/* Depth (Fase H · 3D): the stage starts tilted back like a screen opening and settles flat as
                the story begins (--rise); the chat floats on a nearer plane; a fine pointer adds a slight turn. */}
            <div className="hs-tilt">
              <div className="hs-hover">
                <div className="hs-cam" aria-hidden="true">
                  <Store stage={stage} />
                  <Chat stage={stage} />
                </div>
              </div>
            </div>
            <div className="hs-controls">
              <button type="button" className="hs-play" onClick={play} aria-describedby="hs-note">
                <Icon name={atEnd && !playing ? 'replay' : 'play'} size={14} />{playing ? 'Reproduciendo…' : atEnd ? 'Repetir el cambio' : 'Ver el cambio'}
              </button>
              <p className="hs-simnote" aria-hidden="true">Simulación demostrativa · no envía mensajes ni modifica ninguna tienda</p>
            </div>
          </div>
        </div>
        {/* Portal: the camera enters the store's white screen; this veil completes the turn to the light page. */}
        <div className="hs-veil" aria-hidden="true" />
      </div>

      <div id="como-funciona" className="hs-explain">
        <h2 id="como-funciona-title" className="v2-display text-center">Un mensaje.<br />Tu tienda actualizada.</h2>
        <ol>
          {MOMENTS.map((m) => (
            <li key={m.title}>
              <p className="n">{m.label}</p>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
        <p id="hs-note" className="mx-auto mt-6 max-w-2xl text-center text-[0.8125rem] text-(--v2-subtle)">Simulación demostrativa con productos reales de {pilotName}: mensajes ilustrativos, no envía mensajes ni modifica ninguna tienda.</p>
      </div>
    </section>
  )
}
