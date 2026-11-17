import { describe, expect, it } from 'vitest'
import { INVITABLE_ROLES, ROLE_INFO, roleTooltip } from './roles'

describe('permisos por rol que ve el propietario al invitar', () => {
  it('cada rol invitable tiene nombre, resumen y lo que puede y no puede hacer', () => {
    expect(INVITABLE_ROLES).toEqual(['admin', 'operator', 'seller', 'inventory'])
    for (const role of INVITABLE_ROLES) {
      expect(ROLE_INFO[role].label).toBeTruthy()
      expect(ROLE_INFO[role].can.length).toBeGreaterThan(0)
      expect(ROLE_INFO[role].cannot.length).toBeGreaterThan(0)
    }
  })

  it('coincide con las reglas del servidor: solo el propietario invita, nadie sin rol de administrador crea productos', () => {
    expect(ROLE_INFO.admin.cannot.join(' ')).toMatch(/Invitar/)
    for (const role of ['operator', 'seller', 'inventory'] as const) expect(ROLE_INFO[role].cannot).toContain('Crear o editar productos')
    expect(ROLE_INFO.seller.cannot).toContain('Cambiar inventario')
    expect(ROLE_INFO.inventory.cannot).toContain('Cambiar el estado de los pedidos')
  })

  it('el aviso del rol en la lista resume lo que puede y no puede hacer', () => {
    expect(roleTooltip('seller')).toMatch(/^Vendedor: .*Puede: .*No puede: /)
    expect(roleTooltip('desconocido')).toBe('desconocido')
  })
})
