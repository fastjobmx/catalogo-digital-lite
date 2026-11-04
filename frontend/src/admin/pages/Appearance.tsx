import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Save, Check, RotateCcw, Palette, Type, LayoutGrid, Sparkles, Truck,
  ChevronUp, ChevronDown, Plus, Trash2, Eye, Star,
  PanelTop, Image as ImageIcon, Upload, Monitor, Smartphone, X, Store, MessageCircle,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStore } from '../../contexts/StoreContext'
import { CatalogContext, useCatalog } from '../../contexts/CatalogContext'
import { StoreContext } from '../../contexts/StoreContext'
import HomePage from '../../pages/HomePage'
import { updateStoreConfig, uploadImage } from '../../services/api'
import { storeStorageKey } from '../../lib/installation'
import {
  DEFAULT_THEME, THEME_PRESETS, BRAND_PALETTES, FONT_OPTIONS, SECTION_LABELS, RADIUS_VALUES, DENSITY_VALUES, TYPE_SCALE_VALUES, HEADING_WEIGHTS,
  type ThemeConfig, type SectionKey, type RadiusScale, type DensityScale,
  type ButtonStyle, type CardStyle, type HeroAlign, type HeroHeight, type TypeScale,
  type HeadingWeight, type PaletteConfig,
} from '../../types/theme'
import { contrastRatio, palettesFromLogoFile, type LogoPaletteOption } from '../../lib/logoPalette'

const OVERRIDES_KEY = storeStorageKey('catalogo-lite-store-overrides')

function Section({ id, icon: Icon, title, subtitle, children }: {
  id?: string
  icon: typeof Palette
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="card p-5 sm:p-6 scroll-mt-24">
      <div className="flex items-start gap-3 mb-5">
        <span className="grid place-items-center w-10 h-10 rounded-card bg-surface border border-line text-ink shrink-0">
          <Icon size={19} strokeWidth={1.6} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-sm text-muted leading-snug">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-ink mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1 leading-snug">{hint}</span>}
    </label>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-11 h-11 rounded-btn border border-line cursor-pointer p-0.5 bg-surface shrink-0"
          aria-label={`${label}: selector de color`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-field font-mono text-sm"
          spellCheck={false}
        />
      </div>
    </Field>
  )
}

function Toggle({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 mt-0.5 shrink-0"
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted leading-snug">{hint}</span>}
      </span>
    </label>
  )
}

