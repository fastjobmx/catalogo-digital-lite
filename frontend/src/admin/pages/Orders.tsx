import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, ExternalLink, FileImage, Inbox, Loader2, MessageCircle, Printer, RefreshCw, Search, Upload, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getOrder, getOrderDocument, getOrders, getOrderStats, updateOrder, uploadOrderDocument, type OrderApi, type OrderDetailApi, type OrderPatch, type OrderStatsApi } from '../../services/api'
import { formatMoney } from '../../lib/format'
import { resolveImageUrl } from '../../lib/imageSources'
import { DELIVERY_METHODS, NEXT_STATUSES, ORDER_FLOW, ORDER_STATUS, PAYMENT_STATUS, REVERSIONS, SHIPPING_FOR_STATUS, SHIPPING_STATUS, eventLabel, valueLabel } from '../../lib/orderStatus'

const STATUSES = Object.keys(ORDER_STATUS)
const when = (value: string | null | undefined) => (value ? new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const dateInput = (value: string | null | undefined) => (value ? (value.includes('T') ? value : value.replace(' ', 'T')).slice(0, 10) : '')
const today = () => new Date().toISOString().slice(0, 10)

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"` }
function exportOrders(orders: OrderApi[]) {
  const columns = ['Pedido', 'Fecha', 'Comprador', 'Teléfono', 'Ciudad', 'Productos', 'Subtotal', 'Envío', 'Total', 'Moneda', 'Pago', 'Estado', 'Envío (estado)', 'Transportadora', 'Guía']
  const rows = orders.map((order) => [order.displayId, order.createdAt, order.customerName, order.customerPhone, order.customerCity,
    order.items.map((item) => `${item.quantity}x ${item.name} ${item.size || ''} ${item.color || ''}`).join(' | '), order.subtotal,
    order.shippingCost ?? 'Por cotizar', order.total ?? 'Por cotizar', order.currency, PAYMENT_STATUS[order.paymentStatus]?.label || order.paymentStatus,
    ORDER_STATUS[order.status]?.label || order.status, SHIPPING_STATUS[order.effectiveShippingStatus || '']?.label || '', order.carrier || '', order.trackingNumber || ''])
  const content = '﻿' + [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = 'pedidos.csv'; link.click(); URL.revokeObjectURL(url)
}

/** Status chip: icon + text + colour (never colour alone). */
function Badge({ map, value }: { map: Record<string, { label: string; icon: string; tone?: string }>; value: string | null | undefined }) {
  const item = value ? map[value] : undefined
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${item?.tone || 'border-line bg-canvas text-ink'}`}><span aria-hidden="true">{item?.icon || '•'}</span>{item?.label || value || '—'}</span>
}

function Section({ letter, title, children, className = '' }: { letter: string; title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line p-4 sm:p-5 ${className}`} aria-labelledby={`section-${letter}`}>
    <h3 id={`section-${letter}`} className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted"><span className="grid h-5 w-5 place-items-center rounded bg-canvas text-[10px] text-ink">{letter}</span>{title}</h3>
    {children}
  </section>
}

/** Pedido recibido → Confirmado → En preparación → Entregado a transportadora → Entregado. */
function Stepper({ status }: { status: string }) {
  const position = ORDER_FLOW.indexOf(status as typeof ORDER_FLOW[number])
  if (status === 'cancelado') return <p className="text-sm font-semibold text-red-800">✖ Pedido cancelado</p>
  return <ol className="grid grid-cols-5 gap-1" aria-label="Avance del pedido">{ORDER_FLOW.map((step, index) => {
    const done = index <= position
    return <li key={step} className="flex flex-col items-center gap-1 text-center" aria-current={index === position ? 'step' : undefined}>
      <span className={`grid h-8 w-8 place-items-center rounded-full border-2 text-sm ${done ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-muted'}`} aria-hidden="true">{done ? '✓' : index + 1}</span>
      <span className={`text-[10px] leading-tight sm:text-xs ${index === position ? 'font-bold text-ink' : 'text-muted'}`}>{index === 0 ? 'Pedido recibido' : ORDER_STATUS[step]!.label}{done && index !== position ? <span className="sr-only"> (completado)</span> : null}</span>
    </li>
  })}</ol>
}

function GuidePhotos({ order, onChanged }: { order: OrderDetailApi; onChanged: () => void }) {
  const { token } = useAuth()
  const [urls, setUrls] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    const created: string[] = []
    void (async () => {
      for (const doc of order.documents.slice(0, 3)) {
        try { const blob = await getOrderDocument(order.id, doc.id, token!); const url = URL.createObjectURL(blob); created.push(url); if (active) setUrls((current) => ({ ...current, [doc.id]: url })) } catch { /* shown as unavailable */ }
      }
    })()
    return () => { active = false; created.forEach((url) => URL.revokeObjectURL(url)) }
  }, [order.id, order.documents, token])
  const download = async (id: number) => {
    const blob = await getOrderDocument(order.id, id, token!, true)
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `guia-pedido-${order.displayId}`; link.click(); URL.revokeObjectURL(url)
  }
  const upload = async (file: File | undefined) => {
    if (!file || !token) return
    setBusy(true); setMessage('')
    try { const result = await uploadOrderDocument(order.id, file, token); setMessage(result.duplicate ? 'Esa foto ya estaba registrada.' : 'Guía guardada.'); onChanged() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo subir la guía') }
    finally { setBusy(false) }
  }
  return <div className="space-y-2">
    <p className="text-xs font-semibold">Fotografía de la guía</p>
    {order.documents.length === 0 ? <p className="text-xs text-muted">Sin foto registrada.</p> : <div className="flex flex-wrap gap-2">{order.documents.map((doc) => <div key={doc.id} className="w-28 space-y-1">
      {urls[doc.id] ? <a href={urls[doc.id]} target="_blank" rel="noopener noreferrer"><img src={urls[doc.id]} alt={`Guía registrada el ${when(doc.createdAt)}`} className="h-28 w-28 rounded-btn border border-line object-cover" /></a> : <span className="grid h-28 w-28 place-items-center rounded-btn border border-line bg-canvas"><FileImage size={20} className="text-muted" aria-hidden="true" /></span>}
      <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand" onClick={() => void download(doc.id)}><Download size={12} /> Descargar</button>
    </div>)}</div>}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
    <button type="button" className="no-print inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold hover:bg-canvas" onClick={() => input.current?.click()} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Subir foto de guía</button>
    {message && <p className="text-xs" role="status">{message}</p>}
    <p className="text-[11px] text-muted">Puede contener datos personales: solo la ve tu equipo y se conserva 180 días después de la entrega.</p>
  </div>
}

