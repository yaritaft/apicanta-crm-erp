"use client";

import React, { useState } from "react";
import { Button, Field, Input } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { money, num } from "@/lib/format";
import { nombrePeriodo } from "@/lib/periodos";
import { escribirMonto, leerMonto } from "@/lib/monto";

/* ==================================================================
   La meta del mes (de Blue OS: «Tu meta del mes»): la carga cada uno, y el
   anillo muestra cuánto del mes ya cobró y a qué ritmo le falta ir. Va del
   mes de hoy completo, no del rango que se está mirando: una meta mensual
   contra «últimos 30 días» mezclaría dos períodos bajo un mismo nombre.
   ================================================================== */

export interface Meta { cash: number | null; ventas: number | null }

export function AnilloMeta({ titulo, puedeEditar, mes, meta, cobrado, ventas, diasDelMes, diaDelMes, avisoSinAcceso, onGuardar }: {
  titulo: string;
  /* false: se está mirando el panel de otro. Sin controles de escritura (no deshabilitados: no están). */
  puedeEditar: boolean;
  mes: string;
  meta: Meta | null;
  cobrado: number;
  ventas: number;
  diasDelMes: number;
  diaDelMes: number;
  /* Mirando a otro: dice por qué no hay meta. */
  avisoSinAcceso?: string;
  onGuardar: (m: Meta | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [cash, setCash] = useState("");
  const [cantidad, setCantidad] = useState("");
  const metaCash = meta?.cash ?? null;
  const metaVentas = meta?.ventas ?? null;
  const pct = metaCash && metaCash > 0 ? Math.round((cobrado / metaCash) * 100) : null;
  const falta = metaCash != null ? metaCash - cobrado : 0;
  const quedan = diasDelMes - diaDelMes + 1;
  const ritmo = metaCash != null && falta > 0 && quedan > 0 ? { porDia: falta / quedan, quedan } : null;
  const R = 42, C = 2 * Math.PI * R;
  /* Un cobrado negativo (devoluciones) daría un arco negativo, que el navegador interpreta como círculo completo. */
  const dash = pct == null ? 0 : (Math.max(0, Math.min(100, pct)) / 100) * C;

  const abrir = () => { setCash(metaCash != null ? escribirMonto(metaCash) : ""); setCantidad(metaVentas != null ? String(metaVentas) : ""); setEditando(true); };
  const guardar = () => {
    const c = cash.trim() === "" ? null : leerMonto(cash);
    const v = cantidad.trim() === "" ? null : Number(cantidad);
    onGuardar(c == null && v == null ? null : { cash: c != null && Number.isFinite(c) && c >= 0 ? c : null, ventas: v != null && Number.isFinite(v) ? v : null });
    setEditando(false);
  };

  return (
    <div className="mp-card">
      <div className="mp-cap-fila">
        <span className="mp-cap">{titulo} · {nombrePeriodo(mes).split(" ")[0].toLowerCase()}</span>
        {puedeEditar && metaCash != null && !editando && <button type="button" className="link mp-meta__editar" onClick={abrir}>Editar</button>}
      </div>

      {avisoSinAcceso && <p className="mp-vacio" style={{ marginTop: 12 }}>{avisoSinAcceso}</p>}

      {!avisoSinAcceso && metaCash == null && !editando && (
        puedeEditar ? (
          <div style={{ marginTop: 12 }}>
            <p className="mp-vacio">Todavía no cargaste tu meta de este mes. Ponela y el panel te muestra cuánto te falta y a qué ritmo tenés que ir.</p>
            <Button sm variante="secondary" style={{ marginTop: 12 }} onClick={abrir}>Cargar mi meta</Button>
          </div>
        ) : <p className="mp-vacio" style={{ marginTop: 12 }}>Todavía no cargó su meta de este mes.</p>
      )}

      {editando && puedeEditar && (
        <div className="mp-meta__form">
          <Field label="Meta de cash del mes (US$)"><InputMonto value={cash} onChange={(ev) => setCash(ev.target.value)} placeholder="75.000" decimales={0} /></Field>
          <Field label="Meta de ventas del mes (opcional)">
            <Input inputMode="numeric" value={cantidad} onChange={(ev) => setCantidad(ev.target.value.replace(/[^\d]/g, ""))} placeholder="6" />
          </Field>
          <div className="mp-meta__acciones">
            <Button sm onClick={guardar}>Guardar</Button>
            <Button sm variante="secondary" onClick={() => setEditando(false)}>Cancelar</Button>
          </div>
          <span className="mp-nota">Dejar un campo vacío saca esa meta; no es lo mismo que ponerla en 0.</span>
        </div>
      )}

      {metaCash != null && !editando && (
        <div className="mp-meta">
          <svg className="mp-anillo" width={104} height={104} viewBox="0 0 104 104" role="img" aria-label={`${pct ?? 0}% de la meta`}>
            <circle className="mp-anillo__pista" cx="52" cy="52" r={R} fill="none" strokeWidth="9" />
            <circle className="mp-anillo__valor" cx="52" cy="52" r={R} fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} transform="rotate(-90 52 52)" />
            <text className="mp-anillo__pct" x="52" y="50" textAnchor="middle">{pct ?? 0}%</text>
            <text className="mp-anillo__sub" x="52" y="64" textAnchor="middle">de la meta</text>
          </svg>
          <div className="mp-meta__texto">
            <span style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {money(cobrado, "USD", 0)} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--ink-subtle)" }}>de {money(metaCash, "USD", 0)}</span>
            </span>
            {falta > 0 && <span className="mp-nota" style={{ color: "var(--ink-muted)" }}>Te faltan {money(falta, "USD", 0)}</span>}
            {ritmo && <span className="mp-nota">Ritmo para llegar: {money(ritmo.porDia, "USD", 0)} por día ({ritmo.quedan} {ritmo.quedan === 1 ? "día" : "días"})</span>}
            {metaVentas != null && <span className="mp-nota">Ventas: {num(ventas)} de {num(metaVentas)}</span>}
            <span className="mp-nota">Del mes completo, no del rango de arriba.</span>
          </div>
        </div>
      )}
    </div>
  );
}
