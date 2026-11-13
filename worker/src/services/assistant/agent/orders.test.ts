/** Lectura determinista de pedidos: referencias, cambios y periodos. Sin base de datos ni IA. */
import { describe, expect, it } from 'vitest'
import { changeOf, methodOf, periodOf, readOrderRequest, refOf } from './orders'

const none = { hasList: false, hasFocus: false }

describe('referencia del pedido', () => {
  it('reconoce códigos con letras y dígitos, solo letras y solo dígitos', () => {
    expect(refOf('despacha el pedido DDCCAFBC', false)).toEqual({ code: 'DDCCAFBC' })
    expect(refOf('confirma el pedido ddccafbc', false)).toEqual({ code: 'ddccafbc' })
    expect(refOf('confirma el pedido 20083005', false)).toEqual({ code: '20083005' })
    expect(refOf('confirma el pedido AB12CD34', false)).toEqual({ code: 'AB12CD34' })
    expect(refOf('y el DDCCAFBC', false)).toEqual({ code: 'DDCCAFBC' })
    expect(refOf('pedido PED-20261113-AB12CD34', false)).toEqual({ code: 'PED-20261113-AB12CD34' })
  })
  it('«pedido pendiente» o «pedido cancelado» no son códigos', () => {
    expect(refOf('tengo algún pedido pendiente', false)).toBeNull()
    expect(refOf('hay algún pedido cancelado', false)).toBeNull()
  })
  it('posición solo cuando hay una lista en pantalla; «el último» y el pedido en conversación', () => {
    expect(refOf('el 2', true)).toEqual({ position: 2 })
    expect(refOf('el 2', false)).toBeNull()
    expect(refOf('el segundo', true)).toEqual({ position: 2 })
    expect(refOf('muéstrame el último pedido', false)).toEqual({ latest: true })
    expect(refOf('pedidos de los últimos 7 días', false)).toBeNull()
    expect(refOf('confírmalo', false)).toEqual({ focus: true })
  })
})

describe('cambio pedido', () => {
  it('lee la acción y distingue una pregunta de una orden', () => {
    expect(changeOf('confirma el pedido AB12CD34')).toBe('confirmado')
    expect(changeOf('ya pagó')).toBe('pagado')
    expect(changeOf('confirma el pago del pedido AB12CD34')).toBe('pagado')
    expect(changeOf('el pedido AB12CD34 ya salió por Servientrega')).toBe('enviado')
    expect(changeOf('lo entregué a la transportadora')).toBe('enviado')
    expect(changeOf('ya lo recibió el cliente')).toBe('entregado')
    expect(changeOf('cancela el pedido AB12CD34')).toBe('cancelado')
    expect(changeOf('¿ya se envió el pedido AB12CD34?')).toBeNull()
    expect(changeOf('todavía no ha pagado')).toBeNull()
  })
  it('un verbo suelto sin pedido no es un cambio de pedido', () => {
    expect(readOrderRequest('cancela', none)).toBeNull()
    expect(readOrderRequest('confirma', none)).toBeNull()
    expect(readOrderRequest('confírmalo', none)).toBeNull()
    expect(readOrderRequest('confírmalo', { hasList: true, hasFocus: true })).toMatchObject({ kind: 'change', to: 'confirmado' })
    expect(readOrderRequest('cancela el pedido', none)).toMatchObject({ kind: 'change', to: 'cancelado', ref: null })
  })
  it('forma de entrega', () => {
    expect(methodOf('lo recogio en la tienda')).toBe('retiro_en_tienda')
    expect(methodOf('se lo lleve yo mismo')).toBe('entrega_personal')
    expect(methodOf('con un mensajero')).toBe('mensajero')
    expect(methodOf('por servientrega')).toBe('transportadora')
  })
})

