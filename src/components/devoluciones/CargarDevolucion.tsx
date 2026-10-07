"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { InputMonto } from "@/components/ui/InputMonto";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { AvisoMesCerrado } from "@/components/ui/AvisoMesCerrado";
import { CampoComprobante } from "@/components/cobros/CampoComprobante";
import { useToast } from "@/components/ui/Toast";
import { acciones, tablaSinCrear, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeDarDeBaja } from "@/lib/permisos";
import { cerrarDevolucion, usePedidoDevolucion, type PedidoDevolucion } from "@/lib/devolucion-ui";
import {
  cambioParaDevolver, devolvibleDeVenta, mediodiaDeNegocio, pesosDeLaDevolucion, problemaDeDevolucion, procesadorDeLaVenta,
  reversasDeComision, ventasDelPedido,
} from "@/lib/devoluciones";
import { escribirMonto, leerMonto } from "@/lib/gastos";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { fechaLarga, money } from "@/lib/format";
import { nombrePeriodo, periodoDeFecha } from "@/lib/periodos";
import { esCuentaEnPesos } from "@/lib/reporteFinanciera";
import type { Comprobante, Devolucion } from "@/lib/types";

/* ==================================================================
   Cargar una devolución (reunión del 02/10: «que den los números»).

   Se abre desde cualquier pantalla —la ficha de la venta, una llamada que
   quedó en «Devolución» (CRM, cierre del día, Agenda), la lista de Finanzas o
   un reembolso que informó una pasarela— con una sola llamada
   (lib/devolucion-ui). Pide lo que hace falta para que las cuentas den:

     · cuánto, el día y por qué medio salió la plata (si es una cuenta en pesos,
       cuántos pesos fueron: es lo que el arqueo de esa cuenta tiene que descontar);
     · el comprobante, obligatorio (salvo que la pasarela ya lo informe);
     · si no se le descuenta al closer (por defecto sí).

   Y antes de guardar muestra qué pasa: lo que resta en Finanzas y lo que se
   les revierte de la comisión al closer y al director, con la cuenta a la
   vista. La cargan Finanzas o el director comercial; el closer sólo la ve.
   ================================================================== */

export function CargarDevolucion() {
  const pedido = usePedidoDevolucion();
  if (!pedido) return null;
  return <Formulario key={JSON.stringify(pedido)} pedido={pedido} />;
}

/* El día que se elige es un día de Argentina: se guarda a las 12:00 de allá y se
   lee con el día de negocio, no con el reloj del navegador. */
const mediodia = mediodiaDeNegocio;
/* El día de negocio de una fecha; vacío si no se entiende. */
const diaDe = (iso?: string) => { const d = diaDeNegocio(iso); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ""; };
const hoyDia = () => diaDe(new Date().toISOString());

