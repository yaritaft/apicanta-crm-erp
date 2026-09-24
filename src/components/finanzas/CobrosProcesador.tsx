"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Info, Link2, Wallet } from "lucide-react";
import { Ayuda, Badge, Button, Card, Chip, Empty, Field, Input, Select, Switch } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker, rangoDePreset, type RangoFechas } from "@/components/ui/DateRangePicker";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { pagosDelMes } from "@/lib/finanzas";
import { hayNube } from "@/lib/supabase";
import { TIPO_XLSX } from "@/lib/xlsxEscribir";
import {
  COLOR_FALTA_INFO, COLOR_MACRO, DIAS_LINK_COMPROBANTE,
  corteFinanciera, cuentaPorDefecto, cuentasConCorte, diaArgentina, excelCorte, resumenCorte,
} from "@/lib/reporteFinanciera";
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
  const [reporte, setReporte] = useState(false);

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
        <Button variante="secondary" icono={<FileSpreadsheet size={16} />} onClick={() => setReporte(true)}>
          Reporte para la Financiera
        </Button>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable
          alto={520}
          filas={filas} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          vacio={<Empty icono={<Wallet size={22} />} titulo={`Sin cobros en ${mes.etiqueta}`} texto="Cuando entre un cobro, su comisión aparece acá: la real si se concilió, o la de la cuenta para corregir." />}
        />
      </Card>

      {reporte && <ReporteFinanciera e={e} mes={mes} onCerrar={() => setReporte(false)} />}
    </div>
  );
}

/* ==================================================================
   Reporte para la Financiera: el corte de una cuenta en un período,
   en el Excel de finanzas de siempre (lib/reporteFinanciera.ts). Antes
   de bajarlo dice cuántas transferencias van y a cuáles les falta algo,
   para arreglarlas antes de mandarlo.
   ================================================================== */

const PRESETS = ["hoy", "ayer", "hoy_ayer", "u7", "u14", "u28", "u30", "semana", "semana_pasada", "mes", "mes_pasado", "anio_pasado"];

/* El período de la pantalla, como rango del selector: si coincide con un
   preset ("Este mes") se llama así; si no, es uno elegido a mano. */
function rangoDeLaPantalla(mes: RangoMes): RangoFechas {
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const desde = dia(mes.desde);
  const hasta = dia(mes.hasta);
  const preset = PRESETS.find((id) => {
    const r = rangoDePreset(id, null);
    return r?.desde === desde && r?.hasta === hasta;
  });
  return { preset: preset ?? "custom", desde, hasta };
}

/* El selector de fechas no avisa cuando tiene el calendario abierto: sin
   esta marca, Esc cerraría el modal entero en vez del calendario. */
function useMarcaFlotante(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new MutationObserver(() => el.toggleAttribute("data-flotante-abierto", Boolean(el.querySelector(".dp-pop"))));
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [ref]);
}

const enLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] ?? "");
const diaCorto = (dia: string) => dia.split("-").slice(1).reverse().map(Number).join("/");

