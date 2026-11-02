import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Check, ArrowUpRight } from 'lucide-react'
import type { ProductApi } from '../services/api'
import { useStore } from '../contexts/StoreContext'
import { useCart } from '../contexts/CartContext'
import { totalStock } from '../lib/catalog'
import ProductImage from './ProductImage'
import PriceTag from './PriceTag'
import { resolveImageUrl } from '../lib/imageSources'

export default function ProductCard({ product, priority = false }: { product: ProductApi; priority?: boolean }) {
  const { store } = useStore()
  const { addItem } = useCart()
  const [added, setAdded] = useState(false)

  const stock = totalStock(product)
  const soldOut = stock <= 0
  const onSale = Boolean(product.compareAtPrice && product.compareAtPrice > product.price)
  const sizes = [...new Set(product.variants.filter((v) => v.isActive !== false && v.stock > 0).map((v) => v.size).filter(Boolean))] as string[]
  const href = `/product/${encodeURIComponent(product.sku)}`
  const [primary, secondaryUrl] = product.imageUrls || []
  const secondary = resolveImageUrl(secondaryUrl)

  // Añade la primera variante disponible sin salir del listado.
  const quickAdd = () => {
    const variant = product.variants.find((v) => v.isActive !== false && v.stock > 0)
    if (!variant) return
    addItem({
      productId: String(product.id),
      productSku: product.sku,
      variantId: String(variant.id),
      sku: variant.sku,
      name: product.name,
      price: variant.priceOverride ?? product.price,
      compareAtPrice: product.compareAtPrice ?? undefined,
      image: product.imageUrls[0] ?? null,
      size: variant.size ?? undefined,
      color: variant.color ?? undefined,
      availableStock: variant.stock,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 1600)
  }

  return (
    <article className="group flex flex-col h-full">
      <div className="relative overflow-hidden bg-canvas" style={{ borderRadius: 'var(--radius-card)' }}>
        <Link to={href} aria-label={`Ver ${product.name}`} className="block">
          <ProductImage
            src={primary ?? null}
            alt={product.name}
            ratio="4:5"
            priority={priority}
            imgClassName="transition-transform duration-[900ms] ease-out group-hover:scale-[1.03]"
          />
          {secondary && (
            <img
              src={secondary}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover opacity-0
                         transition-opacity duration-500 group-hover:opacity-100"
            />
          )}
        </Link>

        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5 pointer-events-none">
          {soldOut && <span className="badge badge-out">Agotado</span>}
          {!soldOut && onSale && <span className="badge badge-sale">Oferta</span>}
          {!soldOut && !onSale && product.isFeatured && <span className="badge badge-featured">Destacado</span>}
        </div>

        {!soldOut && (
          <button
            type="button"
            onClick={quickAdd}
            className="absolute bottom-3 right-3 grid place-items-center w-11 h-11 bg-surface text-ink
                       border border-line opacity-0 translate-y-1 pointer-events-none
                       group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto
                       focus-visible:opacity-100 focus-visible:translate-y-0 focus-visible:pointer-events-auto
                       hover:bg-ink hover:text-canvas transition-all duration-200"
            style={{ borderRadius: 'var(--radius-btn)' }}
            aria-label={`Añadir ${product.name} al carrito`}
            title="Añadir la talla disponible"
          >
            {added ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
          </button>
        )}
      </div>

      <div className="pt-3.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center justify-between gap-2 min-h-[16px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted truncate">
            {product.brand || '—'}
          </p>
          {!soldOut && stock <= 5 && (
            <span className="text-[10px] font-medium text-accent whitespace-nowrap">Últimas {stock}</span>
          )}
        </div>

        <Link to={href} className="block">
          <h3 className="text-[14px] sm:text-[15px] font-medium leading-snug text-ink line-clamp-2 min-h-[2.6em] hover:text-accent transition-colors">
            {product.name}
          </h3>
        </Link>

        <PriceTag price={product.price} compareAt={product.compareAtPrice} currency={store.currency} />

        <div className="flex items-end justify-between gap-2 mt-auto pt-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted truncate">
            {soldOut ? 'Sin tallas disponibles' : sizes.length > 0 ? `Tallas ${sizes.slice(0, 5).join(' · ')}` : 'Talla única'}
          </p>
          <Link
            to={href}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-ink shrink-0
                       hover:text-accent transition-colors"
            aria-label={`Ver detalle de ${product.name}`}
          >
            Ver <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}
