"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Empty } from "@/components/ui/ui";
import { DateRangePicker, rangoStr } from "@/components/ui/DateRangePicker";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { useParamsURL } from "@/lib/useParamsURL";
import { useRangoURL } from "@/lib/useRango";
import { nivelDeRuta } from "@/lib/permisos";
import { money } from "@/lib/format";
import { conPanel, miPanelDe, rangoDelPanel } from "@/lib/mi-panel";
import { Eye } from "lucide-react";
import { BarraVerComo } from "./BarraVerComo";
import { DetalleComisiones, DetalleMesa, type TramoMesa } from "./Detalles";
import { CobrosCargados, LlamadasDeHoy, ParaVos } from "./Listas";
import { PanelSetter } from "./PanelSetter";
import { Rendimiento } from "./Rendimiento";
import { TarjetaComisionPorCobrar, TarjetaComisiones, TarjetaMesa } from "./Tarjetas";
import { plural, saludoDe } from "./util";
import "./mi-panel.css";

/* ==================================================================
   «Mi panel» (reunión del 15/10), con la estructura del Mi Panel de Blue OS:

     · barra «Ver el panel de…» (sólo dueños)
     · saludo, el resumen del día, el rango y «Cargar venta»
     · plata (comisiones, sobre la mesa y la comisión que hay por cobrar)
     · cómo te va (agendas, show ups, ventas, tasas, cash)
     · llamadas de hoy y lo que pide acción
     · los cobros que cargaste y si ya los validaron

   Lo que Blue OS tiene y acá todavía no: el ranking del equipo (un closer
   sólo ve lo suyo, por la base), las tasks personales y los feedbacks del
   director, que necesitan sus propias tablas.
   ================================================================== */

