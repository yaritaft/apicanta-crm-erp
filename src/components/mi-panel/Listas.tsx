"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fecha, hora, money } from "@/lib/format";
import { sinTildes } from "@/lib/crm";
import { CANCELADA, CON_CIERRE, NO_SE_PRESENTO, POR_VENIR, SIN_CARGAR } from "@/lib/estados";
import { etiquetaDeControl } from "@/lib/control-cobros";
import type { FilaTabla } from "@/lib/crm-tabla";
import type { Aviso, CobroCargado } from "@/lib/mi-panel";
import type { EstadoApp } from "@/lib/types";
import { clic } from "./util";

/* ==================================================================
   Las listas de abajo (de Blue OS: «Tus llamadas de hoy», «Para vos»):
   lo que pasa hoy y lo que pide acción, y de los cobros que cargaste,
   cuáles ya validó finanzas.
   ================================================================== */

type Variante = "neutral" | "success" | "danger" | "warning" | "info";
const variantePorResultado = (r: string): Variante =>
  r === CON_CIERRE ? "success" : r === NO_SE_PRESENTO ? "danger" : r === SIN_CARGAR ? "warning" : r === POR_VENIR ? "info" : "neutral";

/* ---------- Llamadas de hoy ---------- */

export function LlamadasDeHoy({ titulo, llamadas, hoyVacio }: { titulo: string; llamadas: FilaTabla[]; hoyVacio: string }) {
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useState("");
  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    return t ? llamadas.filter((f) => sinTildes(f.nombre).includes(t)) : llamadas;
  }, [llamadas, q]);

  return (
    <section className="mp-card mp-card--sin-relleno" aria-label={titulo}>
      <div className="mp-cabeza">
        <span className="mp-cap">{titulo} · {llamadas.length}</span>
        <div className="mp-cabeza__der">
          <input className="mp-buscar" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar nombre…" aria-label="Buscar una llamada de hoy por nombre" />
          <Link href="/mis-llamadas" className="link t-sm">Ver todas</Link>
        </div>
      </div>
      {visibles.length === 0 ? (
        <p className="mp-vacio" style={{ padding: "0 var(--space-5) var(--space-5)" }}>{llamadas.length === 0 ? hoyVacio : "Ninguna llamada coincide con la búsqueda."}</p>
      ) : (
        <div className="mp-lista">
          <div className="mp-lista__cab"><span>Hora</span><span>Lead</span><span>Vía</span><span>Estado</span></div>
          {visibles.map((f) => {
            const cancelada = f.resultado === CANCELADA;
            return (
              <div key={f.id} className={`mp-lista__fila mp-lista__fila--clic${cancelada ? " mp-lista__fila--tachada" : ""}`} {...clic(() => abrirFicha(f.personaId, "llamadas"))} aria-label={`Abrir la ficha de ${f.nombre}`}>
                <span className="mp-lista__hora">{hora(f.llamada)}</span>
                <span className="mp-lista__nombre">{f.nombre}</span>
                <span className="t-sm t-subtle" style={{ whiteSpace: "nowrap" }}>{f.via}</span>
                <Badge variante={variantePorResultado(f.resultado)}>{f.estadoLlamada || f.aviso || f.resultado}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- Para vos ---------- */

export function ParaVos({ titulo, avisos, total, puedeCerrarElDia }: { titulo: string; avisos: Aviso[]; total: number; puedeCerrarElDia: boolean }) {
  const abrirFicha = useAbrirFicha();
  return (
    <section className="mp-card" aria-label={titulo}>
      <span className="mp-cap">{titulo} · {total}</span>
      {avisos.length === 0 ? (
        <p className="mp-vacio" style={{ marginTop: 10 }}>Todo al día. Nada que atender por ahora.</p>
      ) : (
        <div className="mp-avisos">
          {avisos.map((a) => (
            <div key={a.clave} className={`mp-aviso mp-aviso--${a.tono}`}>
              <span className="mp-aviso__punto" aria-hidden />
              <span className="mp-aviso__texto">{a.resaltado && <><b>{a.resaltado}</b>{" "}</>}{a.texto}</span>
              {a.accion && (a.accion.ir === "ficha" || puedeCerrarElDia) && (
                a.accion.ir === "cerrar-el-dia"
                  ? <Link href="/cerrar-el-dia" className="hk-btn hk-btn--secondary hk-btn--sm">{a.accion.texto}</Link>
                  : <Button sm variante="secondary" onClick={() => abrirFicha(a.accion!.id!, "ventas", { venta: a.accion!.id! })}>{a.accion.texto}</Button>
              )}
            </div>
          ))}
          {total > avisos.length && <div className="mp-avisos__mas">Y {total - avisos.length} más. Se muestran las primeras de cada tipo.</div>}
        </div>
      )}
    </section>
  );
}

/* ---------- Los cobros que cargué ---------- */

export function CobrosCargados({ titulo, cobros, e, resumen }: { titulo: string; cobros: CobroCargado[]; e: EstadoApp; resumen: { total: number; chequeados: number; pendientes: number; rechazados: number } }) {
  const abrirFicha = useAbrirFicha();
  return (
    <section className="mp-card" aria-label={titulo}>
      <div className="mp-cap-fila">
        <span className="mp-cap">{titulo}</span>
        <span className="mp-nota" style={{ marginLeft: "auto", marginTop: 0 }}>
          {resumen.total === 0 ? "Sin cobros en los últimos 45 días" : `${resumen.chequeados} de ${resumen.total} validados${resumen.rechazados ? ` · ${resumen.rechazados} rechazados` : ""}`}
        </span>
      </div>
      {cobros.length === 0 ? (
        <p className="mp-vacio" style={{ marginTop: 10 }}>No hay cobros en los últimos 45 días.</p>
      ) : (
        <div className="mp-tabla-cobros">
          {cobros.slice(0, 15).map((c) => {
            const etiqueta = etiquetaDeControl(c.control, (por) => e.equipo.find((x) => x.email?.toLowerCase() === por?.toLowerCase())?.nombre ?? por ?? "");
            return (
              <div key={c.pago.id} className="mp-tabla-cobros__fila">
                <span className="t-subtle" style={{ fontVariantNumeric: "tabular-nums" }}>{fecha(c.pago.fecha)}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <button type="button" className="link" onClick={() => c.venta && abrirFicha(c.venta.id, "ventas", { venta: c.venta.id })}>{c.venta?.contactoNombre ?? "—"}</button>
                </span>
                <span className="t-sm t-subtle" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.procesadores.find((x) => x.id === c.pago.procesadorId)?.nombre ?? "Sin cuenta"}</span>
                <span className="t-sm" style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}>{c.conciliacion === "conciliado" && <><Link2 size={12} aria-hidden />conciliado</>}</span>
                <span title={etiqueta.detalle}><Badge variante={etiqueta.tono}>{etiqueta.texto}</Badge></span>
                <span className="mp-tabla-cobros__der">{money(c.pago.monto, c.pago.moneda, 2)}</span>
              </div>
            );
          })}
          {cobros.length > 15 && <span className="t-sm t-subtle" style={{ paddingTop: 8 }}>y {cobros.length - 15} más…</span>}
        </div>
      )}
    </section>
  );
}
