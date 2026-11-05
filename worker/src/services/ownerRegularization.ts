/** Supervised regularization of stores without an owner whose email is verified.
 * Requires a recorded identity check and explicit confirmation; nothing is assigned automatically,
 * and the new owner gets access only by opening the invitation sent to that address. */
import type { Env } from '../index'
import { assignOwner, PlatformError } from './platform'
import { sendInvitation } from './userAccess'

export const IDENTITY_METHODS = {
  videollamada: 'Videollamada con documento',
  documento: 'Documento de identidad y RUT/registro del negocio',
  presencial: 'Verificación presencial',
  canal_conocido: 'Confirmación por un canal ya registrado del comercio',
} as const

export async function storesWithoutVerifiedOwner(db: D1Database) {
  const { results } = await db.prepare(
    `SELECT s.id, s.slug, s.name, s.status,
            (SELECT u.email FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = s.id AND m.role = 'owner' AND m.status = 'active' LIMIT 1) AS ownerEmail
     FROM stores s
     WHERE s.status <> 'cancelled' AND NOT EXISTS (
       SELECT 1 FROM store_memberships m JOIN platform_users u ON u.id = m.user_id
       WHERE m.store_id = s.id AND m.role = 'owner' AND m.status = 'active' AND u.email_verified_at IS NOT NULL)
     ORDER BY s.id`,
  ).all<{ id: number; slug: string; name: string; status: string; ownerEmail: string | null }>()
  return (results || []).map((row) => ({ ...row, ownerAssigned: Boolean(row.ownerEmail) }))
}

export async function regularizeOwner(db: D1Database, env: Env['Bindings'], slug: string, body: Record<string, unknown>, actor: string) {
  const method = typeof body.identityMethod === 'string' && Object.hasOwn(IDENTITY_METHODS, body.identityMethod) ? body.identityMethod as keyof typeof IDENTITY_METHODS : null
  const evidence = typeof body.evidence === 'string' ? body.evidence.replace(/[\p{Cc}]/gu, ' ').trim().slice(0, 500) : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!method) throw new PlatformError('IDENTITY_METHOD_REQUIRED', 'Indica cómo verificaste la identidad del propietario.')
  if (evidence.length < 10) throw new PlatformError('EVIDENCE_REQUIRED', 'Describe la verificación (qué revisaste y cuándo). No adjuntes documentos ni datos sensibles.')
  if (body.confirm !== true) throw new PlatformError('CONFIRMATION_REQUIRED', 'Confirma que verificaste la identidad y que el propietario autorizó este correo.')
  const result = await assignOwner(db, env, slug, { email, name }, actor)
  await db.prepare(`INSERT INTO audit_log (action, entity_type, entity_id, payload, performed_by, source, store_id) VALUES ('owner_regularization', 'store', ?, ?, ?, 'platform', ?)`)
    .bind(String(result.store.id), JSON.stringify({ userId: result.userId, identityMethod: method, evidence }), actor, result.store.id).run()
  // Access only through the invitation sent to that address (it also verifies the email when opened).
  let invitation: { delivery: 'email' | 'manual'; activationUrl: string | null } | null = null
  if (result.activationUrl) {
    const user = await db.prepare('SELECT email, display_name AS displayName FROM platform_users WHERE id = ?').bind(result.userId).first<{ email: string; displayName: string }>()
    if (user?.email) invitation = await sendInvitation(db, env, { userId: result.userId, email: user.email, displayName: user.displayName, storeId: result.store.id, slug: result.store.slug, storeName: result.store.name }, actor)
  }
  return {
    store: { slug: result.store.slug, name: result.store.name }, userId: result.userId,
    invitation: invitation ? { delivery: invitation.delivery, activationUrl: invitation.activationUrl } : null,
    note: invitation?.delivery === 'email' ? 'Invitación enviada al correo autorizado.' : invitation ? 'El correo no está configurado: comparte este enlace de activación en privado, solo con el propietario verificado.' : 'El usuario ya tenía contraseña: pídele que verifique su correo desde Usuarios y accesos.',
  }
}
