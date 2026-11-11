import type { CreditKind, CreditRequest } from '../services/api'

export const MOVEMENT_LABELS: Record<CreditKind, string> = {
  recarga: 'Recarga',
  ajuste: 'Ajuste',
  reserva: 'Uso de IA',
  consumo: 'Uso confirmado',
  liberacion: 'Devolución',
}

export const REQUEST_STATUS: Record<CreditRequest['status'], { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  aprobada: { label: 'Aprobada', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rechazada: { label: 'Rechazada', tone: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
}

export const FEATURE_LABELS: Record<string, string> = {
  foto_a_producto: 'Producto desde foto',
  estudio_imagen: 'Estudio IA',
  importar_pdf_pagina: 'Lectura de PDF',
  foto_packshot: 'Foto packshot',
  foto_premium: 'Foto premium',
}

export const formatCredits = (n: number) => new Intl.NumberFormat('es-CO').format(n)
export const formatDate = (value: string) => {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
