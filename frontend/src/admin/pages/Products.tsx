import { useEffect, useState, type ChangeEvent } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Plus, Search, Package, RotateCcw, Upload, X, Loader2, ChevronLeft } from 'lucide-react'
import { useCatalog } from '../../contexts/CatalogContext'
import { useStore } from '../../contexts/StoreContext'
import { useAuth } from '../../contexts/AuthContext'
import { formatMoney } from '../../lib/format'
import { resolveImageUrl } from '../../lib/imageSources'
import { uploadImage, type CreateProductPayload, type ProductApi } from '../../services/api'

const emptyForm = (): CreateProductPayload => ({
  sku: '',
  name: '',
  description: '',
  brand: '',
  price: 0,
  compareAtPrice: null,
  isFeatured: false,
  imageUrls: [''],
  variants: [{ sku: '', name: 'Talla 38', size: '38', stock: 20 }],
})

export default function Products() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { products, archived, categories, createProduct, updateProduct, archiveProduct, restoreProduct, updateVariantStock } = useCatalog()
  const { store, isDemoMode } = useStore()
  const { token, isDemoSession } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [form, setForm] = useState<CreateProductPayload | null>(null)
  const [editing, setEditing] = useState<ProductApi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'featured' | 'regular'>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'stock'>('name')

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setForm(emptyForm())
    setEditing(null)
    setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('new'); return next }, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (location.hash !== '#inventory') return
    const inventory = document.getElementById('inventory')
    if (inventory instanceof HTMLDetailsElement) inventory.open = true
  }, [location.hash])

  const addImageUrls = (urls: string[]) => {
    const clean = urls.map((u) => u.trim()).filter(Boolean)
    if (!form || clean.length === 0) return
    setForm({ ...form, imageUrls: [...(form.imageUrls || []), ...clean] })
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!token || isDemoSession) {
      setError('La subida de fotos requiere el servidor conectado. En modo demo pega una URL de imagen.')
      return
    }
    setUploading(true)
    try {
      const result = await uploadImage(file, 'products', token)
      addImageUrls([result.url])
      if (result.warning) setError(result.warning)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la imagen')
    } finally {
      setUploading(false)
    }
  }

  const filtered = products.filter((p) => {
    const stock = p.variants.reduce((sum, variant) => sum + variant.stock, 0)
    const matchesSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || String(p.categoryId ?? '') === categoryFilter
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'featured' ? p.isFeatured : !p.isFeatured)
    const matchesStock = stockFilter === 'all' || (stockFilter === 'out' ? stock === 0 : stock > 0 && stock <= 5)
    return matchesSearch && matchesCategory && matchesStatus && matchesStock
  }).sort((a, b) => sortBy === 'price' ? a.price - b.price : sortBy === 'stock'
    ? a.variants.reduce((sum, v) => sum + v.stock, 0) - b.variants.reduce((sum, v) => sum + v.stock, 0)
    : a.name.localeCompare(b.name, 'es'))

  const save = async () => {
    if (!form) return
    setError(null)
    if (!form.sku || !form.name) {
      setError('El SKU y el nombre son obligatorios.')
      return
    }
    try {
      const payload = {
        ...form,
        imageUrls: (form.imageUrls || []).filter(Boolean),
        variants: (form.variants || []).map((v, i) => ({
          ...v,
          sku: v.sku || `${form.sku}-${v.size || i + 1}`,
        })),
      }
      if (editing) {
        await updateProduct(editing.id, payload)
      } else {
        const exists = products.find((p) => p.sku.toLowerCase() === form.sku.toLowerCase())
        if (exists) {
          setError(`La referencia ${form.sku} ya existe. Edítala en lugar de duplicarla.`)
          return
        }
        await createProduct(payload)
      }
      setForm(null)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package size={15} className="text-brand" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand/70">Catálogo</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-ink">Productos</h1>
          <p className="text-muted text-sm mt-1.5">Gestiona productos, fotos, precios y variantes.</p>
        </div>
        <button
          className="btn-brand"
          onClick={() => { setEditing(null); setError(null); setUrlInput(''); setForm(emptyForm()) }}
        >
          <Plus size={18} /> Nuevo producto
        </button>
      </div>

      {isDemoMode && (
        <div className="flex items-center gap-4 p-4 rounded-card bg-brand/5 border border-brand/20">
          <div className="grid place-items-center w-10 h-10 rounded-btn bg-brand/10 shrink-0">
            <Loader2 size={20} className="text-brand" />
          </div>
          <p className="text-sm text-ink/80">
            <span className="font-bold text-brand">Guardado local: </span>
            los cambios se guardan en la caché del navegador hasta que conectes el servidor.
          </p>
        </div>
      )}

      <div className="relative">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <Search className="text-muted" size={18} />
        </div>
        <input
          className="input-field pl-12"
          placeholder="Buscar por nombre o SKU…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <select className="input-field" aria-label="Filtrar por categoría" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">Todas las categorías</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select className="input-field" aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="all">Todos los estados</option><option value="featured">Destacados</option><option value="regular">Sin destacar</option>
        </select>
        <select className="input-field" aria-label="Filtrar por stock" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}>
          <option value="all">Todo el inventario</option><option value="low">Stock bajo (1–5)</option><option value="out">Agotados</option>
        </select>
        <select className="input-field" aria-label="Ordenar productos" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="name">Ordenar: nombre</option><option value="price">Ordenar: precio</option><option value="stock">Ordenar: stock</option>
        </select>
      </div>

      {form && (
        <div className="card p-7 border-brand/20 space-y-7 animate-slide-up">
          <div className="flex items-center justify-between border-b border-line pb-5">
            <h2 className="text-xl font-black text-ink tracking-tight">
              {editing ? 'Editar producto' : 'Nuevo producto'}
            </h2>
            <button className="text-muted hover:text-ink transition-colors" onClick={() => { setForm(null); setEditing(null) }}>
              <X size={22} />
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-btn">
              {error}
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">SKU</label>
              <input className="input-field" placeholder="SKU-XXXX" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Nombre</label>
              <input className="input-field" placeholder="Nombre del producto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Marca</label>
              <input className="input-field" placeholder="Marca" value={form.brand || ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Categoría</label>
              <select className="input-field" value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Sin categoría</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Precio</label>
                <input className="input-field" type="number" placeholder="0" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Precio anterior</label>
                <input className="input-field" type="number" placeholder="0" value={form.compareAtPrice ?? ''} onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Descripción</label>
            <textarea className="input-field min-h-[110px] resize-none" placeholder="Detalles del producto…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="flex items-center gap-3 p-4 bg-canvas rounded-btn border border-line">
            <input
              type="checkbox"
              id="featured"
              className="w-4 h-4 accent-brand"
              checked={form.isFeatured}
              onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
            />
            <label htmlFor="featured" className="text-sm font-semibold text-ink cursor-pointer">Destacar en la portada</label>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Fotos</label>
              <span className="text-[11px] text-brand font-semibold">Recomendado: 1200x1200px</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {(form.imageUrls || []).filter(Boolean).map((url, i) => (
                <div key={`${url}-${i}`} className="relative w-24 h-24 rounded-btn overflow-hidden border border-line group">
                  <img src={resolveImageUrl(url) || undefined} alt={`Foto ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-ink/80 px-1.5 py-0.5 text-[9px] font-bold text-white">Principal</span>}
                  {i > 0 && <button type="button" aria-label={`Hacer principal la foto ${i + 1}`} onClick={() => { const images = [...(form.imageUrls || [])]; [images[0], images[i]] = [images[i]!, images[0]!]; setForm({ ...form, imageUrls: images }) }} className="absolute bottom-1 left-1 rounded bg-white/90 p-1 text-ink opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><ChevronLeft size={14}/></button>}
                  <button
                    type="button"
                    aria-label={`Eliminar foto ${i + 1}`}
                    className="absolute top-1.5 right-1.5 rounded-full bg-ink/80 p-2 text-canvas opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    onClick={() => { if (confirm(`¿Eliminar la foto ${i + 1}?`)) setForm({ ...form, imageUrls: (form.imageUrls || []).filter((_, j) => j !== i) }) }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <label className="w-24 h-24 flex flex-col items-center justify-center gap-2 rounded-btn border border-dashed border-line text-muted cursor-pointer hover:border-brand/50 hover:bg-brand/5 transition-colors">
                {uploading ? <Loader2 size={20} className="animate-spin text-brand" /> : <Upload size={20} />}
                <span className="text-[10px] font-bold uppercase tracking-widest">{uploading ? 'Subiendo' : 'Subir'}</span>
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => void handleUpload(e)} />
              </label>
            </div>
            <div className="flex gap-3">
              <input
                className="input-field"
                placeholder="O pega una URL externa de la imagen…"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addImageUrls([urlInput])
                    setUrlInput('')
                  }
                }}
              />
              <button
                type="button"
                className="btn-ghost px-6 shrink-0"
                onClick={() => { addImageUrls([urlInput]); setUrlInput('') }}
              >
                Añadir
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted">Variantes (talla / color)</label>
              <button
                type="button"
                className="text-[11px] font-bold uppercase tracking-widest text-brand hover:underline"
                onClick={() => setForm({ ...form, variants: [...(form.variants || []), { stock: 0, size: '' }] })}
              >
                + Añadir variante
              </button>
            </div>
            <div className="space-y-3">
              {(form.variants || []).map((v, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 bg-canvas rounded-btn border border-line">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Talla / etiqueta</label>
                    <input className="input-field py-2" placeholder="ej. 42" value={v.size || ''} onChange={(e) => {
                      const variants = [...(form.variants || [])]
                      variants[i] = { ...v, size: e.target.value, name: e.target.value }
                      setForm({ ...form, variants })
                    }} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Color</label>
                    <input className="input-field py-2" placeholder="ej. Negro" value={v.color || ''} onChange={(e) => {
                      const variants = [...(form.variants || [])]
                      variants[i] = { ...v, color: e.target.value }
                      setForm({ ...form, variants })
                    }} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Stock</label>
                    <input className="input-field py-2" type="number" placeholder="0" value={v.stock} onChange={(e) => {
                      const variants = [...(form.variants || [])]
                      variants[i] = { ...v, stock: Number(e.target.value) }
                      setForm({ ...form, variants })
                    }} />
                  </div>
                  <div className="flex items-end pb-1">
                    <button type="button" className="text-[11px] font-bold uppercase tracking-widest text-red-500/80 hover:text-red-600 transition-colors" onClick={() => setForm({ ...form, variants: (form.variants || []).filter((_, j) => j !== i) })}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button className="btn-brand px-8" onClick={() => void save()}>Guardar</button>
            <button className="btn-ghost px-8" onClick={() => { setForm(null); setEditing(null) }}>Descartar</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card p-16 text-center border-dashed">
          <div className="grid place-items-center w-16 h-16 rounded-card bg-canvas mx-auto mb-5">
            <Package size={30} className="text-muted" />
          </div>
          <h3 className="text-lg font-bold text-ink">Sin productos</h3>
          <p className="text-muted text-sm mt-1.5">Ningún producto coincide con tu búsqueda.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-canvas text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="p-4">Producto</th><th className="p-4">Categoría</th><th className="p-4 text-right">Precio</th><th className="p-4 text-right">Stock</th><th className="p-4">Estado</th><th className="p-4">Acciones</th></tr></thead>
            <tbody className="divide-y divide-line">{filtered.map((product) => (
              <tr key={product.id} className="hover:bg-canvas/60">
                <td className="p-4"><div className="flex items-center gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-btn border border-line bg-canvas">{product.imageUrls[0] ? <img src={resolveImageUrl(product.imageUrls[0]) || undefined} alt="" className="h-full w-full object-cover"/> : <Package className="m-3 text-muted" size={24}/>}</div><div><p className="font-semibold text-ink">{product.name}</p><p className="text-xs text-muted">{product.sku}</p></div></div></td>
                <td className="p-4 text-muted">{product.categoryName || 'Sin categoría'}</td>
                <td className="p-4 text-right font-semibold tabular-nums">{formatMoney(product.price, store.currency)}</td>
                <td className="p-4 text-right tabular-nums">{product.variants.reduce((sum, variant) => sum + variant.stock, 0)}</td>
                <td className="p-4">{product.isFeatured ? <span className="badge badge-featured">Destacado</span> : <span className="text-xs text-muted">Activo</span>}</td>
                <td className="p-4"><div className="flex gap-2">
                  <button
                    className="btn-ghost px-4 py-2 text-[11px]"
                    onClick={() => {
                      setEditing(product)
                      setError(null)
                      setUrlInput('')
                      setForm({
                        sku: product.sku,
                        name: product.name,
                        description: product.description,
                        brand: product.brand || '',
                        categoryId: product.categoryId,
                        price: product.price,
                        compareAtPrice: product.compareAtPrice,
                        isFeatured: product.isFeatured,
                        imageUrls: product.imageUrls,
                        variants: product.variants.map((v) => ({
                          sku: v.sku,
                          name: v.name,
                          size: v.size ?? undefined,
                          color: v.color ?? undefined,
                          priceOverride: v.priceOverride ?? undefined,
                          stock: v.stock,
                        })),
                      })
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="px-4 py-2 rounded-btn border border-red-200 text-[11px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors"
                    onClick={() => { if (confirm(`¿Archivar “${product.name}”? Podrás restaurarlo después.`)) void archiveProduct(product.id) }}
                  >
                    Archivar
                  </button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>

          <details id="inventory" className="border-t border-line p-4 scroll-mt-24">
            <summary className="cursor-pointer text-sm font-semibold text-muted">Inventario por variante · ver y ajustar stock individual</summary>
            <div className="mt-4 space-y-4">{filtered.map((product) => <section key={product.id}><h3 className="font-semibold text-ink">{product.name}</h3><div className="mt-2 overflow-x-auto">
                <table className="w-full text-[11px] font-semibold">
                  <thead>
                    <tr className="text-left text-muted uppercase tracking-widest">
                      <th className="pb-3 font-bold">Variante</th>
                      <th className="pb-3 font-bold">Referencia</th>
                      <th className="pb-3 font-bold text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((v) => (
                      <tr key={v.id} className="border-t border-line">
                        <td className="py-3 text-ink">{v.name || v.size || '—'}</td>
                        <td className="py-3 text-muted">{v.sku}</td>
                        <td className="py-3 text-right">
                          <input
                            className="input-field w-20 py-1.5 text-right text-brand"
                            type="number"
                            value={v.stock}
                            onChange={(e) => void updateVariantStock(product.id, v.id, Number(e.target.value))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></section>)}</div>
          </details>
        </div>
      )}

      {archived.length > 0 && (
        <section className="pt-8 mt-8 border-t border-line">
          <div className="flex items-center gap-2 mb-5">
            <RotateCcw size={16} className="text-muted" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted">Archivados</h2>
          </div>
          <div className="space-y-2">
            {archived.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-4 bg-canvas border border-line rounded-btn">
                <span className="text-sm font-semibold text-muted">{p.name} <span className="text-[11px] text-muted/70 ml-2">({p.sku})</span></span>
                <button className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-brand hover:underline" onClick={() => void restoreProduct(p.id)}>
                  <RotateCcw size={12} /> Restaurar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
