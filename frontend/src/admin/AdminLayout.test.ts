import { describe, expect, it } from 'vitest'
import { ADMIN_NAV_GROUPS, isAdminLinkActive } from './AdminLayout'

describe('navegación administrativa visible', () => {
  const items = ADMIN_NAV_GROUPS.flatMap((group) => group.items)

  it('presenta las secciones comerciales y administrativas existentes', () => {
    expect(items.map((item) => item.label)).toEqual([
      'Resumen', 'Productos', 'Inventario', 'Categorías', 'Pedidos',
      'Apariencia', 'Configuración', 'Cuestionario', 'Simulador IA',
    ])
  })

  it('enlaza inventario a la sección real de variantes dentro de Productos', () => {
    expect(items.find((item) => item.label === 'Inventario')?.to).toBe('/admin/products#inventory')
  })

  it('marca solo la opción contextual como activa en la sección de inventario', () => {
    const products = items.find((item) => item.label === 'Productos')!
    const inventory = items.find((item) => item.label === 'Inventario')!
    expect(isAdminLinkActive('/admin/products', '', products)).toBe(true)
    expect(isAdminLinkActive('/admin/products', '#inventory', products)).toBe(false)
    expect(isAdminLinkActive('/admin/products', '#inventory', inventory)).toBe(true)
  })

  it('no muestra herramientas de Telegram sin una vista administrativa real', () => {
    expect(items.some((item) => item.label.toLowerCase().includes('telegram'))).toBe(false)
  })
})