function Formulario({ pedido }: { pedido: PedidoDevolucion }) {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puedeBaja = puedeDarDeBaja(acceso);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 2) => money(n, mon, d);

  const previa: Devolucion | undefined = pedido.devolucionId ? (e.devoluciones ?? []).find((d) => d.id === pedido.devolucionId) : undefined;
  const propuesta: Devolucion | undefined = pedido.propuestaId ? (e.devoluciones ?? []).find((d) => d.id === pedido.propuestaId) : undefined;
  const base = previa ?? propuesta;

  const ventas = useMemo(
    () => ventasDelPedido(e, {
      ventaId: pedido.ventaId ?? base?.ventaId, personaId: pedido.personaId, sesionId: pedido.sesionId,
      /* Una devolución que informó la pasarela sin saber la venta: se busca por quién pagó. */
      email: typeof propuesta?.extra?.clienteEmail === "string" ? propuesta.extra.clienteEmail : undefined,
      nombre: typeof propuesta?.extra?.clienteNombre === "string" ? propuesta.extra.clienteNombre : undefined,
    }),
    [e, pedido, base?.ventaId, propuesta],
  );
  const [ventaId, setVentaId] = useState<string>(() => {
    const conCobro = ventas.find((v) => devolvibleDeVenta(e, v.id, new Date().toISOString()).queda > 0.01);
    return (base?.ventaId ?? conCobro?.id ?? ventas[0]?.id) ?? "";
  });
  const venta = ventas.find((v) => v.id === ventaId);
  const [dia, setDia] = useState(() => diaDe(base?.fecha ?? new Date().toISOString()) || hoyDia());
  const fechaIso = mediodia(dia);
  const devolvible = venta ? devolvibleDeVenta(e, venta.id, fechaIso, previa?.id) : null;

  const [monto, setMonto] = useState(() => (base ? escribirMonto(base.monto) : ""));
  const [medio, setMedio] = useState(() => base?.procesadorId ?? (ventaId ? procesadorDeLaVenta(e, ventaId) ?? "" : ""));
  const [comprobante, setComprobante] = useState<Comprobante | undefined>(base?.comprobante);
  const [subiendo, setSubiendo] = useState(false);
  const [noDescontar, setNoDescontar] = useState(base?.noDescontarAlCloser ?? false);
  const [darDeBaja, setDarDeBaja] = useState(false);
  const [marcarLlamada, setMarcarLlamada] = useState(!previa);
  const [motivo, setMotivo] = useState(base?.motivo ?? "");
  const [notas, setNotas] = useState(base?.notas ?? "");
  /* Los pesos que escribió quien carga; null = todavía no los tocó (se calculan solos). Los que ya tenía la
     devolución se muestran tal cual; sin ellos (en la base vienen como null) se calculan. */
  const [pesosTxt, setPesosTxt] = useState<string | null>(() => (typeof base?.montoArs === "number" ? escribirMonto(base.montoArs) : null));

  /* Al cambiar de venta (o cuando se sabe cuál es) se propone todo lo que queda
     por devolver y la cuenta con la que se pagó. Lo que ya escribió quien carga no se pisa. */
  useEffect(() => {
    if (!venta || base) return;
    setMonto((m) => (m ? m : escribirMonto(devolvibleDeVenta(e, venta.id, fechaIso).queda)));
    setMedio((m) => m || procesadorDeLaVenta(e, venta.id) || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venta?.id]);

  const montoNum = leerMonto(monto) || 0;
  const esTotal = Boolean(devolvible) && montoNum > 0 && Math.abs(montoNum - (devolvible?.queda ?? 0)) < 0.01;

  /* Si la plata sale de una cuenta en pesos hay que saber cuántos pesos fueron. Arrancan en monto ×
     el cambio con el que se cobró esa venta por esa cuenta (o el de Ajustes) y se pueden escribir:
     entonces el cambio es el que resulta. Por una cuenta en dólares no se guarda nada, como siempre. */
  const cuentaElegida = e.procesadores.find((p) => p.id === medio);
  const enPesos = Boolean(cuentaElegida && esCuentaEnPesos(cuentaElegida));
  const propuestoPor = enPesos ? cambioParaDevolver(e, venta?.id, medio) : undefined;
  const cambioPropio = base?.tipoCambio && base.tipoCambio > 0 ? base.tipoCambio : undefined;
  const cambioInicial = cambioPropio ?? propuestoPor?.tipoCambio;
  const escritos = pesosTxt === null ? undefined : leerMonto(pesosTxt);
  const pesos = enPesos ? pesosDeLaDevolucion(montoNum, cambioInicial, escritos) : {};

  const problema = problemaDeDevolucion(
    e, {
      ventaId: venta?.id, monto: montoNum, fecha: fechaIso, procesadorId: medio || undefined, tieneComprobante: Boolean(comprobante),
      tienePasarela: Boolean(base?.referencia), sinPesos: enPesos && !pesos.montoArs,
    },
    previa?.id,
  );
  const falta = subiendo ? "Esperá que termine de subir el comprobante" : problema;

  /* Lo que pasaría al cargarla: las mismas cuentas que usan Finanzas y la liquidación. */
  const efecto = useMemo(() => {
    if (!venta || !(montoNum > 0)) return null;
    const hipotetica: Devolucion = {
      id: "__nueva__", ventaId: venta.id, monto: montoNum, moneda: venta.moneda, fecha: fechaIso, procesadorId: medio || undefined,
      noDescontarAlCloser: noDescontar, estado: "confirmada", creadoEn: fechaIso, extra: {},
    };
    const otras = (e.devoluciones ?? []).filter((d) => d.id !== previa?.id && d.id !== propuesta?.id);
    return reversasDeComision({ ...e, devoluciones: [...otras, hipotetica] }).find((r) => r.devolucion.id === "__nueva__") ?? null;
  }, [e, venta, montoNum, fechaIso, medio, noDescontar, previa?.id, propuesta?.id]);
  const mes = nombrePeriodo(periodoDeFecha(fechaIso) || periodoDeFecha(new Date().toISOString()));
  const mesVenta = venta ? nombrePeriodo(periodoDeFecha(venta.fecha)) : "";
  const cuenta = cuentaElegida?.nombre;
  const revierte = efecto && !efecto.sinDescuento ? efecto.partes.filter((p) => p.reversa > 0) : [];
  const totalRevierte = revierte.reduce((a, p) => a + p.reversa, 0);

  function guardar() {
    if (falta || !venta) return;
    const comun = {
      monto: montoNum, fecha: fechaIso, procesadorId: medio || undefined, comprobante,
      noDescontarAlCloser: noDescontar, motivo: motivo.trim() || undefined, notas: notas.trim() || undefined,
      /* Por una cuenta en pesos, los pesos que salieron y a qué cambio; por una en dólares, nada (al corregir, se borran). */
      montoArs: pesos.montoArs, tipoCambio: pesos.tipoCambio,
    };
    if (previa) {
      if (acciones.editarDevolucion(previa.id, comun)) toast("Devolución corregida.");
    } else {
      const id = acciones.registrarDevolucion({
        ventaId: venta.id, ...comun, sesionId: pedido.sesionId,
        darDeBaja: puedeBaja && darDeBaja, marcarLlamada,
        ...(propuesta ? { confirmaId: propuesta.id, referencia: propuesta.referencia, proveedor: propuesta.proveedor } : {}),
      });
      if (!id) return;
      toast(`Devolución cargada: resta ${M(montoNum)} de ${mes}${noDescontar ? "; el closer cobra igual" : ""}.`);
      /* Sin la tabla en la base (falta supabase/devoluciones.sql) queda sólo en este navegador. */
      window.setTimeout(() => {
        if (tablaSinCrear("devoluciones")) toast("La devolución quedó sólo en este navegador: falta crear la tabla en la base (supabase/devoluciones.sql).", "err");
      }, 3000);
    }
    cerrarDevolucion();
  }

  const ayudaPesos = escritos !== undefined
    ? (pesos.tipoCambio ? `Escribiste los pesos: el tipo de cambio quedó en ${money(pesos.tipoCambio, "ARS", 2)} por dólar.` : "Escribí cuántos pesos salieron de la cuenta.")
    : cambioInicial
      ? `A ${money(cambioInicial, "ARS", 2)} por dólar (${cambioPropio ? "el que tenía cargado" : propuestoPor?.fuente === "cobro" ? "el del último cobro de esta venta por esta cuenta" : "el de Ajustes"}). Si salieron otros pesos, escribilos.`
      : "No hay un tipo de cambio de referencia: escribí cuántos pesos salieron.";

  const titulo = previa ? "Corregir la devolución" : propuesta ? "Confirmar la devolución" : "Cargar una devolución";
  return (
    <ModalForm
      abierto ancho onCerrar={cerrarDevolucion} onGuardar={guardar} puedeGuardar={!falta}
      guardarTexto={previa ? "Guardar cambios" : "Cargar devolución"}
      titulo={titulo}
      sub={propuesta
        ? `La informó ${propuesta.proveedor ?? "la pasarela"}: no resta de Finanzas hasta que la confirmes.`
        : "Resta de Finanzas el día que se devolvió la plata. La venta sigue en su mes."}
    >
      <div className="form-grid">
        <div className="span-2">
          <Field label="Venta que se devuelve" error={ventas.length === 0 ? "No encontramos la venta de esta persona: buscala en Ventas." : undefined}>
            <Select
              value={ventaId} onChange={(ev) => { setVentaId(ev.target.value); setPesosTxt(null); }} disabled={Boolean(previa) || ventas.length <= 1}
              placeholder="Elegí la venta"
              opciones={ventas.map((v) => ({
                valor: v.id,
                texto: `${v.contactoNombre} · ${e.productos.find((p) => p.id === v.productoId)?.nombre ?? "Venta"} · ${fechaLarga(v.fecha)} · ${M(v.precioAcordado, 0)}`,
              }))}
            />
          </Field>
        </div>

        <Field
          label="Cuánto se devolvió"
          ayuda={devolvible ? [
            `Se cobró ${M(devolvible.cobrado)}${devolvible.devuelto ? `, ya se devolvió ${M(devolvible.devuelto)}` : ""}`,
            /* Una devolución ya cargada con fecha posterior también cuenta: entre todas no pueden pasar de lo cobrado. */
            devolvible.limitadaPor ? `, y hasta el ${fechaLarga(mediodia(devolvible.limitadaPor.dia))} hay ${M(devolvible.limitadaPor.devuelto)} devueltos de ${M(devolvible.limitadaPor.cobrado)} cobrados` : "",
            `: se puede devolver hasta ${M(devolvible.queda)}.`,
          ].join("") : undefined}
        >
          <InputMonto value={monto} onChange={(ev) => { setMonto(ev.target.value); setPesosTxt(null); }} placeholder="0" aria-label="Monto devuelto" autoFocus />
        </Field>

        <Field label="El día que se devolvió">
          <Input type="date" value={dia} onChange={(ev) => { if (ev.target.value) setDia(ev.target.value); }} aria-label="Día de la devolución" />
        </Field>

        <div className="span-2">
          <AvisoMesCerrado fecha={fechaIso} que="devolucion" />
        </div>

        <div className="span-2">
          <Field label="Medio por el que salió la plata" ayuda="El mismo con el que pagó: tarjeta con tarjeta, cripto con una transferencia cripto.">
            <Select
              value={medio} onChange={(ev) => { setMedio(ev.target.value); setPesosTxt(null); }} placeholder="Elegí la cuenta"
              opciones={e.procesadores.filter((p) => p.activo || p.id === medio).map((p) => ({ valor: p.id, texto: p.nombre }))}
            />
          </Field>
        </div>

        {enPesos && (
          <div className="span-2">
            <Field label="Pesos que salieron de la cuenta" ayuda={ayudaPesos}>
              <InputMonto
                value={pesosTxt ?? (pesos.montoArs ?? "")} onChange={(ev) => setPesosTxt(ev.target.value)} placeholder="0"
                aria-label="Pesos que salieron" icono={<span className="t-subtle">$</span>}
              />
            </Field>
          </div>
        )}

        <div className="span-2 hk-field">
          <span className="hk-label">Comprobante {base?.referencia ? "(opcional: la pasarela ya la informó)" : ""}</span>
          <CampoComprobante valor={comprobante} onCambio={setComprobante} obligatorio={!base?.referencia} onSubiendo={setSubiendo} />
        </div>

        <div className="span-2 devol-opciones">
          <div className="devol-opcion">
            <div>
              <div className="t-strong">No descontar al closer</div>
              <div className="t-sm t-subtle">Se devuelve por decisión de la empresa (el perfil no encajaba): el closer cobra igual. Por defecto se le descuenta lo que cobró por esta venta.</div>
            </div>
            <Switch checked={noDescontar} onChange={setNoDescontar} etiqueta="No descontar al closer" />
          </div>
          {!previa && (
            <div className="devol-opcion">
              <div>
                <div className="t-strong">Dejar la llamada en «Devolución» en el CRM</div>
                <div className="t-sm t-subtle">La oportunidad pasa a Perdido. Si la llamada ya está en «Devolución», no cambia nada.</div>
              </div>
              <Switch checked={marcarLlamada} onChange={setMarcarLlamada} etiqueta="Dejar la llamada en Devolución" />
            </div>
          )}
          {!previa && puedeBaja && venta?.estado === "activa" && (
            <div className="devol-opcion">
              <div>
                <div className="t-strong">Dar de baja la venta {esTotal ? "" : "(es una devolución parcial)"}</div>
                <div className="t-sm t-subtle">Queda como reembolsada: sus cuotas sin pagos se cancelan y el servicio del alumno pasa a baja.</div>
              </div>
              <Switch checked={darDeBaja} onChange={setDarDeBaja} etiqueta="Dar de baja la venta" />
            </div>
          )}
        </div>

        <Field label="Motivo" span2>
          <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Por qué pidió la plata de vuelta" />
        </Field>
        <Field label="Notas" span2>
          <Textarea rows={2} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Lo que haya que recordar" />
        </Field>

        {efecto && (
          <div className="span-2 devol-efecto" role="note">
            <Info size={16} aria-hidden />
            <div className="stack-2" style={{ minWidth: 0 }}>
              <div className="t-strong">Qué pasa al cargarla</div>
              <ul className="devol-efecto__lista">
                <li>
                  Resta <b className="t-num">{M(montoNum)}</b> en Finanzas de <b>{mes}</b>: Cash Collected, estado de resultados y {cuenta ? `la caja de ${cuenta}` : "la caja"}{pesos.montoArs ? ` (salen ${money(pesos.montoArs, "ARS", 0)} de esa cuenta)` : ""}.
                  La venta sigue contando en {mesVenta}. La comisión de la pasarela no vuelve.
                </li>
                <li>
                  {efecto.sinDescuento
                    ? "No se le descuenta nada al closer ni al director: cobran igual."
                    : revierte.length === 0
                      ? "No hay comisión que revertir en esta venta."
                      : <>Se les revierte la comisión: {revierte.map((p, i) => <span key={`${p.rol}-${p.miembroId ?? i}`}>{i ? " · " : ""}{p.nombre} ({p.rol === "closer" ? "closer" : "director"}) <b className="t-num">−{M(p.reversa)}</b></span>)}.
                        {" "}<InfoMetrica
                          titulo="Lo que se revierte de la comisión"
                          ayuda="A cada uno se le revierte exactamente lo que se le comisionó por lo cobrado de esta venta, en la parte que se devuelve. Aparece como una línea «Devolución de …» en la liquidación del mes de la devolución."
                          formula="Comisionado por lo cobrado de la venta (cobrado − procesador, × su %) × lo devuelto ÷ lo cobrado que quedaba sin devolver"
                          periodo={mes}
                          componentes={() => [
                            { concepto: "Cobrado de la venta hasta ese día", valor: M(efecto.cobradoVenta) },
                            { concepto: "Ya devuelto antes", valor: M(efecto.yaDevuelto), signo: "−" },
                            { concepto: "Lo que se devuelve ahora", valor: M(efecto.devuelto), nota: `${(efecto.parte * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de lo que quedaba` },
                            ...efecto.partes.filter((p) => p.reversa > 0).map((p) => ({
                              concepto: `${p.nombre} · comisionó ${M(p.comision)} (${(p.tasa * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}% de ${M(p.neto)})`,
                              valor: M(p.reversa), signo: "−" as const,
                            })),
                            { concepto: "Total que se revierte", valor: M(totalRevierte), signo: "=" },
                          ]}
                        /></>}
                </li>
              </ul>
            </div>
          </div>
        )}
        {falta && <p className="hk-help hk-help--error span-2">{falta}</p>}
      </div>
    </ModalForm>
  );
}
