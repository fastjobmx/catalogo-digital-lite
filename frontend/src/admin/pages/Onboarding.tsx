import { useEffect, useState } from 'react'
import { useStore } from '../../contexts/StoreContext'
import { useCatalog } from '../../contexts/CatalogContext'

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

const KEY = 'catalogo-lite-onboarding'

export default function AdminOnboarding() {
  const { store, setStore } = useStore()
  const { createCategory, createProduct } = useCatalog()
  const [step, setStep] = useState(0)
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
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as { step: number; draft: typeof draft }
        setStep(parsed.step)
        setDraft(parsed.draft)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ step, draft }))
  }, [step, draft])

  const skip = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const publish = async () => {
    setStore({
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
      // Los colores elegidos aquí también alimentan la paleta del storefront,
      // que es la única fuente de verdad visual.
      theme: {
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
      },
    })
    await createCategory({ name: draft.category, slug: draft.category.toLowerCase().replace(/\s+/g, '-') })
    await createProduct({
      sku: 'DEMO-001',
      name: 'Producto de bienvenida',
      price: 10000,
      description: 'Cámbialo cuando quieras',
      variants: [{ stock: 10, name: 'Único' }],
    })
    setDraft((d) => ({ ...d, published: true }))
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
            <p>La tienda no se publica hasta que confirmes.</p>
            {draft.published ? <p className="text-green-700">Publicada en este navegador.</p> : (
              <button className="btn-brand" onClick={() => void publish()}>Aprobar y publicar</button>
            )}
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
