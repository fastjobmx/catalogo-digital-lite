/** Paso «Diseño» de la Fábrica de creativos: estilo, composición, variante, personalización y control de calidad.
 * Las miniaturas se dibujan con la foto y los datos reales del producto elegido (no son imágenes de ejemplo). */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Shuffle } from 'lucide-react'
import type { DesignOptions, PlanSpec } from '../../../lib/creative/scene'
import { drawPreview, videoSupport, type ImageMap, type OutputType } from '../../../lib/creative/render'
import type { DesignContext } from '../../../lib/creative/design/compose'
import { styleLayouts } from '../../../lib/creative/design/compose'
import type { QaReport } from '../../../lib/creative/design/qa'
import { SECTOR_VIDEO, VIDEO_SECONDS, VIDEO_TEMPLATES, VIDEO_TEMPLATE_KEYS, MAX_VIDEO_SECONDS, MIN_VIDEO_SECONDS } from '../../../lib/creative/design/video'
import { DESIGN_STYLES, LAYOUTS, OBJECTIVES, OBJECTIVE_KEYS, SECTORS, SECTOR_KEYS, STYLE_KEYS, stylesOf, type LayoutKey, type SectorKey } from '../../../lib/creative/design/styles'

export const DEFAULT_DESIGN: DesignOptions = { sector: 'calzado', objective: 'venta', style: 'sneaker_impact', layout: 'heroe', seed: 1, colors: null, showPrice: true, removeBg: true, showReference: false }

function Thumb({ spec, images, design, width, label, active, onClick }: { spec: PlanSpec; images: ImageMap; design: DesignContext; width: number; label: string; active: boolean; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    target.width = width * 2
    target.height = Math.round(width * 2 * spec.height / spec.width)
    drawPreview(target, spec, images, 'Inter', 0, null, design)
  }, [spec, images, design, width])
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`group shrink-0 rounded-xl border p-1.5 text-left transition ${active ? 'border-brand ring-2 ring-brand/60' : 'border-line hover:border-brand/40'}`} style={{ width: width + 14 }}>
      <canvas ref={canvas} className="block w-full rounded-lg" aria-hidden="true" />
      <span className="mt-1 block truncate text-[11px] font-bold text-ink">{label}</span>
    </button>
  )
}

interface Props {
  spec: PlanSpec | null
  images: ImageMap | null
  design: DesignContext | null
  notes: string[]
  options: DesignOptions
  onChange: (next: DesignOptions) => void
  output: OutputType | 'auto'
  onOutput: (value: OutputType | 'auto') => void
  kind: 'imagen' | 'carrusel' | 'video'
  seconds: number
  onSeconds: (value: number) => void
  music: boolean
  onMusic: (value: boolean) => void
  priceLocked: boolean
  brandColors: string[]
  /** Sector sugerido por las categorías y nombres de los productos elegidos. */
  detected: SectorKey | null
  /** El plan trae un descuento real (plantilla «Oferta aprobada»). */
  hasOffer: boolean
}

