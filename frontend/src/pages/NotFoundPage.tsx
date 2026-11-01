import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-20 text-center">
      <div className="text-8xl mb-6">😕</div>
      <h1 className="text-3xl font-bold text-ink mb-3">Página no encontrada</h1>
      <p className="text-muted max-w-md mx-auto mb-8">
        La página que buscas no existe o fue movida. Revisa la dirección o vuelve al inicio.
      </p>
      <Link to="/" className="btn-brand inline-flex">
        Volver al inicio
      </Link>
    </div>
  )
}