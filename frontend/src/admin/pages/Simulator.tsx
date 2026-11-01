import { useState } from 'react'
import { interpretCommand } from '../../lib/interpretCommand'
import { useCatalog } from '../../contexts/CatalogContext'

export default function AdminSimulator() {
  const { createProduct, products } = useCatalog()
  const [text, setText] = useState('Agrega tenis Reebok referencia 2514, precio 189900 pesos, stock 20 en cada talla desde la 38 hasta la 44.')
  const [log, setLog] = useState<string>('SIMULADO — no llama a Gemini ni a Telegram.')
  const [pending, setPending] = useState<ReturnType<typeof interpretCommand> | null>(null)

  const run = () => {
    const proposal = interpretCommand(text)
    setPending(proposal)
    setLog(JSON.stringify(proposal, null, 2))
  }

  const confirm = async () => {
    if (!pending || pending.action !== 'create_product' || !pending.params) return
    const params = pending.params as {
      sku: string
      name: string
      price: number
      variants?: Array<{ size?: string; stock: number }>
    }
    const exists = products.find((p) => p.sku.toLowerCase() === params.sku.toLowerCase())
    if (exists) {
      setLog(`La referencia ${params.sku} ya existe. No se duplicó. Edítala desde Productos.`)
      return
    }
    await createProduct({
      sku: params.sku,
      name: params.name,
      price: params.price,
      variants: params.variants,
    })
    setLog('Producto publicado en el catálogo local. Ábrelo en la tienda sin redesplegar.')
    setPending(null)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-3xl font-bold">Simulador del agente</h1>
      <p className="text-sm bg-amber-50 border border-amber-200 rounded-xl p-3">
        Estado: <strong>SIMULADO</strong>. Interpreta comandos conocidos sin Gemini.
        Telegram y voz quedan <strong>PENDIENTE DE CREDENCIALES</strong>.
      </p>
      <textarea className="input-field" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-brand" onClick={run}>Interpretar</button>
      <pre className="card p-4 text-xs overflow-auto whitespace-pre-wrap">{log}</pre>
      {pending?.needsConfirmation && (
        <button className="btn-accent" onClick={() => void confirm()}>Aprobar operación</button>
      )}
    </div>
  )
}
