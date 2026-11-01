import { useState } from 'react'
import { Plus, Tag, X, Package, AlertCircle, Pencil } from 'lucide-react'
import { useCatalog } from '../../contexts/CatalogContext'
import { slugify } from '../../lib/format'
import { Link } from 'react-router-dom'

export default function Categories() {
  const { categories, products, createCategory, updateCategory, deactivateCategory } = useCatalog()
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null)

  const save = async () => {
    if (!name.trim()) { setError('Escribe un nombre para la categoría.'); return }
    setSaving(true); setError('')
    try {
      if (editingId !== null) await updateCategory(editingId, { name: name.trim(), slug: slugify(name) })
      else await createCategory({ name: name.trim(), slug: slugify(name) })
      setName(''); setEditingId(null); setOpen(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear la categoría.') }
    finally { setSaving(false) }
  }

  const deactivate = async (id: number, categoryName: string) => {
    if (!confirm(`¿Desactivar “${categoryName}”? Los productos no se eliminarán.`)) return
    setError(''); setDeactivatingId(id)
    try { await deactivateCategory(id) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo desactivar la categoría.') }
    finally { setDeactivatingId(null) }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Tag size={15} className="text-brand" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Organización</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-ink">Categorías</h1>
          <p className="text-muted text-sm mt-1.5">Organiza los productos en las secciones de tu tienda.</p>
        </div>
        <button className="btn-brand" onClick={() => { setEditingId(null); setName(''); setError(''); setOpen(true) }}>
          <Plus size={18} /> Nueva categoría
        </button>
      </div>

      {error && <p className="card flex items-center gap-2 p-4 text-sm text-red-700" role="alert"><AlertCircle size={17}/>{error}</p>}
      {open && (
        <div className="card p-6 border-brand/20 flex flex-col sm:flex-row gap-4 animate-slide-up">
          <label className="flex-1"><span className="sr-only">Nombre de la categoría</span><input
            className="input-field w-full"
            placeholder="Nombre de la categoría (ej. Zapatillas)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
            autoFocus
          /></label>
          <div className="flex gap-2">
            <button className="btn-brand px-6" onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : editingId !== null ? 'Guardar' : 'Crear'}</button>
            <button className="btn-ghost px-6" onClick={() => { setOpen(false); setEditingId(null); setName('') }}>Cancelar</button>
          </div>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="card p-16 text-center border-dashed">
          <div className="grid place-items-center w-16 h-16 rounded-card bg-canvas mx-auto mb-5">
            <Tag size={30} className="text-muted" />
          </div>
          <h3 className="text-lg font-bold text-ink">Aún no hay categorías</h3>
          <p className="text-muted text-sm mt-1.5">Crea tu primera categoría para organizar el catálogo.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {categories.map((c) => {
            const cover = products.find((product) => product.categorySlug === c.slug && product.imageUrls[0])?.imageUrls[0]
            return <article key={c.id} className="card overflow-hidden flex flex-col hover:shadow-card-hover transition-shadow">
              <div className="relative h-36 bg-canvas">
                {cover ? <img src={cover} alt={`Productos de ${c.name}`} className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center"><Tag size={30} className="text-muted"/></div>}
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-ink">Activa</span>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-ink truncate">{c.name}</h3>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mt-1">
                    {c.slug} · {c.productCount} {c.productCount === 1 ? 'producto' : 'productos'}
                  </p>
                </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <div className="flex flex-wrap gap-3"><Link to={`/category/${c.slug}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><Package size={14}/> Ver productos</Link><Link to="/admin/appearance#categorias" className="text-xs font-semibold text-ink underline underline-offset-4">Imagen, visibilidad y orden</Link></div>
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-ink" onClick={() => { setEditingId(c.id); setName(c.name); setError(''); setOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Pencil size={14}/> Editar</button>
                <button
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-500/80 hover:text-red-600 transition-colors"
                  disabled={deactivatingId === c.id}
                  onClick={() => void deactivate(c.id, c.name)}
                >
                  <X size={12} /> {deactivatingId === c.id ? 'Desactivando…' : 'Desactivar'}
                </button>
              </div>
              </div>
            </article>
          })}
        </div>
      )}
    </div>
  )
}
