import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Save, Link2, Unlink, Copy, Check, Shield, Bot, Store, Phone, Palette, ArrowRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStore } from '../../contexts/StoreContext'
import { updateStoreConfig, type StoreConfigApi } from '../../services/api'

const API_BASE = import.meta.env.VITE_API_URL || ''

interface TelegramStatus {
  linked: boolean
  ownerId: string | null
}

interface LinkCodeResponse {
  code: string
  expiresAt: string
  expiresInMinutes: number
  instructions: string
}

export default function Settings() {
  const { token } = useAuth()
  const { store, setStore, backendAvailable, isDemoMode, refreshFromApi } = useStore()

  // Form state
  const [name, setName] = useState(store.name)
  const [description, setDescription] = useState(store.description)
  const [slogan, setSlogan] = useState(store.slogan || '')
  const [whatsappPhone, setWhatsappPhone] = useState(store.whatsappPhone)
  const [phone, setPhone] = useState(store.phone || '')
  const [email, setEmail] = useState(store.email || '')
  const [address, setAddress] = useState(store.address || '')
  const [hours, setHours] = useState(store.hours || '')
  const [instagram, setInstagram] = useState(store.instagram || '')
  const [facebook, setFacebook] = useState(store.facebook || '')
  const [tiktok, setTiktok] = useState(store.tiktok || '')

  // Telegram state
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({ linked: false, ownerId: null })
  const [linkCode, setLinkCode] = useState<LinkCodeResponse | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [loadingTelegram, setLoadingTelegram] = useState(true)
  const [saveError, setSaveError] = useState('')

  // Load telegram status on mount
  useEffect(() => {
    loadTelegramStatus()
  }, [backendAvailable, token])

  // Sync form with store context changes
  useEffect(() => {
    setName(store.name)
    setDescription(store.description)
    setSlogan(store.slogan || '')
    setWhatsappPhone(store.whatsappPhone)
    setPhone(store.phone || '')
    setEmail(store.email || '')
    setAddress(store.address || '')
    setHours(store.hours || '')
    setInstagram(store.instagram || '')
    setFacebook(store.facebook || '')
    setTiktok(store.tiktok || '')
  }, [store])

  const loadTelegramStatus = async () => {
    if (!backendAvailable || !token) {
      setLoadingTelegram(false)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/telegram/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as TelegramStatus
        setTelegramStatus(data)
      }
    } catch {
      // Ignore errors in demo mode
    } finally {
      setLoadingTelegram(false)
    }
  }

  const generateLinkCode = async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/admin/telegram/link-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as LinkCodeResponse
        setLinkCode(data)
        setCodeCopied(false)
      } else {
        alert('Error al generar código de vinculación')
      }
    } catch {
      alert('No se pudo conectar con el backend')
    }
  }

  const copyCode = () => {
    if (!linkCode) return
    navigator.clipboard.writeText(`/link ${linkCode.code}`)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError('')

    const normalizedEmail = email.trim()
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setSaveError('Revisa el formato del correo electrónico.')
      setSaving(false)
      return
    }
    if (whatsappPhone.trim() && !/^\+?[\d\s().-]{7,20}$/.test(whatsappPhone.trim())) {
      setSaveError('Usa un número de WhatsApp válido, con código de país. Ejemplo: +573001112233.')
      setSaving(false)
      return
    }
    setSaveError('')

    try {
      const local = {
        name,
        description,
        slogan: slogan || null,
        whatsappPhone,
        phone: phone || null,
        email: normalizedEmail || null,
        address: address || null,
        hours: hours || null,
        instagram: instagram || null,
        facebook: facebook || null,
        tiktok: tiktok || null,
      }
      if (backendAvailable && token) {
        const payload: Partial<StoreConfigApi> = local
        await updateStoreConfig(payload, token)
        await refreshFromApi()
      }
      setStore(local)
      try {
        const existing = JSON.parse(localStorage.getItem('catalogo-lite-store-overrides') || '{}') as Record<string, unknown>
        localStorage.setItem('catalogo-lite-store-overrides', JSON.stringify({ ...existing, ...local }))
      } catch { /* ignore */ }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield size={15} className="text-brand" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Configuración</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-ink">Ajustes de la tienda</h1>
          <p className="text-muted text-sm mt-1.5">Datos de contacto y redes sociales. Los colores se editan en Apariencia.</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-brand">
          {saving ? (
            <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
          ) : (
            <Save size={18} />
          )}
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {(isDemoMode || !backendAvailable) && (
        <div className="flex items-center gap-4 p-4 rounded-card bg-brand/5 border border-brand/20">
          <div className="grid place-items-center w-10 h-10 rounded-btn bg-brand/10 shrink-0">
            <Shield size={20} className="text-brand" />
          </div>
          <p className="text-sm text-ink/80">
            <span className="font-bold text-brand">Modo demostración: </span>
            el servidor no está disponible. Los cambios se guardan solo en este navegador.
          </p>
        </div>
      )}
      {saveError && <p role="alert" className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">{saveError}</p>}
      {saveSuccess && <p role="status" className="card border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">La configuración se guardó correctamente.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Identidad de la tienda */}
          <section className="card p-7">
            <h2 className="text-lg font-bold text-ink mb-6 flex items-center gap-2.5 border-b border-line pb-4">
              <Store size={18} className="text-brand" />
              Identidad
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Nombre de la tienda</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Mi tienda" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Eslogan</label>
                <input type="text" value={slogan} onChange={(e) => setSlogan(e.target.value)} placeholder="Estilo que se siente" className="input-field" />
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Descripción</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-field resize-none" placeholder="Describe tu tienda…" />
              </div>
            </div>
          </section>

          {/* Contacto y redes */}
          <section className="card p-7">
            <h2 className="text-lg font-bold text-ink mb-6 flex items-center gap-2.5 border-b border-line pb-4">
              <Phone size={18} className="text-brand" />
              Contacto y redes
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">WhatsApp</label>
                <input type="tel" value={whatsappPhone} onChange={(e) => setWhatsappPhone(e.target.value)} placeholder="+573001112233" className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Teléfono</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Correo electrónico</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Dirección</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Horario</label>
                <input type="text" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Lun-Vie 9am-6pm" className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Instagram</label>
                <input type="text" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@mitienda" className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Facebook</label>
                <input type="text" value={facebook} onChange={(e) => setFacebook(e.target.value)} className="input-field" />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">TikTok</label>
                <input type="text" value={tiktok} onChange={(e) => setTiktok(e.target.value)} className="input-field" />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* Colores: viven en Apariencia (única fuente de verdad) */}
          <section className="card p-7">
            <h2 className="text-lg font-bold text-ink mb-4 flex items-center gap-2.5 border-b border-line pb-4">
              <Palette size={18} className="text-brand" />
              Colores y tipografía
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              La paleta completa, las fuentes, la portada y las secciones del inicio se editan en
              <span className="text-ink font-semibold"> Apariencia</span>. Allí hay diez colores y vista previa en vivo.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="w-8 h-8 rounded-btn border border-line" style={{ background: store.theme.style.palette.background }} />
              <span className="w-8 h-8 rounded-btn border border-line" style={{ background: store.theme.style.palette.text }} />
              <span className="w-8 h-8 rounded-btn border border-line" style={{ background: store.theme.style.palette.accent }} />
              <span className="w-8 h-8 rounded-btn border border-line" style={{ background: store.theme.style.palette.button }} />
            </div>
            <Link to="/admin/appearance" className="btn-ghost mt-5 w-full justify-center">
              Abrir Apariencia <ArrowRight size={15} />
            </Link>
          </section>

          {/* Integración Telegram */}
          <section className="card p-7">
            <div className="flex items-center gap-3.5 mb-6">
              <div className="grid place-items-center w-11 h-11 rounded-btn bg-canvas border border-line">
                <Bot size={22} className="text-brand" />
              </div>
              <div>
                <h2 className="text-base font-bold text-ink">Vincular Telegram</h2>
                <p className="text-[11px] text-muted">Control remoto por chat</p>
              </div>
            </div>

            {loadingTelegram ? (
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-canvas rounded w-1/2" />
                <div className="h-16 bg-canvas rounded-btn w-full" />
              </div>
            ) : telegramStatus.linked ? (
              <div className="space-y-5">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-btn flex items-center gap-3">
                  <Shield size={20} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Vinculado</p>
                    <p className="text-xs text-muted mt-0.5">ID: {telegramStatus.ownerId}</p>
                  </div>
                </div>
                <button
                  onClick={() => setTelegramStatus({ linked: false, ownerId: null })}
                  className="w-full py-3 rounded-btn border border-red-200 text-[11px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Unlink size={14} /> Desvincular
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {!linkCode ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted leading-relaxed">
                      Genera un código para vincular tu cuenta de Telegram y gestionar la tienda desde el chat. El código es válido por 10 minutos.
                    </p>
                    <button
                      onClick={generateLinkCode}
                      disabled={!backendAvailable}
                      className="btn-brand w-full"
                    >
                      <Link2 size={16} /> Generar código
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5 animate-slide-up">
                    <div className="p-5 bg-brand/5 border border-brand/20 rounded-card">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-brand mb-3 text-center">Escribe este comando en Telegram</p>
                      <div className="flex items-center gap-3">
                        <code className="flex-1 bg-surface px-4 py-3 rounded-btn text-base font-bold text-ink border border-line overflow-x-auto">
                          /link {linkCode.code}
                        </code>
                        <button
                          onClick={copyCode}
                          className="grid place-items-center w-11 h-11 bg-surface border border-line rounded-btn hover:border-brand transition-colors shrink-0"
                          aria-label="Copiar código"
                        >
                          {codeCopied ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} className="text-brand" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-center mt-3 text-muted">
                        Expira en {linkCode.expiresInMinutes} min · {new Date(linkCode.expiresAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <button
                      onClick={() => setLinkCode(null)}
                      className="w-full text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink transition-colors"
                    >
                      Cancelar y regenerar
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Toast de guardado */}
      {saveSuccess && (
        <div className="fixed bottom-8 right-8 bg-brand text-brand-foreground font-bold px-6 py-4 rounded-card shadow-card animate-slide-in-right flex items-center gap-3">
          <Check size={20} strokeWidth={3} />
          Cambios guardados
        </div>
      )}
    </div>
  )
}
