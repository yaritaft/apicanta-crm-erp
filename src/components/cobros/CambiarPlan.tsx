"use client";

import React, { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { montoDe } from "@/lib/monto";
import {
  cuotasARepartir, FRECUENCIAS, MAX_CUOTAS, problemaDelPlan, repartirParejo, totalARepartir, type CuotaDePlan, type Frecuencia,
} from "@/lib/plan-de-cuotas";
import type { ID } from "@/lib/types";

/* ==================================================================
   «Cambiar el plan de pagos» de una venta (Aldana, 28/10): el cliente que iba
   a pagar en dos cuotas va a pagar en tres. Lo que falta cobrar se vuelve a
   repartir —parejo, o cuota por cuota si hace falta—; lo cobrado no se toca.
   ================================================================== */

export function CambiarPlan({ ventaId }: { ventaId: ID }) {
  const e = useEstado();
  const [abierto, setAbierto] = useState(false);
  if (cuotasARepartir(e, ventaId).length === 0) return null;
  return (
    <>
      <Button sm variante="secondary" icono={<CalendarRange size={14} />} style={{ alignSelf: "flex-start" }} onClick={() => setAbierto(true)}>
        Cambiar el plan de pagos
      </Button>
      {abierto && <ModalPlan ventaId={ventaId} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function ModalPlan({ ventaId, onCerrar }: { ventaId: ID; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const venta = e.ventas.find((v) => v.id === ventaId);
  const viejas = useMemo(() => cuotasARepartir(e, ventaId), [e, ventaId]);
  const total = totalARepartir(viejas);
  const mon = venta?.moneda ?? "USD";
  const hoy = new Date().toISOString().slice(0, 10);
  const primeraDeAntes = viejas[0]?.vence?.slice(0, 10) || hoy;
  /* Las cuotas nuevas siguen la numeración de las que quedan (la cobrada es la 1, las nuevas arrancan en la 2). */
  const ya = Math.max(0, ...e.cuotas.filter((c) => c.ventaId === ventaId && !c.esReserva && !viejas.some((v) => v.id === c.id)).map((c) => c.numero));

  const [cuantas, setCuantas] = useState(String(Math.min(MAX_CUOTAS, viejas.length + 1)));
  const [primera, setPrimera] = useState(primeraDeAntes);
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("mensual");
  const [plan, setPlan] = useState<CuotaDePlan[]>(() => repartirParejo(total, viejas.length + 1, primeraDeAntes, "mensual"));
  const [motivo, setMotivo] = useState("");

  /* Cambiar cuántas, desde cuándo o cada cuánto vuelve a repartir parejo; lo que se tocó a mano se pierde. */
  function armar(n: string, desde: string, cada: Frecuencia) {
    const k = Number(n);
    if (Number.isFinite(k) && k >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(desde)) setPlan(repartirParejo(total, k, desde, cada));
  }
  const cambiarFila = (i: number, cambio: Partial<CuotaDePlan>) => setPlan((p) => p.map((c, k) => (k === i ? { ...c, ...cambio } : c)));

  const suma = Math.round(plan.reduce((t, c) => t + c.monto, 0) * 100) / 100;
  const falta = problemaDelPlan(total, plan) ?? (motivo.trim() ? null : "Falta escribir por qué");
  const hayCambios = plan.length !== viejas.length
    || plan.some((c, i) => c.monto !== viejas[i].monto || c.vence !== (viejas[i].vence ?? "").slice(0, 10));

  function guardar() {
    if (acciones.cambiarPlanDeCuotas(ventaId, plan, motivo)) toast(`Listo: lo que falta cobrar quedó en ${plan.length} ${plan.length === 1 ? "cuota" : "cuotas"}.`);
    else toast("No se pudo cambiar el plan.", "err");
    onCerrar();
  }

  return (
    <Modal
      abierto onCerrar={onCerrar} titulo="Cambiar el plan de pagos"
      sub={`Faltan cobrar ${money(total, mon, 2)} en ${viejas.length} ${viejas.length === 1 ? "cuota sin cobros" : "cuotas sin cobros"}. Lo ya cobrado no se toca y el precio de la venta queda igual.`}
      pie={<><span className="spacer" />
        {(falta || !hayCambios) && <span className="modal__falta">{falta ?? "El plan es el mismo que ya tiene"}</span>}
        <Button variante="secondary" onClick={onCerrar}>Cancelar</Button>
        <Button disabled={falta !== null || !hayCambios} onClick={guardar}>Guardar el plan</Button></>}
    >
      <div className="grid-3" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Field label="En cuántas cuotas">
          <Input
            type="number" min={1} max={MAX_CUOTAS} value={cuantas}
            onChange={(ev) => { setCuantas(ev.target.value); armar(ev.target.value, primera, frecuencia); }}
          />
        </Field>
        <Field label="Vence la primera">
          <Input type="date" value={primera} onChange={(ev) => { setPrimera(ev.target.value); armar(cuantas, ev.target.value, frecuencia); }} />
        </Field>
        <Field label="Cada cuánto">
          <Select
            value={frecuencia} opciones={FRECUENCIAS.map((f) => ({ valor: f.valor, texto: f.texto }))}
            onChange={(ev) => { const f = ev.target.value as Frecuencia; setFrecuencia(f); armar(cuantas, primera, f); }}
          />
        </Field>
      </div>

      <div className="stack-2" style={{ marginTop: 4 }}>
        <span className="t-label">Cómo queda</span>
        {plan.map((c, i) => (
          <div key={i} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="t-strong" style={{ minWidth: 70 }}>Cuota {ya + i + 1}</span>
            <div style={{ width: 150 }}>
              <InputMonto value={c.monto} onChange={(ev) => cambiarFila(i, { monto: montoDe(ev.target.value) })} />
            </div>
            <div style={{ width: 160 }}>
              <Input type="date" value={c.vence} onChange={(ev) => cambiarFila(i, { vence: ev.target.value })} />
            </div>
            {/^\d{4}-\d{2}-\d{2}$/.test(c.vence) && <span className="t-sm t-subtle">{fechaLarga(new Date(`${c.vence}T12:00:00-03:00`).toISOString())}</span>}
          </div>
        ))}
        <div className="row t-sm" style={{ gap: 8 }}>
          <span className="t-subtle">Suman</span>
          <span className="t-num t-strong" style={{ color: Math.abs(suma - total) > 0.005 ? "var(--danger)" : undefined }}>{money(suma, mon, 2)}</span>
          <span className="t-subtle">de {money(total, mon, 2)}</span>
        </div>
      </div>

      <Field label="Por qué" ayuda="Es obligatorio: queda anotado en las cuotas nuevas y en la actividad.">
        <Textarea rows={2} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ej.: el cliente avisó que paga en 3 cuotas y no en 2" />
      </Field>
    </Modal>
  );
}
