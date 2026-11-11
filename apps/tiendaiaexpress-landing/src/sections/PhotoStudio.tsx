// "Estudio fotográfico para tus productos". Statuses verified against the platform code
// (docs/ESTUDIO_FOTOGRAFICO_FASE2.md, in production since 2026-11-10; docs/FABRICA_CREATIVOS_FASE3.md,
// conventional mode in production since 2026-11-11, AI video switched off). Anything not running in
// production is labelled "Próximamente" and kept out of the available list.
import { Badge, SectionHeading } from '../components/ui/primitives'
import { Icon } from '../components/ui/Icon'

type Tool = { name: string; detail: string; soon?: boolean }

const BASIC: Tool[] = [
  { name: 'Recortar y encuadrar', detail: 'Recorte cuadrado y encuadre del producto sobre fondo blanco.' },
  { name: 'Redimensionar', detail: 'Tamaños livianos para que tu tienda cargue rápido.' },
  { name: 'Uniformidad de tamaños', detail: 'El mismo encuadre para un lote de hasta 50 fotos.' },
  { name: 'Correcciones convencionales', detail: 'Ajuste básico de luz, compresión WebP y conversión a JPG.' },
  { name: 'Formatos para redes', detail: 'Imágenes y carruseles 1:1, 4:5 e historias 9:16 con tu marca, nombre y precio exactos.' },
  { name: 'Videos cortos automáticos', detail: 'Videos de 6, 10 o 15 segundos armados con tus fotos, listos para descargar.' },
  { name: 'Marca de agua', detail: 'Tu logo sobre tus fotos.', soon: true },
  { name: 'Fondos prediseñados', detail: 'Fondos listos para elegir.', soon: true },
]

const ADVANCED: Tool[] = [
  { name: 'Packshots de producto', detail: 'Fondo blanco o neutro, luz de estudio y sombra natural.' },
  { name: 'Escenarios realistas', detail: 'Fondo publicitario, escenario comercial o presentación en local.' },
  { name: 'Calzado en escena', detail: 'Escenas pensadas para la categoría de tu producto.' },
  { name: 'Modelos virtuales', detail: 'Prendas presentadas en una persona generada.', soon: true },
  { name: 'Variantes visuales de color', detail: 'Vistas del mismo producto en otros colores.', soon: true },
  { name: 'Videos con IA', detail: 'Tu foto real animada por inteligencia artificial.', soon: true },
]

function ToolList({ tools, onDark }: { tools: Tool[]; onDark?: boolean }) {
  const available = tools.filter((t) => !t.soon)
  const soon = tools.filter((t) => t.soon)
  return (
    <>
      <ul className={`mt-6 divide-y border-y ${onDark ? 'divide-ivory/10 border-ivory/10' : 'divide-forest/10 border-forest/10'}`}>
        {available.map((t) => (
          <li key={t.name} className="flex gap-3 py-3.5">
            <Icon name="check" size={20} className={`mt-0.5 shrink-0 ${onDark ? 'text-lime' : 'text-forest'}`} />
            <p><span className="font-display font-bold">{t.name}.</span> <span className={onDark ? 'text-mist' : 'text-ink-soft'}>{t.detail}</span></p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h4 className="font-display text-sm font-bold uppercase tracking-wide">En camino</h4>
        <Badge kind="soon" onDark={onDark} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {soon.map((t) => (
          <li key={t.name} className={`rounded-full px-3 py-1.5 text-sm ring-1 ring-inset ${onDark ? 'text-mist ring-ivory/20' : 'text-ink-soft ring-forest/20'}`}>{t.name}</li>
        ))}
      </ul>
    </>
  )
}

export function PhotoStudio() {
  return (
    <section id="estudio" aria-labelledby="estudio-title" className="bg-paper py-24 md:py-36">
      <div className="wrap">
        <SectionHeading
          id="estudio-title"
          size="md"
          title="Estudio fotográfico para tus productos."
          intro="Mejorá tus fotos desde el panel de tu tienda: primero lo sencillo, y la inteligencia artificial cuando la necesitás."
        />
        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[2rem] bg-ivory p-7 ring-1 ring-forest/8 md:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-forest text-lime"><Icon name="image" size={24} /></span>
              <Badge kind="live" />
            </div>
            <h3 className="mt-6 font-display text-3xl font-bold md:text-4xl">Herramientas básicas</h3>
            <p className="mt-2 text-lg text-ink-soft">Se hacen en tu navegador, sin inteligencia artificial y sin consumir créditos IA.</p>
            <ToolList tools={BASIC} />
          </article>
          <article className="on-dark rounded-[2rem] bg-forest p-7 text-ivory md:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-lime text-forest"><Icon name="wand" size={24} /></span>
              <Badge kind="live" onDark />
            </div>
            <h3 className="mt-6 font-display text-3xl font-bold md:text-4xl">Herramientas avanzadas con IA</h3>
            <p className="mt-2 text-lg text-mist">Usan las mejoras IA de tu plan. Antes de procesar ves cuántas vas a usar.</p>
            <ToolList tools={ADVANCED} onDark />
          </article>
        </div>
        <div className="mt-6 flex gap-3 rounded-[1.5rem] bg-lime/30 p-5 text-[0.98rem] text-forest ring-1 ring-forest/10 md:p-6">
          <Icon name="shield" size={22} className="mt-0.5 shrink-0" />
          <p><b>La foto real de tu producto sigue siendo la referencia.</b> La IA trabaja con reglas que le impiden inventar suelas, costuras o partes que no se ven en tu foto, y cambiar formas, colores o logotipos. Como puede equivocarse, la original se conserva y vos comparás y aprobás cada resultado antes de publicarlo.</p>
        </div>
      </div>
    </section>
  )
}