function ReporteFinanciera({ e, mes, onCerrar }: { e: EstadoApp; mes: RangoMes; onCerrar: () => void }) {
  const toast = useToast();
  const cuentas = useMemo(() => cuentasConCorte(e), [e]);
  const [cuentaId, setCuentaId] = useState(() => cuentaPorDefecto(cuentas)?.id ?? "");
  const [rango, setRango] = useState<RangoFechas>(() => rangoDeLaPantalla(mes));
  const [bajando, setBajando] = useState(false);
  const selector = useRef<HTMLDivElement>(null);
  useMarcaFlotante(selector);

  const corte = useMemo(
    () => (cuentas.some((p) => p.id === cuentaId) ? corteFinanciera(e, cuentaId, rango.desde, rango.hasta) : null),
    [e, cuentas, cuentaId, rango],
  );
  const r = useMemo(() => (corte ? resumenCorte(corte) : null), [corte]);
  /* "Máximo" arranca en la primera transferencia de la cuenta. */
  const primerDia = useMemo(
    () => e.pagos.filter((p) => p.procesadorId === cuentaId).map((p) => diaArgentina(p.fecha)).sort()[0] ?? null,
    [e.pagos, cuentaId],
  );

  async function bajar() {
    if (!corte || corte.filas.length === 0 || bajando) return;
    setBajando(true);
    try {
      const { nombre, datos, sinLink } = await excelCorte(corte);
      const url = URL.createObjectURL(new Blob([datos], { type: TIPO_XLSX }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const n = corte.filas.length;
      toast(sinLink
        ? `Se bajó el corte. ${sinLink === 1 ? "Un comprobante no se pudo firmar: va" : `${sinLink} comprobantes no se pudieron firmar: van`} con el nombre del archivo.`
        : `Se bajó el corte: ${n} ${n === 1 ? "transferencia" : "transferencias"}.`, sinLink ? "info" : "ok");
      onCerrar();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo armar el Excel.", "err");
      setBajando(false);
    }
  }

  const conArchivo = corte?.filas.filter((f) => f.comprobante.ruta).length ?? 0;
  const incompletas = r?.incompletas ?? [];

  return (
    <ModalForm
      abierto onCerrar={onCerrar} onGuardar={bajar}
      titulo="Reporte para la Financiera"
      sub="Las transferencias de una cuenta en un período, en el Excel de finanzas de siempre, para mandar el corte."
      guardarTexto={bajando ? "Armando el Excel…" : "Descargar Excel"}
      puedeGuardar={Boolean(r?.transferencias) && !bajando}
    >
      {cuentas.length === 0 ? (
        <p className="t-body t-muted">
          No hay ninguna cuenta de la Financiera. Sale la que tenga «Financiera» en el nombre o cuentas bancarias
          cargadas, en Ajustes → Ventas → Cuentas recaudadoras.
        </p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Cuenta">
              <Select
                aria-label="Cuenta recaudadora" value={cuentaId} onChange={(ev) => setCuentaId(ev.target.value)}
                opciones={cuentas.map((p) => ({ valor: p.id, texto: p.nombre }))}
              />
            </Field>
            <Field label="Período">
              <div ref={selector}>
                <DateRangePicker value={rango} minDate={primerDia} onApply={setRango} footerNota="Días calendario · zona horaria de Argentina" />
              </div>
            </Field>
          </div>

          {corte && r && (
            <div className="reporte-fin">
              {r.transferencias === 0 ? (
                <p className="t-sm t-muted">No entró ninguna transferencia a {corte.procesador.nombre} en esos días.</p>
              ) : (
                <>
                  <div className="reporte-fin__cifras">
                    <span>
                      <span className="reporte-fin__numero">{r.transferencias}</span>{" "}
                      {r.transferencias === 1 ? "transferencia" : "transferencias"}
                    </span>
                    <span className="t-sm t-muted t-num">
                      {corte.formato === "ARS" && `${money(r.totalArs, "ARS", 2)} · `}{money(r.totalUsd, "USD", 2)}
                    </span>
                  </div>
                  {incompletas.length > 0 && (
                    <div className="reporte-fin__aviso">
                      <span className="reporte-fin__color" style={{ background: `#${COLOR_FALTA_INFO}` }} aria-hidden />
                      <div>
                        {incompletas.length === 1
                          ? <><strong>Una con datos incompletos</strong> va pintada como «Falta información». Conviene completarla antes de mandarlo:</>
                          : <><strong>{incompletas.length} con datos incompletos</strong> van pintadas como «Falta información». Conviene completarlas antes de mandarlo:</>}
                        <ul className="reporte-fin__lista">
                          {incompletas.slice(0, 5).map((f) => (
                            <li key={f.pagoId}>{f.nombre || "Sin nombre"} ({diaCorto(f.dia)}): falta {enLista(f.faltan)}.</li>
                          ))}
                          {incompletas.length > 5 && <li>Y {incompletas.length - 5} más.</li>}
                        </ul>
                      </div>
                    </div>
                  )}
                  {r.macro > 0 && (
                    <div className="reporte-fin__aviso">
                      <span className="reporte-fin__color" style={{ background: `#${COLOR_MACRO}` }} aria-hidden />
                      <div>
                        {r.macro === 1
                          ? <><strong>Una desde Banco Macro</strong>, pintada como en la planilla.</>
                          : <><strong>{r.macro} desde Banco Macro</strong>, pintadas como en la planilla.</>}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {corte && (
            <p className="t-sm t-subtle">
              {corte.formato === "ARS"
                ? "Sale con el formato de «Cortes Financiera»."
                : "Sale con el formato de «Corte Financiera USD», con la columna Closer."}
              {hayNube && conArchivo > 0 && ` Los comprobantes subidos a la app van con un link que dura ${DIAS_LINK_COMPROBANTE} días.`}
              {!corte.procesador.cuentasBancarias?.length && " Esta cuenta no tiene cuentas bancarias cargadas: la tabla de la derecha sale sólo con los títulos (se cargan en Ajustes → Ventas)."}
            </p>
          )}
        </>
      )}
    </ModalForm>
  );
}

function pasa(p: Pago, f: Filtro): boolean {
  if (f === "sin-conciliar") return !p.movimientoId;
  if (f === "sin-chequear") return !p.chequeado;
  if (f === "a-mano") return Boolean(p.feeManual);
  return true;
}
