// Unit checks for the public prices (src/content/plans.ts). Run: npm run test:unit
// The expected figures are the ones verified by the owner on 2026-11-11.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annualSaving, cop, firstYearMonthly, planMessage, plans } from '../src/content/plans.ts'

const expected = {
  emprendedor: { setup: 149000, monthly: 59900, annual: 599000, firstYear: 867800, saving: 268800 },
  negocio: { setup: 199000, monthly: 99900, annual: 999000, firstYear: 1397800, saving: 398800 },
  mayorista: { setup: 299000, monthly: 169900, annual: 1699000, firstYear: 2337800, saving: 638800 },
}

test('exactly three public plans, without the promotional plan', () => {
  assert.deepEqual(plans.map((p) => p.key), ['emprendedor', 'negocio', 'mayorista'])
  assert.ok(!JSON.stringify(plans).match(/promoci|primeros 20|lanzamiento/i))
})

for (const plan of plans) {
  const e = expected[plan.key]
  test(`${plan.name}: prices, first monthly year and saving`, () => {
    assert.equal(plan.setup, e.setup)
    assert.equal(plan.monthly, e.monthly)
    assert.equal(plan.annual, e.annual)
    assert.equal(firstYearMonthly(plan), e.firstYear)
    assert.equal(annualSaving(plan), e.saving)
  })
}

test('Colombian price format', () => {
  assert.equal(cop(149000), '$149.000 COP')
  assert.equal(cop(59900), '$59.900 COP')
  assert.equal(cop(1699000), '$1.699.000 COP')
  assert.equal(cop(0), '$0 COP')
})

test('WhatsApp message names the plan and the billing', () => {
  const negocio = plans[1]
  assert.equal(planMessage(negocio, 'mensual'), 'Hola, quiero el plan Negocio de TiendIA Exprés con pago mensual ($99.900 COP al mes + pago inicial de $199.000 COP).')
  assert.equal(planMessage(negocio, 'anual'), 'Hola, quiero el plan Negocio de TiendIA Exprés con pago anual ($999.000 COP al año, sin pago inicial adicional).')
})

test('nothing is advertised as unlimited', () => {
  assert.ok(!JSON.stringify(plans).match(/ilimitad/i))
})
