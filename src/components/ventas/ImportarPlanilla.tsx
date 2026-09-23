"use client";

import React, { useState } from "react";
import { FileSpreadsheet, Info, TriangleAlert, Upload } from "lucide-react";
import { Ayuda, Badge } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { money, num } from "@/lib/format";
import { leerCSV } from "@/lib/pasarelas";
import { abrirXlsx } from "@/lib/xlsx";
import {
  importarPlanilla, leerFilasVentas, proximasFechasDesde, type ResultadoImport,
} from "@/lib/angelo";

/* ==================================================================
   Importar la hoja Ventas de la planilla de Angelo.

   Se sube el Excel entero (o sólo la hoja Ventas en CSV). Antes de
   guardar se muestra qué va a entrar y qué hubo que decidir; recién al
   confirmar se escribe. Reimportar la misma planilla actualiza lo que ya
   estaba, no lo duplica: sirve mientras se siga cargando en la planilla.
   ================================================================== */

export function ImportarPlanilla({ onCerrar, onListo }: { onCerrar: () => void; onListo: (mensaje: string) => void }) {
  const e = useEstado();
  const toast = useToast();
  const M = (n: number) => money(n, e.ajustes.monedaBase);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [archivo, setArchivo] = useState("");
  const [r, setR] = useState<ResultadoImport | null>(null);

  async function elegir(f: File) {
    setError(""); setR(null); setArchivo(f.name); setLeyendo(true);
    try {
      let tabla: string[][] | null;
      let proximas = new Map<string, string>();
      if (/\.csv$/i.test(f.name)) {
        tabla = leerCSV(await f.text());
      } else {
        const libro = await abrirXlsx(await f.arrayBuffer());
        tabla = await libro.hoja("Ventas");
        if (!tabla) throw new Error(`El Excel no tiene una hoja «Ventas». Tiene: ${libro.nombres.slice(0, 8).join(", ")}…`);
        proximas = proximasFechasDesde(await libro.hoja("Estado_Clientes"));
      }
      const { filas, faltan } = leerFilasVentas(tabla);
      if (faltan.length) throw new Error(`A la hoja le faltan columnas: ${faltan.join(", ")}.`);
      if (filas.length === 0) throw new Error("La hoja no tiene cobros con fecha.");
      setR(importarPlanilla(e, filas, { proximasFechas: proximas }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  function importar() {
    if (!r) return;
    acciones.importarPlanilla(r);
    onListo(`Se importaron ${num(r.resumen.ventas)} ventas y ${num(r.resumen.cobros)} cobros de la planilla.`);
  }

  const creados = r ? [
    ...r.equipo.map((x) => `${x.nombre} (${x.rol === "setter" ? "setter" : "vendedor"})`),
    ...r.productos.map((x) => `${x.nombre} (servicio)`),
    ...r.procesadores.map((x) => `${x.nombre} (cuenta)`),
    ...r.embudos.map((x) => `${x.nombre} (estrategia)`),
    ...r.proyectos.map((x) => `${x} (proyecto)`),
  ] : [];

  return (
    <ModalForm
      abierto onCerrar={onCerrar} onGuardar={importar} ancho
      titulo="Importar la planilla de ventas"
      sub="La hoja Ventas del Centro de control: cada fila es un cobro, y se arman solas las ventas con sus cuotas."
      guardarTexto={r ? `Importar ${num(r.resumen.ventas)} ventas` : "Importar"}
      puedeGuardar={Boolean(r) && !leyendo}
    >
      <label className="importar-caja">
        <input
          type="file" accept=".xlsx,.csv" style={{ display: "none" }}
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void elegir(f); ev.target.value = ""; }}
        />
        <FileSpreadsheet size={22} />
        <span style={{ minWidth: 0 }}>
          <span className="t-strong" style={{ display: "block" }}>{archivo || "Elegí el Excel del Centro de control"}</span>
          <span className="t-sm t-subtle">
            {leyendo ? "Leyendo…" : "El .xlsx entero (de Google Sheets: Archivo → Descargar → Microsoft Excel) o sólo la hoja Ventas en .csv."}
          </span>
        </span>
        <span className="hk-btn hk-btn--secondary hk-btn--sm" style={{ marginLeft: "auto" }}><Upload size={14} />Elegir</span>
      </label>

      {error && <p className="t-sm" style={{ color: "var(--danger)" }}>{error}</p>}

      {r && (
        <div className="stack-3">
          <dl className="dl">
            <dt>Filas con fecha</dt><dd className="t-num">{num(r.resumen.filas)}</dd>
            <dt>Personas</dt><dd className="t-num">{num(r.resumen.personas)} <span className="t-subtle">({num(r.resumen.personasNuevas)} nuevas)</span></dd>
            <dt>Ventas</dt><dd className="t-num">{num(r.resumen.ventas)}</dd>
            <dt>Cobros</dt><dd className="t-num">{num(r.resumen.cobros)} · {M(r.resumen.cobrado)}</dd>
            <dt>Facturado</dt><dd className="t-num">{M(r.resumen.facturado)}</dd>
            <dt>Por cobrar</dt><dd className="t-num">{M(r.resumen.porCobrar)} <span className="t-subtle">en {num(r.resumen.cuotasPendientes)} cuotas</span></dd>
          </dl>

          {creados.length > 0 && (
            <div className="stack-2">
              <span className="t-label">Nombres que la app no tenía: se agregan</span>
              <div className="row-wrap">{creados.map((x) => <Badge key={x} variante="info">{x}</Badge>)}</div>
            </div>
          )}

          {r.avisos.length > 0 && (
            <div className="stack-2">
              <span className="t-label">Lo que hubo que decidir</span>
              {r.avisos.map((a) => (
                <div key={a.tipo} className="row t-sm" style={{ gap: 8, alignItems: "flex-start" }}>
                  <TriangleAlert size={15} style={{ flex: "none", marginTop: 2, color: "var(--warning)" }} />
                  <span>
                    {a.texto}
                    {a.filas.length > 0 && (
                      <span className="t-subtle"> Filas {a.filas.slice(0, 8).join(", ")}{a.filas.length > 8 ? ` y ${a.filas.length - 8} más` : ""}.</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Ayuda titulo="Se puede importar de nuevo" icono={<Info size={18} />}>
            Si esta planilla ya se había importado, lo que estaba se actualiza y lo nuevo se suma: no se duplica
            nada. Mientras se siga cargando en la planilla, la planilla manda; lo que se cargue en la app para esas
            mismas ventas puede pisarse al reimportar.
          </Ayuda>
        </div>
      )}
    </ModalForm>
  );
}
