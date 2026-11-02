import { useEffect, useState } from 'react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'
import { useAuth } from '../../contexts/AuthContext'
import { getCategories, updateStoreConfig } from '../../services/api'
import { storeStorageKey } from '../../lib/installation'

const STEPS = [
  'Nombre del negocio',
  'Tipo de negocio',
  'Descripción',
  'Colores',
  'WhatsApp',
  'Horarios',
  'Dirección',
  'Redes sociales',
  'Moneda',
  'Categoría inicial',
  'Confirmación',
]

const KEY = storeStorageKey('catalogo-lite-onboarding')

export default function AdminOnboarding() {
  const { store, isLoading, refreshFromApi } = useStore()
  const { createCategory, refresh: refreshCatalog } = useCatalog()
  const { token, isDemoSession } = useAuth()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [draft, setDraft] = useState({
    name: store.name,
    businessType: store.businessType,
    description: store.description,
    primaryColor: store.primaryColor,
    secondaryColor: store.secondaryColor,
    whatsappPhone: store.whatsappPhone,
    hours: store.hours || '',
    address: store.address || '',
    instagram: store.instagram || '',
    currency: store.currency,
    category: 'General',
    published: false,
  })

  useEffect(() => {
    if (isLoading || hydrated) return
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as { step: number; draft: typeof draft }
        setStep(parsed.step)
        setDraft(parsed.draft)
      } else {
        setDraft((current) => ({
          ...current,
          name: store.name,
          businessType: store.businessType,
          description: store.description,
          primaryColor: store.primaryColor,
          secondaryColor: store.secondaryColor,
          whatsappPhone: store.whatsappPhone,
          hours: store.hours || '',
          address: store.address || '',
          instagram: store.instagram || '',
          currency: store.currency,
        }))
      }
    } catch { /* ignore */ }
    setHydrated(true)
  }, [isLoading, store, hydrated])

  useEffect(() => {
    if (!hydrated) return
    if (draft.published) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify({ step, draft }))
  }, [step, draft, hydrated])

  const skip = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const publish = async () => {
    if (!token || isDemoSession) {
      setSaveError('Inicia sesión con el administrador de esta tienda para guardar la configuración.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const themeConfig = {
        ...store.theme,
        style: {
          ...store.theme.style,
          palette: {
            ...store.theme.style.palette,
            primary: draft.primaryColor,
            button: draft.primaryColor,
            secondary: draft.secondaryColor,
          },
        },
      }
      await updateStoreConfig({
        name: draft.name,
        businessType: draft.businessType,
        description: draft.description,
        primaryColor: draft.primaryColor,
        secondaryColor: draft.secondaryColor,
        whatsappPhone: draft.whatsappPhone,
        hours: draft.hours,
        address: draft.address,
        instagram: draft.instagram,
        currency: draft.currency,
        themeConfig,
      }, token)

      const categoryName = draft.category.trim()
      if (categoryName) {
        const slug = categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const existingCategories = await getCategories()
        if (slug && !existingCategories.some((category) => category.slug === slug)) {
          await createCategory({ name: categoryName, slug })
        }
      }
      await refreshCatalog()
      await refreshFromApi()
      localStorage.removeItem(KEY)
      setDraft((d) => ({ ...d, published: true }))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-3xl font-bold">Crear mi tienda</h1>
      <p className="text-muted">Paso {step + 1} de {STEPS.length}: {STEPS[step]}</p>
      <p className="text-xs text-muted">El avance se guarda en este navegador. Puedes salir y continuar después.</p>
      <div className="card p-6 space-y-4">
        {step === 0 && <input className="input-field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
        {step === 1 && <input className="input-field" value={draft.businessType} onChange={(e) => setDraft({ ...draft, businessType: e.target.value })} />}
        {step === 2 && <textarea className="input-field" rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}
        {step === 3 && (
          <div className="flex gap-3">
            <input type="color" value={draft.primaryColor} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} />
            <input type="color" value={draft.secondaryColor} onChange={(e) => setDraft({ ...draft, secondaryColor: e.target.value })} />
          </div>
        )}
        {step === 4 && <input className="input-field" value={draft.whatsappPhone} onChange={(e) => setDraft({ ...draft, whatsappPhone: e.target.value })} />}
        {step === 5 && <input className="input-field" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />}
        {step === 6 && <input className="input-field" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />}
        {step === 7 && <input className="input-field" placeholder="Instagram" value={draft.instagram} onChange={(e) => setDraft({ ...draft, instagram: e.target.value })} />}
        {step === 8 && <input className="input-field" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />}
        {step === 9 && <input className="input-field" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />}
        {step === 10 && (
          <div className="text-sm space-y-2">
            <p><strong>{draft.name}</strong> · {draft.businessType}</p>
            <p>{draft.description}</p>
            <p>WhatsApp: {draft.whatsappPhone}</p>
            <p>Los cambios se guardarán en la tienda al confirmar; no se despliega automáticamente.</p>
            {draft.published ? <p className="text-green-700">Configuración guardada en la tienda.</p> : (
              <button className="btn-brand" disabled={saving} onClick={() => void publish()}>{saving ? 'Guardando…' : 'Guardar configuración'}</button>
            )}
            {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
            <p className="text-xs text-muted">Después puedes completar productos y fotos en <a className="underline" href="/admin/products">Productos</a> y la portada o el logotipo en <a className="underline" href="/admin/appearance">Apariencia</a>.</p>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button className="px-4 py-2 border rounded-xl" onClick={back}>Regresar</button>
        <button className="px-4 py-2 border rounded-xl" onClick={skip}>Saltar / continuar</button>
      </div>
    </div>
  )
}
