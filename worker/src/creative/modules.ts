/** Identidad y estado real de los módulos del Estudio Creativo IA. El panel muestra exactamente esto:
 * lo que no está implementado figura como «próximamente», nunca con datos de ejemplo. */
import type { CreativeJobKind } from './contracts'

export const CREATIVE_STUDIO = {
  name: 'Estudio Creativo IA',
  description: 'Crea contenido profesional, organiza campañas y descubre oportunidades para tu negocio',
} as const

export type ModuleStatus = 'disponible' | 'base' | 'proximamente'

export const CREATIVE_MODULES: Array<{ key: string; name: string; status: ModuleStatus; summary: string }> = [
  { key: 'brand_kit', name: 'Brand Kit', status: 'disponible', summary: 'Logo, colores, tipografías, tono y público de tu marca.' },
  { key: 'trabajos', name: 'Trabajos', status: 'disponible', summary: 'Seguimiento de cada encargo creativo con su estado.' },
  { key: 'creditos', name: 'Control de créditos', status: 'disponible', summary: 'Usa los mismos Créditos IA de tu tienda; un trabajo fallido no descuenta.' },
  { key: 'biblioteca', name: 'Biblioteca de recursos', status: 'disponible', summary: 'Fotos originales privadas y piezas aprobadas por producto.' },
  { key: 'foto', name: 'Estudio fotográfico', status: 'disponible', summary: 'Mejora fotos de producto por lotes: edición convencional, packshot y composición premium.' },
  { key: 'video', name: 'Motor de video', status: 'proximamente', summary: 'Videos cortos a partir de tus fotos aprobadas.' },
  { key: 'creativos', name: 'Creativos publicitarios', status: 'proximamente', summary: 'Piezas para redes con tu Brand Kit aplicado.' },
  { key: 'oportunidades', name: 'Oportunidades', status: 'proximamente', summary: 'Sugerencias basadas en tus pedidos e inventario reales.' },
  { key: 'campanas', name: 'Campañas', status: 'proximamente', summary: 'Organiza contenido por campaña y fecha.' },
  { key: 'analitica', name: 'Analítica comercial', status: 'proximamente', summary: 'Resultados de tus pedidos y contenido.' },
  { key: 'aprobaciones', name: 'Aprobaciones', status: 'proximamente', summary: 'Nada se publica sin tu aprobación.' },
]

/** Tipos de trabajo que la ruta genérica POST /jobs puede crear: ninguno. Los de foto se crean por lotes
 * validados en /photo/batches (creative/photoEngine.ts). */
export const ENGINES_AVAILABLE: Record<CreativeJobKind, boolean> = {
  foto: false, video: false, creativo: false, oportunidades: false, campana: false, analitica: false,
}
