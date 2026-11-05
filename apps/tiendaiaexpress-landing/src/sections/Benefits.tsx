// Three statements, revealed word by word with scroll (the only scrubbed text on the page).
import { useRef, useState } from 'react'
import { useScrollScene } from '../motion/useScrollScene'
import { benefits } from '../content/copy'
import { products, formatCOP, screens } from '../content/media'
import { site } from '../config/site'
import { Badge } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'
import { PhoneFrame } from '../components/ui/PhoneFrame'

function LinkDemo() {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(site.demoStoreUrl)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    window.setTimeout(() => setCopied('idle'), 2400)
  }
  return (
    <div className="rounded-3xl bg-forest-raised p-5 ring-1 ring-ivory/10">
      <p className="text-sm text-mist">El enlace de la tienda piloto:</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate rounded-full bg-forest-deep px-4 py-3 font-mono text-[0.82rem] text-ivory">{site.demoStoreUrl.replace('https://', '')}</span>
        <button type="button" onClick={copy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-5 font-display text-sm font-bold uppercase text-forest active:scale-95">
          <Icon name={copied === 'ok' ? 'check' : 'link'} size={17} /> {copied === 'ok' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="mt-2 min-h-5 text-xs text-mist" aria-live="polite">{copied === 'ok' ? 'Listo: pegalo donde quieras.' : copied === 'fail' ? 'No pudimos copiar; seleccioná el enlace y copialo.' : ''}</p>
    </div>
  )
}

function ChatDemo() {
  const p = products[0]
  return (
    <div className="rounded-3xl bg-forest-raised p-5 ring-1 ring-ivory/10">
      <Badge kind="demo" onDark />
      <div className="mt-4 space-y-2.5 text-[0.95rem]">
        <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-[#2b5a47] px-4 py-2.5 text-ivory">Cambiá el precio del {p.name} a {formatCOP(p.price - 10000)}</p>
        <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-md bg-ivory px-4 py-2.5 text-forest">Cambio el precio de {formatCOP(p.price)} a {formatCOP(p.price - 10000)}. ¿Confirmo?</p>
        <p className="ml-auto w-fit rounded-2xl rounded-br-md bg-[#2b5a47] px-4 py-2.5 text-ivory">Sí</p>
      </div>
    </div>
  )
}

function PhoneDemo() {
  return (
    <div className="flex items-end gap-4">
      <PhoneFrame src={screens.home} alt="Tienda SneakerHub abierta en el celular" width="clamp(7.5rem, 30vw, 10.5rem)" />
      <div className="mb-6 min-w-0 rounded-2xl rounded-bl-md bg-[#d9fdd3] p-3 text-sm text-[#0b2e1f] shadow-xl">
        <p className="flex items-center gap-1.5 font-bold"><Icon name="whatsapp" size={15} className="text-[#128c4a]" /> Mirá el catálogo</p>
        <p className="mt-1 max-w-[11rem] truncate text-xs underline">{site.demoStoreUrl.replace('https://', '')}</p>
      </div>
    </div>
  )
}

export function Benefits() {
  const root = useRef<HTMLElement>(null)
  useScrollScene(root, ({ gsap }) => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.utils.toArray<HTMLElement>('.benefit').forEach((item) => {
        gsap.fromTo(item.querySelectorAll('.word'), { opacity: 0.14 }, {
          opacity: 1, stagger: 0.15, ease: 'none',
          scrollTrigger: { trigger: item, start: 'top 80%', end: 'top 35%', scrub: 0.5 },
        })
        gsap.fromTo(item.querySelector('.benefit-demo'), { y: 60, rotate: -2 }, {
          y: -20, rotate: 0, ease: 'none',
          scrollTrigger: { trigger: item, start: 'top bottom', end: 'bottom top', scrub: 0.8 },
        })
      })
    })
    return () => mm.revert()
  })

  return (
    <section ref={root} aria-labelledby="beneficios-title" className="on-dark grain relative overflow-hidden bg-forest-deep py-24 text-ivory md:py-40">
      <h2 id="beneficios-title" className="sr-only">Beneficios</h2>
      <div className="wrap relative z-10 grid grid-cols-1 gap-28 md:gap-40">
        {benefits.map((b, i) => (
          <article key={b.title.join(' ')} className="benefit min-w-0">
            <h3 className={`display text-[clamp(1.85rem,8.4vw,8.8rem)] ${i % 2 ? 'lg:text-right' : ''}`}>
              {b.title.map((line, li) => (
                <span key={line} className={`block ${li === 1 ? 'text-lime' : ''}`}>
                  {line.split(' ').map((w, wi) => <span key={wi} className="word inline-block pr-[0.22em] last:pr-0">{w}</span>)}
                </span>
              ))}
            </h3>
            <div className={`mt-10 grid grid-cols-1 items-center gap-10 lg:mt-14 lg:grid-cols-2 lg:gap-20 ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              <p className="max-w-xl text-lg leading-relaxed text-mist md:text-xl">{b.body}</p>
              <div className="benefit-demo">{b.demo === 'link' ? <LinkDemo /> : b.demo === 'chat' ? <ChatDemo /> : <PhoneDemo />}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
