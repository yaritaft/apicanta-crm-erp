"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { Ayuda, Badge, Button, Card, CardHead, Field, Input, Switch } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { comisionesDelMes } from "@/lib/finanzas";
import { periodoDe, rangoDePeriodo } from "@/lib/honorarios";
import { hoyDeNegocio, reglaDeCierre } from "@/lib/cierre-del-dia";
import { money, num } from "@/lib/format";
import type { ConfigCierreDelDia } from "@/lib/types";

/* ==================================================================
   Ajustes → CRM → Cierre del día (Yari, 02/10): «poneme en Configuración
   una opción para activar o desactivar que se descuente; la dejamos
   desactivada, probamos la política buena y la activamos».

   - Desde qué día se cuentan los strikes (la fecha de arranque del CRM
     para los closers).
   - El interruptor, apagado de entrada. Antes de prenderlo se ve cuánto
     habría cambiado este mes, y al prenderlo rige desde ese día: lo que
     ya se liquidó no se mueve.
   ================================================================== */

export function CierreDelDiaAjustes() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "ajustes");
  const regla = reglaDeCierre(e.ajustes);
  const hoy = hoyDeNegocio();
  const [prendiendo, setPrendiendo] = useState(false);

  const guardar = (cambios: Partial<ConfigCierreDelDia>, detalle: string) => {
    const crm = e.ajustes.crm ?? {};
    acciones.ajustes({ crm: { ...crm, cierreDelDia: { ...(crm.cierreDelDia ?? {}), ...cambios } } }, detalle);
  };

  /* Cuánto cambia este mes: si está prendido, lo que ya se descuenta; si no,
     lo que se habría descontado de haber estado prendido desde la fecha de arranque. */
  const efecto = useMemo(() => {
    if (!regla.cuentaDesde) return null;
    const crm = e.ajustes.crm ?? {};
    const simulado = regla.descuenta ? e : {
      ...e, ajustes: { ...e.ajustes, crm: { ...crm, cierreDelDia: { ...(crm.cierreDelDia ?? {}), descuenta: true, descuentaDesde: regla.cuentaDesde } } },
    };
    const mes = rangoDePeriodo(periodoDe(new Date()));
    const filas = comisionesDelMes(simulado, mes).filter((c) => (c.descuentoCierre ?? 0) > 0);
    return {
      monto: filas.reduce((a, c) => a + (c.descuentoCierre ?? 0), 0),
      ventas: new Set(filas.map((c) => c.ventaId)).size,
      closers: [...new Set(filas.map((c) => c.closerNombre))],
      mes: mes.etiqueta,
    };
  }, [e, regla]);

  return (
    <>
      <Card>
        <CardHead
          titulo="Cierre del día"
          sub="Cada closer cierra su día cargando cómo terminó cada llamada. Un strike es un día en que alguna llamada no quedó cargada el mismo día."
          acciones={<Badge variante={regla.descuenta ? "warning" : "neutral"} icono={<ClipboardCheck size={13} />}>{regla.descuenta ? "Descuento prendido" : "Descuento apagado"}</Badge>}
        />
        <div className="stack-4">
          <Field
            label="Los strikes se cuentan desde"
            ayuda={regla.cuentaDesde
              ? "Es la fecha de arranque del CRM para los closers: sólo cuentan las llamadas de ese día en adelante, así lo de antes no suma strikes."
              : "Todavía no se cuentan strikes: elegí la fecha de arranque del CRM para los closers. Los strikes se le muestran al closer en «Tu día» aunque el descuento esté apagado."}
          >
            <div className="row-wrap" style={{ gap: 8 }}>
              <div style={{ minWidth: 200 }}>
                <Input
                  type="date" value={regla.cuentaDesde ?? ""} disabled={!puede} aria-label="Los strikes se cuentan desde"
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (v && v !== regla.cuentaDesde) { guardar({ cuentaDesde: v }, `Los strikes del cierre del día se cuentan desde el ${v}.`); toast("Guardado."); }
                  }}
                />
              </div>
              {!regla.cuentaDesde && puede && (
                <Button variante="secondary" onClick={() => { guardar({ cuentaDesde: hoy }, `Los strikes del cierre del día se cuentan desde hoy (${hoy}).`); toast("Los strikes empiezan a contar desde hoy."); }}>Empezar hoy</Button>
              )}
              {regla.cuentaDesde && puede && !regla.descuenta && (
                <button type="button" className="link t-sm" onClick={() => { guardar({ cuentaDesde: undefined }, "Se dejó de contar los strikes del cierre del día."); toast("Los strikes dejaron de contarse."); }}>Dejar de contar</button>
              )}
            </div>
          </Field>

          <div className="stack-2">
            <div className="row-3">
              <Switch
                checked={regla.descuenta} etiqueta="Descontar la comisión de los días sin cierre"
                onChange={(v) => {
                  if (!puede) return;
                  if (v) setPrendiendo(true);
                  else { guardar({ descuenta: false }, "Se apagó el descuento por cierre del día."); toast("Descuento apagado: vuelve todo a como estaba."); }
                }}
              />
              <span className="t-strong">Descontar la comisión de los días sin cierre</span>
            </div>
            <ul className="t-sm t-muted" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li>
                <strong>Apagado</strong> (como empieza): los strikes se cuentan y se le muestran al closer, pero no cambia ningún número: ni Finanzas,
                ni la liquidación, ni el resultado de cada webinar.
              </li>
              <li>
                <strong>Prendido</strong>: no se comisiona lo de un día cuyo cierre no se cargó el mismo día. La comisión del closer de las ventas que
                salieron de las llamadas de ese día no se paga; la del director, el setter y el referidor no se toca.
              </li>
            </ul>
            {regla.descuenta && (
              <div className="row-wrap" style={{ gap: 8 }}>
                <Field label="Rige para las llamadas desde" ayuda="Prender el descuento no cambia lo que ya se liquidó: rige desde el día en que se prendió. Si lo corrés a antes, cambian las comisiones de esos días.">
                  <div style={{ maxWidth: 220 }}>
                    <Input
                      type="date" value={regla.descuentaDesde ?? regla.cuentaDesde ?? ""} disabled={!puede} aria-label="Rige para las llamadas desde"
                      onChange={(ev) => { const v = ev.target.value; if (v) { guardar({ descuentaDesde: v }, `El descuento por cierre del día rige desde las llamadas del ${v}.`); toast("Guardado."); } }}
                    />
                  </div>
                </Field>
              </div>
            )}
          </div>

          {efecto && (
            <p className="t-sm" style={{ color: efecto.monto > 0 ? "var(--warning)" : "var(--ink-muted)" }}>
              {regla.descuenta
                ? efecto.monto > 0
                  ? `Este mes ya se descuentan ${money(efecto.monto, "USD", 2)} de ${num(efecto.ventas)} ${efecto.ventas === 1 ? "venta" : "ventas"} (${efecto.closers.join(", ")}).`
                  : "Este mes todavía no se descuenta nada: todos los días se cerraron el mismo día."
                : efecto.monto > 0
                  ? `Para que te hagas una idea: con el descuento prendido desde el ${textoFecha(regla.cuentaDesde ?? hoy)}, en ${efecto.mes} se habrían dejado de comisionar ${money(efecto.monto, "USD", 2)} de ${num(efecto.ventas)} ${efecto.ventas === 1 ? "venta" : "ventas"} (${efecto.closers.join(", ")}).`
                  : `Para que te hagas una idea: con el descuento prendido desde el ${textoFecha(regla.cuentaDesde ?? hoy)}, este mes no se habría descontado nada.`}
              <InfoMetrica
                titulo="Lo que se descuenta este mes"
                ayuda="La comisión de closer de las ventas que salieron de llamadas de días con strike, en el mes."
                formula="Descuento = comisión del closer de cada cobro del mes cuya venta salió de una llamada de un día con strike"
                componentes={() => [
                  { concepto: "Ventas alcanzadas", valor: num(efecto.ventas), signo: "+" },
                  { concepto: "Comisión que no se paga", valor: money(efecto.monto, "USD", 2), signo: "=" },
                ]}
                periodo={efecto.mes}
              />
            </p>
          )}
          {!puede && <p className="t-sm t-subtle">Sólo lo cambian quienes editan Ajustes.</p>}
        </div>
      </Card>

      <Ayuda titulo="Cómo se arma el descuento" icono={<AlertTriangle size={18} />}>
        La venta se ata a la llamada de la que salió en el momento de cargarla. Las ventas de antes de este cambio no traen ese dato:
        se siguen viendo en el CRM, pero no entran en el descuento. El día se cierra a tiempo si el Estado de Llamada de todas las llamadas
        de venta del closer se cargó ese mismo día (hora de Argentina), sea desde el cierre del día, la tabla del CRM, la Agenda, la ficha o una venta.
        Las llamadas canceladas, las que no vinieron y las que pidieron otra fecha no piden cierre.
      </Ayuda>

      <Confirmar
        abierto={prendiendo} onCerrar={() => setPrendiendo(false)} variante="primary" confirmarTexto="Prender el descuento"
        titulo="¿Prender el descuento?"
        texto={`Desde ahora no se comisiona lo de un día cuyo cierre no se cargó el mismo día. Rige para las llamadas desde hoy (${textoFecha(hoy)}): lo que ya se liquidó no cambia. Finanzas, la liquidación y el resultado de cada webinar lo descuentan igual, y se puede volver a apagar cuando quieras.`}
        onConfirmar={() => {
          guardar(
            { descuenta: true, descuentaDesde: hoy, ...(regla.cuentaDesde ? {} : { cuentaDesde: hoy }) },
            `Se prendió el descuento por cierre del día, para las llamadas desde el ${hoy}.`,
          );
          toast("Descuento prendido desde hoy.");
        }}
      />
    </>
  );
}
