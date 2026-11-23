/** Contratar sin prueba gratis: desde la landing, el comercio escribe sus datos, elige su plan y paga con Bold.
 *
 * Reutiliza lo que ya existe, en este orden:
 *   1. la creación de la tienda del registro (createTrialStore), sin enviar el correo de la prueba;
 *   2. la solicitud del plan (requestPlan) sobre esa tienda, sin el correo «solicitud recibida»;
 *   3. el pago del plan con la cuenta Bold de la plataforma (createPlanCheckout).
 * Cuando Bold aprueba el pago, activatePlanRequest activa el plan y envía el correo «Pago confirmado: crea tu
 * contraseña» con el enlace de acceso. Si no paga, la tienda queda sin confirmar y la limpieza habitual la retira.
 */
import type { Env } from '../index'
import { normalizeEmail } from './platformUsers'
import { createTrialStore, requestPlan, TrialFlowError, upgradePlans } from './freeTrial'
import { createPlanCheckout, findPlanAttempt, planPaymentStatus, platformBoldOffered } from './planPayments'

type Bindings = Env['Bindings']

export async function purchasePlan(db: D1Database, env: Bindings, body: Record<string, unknown>, ip: string, returnUrl: string, fetcher: typeof fetch = fetch) {
  if (!platformBoldOffered(env)) throw new TrialFlowError('ONLINE_PAYMENT_UNAVAILABLE', 'La contratación en línea no está disponible en este momento. Escríbenos por WhatsApp y te ayudamos.', 409)
  const cycle = body.cycle === 'anual' ? 'anual' : body.cycle === 'mensual' ? 'mensual' : null
  if (!cycle) throw new TrialFlowError('INVALID_CYCLE', 'Elige pago mensual o anual.')
  const plan = (await upgradePlans(db)).find((item) => item.code === String(body.planCode || ''))
  if (!plan) throw new TrialFlowError('INVALID_PLAN', 'Elige uno de los planes disponibles.')

  const store = await createTrialStore(db, env, body, ip, fetcher, { sendLink: false })
  if (store.kind !== 'created' && store.kind !== 'pending') {
    if (store.kind === 'existing') throw new TrialFlowError('ACCOUNT_EXISTS', 'Ese correo ya tiene una cuenta en TiendIA Exprés. Te enviamos un correo para entrar: inicia sesión y contrata desde «Activar mi tienda».', 409)
    throw new TrialFlowError('PURCHASE_NOT_AVAILABLE', 'No pudimos preparar la contratación con ese correo. Escríbenos por WhatsApp y te ayudamos.', 409)
  }
  const actor = `compra:${store.email}`.slice(0, 160)
  await requestPlan(db, env, store.storeId, { planCode: plan.code, cycle }, actor, { allowPending: true, notify: false })
  const checkout = await createPlanCheckout(db, env, { storeId: store.storeId, returnUrl, actor })
  return { ...checkout, storeName: store.storeName, email: store.email }
}

/** The buyer came back from Bold. No session yet: the reference and the email of the purchase identify it. */
export async function purchaseStatus(db: D1Database, env: Bindings, reference: string, rawEmail: unknown) {
  const email = normalizeEmail(rawEmail)
  const attempt = await findPlanAttempt(db, reference)
  const owner = attempt ? await db.prepare(
    `SELECT u.email FROM store_memberships m JOIN platform_users u ON u.id = m.user_id WHERE m.store_id = ? AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1`,
  ).bind(attempt.store_id).first<{ email: string }>() : null
  if (!attempt || !email || !owner || owner.email.toLowerCase() !== email) throw new TrialFlowError('PAYMENT_NOT_FOUND', 'No encontramos ese pago.', 404)
  const status = await planPaymentStatus(db, env, attempt.store_id, reference)
  return { attemptStatus: status.attemptStatus, planActive: status.planActive, planName: status.planName, amount: status.amount, currency: status.currency, mode: status.mode, code: status.code }
}
