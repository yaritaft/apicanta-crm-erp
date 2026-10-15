"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { money } from "@/lib/format";
import type { ComisionPorCobrar, MesaDeCobro } from "@/lib/mi-panel";
import { clic, pctTxt } from "./util";
import { Cifra } from "./Tile";

/* ==================================================================
   Las dos cards de plata de arriba (de Blue OS: «Comisiones» y «Sobre la
   mesa»): tintadas, con la cifra grande, y cada número abre lo que lo forma.
   ================================================================== */

export function TarjetaComisiones({ titulo, monto, notas, aparte, onAbrir }: {
  titulo: string;
  monto: number;
  /* Lo que acompaña a la cifra: sobre cuánto cobrado, o lo que no se paga por un día sin cierre. */
  notas: { texto: string; tono?: "aviso" | "ok" }[];
  aparte?: string;
  onAbrir: () => void;
}) {
  return (
    <div className="mp-card mp-card--hero mp-card--clic" {...clic(onAbrir)} aria-label={`${titulo}: ver el detalle`}>
      <div className="mp-cap-fila">
        <span className="mp-cap">{titulo}</span>
        <ChevronRight size={16} className="mp-ir" aria-hidden />
      </div>
      <span className="mp-cifra"><Cifra texto={money(monto, "USD", 2)} /></span>
      {notas.map((n) => <span key={n.texto} className={`mp-nota${n.tono ? ` mp-nota--${n.tono}` : ""}`}>{n.texto}</span>)}
      {aparte && <span className="mp-nota">{aparte}</span>}
    </div>
  );
}

