"use client";

import React, { useMemo, useState } from "react";
import { Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { tasaTexto } from "@/lib/format";
import { leerMonto } from "@/lib/gastos";
import { useUsuarioActual } from "@/lib/usuario";
import {
  conComisionDeServicio, conComisionGeneral, quienesComisionan, serviciosDelCuadro, tasaEnServicio, type FilaComision,
} from "@/lib/comisiones";
import type { EstadoApp, Producto, RolEquipo } from "@/lib/types";

/* ==================================================================
   «Cómo comisiona cada uno»: una fila por persona que vende, agenda o
   dirige, y una columna por servicio. En cada celda, el % que cobra en
   las ventas de ese servicio: el suyo propio (pintado) o el general.

   En Finanzas se mira; en Equipo y honorarios (dueños) se cambia tocando
   la celda. Cada % es un concepto de lo que cobra la persona
   (lib/comisiones.ts): de ahí salen la liquidación y lo que usa Finanzas.
   ================================================================== */

const ROL: Partial<Record<RolEquipo, string>> = { closer: "Closer", director: "Director comercial", setter: "Setter", ceo: "CEO" };

/* "12,5" o "12.5%" → 0.125. Vacío: null. */
function leerTasa(texto: string): number | null {
  const t = texto.replace("%", "").trim();
  if (!t) return null;
  return Math.round(leerMonto(t) * 1e4) / 1e6;
}
const enCampo = (t: number) => (Math.round(t * 1e6) / 1e4).toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false });

type Celda = { miembroId: string; columna: string };

