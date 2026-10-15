"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fecha, fechaHora, money, num } from "@/lib/format";
import { CANCELADA, CON_CIERRE, HECHA, NO_SE_PRESENTO, REPROGRAMO, SIN_CIERRE } from "@/lib/estados";
import type { FilaTabla } from "@/lib/crm-tabla";
import type { ComisionVenta } from "@/lib/finanzas";
import type { MiPanel as Datos } from "@/lib/mi-panel";
import type { EstadoApp, Venta } from "@/lib/types";
import { pctTxt } from "./util";

/* ==================================================================
   «Cómo te va» (de Blue OS: «Tu performance»): los números del rango, cada
   uno con lo que lo forma debajo. Sin colores de «bien» o «mal»: Apicanta no
   tiene todavía umbrales definidos por el equipo, y un semáforo inventado
   es peor que ninguno. Con pocos show ups, las tasas avisan que la base es
   chica.
   ================================================================== */

const BASE_MINIMA = 5;

type Cual = "agendas" | "showUps" | "ventas" | "cobrado";

export function Rendimiento({ datos, e, rangoTxt }: { datos: Datos; e: EstadoApp; rangoTxt: string }) {
  const r = datos.rendimiento;
  const [abierto, setAbierto] = useState<{ cual: Cual; titulo: string } | null>(null);
  const baseChica = r.showUps < BASE_MINIMA;
  const subTasa = (texto: string) => (baseChica ? `base chica (menos de ${BASE_MINIMA} show ups)` : texto);

  const tiles: { rot: string; valor: string; sub: string; ok?: boolean; abre?: Cual }[] = [
    { rot: "Agendas", valor: num(r.agendas), sub: `${num(r.pasaron)} ya pasaron`, abre: "agendas" },
    { rot: "Show ups", valor: num(r.showUps), sub: r.noShows > 0 ? `${num(r.noShows)} no se presentaron` : `de ${num(r.pasaron)} que pasaron`, abre: "showUps" },
    { rot: "Ventas", valor: num(r.ventas), sub: "cerradas en el rango", abre: "ventas" },
    { rot: "Ofertas", valor: num(r.ofertas), sub: "del cierre del día" },
    { rot: "% de cierre", valor: pctTxt(r.pctCierre), sub: subTasa("ventas ÷ show ups") },
    { rot: "% de show up", valor: pctTxt(r.pctShowUp), sub: subTasa("show ups ÷ pasadas") },
    { rot: "% de oferta", valor: pctTxt(r.pctOferta), sub: subTasa("ofertas ÷ show ups") },
    { rot: "Ticket promedio", valor: r.ticket == null ? "Sin dato" : money(r.ticket, "USD", 0), sub: "facturado ÷ ventas" },
    { rot: "Facturado", valor: money(r.facturado, "USD", 0), sub: "valor de las ventas", abre: "ventas" },
    { rot: "Cash cobrado", valor: money(r.cobrado, "USD", 0), sub: "lo que entró de tus ventas", ok: true, abre: "cobrado" },
  ];

  return (
    <section className="mp-card" aria-labelledby="mp-rend">
      <div className="mp-titulo">
        <h2 id="mp-rend">Cómo te va</h2>
        <span>{rangoTxt}</span>
      </div>
      {r.agendas === 0 && r.ventas === 0 && r.cobrado === 0 ? (
        <p className="mp-vacio">No hay actividad en este rango. Probá con uno más largo.</p>
      ) : (
        <div className="mp-tiles">
          {tiles.map((t) => {
            const cuerpo = (
              <>
                <span className="mp-tile__rot">{t.rot}</span>
                <span className={`mp-tile__valor${t.ok ? " mp-tile__valor--ok" : ""}`}>{t.valor}</span>
                <span className="mp-tile__sub" title={t.sub}>{t.sub}</span>
              </>
            );
            return t.abre
              ? <button key={t.rot} type="button" className="mp-tile" aria-label={`${t.rot}: ver el detalle`} onClick={() => setAbierto({ cual: t.abre!, titulo: t.rot })}>{cuerpo}</button>
              : <div key={t.rot} className="mp-tile">{cuerpo}</div>;
          })}
        </div>
      )}
      {abierto && <Detalle cual={abierto.cual} titulo={abierto.titulo} datos={datos} e={e} rangoTxt={rangoTxt} onCerrar={() => setAbierto(null)} />}
    </section>
  );
}

/* ---------- lo que forma cada número ---------- */

interface Renglon { clave: string; cuando: string; nombre: string; ficha: string; detalle: React.ReactNode; monto?: string }

const textoDeEstado = (f: FilaTabla) => f.estadoLlamada || f.aviso || f.resultado;

function renglones(cual: Cual, datos: Datos, e: EstadoApp): Renglon[] {
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";
  const deLlamada = (f: FilaTabla): Renglon => ({
    clave: f.id, cuando: fechaHora(f.llamada), nombre: f.nombre, ficha: f.personaId, detalle: <Badge variante={f.resultado === NO_SE_PRESENTO ? "danger" : f.resultado === CON_CIERRE ? "success" : "neutral"}>{textoDeEstado(f)}</Badge>,
  });
  const validas = datos.llamadas.filter((f) => f.resultado !== CANCELADA && f.resultado !== REPROGRAMO);
  const deVenta = (v: Venta): Renglon => ({
    clave: v.id, cuando: fecha(v.fecha), nombre: v.contactoNombre, ficha: v.id, detalle: productoDe(v.productoId), monto: money(v.precioAcordado, v.moneda, 0),
  });
  if (cual === "agendas") return validas.map(deLlamada);
  if (cual === "showUps") return validas.filter((f) => [CON_CIERRE, SIN_CIERRE, HECHA].includes(f.resultado)).map(deLlamada);
  if (cual === "ventas") return datos.ventasDelRango.map(deVenta);
  return datos.comisiones.filter((c: ComisionVenta) => c.closerId === datos.miembro.id).map((c) => {
    const v = e.ventas.find((x) => x.id === c.ventaId);
    return { clave: c.id, cuando: "", nombre: v?.contactoNombre ?? "—", ficha: c.ventaId, detalle: productoDe(c.productoId), monto: money(c.cobradoEnMes, "USD", 2) };
  });
}

function Detalle({ cual, titulo, datos, e, rangoTxt, onCerrar }: { cual: Cual; titulo: string; datos: Datos; e: EstadoApp; rangoTxt: string; onCerrar: () => void }) {
  const abrirFicha = useAbrirFicha();
  const filas = renglones(cual, datos, e);
  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo} sub={`${rangoTxt} · ${filas.length} ${filas.length === 1 ? "renglón" : "renglones"}`} ancho>
      {filas.length === 0 ? <p className="mp-vacio">No hay nada en este rango.</p> : (
        <div className="mp-cobros">
          {filas.map((f) => (
            <div key={f.clave} className="mp-cobros__fila">
              {f.cuando && <span className="mp-cobros__fecha" style={{ minWidth: 112 }}>{f.cuando}</span>}
              <span className="mp-cobros__nombre">
                <button type="button" className="link" onClick={() => { onCerrar(); abrirFicha(f.ficha, "ventas", { venta: f.ficha }); }}>{f.nombre}</button>
              </span>
              <span className="t-sm t-subtle">{f.detalle}</span>
              {f.monto && <span className="mp-cobros__monto">{f.monto}</span>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
