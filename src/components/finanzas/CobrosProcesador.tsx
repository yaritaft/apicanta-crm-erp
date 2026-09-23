"use client";

import React, { useMemo, useState } from "react";
import { Info, Link2, Wallet } from "lucide-react";
import { Ayuda, Badge, Card, Chip, Empty, Input, Switch } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { pagosDelMes } from "@/lib/finanzas";
import type { RangoMes } from "@/lib/metricas";
import type { Cuota, EstadoApp, Pago, Venta } from "@/lib/types";

/* ==================================================================
   La comisión del procesador, cobro por cobro.

   Si el cobro se concilió con la pasarela, la comisión es la real y no
   se toca. Si no (la Financiera, Trust, una transferencia), sale de la
   tasa de la cuenta recaudadora y acá se corrige a mano con lo que se
   pagó de verdad: queda marcada y ya no la pisa la tasa. También se
   tilda "Pasado Financiera / Chequeado en plataforma", como en la
   planilla de Angelo.
   ================================================================== */

type Filtro = "todos" | "sin-conciliar" | "sin-chequear" | "a-mano";

interface Fila {
  id: string;
  pago: Pago;
  cuota?: Cuota;
  venta?: Venta;
}

export function CobrosProcesador({ e, mes }: { e: EstadoApp; mes: RangoMes }) {
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon, 2);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const todas: Fila[] = useMemo(() => {
    const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
    const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
    return pagosDelMes(e, mes).map((pago) => {
      const cuota = cuotaDe.get(pago.cuotaId);
      return { id: pago.id, pago, cuota, venta: cuota ? ventaDe.get(cuota.ventaId) : undefined };
    });
  }, [e, mes]);

  const cuenta = (f: Filtro) => todas.filter((x) => pasa(x.pago, f)).length;
  const filas = todas.filter((x) => pasa(x.pago, filtro));
  const total = filas.reduce((a, x) => a + x.pago.feeMonto, 0);

  const columnas: Columna<Fila>[] = [
    { clave: "fecha", titulo: "Fecha del pago", tipo: "secondary", orden: (x) => x.pago.fecha, celda: (x) => fechaLarga(x.pago.fecha) },
    { clave: "cliente", titulo: "Cliente", tipo: "primary", orden: (x) => x.venta?.contactoNombre ?? "", celda: (x) => x.venta?.contactoNombre ?? "Sin venta" },
    {
      clave: "caracteristica", titulo: "Característica", tipo: "secondary",
      orden: (x) => x.pago.caracteristica ?? "",
      celda: (x) => x.pago.caracteristica ?? (x.cuota?.esReserva ? "Reserva" : x.cuota ? `Cuota #${x.cuota.numero}` : "—"),
    },
    {
      clave: "cuenta", titulo: "Cuenta recaudadora", tipo: "secondary",
      orden: (x) => e.procesadores.find((p) => p.id === x.pago.procesadorId)?.nombre ?? "",
      celda: (x) => e.procesadores.find((p) => p.id === x.pago.procesadorId)?.nombre ?? "Sin cuenta",
    },
    { clave: "monto", titulo: "Monto abonado USD", tipo: "num", orden: (x) => x.pago.monto, celda: (x) => M(x.pago.monto) },
    {
      clave: "fee", titulo: "Comisión del procesador", tipo: "num", orden: (x) => x.pago.feeMonto,
      celda: (x) => x.pago.movimientoId ? (
        <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          <Badge variante="success"><Link2 size={12} />Real</Badge>
          <span className="t-num">{M(x.pago.feeMonto)}</span>
        </span>
      ) : (
        <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          {x.pago.feeManual
            ? <Badge variante="brand">A mano</Badge>
            : <Badge variante="neutral">Tasa de la cuenta</Badge>}
          <span style={{ width: 112 }}>
            <Input
              key={`${x.pago.id}-${x.pago.feeMonto}`}
              type="number" min={0} step="0.01" defaultValue={x.pago.feeMonto}
              aria-label={`Comisión del procesador del cobro de ${x.venta?.contactoNombre ?? "este cliente"}`}
              onClick={(ev) => ev.stopPropagation()}
              onBlur={(ev) => {
                const v = Number(ev.target.value);
                if (!Number.isFinite(v) || v < 0) { toast("Poné un monto válido.", "err"); return; }
                if (v === x.pago.feeMonto && x.pago.feeManual) return;
                if (acciones.editarPago(x.pago.id, { feeMonto: v })) toast("Comisión guardada.");
              }}
            />
          </span>
        </span>
      ),
    },
    {
      clave: "chequeado", titulo: "Chequeado", orden: (x) => (x.pago.chequeado ? 1 : 0),
      celda: (x) => (
        <span onClick={(ev) => ev.stopPropagation()}>
          <Switch
            checked={Boolean(x.pago.chequeado)}
            etiqueta={`Pasado Financiera / Chequeado en plataforma: cobro de ${x.venta?.contactoNombre ?? "este cliente"}`}
            onChange={(v) => { if (acciones.editarPago(x.pago.id, { chequeado: v })) toast(v ? "Marcado como chequeado." : "Ya no está chequeado."); }}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="stack-4">
      <Ayuda titulo="De dónde sale cada comisión" icono={<Info size={18} />}>
        Si el cobro se concilió con la pasarela, la comisión es la <strong>real</strong> y no se toca. Si no,
        sale de la tasa de la cuenta recaudadora (Ajustes → Ventas): en los medios que no se concilian —la
        Financiera, Trust, una transferencia— corregila acá con lo que se pagó de verdad.
      </Ayuda>

      <div className="row-wrap">
        <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={cuenta("todos")}>Todos</Chip>
        <Chip activo={filtro === "sin-conciliar"} onClick={() => setFiltro("sin-conciliar")} count={cuenta("sin-conciliar")}>Sin conciliar</Chip>
        <Chip activo={filtro === "a-mano"} onClick={() => setFiltro("a-mano")} count={cuenta("a-mano")}>Con comisión a mano</Chip>
        <Chip activo={filtro === "sin-chequear"} onClick={() => setFiltro("sin-chequear")} count={cuenta("sin-chequear")}>Sin chequear</Chip>
        <span className="spacer t-sm t-muted">
          Comisiones de lo que se ve: <strong className="t-num" style={{ color: "var(--ink)" }}>{M(total)}</strong>
        </span>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable
          alto={520}
          filas={filas} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          vacio={<Empty icono={<Wallet size={22} />} titulo={`Sin cobros en ${mes.etiqueta}`} texto="Cuando entre un cobro, su comisión aparece acá: la real si se concilió, o la de la cuenta para corregir." />}
        />
      </Card>
    </div>
  );
}

function pasa(p: Pago, f: Filtro): boolean {
  if (f === "sin-conciliar") return !p.movimientoId;
  if (f === "sin-chequear") return !p.chequeado;
  if (f === "a-mano") return Boolean(p.feeManual);
  return true;
}
