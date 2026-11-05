import { site } from '../config/site'
import { Button } from '../components/ui/primitives'

/** "Crea tu catálogo sin registro": the real no-account preview of the platform (/prueba).
 * It is temporary (48 hours) and unpublished; keeping a store is done with the team (Contact). */
export function Trial() {
  return (
    <section id="prueba" aria-labelledby="prueba-title" className="relative overflow-hidden bg-ivory py-20 md:py-28">
      <div className="wrap">
        <div className="grid items-center gap-10 rounded-[2rem] bg-forest p-8 text-ivory md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:p-14 on-dark">
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.18em] text-lime">Sin registro · gratis</p>
            <h2 id="prueba-title" className="display mt-4 text-[clamp(2.2rem,6vw,4.6rem)]">Crea tu catálogo <span className="text-lime">sin registro</span></h2>
            <p className="mt-5 max-w-xl text-lg text-mist">Sube fotos de tus productos y descubre cómo puede verse tu tienda online. Sin complicaciones. Importar tu lista completa desde Excel, CSV o PDF lo haces después, en el panel de tu tienda.</p>
            <div className="mt-8 flex flex-col gap-3 xs:flex-row xs:flex-wrap">
              <Button href={site.trialUrl} variant="lime" size="lg" icon="arrowUpRight" external>Probar gratis</Button>
              <Button href="#contacto" variant="outline-light" size="lg" icon="arrowRight">Crear mi tienda</Button>
            </div>
          </div>
          <ul className="grid gap-3 text-[0.98rem] text-mist">
            <li className="rounded-2xl bg-forest-raised p-5"><b className="block text-ivory">Vista previa real</b>Hasta 6 fotos y 12 productos, con el estilo que elijas.</li>
            <li className="rounded-2xl bg-forest-raised p-5"><b className="block text-ivory">Temporal y privada</b>No se publica, no se indexa y se borra sola en 48 horas.</li>
            <li className="rounded-2xl bg-forest-raised p-5"><b className="block text-ivory">Para quedártela</b>Cuando quieras tu tienda definitiva, la creamos contigo. La prueba no se convierte en tienda por sí sola.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