export function MiPanel() {
  const e = useEstado();
  const yo = useUsuarioActual();
  const { acceso, esDueno } = useAcceso();
  const [v, cambiar] = useParamsURL({ persona: "" });
  const [rangoSel, setRango] = useRangoURL("mes");

  /* A quién se mira: la persona elegida (sólo un dueño elige) o uno mismo. */
  const candidatos = useMemo(() => e.equipo.filter(conPanel).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [e.equipo]);
  const elegida = esDueno && v.persona ? e.equipo.find((x) => x.id === v.persona) : undefined;
  const miembro = elegida ?? yo.miembro ?? (esDueno ? candidatos[0] : undefined);
  const viendoOtro = Boolean(miembro && yo.miembro?.id !== miembro.id);

  /* El reloj corre cada minuto: «por venir» y las cuotas vencidas no se quedan en el pasado. */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  const rangoTxt = rangoStr(rangoSel);
  const rango = useMemo(() => rangoDelPanel(rangoSel.desde, rangoSel.hasta, rangoTxt), [rangoSel.desde, rangoSel.hasta, rangoTxt]);
  const datos = useMemo(() => (miembro ? miPanelDe(e, miembro, rango, ahora) : null), [e, miembro, rango, ahora]);

  const [verComisiones, setVerComisiones] = useState(false);
  const [tramo, setTramo] = useState<TramoMesa | null>(null);

  if (!miembro || !datos) {
    return (
      <>
        <PageHead titulo="Mi panel" sub="Tus comisiones, tus cuotas por cobrar y tus llamadas, en un solo lugar." />
        <Empty
          icono={<Eye size={22} />}
          titulo="No encontramos tu usuario en Equipo"
          texto={`Entraste con ${yo.email ?? "otro correo"}, pero ese correo no está cargado en una ficha de Equipo. Pedile a un dueño que lo cargue (Equipo → Accesos).`}
        />
      </>
    );
  }

  const esSetter = datos.vista === "setter";
  const esDirector = datos.vista === "director";
  const primerNombre = miembro.nombre.split(" ")[0];
  const sinCargar = datos.dia.sinCargarHoy + datos.dia.sinCargarAntes;
  const puedeCargarVenta = !viendoOtro && !esSetter && nivelDeRuta(acceso, "/cargar-venta") >= 2;

  const resumen = esSetter
    ? `${plural(datos.agendasDeSetter.length, "agenda", "agendas")} en el rango`
    : esDirector
      ? "Tu comisión sale de las ventas de todos los closers."
      : `Hoy: ${plural(datos.llamadasDeHoy.filter((f) => f.resultado !== "Cancelada").length, "llamada", "llamadas")} · ${datos.porVenirHoy} por venir`;

  const totalComision = esDirector ? datos.comisionCloser + datos.comisionDirector : datos.comisionCloser;

  return (
    <div className="mp">
      {esDueno && candidatos.length > 0 && (
        <BarraVerComo candidatos={candidatos} elegido={miembro} yoId={yo.miembro?.id} viendoOtro={viendoOtro} onElegir={(id) => cambiar({ persona: id })} />
      )}

      <header className="mp-cabecera">
        <div className="mp-cabecera__texto">
          <h1 className="mp-saludo">{viendoOtro ? `Panel de ${miembro.nombre}` : `${saludoDe(ahora)}, ${primerNombre}`}</h1>
          <p className="mp-resumen">{resumen}</p>
        </div>
        <div className="mp-acciones">
          {!esSetter && !esDirector && sinCargar > 0 && <span className="mp-pildora">Cierre del día pendiente</span>}
          <DateRangePicker
            value={rangoSel} minDate={null} onApply={(r) => setRango(r)}
            footerNota="Comisiones por fecha de cobro · el resto por fecha de la llamada"
          />
          {puedeCargarVenta && (
            <Link href="/cargar-venta" className="hk-btn hk-btn--primary"><Plus size={16} aria-hidden />Cargar venta</Link>
          )}
        </div>
      </header>

      {esSetter ? (
        <PanelSetter datos={datos} rangoTxt={rangoTxt} ahora={ahora} />
      ) : (
        <>
          <div className="mp-arriba">
            <div className="mp-columna">
              <TarjetaComisiones
                titulo="Comisiones"
                monto={totalComision}
                notas={[
                  { texto: esDirector ? `Como director: ${money(datos.comisionDirector, "USD", 2)}` : `Sobre ${money(datos.cobradoRango, "USD", 0)} cobrados` },
                  ...(datos.descuentoCierre > 0 ? [{ texto: `Sin ${money(datos.descuentoCierre, "USD", 2)} por días sin cierre`, tono: "aviso" as const }] : []),
                ]}
                aparte={datos.strikes.total > 0 ? `${plural(datos.strikes.total, "día", "días")} sin cierre cargado` : undefined}
                onAbrir={() => setVerComisiones(true)}
              />
              {!esDirector && <TarjetaMesa titulo="Sobre la mesa · por cobrar" mesa={datos.mesa} onAbrir={setTramo} />}
            </div>
            {!esDirector && (
              <TarjetaComisionPorCobrar titulo="Comisión por cobrar" c={datos.comisionPorCobrar} onAbrir={setTramo} />
            )}
            {!esDirector && (
              <ParaVos titulo="Pendientes" avisos={datos.avisos} total={datos.totalAvisos} puedeCerrarElDia={!viendoOtro} />
            )}
          </div>

          {!esDirector && <Rendimiento datos={datos} e={e} rangoTxt={rangoTxt} />}

          {!esDirector && (
            <div className="mp-abajo">
              <LlamadasDeHoy
                titulo="Tus llamadas de hoy" llamadas={datos.llamadasDeHoy}
                hoyVacio={viendoOtro ? "No tiene llamadas agendadas para hoy." : "No tenés llamadas agendadas para hoy."}
              />
              <CobrosCargados titulo="Los cobros que cargaste" cobros={datos.cobros} e={e} resumen={datos.controlDeCobros} />
            </div>
          )}
        </>
      )}

      {verComisiones && <DetalleComisiones datos={datos} e={e} comoOtro={viendoOtro} esDueno={esDueno} onCerrar={() => setVerComisiones(false)} />}
      {tramo && <DetalleMesa tramo={tramo} datos={datos} e={e} onCerrar={() => setTramo(null)} />}
    </div>
  );
}
