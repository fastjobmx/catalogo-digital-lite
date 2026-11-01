import { describe, expect, it } from 'vitest'
import { getRouteScrollPlan, type SavedScrollPosition } from './RouteScrollManager'

describe('comportamiento de scroll por navegación', () => {
  const positions = new Map<string, SavedScrollPosition>([['home', { left: 0, top: 1240 }]])

  it('abre una navegación normal desde arriba', () => {
    expect(getRouteScrollPlan('PUSH', '', 'product', positions)).toEqual({ kind: 'top' })
  })

  it('restaura la posición guardada al volver con Atrás/Adelante', () => {
    expect(getRouteScrollPlan('POP', '', 'home', positions)).toEqual({
      kind: 'restore',
      position: { left: 0, top: 1240 },
    })
  })

  it('prioriza un ancla válida sobre la posición guardada', () => {
    expect(getRouteScrollPlan('POP', '#inventory', 'products', positions)).toEqual({ kind: 'anchor', id: 'inventory' })
  })

  it('inicia arriba si no existe una posición de historial guardada', () => {
    expect(getRouteScrollPlan('POP', '', 'direct-load', positions)).toEqual({ kind: 'top' })
  })
})
