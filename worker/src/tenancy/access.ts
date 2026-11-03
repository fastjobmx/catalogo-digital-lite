import { PRIMARY_STORE_ID, type StoreRecord } from './stores'

export type StoreRole = 'owner' | 'admin' | 'operator'

/** Who is acting. The platform superadmin is defined only by Worker secrets. */
export type Principal =
  | { kind: 'superadmin'; email: string }
  | { kind: 'user'; userId: number; email: string }

export const ROLE_RANK: Record<StoreRole, number> = { operator: 1, admin: 2, owner: 3 }

export const ROLE_LABELS: Record<StoreRole | 'superadmin', string> = {
  superadmin: 'Superadministrador de plataforma',
  owner: 'Propietario',
  admin: 'Administrador',
  operator: 'Operador',
}

/** The effective role of a principal in a store; superadmin acts as owner. */
export type EffectiveRole = StoreRole | 'superadmin'

export function roleAllows(role: EffectiveRole | null | undefined, minimum: StoreRole): boolean {
  if (!role) return false
  if (role === 'superadmin') return true
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export type Membership = { storeId: number; slug: string; name: string; status: StoreRecord['status']; role: StoreRole }

/** Active memberships for an active user, including the store's status. */
export async function listUserMemberships(db: D1Database, userId: number): Promise<Membership[]> {
  const result = await db.prepare(
    `SELECT s.id AS storeId, s.slug, s.name, s.status, m.role
     FROM store_memberships m
     JOIN stores s ON s.id = m.store_id
     JOIN platform_users u ON u.id = m.user_id
     WHERE m.user_id = ? AND m.status = 'active' AND u.status = 'active' AND s.status <> 'cancelled'
     ORDER BY s.name`,
  ).bind(userId).all<Membership>()
  return result.results || []
}

export async function getMembershipRole(db: D1Database, storeId: number, userId: number): Promise<StoreRole | null> {
  const row = await db.prepare(
    `SELECT m.role FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.store_id = ? AND m.user_id = ? AND m.status = 'active' AND u.status = 'active'`,
  ).bind(storeId, userId).first<{ role: StoreRole }>()
  return row?.role ?? null
}

/** Effective role of a principal in a store, or null when it has no access. */
export async function resolveStoreRole(db: D1Database, principal: Principal, store: StoreRecord): Promise<EffectiveRole | null> {
  if (principal.kind === 'superadmin') return 'superadmin'
  if (store.status === 'cancelled' || store.status === 'suspended') return null
  return getMembershipRole(db, store.id, principal.userId)
}

/** Telegram identity → stores it may administer. The legacy owner of the primary
 * store (TELEGRAM_OWNER_ID or the one-time link stored in store_config) keeps
 * owner access to store 1. */
export async function listTelegramMemberships(
  db: D1Database,
  telegramUserId: string,
  legacyOwnerIds: Array<string | null | undefined>,
): Promise<Membership[]> {
  const memberships: Membership[] = []
  const linked = await db.prepare(
    `SELECT s.id AS storeId, s.slug, s.name, s.status, m.role
     FROM platform_users u
     JOIN store_memberships m ON m.user_id = u.id AND m.status = 'active'
     JOIN stores s ON s.id = m.store_id
     WHERE u.telegram_user_id = ? AND u.status = 'active' AND s.status <> 'cancelled'
     ORDER BY s.name`,
  ).bind(telegramUserId).all<Membership>()
  memberships.push(...(linked.results || []))
  if (legacyOwnerIds.some((id) => id && String(id) === telegramUserId) && !memberships.some((m) => m.storeId === PRIMARY_STORE_ID)) {
    const primary = await db.prepare('SELECT id AS storeId, slug, name, status FROM stores WHERE id = ?').bind(PRIMARY_STORE_ID)
      .first<Omit<Membership, 'role'>>()
    if (primary && primary.status !== 'cancelled') memberships.unshift({ ...primary, role: 'owner' })
  }
  return memberships
}