export function TarjetaMesa({ titulo, mesa, onAbrir }: {
  titulo: string;
  mesa: MesaDeCobro;
  /* Qué abrir: lo del mes, lo vencido, lo de más de 90 días, lo futuro, o todo. */
  onAbrir: (cual: "mes" | "atrasado" | "riesgo" | "futuro" | "incobrable") => void;
}) {
  const vacio = mesa.mesProyectado === 0 && mesa.atrasado === 0 && mesa.futuro === 0 && mesa.sinFecha === 0;
  return (
    <div className="mp-card">
      <span className="mp-cap">{titulo}</span>
      <div className="mp-mesa">
        <div className="mp-mesa__col mp-mesa__col--clic" {...clic(() => onAbrir("mes"))} aria-label="Lo que vence este mes: ver las cuotas">
          <span className="mp-mesa__rot">Vence este mes</span>
          <span className="mp-cifra mp-cifra--media"><Cifra texto={money(mesa.mesPendiente, "USD", 0)} /></span>
          {mesa.mesProyectado > 0 ? (
            <>
              <div className="mp-barra" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, mesa.mesPct ?? 0))}%` }} /></div>
              <span className="mp-nota">{pctTxt(mesa.mesPct)} cobrado · {money(mesa.mesCobrado, "USD", 0)} de {money(mesa.mesProyectado, "USD", 0)}</span>
            </>
          ) : (
            <span className="mp-nota">Este mes no vence ninguna cuota.</span>
          )}
        </div>
        <div className="mp-mesa__sep" aria-hidden />
        <div className="mp-mesa__col mp-mesa__col--clic" {...clic(() => onAbrir("atrasado"))} aria-label="Lo vencido de antes: ver las cuotas">
          <span className="mp-mesa__rot">Vencido de antes</span>
          <span className={`mp-cifra mp-cifra--media${mesa.atrasado > 0 ? " mp-cifra--roja" : ""}`}><Cifra texto={money(mesa.atrasado, "USD", 0)} /></span>
          {mesa.enRiesgo > 0 ? (
            <span
              className="mp-nota mp-nota--roja" style={{ textDecoration: "underline", cursor: "pointer" }}
              {...clic(() => onAbrir("riesgo"))}
              onClick={(ev) => { ev.stopPropagation(); onAbrir("riesgo"); }}
            >
              {money(mesa.enRiesgo, "USD", 0)} hace más de 90 días
            </span>
          ) : (
            <span className="mp-nota">{mesa.atrasado > 0 ? "Nada supera los 90 días." : "Sin mora arrastrada."}</span>
          )}
        </div>
      </div>
      {(mesa.futuro > 0 || mesa.incobrable > 0 || mesa.sinFecha > 0) && (
        <div className="mp-pie">
          {mesa.futuro > 0 && <span {...clic(() => onAbrir("futuro"))} style={{ cursor: "pointer" }}>Más adelante <strong>{money(mesa.futuro, "USD", 0)}</strong></span>}
          {mesa.sinFecha > 0 && <span>Sin fecha <strong>{money(mesa.sinFecha, "USD", 0)}</strong></span>}
          {mesa.incobrable > 0 && <span {...clic(() => onAbrir("incobrable"))} style={{ cursor: "pointer" }}>Incobrable <strong>{money(mesa.incobrable, "USD", 0)}</strong></span>}
        </div>
      )}
      {vacio && <p className="mp-vacio" style={{ marginTop: 8 }}>No tenés cuotas pendientes.</p>}
    </div>
  );
}

/* ---------- Comisión sobre la mesa ---------- */

const FILAS: { clave: "mes" | "atrasado" | "futuro" | "sinFecha"; rot: string; abre?: "mes" | "atrasado" | "futuro" }[] = [
  { clave: "mes", rot: "Vence este mes", abre: "mes" },
  { clave: "atrasado", rot: "Vencido de antes", abre: "atrasado" },
  { clave: "futuro", rot: "Más adelante", abre: "futuro" },
  { clave: "sinFecha", rot: "Sin fecha" },
];

export function TarjetaComisionPorCobrar({ titulo, c, onAbrir }: {
  titulo: string;
  c: ComisionPorCobrar;
  onAbrir: (cual: "mes" | "atrasado" | "futuro") => void;
}) {
  const filas = FILAS.filter((f) => c.porCobrar[f.clave] > 0);
  return (
    <div className="mp-card mp-card--por-cobrar">
      <span className="mp-cap">{titulo}</span>
      <span className="mp-cifra mp-cifra--verde"><Cifra texto={money(c.total, "USD", 0)} /></span>
      <span className="mp-nota">Lo que ganás si se cobra todo lo que hay sobre la mesa.</span>
      {filas.length === 0 ? (
        <p className="mp-vacio" style={{ marginTop: 20 }}>No tenés cuotas por cobrar: no hay comisión pendiente.</p>
      ) : (
        <div className="mp-desglose">
          {filas.map((f) => {
            const cuerpo = (
              <>
                <span className="mp-desglose__rot">{f.rot}<span className="mp-desglose__sub">{money(c.porCobrar[f.clave], "USD", 0)} por cobrar</span></span>
                <span className={`mp-desglose__monto${f.clave === "atrasado" ? " mp-desglose__monto--roja" : ""}`}>{money(c[f.clave], "USD", 0)}</span>
                {f.abre && <ChevronRight size={16} className="mp-ir" aria-hidden />}
              </>
            );
            return f.abre
              ? <button key={f.clave} type="button" className="mp-desglose__fila" onClick={() => onAbrir(f.abre!)} aria-label={`${f.rot}: ver las cuotas`}>{cuerpo}</button>
              : <div key={f.clave} className="mp-desglose__fila">{cuerpo}</div>;
          })}
        </div>
      )}
      <span className="mp-nota" style={{ marginTop: "auto", paddingTop: 16 }}>
        Estimada con tu % de cada servicio{c.costoProcesador > 0 ? ` y el costo promedio del procesador (${(c.costoProcesador * 100).toFixed(1).replace(".", ",")}%)` : ""}. Lo que se cobre de verdad puede variar.
      </span>
    </div>
  );
}