export function DesignPanel({ spec, images, design, notes, options, onChange, output, onOutput, kind, seconds, onSeconds, music, onMusic, priceLocked, brandColors, detected, hasOffer }: Props) {
  const style = DESIGN_STYLES[options.style as keyof typeof DESIGN_STYLES] ?? DESIGN_STYLES.sneaker_impact
  const sector = (options.sector && options.sector in SECTORS ? options.sector : style.sector) as SectorKey
  const [allStyles, setAllStyles] = useState(false)
  const [support, setSupport] = useState<{ mp4: boolean; aac: boolean; webm: boolean } | null>(null)
  useEffect(() => { if (kind === 'video') void videoSupport().then(setSupport).catch(() => setSupport(null)) }, [kind])
  const familyStyles = allStyles ? STYLE_KEYS : stylesOf(sector)
  const chooseSector = (key: SectorKey) => { const first = stylesOf(key)[0]!; onChange({ ...options, sector: key, style: first, layout: DESIGN_STYLES[first].layouts[0] }) }
  const layouts = styleLayouts(options.style)
  const ready = Boolean(spec && images && design)
  const variant = (patch: Partial<DesignOptions>) => onChange({ ...options, ...patch })
  const next = () => {
    const index = layouts.indexOf(options.layout as LayoutKey)
    variant({ layout: layouts[(index + 1) % layouts.length]!, seed: (options.seed % 99000) + 1 + Math.floor(Math.random() * 900) })
  }
  const colors = options.colors ?? []
  const colorValue = (index: number) => colors[index] ?? brandColors[index] ?? (index === 0 ? '#111827' : '#F59E0B')
  const thumbWidth = spec && spec.width > spec.height ? 168 : 104

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Sector de la tienda</p>
        <div className="flex flex-wrap gap-1.5">
          {SECTOR_KEYS.map((key) => (
            <button key={key} type="button" aria-pressed={sector === key} onClick={() => chooseSector(key)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${sector === key ? 'bg-ink text-white' : 'bg-line/60 text-ink'}`}>
              {SECTORS[key].label}{detected === key ? ' · sugerido' : ''}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{SECTORS[sector].hint}</p>
      </div>

      {kind === 'video' && (
        <div className="space-y-2 rounded-xl border border-line bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Plantilla de video</p>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
            {VIDEO_TEMPLATE_KEYS.map((key) => {
              const active = (options.video ?? SECTOR_VIDEO[sector]) === key
              return (
                <button key={key} type="button" aria-pressed={active} onClick={() => onChange({ ...options, video: key })} className={`rounded-lg border p-2 text-left ${active ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line'}`}>
                  <span className="block text-xs font-bold text-ink">{VIDEO_TEMPLATES[key].label}{SECTOR_VIDEO[sector] === key ? ' · sugerida' : ''}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{VIDEO_TEMPLATES[key].description}</span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink">
            <span className="font-bold">Duración</span>
            {VIDEO_SECONDS.map((value) => <button key={value} type="button" aria-pressed={seconds === value} onClick={() => onSeconds(value)} className={`rounded-full px-3 py-1 font-bold ${seconds === value ? 'bg-ink text-white' : 'bg-line/60'}`}>{value} s</button>)}
            <label className="flex items-center gap-1">Otra<input type="number" min={MIN_VIDEO_SECONDS} max={MAX_VIDEO_SECONDS} value={seconds} onChange={(event) => { const value = Math.round(Number(event.target.value)); if (value >= MIN_VIDEO_SECONDS && value <= MAX_VIDEO_SECONDS) onSeconds(value) }} className="input-field w-16 py-1" /></label>
            <label className="ml-2 flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={music} onChange={(event) => onMusic(event.target.checked)} /> Música generada por el sistema</label>
          </div>
          <p className="text-[11px] text-muted">La música la compone el propio sistema (sin pistas de terceros). Se agrega en AAC solo si tu navegador lo permite; si no, el video sale sin audio.</p>
          {support && <p className={`text-[11px] font-semibold ${support.mp4 ? 'text-emerald-700' : 'text-amber-700'}`}>Este navegador: {support.mp4 ? 'exporta MP4 (H.264)' : support.webm ? 'no exporta MP4; saldrá en WebM, en tiempo real' : 'no puede exportar video'}{support.mp4 ? (support.aac ? ' con audio AAC.' : ' sin audio (no codifica AAC).') : '.'}</p>}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Objetivo de la pieza</p>
        <div className="flex flex-wrap gap-1.5">
          {OBJECTIVE_KEYS.map((key) => (
            <button key={key} type="button" aria-pressed={options.objective === key} onClick={() => onChange({ ...options, objective: key })} className={`rounded-full px-3 py-1.5 text-xs font-bold ${options.objective === key ? 'bg-brand text-white' : 'bg-line/60 text-ink'}`}>{OBJECTIVES[key].label}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{OBJECTIVES[(options.objective ?? 'venta') as keyof typeof OBJECTIVES].hint}{options.objective === 'promocion' && !hasOffer ? ' Este producto no tiene precio anterior en tu catálogo: se mostrará su precio normal, sin anunciar rebajas.' : ''}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Estilo</p>
        {ready ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {familyStyles.map((key) => (
              <Thumb key={key} spec={{ ...spec!, design: { ...options, style: key, layout: DESIGN_STYLES[key].layouts[0] } }} images={images!} design={design!} width={thumbWidth} label={DESIGN_STYLES[key].label} active={options.style === key} onClick={() => variant({ style: key, sector: DESIGN_STYLES[key].sector, layout: DESIGN_STYLES[key].layouts[0] })} />
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {familyStyles.map((key) => (
              <button key={key} type="button" aria-pressed={options.style === key} onClick={() => variant({ style: key, sector: DESIGN_STYLES[key].sector, layout: DESIGN_STYLES[key].layouts[0] })} className={`rounded-xl border p-3 text-left ${options.style === key ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line bg-white'}`}>
                <span className="block text-sm font-bold text-ink">{DESIGN_STYLES[key].label}</span>
                <span className="mt-1 block text-xs text-muted">{DESIGN_STYLES[key].mood}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted">{style.description} <button type="button" className="font-semibold text-brand underline" onClick={() => setAllStyles(!allStyles)}>{allStyles ? 'Ver solo los de este sector' : 'Ver los 15 estilos'}</button></p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Composición</p>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={next}><Shuffle size={13} /> Otra variante</button>
        </div>
        {ready ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {layouts.map((key, index) => (
              <Thumb key={key} spec={{ ...spec!, design: { ...options, layout: key } }} images={images!} design={design!} width={thumbWidth} label={`${index + 1}. ${LAYOUTS[key].label}`} active={options.layout === key} onClick={() => variant({ layout: key })} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {layouts.map((key, index) => <button key={key} type="button" aria-pressed={options.layout === key} onClick={() => variant({ layout: key })} className={`rounded-full px-3 py-1 text-xs font-bold ${options.layout === key ? 'bg-ink text-white' : 'bg-line/60 text-ink'}`}>{index + 1}. {LAYOUTS[key].label}</button>)}
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted">{LAYOUTS[options.layout as LayoutKey]?.hint}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-bold text-ink">Colores</legend>
          <div className="flex items-center gap-2">
            {[0, 1].map((index) => (
              <input key={index} type="color" aria-label={index === 0 ? 'Color principal' : 'Color de acento'} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-white p-0.5" value={colorValue(index)}
                onChange={(event) => { const list = [colorValue(0), colorValue(1)]; list[index] = event.target.value.toUpperCase(); variant({ colors: list }) }} />
            ))}
            {options.colors && <button type="button" className="text-xs font-semibold text-brand underline" onClick={() => variant({ colors: null })}>Usar los de mi marca</button>}
          </div>
        </fieldset>
        <div className="space-y-1.5 text-xs text-ink">
          <label className={`flex items-center gap-2 font-semibold ${priceLocked ? 'opacity-60' : ''}`}><input type="checkbox" checked={options.showPrice} disabled={priceLocked} onChange={(event) => variant({ showPrice: event.target.checked })} /> Mostrar precio</label>
          {priceLocked && <span className="block text-muted">La oferta siempre muestra el precio.</span>}
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={options.showReference} onChange={(event) => variant({ showReference: event.target.checked })} /> Mostrar referencia</label>
        </div>
        <div className="space-y-1.5 text-xs text-ink">
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={options.removeBg} onChange={(event) => variant({ removeBg: event.target.checked })} /> Quitar el fondo cuando sea seguro</label>
          <span className="block text-muted">{design && design.cutouts.size ? 'Tu foto tiene fondo liso: se puede aislar el producto sin tocarlo.' : notes[0] ? `${notes[0]} Se usa la foto original completa.` : 'Solo se quita en fotos con fondo liso; el producto nunca se retoca.'}</span>
        </div>
        {kind !== 'video' && (
          <label className="text-xs font-bold text-ink">Archivo
            <select className="input-field mt-1 block w-full" value={output} onChange={(event) => onOutput(event.target.value as OutputType | 'auto')}>
              <option value="auto">Según la calidad</option>
              <option value="png">PNG (sin pérdida)</option>
              <option value="jpeg">JPG (liviano)</option>
              <option value="webp">WebP (moderno)</option>
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

/** Informe del control de calidad automático, por diapositiva. */
export function QaPanel({ reports }: { reports: QaReport[] }) {
  if (!reports.length) return null
  const errors = reports.reduce((sum, report) => sum + report.errors, 0)
  const warnings = reports.reduce((sum, report) => sum + report.warnings, 0)
  const checks = reports.flatMap((report, slide) => report.checks.map((check) => ({ ...check, slide })))
  const shown = checks.filter((check, index) => check.level !== 'ok' || checks.findIndex((other) => other.code === check.code) === index)
  return (
    <div className={`rounded-xl border p-3 ${errors ? 'border-red-200 bg-red-50' : warnings ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
      <p className={`mb-2 text-sm font-bold ${errors ? 'text-red-800' : warnings ? 'text-amber-800' : 'text-emerald-800'}`}>
        Control de calidad: {errors ? `${errors} ${errors === 1 ? 'problema' : 'problemas'} por corregir` : warnings ? `lista, con ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}` : 'todo en orden'}
      </p>
      <ul className="space-y-1">
        {shown.map((check, index) => (
          <li key={`${check.code}-${index}`} className="flex items-start gap-1.5 text-xs text-ink">
            {check.level === 'error' ? <AlertCircle size={14} className="mt-px shrink-0 text-red-600" /> : check.level === 'aviso' ? <AlertTriangle size={14} className="mt-px shrink-0 text-amber-600" /> : <CheckCircle2 size={14} className="mt-px shrink-0 text-emerald-600" />}
            <span>{reports.length > 1 && check.level !== 'ok' ? `Imagen ${check.slide + 1}: ` : ''}{check.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
