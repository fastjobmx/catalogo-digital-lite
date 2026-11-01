import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProductImage from './ProductImage'

describe('ProductImage storefront', () => {
  it('usa el mismo JPEG raíz como fallback y ofrece WebP local', () => {
    const html = renderToStaticMarkup(
      <ProductImage src="seed-images/sneakerhub/ASTRAL-03.jpg" alt="Astral Wave Runner" />,
    )
    expect(html).toContain('srcSet="/seed-images/sneakerhub/ASTRAL-03.webp"')
    expect(html).toContain('src="/seed-images/sneakerhub/ASTRAL-03.jpg"')
    expect(html).toContain('loading="lazy"')
  })

  it('prioriza y marca eager las imágenes de inicio y ficha', () => {
    const html = renderToStaticMarkup(
      <ProductImage src="/seed-images/sneakerhub/ASTRAL-03.jpg" alt="Astral Wave Runner" priority />,
    )
    expect(html).toContain('loading="eager"')
    expect(html).toContain('fetchPriority="high"')
  })

  it('preserva el endpoint R2 de la imagen en la URL y mantiene el comportamiento responsive', () => {
    const html = renderToStaticMarkup(
      <ProductImage src="/api/assets/products/astral-03" alt="Astral Wave Runner" sizes="50vw" />,
    )
    expect(html).toContain('src="/api/assets/products/astral-03"')
    expect(html).toContain('/api/assets/products/astral-03?w=300 300w')
    expect(html).toContain('sizes="50vw"')
  })
})
