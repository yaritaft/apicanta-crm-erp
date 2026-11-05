"use client";

import React, { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Badge, Button, Card, CardHead, Input, Switch } from "@/components/ui/ui";
import { Plegable } from "@/components/finanzas/visual/visual";
import { Fila } from "./Fila";
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

  const textoEfecto = efecto && (regla.descuenta
    ? efecto.monto > 0
      ? `Este mes se descuentan ${money(efecto.monto, "USD", 2)} de ${num(efecto.ventas)} ${efecto.ventas === 1 ? "venta" : "ventas"} (${efecto.closers.join(", ")}).`
      : "Este mes todavía no se descuenta nada: todos los días se cerraron a tiempo."
    : efecto.monto > 0
      ? `Prendido desde el ${textoFecha(regla.cuentaDesde ?? hoy)}, en ${efecto.mes} se habrían dejado de comisionar ${money(efecto.monto, "USD", 2)} de ${num(efecto.ventas)} ${efecto.ventas === 1 ? "venta" : "ventas"} (${efecto.closers.join(", ")}).`
      : `Prendido desde el ${textoFecha(regla.cuentaDesde ?? hoy)}, este mes no se habría descontado nada.`);

  return (
    <>
      <Card style={{ padding: 0 }}>
        <div className="aj-card-cab">
          <CardHead
            titulo="Cierre del día"
            sub="Cada closer carga cómo terminó cada llamada. Un strike es un día con alguna llamada sin cargar ese mismo día."
            acciones={<Badge variante={regla.descuenta ? "warning" : "neutral"} icono={<ClipboardCheck size={13} />}>{regla.descuenta ? "Descuento prendido" : "Descuento apagado"}</Badge>}
          />
        </div>
        <div className="aj-filas aj-filas--borde">
          <Fila
            titulo="Los strikes se cuentan desde"
            sub={regla.cuentaDesde ? "Sólo cuentan las llamadas de ese día en adelante. El closer los ve en «Tu día»." : "Todavía no se cuentan: elegí el día en que arrancó el CRM para los closers."}
          >
            <div style={{ width: 180 }}>
              <Input
                type="date" value={regla.cuentaDesde ?? ""} disabled={!puede} aria-label="Los strikes se cuentan desde"
                onChange={(ev) => {
                  const v = ev.target.value;
                  if (v && v !== regla.cuentaDesde) { guardar({ cuentaDesde: v }, `Los strikes del cierre del día se cuentan desde el ${v}.`); toast("Guardado."); }
                }}
              />
            </div>
            {!regla.cuentaDesde && puede && (
              <Button sm variante="secondary" onClick={() => { guardar({ cuentaDesde: hoy }, `Los strikes del cierre del día se cuentan desde hoy (${hoy}).`); toast("Los strikes empiezan a contar desde hoy."); }}>Empezar hoy</Button>
            )}
            {regla.cuentaDesde && puede && !regla.descuenta && (
              <button type="button" className="link t-sm" onClick={() => { guardar({ cuentaDesde: undefined }, "Se dejó de contar los strikes del cierre del día."); toast("Los strikes dejaron de contarse."); }}>Dejar de contar</button>
            )}
          </Fila>
          <Fila
            titulo="Descontar la comisión de los días sin cierre"
            sub={regla.descuenta
              ? "No se le paga al closer la comisión de las ventas de un día que no cerró a tiempo. La del director, el setter y el referidor no se toca."
              : "Apagado, los strikes se muestran pero no cambian ningún número: ni Finanzas, ni la liquidación, ni los webinars."}
          >
            <Switch
              checked={regla.descuenta} etiqueta="Descontar la comisión de los días sin cierre"
              onChange={(v) => {
                if (!puede) return;
                if (v) setPrendiendo(true);
                else { guardar({ descuenta: false }, "Se apagó el descuento por cierre del día."); toast("Descuento apagado: vuelve todo a como estaba."); }
              }}
            />
          </Fila>
          {regla.descuenta && (
            <Fila titulo="Rige para las llamadas desde" sub="Lo que ya se liquidó no cambia. Si lo corrés a antes, cambian las comisiones de esos días.">
              <div style={{ width: 180 }}>
                <Input
                  type="date" value={regla.descuentaDesde ?? regla.cuentaDesde ?? ""} disabled={!puede} aria-label="Rige para las llamadas desde"
                  onChange={(ev) => { const v = ev.target.value; if (v) { guardar({ descuentaDesde: v }, `El descuento por cierre del día rige desde las llamadas del ${v}.`); toast("Guardado."); } }}
                />
              </div>
            </Fila>
          )}
          {efecto && (
            <div className="aj-nota" data-tono={efecto.monto > 0 ? "atencion" : undefined}>
              <span>{textoEfecto}</span>
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
            </div>
          )}
          {!puede && <p className="aj-nota">Sólo lo cambian quienes editan Ajustes.</p>}
        </div>
      </Card>

      <Plegable titulo="Cómo se arma el descuento">
        La venta se ata a la llamada de la que salió en el momento de cargarla: las de antes de este cambio no traen ese dato y
        no entran en el descuento. El día se cierra a tiempo si el Estado de Llamada de todas las llamadas de venta del closer se
        cargó ese mismo día (hora de Argentina), desde cualquier lado: el cierre del día, el CRM, la Agenda, la ficha o una venta.
        Las canceladas, las que no vinieron y las que pidieron otra fecha no piden cierre.
      </Plegable>

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