export function CuadroComisiones({ e, editable = false, onVerPersona }: {
  e: EstadoApp;
  /* Los dueños, en Equipo y honorarios: se cambia tocando la celda. */
  editable?: boolean;
  onVerPersona?: (id: string) => void;
}) {
  const toast = useToast();
  const yo = useUsuarioActual();
  /* Las columnas que se agregaron a mano para cargarles un %. */
  const [extra, setExtra] = useState<string[]>([]);
  const [celda, setCelda] = useState<Celda | null>(null);
  const [texto, setTexto] = useState("");

  const filas = useMemo(() => quienesComisionan(e), [e]);
  const servicios = useMemo(() => serviciosDelCuadro(e, filas, extra), [e, filas, extra]);
  const sinColumna = e.productos.filter((p) => p.activo && !servicios.some((s) => s.id === p.id));

  const abrir = (f: FilaComision, columna: string, actual: number) => {
    setCelda({ miembroId: f.miembro.id, columna });
    setTexto(enCampo(actual));
  };

  function guardar(f: FilaComision, producto: Producto | null) {
    setCelda(null);
    const tasa = leerTasa(texto);
    const antes = producto ? tasaEnServicio(f, producto.id) : f.general;
    /* El general no se vacía; y sin cambio, no se guarda nada. */
    if (!producto && tasa === null) return;
    if (tasa !== null && Math.abs(tasa - antes) < 1e-9) return;
    if (producto && tasa === null && !(producto.id in f.propios)) return;
    const esq = e.honorarios.find((h) => h.miembroId === f.miembro.id);
    try {
      const nuevo = producto ? conComisionDeServicio(esq, f.miembro, producto, tasa) : conComisionGeneral(esq, f.miembro, tasa ?? 0);
      acciones.guardarEsquema(nuevo, yo.nombre);
      const nombre = f.miembro.nombre.split(" ")[0];
      toast(!producto ? `${nombre}: ${tasaTexto(tasa ?? 0)} en general.`
        : tasa === null || Math.abs(tasa - f.general) < 1e-9 ? `${nombre}: ${producto.nombre} vuelve a su % general (${tasaTexto(f.general)}).`
          : `${nombre}: ${tasaTexto(tasa)} en ${producto.nombre}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar ese porcentaje.", "err");
    }
  }

  const campo = (f: FilaComision, producto: Producto | null) => (
    <input
      className="cuadro-com__campo" autoFocus inputMode="decimal" value={texto}
      aria-label={`% de ${f.miembro.nombre} en ${producto?.nombre ?? "general"}`}
      placeholder={producto ? tasaTexto(f.general) : "0"}
      onFocus={(ev) => ev.target.select()}
      onChange={(ev) => setTexto(ev.target.value)}
      onBlur={() => guardar(f, producto)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); guardar(f, producto); }
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setCelda(null); }
      }}
    />
  );

  const celdaDe = (f: FilaComision, producto: Producto | null) => {
    const columna = producto?.id ?? "general";
    const tasa = producto ? tasaEnServicio(f, producto.id) : f.general;
    const propio = Boolean(producto && producto.id in f.propios);
    const seEdita = editable && !f.inactivo;
    const abierta = celda?.miembroId === f.miembro.id && celda.columna === columna;
    const dice = !producto ? "Lo que cobra en todo lo que no tiene un % propio"
      : propio ? `En ${producto.nombre} cobra ${tasaTexto(tasa)} en vez de su ${tasaTexto(f.general)} general`
        : `En ${producto.nombre} cobra su % general`;
    return (
      <td key={columna} className="cuadro-com__celda" data-propio={propio || undefined} data-general={!producto || undefined} title={dice}>
        {abierta ? campo(f, producto) : seEdita ? (
          <button type="button" className="cuadro-com__boton" onClick={() => abrir(f, columna, tasa)} aria-label={`${dice}. Cambiar`}>
            {tasaTexto(tasa)}
          </button>
        ) : <span>{tasaTexto(tasa)}</span>}
      </td>
    );
  };

  if (filas.length === 0) return <p className="t-sm t-muted">Todavía no hay nadie en el equipo que venda, agende o dirija ventas.</p>;

  return (
    <div className="cuadro-com">
      <div className="cuadro-com__tabla">
        <table>
          <thead>
            <tr>
              <th scope="col">Quién</th>
              <th scope="col">Rol</th>
              <th scope="col" className="cuadro-com__num">General</th>
              {servicios.map((p) => <th key={p.id} scope="col" className="cuadro-com__num">{p.nombre}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.miembro.id} data-inactivo={f.inactivo || undefined}>
                <th scope="row">
                  {onVerPersona
                    ? <button type="button" className="cuadro-com__persona" onClick={() => onVerPersona(f.miembro.id)}>{f.miembro.nombre}</button>
                    : <span className="cuadro-com__persona">{f.miembro.nombre}</span>}
                </th>
                <td className="cuadro-com__rol">{ROL[f.miembro.rol] ?? f.miembro.rol}{f.inactivo ? " · ya no está" : ""}</td>
                {f.noComisiona ? (
                  <td colSpan={1 + servicios.length} className="cuadro-com__nota">No comisiona, y sus ventas no le dejan comisión a nadie.</td>
                ) : (
                  <>
                    {celdaDe(f, null)}
                    {servicios.map((p) => celdaDe(f, p))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cuadro-com__pie">
        <p className="cuadro-com__leyenda">
          <span className="cuadro-com__muestra" data-propio /> Tiene su propio % en ese servicio: en esas ventas vale ése en vez del general.
          {editable ? " Tocá una celda para cambiarla; vaciala para que vuelva al general." : null}
        </p>
        {/* Para ponerle un % a un servicio que todavía no vendió nadie. */}
        {editable && sinColumna.length > 0 && (
          <Select
            className="cuadro-com__mas" value="" placeholder="Sumar otro servicio" aria-label="Sumar la columna de otro servicio"
            onChange={(ev) => { if (ev.target.value) setExtra([...extra, ev.target.value]); }}
            opciones={sinColumna.map((p) => ({ valor: p.id, texto: p.nombre }))}
          />
        )}
      </div>
    </div>
  );
}
