"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Button, Chip, Field, Input, Switch, Textarea } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { ResumenAsistente } from "@/components/ui/ResumenAsistente";
import { InputMonto } from "@/components/ui/InputMonto";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { AvisoMesCerrado } from "@/components/ui/AvisoMesCerrado";
import { CampoComprobante } from "@/components/cobros/CampoComprobante";
import { useToast } from "@/components/ui/Toast";
import { acciones, tablaSinCrear, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { alumnoDeVenta } from "@/lib/alumnos";
import { accesosQuitables, avisoDeAccesosQuitados, resumenDeAccesos } from "@/lib/accesos-de-devolucion";
import { contratosPrendidos } from "@/components/contratos/cliente";
import { leerAccesosDeAlumno, quitarTodosLosAccesos } from "./accesos-cliente";
import type { Acceso } from "@/lib/accesos-servidor";
import { nivelEn, puedeDarDeBaja } from "@/lib/permisos";
import { cerrarDevolucion, usePedidoDevolucion, type PedidoDevolucion } from "@/lib/devolucion-ui";
import {
  buscarVentas, cambioParaDevolver, devolvibleDeVenta, mediodiaDeNegocio, pesosDeLaDevolucion, problemasDeDevolucion, procesadorDeLaVenta,
  reversasDeComision, ventasDelPedido,
} from "@/lib/devoluciones";
import { escribirMonto, leerMonto } from "@/lib/gastos";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { cuentaEnLaCajaDeHoy } from "@/lib/caja";
import { fechaLarga, money } from "@/lib/format";
import { nombrePeriodo, periodoDeFecha } from "@/lib/periodos";
import { esCuentaEnPesos } from "@/lib/reporteFinanciera";
import { movimientoDelReembolso, ventaDelReembolso } from "@/lib/reembolsos";
import { nombrePasarela } from "@/lib/pasarelas";
import type { Comprobante, Devolucion, Venta } from "@/lib/types";

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

   Y antes de guardar muestra qué pasa: lo que resta en Finanzas, si toca la caja
   de hoy y lo que se les revierte de la comisión al closer y al director, con la
   cuenta a la vista. La cargan Finanzas o el director comercial; el closer sólo
   la ve.

   Una pregunta por pantalla, como el asistente de gastos (Aldana, 23/10: «es una
   banda de data en una sola pantalla»): la venta (sólo si hay que elegir), cuánto,
   qué día, por dónde salió, el comprobante, qué pasa con el closer, qué más hacer
   con la persona y el motivo. Al final, «Revisá y cargá» con todo junto y un
   «Cambiar» en cada dato. Corregir una devolución o confirmar la que informó una
   pasarela abre directo en la revisión. Qué falta en cada pantalla lo dice
   lib/devoluciones.ts (problemasDeDevolucion).
   ================================================================== */

type PasoId = "venta" | "monto" | "dia" | "medio" | "comprobante" | "closer" | "despues" | "motivo" | "revisar";
const NOMBRE_PASO: Record<PasoId, string> = {
  venta: "Venta", monto: "Cuánto", dia: "Día", medio: "Medio", comprobante: "Comprobante", closer: "Closer", despues: "Después", motivo: "Motivo",
  revisar: "Revisá y cargá",
};

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
  const { acceso, esDueno } = useAcceso();
  const puedeBaja = puedeDarDeBaja(acceso);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 2) => money(n, mon, d);

  const previa: Devolucion | undefined = pedido.devolucionId ? (e.devoluciones ?? []).find((d) => d.id === pedido.devolucionId) : undefined;
  const propuesta: Devolucion | undefined = pedido.propuestaId ? (e.devoluciones ?? []).find((d) => d.id === pedido.propuestaId) : undefined;
  const base = previa ?? propuesta;

  /* El cobro de la pasarela que se devuelve: la devolución de Whop no dice quién es, pero su cobro sí (nombre y mail), y a veces ya está conciliado. */
  const cobroDelReembolso = propuesta ? movimientoDelReembolso(e, propuesta) : undefined;
  const ventaDeLaPasarela = propuesta ? ventaDelReembolso(e, propuesta) : undefined;
  const ventasAuto = useMemo(
    () => ventasDelPedido(e, {
      ventaId: pedido.ventaId ?? base?.ventaId ?? ventaDeLaPasarela?.id, personaId: pedido.personaId, sesionId: pedido.sesionId,
      /* Una devolución que informó la pasarela sin saber la venta: se busca por quién pagó. */
      email: typeof propuesta?.extra?.clienteEmail === "string" ? propuesta.extra.clienteEmail : cobroDelReembolso?.clienteEmail,
      nombre: typeof propuesta?.extra?.clienteNombre === "string" ? propuesta.extra.clienteNombre : cobroDelReembolso?.clienteNombre,
    }),
    [e, pedido, base?.ventaId, propuesta, ventaDeLaPasarela?.id, cobroDelReembolso?.clienteEmail, cobroDelReembolso?.clienteNombre],
  );
  /* Las que se eligieron buscando a mano (la persona pagó con otro mail o con otro nombre que el del sistema). */
  const [manuales, setManuales] = useState<Venta[]>([]);
  const ventas = useMemo(() => [...ventasAuto, ...manuales.filter((m) => !ventasAuto.some((a) => a.id === m.id))], [ventasAuto, manuales]);
  const [busqueda, setBusqueda] = useState<string | null>(null);
  const [vistoVenta, setVistoVenta] = useState(false);
  const [ventaId, setVentaId] = useState<string>(() => {
    const conCobro = ventasAuto.find((v) => devolvibleDeVenta(e, v.id, new Date().toISOString()).queda > 0.01);
    return (base?.ventaId ?? conCobro?.id ?? ventasAuto[0]?.id) ?? "";
  });
  const venta = ventas.find((v) => v.id === ventaId);
  const alumno = venta ? alumnoDeVenta(e, venta) : undefined;
  /* Sacar accesos lo hace quien edita Alumnos (la ruta lo pide); ver los accesos alcanza con verlos: sin poder editar, la opción no aparece. */
  const accesosPrendidos = contratosPrendidos(e.ajustes.contratos, esDueno) && nivelEn(acceso, "alumnos") >= 2;
  const [accesos, setAccesos] = useState<Acceso[] | null>(null);
  useEffect(() => {
    setQuitarAccesos(false);
    if (!alumno || !accesosPrendidos || previa) { setAccesos(null); return; }
    let vivo = true;
    void leerAccesosDeAlumno(alumno.id).then((r) => { if (vivo) setAccesos(r); });
    return () => { vivo = false; };
  }, [alumno?.id, accesosPrendidos, Boolean(previa)]); // eslint-disable-line react-hooks/exhaustive-deps
  const conAccesos = accesosQuitables(accesos ?? []).length > 0;
  const [dia, setDia] = useState(() => diaDe(base?.fecha ?? new Date().toISOString()) || hoyDia());
  const fechaIso = mediodia(dia);
  const devolvible = venta ? devolvibleDeVenta(e, venta.id, fechaIso, previa?.id) : null;

  const [monto, setMonto] = useState(() => (base ? escribirMonto(base.monto) : ""));
  const [medio, setMedio] = useState(() => base?.procesadorId ?? (ventaId ? procesadorDeLaVenta(e, ventaId) ?? "" : ""));
  const [comprobante, setComprobante] = useState<Comprobante | undefined>(base?.comprobante);
  const [subiendo, setSubiendo] = useState(false);
  const [noDescontar, setNoDescontar] = useState(base?.noDescontarAlCloser ?? false);
  const [darDeBaja, setDarDeBaja] = useState(false);
  /* «¿Le quitamos los accesos?»: no va solo (a veces se reembolsa sólo para cambiar el medio de pago). */
  const [quitarAccesos, setQuitarAccesos] = useState(false);
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

  const problemas = problemasDeDevolucion(
    e, {
      ventaId: venta?.id, monto: montoNum, fecha: fechaIso, procesadorId: medio || undefined, tieneComprobante: Boolean(comprobante),
      tienePasarela: Boolean(base?.referencia), sinPesos: enPesos && !pesos.montoArs,
    },
    previa?.id,
  );
  const falta = subiendo ? "Esperá que termine de subir el comprobante" : problemas[0]?.texto ?? null;

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
  const enCaja = useMemo(() => cuentaEnLaCajaDeHoy(e, fechaIso), [e, fechaIso]);
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
      /* Los accesos se sacan aparte: si fallan, la devolución ya quedó cargada y se avisa qué hacer. */
      if (quitarAccesos && alumno && conAccesos) {
        void quitarTodosLosAccesos(alumno.id)
          .then((r) => { const a = avisoDeAccesosQuitados(r); toast(a.texto, a.error ? "err" : "ok"); })
          .catch((err) => toast(`La devolución quedó cargada, pero no pude quitar los accesos: ${err instanceof Error ? err.message : "error"}. Quitalos desde la ficha → Servicio → Accesos.`, "err"));
      }
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

  /* ---------- Los pasos ---------- */
  const ids = useMemo<PasoId[]>(() => [
    /* La venta sólo se pregunta si hay que elegir (o si no se encontró ninguna: ahí se explica). */
    ...(!previa && (ventasAuto.length !== 1 || vistoVenta) ? (["venta"] as PasoId[]) : []),
    "monto", "dia", "medio", "comprobante", "closer",
    ...(!previa ? (["despues"] as PasoId[]) : []),
    "motivo", "revisar",
  ], [previa, ventasAuto.length, vistoVenta]);
  /* Corregir o confirmar una devolución que informó la pasarela ya trae casi todo: se abre en la revisión. */
  const [pasoId, setPasoId] = useState<PasoId>(() => (previa || (propuesta && ventasAuto.length === 1) ? "revisar" : ventasAuto.length !== 1 ? "venta" : "monto"));
  const [vioRevision, setVioRevision] = useState(() => Boolean(previa || (propuesta && ventasAuto.length === 1)));
  const actual = Math.max(0, ids.indexOf(pasoId));
  const irAPaso = (id: PasoId) => { setPasoId(id); if (id === "revisar") setVioRevision(true); if (id === "venta") setVistoVenta(true); };

  const delPaso = (id: PasoId) => problemas.find((p) => p.paso === id)?.texto ?? null;
  const problemaPaso: string | null =
    pasoId === "revisar" ? falta
      : pasoId === "venta" ? (!venta && ventas.length === 0 ? "Buscá la venta abajo, por nombre, mail o teléfono" : delPaso("venta"))
        : pasoId === "comprobante" ? (subiendo ? "Esperá que termine de subir el comprobante" : delPaso("comprobante"))
          : delPaso(pasoId);
  const siguienteEsRevision = ids[actual + 1] === "revisar";
  const volverARevisar = vioRevision && pasoId !== "revisar" && !siguienteEsRevision && problemaPaso === null
    ? <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={() => irAPaso("revisar")}>Listo, volver a revisar</button>
    : null;

  /* Buscar a mano: arranca con el nombre del cobro (si se sabe) y sube las ventas que coinciden en el monto, el mail o el día. */
  const nombreParaBuscar = ventasAuto.length === 0 ? (cobroDelReembolso?.clienteNombre ?? "") : "";
  const resultados = useMemo(
    () => buscarVentas(e, busqueda ?? nombreParaBuscar, {
      monto: propuesta?.monto, email: cobroDelReembolso?.clienteEmail, fecha: cobroDelReembolso?.fecha ?? propuesta?.fecha,
    }, 8).filter((v) => !ventas.some((x) => x.id === v.id)),
    [e, busqueda, nombreParaBuscar, propuesta?.monto, propuesta?.fecha, cobroDelReembolso?.clienteEmail, cobroDelReembolso?.fecha, ventas],
  );
  /* El cobro de la pasarela sigue pendiente en Conciliación: la venta elegida no tiene cobros que devolver hasta que se concilie. Se puede hacer desde acá. */
  const cuotaParaElCobro = (() => {
    if (!venta || !cobroDelReembolso || cobroDelReembolso.estado !== "pendiente" || cobroDelReembolso.pagoId) return undefined;
    if (devolvible && devolvible.cobrado + 0.01 >= cobroDelReembolso.monto) return undefined;
    const pendientes = e.cuotas.filter((c) => c.ventaId === venta.id && c.estado === "pendiente").sort((a, b) => a.numero - b.numero);
    return pendientes.find((c) => Math.abs(c.monto - cobroDelReembolso.monto) < 0.01) ?? pendientes.find((c) => c.monto >= cobroDelReembolso.monto - 0.01) ?? null;
  })();
  const avisoDelCobro = cuotaParaElCobro !== undefined && cobroDelReembolso ? (
    <div className="devol-efecto" role="note">
      <Info size={16} aria-hidden />
      <div className="stack-2" style={{ minWidth: 0 }}>
        <div>
          El cobro de {nombrePasarela(cobroDelReembolso.proveedor)} de <b className="t-num">{M(cobroDelReembolso.monto)}</b> todavía no está conciliado, así que esta venta no tiene
          cobros para devolver.{cuotaParaElCobro ? "" : " Esta venta no tiene una cuota pendiente que lo cubra: conciliá el cobro desde Conciliación y volvé."}
        </div>
        {cuotaParaElCobro && (
          <div>
            <Button sm variante="secondary" onClick={() => {
              if (acciones.conciliar(cobroDelReembolso.id, [{ cuotaId: cuotaParaElCobro.id, monto: Math.min(cobroDelReembolso.monto, cuotaParaElCobro.monto) }])) {
                toast(`Cobro conciliado con la cuota ${cuotaParaElCobro.numero} de ${venta?.contactoNombre ?? "la venta"}.`);
              }
            }}>
              Conciliarlo con la cuota {cuotaParaElCobro.numero} de esta venta ({M(cuotaParaElCobro.monto)})
            </Button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  /* ---------- Lo que se ve en más de una pantalla ---------- */
  const producto = (v: { productoId?: string }) => e.productos.find((x) => x.id === v.productoId)?.nombre ?? "Venta";
  const ayudaMonto = devolvible ? [
    `Se cobró ${M(devolvible.cobrado)}${devolvible.devuelto ? `, ya se devolvió ${M(devolvible.devuelto)}` : ""}`,
    /* Una devolución ya cargada con fecha posterior también cuenta: entre todas no pueden pasar de lo cobrado. */
    devolvible.limitadaPor ? `, y hasta el ${fechaLarga(mediodia(devolvible.limitadaPor.dia))} hay ${M(devolvible.limitadaPor.devuelto)} devueltos de ${M(devolvible.limitadaPor.cobrado)} cobrados` : "",
    `: se puede devolver hasta ${M(devolvible.queda)}.`,
  ].join("") : undefined;

  /* Qué pasa en Finanzas y en la caja de hoy: el día decide si toca la caja (sólo lo posterior al último arqueo). */
  const notaDeFinanzasYCaja = venta && montoNum > 0 ? (
    <>
      <li>
        Resta <b className="t-num">{M(montoNum)}</b> en Finanzas de <b>{mes}</b>: Cash Collected y estado de resultados.
        La venta sigue contando en {mesVenta}. La comisión de la pasarela no vuelve.
      </li>
      <li>
        {enCaja.cuenta
          ? <>
            <b>Baja la caja de hoy</b>: sale de {cuenta ? `la caja de ${cuenta}` : "la caja"}{pesos.montoArs ? ` (salen ${money(pesos.montoArs, "ARS", 0)} de esa cuenta)` : ""}.
            {enCaja.arqueo
              ? ` Cuenta porque ese día es posterior al último arqueo (${fechaLarga(enCaja.arqueo.fecha)}). Si la plata ya había salido antes de ese conteo, poné el día en que salió de verdad.`
              : " Todavía no hay ningún arqueo: cuenta desde el principio."}
          </>
          : <>
            <b>No cambia la caja de hoy</b>: ese día es anterior al último arqueo ({enCaja.arqueo ? fechaLarga(enCaja.arqueo.fecha) : ""}) y el saldo que se contó ahí
            ya venía sin esa plata. Sólo se mueve {mes}.
          </>}
      </li>
    </>
  ) : null;

  const notaDeComision = efecto ? (
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
  ) : null;

  const cajaDeHoy = (
    <div className="devol-efecto" role="note">
      <Info size={16} aria-hidden />
      <div className="stack-2" style={{ minWidth: 0 }}>
        <div className="t-strong">Qué pasa al cargarla</div>
        <ul className="devol-efecto__lista">{notaDeFinanzasYCaja}{notaDeComision}</ul>
      </div>
    </div>
  );

  const opcionesPosteriores: string[] = [];
  if (!previa) {
    if (marcarLlamada) opcionesPosteriores.push("dejar la llamada en «Devolución» en el CRM");
    if (quitarAccesos && alumno && conAccesos) opcionesPosteriores.push("quitarle los accesos");
    if (darDeBaja && puedeBaja && venta?.estado === "activa") opcionesPosteriores.push("dar de baja la venta");
  }
  const hoy = hoyDia();
  const ayer = diaDe(new Date(Date.now() - 86400000).toISOString());
  const sugerida = venta ? procesadorDeLaVenta(e, venta.id) : undefined;
  const procesadoresPosibles = e.procesadores.filter((p) => p.activo || p.id === medio);

  const filas: { etiqueta: string; valor: React.ReactNode; paso?: PasoId; falta?: boolean }[] = [
    {
      etiqueta: "Venta", paso: !previa ? "venta" : undefined, falta: !venta,
      valor: venta ? `${venta.contactoNombre} · ${producto(venta)} · ${fechaLarga(venta.fecha)} · ${M(venta.precioAcordado, 0)}` : "Sin elegir",
    },
    {
      etiqueta: "Cuánto se devolvió", paso: "monto", falta: problemas.some((p) => p.paso === "monto"),
      valor: montoNum > 0 ? <>{M(montoNum)}{devolvible ? (esTotal ? " · todo lo que quedaba" : ` · parcial (quedaban ${M(devolvible.queda)})`) : ""}</> : "Falta",
    },
    { etiqueta: "El día", paso: "dia", falta: problemas.some((p) => p.paso === "dia"), valor: fechaLarga(fechaIso) },
    {
      etiqueta: "Salió por", paso: "medio", falta: problemas.some((p) => p.paso === "medio"),
      valor: cuenta ? `${cuenta}${pesos.montoArs ? ` · ${money(pesos.montoArs, "ARS", 0)}` : ""}` : "Sin elegir",
    },
    {
      etiqueta: "Comprobante", paso: "comprobante", falta: problemas.some((p) => p.paso === "comprobante"),
      valor: comprobante ? "Subido" : base?.referencia ? "Lo informó la pasarela" : "Falta",
    },
    { etiqueta: "Al closer", paso: "closer", valor: noDescontar ? "No se le descuenta: cobra igual" : "Se le descuenta lo que cobró por esta venta" },
    ...(!previa ? [{ etiqueta: "Después", paso: "despues" as PasoId, valor: opcionesPosteriores.length ? `Se va a ${opcionesPosteriores.join(", ")}` : "Nada más" }] : []),
    { etiqueta: "Motivo", paso: "motivo", valor: motivo.trim() || "Sin motivo" },
  ];

  return (
    <Asistente
      etiqueta={titulo}
      pasos={ids.map((id) => ({ id, titulo: NOMBRE_PASO[id] }))} actual={actual} onCambiarPaso={(i) => irAPaso(ids[i])}
      problema={problemaPaso} problemaEsError={pasoId === "revisar"}
      onCerrar={cerrarDevolucion}
      terminarTexto={previa ? "Guardar cambios" : propuesta ? "Confirmar devolución" : "Cargar devolución"}
      onTerminar={guardar}
    >
      {pasoId === "venta" && (
        <>
          <Pregunta
            texto="¿De qué venta es la devolución?"
            sub={ventas.length === 0
              ? "No encontramos la venta de esta persona sola. Buscala abajo: a veces paga con un mail o un nombre y en el sistema está cargada con otro."
              : "Elegí la que se devuelve, o buscá otra a mano."}
          />
          <div className="stack-3">
            {cobroDelReembolso && (
              <p className="t-sm t-subtle" style={{ margin: 0 }}>
                El cobro que se devuelve ({nombrePasarela(cobroDelReembolso.proveedor)}): {cobroDelReembolso.clienteNombre || "sin nombre"}
                {cobroDelReembolso.clienteEmail ? ` · ${cobroDelReembolso.clienteEmail}` : ""} · {M(cobroDelReembolso.monto)} · {fechaLarga(cobroDelReembolso.fecha)}
                {cobroDelReembolso.estado === "pendiente" ? " · todavía sin conciliar" : ""}
              </p>
            )}
            {ventas.length > 0 && (
              <div className="opciones opciones--lista">
                {ventas.map((v, i) => (
                  <Opcion
                    key={v.id} tecla={i < 9 ? String(i + 1) : undefined} activo={v.id === ventaId}
                    nombre={`${v.contactoNombre} · ${producto(v)}`}
                    sub={`${fechaLarga(v.fecha)} · ${M(v.precioAcordado, 0)}${v.estado !== "activa" ? ` · ${v.estado}` : ""}`}
                    onClick={() => { setVentaId(v.id); setPesosTxt(null); }}
                  />
                ))}
              </div>
            )}
            {avisoDelCobro}
            <Field label="Buscar otra venta" ayuda="Por nombre, mail o teléfono. Arriba van las que coinciden en el monto o el día del cobro.">
              <Input
                value={busqueda ?? nombreParaBuscar} onChange={(ev) => setBusqueda(ev.target.value)} aria-label="Buscar la venta a mano"
                placeholder="Nombre, mail o teléfono"
              />
            </Field>
            {resultados.length > 0 && (
              <div className="opciones opciones--lista" role="group" aria-label="Ventas que coinciden">
                {resultados.map((v) => (
                  <Opcion
                    key={v.id} activo={v.id === ventaId} nombre={`${v.contactoNombre} · ${producto(v)}`}
                    sub={`${fechaLarga(v.fecha)} · ${M(v.precioAcordado, 0)}${v.estado !== "activa" ? ` · ${v.estado}` : ""}`}
                    onClick={() => { setManuales((m) => (m.some((x) => x.id === v.id) ? m : [...m, v])); setVentaId(v.id); setPesosTxt(null); }}
                  />
                ))}
              </div>
            )}
            {resultados.length === 0 && (busqueda ?? nombreParaBuscar).trim().length >= 2 && (
              <p className="t-sm t-subtle" style={{ margin: 0 }}>No hay ventas que coincidan: probá con otra parte del nombre o con el mail.</p>
            )}
          </div>
        </>
      )}

      {pasoId === "monto" && (
        <>
          <Pregunta
            texto="¿Cuánto se devolvió?"
            sub={ayudaMonto ?? "Resta de Finanzas el día que se devolvió la plata. La venta sigue en su mes."}
          />
          <div className="stack-3">
            <InputMonto
              value={monto} onChange={(ev) => { setMonto(ev.target.value); setPesosTxt(null); }} placeholder="0" aria-label="Monto devuelto" autoFocus
              icono={<span className="gasto-signo">{mon === "USD" ? "US$" : "$"}</span>} error={Boolean(delPaso("monto"))}
            />
            {devolvible && devolvible.queda > 0.01 && (
              <div className="row-wrap">
                <Chip activo={esTotal} onClick={() => { setMonto(escribirMonto(devolvible.queda)); setPesosTxt(null); }}>Todo lo que queda ({M(devolvible.queda)})</Chip>
              </div>
            )}
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "dia" && (
        <>
          <Pregunta
            texto="¿Qué día salió la plata?"
            sub="El día en que la cuenta la devolvió de verdad: es el que cuenta para Finanzas y para la caja."
          />
          <div className="stack-3">
            <Input type="date" value={dia} onChange={(ev) => { if (ev.target.value) setDia(ev.target.value); }} aria-label="Día de la devolución" />
            <div className="row-wrap">
              <Chip activo={dia === hoy} onClick={() => setDia(hoy)}>Hoy</Chip>
              <Chip activo={dia === ayer} onClick={() => setDia(ayer)}>Ayer</Chip>
            </div>
            <AvisoMesCerrado fecha={fechaIso} que="devolucion" />
            {notaDeFinanzasYCaja && (
              <div className="devol-efecto" role="note">
                <Info size={16} aria-hidden />
                <ul className="devol-efecto__lista">{notaDeFinanzasYCaja}</ul>
              </div>
            )}
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "medio" && (
        <>
          <Pregunta texto="¿Por dónde salió la plata?" sub="El mismo medio con el que pagó: tarjeta con tarjeta, cripto con una transferencia cripto." />
          <div className="stack-3">
            <div className="opciones">
              {procesadoresPosibles.map((p, i) => (
                <Opcion
                  key={p.id} tecla={i < 9 ? String(i + 1) : undefined} nombre={p.nombre} activo={p.id === medio}
                  sub={p.id === sugerida ? "Con esta pagó" : undefined}
                  onClick={() => { setMedio(p.id); setPesosTxt(null); }}
                />
              ))}
            </div>
            {enPesos && (
              <Field label="Pesos que salieron de la cuenta" ayuda={ayudaPesos}>
                <InputMonto
                  value={pesosTxt ?? (pesos.montoArs ?? "")} onChange={(ev) => setPesosTxt(ev.target.value)} placeholder="0"
                  aria-label="Pesos que salieron" icono={<span className="t-subtle">$</span>}
                />
              </Field>
            )}
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "comprobante" && (
        <>
          <Pregunta
            texto="Subí el comprobante"
            sub={base?.referencia ? "Es opcional: la pasarela ya informó esta devolución." : "Es obligatorio: la captura o el PDF de la devolución. Elegilo, arrastralo o pegalo."}
          />
          <CampoComprobante valor={comprobante} onCambio={setComprobante} obligatorio={!base?.referencia} onSubiendo={setSubiendo} />
          {volverARevisar}
        </>
      )}

      {pasoId === "closer" && (
        <>
          <Pregunta texto="¿Le descontamos la comisión al closer?" sub="Por defecto se le descuenta lo que cobró por esta venta." />
          <div className="stack-3">
            <div className="opciones opciones--lista">
              <Opcion tecla="1" nombre="Sí, se le descuenta" sub="Se le revierte exactamente lo que se le comisionó por lo cobrado de esta venta (y al director comercial)." activo={!noDescontar} onClick={() => setNoDescontar(false)} />
              <Opcion tecla="2" nombre="No, el closer cobra igual" sub="Se devuelve por decisión de la empresa (el perfil no encajaba): el closer cobra igual." activo={noDescontar} onClick={() => setNoDescontar(true)} />
            </div>
            {notaDeComision && <ul className="devol-efecto__lista t-sm">{notaDeComision}</ul>}
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "despues" && (
        <>
          <Pregunta texto="¿Qué más hacemos con esta persona?" sub="Es opcional: se hace al cargar la devolución." />
          <div className="devol-opciones">
            <div className="devol-opcion">
              <div>
                <div className="t-strong">Dejar la llamada en «Devolución» en el CRM</div>
                <div className="t-sm t-subtle">La oportunidad pasa a Perdido. Si la llamada ya está en «Devolución», no cambia nada.</div>
              </div>
              <Switch checked={marcarLlamada} onChange={setMarcarLlamada} etiqueta="Dejar la llamada en Devolución" />
            </div>
            {alumno && accesosPrendidos && conAccesos && (
              <div className="devol-opcion">
                <div>
                  <div className="t-strong">¿Le quitamos los accesos?</div>
                  <div className="t-sm t-subtle">
                    Hoy tiene {resumenDeAccesos(accesos ?? [])}. Se le saca todo: los cursos de Wisboo, los grupos de Telegram y las reuniones de Zoom.
                    No va solo: a veces se reembolsa sólo para cambiar el medio de pago y el alumno sigue. Coordinalo con Customer Success.
                  </div>
                </div>
                <Switch checked={quitarAccesos} onChange={setQuitarAccesos} etiqueta="Quitarle los accesos" />
              </div>
            )}
            {puedeBaja && venta?.estado === "activa" && (
              <div className="devol-opcion">
                <div>
                  <div className="t-strong">Dar de baja la venta {esTotal ? "" : "(es una devolución parcial)"}</div>
                  <div className="t-sm t-subtle">Queda como reembolsada: sus cuotas sin pagos se cancelan y el servicio del alumno pasa a baja.</div>
                </div>
                <Switch checked={darDeBaja} onChange={setDarDeBaja} etiqueta="Dar de baja la venta" />
              </div>
            )}
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "motivo" && (
        <>
          <Pregunta texto="¿Por qué pidió la plata de vuelta?" sub="Es opcional, pero ayuda a entender qué pasó." />
          <div className="stack-3">
            <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Por qué pidió la plata de vuelta" aria-label="Motivo" autoFocus />
            <Field label="Notas">
              <Textarea rows={3} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Lo que haya que recordar" />
            </Field>
          </div>
          {volverARevisar}
        </>
      )}

      {pasoId === "revisar" && (
        <>
          <Pregunta
            texto={previa ? "Así está la devolución" : "Así queda la devolución"}
            sub={propuesta
              ? `La informó ${propuesta.proveedor ? propuesta.proveedor[0].toUpperCase() + propuesta.proveedor.slice(1) : "la pasarela"}: no resta de Finanzas hasta que la confirmes.`
              : "Revisá y cargala. Con «Cambiar» volvés a cualquier dato."}
          />
          <div className="stack-3">
            <ResumenAsistente filas={filas.map((f) => ({ etiqueta: f.etiqueta, valor: f.valor, falta: f.falta, onCambiar: f.paso ? () => irAPaso(f.paso as PasoId) : undefined }))} />
            {efecto && cajaDeHoy}
          </div>
        </>
      )}
    </Asistente>
  );
}
