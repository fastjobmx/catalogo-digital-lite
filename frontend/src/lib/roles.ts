/** What each store role can do, in the merchant's words. It mirrors the server rules
 * (worker/src/tenancy/access.ts ROLE_CAPABILITIES, the assistant tools and the owner-only routes);
 * keep both in sync when a permission changes. */
export type InvitableRole = 'admin' | 'operator' | 'seller' | 'inventory'

export interface RoleInfo {
  label: string
  summary: string
  can: string[]
  cannot: string[]
}

const LINK = 'Vincular su propio WhatsApp y Telegram y usar el asistente con estos permisos'

export const ROLE_INFO: Record<InvitableRole | 'owner', RoleInfo> = {
  owner: {
    label: 'Propietario',
    summary: 'Dueño de la tienda: puede hacer todo.',
    can: ['Todo lo del administrador', 'Invitar, desactivar y restablecer el acceso de las personas del equipo', 'Conectar la API propia de Gemini (Mi API)', 'Solicitar o cambiar el plan', LINK],
    cannot: [],
  },
  admin: {
    label: 'Administrador',
    summary: 'Maneja la tienda casi como el propietario, salvo el equipo, Mi API y el plan.',
    can: [
      'Pedidos: confirmar, marcar pagado, preparar, enviar con guía, entregar y cancelar',
      'Inventario por talla y color',
      'Crear y editar productos, fotos y precios; mostrar u ocultar',
      'Configuración, diseño, Estudio creativo y marketing',
      'Ver el equipo, el consumo de IA y el historial de cambios',
      'Ver pedidos, ventas y reportes',
      LINK,
    ],
    cannot: ['Invitar o desactivar personas (solo el propietario)', 'Conectar la API propia de Gemini (solo el propietario)', 'Solicitar o cambiar el plan'],
  },
  operator: {
    label: 'Operador',
    summary: 'Atiende pedidos y lleva el inventario.',
    can: [
      'Pedidos: confirmar, marcar pagado, preparar, enviar con guía, entregar y cancelar',
      'Inventario: sumar, restar o fijar unidades por talla y color, y marcar agotados',
      'Ver pedidos, productos, existencias y ventas',
      LINK,
    ],
    cannot: ['Crear o editar productos', 'Cambiar precios', 'Mostrar u ocultar productos', 'Configuración y diseño', 'Invitar al equipo'],
  },
  seller: {
    label: 'Vendedor',
    summary: 'Atiende los pedidos de los clientes.',
    can: [
      'Pedidos: confirmar, marcar pagado, preparar, enviar con guía, entregar y cancelar',
      'Ver pedidos, productos, existencias y ventas',
      LINK,
    ],
    cannot: ['Cambiar inventario', 'Crear o editar productos', 'Cambiar precios', 'Configuración y diseño', 'Invitar al equipo'],
  },
  inventory: {
    label: 'Encargado de inventario',
    summary: 'Lleva las existencias de la bodega.',
    can: [
      'Inventario: sumar, restar o fijar unidades por talla y color, y marcar agotados',
      'Ver pedidos, productos, existencias y ventas',
      LINK,
    ],
    cannot: ['Cambiar el estado de los pedidos', 'Crear o editar productos', 'Cambiar precios', 'Configuración y diseño', 'Invitar al equipo'],
  },
}

export const INVITABLE_ROLES: InvitableRole[] = ['admin', 'operator', 'seller', 'inventory']

/** One line for a tooltip: what the role can do. */
export const roleTooltip = (role: string): string => {
  const info = ROLE_INFO[role as InvitableRole | 'owner']
  return info ? `${info.label}: ${info.summary} Puede: ${info.can.join('; ')}.${info.cannot.length ? ` No puede: ${info.cannot.join('; ')}.` : ''}` : role
}