function DetailModal({ order, onClose, onSaved }: { order: OrderDetailApi; onClose: () => void; onSaved: (updated: OrderDetailApi) => void }) {
  const { token } = useAuth()
  const [status, setStatus] = useState(order.status)
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus)
  const [shippingStatus, setShippingStatus] = useState(order.shippingStatus || '')
  const [shipping, setShipping] = useState(order.shippingCost == null ? '' : String(order.shippingCost))
  const [notes, setNotes] = useState(order.internalNotes || '')
  const [carrier, setCarrier] = useState(order.carrier || '')
  const [tracking, setTracking] = useState(order.trackingNumber || '')
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl || '')
  const [shippedAt, setShippedAt] = useState(dateInput(order.shippedAt) || '')
  const [shippingNotes, setShippingNotes] = useState(order.shippingNotes || '')
  const [deliveredAt, setDeliveredAt] = useState(dateInput(order.deliveredAt) || '')
  const [method, setMethod] = useState(order.delivery?.method || '')
  const [receiver, setReceiver] = useState(order.delivery?.receiver || '')
  const [deliveryNotes, setDeliveryNotes] = useState(order.delivery?.notes || '')
  const [reference, setReference] = useState(order.delivery?.reference || '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const savingRef = useRef(false)
  const reverting = (REVERSIONS[order.status] || []).includes(status)
  const showCarrier = status === 'enviado' || ['enviado', 'entregado'].includes(order.status) || Boolean(order.carrier)
  const showDelivery = status === 'entregado' || order.status === 'entregado'
  const shippingOptions = SHIPPING_FOR_STATUS[status] || []
  const costError = shipping !== '' && (!/^\d+$/.test(shipping) || Number(shipping) > 100000000) ? 'Escribe el costo en pesos enteros, sin puntos ni decimales.' : ''

  const save = async () => {
    if (!token || savingRef.current || costError) return
    savingRef.current = true; setSaving(true); setError(''); setSaved('')
    const patch: OrderPatch = { expectedRevision: order.revision }
    if (status !== order.status) patch.status = status
    if (paymentStatus !== order.paymentStatus) patch.paymentStatus = paymentStatus
    if ((shippingStatus || null) !== (order.shippingStatus || null) && shippingStatus) patch.shippingStatus = shippingStatus
    if (notes !== (order.internalNotes || '')) patch.internalNotes = notes
    if ((shipping === '' ? null : Number(shipping)) !== order.shippingCost) patch.shippingCost = shipping === '' ? null : Number(shipping)
    if (carrier.trim() !== (order.carrier || '')) patch.carrier = carrier.trim() || null
    if (tracking.trim() !== (order.trackingNumber || '')) patch.trackingNumber = tracking.trim() || null
    if (trackingUrl.trim() !== (order.trackingUrl || '')) patch.trackingUrl = trackingUrl.trim() || null
    if (shippedAt && shippedAt !== dateInput(order.shippedAt)) patch.shippedAt = shippedAt
    if (shippingNotes.trim() !== (order.shippingNotes || '')) patch.shippingNotes = shippingNotes.trim() || null
    if (showDelivery) {
      const delivery: NonNullable<OrderPatch['delivery']> = {}
      if (method !== (order.delivery?.method || '')) delivery.method = method || null
      if (deliveredAt && deliveredAt !== dateInput(order.deliveredAt)) delivery.deliveredAt = deliveredAt
      if (receiver.trim() !== (order.delivery?.receiver || '')) delivery.receiver = receiver.trim() || null
      if (deliveryNotes.trim() !== (order.delivery?.notes || '')) delivery.notes = deliveryNotes.trim() || null
      if (reference.trim() !== (order.delivery?.reference || '')) delivery.reference = reference.trim() || null
      if (Object.keys(delivery).length) patch.delivery = delivery
    }
    if (reverting) patch.reason = reason.trim() || null
    try {
      if (Object.keys(patch).length === 1) { setSaved('No había cambios por guardar.'); return }
      const result = await updateOrder(order.id, patch, token)
      onSaved(await getOrder(order.id, token))
      setSaved(result.changed ? `Cambios guardados (${result.changed}).` : 'No había cambios por guardar.')
      setReason('')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el pedido') }
    finally { savingRef.current = false; setSaving(false) }
  }

  const trackingText = [order.carrier ? `Transportadora: ${order.carrier}` : null, order.trackingNumber ? `Guía: ${order.trackingNumber}` : null, order.trackingUrl ? `Seguimiento: ${order.trackingUrl}` : null].filter(Boolean).join('\n')
  const phone = (order.customerPhone || '').replace(/\D/g, '')
  const statusChoices = [order.status, ...(NEXT_STATUSES[order.status] || []), ...(REVERSIONS[order.status] || [])]

  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/50 p-2 sm:p-8" role="dialog" aria-modal="true" aria-label={`Pedido ${order.displayId}`}>
    <style>{`@media print { body * { visibility: hidden !important; } .print-order, .print-order * { visibility: visible !important; } .print-order { position: absolute; inset: 0; width: 100%; padding: 24px; } .no-print { display:none !important; } }`}</style>
    <div className="print-order mx-auto w-full max-w-5xl rounded-card bg-surface p-4 shadow-2xl sm:p-7">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-widest text-muted">Pedido</p><h2 className="text-2xl font-bold">{order.displayId}</h2><p className="text-sm text-muted">{when(order.createdAt)}</p>
          <div className="flex flex-wrap gap-2"><Badge map={ORDER_STATUS} value={order.status} /><Badge map={PAYMENT_STATUS} value={order.paymentStatus} /><Badge map={SHIPPING_STATUS} value={order.effectiveShippingStatus} /></div></div>
        <div className="no-print flex gap-2"><button className="inline-flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas" onClick={() => window.print()}><Printer size={16} /> Imprimir</button><button className="rounded-btn p-2 hover:bg-canvas" onClick={onClose} aria-label="Cerrar"><X /></button></div>
      </header>
      <div className="mb-5"><Stepper status={order.status} /></div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <Section letter="A" title="Artículos del pedido">
            <div className="space-y-3">{order.items.map((item, i) => {
              const image = resolveImageUrl(item.imageUrl)
              return <article key={`${item.variantId}-${i}`} className="flex gap-3">
                <button type="button" className="h-16 w-16 shrink-0 overflow-hidden rounded-btn bg-canvas text-xs text-muted" onClick={() => image && setZoomUrl(image)} disabled={!image} aria-label={image ? `Ampliar foto de ${item.name}` : `Foto no disponible: ${item.name}`}>
                  {image ? <img src={image} alt={item.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center">Sin foto</span>}
                </button>
                <div className="min-w-0 flex-1"><h4 className="font-semibold">{item.name}</h4><p className="text-xs text-muted">SKU {item.sku} · {[item.color, item.size].filter(Boolean).join(' / ') || 'Variante sin detalle'}</p>
                  <div className="mt-1 flex justify-between gap-2 text-sm"><span>{item.quantity} × {formatMoney(item.price, order.currency)}</span><b>{formatMoney(item.lineSubtotal ?? item.price * item.quantity, order.currency)}</b></div></div>
              </article>
            })}</div>
          </Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Section letter="B" title="Datos del comprador"><dl className="space-y-1 text-sm">
              {[['Nombre', order.customerName], ['Teléfono', order.customerPhone], ['Correo', order.customerEmail], ['Ciudad', order.customerCity], ['Dirección', order.deliveryAddress], ['Entrega pedida', order.deliveryMethod], ['Pago preferido', order.paymentMethod]].map(([label, value]) =>
                <div key={label}><dt className="inline text-muted">{label}: </dt><dd className="inline break-words">{value || '—'}</dd></div>)}
              {order.customerNotes && <div className="pt-2"><dt className="text-muted">Observaciones del comprador</dt><dd>{order.customerNotes}</dd></div>}
            </dl></Section>
            <Section letter="C" title="Resumen económico"><div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><b>{formatMoney(order.subtotal, order.currency)}</b></div>
              <div className="flex justify-between"><span>Descuento</span><b>{formatMoney(order.discountTotal, order.currency)}</b></div>
              <div className="flex justify-between"><span>Envío</span><b>{order.shippingCost == null ? 'Por cotizar' : formatMoney(order.shippingCost, order.currency)}</b></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-base"><span>Total</span><b>{order.total == null ? 'Por cotizar' : formatMoney(order.total, order.currency)}</b></div>
            </div></Section>
          </div>
          <Section letter="G" title="Historial del pedido">
            {order.events.length === 0 ? <p className="text-sm text-muted">Sin movimientos registrados.</p> : <ol className="relative space-y-3 border-l-2 border-line pl-4">{order.events.map((event) => {
              const main = ['status', 'status_revert', 'created', 'legacy_import'].includes(event.eventType)
              return <li key={event.id} className="relative">
                <span className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full border-2 ${main ? 'border-brand bg-brand' : 'border-line bg-surface'}`} aria-hidden="true" />
                <p className={`text-sm ${main ? 'font-semibold' : ''}`}>{eventLabel(event.eventType)}{event.fromValue || event.toValue ? `: ${event.fromValue ? `${valueLabel(event.eventType, event.fromValue)} → ` : ''}${valueLabel(event.eventType, event.toValue)}` : ''}</p>
                {event.note && <p className="text-xs">{event.eventType === 'status_revert' ? 'Motivo: ' : 'Observación: '}{event.note}</p>}
                <p className="text-[11px] text-muted">{when(event.createdAt)} · {event.performedBy} · evento #{event.id}</p>
              </li>
            })}</ol>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section letter="D" title="Estado del pedido" className="no-print">
            <label className="block text-xs font-semibold">Estado<select className="input-field mt-1" value={status} onChange={(e) => { setStatus(e.target.value); setSaved('') }}>{[...new Set(statusChoices)].map((value) => <option key={value} value={value}>{(REVERSIONS[order.status] || []).includes(value) ? '↩ Volver a: ' : ''}{ORDER_STATUS[value]?.label || value}</option>)}</select></label>
            {reverting && <label className="mt-3 block text-xs font-semibold">Motivo para volver atrás (obligatorio; requiere rol propietario o administrador)<textarea rows={2} maxLength={300} className="input-field mt-1" value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
            {status === 'entregado' && order.status !== 'entregado' && <p className="mt-2 text-xs text-muted">Marcarlo como entregado no cambia el estado del pago.</p>}
          </Section>
          <Section letter="E" title="Estado del pago" className="no-print">
            <label className="block text-xs font-semibold">Pago<select className="input-field mt-1" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setSaved('') }}>{Object.keys(PAYMENT_STATUS).map((value) => <option key={value} value={value}>{PAYMENT_STATUS[value]!.label}</option>)}</select></label>
            <p className="mt-2 text-xs text-muted">Es independiente del estado del pedido y del envío.</p>
          </Section>
          <Section letter="F" title="Información de envío">
            <div className="space-y-3">
              {shippingOptions.length > 0 && <label className="no-print block text-xs font-semibold">Estado del envío<select className="input-field mt-1" value={shippingStatus || order.effectiveShippingStatus || ''} onChange={(e) => setShippingStatus(e.target.value)}>{shippingOptions.map((value) => <option key={value} value={value}>{SHIPPING_STATUS[value]!.label}</option>)}</select></label>}
              <label className="no-print block text-xs font-semibold">Costo del envío ({order.currency})<input inputMode="numeric" className="input-field mt-1" value={shipping} onChange={(e) => setShipping(e.target.value.replace(/[^\d]/g, ''))} placeholder="Vacío = por cotizar" aria-invalid={Boolean(costError)} />{costError && <span className="text-red-700">{costError}</span>}</label>
              {showCarrier && <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold">Transportadora{status === 'enviado' && ' *'}<input className="input-field mt-1" maxLength={60} value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Ej.: Servientrega" /></label>
                <label className="block text-xs font-semibold">Número de guía<input className="input-field mt-1" maxLength={80} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tal como aparece en la guía" /></label>
                <label className="block text-xs font-semibold">Fecha de entrega a transportadora<input type="date" max={today()} className="input-field mt-1" value={shippedAt} onChange={(e) => setShippedAt(e.target.value)} /></label>
                <label className="block text-xs font-semibold">URL de seguimiento (opcional)<input type="url" className="input-field mt-1" maxLength={300} value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://…" /></label>
                <label className="block text-xs font-semibold sm:col-span-2">Notas de envío (opcional)<input className="input-field mt-1" maxLength={500} value={shippingNotes} onChange={(e) => setShippingNotes(e.target.value)} /></label>
              </div>}
              {showDelivery && <div className="grid gap-3 rounded-btn bg-canvas p-3 sm:grid-cols-2">
                <p className="text-xs font-bold sm:col-span-2">Confirmación de entrega</p>
                <label className="block text-xs font-semibold">Método de entrega *<select className="input-field mt-1" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Elige…</option>{Object.entries(DELIVERY_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="block text-xs font-semibold">Fecha de entrega<input type="date" max={today()} className="input-field mt-1" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} /></label>
                <label className="block text-xs font-semibold">Receptor (opcional)<input className="input-field mt-1" maxLength={120} value={receiver} onChange={(e) => setReceiver(e.target.value)} /></label>
                <label className="block text-xs font-semibold">Referencia de confirmación (opcional)<input className="input-field mt-1" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                <label className="block text-xs font-semibold sm:col-span-2">Observaciones<input className="input-field mt-1" maxLength={500} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} /></label>
              </div>}
              <GuidePhotos order={order} onChanged={() => void (async () => onSaved(await getOrder(order.id, token!)))()} />
              {trackingText && <button type="button" className="no-print inline-flex items-center gap-1.5 text-xs font-semibold text-brand" onClick={() => { void navigator.clipboard?.writeText(`Pedido ${order.displayId}\n${trackingText}`); setSaved('Datos de seguimiento copiados.') }}><Copy size={13} /> Copiar datos de seguimiento</button>}
              <p className="text-[11px] text-muted">No hay seguimiento automático con las transportadoras: los estados los registra tu equipo.</p>
            </div>
          </Section>
          <Section letter="H" title="Notas internas" className="no-print">
            <textarea maxLength={4000} rows={3} className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Solo visible para el equipo administrador" aria-label="Notas internas" />
          </Section>
          <div className="no-print sticky bottom-0 space-y-2 rounded-card border border-line bg-surface p-3 shadow-lg lg:static lg:shadow-none">
            {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
            {saved && <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} /> {saved}</p>}
            <button className="btn-brand inline-flex w-full items-center justify-center gap-2" onClick={() => void save()} disabled={saving || Boolean(costError)} aria-busy={saving}>{saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Guardando…' : 'Guardar cambios'}</button>
            {order.customerNotice && phone.length >= 8 && <a className="inline-flex w-full items-center justify-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas" href={`https://wa.me/${phone}?text=${encodeURIComponent(order.customerNotice)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Avisar al cliente por WhatsApp</a>}
            {order.customerNotice && <p className="text-[11px] text-muted">El mensaje se abre en tu WhatsApp para que lo revises y lo envíes tú; no se envía nada automáticamente.</p>}
          </div>
        </div>
      </div>
    </div>
    {zoomUrl && <button className="no-print fixed inset-0 z-[80] grid place-items-center bg-black/90 p-5" onClick={() => setZoomUrl(null)} aria-label="Cerrar imagen ampliada"><img src={zoomUrl} alt="Fotografía ampliada del artículo" className="max-h-full max-w-full object-contain" /><X className="absolute right-5 top-5 text-white" /></button>}
  </div>
}

const STAT_CARDS: Array<{ key: keyof OrderStatsApi; label: string; icon: string; filter: { status?: string; shipping?: string } }> = [
  { key: 'pendiente', label: 'Pendientes', icon: '📥', filter: { status: 'pendiente' } },
  { key: 'confirmado', label: 'Confirmados', icon: '✅', filter: { status: 'confirmado' } },
  { key: 'preparando', label: 'En preparación', icon: '📦', filter: { status: 'preparando' } },
  { key: 'entregado_transportadora', label: 'En transportadora', icon: '🚚', filter: { status: 'enviado' } },
  { key: 'en_transito', label: 'En tránsito', icon: '🛣', filter: { status: 'enviado', shipping: 'en_transito' } },
  { key: 'entregado', label: 'Entregados', icon: '🏁', filter: { status: 'entregado' } },
  { key: 'cancelado', label: 'Cancelados', icon: '✖', filter: { status: 'cancelado' } },
]

export default function AdminOrders() {
  const { token, isDemoSession } = useAuth()
  const [orders, setOrders] = useState<OrderApi[]>([])
  const [stats, setStats] = useState<OrderStatsApi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<OrderDetailApi | null>(null)
  const [status, setStatus] = useState('todos')
  const [shippingFilter, setShippingFilter] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [csvLoading, setCsvLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const query = useMemo(() => ({ page, pageSize, status, shipping: shippingFilter, from, to, q }), [page, pageSize, status, shippingFilter, from, to, q])

  const load = useCallback(async () => {
    if (!token || isDemoSession) { setOrders([]); setTotal(0); setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const [result, counters] = await Promise.all([getOrders(token, query), getOrderStats(token).catch(() => null)])
      setOrders(result.items); setTotal(result.total); setStats(counters)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los pedidos') }
    finally { setLoading(false) }
  }, [token, isDemoSession, query])
  useEffect(() => { void load() }, [load])

  const openOrder = async (id: number) => {
    if (!token) return
    try { setSelected(await getOrder(id, token)) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el pedido') }
  }
  const saved = async (updated: OrderDetailApi) => { setSelected(updated); await load() }

  const exportCsv = async () => {
    if (!token) return
    setCsvLoading(true)
    try {
      const first = await getOrders(token, { ...query, page: 1, pageSize: 100 })
      const all = [...first.items]
      for (let nextPage = 2; all.length < first.total; nextPage++) {
        const next = await getOrders(token, { ...query, page: nextPage, pageSize: 100 })
        if (!next.items.length) break
        all.push(...next.items)
      }
      exportOrders(all)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo exportar el CSV') }
    finally { setCsvLoading(false) }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-muted">Operaciones</p><h1 className="mt-1 text-3xl font-bold">Pedidos</h1><p className="mt-1 text-sm text-muted">Estado del pedido, del pago y del envío, con su historial.</p></div>
      <div className="flex gap-2"><button className="inline-flex items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" onClick={() => void exportCsv()} disabled={!orders.length || csvLoading}><Download size={16} /> {csvLoading ? 'Preparando…' : 'CSV'}</button><button className="btn-brand inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button></div>
    </div>
    {error && <p role="alert" className="card p-4 text-sm text-red-700">{error}</p>}
    {isDemoSession ? <p className="card bg-amber-50 p-4 text-sm">El panel de pedidos está deshabilitado durante la sesión demo. No se consultan datos de compradores.</p> : <>
      {stats && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{STAT_CARDS.map((card) => {
        const active = status === (card.filter.status || 'todos') && shippingFilter === (card.filter.shipping || '')
        return <button key={card.key} type="button" aria-pressed={active} onClick={() => { setPage(1); setStatus(active ? 'todos' : card.filter.status || 'todos'); setShippingFilter(active ? '' : card.filter.shipping || '') }}
          className={`card p-3 text-left transition-colors ${active ? 'ring-2 ring-brand' : 'hover:bg-canvas'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted"><span aria-hidden="true">{card.icon}</span> {card.label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{stats[card.key]}</p>
        </button>
      })}</div>}
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_200px_160px_160px]"><label className="relative"><Search size={17} className="absolute left-3 top-3 text-muted" /><input className="input-field pl-9" placeholder="ID, cliente, teléfono o producto" value={q} onChange={(e) => { setPage(1); setQ(e.target.value) }} aria-label="Buscar pedidos" /></label>
        <select className="input-field" value={shippingFilter ? `${status}|${shippingFilter}` : status} aria-label="Filtrar por estado" onChange={(e) => { const [s, sh] = e.target.value.split('|'); setPage(1); setStatus(s!); setShippingFilter(sh || '') }}><option value="todos">Todos los estados</option>{STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS[s]!.label}</option>)}<option value="enviado|en_transito">En tránsito</option><option value="enviado|incidencia">Incidencia de entrega</option></select>
        <label className="text-xs text-muted">Desde<input type="date" className="input-field mt-1" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value) }} /></label><label className="text-xs text-muted">Hasta<input type="date" className="input-field mt-1" value={to} onChange={(e) => { setPage(1); setTo(e.target.value) }} /></label>
      </div>
      {loading ? <p className="text-sm text-muted">Cargando pedidos…</p> : orders.length === 0 ? <div className="card p-12 text-center"><Inbox className="mx-auto mb-3 text-muted" /><p className="text-muted">No hay pedidos para estos filtros.</p></div> : <>
        <div className="space-y-2 md:hidden">{orders.map((order) => <button key={order.id} type="button" onClick={() => void openOrder(order.id)} className="card w-full space-y-2 p-4 text-left">
          <div className="flex items-start justify-between gap-2"><div><b>{order.displayId}</b><p className="text-xs text-muted">{when(order.createdAt)} · {order.customerName || 'Sin nombre'}</p></div><b className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</b></div>
          <div className="flex flex-wrap gap-1.5"><Badge map={ORDER_STATUS} value={order.status} /><Badge map={PAYMENT_STATUS} value={order.paymentStatus} /></div>
        </button>)}</div>
        <div className="card hidden overflow-hidden md:block"><div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{['Pedido / fecha', 'Comprador', 'Artículos', 'Subtotal', 'Pago', 'Pedido', 'Envío', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-line">{orders.map((order) => <tr key={order.id} className="hover:bg-canvas/60"><td className="px-4 py-3"><b>{order.displayId}</b><p className="text-xs text-muted">{when(order.createdAt)}</p></td><td className="px-4 py-3">{order.customerName || 'Sin nombre'}<p className="text-xs text-muted">{order.customerCity || '—'}</p></td><td className="px-4 py-3"><div className="flex items-center gap-1">{order.items.slice(0, 3).map((item, i) => { const src = resolveImageUrl(item.imageUrl); return src ? <img key={`${item.variantId}-${i}`} src={src} alt="" className="h-9 w-9 rounded object-cover" /> : <span key={`${item.variantId}-${i}`} className="grid h-9 w-9 place-items-center rounded bg-canvas text-[9px] text-muted">—</span> })}<span className="ml-1 text-xs text-muted">{order.items.length} líneas</span></div></td><td className="px-4 py-3 font-semibold tabular-nums">{formatMoney(order.subtotal, order.currency)}<p className="text-[11px] font-normal text-muted">Envío: {order.shippingCost == null ? 'Por cotizar' : formatMoney(order.shippingCost, order.currency)}</p></td><td className="px-4 py-3"><Badge map={PAYMENT_STATUS} value={order.paymentStatus} /></td><td className="px-4 py-3"><Badge map={ORDER_STATUS} value={order.status} /></td><td className="px-4 py-3 text-xs">{SHIPPING_STATUS[order.effectiveShippingStatus || '']?.label || '—'}{order.trackingNumber && <p className="text-muted">{order.carrier} · {order.trackingNumber}</p>}</td><td className="px-4 py-3"><button className="inline-flex items-center gap-1 font-semibold text-brand" onClick={() => void openOrder(order.id)}>Detalle <ExternalLink size={14} /></button></td></tr>)}</tbody></table></div></div>
        <div className="flex items-center justify-between"><p className="text-xs text-muted">Mostrando {orders.length} de {total} pedidos</p><div className="flex gap-2"><button className="rounded-btn border border-line px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button><button className="rounded-btn border border-line px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div></div>
      </>}
    </>}
    {selected && <DetailModal key={selected.id} order={selected} onClose={() => setSelected(null)} onSaved={(updated) => void saved(updated)} />}
  </div>
}