function OptionRow<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <span className="block text-sm font-semibold text-ink mb-2">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3.5 py-2 rounded-btn text-sm font-medium border transition-colors ${
              value === opt.value
                ? 'border-ink bg-ink text-canvas'
                : 'border-line text-ink hover:border-ink'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Etiquetas de la paleta dirigidas al comerciante, no al desarrollador. */
const PALETTE_FIELDS: { key: keyof PaletteConfig; label: string }[] = [
  { key: 'background', label: 'Fondo de la página' },
  { key: 'surface', label: 'Superficie (tarjetas, header)' },
  { key: 'text', label: 'Texto principal' },
  { key: 'textMuted', label: 'Texto secundario' },
  { key: 'border', label: 'Bordes y separadores' },
  { key: 'primary', label: 'Color primario (enlaces, foco)' },
  { key: 'secondary', label: 'Color secundario' },
  { key: 'accent', label: 'Acento editorial' },
  { key: 'button', label: 'Fondo de botones' },
  { key: 'buttonText', label: 'Texto de botones' },
]

export default function Appearance() {
  const { token, isDemoSession } = useAuth()
  const { store, setStore, backendAvailable, refreshFromApi } = useStore()
  const catalogState = useCatalog()
  const { products, categories } = catalogState

  const [theme, setThemeState] = useState<ThemeConfig>(store.theme)
  const [brand, setBrand] = useState({
    name: store.name,
    description: store.description,
    slogan: store.slogan || '',
    logo: store.logo || '',
    favicon: store.favicon || '',
  })
  const [dirty, setDirty] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('mobile')
  const [logoPaletteOptions, setLogoPaletteOptions] = useState<LogoPaletteOption[]>([])

  const setTheme = (updater: React.SetStateAction<ThemeConfig>) => {
    setThemeState((previous) => typeof updater === 'function' ? updater(previous) : updater)
    setDirty(true)
    setSaved(false)
    setSaveError('')
  }

  useEffect(() => {
    if (!dirty) {
      setThemeState(store.theme)
      setBrand({
        name: store.name,
        description: store.description,
        slogan: store.slogan || '',
        logo: store.logo || '',
        favicon: store.favicon || '',
      })
    }
  }, [store.theme, store.name, store.description, store.slogan, store.logo, store.favicon, dirty])

  const patchBrand = (updates: Partial<typeof brand>) => {
    setBrand((previous) => ({ ...previous, ...updates }))
    setDirty(true)
    setSaved(false)
    setSaveError('')
  }

  const patch = <K extends keyof ThemeConfig>(key: K, value: ThemeConfig[K]) =>
    setTheme((prev) => ({ ...prev, [key]: value }))

  const patchStyle = <K extends keyof ThemeConfig['style']>(key: K, value: ThemeConfig['style'][K]) =>
    setTheme((prev) => ({ ...prev, style: { ...prev.style, [key]: value } }))

  const patchPalette = (key: keyof PaletteConfig, value: string) =>
    setTheme((prev) => ({
      ...prev,
      style: { ...prev.style, palette: { ...prev.style.palette, [key]: value } },
    }))

  const patchTypography = <K extends keyof ThemeConfig['style']['typography']>(
    key: K,
    value: ThemeConfig['style']['typography'][K],
  ) =>
    setTheme((prev) => ({
      ...prev,
      style: { ...prev.style, typography: { ...prev.style.typography, [key]: value } },
    }))

  const patchHeader = <K extends keyof ThemeConfig['header']>(key: K, value: ThemeConfig['header'][K]) =>
    setTheme((prev) => ({ ...prev, header: { ...prev.header, [key]: value } }))

  const patchHero = <K extends keyof ThemeConfig['hero']>(key: K, value: ThemeConfig['hero'][K]) =>
    setTheme((prev) => ({ ...prev, hero: { ...prev.hero, [key]: value } }))

  const patchPromo = <K extends keyof ThemeConfig['promo']>(key: K, value: ThemeConfig['promo'][K]) =>
    setTheme((prev) => ({ ...prev, promo: { ...prev.promo, [key]: value } }))

  const patchFooter = <K extends keyof ThemeConfig['footer']>(key: K, value: ThemeConfig['footer'][K]) =>
    setTheme((prev) => ({ ...prev, footer: { ...prev.footer, [key]: value } }))

  const applyPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const brandPrimary = /^#[0-9a-f]{6}$/i.test(theme.style.palette.primary)
      && contrastRatio(theme.style.palette.primary, preset.palette.background) >= 4.5
      ? theme.style.palette.primary : preset.palette.primary
    const brandAccent = /^#[0-9a-f]{6}$/i.test(theme.style.palette.accent)
      && contrastRatio(theme.style.palette.accent, preset.palette.background) >= 3
      ? theme.style.palette.accent : preset.palette.accent
    setTheme((prev) => ({
      ...prev,
      template: preset.template,
      style: {
        ...prev.style,
        palette: { ...preset.palette, primary: brandPrimary, button: brandPrimary, accent: brandAccent, buttonText: contrastRatio(brandPrimary, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#171717' },
        typography: { ...preset.typography },
        radius: preset.radius,
        buttonStyle: preset.buttonStyle,
        cardStyle: preset.cardStyle,
        darkMode: preset.darkMode,
      },
    }))
  }

  const applyPalette = (nextPalette: PaletteConfig) => setTheme((prev) => ({
    ...prev,
    style: { ...prev.style, palette: { ...nextPalette } },
  }))

  const uploadLogoFile = async (file: File) => {
    let options: LogoPaletteOption[]
    try {
      options = await palettesFromLogoFile(file)
    } catch (err) {
      setLogoPaletteOptions([])
      setNotice(err instanceof Error ? err.message : 'No se pudo analizar el logotipo.')
      return
    }
    await uploadAsset('logo', 'store', file, (url) => {
      patchBrand({ logo: url })
      setLogoPaletteOptions(options)
      setNotice('Logotipo listo. Revisa las tres paletas y elige una para ver la tienda con esos colores.')
    })
  }

  const moveSection = (index: number, direction: -1 | 1) => {
    const next = [...theme.sections.order]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    const a = next[index]
    const b = next[target]
    if (a === undefined || b === undefined) return
    next[index] = b
    next[target] = a
    patch('sections', { ...theme.sections, order: next })
  }

  const toggleSection = (key: SectionKey) => {
    patch('sections', {
      ...theme.sections,
      enabled: { ...theme.sections.enabled, [key]: !theme.sections.enabled[key] },
    })
  }

  const uploadAsset = async (key: string, folder: string, file: File, onUploaded: (url: string) => void) => {
    if (!backendAvailable || !token) {
      setNotice('La carga de imágenes requiere el backend y una sesión activa. Puedes pegar una ruta local o una URL autorizada.')
      return
    }
    setUploading(key)
    setNotice('')
    try {
      const result = await uploadImage(file, folder, token)
      onUploaded(result.url)
      setNotice('Imagen subida. Guarda la apariencia para aplicar el cambio.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'No se pudo subir la imagen.')
    } finally {
      setUploading(null)
    }
  }

  const handleSave = async () => {
    if (paletteIssues.length) {
      setSaveError(`Corrige la paleta antes de guardar: ${paletteIssues.join(' ')}`)
      setSaved(false)
      return
    }
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      // La paleta es la fuente de verdad. Las columnas antiguas se escriben
      // derivadas de ella para no romper integraciones que aún las consultan.
      const { palette } = theme.style
      const legacy = {
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        accentColor: palette.accent,
        buttonColor: palette.button,
      }
      if (backendAvailable && token && !isDemoSession) {
        await updateStoreConfig({
          ...legacy,
          name: brand.name,
          description: brand.description,
          slogan: brand.slogan || null,
          logoUrl: brand.logo || null,
          faviconUrl: brand.favicon || null,
          themeConfig: theme,
          template: theme.template || 'personalizado',
        }, token)
        await refreshFromApi()
      } else if (!isDemoSession) {
        throw new Error('El servidor no está disponible; la apariencia no se guardó.')
      }
      const local = {
        ...legacy,
        name: brand.name,
        description: brand.description,
        slogan: brand.slogan || null,
        logo: brand.logo || null,
        favicon: brand.favicon || null,
        theme,
      }
      setStore(local)
      try {
        const existing = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}') as Record<string, unknown>
        localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ ...existing, ...local }))
      } catch { /* almacenamiento no disponible */ }
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar la apariencia.')
    } finally {
      setSaving(false)
    }
  }

  const discardChanges = () => {
    setThemeState(store.theme)
    setBrand({
      name: store.name,
      description: store.description,
      slogan: store.slogan || '',
      logo: store.logo || '',
      favicon: store.favicon || '',
    })
    setDirty(false)
    setSaved(false)
    setSaveError('')
    setNotice('')
  }

  const resetAll = () => {
    if (!confirm('¿Restaurar la apariencia por defecto? Los cambios no guardados se perderán.')) return
    setTheme(DEFAULT_THEME)
  }

  const { palette, typography } = theme.style
  const radius = RADIUS_VALUES[theme.style.radius] ?? RADIUS_VALUES.round
  const density = DENSITY_VALUES[theme.style.density] ?? DENSITY_VALUES.normal
  const invalidPaletteFields = PALETTE_FIELDS.filter((field) => !/^#[0-9a-f]{6}$/i.test(palette[field.key]))
  const paletteIssues = invalidPaletteFields.map((field) => `${field.label}: usa un color hexadecimal de seis dígitos.`)
  if (!invalidPaletteFields.length) {
    if (contrastRatio(palette.text, palette.background) < 4.5) paletteIssues.push('El texto principal necesita más contraste con el fondo.')
    if (contrastRatio(palette.textMuted, palette.surface) < 4.5) paletteIssues.push('El texto secundario necesita más contraste con las superficies.')
    if (contrastRatio(palette.primary, palette.background) < 4.5) paletteIssues.push('El color primario necesita más contraste para leerse como enlace.')
    if (contrastRatio(palette.button, palette.buttonText) < 4.5) paletteIssues.push('El texto del botón necesita más contraste con el botón.')
  }

  const defaultFeaturedSkus = useMemo(() => {
    const flagged = products.filter((product) => product.isFeatured).map((product) => product.sku)
    return flagged.length > 0 ? flagged : products.map((product) => product.sku)
  }, [products])
  const previewVars = {
    '--color-background': palette.background,
    '--color-surface': palette.surface,
    '--color-text': palette.text,
    '--color-text-muted': palette.textMuted,
    '--color-border': palette.border,
    '--color-primary': palette.primary,
    '--color-secondary': palette.secondary,
    '--color-accent': palette.accent,
    '--color-button': palette.button,
    '--color-button-text': palette.buttonText,
    '--radius-card': radius.card,
    '--radius-btn': radius.btn,
    '--radius-field': radius.field,
    '--section-space': density.section,
    '--card-pad': density.card,
    '--grid-gap': density.grid,
    '--font-sans': `'${typography.fontPrimary}', system-ui, sans-serif`,
    '--font-display': `'${typography.fontDisplay}', '${typography.fontPrimary}', system-ui, sans-serif`,
    '--font-size-base': TYPE_SCALE_VALUES[typography.scale],
    '--heading-weight': HEADING_WEIGHTS[typography.headingWeight],
    fontFamily: `'${typography.fontPrimary}', system-ui, sans-serif`,
    background: '#EDEBE6',
  } as React.CSSProperties

  const previewStore = {
    ...store,
    name: brand.name,
    description: brand.description,
    slogan: brand.slogan || null,
    logo: brand.logo || null,
    favicon: brand.favicon || null,
    theme,
    primaryColor: palette.primary,
    secondaryColor: palette.secondary,
    accentColor: palette.accent,
    buttonColor: palette.button,
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink mb-1">Editor de apariencia</h1>
          <p className="text-muted">Personaliza la tienda y revisa el borrador antes de guardarlo.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={resetAll} className="btn-ghost">
            <RotateCcw size={16} /> Restaurar
          </button>
          {dirty && (
            <button onClick={discardChanges} className="btn-ghost">
              <X size={16} /> Recuperar versión guardada
            </button>
          )}
          <button onClick={handleSave} disabled={saving || paletteIssues.length > 0} className="btn-brand min-w-[170px] disabled:opacity-60">
            {saving ? (
              <><span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" /> Guardando…</>
            ) : saved ? (
              <><Check size={18} /> Guardado</>
            ) : (
              <><Save size={18} /> Guardar apariencia</>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
        <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        <span className="font-medium text-ink">{dirty ? 'Cambios sin guardar · solo visibles en este borrador' : saved ? 'Cambios guardados' : 'Versión guardada'}</span>
        {dirty && <span className="text-muted">La tienda publicada no cambia hasta que guardes.</span>}
      </div>

      {isDemoSession && (
        <div className="card p-4 bg-surface border-line flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm text-ink">
            Modo demostración: la apariencia se guarda en este navegador. Conecta el backend para persistirla en la nube.
          </p>
        </div>
      )}

      {saveError && <p className="card border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{saveError}</p>}
      {notice && <p className="card border-line bg-surface p-3 text-sm text-ink" role="status">{notice}</p>}

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Secciones de apariencia">
        {[
          ['marca', 'Marca'], ['colores', 'Colores'], ['tipografia', 'Tipografía'], ['encabezado', 'Encabezado'],
          ['portada', 'Portada'], ['categorias', 'Categorías'], ['inicio', 'Secciones'], ['destacados', 'Destacados'],
          ['banner', 'Banners'], ['footer', 'Footer'], ['vista-previa', 'Vista previa'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink hover:border-ink transition-colors">
            {label}
          </a>
        ))}
      </nav>

      <div className={`grid grid-cols-1 ${previewDevice === 'mobile' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'xl:grid-cols-[minmax(0,1fr)_minmax(420px,600px)]'} gap-8 items-start`}>
        {/* Controles */}
        <div className={`space-y-6 ${previewDevice === 'desktop' ? 'xl:grid xl:grid-cols-2 xl:gap-6 xl:space-y-0' : ''}`}>
          <Section id="marca" icon={Store} title="Marca" subtitle="Nombre, descripción, logotipo y favicon de la tienda.">
            <Field label="Nombre comercial">
              <input className="input-field" value={brand.name} onChange={(e) => patchBrand({ name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Eslogan">
              <input className="input-field" value={brand.slogan} onChange={(e) => patchBrand({ slogan: e.target.value })} maxLength={160} />
            </Field>
            <Field label="Descripción comercial">
              <textarea rows={3} className="input-field resize-none" value={brand.description} onChange={(e) => patchBrand({ description: e.target.value })} maxLength={500} />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3 rounded-card border border-line p-4">
                <Field label="Logotipo (ruta o URL)">
                  <input className="input-field" value={brand.logo} onChange={(e) => patchBrand({ logo: e.target.value })} placeholder="/api/assets/..." />
                </Field>
                <Field label="Subir logotipo" hint="PNG, JPG o WebP · máximo 8 MB. Generaré paletas desde la imagen antes de subirla.">
                  <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="input-field text-sm" disabled={uploading === 'logo'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadLogoFile(file); e.currentTarget.value = '' }} />
                </Field>
                {brand.logo && <img src={brand.logo} alt="Vista previa del logotipo" className="h-12 max-w-48 object-contain" />}
              </div>
              <div className="space-y-3 rounded-card border border-line p-4">
                <Field label="Favicon (ruta o URL)">
                  <input className="input-field" value={brand.favicon} onChange={(e) => patchBrand({ favicon: e.target.value })} placeholder="/api/assets/..." />
                </Field>
                <Field label="Subir favicon" hint="Usa un archivo cuadrado de al menos 64 × 64 px.">
                  <input type="file" accept="image/*,.ico" className="input-field text-sm" disabled={uploading === 'favicon'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset('favicon', 'store', file, (url) => patchBrand({ favicon: url })) }} />
                </Field>
                {brand.favicon && <img src={brand.favicon} alt="Vista previa del favicon" className="h-8 w-8 object-contain" />}
              </div>
            </div>
            <Link to="/admin/settings" className="text-sm font-semibold text-ink underline underline-offset-4">Editar contacto, redes y horarios</Link>
          </Section>

          {/* Plantillas */}
          <Section icon={Sparkles} title="Plantillas" subtitle="Prueba una familia visual. La vista previa de la tienda se actualiza antes de guardar; los productos se conservan.">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {THEME_PRESETS.map((preset) => {
                const active = theme.template === preset.template
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`rounded-card border p-3 text-left transition-colors ${
                      active ? 'border-ink' : 'border-line hover:border-ink'
                    }`}
                  >
                    <span className="template-thumb mb-3" data-template={preset.template} style={{ '--thumb-bg': preset.palette.background, '--thumb-text': preset.palette.text, '--thumb-primary': palette.primary, '--thumb-accent': palette.accent } as React.CSSProperties} aria-hidden="true">
                      <span /><span /><span />
                    </span>
                    <span className="block text-sm font-semibold text-ink">{preset.name}</span>
                    <span className="block text-[11px] text-muted mt-0.5 leading-snug">{preset.description}</span>
                    <span className="block text-[11px] text-muted mt-1.5">
                      {preset.typography.fontPrimary} · {preset.typography.fontDisplay}
                    </span>
                    <span className="block text-[11px] font-semibold text-brand mt-2">{active ? 'Vista previa activa' : 'Probar en vista previa'}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* Paleta */}
          <Section id="colores" icon={Palette} title="Colores" subtitle="Elige una paleta, usa los colores del logotipo o ajusta cada valor. La vista previa cambia al instante.">
            {paletteIssues.length > 0 && (
              <div className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
                <p className="font-semibold">Ajusta estos colores antes de guardar:</p>
                <ul className="mt-1 list-disc pl-5">{paletteIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </div>
            )}
            {logoPaletteOptions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-ink mb-2">Paletas generadas desde el logotipo</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {logoPaletteOptions.map((option) => (
                    <button key={option.id} type="button" onClick={() => applyPalette(option.palette)} className="rounded-card border border-line bg-surface p-3 text-left hover:border-ink">
                      <span className="flex gap-1.5 mb-2" aria-hidden="true">
                        {[option.palette.primary, option.palette.secondary, option.palette.accent, option.palette.background].map((color, index) => <span key={index} className="h-6 flex-1 rounded border border-line" style={{ background: color }} />)}
                      </span>
                      <span className="block text-sm font-semibold text-ink">{option.label}</span>
                      <span className="block text-xs text-muted mt-1">Previsualizar esta combinación</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">Paletas listas para usar</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {BRAND_PALETTES.map((preset) => (
                  <button key={preset.id} type="button" onClick={() => applyPalette(preset.palette)} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 text-left hover:border-ink">
                    <span className="flex gap-1 shrink-0" aria-hidden="true">
                      {[preset.palette.primary, preset.palette.secondary, preset.palette.accent].map((color, index) => <span key={index} className="h-6 w-6 rounded-full border border-line" style={{ background: color }} />)}
                    </span>
                    <span className="text-sm font-semibold text-ink">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn-ghost" onClick={() => {
              const recommended = THEME_PRESETS.find((item) => item.template === theme.template)?.palette || DEFAULT_THEME.style.palette
              applyPalette(recommended)
            }}>
              <RotateCcw size={15} /> Restablecer colores recomendados para esta plantilla
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PALETTE_FIELDS.map((field) => (
                <ColorField
                  key={field.key}
                  label={field.label}
                  value={palette[field.key]}
                  onChange={(v) => patchPalette(field.key, v)}
                />
              ))}
            </div>
          </Section>

          {/* Tipografía y estilo */}
          <Section id="tipografia" icon={Type} title="Tipografía y estilo" subtitle="Fuentes con licencia abierta, cargadas desde Google Fonts.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Fuente de interfaz" hint="Textos, botones y formularios.">
                <select className="input-field" value={typography.fontPrimary} onChange={(e) => patchTypography('fontPrimary', e.target.value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Fuente de títulos" hint="Portada, títulos de sección y precios.">
                <select className="input-field" value={typography.fontDisplay} onChange={(e) => patchTypography('fontDisplay', e.target.value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
            </div>
            <OptionRow<TypeScale>
              label="Escala de texto"
              value={typography.scale}
              onChange={(v) => patchTypography('scale', v)}
              options={[{ value: 'compact', label: 'Compacta' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Amplia' }]}
            />
            <OptionRow<HeadingWeight>
              label="Peso de los títulos"
              value={typography.headingWeight}
              onChange={(v) => patchTypography('headingWeight', v)}
              options={[{ value: 'semibold', label: 'Semibold' }, { value: 'bold', label: 'Bold' }, { value: 'extrabold', label: 'Extrabold' }]}
            />
            <OptionRow<RadiusScale>
              label="Bordes"
              value={theme.style.radius}
              onChange={(v) => patchStyle('radius', v)}
              options={[{ value: 'square', label: 'Recto' }, { value: 'soft', label: 'Suave' }, { value: 'round', label: 'Redondeado' }, { value: 'pill', label: 'Pastilla' }]}
            />
            <OptionRow<DensityScale>
              label="Densidad"
              value={theme.style.density}
              onChange={(v) => patchStyle('density', v)}
              options={[{ value: 'compact', label: 'Compacta' }, { value: 'normal', label: 'Normal' }, { value: 'spacious', label: 'Amplia' }]}
            />
            <OptionRow<ButtonStyle>
              label="Estilo de botones"
              value={theme.style.buttonStyle}
              onChange={(v) => patchStyle('buttonStyle', v)}
              options={[{ value: 'solid', label: 'Sólido' }, { value: 'outline', label: 'Contorno' }, { value: 'soft', label: 'Suave' }]}
            />
            <OptionRow<CardStyle>
              label="Estilo de tarjetas"
              value={theme.style.cardStyle}
              onChange={(v) => patchStyle('cardStyle', v)}
              options={[{ value: 'elevated', label: 'Con sombra' }, { value: 'bordered', label: 'Con borde' }, { value: 'flat', label: 'Plana' }]}
            />
            <Toggle
              label="Modo oscuro"
              hint="Invierte superficies y textos manteniendo tu paleta como base."
              checked={theme.style.darkMode}
              onChange={(v) => patchStyle('darkMode', v)}
            />
          </Section>

          {/* Header */}
          <Section id="encabezado" icon={PanelTop} title="Encabezado" subtitle="Barra informativa, accesos y comportamiento al hacer scroll.">
            <Toggle
              label="Mostrar barra informativa superior"
              checked={theme.header.topbarEnabled}
              onChange={(v) => patchHeader('topbarEnabled', v)}
            />
            {theme.header.topbarEnabled && (
              <Field label="Texto de la barra" hint="Una sola línea. Evita promesas que no puedas cumplir.">
                <input
                  className="input-field"
                  value={theme.header.topbarText}
                  onChange={(e) => patchHeader('topbarText', e.target.value)}
                  placeholder="Envío a todo el país · Cambios gratis en 30 días"
                />
              </Field>
            )}
            <Toggle
              label="Mostrar acceso a WhatsApp / teléfono"
              hint="Solo aparece si hay un número configurado en Datos de la tienda."
              checked={theme.header.showContact}
              onChange={(v) => patchHeader('showContact', v)}
            />
            <Toggle
              label="Encabezado fijo al hacer scroll"
              checked={theme.header.sticky}
              onChange={(v) => patchHeader('sticky', v)}
            />
          </Section>

          {/* Portada */}
          <Section id="portada" icon={LayoutGrid} title="Portada (hero)" subtitle="Es lo primero que ven tus clientes. Usa una fotografía propia y texto breve.">
            <Toggle
              label="Mostrar portada"
              checked={theme.hero.enabled}
              onChange={(v) => patchHero('enabled', v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Etiqueta superior">
                <input className="input-field" value={theme.hero.eyebrow} onChange={(e) => patchHero('eyebrow', e.target.value)} placeholder="Nueva temporada" />
              </Field>
              <Field label="Alineación del texto">
                <select className="input-field" value={theme.hero.align} onChange={(e) => patchHero('align', e.target.value as HeroAlign)}>
                  <option value="left">Izquierda</option>
                  <option value="center">Centrada</option>
                  <option value="right">Derecha</option>
                </select>
              </Field>
            </div>
            <Field label="Título principal" hint="Usa un salto de línea para separar dos líneas de titular.">
              <textarea rows={2} className="input-field resize-none" value={theme.hero.title} onChange={(e) => patchHero('title', e.target.value)} />
            </Field>
            <Field label="Subtítulo">
              <input className="input-field" value={theme.hero.subtitle} onChange={(e) => patchHero('subtitle', e.target.value)} />
            </Field>
            <Field label="Descripción">
              <textarea rows={2} className="input-field resize-none" value={theme.hero.description} onChange={(e) => patchHero('description', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Botón principal (texto)">
                <input className="input-field" value={theme.hero.ctaPrimaryLabel} onChange={(e) => patchHero('ctaPrimaryLabel', e.target.value)} />
              </Field>
              <Field label="Botón principal (enlace)" hint="Debe apuntar a una página real del catálogo.">
                <input className="input-field" value={theme.hero.ctaPrimaryHref} onChange={(e) => patchHero('ctaPrimaryHref', e.target.value)} placeholder="/category/all" />
              </Field>
            </div>
            <Toggle
              label="Mostrar botón secundario"
              checked={theme.hero.ctaSecondaryEnabled}
              onChange={(v) => patchHero('ctaSecondaryEnabled', v)}
            />
            {theme.hero.ctaSecondaryEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Botón secundario (texto)">
                  <input className="input-field" value={theme.hero.ctaSecondaryLabel} onChange={(e) => patchHero('ctaSecondaryLabel', e.target.value)} />
                </Field>
                <Field label="Botón secundario (enlace)">
                  <input className="input-field" value={theme.hero.ctaSecondaryHref} onChange={(e) => patchHero('ctaSecondaryHref', e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="Fotografía para escritorio (URL o ruta)" hint="Déjalo vacío para usar un fondo con los colores de la plantilla.">
              <input className="input-field" value={theme.hero.imageUrl ?? ''} onChange={(e) => patchHero('imageUrl', e.target.value || null)} placeholder="/seed-images/sneakerhub/TERA-16.jpg" />
            </Field>
            <Field label="Subir fotografía para escritorio" hint="La carga requiere el backend conectado y una sesión activa.">
              <input type="file" accept="image/*" className="input-field text-sm" disabled={uploading === 'hero'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset('hero', 'store', file, (url) => patchHero('imageUrl', url)); e.currentTarget.value = '' }} />
            </Field>
            <Field label="Fotografía para móvil (opcional)" hint="Recomendado vertical u 4:5. Si falta se usa la de escritorio.">
              <input className="input-field" value={theme.hero.imageUrlMobile ?? ''} onChange={(e) => patchHero('imageUrlMobile', e.target.value || null)} placeholder="/seed-images/sneakerhub/TERA-16.jpg" />
            </Field>
            <Field label="Subir fotografía para móvil">
              <input type="file" accept="image/*" className="input-field text-sm" disabled={uploading === 'hero-mobile'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset('hero-mobile', 'store', file, (url) => patchHero('imageUrlMobile', url)); e.currentTarget.value = '' }} />
            </Field>
            <OptionRow<HeroHeight>
              label="Altura de la portada"
              value={theme.hero.height}
              onChange={(v) => patchHero('height', v)}
              options={[{ value: 'compact', label: 'Compacta' }, { value: 'standard', label: 'Estándar' }, { value: 'tall', label: 'Amplia' }]}
            />
            <Field label={`Oscurecimiento de la imagen: ${theme.hero.overlayOpacity}%`}>
              <input
                type="range" min={0} max={90}
                value={theme.hero.overlayOpacity}
                onChange={(e) => patchHero('overlayOpacity', Number(e.target.value))}
                className="w-full accent-[color:var(--color-primary)]"
              />
            </Field>
          </Section>

          <Section id="categorias" icon={LayoutGrid} title="Categorías visuales" subtitle="Elige qué categorías aparecen y define una imagen de portada propia para cada una.">
            {categories.map((category) => {
              const selected = theme.categorySelectionEnabled
                ? theme.featuredCategorySlugs.includes(category.slug)
                : true
              const imageUrl = theme.categoryImages[category.slug] || ''
              const categoryOrder = theme.categorySelectionEnabled ? theme.featuredCategorySlugs : categories.map((item) => item.slug)
              const categoryIndex = categoryOrder.indexOf(category.slug)
              return (
                <div key={category.slug} className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] gap-3 items-start p-3 rounded-card border border-line bg-canvas/50">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1"><Toggle
                      label={category.name}
                      hint={`${category.productCount} productos`}
                      checked={selected}
                      onChange={(checked) => {
                        const current = theme.categorySelectionEnabled ? theme.featuredCategorySlugs : categories.map((item) => item.slug)
                        setTheme((previous) => ({ ...previous, categorySelectionEnabled: true, featuredCategorySlugs: checked ? [...new Set([...current, category.slug])] : current.filter((slug) => slug !== category.slug) }))
                      }}
                    /></div>
                    {selected && <span className="flex shrink-0"><button type="button" aria-label={`Subir categoría ${category.name}`} disabled={categoryIndex <= 0} onClick={() => { const next = [...categoryOrder]; [next[categoryIndex - 1], next[categoryIndex]] = [next[categoryIndex]!, next[categoryIndex - 1]!]; setTheme((previous) => ({ ...previous, categorySelectionEnabled: true, featuredCategorySlugs: next })) }} className="rounded p-1 text-muted hover:bg-surface disabled:opacity-30"><ChevronUp size={16}/></button><button type="button" aria-label={`Bajar categoría ${category.name}`} disabled={categoryIndex < 0 || categoryIndex === categoryOrder.length - 1} onClick={() => { const next = [...categoryOrder]; [next[categoryIndex], next[categoryIndex + 1]] = [next[categoryIndex + 1]!, next[categoryIndex]!]; setTheme((previous) => ({ ...previous, categorySelectionEnabled: true, featuredCategorySlugs: next })) }} className="rounded p-1 text-muted hover:bg-surface disabled:opacity-30"><ChevronDown size={16}/></button></span>}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      className="input-field text-sm"
                      value={imageUrl}
                      placeholder="Imagen local o URL autorizada"
                      aria-label={`Imagen para ${category.name}`}
                      onChange={(e) => patch('categoryImages', { ...theme.categoryImages, [category.slug]: e.target.value })}
                    />
                    <label className="btn-ghost shrink-0 cursor-pointer">
                      <Upload size={15} />
                      <span>{uploading === `category-${category.slug}` ? 'Subiendo…' : 'Subir foto'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={uploading === `category-${category.slug}`}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void uploadAsset(`category-${category.slug}`, 'categories', file, (url) => patch('categoryImages', { ...theme.categoryImages, [category.slug]: url }))
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                  </div>
                  {imageUrl && <img src={imageUrl} alt={`Vista previa para ${category.name}`} className="col-span-full h-24 w-full rounded-card border border-line object-cover sm:col-span-1 sm:col-start-2" />}
                </div>
              )
            })}
            {categories.length === 0 && <p className="text-sm text-muted">Crea categorías para configurarlas aquí.</p>}
          </Section>

          <Section id="destacados" icon={Sparkles} title="Productos destacados" subtitle="Selecciona los productos y ordénalos como aparecerán en la portada.">
            <div className="max-h-72 overflow-y-auto space-y-2">
              {products.map((product) => {
                const selectedSkus = theme.featuredSelectionEnabled
                  ? theme.featuredSkus
                  : defaultFeaturedSkus
                const selected = selectedSkus.includes(product.sku)
                return (
                  <label key={product.sku} className="flex items-center gap-3 rounded-card border border-line p-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = theme.featuredSelectionEnabled
                          ? theme.featuredSkus
                          : defaultFeaturedSkus
                        setTheme((previous) => ({
                          ...previous,
                          featuredSelectionEnabled: true,
                          featuredSkus: e.target.checked
                            ? [...current, product.sku]
                            : current.filter((sku) => sku !== product.sku),
                        }))
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink truncate">{product.name}</span>
                      <span className="block text-xs text-muted">{product.sku}</span>
                    </span>
                    {selected && (
                      <span className="flex gap-1">
                        <button type="button" className="p-1.5 rounded-btn hover:bg-canvas disabled:opacity-30" aria-label={`Subir ${product.name}`} disabled={selectedSkus.indexOf(product.sku) === 0} onClick={(e) => { e.preventDefault(); const next = [...selectedSkus]; const index = next.indexOf(product.sku); [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; patch('featuredSkus', next) }}><ChevronUp size={15} /></button>
                        <button type="button" className="p-1.5 rounded-btn hover:bg-canvas disabled:opacity-30" aria-label={`Bajar ${product.name}`} disabled={selectedSkus.indexOf(product.sku) === selectedSkus.length - 1} onClick={(e) => { e.preventDefault(); const next = [...selectedSkus]; const index = next.indexOf(product.sku); [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; patch('featuredSkus', next) }}><ChevronDown size={15} /></button>
                      </span>
                    )}
                  </label>
                )
              })}
              {products.length === 0 && <p className="text-sm text-muted">Todavía no hay productos para destacar.</p>}
            </div>
          </Section>

          {/* Secciones */}
          <Section id="inicio" icon={LayoutGrid} title="Secciones de la página de inicio" subtitle="Activa, oculta y ordena los bloques del inicio. Los bloques sin datos no se muestran.">
            <Field label="Productos por sección">
              <input
                type="number" min={4} max={16}
                value={theme.sections.featuredLimit}
                onChange={(e) => patch('sections', { ...theme.sections, featuredLimit: Math.max(4, Number(e.target.value) || 4) })}
                className="input-field w-32"
              />
            </Field>

            <ul className="space-y-2">
              {theme.sections.order.map((key, index) => (
                <li key={key} className="flex items-center gap-3 p-3 rounded-card border border-line bg-canvas/50">
                  <input
                    type="checkbox"
                    checked={theme.sections.enabled[key]}
                    onChange={() => toggleSection(key)}
                    className="w-5 h-5 shrink-0"
                    aria-label={`Mostrar ${SECTION_LABELS[key]}`}
                  />
                  <span className="flex-1 text-sm font-medium text-ink">{SECTION_LABELS[key]}</span>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => moveSection(index, -1)} disabled={index === 0}
                            className="p-1.5 rounded-btn text-muted hover:bg-surface disabled:opacity-30" aria-label="Subir">
                      <ChevronUp size={16} />
                    </button>
                    <button type="button" onClick={() => moveSection(index, 1)} disabled={index === theme.sections.order.length - 1}
                            className="p-1.5 rounded-btn text-muted hover:bg-surface disabled:opacity-30" aria-label="Bajar">
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          {/* Banner promocional */}
          <Section id="banner" icon={ImageIcon} title="Banner editorial" subtitle="Bloque destacado para campañas, colecciones o temporadas.">
            <Toggle
              label="Mostrar banner"
              checked={theme.promo.enabled}
              onChange={(v) => patchPromo('enabled', v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Etiqueta">
                <input className="input-field" value={theme.promo.eyebrow} onChange={(e) => patchPromo('eyebrow', e.target.value)} />
              </Field>
              <Field label="Título">
                <input className="input-field" value={theme.promo.title} onChange={(e) => patchPromo('title', e.target.value)} />
              </Field>
            </div>
            <Field label="Texto">
              <textarea rows={2} className="input-field resize-none" value={theme.promo.text} onChange={(e) => patchPromo('text', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Botón (texto)">
                <input className="input-field" value={theme.promo.ctaLabel} onChange={(e) => patchPromo('ctaLabel', e.target.value)} />
              </Field>
              <Field label="Botón (enlace)">
                <input className="input-field" value={theme.promo.ctaHref} onChange={(e) => patchPromo('ctaHref', e.target.value)} />
              </Field>
            </div>
            <Field label="Imagen (URL o ruta)">
              <input className="input-field" value={theme.promo.imageUrl ?? ''} onChange={(e) => patchPromo('imageUrl', e.target.value || null)} placeholder="/seed-images/sneakerhub/TERA-15.jpg" />
            </Field>
            <Field label="Subir imagen del banner" hint="La carga requiere el backend conectado y una sesión activa.">
              <input type="file" accept="image/*" className="input-field text-sm" disabled={uploading === 'promo'} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadAsset('promo', 'campaigns', file, (url) => patchPromo('imageUrl', url)); e.currentTarget.value = '' }} />
            </Field>
          </Section>

          <Section id="cta-copy" icon={MessageCircle} title="Cierre comercial" subtitle="Texto final y llamada al catálogo; evita promesas que la tienda no pueda cumplir.">
            <Field label="Etiqueta">
              <input className="input-field" value={theme.cta.eyebrow} onChange={(e) => patch('cta', { ...theme.cta, eyebrow: e.target.value })} />
            </Field>
            <Field label="Título">
              <textarea rows={2} className="input-field resize-none" value={theme.cta.title} onChange={(e) => patch('cta', { ...theme.cta, title: e.target.value })} />
            </Field>
            <Field label="Descripción">
              <textarea rows={3} className="input-field resize-none" value={theme.cta.description} onChange={(e) => patch('cta', { ...theme.cta, description: e.target.value })} />
            </Field>
            <Field label="Botón principal">
              <input className="input-field" value={theme.cta.primaryLabel} onChange={(e) => patch('cta', { ...theme.cta, primaryLabel: e.target.value })} />
            </Field>
          </Section>

          {/* Beneficios */}
          <Section icon={Truck} title="Beneficios de compra" subtitle="Solo afirmaciones que tu tienda pueda cumplir. Aparecen como una fila sobria.">
            {theme.benefits.map((b, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-start p-3 rounded-card border border-line bg-canvas/50">
                <select
                  className="input-field sm:w-36"
                  value={b.icon}
                  aria-label="Icono del beneficio"
                  onChange={(e) => {
                    const next = [...theme.benefits]
                    next[i] = { ...b, icon: e.target.value }
                    patch('benefits', next)
                  }}
                >
                  <option value="truck">Envío</option>
                  <option value="shield">Garantía</option>
                  <option value="credit-card">Pago</option>
                  <option value="message-circle">Soporte</option>
                  <option value="refresh">Cambios</option>
                  <option value="star">Calidad</option>
                  <option value="heart">Favorito</option>
                  <option value="package">Paquete</option>
                  <option value="zap">Rapidez</option>
                  <option value="award">Premium</option>
                </select>
                <input
                  className="input-field" value={b.title} placeholder="Título"
                  aria-label="Título del beneficio"
                  onChange={(e) => {
                    const next = [...theme.benefits]
                    next[i] = { ...b, title: e.target.value }
                    patch('benefits', next)
                  }}
                />
                <input
                  className="input-field" value={b.text} placeholder="Descripción"
                  aria-label="Descripción del beneficio"
                  onChange={(e) => {
                    const next = [...theme.benefits]
                    next[i] = { ...b, text: e.target.value }
                    patch('benefits', next)
                  }}
                />
                <button
                  type="button"
                  onClick={() => patch('benefits', theme.benefits.filter((_, idx) => idx !== i))}
                  className="p-2.5 rounded-btn text-muted hover:text-red-600 hover:bg-surface transition-colors"
                  aria-label="Eliminar beneficio"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch('benefits', [...theme.benefits, { icon: 'truck', title: 'Nuevo beneficio', text: 'Describe la ventaja.' }])}
              className="btn-ghost"
            >
              <Plus size={16} /> Añadir beneficio
            </button>
          </Section>

          {/* Testimonios */}
          <Section icon={Star} title="Testimonios reales" subtitle="No inventes reseñas ni valoraciones. La sección permanece oculta mientras esté vacía.">
            {theme.testimonials.length === 0 && (
              <p className="text-sm text-muted">
                Aún no hay testimonios. Añade solo opiniones de clientes reales, con su permiso.
              </p>
            )}
            {theme.testimonials.map((t, i) => (
              <div key={i} className="space-y-2 p-3 rounded-card border border-line bg-canvas/50">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    className="input-field" value={t.name} placeholder="Nombre"
                    aria-label="Nombre del cliente"
                    onChange={(e) => {
                      const next = [...theme.testimonials]
                      next[i] = { ...t, name: e.target.value }
                      patch('testimonials', next)
                    }}
                  />
                  <input
                    className="input-field" value={t.location} placeholder="Ciudad"
                    aria-label="Ciudad del cliente"
                    onChange={(e) => {
                      const next = [...theme.testimonials]
                      next[i] = { ...t, location: e.target.value }
                      patch('testimonials', next)
                    }}
                  />
                  <select
                    className="input-field"
                    value={t.rating}
                    aria-label="Valoración"
                    onChange={(e) => {
                      const next = [...theme.testimonials]
                      next[i] = { ...t, rating: Number(e.target.value) }
                      patch('testimonials', next)
                    }}
                  >
                    {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} estrellas</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input-field" value={t.text} placeholder="Opinión"
                    aria-label="Opinión del cliente"
                    onChange={(e) => {
                      const next = [...theme.testimonials]
                      next[i] = { ...t, text: e.target.value }
                      patch('testimonials', next)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => patch('testimonials', theme.testimonials.filter((_, idx) => idx !== i))}
                    className="p-2.5 rounded-btn text-muted hover:text-red-600 hover:bg-surface transition-colors shrink-0"
                    aria-label="Eliminar testimonio"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch('testimonials', [...theme.testimonials, { name: '', location: '', rating: 5, text: '' }])}
              className="btn-ghost"
            >
              <Plus size={16} /> Añadir testimonio real
            </button>
          </Section>

          {/* Pie de página */}
          <Section id="footer" icon={LayoutGrid} title="Pie de página" subtitle="Información final de tu tienda.">
            <Field label="Texto sobre la tienda">
              <textarea rows={2} className="input-field resize-none" value={theme.footer.aboutText} onChange={(e) => patchFooter('aboutText', e.target.value)} />
            </Field>
            <Toggle
              label="Mostrar políticas"
              checked={theme.footer.showPolicies}
              onChange={(v) => patchFooter('showPolicies', v)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Título de políticas">
                <input className="input-field" value={theme.footer.policiesTitle} onChange={(e) => patchFooter('policiesTitle', e.target.value)} />
              </Field>
              <Field label="Texto de copyright">
                <input className="input-field" value={theme.footer.copyright} onChange={(e) => patchFooter('copyright', e.target.value)} />
              </Field>
            </div>
            <Field label="Políticas (detalle)">
              <textarea rows={3} className="input-field resize-none" value={theme.footer.policies} onChange={(e) => patchFooter('policies', e.target.value)} />
            </Field>
          </Section>
        </div>

        {/* Vista previa */}
        <aside id="vista-previa" className="xl:sticky xl:top-24 scroll-mt-24">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-canvas/60">
              <Eye size={16} className="text-ink" />
              <span className="text-sm font-semibold text-ink">Vista previa</span>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setPreviewDevice('desktop')} aria-label="Vista previa de escritorio" aria-pressed={previewDevice === 'desktop'} className={`p-2 rounded-btn ${previewDevice === 'desktop' ? 'bg-ink text-canvas' : 'text-muted hover:bg-surface'}`}><Monitor size={16} /></button>
                <button type="button" onClick={() => setPreviewDevice('mobile')} aria-label="Vista previa móvil" aria-pressed={previewDevice === 'mobile'} className={`p-2 rounded-btn ${previewDevice === 'mobile' ? 'bg-ink text-canvas' : 'text-muted hover:bg-surface'}`}><Smartphone size={16} /></button>
              </span>
            </div>

            <div className={`appearance-preview max-h-[75vh] overflow-y-auto ${previewDevice === 'mobile' ? 'mx-auto w-full max-w-[390px] border-x border-line' : 'w-full'} ${theme.style.darkMode ? 'dark' : ''}`} data-button={theme.style.buttonStyle} data-card={theme.style.cardStyle} data-preset={theme.style.radius} style={previewVars} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) event.preventDefault() }}>
              <StoreContext.Provider value={{ store: previewStore, setStore: () => undefined, isLoading: false, isDemoMode: false, backendAvailable, storeLoadError: null, refreshFromApi }}>
                <CatalogContext.Provider value={catalogState}>
                  <HomePage />
                </CatalogContext.Provider>
              </StoreContext.Provider>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