describe('consultas y periodos', () => {
  it('periodos', () => {
    expect(periodOf('cuanto vendi hoy')).toEqual({ key: 'hoy' })
    expect(periodOf('pedidos de ayer')).toEqual({ key: 'ayer' })
    expect(periodOf('ventas de esta semana')).toEqual({ key: 'semana' })
    expect(periodOf('en los ultimos 15 dias')).toEqual({ key: 'dias', days: 15 })
    expect(periodOf('en los ultimos treinta dias')).toEqual({ key: 'dias', days: 30 })
    expect(periodOf('el mes pasado')).toEqual({ key: 'mes_pasado' })
    expect(periodOf('como van los pedidos')).toBeNull()
  })
  it('qué se pide', () => {
    expect(readOrderRequest('cómo van los pedidos', none)).toEqual({ kind: 'summary' })
    expect(readOrderRequest('cuántos pedidos llegaron hoy', none)).toMatchObject({ kind: 'report', focus: 'orders', period: { key: 'hoy' } })
    expect(readOrderRequest('cuánto vendí este mes', none)).toMatchObject({ kind: 'report', focus: 'sales', period: { key: 'mes' } })
    expect(readOrderRequest('qué es lo más vendido', none)).toMatchObject({ kind: 'top' })
    expect(readOrderRequest('qué pedidos tengo pendientes', none)).toEqual({ kind: 'list', filter: { status: 'pendiente' } })
    expect(readOrderRequest('qué pedidos tengo por enviar', none)).toEqual({ kind: 'list', filter: { view: 'por_enviar' } })
    expect(readOrderRequest('¿ya se envió el pedido AB12CD34?', none)).toMatchObject({ kind: 'show', ref: { code: 'AB12CD34' } })
  })
  it('catálogo, inventario y saludos no son pedidos', () => {
    for (const text of ['ponle 90 mil a las sandalias', 'llegaron 3 de la 38 de las sandalias', 'vendí 2 de la 38 de los tenis blancos', 'hola', 'cuántos quedan de las sandalias', 'sí', 'el 2']) expect(readOrderRequest(text, none)).toBeNull()
  })
})

describe('varias tareas y subidas de precio leídas con reglas', () => {
  it('parte el mensaje en sus tareas sin romper cantidades por talla', async () => {
    const { splitTasks } = await import('./orchestrator')
    expect(splitTasks('cuántas sandalias me quedan y súbeles 5 mil')).toEqual(['cuántas sandalias me quedan', 'súbeles 5 mil'])
    expect(splitTasks('llegaron 3 de la 38 y 2 de la 39 de las sandalias')).toEqual(['llegaron 3 de la 38 y 2 de la 39 de las sandalias'])
    expect(splitTasks('confirma el pedido AB12CD34 y súbele 5 mil a las sandalias')).toEqual(['confirma el pedido AB12CD34', 'súbele 5 mil a las sandalias'])
    expect(splitTasks('¿cuántas sandalias quedan? ¿y cuánto valen las gorras?')).toEqual(['cuántas sandalias quedan?', 'cuánto valen las gorras?'])
  })
  it('«súbele…» y «bájale…» son un cambio de precio exacto, nunca un producto nuevo', async () => {
    const { readPriceBump, rulesSteps } = await import('./orchestrator')
    expect(readPriceBump('súbele 5 mil a las sandalias')).toEqual({ kind: 'price', mode: 'increase', amount: 5000, percent: false, product: 'sandalias' })
    expect(readPriceBump('bájale el 10% a los tenis blancos')).toEqual({ kind: 'price', mode: 'decrease', amount: 10, percent: true, product: 'tenis blancos' })
    expect(readPriceBump('súbeles diez mil')).toEqual({ kind: 'price', mode: 'increase', amount: 10000, percent: false, product: null })
    expect(readPriceBump('bájale 10.000 al precio de las sandalias')).toMatchObject({ mode: 'decrease', amount: 10000, product: 'sandalias' })
    // A bare small number is never assumed to be thousands.
    expect(readPriceBump('súbele 5 a las sandalias')).toBeNull()
    expect(readPriceBump('sube las sandalias')).toBeNull()
    expect(rulesSteps('cuántas sandalias me quedan y súbeles 5 mil')?.map((step) => [step.tool, step.producto, step.monto])).toEqual([['ver_producto', 'sandalias', null], ['cambiar_precio', 'sandalias', 5000]])
    // A part the rules do not read with certainty stops everything: nothing is half-understood.
    expect(rulesSteps('súbele 5 mil a las sandalias y créame un producto nuevo')).toBeNull()
  })
})
