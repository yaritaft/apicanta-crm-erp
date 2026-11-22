"use client";

import { cuentasPorUso } from "@/lib/cuentas-por-uso";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, CornerDownLeft, Link2, Paperclip, Search, Sparkles, UserPlus, X,
} from "lucide-react";
import { Avatar, Badge, Button, Chip, Field, IconButton, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { montoDe } from "@/lib/monto";
import {
  agregarMedio, cobroNuevo, datosDeCobro, EditorCobros, problemaDeCobros, problemaDePasarelas, type CobroBorrador,
} from "@/components/cobros/EditorCobros";
import { disponibleDe } from "@/components/cobros/SelectorMovimiento";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, isoDia, money, pct } from "@/lib/format";
import { medioDeMovimiento, normalizar, procesadorDeMovimiento, quienPagoVsCliente } from "@/lib/conciliacion";
import { buscarPersonas, nombreDeCuota, personaPorId, type PersonaBuscada } from "@/lib/buscar-cliente";
import { claveEmail } from "@/lib/contactos";
import { compararTelefonos } from "@/lib/telefonos";
import { palabrasEnComun } from "@/lib/duplicados";
import { nube } from "@/lib/supabase";
import { descartarComprobante } from "@/lib/comprobantes";
import type { Cuota, EstadoApp, Movimiento, Sesion, Venta } from "@/lib/types";
import { closerDeLlamada, paseDeLaVenta } from "@/lib/pasar-llamadas";
import { vende, vendedores } from "@/lib/vendedores";
import { PAISES, planDePago, webinarDeProyecto } from "@/lib/angelo";
import { EMBUDO_LANZAMIENTO_INTERNO, esServicioDelLanzamientoInterno, estrategiaDeLaVenta, FALTA_ESTRATEGIA } from "@/lib/estrategia-de-venta";
import { origenDeUtm, textoUtm } from "@/lib/utms";
import { setterDeAgendas } from "@/lib/setter-agendas";
import { useUsuarioActual } from "@/lib/usuario";
import { esperarGuardado } from "@/lib/store";
import { avisoDeVentaRechazada, rechazoDe } from "@/lib/rechazos";
import { paisCon } from "@/lib/pais-de-telefono";
import { useAcceso } from "@/lib/acceso";
import { useToast } from "@/components/ui/Toast";
import { contratoDeEstaCompra, contratoDeOtraCompra, modalidadDeCuotas, modalidadDeReserva, problemaDeDatos, ROTULO_ESTADO, type Contrato, type DatosContrato } from "@/lib/contratos";
import { plantillaDelContrato, programaDeProducto, programasDe } from "@/lib/programas";
import { contratosPrendidos, leerContratos, pedirContrato } from "@/components/contratos/cliente";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { DatosDelContrato } from "@/components/contratos/DatosDelContrato";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { nacimientoDeLaPersona } from "@/lib/persona";
import { soloSeCobroLaReserva } from "@/lib/accesos-minimo";
import { ventasIdenticas } from "@/lib/ventas-repetidas";
import { AvisoVentaIdentica } from "./AvisoVentaIdentica";
import { reservaSuelta, reservasSueltasDe, reservasSueltasPorContacto, type ReservaSuelta } from "@/lib/reservas";
import { personaDeVenta } from "@/lib/alumnos";
import { AvisoReservaSuelta } from "./AvisoReservaSuelta";

/* ==================================================================
   Asistente de venta.

   Una pregunta por pantalla, como un formulario conversacional: el que
   carga no ve nunca veinte campos juntos, y cada respuesta cambia lo
   que se pregunta después. Enter avanza, Esc sale.

   La última parte es la que importa: una venta se cobra en cuotas, una
   cuota puede cobrarse con varios medios, y cada medio puede venir
   atado a un cobro real de una pasarela. Eso se decide acá, no después.

   De dónde salió la venta no se pregunta: lo dicen las UTMs con las que
   llegó quien compró (Ajustes → UTMs). El resumen lo muestra, y si la
   UTM todavía no tiene regla, se completa después solo.
   ================================================================== */

/* Un cobro: un medio de pago dentro de una cuota (ver EditorCobros). */
type Cobro = CobroBorrador;

interface LineaCuota {
  id: string;
  numero: number;
  esReserva: boolean;
  monto: number;
  vence: string;
  cobros: Cobro[];
  /* Completando una reserva: la cuota que ya estaba cobrada (la reserva). Se muestra y no se toca. */
  fija?: boolean;
}

type PasoId = "cliente" | "producto" | "lanzamiento" | "precio" | "equipo" | "plan" | "cobros" | "contrato" | "resumen";

/* Los nombres de la planilla de Angelo: quien cargaba ahí reconoce cada
   paso por su columna. */
const PASOS: { id: PasoId; titulo: string }[] = [
  { id: "cliente",  titulo: "Cliente" },
  { id: "producto", titulo: "Servicio" },
  { id: "precio",   titulo: "Valor total" },
  { id: "equipo",   titulo: "Vendedor" },
  { id: "plan",     titulo: "Plan de pago" },
  { id: "cobros",   titulo: "Cobros" },
  { id: "resumen",  titulo: "Resumen" },
];

/* El contrato de PandaDoc (pedido del 20/10, como en Blue OS): va antes del resumen y aparece sólo si los
   contratos están prendidos para esta cuenta (Ajustes → Integraciones). */
const PASO_CONTRATO: { id: PasoId; titulo: string } = { id: "contrato", titulo: "Contrato" };

/* Sólo para los servicios que se venden en el lanzamiento interno (Upgrade AI, Principals): una pregunta que no se puede dejar sin contestar,
   así nadie se olvida y Agustín no queda sin comisión por un clic (Aldana, 19/11). Va justo después del servicio. */
const PASO_LANZAMIENTO: { id: PasoId; titulo: string } = { id: "lanzamiento", titulo: "Lanzamiento" };

type DecisionContrato = "mandar" | "ya" | "despues" | "no-lleva";

/* «medida»: las fechas que le dio el closer, una por una (Mariano, 28/10: «no siempre es tan redondo, a veces le damos
   fechas personalizadas»). Se elige o se pone sola al cambiar una fecha del plan; para rehacerlo parejo, mensual. */
type Frecuencia = "mensual" | "quincenal" | "semanal" | "medida";

interface Borrador {
  contactoId?: string;
  /* La persona no estaba cargada: se crea como lead inscripto recién al
     guardar la venta, así cancelar el asistente no deja un lead suelto. */
  crearContacto?: boolean;
  /* El cliente nuevo ya está en la base en una ficha que esta cuenta no ve (el closer ve sólo lo suyo): la venta se suma a
     esa ficha en vez de crear otra. «email»: el mail ya es suyo y es obligatorio; «telefono»: lo eligió quien carga. */
  contactoExistenteId?: string;
  contactoExistentePor?: "email" | "telefono";
  contactoNombre: string;
  contactoEmail: string;
  contactoPais: string;
  contactoTelefono: string;
  productoId: string;
  precioAcordado: number;
  precioTocado: boolean;
  closerId: string;
  directorId: string;
  embudoId: string;
  webinarId: string;
  fecha: string;
  excluidoMarketing: boolean;
  /* Es del lanzamiento interno (lib/estrategia-de-venta.ts): estrategia «Lanzamiento interno», sin mirar la UTM, excluida de marketing, y Agustín la comisiona.
     null: todavía no se contestó (sólo importa con los servicios del lanzamiento: el asistente no deja pasar sin decirlo). */
  lanzamientoInterno: boolean | null;
  notas: string;
  reserva: number;
  /* Sólo deja la reserva (Manu, 21/10): el plan es una sola línea, el valor de la venta es la reserva (como las
     ventas de sólo reserva de siempre) y el contrato sale con la plantilla de reserva. `precioPrograma` guarda el
     valor que tenía para devolvérselo si se arrepiente. */
  soloReserva: boolean;
  precioPrograma: number;
  cantidadCuotas: number;
  frecuencia: Frecuencia;
  primerVencimiento: string;
  cuotas: LineaCuota[];
  planTocado: boolean;
  /* Completando una reserva (lib/reservas.ts): lo que ya estaba cobrado. El plan arranca con esas líneas, fijas, y
     reparte sólo lo que falta. Vacío en una venta nueva. */
  fijas: LineaCuota[];
  /* Lo demás de la planilla */
  proyecto: string;
  setterId: string;
  referidorNombre: string;
  referidorTelefono: string;
  /* "¿Es referido?": recién con el sí se piden nombre y teléfono. */
  esReferido: boolean;
  /* El contrato: qué se decidió, de qué programa y con qué datos (se arman al llegar al paso). */
  contrato: { decision: DecisionContrato; programaId: string; datos: DatosContrato | null; prueba: boolean };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function sumar(xs: { monto: number }[]) {
  return redondear(xs.reduce((a, x) => a + x.monto, 0));
}

function sumarFecha(iso: string, frecuencia: Frecuencia, pasos: number): string {
  const d = new Date(iso);
  if (frecuencia === "quincenal" || frecuencia === "semanal") d.setDate(d.getDate() + pasos * (frecuencia === "quincenal" ? 15 : 7));
  else d.setMonth(d.getMonth() + pasos);
  return d.toISOString();
}

/** Reparte el precio en cuotas parejas; el resto cae en la última. */
function armarPlan(b: Borrador): LineaCuota[] {
  const lineas: LineaCuota[] = [];
  if (b.fijas.length > 0) {
    /* Lo cobrado queda como está; lo que falta se reparte en cuotas que siguen la numeración. */
    lineas.push(...b.fijas);
    const falta = redondear(b.precioAcordado - sumar(b.fijas));
    if (falta <= 0) return lineas;
    const cuantas = Math.max(1, b.cantidadCuotas);
    const parte = Math.round((falta / cuantas) * 100) / 100;
    const desde = Math.max(0, ...b.fijas.map((c) => c.numero));
    for (let k = 1; k <= cuantas; k++) {
      lineas.push({
        id: nuevoId("cuo"), numero: desde + k, esReserva: false,
        monto: k === cuantas ? redondear(falta - parte * (cuantas - 1)) : parte,
        vence: sumarFecha(b.primerVencimiento, b.frecuencia, k - 1),
        cobros: [],
      });
    }
    return lineas;
  }
  if (b.soloReserva) {
    return b.reserva > 0 ? [{ id: nuevoId("cuo"), numero: 0, esReserva: true, monto: redondear(b.reserva), vence: b.fecha, cobros: [] }] : [];
  }
  if (b.reserva > 0) {
    lineas.push({
      id: nuevoId("cuo"), numero: 0, esReserva: true,
      monto: redondear(b.reserva), vence: b.fecha, cobros: [],
    });
  }
  const resto = redondear(b.precioAcordado - b.reserva);
  const n = Math.max(1, b.cantidadCuotas);
  const base = Math.round((resto / n) * 100) / 100;
  for (let k = 1; k <= n; k++) {
    lineas.push({
      id: nuevoId("cuo"), numero: k, esReserva: false,
      monto: k === n ? redondear(resto - base * (n - 1)) : base,
      vence: sumarFecha(b.primerVencimiento, b.frecuencia, k - 1),
      cobros: [],
    });
  }
  return lineas;
}

export function AsistenteVenta({ onCerrar, onListo, desdeMovimiento, cliente, closerId, sesionId, onPagoDeCuota, completar }: {
  /* La venta que es sólo una reserva y se viene a completar (desde su ficha): no se crea otra venta, crece ésa
     (lib/reservas.ts). También se llega acá adentro, desde el aviso «¿Está completando su reserva?». */
  completar?: string;
  onCerrar: () => void;
  onListo: (ventaId: string, nombre: string) => void;
  /* Si quien compró ya debe una cuota, lo que se viene a cargar puede ser
     ese pago y no una venta nueva: esto lo lleva a cargar el pago. */
  onPagoDeCuota?: (cuotaId: string) => void;
  desdeMovimiento?: Movimiento;
  /* Abierto desde la ficha de alguien (upsell, renovación): el cliente ya
     está elegido y se arranca por el producto. */
  cliente?: { contactoId: string; nombre: string; email: string };
  /* Abierto desde el CRM: el closer de la llamada ya viene elegido, y la
     venta queda atada a esa llamada (su Estado de Llamada y su etapa). */
  closerId?: string;
  sesionId?: string;
}) {
  const e = useEstado();
  const mon = e.ajustes.monedaBase;
  const M = useCallback((n: number, d = 0) => money(n, mon, d), [mon]);

  /* Completar una reserva: mismos pasos, sin elegir cliente ni vendedor (ya los tiene la venta). */
  const [completarId, setCompletarId] = useState<string | undefined>(() => (completar && sePuedeCompletar(e, completar) ? completar : undefined));
  const completando = Boolean(completarId);
  const [i, setI] = useState(completarId ? 1 : cliente ? 1 : 0);
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const { esDueno } = useAcceso();
  const configContratos = e.ajustes.contratos;
  const conContrato = contratosPrendidos(configContratos, esDueno);
  /* Quien carga la venta, si es del equipo: queda elegido como closer. */
  const yo = useUsuarioActual();
  const preelegido = useRef(false);
  const [b, setB] = useState<Borrador>(() => {
    const reserva = completarId ? e.ventas.find((v) => v.id === completarId) : undefined;
    return reserva ? inicialParaCompletar(e, reserva) : { ...inicial(e, desdeMovimiento, cliente), ...(closerId ? { closerId } : {}) };
  });
  const set = useCallback((cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios })), []);
  /* El contrato de prueba: con los contratos en «prueba», siempre; encendidos o sólo dueños, si un dueño lo pide. */
  const modoContrato: "produccion" | "prueba" = configContratos?.estado === "prueba" || (esDueno && b.contrato.prueba) ? "prueba" : "produccion";
  const mainRef = useRef<HTMLDivElement>(null);

  /* Con un servicio del lanzamiento interno (Upgrade AI, Principals) hay un paso más, justo después del servicio. */
  const preguntaLanzamiento = !completando && esServicioDelLanzamientoInterno(b.productoId);
  const pasos = useMemo(() => {
    let base = completando ? PASOS.filter((x) => x.id !== "cliente" && x.id !== "equipo") : PASOS;
    if (preguntaLanzamiento) {
      const k = base.findIndex((x) => x.id === "producto");
      base = [...base.slice(0, k + 1), PASO_LANZAMIENTO, ...base.slice(k + 1)];
    }
    return conContrato ? [...base.slice(0, -1), PASO_CONTRATO, base[base.length - 1]] : base;
  }, [conContrato, completando, preguntaLanzamiento]);

  const paso = pasos[i];

  useEffect(() => {
    const m = yo.miembro;
    if (completando || preelegido.current || !m || !m.activo || !vende(m)) return;
    preelegido.current = true;
    setB((x) => (x.closerId ? x : { ...x, closerId: m.id }));
  }, [yo.miembro, completando]);

  /* El setter que marcó la agenda de esta persona como suya (Daniel, 24/10): viene elegido. Si el closer
     lo cambia, queda lo que eligió; si lo deja en «Sin setter», la venta igual lo toma (lo hace la base). */
  const setterMarcado = useMemo(
    () => setterDeAgendas(e.sesiones, { sesionId, contactoId: b.contactoId || undefined, fecha: b.fecha }),
    [e.sesiones, sesionId, b.contactoId, b.fecha],
  );
  const setterSugerido = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (completando || !setterMarcado || setterSugerido.current === setterMarcado) return;
    setterSugerido.current = setterMarcado;
    setB((x) => (x.setterId ? x : { ...x, setterId: setterMarcado }));
  }, [setterMarcado, completando]);

  /* El plan se rearma solo mientras nadie lo toque a mano. */
  useEffect(() => {
    setB((x) => {
      if (x.planTocado) return x;
      const nuevas = armarPlan(x);
      /* Los cobros ya cargados se conservan por posición. */
      const conCobros = nuevas.map((linea, k) => ({ ...linea, cobros: x.cuotas[k]?.cobros ?? [] }));
      return { ...x, cuotas: conCobros };
    });
  }, [b.precioAcordado, b.reserva, b.soloReserva, b.cantidadCuotas, b.frecuencia, b.primerVencimiento, b.fecha, b.planTocado, b.fijas]);

  const closer = e.equipo.find((x) => x.id === b.closerId);
  const sinComision = Boolean(closer?.sinComision);
  const totalPlan = sumar(b.cuotas);
  const diferenciaPlan = redondear(b.precioAcordado - totalPlan);
  const cobrosTodos = b.cuotas.flatMap((c) => c.cobros);
  const totalCobrado = sumar(cobrosTodos);

  /* Comprobantes subiéndose: mientras haya alguno, no se avanza ni se guarda. */
  const [subiendo, setSubiendo] = useState<Set<string>>(() => new Set());
  const onSubiendo = useCallback((cobroId: string, si: boolean) => {
    setSubiendo((ya) => {
      if (ya.has(cobroId) === si) return ya;
      const otro = new Set(ya);
      if (si) otro.add(cobroId); else otro.delete(cobroId);
      return otro;
    });
  }, []);

  /* ¿Ya existe una venta idéntica (misma persona, servicio y precio, en esos días)? Avisa; en el resumen pide confirmar que es otra
     compra (Aldana, 24/10: una venta se cargó dos veces y sumaba US$ 6.000 en vez de 3.000). */
  const identicas = useMemo(() => {
    if (!b.productoId || !(b.precioAcordado > 0) || !(b.contactoId || b.contactoExistenteId || b.contactoNombre.trim().length >= 2)) return [];
    return ventasIdenticas(e, {
      quien: { contactoId: b.contactoId || b.contactoExistenteId, nombre: b.contactoNombre, email: b.contactoEmail, telefono: b.contactoTelefono },
      productoId: b.productoId, precioAcordado: b.precioAcordado, fecha: b.fecha,
    }, { ignorar: completarId });
  }, [e, b.productoId, b.precioAcordado, b.contactoId, b.contactoExistenteId, b.contactoNombre, b.contactoEmail, b.contactoTelefono, b.fecha, completarId]);
  const [otraCompra, setOtraCompra] = useState(false);
  const repetida = identicas.length > 0 && !otraCompra;

  /* ¿Quien compra ya dejó una reserva que es sólo eso? Entonces lo que se viene a cargar casi seguro es el resto, y no va en
     una venta nueva (Aldana, 18/11): se avisa apenas se elige a la persona y, en el resumen, no deja registrar otra venta
     sin decir que es otra compra. Sólo cuenta la persona ya elegida (o su mail o teléfono): un nombre a medio escribir no. */
  const reservas = useMemo(() => {
    const contactoId = b.contactoId || b.contactoExistenteId;
    /* Mientras se busca (todavía sin elegir a nadie ni cargarlo como nuevo) no se propone nada. */
    if (completando || (!contactoId && !b.crearContacto)) return [];
    const mail = b.contactoEmail.includes("@") ? b.contactoEmail : undefined;
    const telefono = b.contactoTelefono.replace(/\D/g, "").length >= 8 ? b.contactoTelefono : undefined;
    /* El nombre entero también cuenta (la misma persona cargada en dos fichas); una sola palabra no. */
    const nombre = b.contactoNombre.trim().split(/\s+/).length >= 2 ? b.contactoNombre : undefined;
    return reservasSueltasDe(e, { contactoId, email: mail, telefono, nombre });
  }, [e, completando, b.contactoId, b.contactoExistenteId, b.crearContacto, b.contactoNombre, b.contactoEmail, b.contactoTelefono]);
  const [reservaAparte, setReservaAparte] = useState(false);
  const conReservaSuelta = reservas.length > 0 && !reservaAparte;
  /* Pasa el asistente a completar esa reserva: mismo asistente, otra pregunta. */
  const completarEsta = useCallback((ventaId: string) => {
    const reserva = e.ventas.find((v) => v.id === ventaId);
    if (!reserva) return;
    setCompletarId(ventaId);
    setB(inicialParaCompletar(e, reserva));
    setI(1);
    mainRef.current?.scrollTo({ top: 0 });
  }, [e]);
  const pagadoDeReserva = sumar(b.fijas);

  const problema = useMemo(
    () => validar(paso.id, b, diferenciaPlan, { e, subiendo: subiendo.size, modoContrato, repetida, completando, conReservaSuelta }),
    [paso.id, b, diferenciaPlan, e, subiendo.size, modoContrato, repetida, completando, conReservaSuelta],
  );
  const puedeAvanzar = problema === null;

  const avanzar = useCallback(() => {
    if (!puedeAvanzar) return;
    setI((x) => Math.min(x + 1, pasos.length - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, [puedeAvanzar, pasos.length]);

  const volver = useCallback(() => {
    setI((x) => Math.max(0, x - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  /* Una sola venta por asistente: el 21/10 se registró la de Diana Olivera tres veces en el mismo milisegundo (doble o triple
     clic en «Registrar la venta», o Enter apretado de más). Con la marca, el segundo toque no hace nada. */
  const registrando = useRef(false);
  const [registrada, setRegistrada] = useState(false);

  /* Completar la reserva: no nace otra venta. La misma pasa a valer el programa entero, con las cuotas de lo que falta y lo
     que ya entró; y sale el contrato del programa (el de la reserva no da accesos). */
  function guardarCompletada(ventaId: string) {
    const nuevas = b.cuotas.filter((c) => !c.fija);
    const r = acciones.completarReserva({
      ventaId, productoId: b.productoId || undefined, precioAcordado: redondear(b.precioAcordado), notas: b.notas,
      cuotas: nuevas.map((c) => ({ id: c.id, monto: redondear(c.monto), vence: c.vence })),
      cobros: nuevas.flatMap((c) => c.cobros.filter((p) => p.monto > 0).map((p) => ({ ...datosDeCobro(p), cuotaId: c.id, monto: redondear(p.monto) }))),
    });
    if (!r.ok) {
      registrando.current = false;
      setRegistrada(false);
      toast(r.error, "err");
      return;
    }
    const nombre = b.contactoNombre.trim();
    const contactoId = b.contactoId;
    const abrir = { texto: "Abrir su ficha", onClick: () => { if (contactoId) abrirFicha(contactoId, "ventas"); } };
    onCerrar();
    toast(`Reserva de ${nombre} completada: quedó una sola venta de ${M(b.precioAcordado)}, con la reserva adentro.`, undefined, abrir);
    const ct = b.contrato;
    if (!conContrato || ct.decision !== "mandar" || !ct.datos) return;
    const datos = ct.datos;
    void (async () => {
      const llego = await esperarGuardado();
      try {
        await pedirContrato({ accion: "crear", ventaId, sesionId, leadId: contactoId, programa: ct.programaId, datos, prueba: modoContrato === "prueba" });
        toast(`Contrato del programa mandado a ${datos.email} para firmar.`);
      } catch (err) {
        const queVenta = llego ? "La reserva quedó completada" : "No pude confirmar que se haya guardado (revisá tu conexión y mirá su ficha)";
        toast(`${queVenta}, pero el contrato NO salió y la persona no recibió nada: ${err instanceof Error ? err.message : "no se pudo"}`, "err", abrir);
      }
    })();
  }

  function guardar() {
    if (registrando.current) return;
    registrando.current = true;
    setRegistrada(true);
    if (completarId) { guardarCompletada(completarId); return; }
    const ventaId = nuevoId("ven");
    let contactoId = b.contactoId;
    if (!contactoId && b.crearContacto && b.contactoNombre.trim()) {
      const ahora = new Date().toISOString();
      contactoId = acciones.altaDeLead({
        nombre: b.contactoNombre.trim(), email: b.contactoEmail.trim(),
        telefono: b.contactoTelefono.trim(), pais: b.contactoPais,
        fuente: b.webinarId ? "Webinar" : "", webinarId: b.webinarId || undefined,
        /* Compró: entra directo en la etapa ganada. */
        etapaId: e.etapas.find((x) => x.esGanada)?.id ?? e.etapas[0]?.id ?? "",
        monto: redondear(b.precioAcordado), moneda: mon,
        responsable: e.equipo.find((x) => x.id === b.closerId)?.nombre ?? "",
        etiquetas: [], creadoEn: ahora, actualizadoEn: ahora, extra: {},
      }, b.contactoNombre.trim(), b.contactoExistenteId);
    }
    /* El origen sale de la UTM de quien compró; si no tiene una con regla,
       lo que traía el lead (su webinar). El proyecto WEB-día/mes/año ya
       dice de qué webinar vino. */
    /* Una venta del lanzamiento interno no tiene origen de anuncios: no se mira la UTM con la que la persona llegó hace meses ni su webinar. */
    const lanzamiento = b.lanzamientoInterno === true;
    const o = lanzamiento ? undefined : origenDeUtm(e, contactoId, b.fecha);
    const embudoId = estrategiaDeLaVenta(e, contactoId, b.fecha, b.embudoId, lanzamiento);
    const proyecto = lanzamiento ? undefined : (o?.proyecto ?? (b.proyecto || undefined));
    const webinarId = lanzamiento ? undefined : (o?.webinarId ?? (b.webinarId || webinarDeProyecto(proyecto, e.webinars, b.fecha)?.id));
    const venta: Venta = {
      id: ventaId,
      contactoId,
      contactoNombre: b.contactoNombre.trim(),
      productoId: b.productoId || undefined,
      webinarId: webinarId || undefined,
      embudoId,
      precioAcordado: redondear(b.precioAcordado),
      moneda: mon,
      closerId: b.closerId || undefined,
      directorId: sinComision ? undefined : (b.directorId || undefined),
      excluidoMarketing: b.excluidoMarketing || sinComision || lanzamiento,
      estado: "activa",
      fecha: b.fecha,
      notas: b.notas,
      creadoEn: new Date().toISOString(),
      extra: {},
      proyecto,
      /* Si el closer no los eligió, los que dice el link (setter_{nombre},
         el referidor en utm_content). */
      setterId: b.setterId || setterMarcado || o?.setterId || undefined,
      referidorNombre: b.esReferido && b.referidorNombre.trim() ? b.referidorNombre.trim() : o?.referidorNombre,
      referidorTelefono: b.esReferido && b.referidorTelefono.trim() ? b.referidorTelefono.trim() : undefined,
    };

    const cuotas: Cuota[] = b.cuotas.map((c) => ({
      id: c.id, ventaId, numero: c.numero, monto: redondear(c.monto),
      vence: c.vence, estado: "pendiente", esReserva: c.esReserva,
    }));

    const cobros = b.cuotas.flatMap((c) =>
      c.cobros.filter((p) => p.monto > 0).map((p) => ({
        ...datosDeCobro(p), cuotaId: c.id, monto: redondear(p.monto),
      })),
    );

    acciones.registrarVenta({ venta, cuotas, cobros, sesionId });
    onListo(ventaId, venta.contactoNombre);

    /* La venta se ve en pantalla enseguida, pero recién existe cuando la base la acepta. Si la rechaza (17/11: Mariano cerró un lead
       que era de Dante y el candado de closers no la dejó entrar), se dice con todas las letras: antes el aviso decía «la venta quedó
       registrada» y el contrato fallaba con «No encuentro esa venta». Sin venta en la base no se pide contrato. */
    const ct = b.contrato;
    const pideContrato = conContrato && ct.decision === "mandar" && Boolean(ct.datos);
    void (async () => {
      const llego = await esperarGuardado();
      const rechazo = rechazoDe("ventas", ventaId);
      if (rechazo) {
        toast(avisoDeVentaRechazada(venta.contactoNombre, rechazo), "err",
          { texto: "Abrir su ficha", onClick: () => { if (contactoId) abrirFicha(contactoId, "ventas"); } });
        return;
      }
      if (!pideContrato || !ct.datos) return;
      const datos = ct.datos;
      try {
        await pedirContrato({
          accion: "crear", ventaId, sesionId, leadId: contactoId, programa: ct.programaId, datos, prueba: modoContrato === "prueba",
        });
        toast(`Contrato mandado a ${datos.email} para firmar.`);
      } catch (err) {
        /* Con botón, el aviso dura más; y en la ficha queda el contrato en rojo con «Volver a intentar» (y la campanita lo avisa).
           Sólo se dice que la venta quedó si la base lo confirmó. */
        const queVenta = llego ? "La venta quedó registrada" : "No pude confirmar que la venta se haya guardado (revisá tu conexión y mirá su ficha)";
        toast(`${queVenta}, pero el contrato NO salió y la persona no recibió nada: ${err instanceof Error ? err.message : "no se pudo"}`, "err",
          { texto: "Abrir su ficha", onClick: () => { if (contactoId) abrirFicha(contactoId, "ventas"); } });
      }
    })();
  }

  /* Teclado: Enter avanza, Esc sale. En un textarea Enter escribe. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      /* Un modal abierto encima (elegir un pago de la pasarela) maneja sus
         teclas, y un desplegable o calendario abierto también. */
      if (document.querySelector(".modal-backdrop, [data-flotante-abierto]")) return;
      if (ev.key === "Escape") { ev.preventDefault(); onCerrar(); return; }
      const foco = ev.target as HTMLElement | null;
      const escribiendo = foco?.tagName === "INPUT" || foco?.tagName === "TEXTAREA" || foco?.tagName === "SELECT"
        || Boolean(foco?.classList.contains("sel") || foco?.classList.contains("fecha"));

      /* Los números eligen la opción que tienen al lado, como muestra el
         cartelito de cada tarjeta. Mientras se escribe, un 3 es un 3. */
      if (!escribiendo && /^[1-9]$/.test(ev.key)) {
        const opciones = mainRef.current?.querySelectorAll<HTMLButtonElement>(".opcion");
        const elegida = opciones?.[Number(ev.key) - 1];
        if (elegida) { ev.preventDefault(); elegida.click(); return; }
      }

      if (ev.key !== "Enter" || ev.shiftKey) return;
      if (foco?.tagName === "TEXTAREA") return;
      /* Sobre una opción ya elegida, Enter avanza en vez de volver a
         tocarla: si no, en el paso del director la desmarcaría. */
      if (foco?.tagName === "BUTTON" && !foco.classList.contains("opcion")) return;
      ev.preventDefault();
      if (paso.id === "resumen") { if (puedeAvanzar) guardar(); }
      else avanzar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* Foco en el primer control de cada paso. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      mainRef.current?.querySelector<HTMLElement>("input, textarea, select, .sel, .fecha, .opcion")?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [i]);

  const progreso = ((i + (puedeAvanzar ? 1 : 0.35)) / pasos.length) * 100;

  return (
    <div className="asistente" role="dialog" aria-modal="true" aria-label={completando ? "Completar la reserva" : "Nueva venta"} data-modo={completando ? "completar" : undefined}>
      <div className="asistente__progreso">
        <div className="asistente__progreso-fill" style={{ width: `${progreso}%` }} />
      </div>

      <div className="asistente__head">
        <span className="asistente__paso-n">{i + 1} / {pasos.length}</span>
        {completando && <Badge variante="accent">Completar la reserva de {b.contactoNombre.split(" ")[0]}</Badge>}
        <span className="asistente__ruta">
          {pasos.map((p, k) => (
            <React.Fragment key={p.id}>
              {k > 0 && <span className="asistente__ruta-sep">·</span>}
              <span className="asistente__ruta-item" data-activo={k === i}>{p.titulo}</span>
            </React.Fragment>
          ))}
        </span>
        <span className="spacer" />
        <IconButton etiqueta="Salir del asistente" onClick={onCerrar}><X size={18} /></IconButton>
      </div>

      <div className="asistente__main" ref={mainRef}>
        <div className="asistente__paso" key={paso.id}>
          {paso.id === "cliente" && (
            <>
              <PasoCliente b={b} set={set} e={e} M={M} onPagoDeCuota={onPagoDeCuota} />
              <AvisoReservaSuelta e={e} reservas={reservas} nombre={b.contactoNombre} onCompletar={completarEsta} />
            </>
          )}
          {paso.id === "producto" && (
            <>
              {/* Abierto desde la ficha se arranca acá: el aviso de la reserva va antes de elegir el servicio. */}
              {cliente && <AvisoReservaSuelta e={e} reservas={reservas} nombre={b.contactoNombre} onCompletar={completarEsta} />}
              <PasoProducto b={b} set={set} e={e} M={M} completando={completando} />
            </>
          )}
          {paso.id === "lanzamiento" && <PasoLanzamiento b={b} set={set} e={e} />}
          {paso.id === "precio" && (
            <>
              <PasoPrecio b={b} set={set} e={e} M={M} pagado={completando ? pagadoDeReserva : 0} />
              <AvisoVentaIdentica e={e} identicas={identicas} />
            </>
          )}
          {paso.id === "equipo" && <PasoEquipo b={b} set={set} e={e} sinComision={sinComision} setterMarcado={setterMarcado}
            llamada={sesionId ? e.sesiones.find((x) => x.id === sesionId) : undefined} />}
          {paso.id === "plan" && <PasoPlan b={b} setB={setB} M={M} diferencia={diferenciaPlan} moneda={e.ajustes.monedaBase || "USD"} completando={completando} />}
          {paso.id === "cobros" && <PasoCobros b={b} setB={setB} e={e} M={M} onSubiendo={onSubiendo} />}
          {paso.id === "contrato" && (
            <PasoContrato b={b} setB={setB} e={e} esDueno={esDueno} modo={modoContrato} encendido={configContratos?.estado === "encendido" || configContratos?.estado === "duenos"} completando={completando} ventaCompletando={completarId} />
          )}
          {paso.id === "resumen" && (
            <PasoResumen
              b={b} set={set} e={e} M={M} sinComision={sinComision} totalCobrado={totalCobrado} setterMarcado={setterMarcado} completando={completando}
              aviso={<>
                <AvisoReservaSuelta e={e} reservas={reservas} nombre={b.contactoNombre} onCompletar={completarEsta} confirmada={reservaAparte} onConfirmar={setReservaAparte} />
                <AvisoVentaIdentica e={e} identicas={identicas} confirmada={otraCompra} onConfirmar={setOtraCompra} />
              </>}
            />
          )}
        </div>
      </div>

      <div className="asistente__foot">
        {i > 0 && <Button variante="ghost" icono={<ArrowLeft size={16} />} onClick={volver}>Atrás</Button>}
        <span className="spacer" />
        {problema && (
          /* En los pasos de plata el desvío es un problema; en los demás,
             sólo falta completar algo: no se pinta como error. */
          <span className="t-sm" style={{ color: paso.id === "plan" || paso.id === "cobros" ? "var(--warning)" : "var(--ink-subtle)" }}>
            {problema}
          </span>
        )}
        {paso.id === "resumen" ? (
          <Button variante="primary" icono={<Check size={16} />} onClick={guardar} disabled={!puedeAvanzar || registrada}>{registrada ? "Registrando…" : completando ? "Completar la reserva" : "Registrar la venta"}</Button>
        ) : (
          <>
            <span className="asistente__pista"><kbd>Enter</kbd><CornerDownLeft size={13} /></span>
            <Button variante="primary" onClick={avanzar} disabled={!puedeAvanzar}>Continuar</Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Estado inicial ---------- */

function inicial(e: EstadoApp, mov?: Movimiento, cliente?: { contactoId: string; nombre: string; email: string }): Borrador {
  const hoy = new Date().toISOString();
  /* Sin servicio elegido de antemano: el que venía marcado era «Mentoría», y los closers pasaban de largo y quedaba como «Mentoría» lo
     que era Hackear IT, AI o Biz (Yari, 22/10: «debería decir el nombre del servicio»). Tiene que elegirlo quien cierra. */
  const b: Borrador = {
    /* Desde un cobro: si su correo es de alguien que ya está, queda elegido. */
    contactoId: cliente?.contactoId
      ?? (mov?.clienteEmail ? e.leads.find((l) => l.email && claveEmail(l.email) === claveEmail(mov.clienteEmail))?.id : undefined),
    contactoNombre: cliente?.nombre ?? mov?.clienteNombre ?? "",
    contactoEmail: cliente?.email ?? mov?.clienteEmail ?? "",
    contactoPais: "",
    contactoTelefono: mov?.clienteTelefono ?? "",
    productoId: "",
    precioAcordado: mov?.monto ?? 0,
    precioTocado: Boolean(mov),
    closerId: "",
    directorId: e.equipo.find((x) => x.rol === "director" && x.activo)?.id ?? "",
    /* Sin estrategia de entrada: la pone la UTM al guardar. Antes arrancaba
       con la primera de la lista y, sin el paso de origen, todo habría
       quedado con la estrategia del webinar sin que nadie la eligiera. */
    embudoId: "",
    webinarId: "",
    fecha: mov?.fecha ?? hoy,
    excluidoMarketing: false,
    lanzamientoInterno: null,
    notas: "",
    reserva: 0,
    soloReserva: false,
    precioPrograma: 0,
    cantidadCuotas: 1,
    frecuencia: "mensual",
    primerVencimiento: mov?.fecha ?? hoy,
    cuotas: [],
    planTocado: false,
    fijas: [],
    proyecto: "",
    setterId: "",
    referidorNombre: "",
    referidorTelefono: "",
    esReferido: false,
    contrato: { decision: "mandar", programaId: "", datos: null, prueba: false },
  };
  b.cuotas = armarPlan(b);
  /* Si el asistente se abrió desde un cobro suelto, ese cobro ya viene
     atado a la primera cuota: era el punto de entrar por ahí. */
  if (mov && b.cuotas[0]) {
    b.cuotas[0].cobros = [{
      id: nuevoId("cob"), procesadorId: mov.procesadorId ?? "", monto: mov.monto,
      fecha: mov.fecha, referencia: mov.referencia, movimientoId: mov.id,
    }];
  }
  return b;
}

/* ¿Esa venta es una reserva suelta, de las que se completan? */
function sePuedeCompletar(e: EstadoApp, ventaId: string): boolean {
  const venta = e.ventas.find((v) => v.id === ventaId);
  return Boolean(venta && reservaSuelta(venta, e.cuotas.filter((c) => c.ventaId === ventaId)));
}

/* Completar una reserva: el borrador sale de la venta que ya está (quién, qué servicio, quién vendió, cuándo) y sólo queda
   por decir cuánto vale el programa entero y cómo se paga lo que falta. La reserva cobrada entra como línea fija. */
function inicialParaCompletar(e: EstadoApp, venta: Venta): Borrador {
  const base = inicial(e);
  const suelta: ReservaSuelta | null = reservaSuelta(venta, e.cuotas.filter((c) => c.ventaId === venta.id));
  const fijas: LineaCuota[] = (suelta?.cobradas ?? []).slice().sort((x, y) => x.numero - y.numero).map((c) => ({
    id: c.id, numero: c.numero, esReserva: c.esReserva, monto: c.monto, vence: c.vence ?? venta.fecha, cobros: [], fija: true,
  }));
  const persona = personaDeVenta(e, venta);
  const lista = e.productos.find((p) => p.id === venta.productoId)?.precioLista ?? 0;
  const hoy = new Date().toISOString();
  const b: Borrador = {
    ...base,
    contactoId: venta.contactoId, contactoNombre: persona.nombre || venta.contactoNombre,
    contactoEmail: persona.email, contactoTelefono: persona.telefono, contactoPais: persona.pais,
    productoId: venta.productoId ?? "",
    /* El precio de lista del servicio, si es más que la reserva; si no, lo pone quien carga. */
    precioAcordado: lista > sumar(fijas) ? lista : 0, precioTocado: false,
    closerId: venta.closerId ?? "", directorId: venta.directorId ?? "", embudoId: venta.embudoId ?? "", webinarId: venta.webinarId ?? "",
    /* La venta conserva su fecha (el día que cerró con la reserva); las cuotas nuevas vencen desde hoy. */
    fecha: venta.fecha, primerVencimiento: hoy,
    excluidoMarketing: venta.excluidoMarketing, notas: venta.notas ?? "",
    proyecto: venta.proyecto ?? "", setterId: venta.setterId ?? "",
    fijas,
  };
  b.cuotas = armarPlan(b);
  return b;
}

/* ---------- Validación por paso ---------- */

function validar(paso: PasoId, b: Borrador, diferencia: number, ctx: {
  e: EstadoApp; subiendo: number; modoContrato: "produccion" | "prueba"; repetida: boolean;
  /* Se está completando una reserva (no es una venta nueva). */
  completando: boolean;
  /* Quien compra ya dejó una reserva suelta y no se dijo que ésta es otra compra. */
  conReservaSuelta: boolean;
}): string | null {
  switch (paso) {
    case "cliente":
      if (b.contactoId) return null;
      if (b.crearContacto) return b.contactoNombre.trim().length >= 2 ? null : "Escribí el nombre del cliente";
      return b.contactoNombre.trim().length >= 2 ? "Elegí al cliente de la lista o crealo como nuevo" : "Buscá al cliente";
    case "producto":
      return b.productoId ? null : "Elegí el servicio adquirido";
    case "lanzamiento":
      return b.lanzamientoInterno === null ? "Decí si es del lanzamiento interno" : null;
    case "contrato": {
      if (b.contrato.decision !== "mandar") return null;
      if (!b.contrato.datos) return "Armando los datos del contrato…";
      const programa = programasDe(ctx.e.ajustes).find((p) => p.id === b.contrato.programaId);
      if (!plantillaDelContrato(programa, b.contrato.datos.reserva, b.contrato.datos.sesiones).id) {
        return b.contrato.datos.reserva && programa ? `${programa.nombre} todavía no tiene contrato de reserva` : "Elegí el programa del contrato";
      }
      return problemaDeDatos(b.contrato.datos, ctx.modoContrato, undefined, programa?.id);
    }
    case "precio": {
      const pagado = sumar(b.fijas);
      if (ctx.completando && !(b.precioAcordado > pagado + 0.009)) {
        return b.precioAcordado > 0 ? `Tiene que ser más que la reserva que ya pagó (${pagado.toLocaleString("es-AR")}): es el valor del programa entero` : "Poné cuánto vale el programa entero";
      }
      return b.precioAcordado > 0 ? null : "El valor total tiene que ser mayor a cero";
    }
    case "equipo":
      if (!b.closerId) return "Decí quién es el vendedor";
      return b.esReferido && !b.referidorNombre.trim() ? "Poné el nombre del referidor" : null;
    case "plan":
      if (b.soloReserva && b.reserva <= 0) return "Poné el monto de la reserva";
      if (Math.abs(diferencia) > 0.5) {
        return diferencia > 0
          ? `Las cuotas suman ${diferencia.toFixed(2)} menos que el precio`
          : `Las cuotas suman ${Math.abs(diferencia).toFixed(2)} de más`;
      }
      return null;
    case "cobros":
    case "resumen": {
      if (paso === "resumen" && ctx.conReservaSuelta) return "Ya dejó una reserva: completala, o marcá que es otra compra";
      if (paso === "resumen" && ctx.repetida) return "Ya hay una venta idéntica: marcá que es otra compra, o salí sin registrar";
      /* Una venta sin estrategia no se cuenta en Marketing ni deja cerrar el mes: se elige acá, en el resumen. (Al completar
         una reserva el origen no se toca: es el de la venta que ya está.) */
      if (paso === "resumen" && !ctx.completando && !estrategiaDeLaVenta(ctx.e, b.contactoId, b.fecha, b.embudoId, b.lanzamientoInterno === true)) return FALTA_ESTRATEGIA;
      const nombre = (c: LineaCuota) => (c.esReserva ? "la reserva" : `la cuota ${c.numero}`);
      const mal = b.cuotas.find((c) => sumar(c.cobros) > c.monto + 0.01);
      if (mal) return `Los cobros de ${nombre(mal)} superan su monto`;
      if (ctx.subiendo > 0) return "Esperá que termine de subir el comprobante";
      for (const c of b.cuotas) {
        const p = problemaDeCobros(ctx.e, c.cobros, nombre(c));
        if (p) return p;
      }
      return problemaDePasarelas(ctx.e, b.cuotas.flatMap((c) => c.cobros));
    }
    default:
      return null;
  }
}

/* ---------- Piezas ---------- */

function Pregunta({ texto, sub }: { texto: string; sub?: string }) {
  return (
    <div>
      <h2 className="asistente__pregunta">{texto}</h2>
      {sub && <p className="asistente__sub">{sub}</p>}
    </div>
  );
}

function Opcion({ tecla, nombre, sub, activo, onClick, extra }: {
  tecla?: string; nombre: string; sub?: string; activo: boolean; onClick: () => void;
  /* Lo que va a la derecha: el estado de una persona, por ejemplo. */
  extra?: React.ReactNode;
}) {
  return (
    <button type="button" className="opcion" aria-pressed={activo} onClick={onClick}>
      {tecla && <span className="opcion__tecla">{tecla}</span>}
      <span className="opcion__texto">
        <span className="opcion__nombre">{nombre}</span>
        {sub && <span className="opcion__sub">{sub}</span>}
      </span>
      {extra && <span className="opcion__extra">{extra}</span>}
      {activo && <Check size={16} style={{ marginLeft: extra ? 8 : "auto", color: "var(--brand)" }} />}
    </button>
  );
}

/* ---------- Paso 1: cliente ----------
   Se busca a la persona por nombre, correo o teléfono y se elige de la
   lista; si no está, se carga como cliente nueva con sus datos a la
   vista. Arriba y fijo: antes el paso estaba centrado y saltaba cada vez
   que aparecía o desaparecía la lista. */

/* Lo que se sabe de cada persona de la lista, a la derecha. */
function EstadoPersona({ p, M, reserva }: {
  p: PersonaBuscada; M: (n: number, d?: number) => string;
  /* Lo que dejó de reserva, si su compra es sólo eso: no «ya compró», falta completarla. */
  reserva?: number;
}) {
  const debe = p.cuotas.reduce((a, c) => a + c.saldo, 0);
  if (reserva && debe <= 0) return <Badge variante="accent">Reserva de {M(reserva)}</Badge>;
  if (debe > 0) return <Badge variante={p.cuotas.some((c) => c.diasAtraso > 0) ? "danger" : "accent"}>Debe {M(debe)}</Badge>;
  if (p.compras > 0) return <Badge variante="success">{p.compras === 1 ? "Ya compró" : `${p.compras} compras`}</Badge>;
  return <Badge variante="neutral">Lead</Badge>;
}

function PasoCliente({ b, set, e, M, onPagoDeCuota }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; M: (n: number, d?: number) => string;
  onPagoDeCuota?: (cuotaId: string) => void;
}) {
  const elegido = personaPorId(e, b.contactoId);
  const escrito = b.contactoNombre.trim();
  /* Quién dejó sólo una reserva: se dice en la lista y al elegirlo, en vez de «Ya compró». */
  const conReserva = useMemo(() => reservasSueltasPorContacto(e), [e.ventas, e.cuotas]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultados = useMemo(
    () => (b.contactoId || b.crearContacto ? [] : buscarPersonas(e, b.contactoNombre)),
    [e, b.contactoNombre, b.contactoId, b.crearContacto],
  );
  const esAlguno = resultados.some((p) => normalizar(p.nombre) === normalizar(escrito));
  /* Cargando un cliente nuevo: si el mail o el teléfono ya son de alguien, se avisa antes de crear la misma persona otra
     vez (Lili, 22/10: Juan Camilo quedó dos veces, una con cada mail). */
  const yaEstan = useMemo(() => {
    if (!b.crearContacto) return [];
    const mail = claveEmail(b.contactoEmail);
    const porMail = mail.includes("@") ? buscarPersonas(e, mail, 3).filter((p) => claveEmail(p.email) === mail) : [];
    const digitos = b.contactoTelefono.replace(/\D/g, "");
    const porTel = digitos.length >= 8 ? buscarPersonas(e, digitos.slice(-8), 3).filter((p) => compararTelefonos(p.telefono, b.contactoTelefono) !== "no") : [];
    return [...porMail, ...porTel.filter((p) => !porMail.some((x) => x.id === p.id))]
      .map((p) => ({ p, por: porMail.some((x) => x.id === p.id) ? "el mismo mail" : "el mismo teléfono" }));
  }, [e, b.crearContacto, b.contactoEmail, b.contactoTelefono]);
  /* El closer ve sólo sus contactos: lo que no encuentra acá se le pregunta a la base, que ve a todos y devuelve sólo el
     nombre (supabase/personas-unicas.sql). Por mail es la misma persona sí o sí (la base no deja dos fichas con el mismo
     mail); por teléfono, si el nombre también coincide, se ofrece usar esa ficha. */
  const [enLaBase, setEnLaBase] = useState<{ id: string; nombre: string; por: "email" | "telefono" }[]>([]);
  /* La base también avisa si ese teléfono o mail es de un ALUMNO sin venta (importado o cargado por Servicio, sin
     contacto): Mariano cargó la venta de Saul Rivas Martínez como «Edgar» y quedaron dos alumnos (Lili, 23/10). Con el
     mismo nombre la base los une sola (alumnos-sin-duplicar.sql); con otro, se avisa para que el closer lo revise. */
  const [alumnoDeServicio, setAlumnoDeServicio] = useState<{ id: string; nombre: string }[]>([]);
  useEffect(() => {
    const mail = claveEmail(b.contactoEmail);
    const digitos = b.contactoTelefono.replace(/\D/g, "");
    if (!nube || !(b.crearContacto || b.contactoId) || (!mail.includes("@") && digitos.length < 8)) { setEnLaBase([]); setAlumnoDeServicio([]); return; }
    let vivo = true;
    const t = window.setTimeout(() => {
      void nube!.rpc("persona_existente", { p_email: mail, p_telefono: b.contactoTelefono }).then((r) => {
        if (!vivo || r.error) return;
        const filas = (r.data ?? []) as { id: string; nombre: string; por: "email" | "telefono" | "alumno" }[];
        const contactos = filas.filter((x): x is { id: string; nombre: string; por: "email" | "telefono" } => x.por !== "alumno");
        setEnLaBase(b.crearContacto && yaEstan.length === 0
          ? contactos.filter((x) => x.por === "email" || palabrasEnComun(x.nombre, b.contactoNombre) >= 2) : []);
        setAlumnoDeServicio(filas.filter((x) => x.por === "alumno" && palabrasEnComun(x.nombre, b.contactoNombre) < 2));
      });
    }, 450);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [b.crearContacto, b.contactoId, b.contactoEmail, b.contactoTelefono, b.contactoNombre, yaEstan.length]);
  const delMail = enLaBase.find((x) => x.por === "email");
  useEffect(() => {
    if (delMail && b.contactoExistenteId !== delMail.id) set({ contactoExistenteId: delMail.id, contactoExistentePor: "email" });
    if (!delMail && b.contactoExistentePor === "email") set({ contactoExistenteId: undefined, contactoExistentePor: undefined });
    if (b.contactoExistentePor === "telefono" && !enLaBase.some((x) => x.id === b.contactoExistenteId)) set({ contactoExistenteId: undefined, contactoExistentePor: undefined });
  }, [delMail, enLaBase, b.contactoExistenteId, b.contactoExistentePor, set]);
  const nombreCorto = elegido?.nombre.split(" ")[0] ?? "";

  return (
    <>
      <Pregunta
        texto="¿Quién compró?"
        sub="Buscalo por nombre, correo o teléfono. Si ya está en Apicanta, la venta queda pegada a su historia; si no, se carga como cliente nuevo."
      />

      {elegido ? (
        <div className="cliente-elegido">
          <Avatar nombre={elegido.nombre} size={40} />
          <div className="cliente-elegido__datos">
            <span className="cliente-elegido__nombre">{elegido.nombre}</span>
            <span className="t-sm t-subtle">{[elegido.email, elegido.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</span>
          </div>
          <EstadoPersona p={elegido} M={M} reserva={conReserva.get(elegido.id)?.pagado} />
          <Button sm variante="ghost" onClick={() => set({ contactoId: undefined, contactoNombre: "", contactoEmail: "", contactoTelefono: "" })}>
            Cambiar
          </Button>
        </div>
      ) : b.crearContacto ? (
        <div className="cliente-nuevo">
          <div className="cliente-nuevo__cab">
            <UserPlus size={16} />
            <span className="t-strong">Cliente nuevo</span>
            <span className="t-sm t-subtle">Se crea al guardar la venta.</span>
            <span className="spacer" />
            <button type="button" className="link t-sm" onClick={() => set({ crearContacto: false, contactoExistenteId: undefined, contactoExistentePor: undefined })}>Volver a buscar</button>
          </div>
          <div className="form-grid">
            <Field label="Nombre completo" span2>
              <Input value={b.contactoNombre} onChange={(ev) => set({ contactoNombre: ev.target.value })} aria-label="Nombre completo" />
            </Field>
            <Field label="Correo">
              <Input type="email" value={b.contactoEmail} placeholder="nombre@correo.com" aria-label="Correo"
                onChange={(ev) => set({ contactoEmail: ev.target.value })} />
            </Field>
            <Field label="Teléfono">
              <Input type="tel" value={b.contactoTelefono} placeholder="+54 9 11 5555 5555" aria-label="Teléfono"
                onChange={(ev) => set({ contactoTelefono: ev.target.value })} />
            </Field>
            <Field label="País" span2>
              <Select value={b.contactoPais} placeholder="Elegí el país" aria-label="País del cliente"
                onChange={(ev) => set({ contactoPais: ev.target.value })} opciones={PAISES} />
            </Field>
          </div>
          {yaEstan.length > 0 && (
            <div className="aviso-cuotas" role="status">
              <span className="t-strong">{yaEstan.length === 1 ? "Ya está en Apicanta" : "Ya hay alguien así en Apicanta"}</span>
              <span className="t-sm t-muted">Si es la misma persona, usá su ficha: la venta queda pegada a su historia y no se crea otra.</span>
              {yaEstan.map(({ p, por }) => (
                <div className="aviso-cuotas__fila" key={p.id}>
                  <span className="t-sm">
                    <strong>{p.nombre}</strong>
                    <span className="t-subtle"> · {por} · {[p.email, p.telefono].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button sm variante="secondary"
                    onClick={() => set({ contactoId: p.id, contactoNombre: p.nombre, contactoEmail: p.email ?? "", contactoTelefono: p.telefono ?? "", crearContacto: false })}>
                    Usar esa ficha
                  </Button>
                </div>
              ))}
            </div>
          )}
          {yaEstan.length === 0 && enLaBase.length > 0 && (
            <div className="aviso-cuotas" role="status">
              <span className="t-strong">Ya está en Apicanta, en una ficha de otra persona del equipo</span>
              <span className="t-sm t-muted">
                {delMail
                  ? `Ese mail es de ${delMail.nombre}: la venta se suma a su ficha, no se crea otra.`
                  : "Si es la misma persona, usá su ficha: la venta queda pegada a su historia."}
              </span>
              {!delMail && enLaBase.map((x) => (
                <div className="aviso-cuotas__fila" key={x.id}>
                  <span className="t-sm"><strong>{x.nombre}</strong><span className="t-subtle"> · el mismo teléfono</span></span>
                  {b.contactoExistenteId === x.id
                    ? <span className="t-sm t-strong">La venta va a su ficha</span>
                    : <Button sm variante="secondary" onClick={() => set({ contactoExistenteId: x.id, contactoExistentePor: "telefono" })}>Usar esa ficha</Button>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <Input
            icono={<Search size={16} />} value={b.contactoNombre} autoFocus aria-label="Buscar al cliente"
            onChange={(ev) => set({ contactoNombre: ev.target.value, contactoId: undefined })}
            placeholder="Nombre, correo o teléfono"
          />
          {(resultados.length > 0 || escrito.length >= 2) && (
            <div className="stack-2">
              {resultados.length > 0 && <span className="t-label">Ya están en Apicanta</span>}
              <div className="opciones opciones--lista">
                {resultados.map((p) => (
                  <Opcion
                    key={p.id} nombre={p.nombre} activo={false}
                    sub={[p.email, p.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}
                    extra={<EstadoPersona p={p} M={M} reserva={conReserva.get(p.id)?.pagado} />}
                    onClick={() => set({ contactoId: p.id, contactoNombre: p.nombre, contactoEmail: p.email ?? "", contactoTelefono: p.telefono ?? "", crearContacto: false })}
                  />
                ))}
                {escrito.length >= 2 && !esAlguno && (
                  <Opcion
                    nombre={`Crear «${escrito}» como cliente nuevo`}
                    sub="No está en Apicanta: se carga con su correo, teléfono y país"
                    activo={false} onClick={() => set({ crearContacto: true })}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {alumnoDeServicio.length > 0 && (
        <div className="aviso-cuotas" role="status">
          <span className="t-strong">
            {alumnoDeServicio.length === 1
              ? `Ese teléfono o mail ya es de ${alumnoDeServicio[0].nombre}, que es alumno de Servicio`
              : `Ese teléfono o mail ya es de ${alumnoDeServicio.map((x) => x.nombre).join(" y ")}, alumnos de Servicio`}
          </span>
          <span className="t-sm t-muted">
            Si es la misma persona, revisá que el nombre y el mail sean los suyos antes de guardar: Servicio ve la venta y la une a su ficha.
          </span>
        </div>
      )}

      {elegido && elegido.cuotas.length > 0 && onPagoDeCuota && (
        <div className="aviso-cuotas">
          <span className="t-strong">¿Venís a cargar el pago de una cuota?</span>
          <span className="t-sm t-muted">
            {elegido.cuotas.length === 1 ? `${nombreCorto} tiene una cuota por pagar.` : `${nombreCorto} tiene ${elegido.cuotas.length} cuotas por pagar.`}
            {" "}El pago se carga en su cuota: no hace falta una venta nueva.
          </span>
          {elegido.cuotas.slice(0, 3).map((c) => (
            <div className="aviso-cuotas__fila" key={c.cuota.id}>
              <span className="t-sm">
                <strong>{nombreDeCuota(c)}</strong>
                <span className="t-subtle"> · faltan {M(c.saldo)} · {c.diasAtraso > 0 ? `venció hace ${c.diasAtraso} ${c.diasAtraso === 1 ? "día" : "días"}` : c.cuota.vence ? `vence el ${fechaLarga(c.cuota.vence)}` : "sin fecha"}</span>
              </span>
              <Button sm variante="secondary" onClick={() => onPagoDeCuota(c.cuota.id)}>Cargar este pago</Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Paso 2: producto ---------- */

function PasoProducto({ b, set, e, M, completando }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; M: (n: number, d?: number) => string; completando?: boolean;
}) {
  const productos = e.productos.filter((p) => p.activo).sort((a, b) => a.orden - b.orden);
  return (
    <>
      <Pregunta
        texto={completando ? "¿A qué servicio entra?" : "¿Qué servicio adquirió?"}
        sub={completando
          ? "Quedó elegido el de la reserva. Cambialo sólo si al final entra a otro (reservó un programa y compra el Downsell)."
          : "El precio de lista se carga solo; en el próximo paso ponés el valor total de la venta."}
      />
      <div className="opciones">
        {productos.map((p, k) => (
          <Opcion
            key={p.id} tecla={String(k + 1)} nombre={p.nombre}
            sub={p.precioLista > 0 ? `Lista ${M(p.precioLista)}` : "Sin precio de lista"}
            activo={b.productoId === p.id}
            onClick={() => set({
              productoId: p.id,
              precioAcordado: b.precioTocado ? b.precioAcordado : p.precioLista,
            })}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- Lanzamiento interno (sólo con Upgrade AI y Principals) ----------
   Aldana (19/11): el lunes o martes se vende el upgrade a Hackear AI y Principals a quienes ya son alumnos. Es una venta interna que Agustín sí
   comisiona. En vez de depender de que el closer elija a mano «excluida de marketing» y la estrategia correcta, se pregunta acá, sin poder pasar
   de largo. La respuesta pone la estrategia «Lanzamiento interno» (sin mirar la UTM) y la excluye de marketing. */
function PasoLanzamiento({ b, set, e }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp }) {
  const servicio = e.productos.find((p) => p.id === b.productoId)?.nombre ?? "Este servicio";
  return (
    <>
      <Pregunta
        texto="¿Es del lanzamiento interno?"
        sub={`${servicio} se vende en el lanzamiento interno. Si es de ahí, la venta queda con esa estrategia y Agustín la comisiona: no hace falta tocar nada de marketing.`}
      />
      <div className="opciones">
        <Opcion
          tecla="1" nombre="Sí, es del lanzamiento interno" activo={b.lanzamientoInterno === true}
          sub="Estrategia «Lanzamiento interno», fuera de los anuncios (excluida de marketing) y con la comisión de Agustín."
          onClick={() => set({ lanzamientoInterno: true })}
        />
        <Opcion
          tecla="2" nombre="No, es una venta común" activo={b.lanzamientoInterno === false}
          sub="Sigue como cualquier venta: la estrategia sale de la UTM de la persona o se elige al final."
          onClick={() => set({ lanzamientoInterno: false })}
        />
      </div>
    </>
  );
}

/* ---------- Paso 3: precio ---------- */

function PasoPrecio({ b, set, e, M, pagado = 0 }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; M: (n: number, d?: number) => string;
  /* Completando una reserva: lo que ya pagó. El valor que se pide es el del programa entero, con eso adentro. */
  pagado?: number;
}) {
  const producto = e.productos.find((p) => p.id === b.productoId);
  const lista = producto?.precioLista ?? 0;
  const dif = b.precioAcordado - lista;
  const atajos = [...new Set([lista, Math.round(lista * 0.9), Math.round(lista * 0.8), 500].filter((x) => x > 0))];

  return (
    <>
      <Pregunta
        texto={pagado > 0 ? "¿Cuánto vale el programa entero?" : "¿Cuál es el valor total de la venta?"}
        sub={pagado > 0
          ? `Con la reserva adentro: ya pagó ${M(pagado, 2)}, que se descuentan.${lista > 0 ? ` El precio de lista de ${producto?.nombre} es ${M(lista)}.` : ""}`
          : lista > 0 ? `El precio de lista de ${producto?.nombre} es ${M(lista)}.` : undefined}
      />
      <div className="monto-grande">
        <span className="monto-grande__signo">US$</span>
        <InputMonto
          crudo
          value={b.precioAcordado || ""}
          onChange={(ev) => set({ precioAcordado: montoDe(ev.target.value), precioTocado: true })}
          aria-label="Valor total de la venta"
        />
      </div>
      <div className="row-wrap">
        {atajos.map((n) => (
          <Chip key={n} activo={b.precioAcordado === n} onClick={() => set({ precioAcordado: n, precioTocado: true })}>
            {M(n)}
          </Chip>
        ))}
      </div>
      {pagado > 0 && b.precioAcordado > pagado + 0.009 && (
        <p className="t-sm" role="status" data-falta-de-reserva>
          Ya pagó {M(pagado, 2)} de reserva: <strong>le falta pagar {M(redondear(b.precioAcordado - pagado), 2)}</strong>.
        </p>
      )}
      {lista > 0 && dif !== 0 && (
        <p className="t-sm t-muted">
          {dif < 0
            ? `${M(Math.abs(dif))} menos que el precio de lista (${pct((Math.abs(dif) / lista) * 100, 0)} de descuento).`
            : `${M(dif)} por encima del precio de lista.`}
        </p>
      )}
    </>
  );
}

/* ---------- Paso 4: vendedor, director, setter y referido ---------- */

function PasoEquipo({ b, set, e, sinComision, setterMarcado, llamada }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; sinComision: boolean;
  /* La llamada desde la que se carga la venta: si figura a nombre de otro closer, al guardar pasa al vendedor. */
  llamada?: Sesion;
  /* El setter que marcó la agenda de esta persona (lib/setter-agendas.ts). */
  setterMarcado?: string;
}) {
  /* Los mismos vendedores para todos, carguen quien cargue (lib/vendedores.ts): Aldana carga las ventas que cierra Yari (22/11). */
  const closers = vendedores(e.equipo, b.closerId);
  const vendedor = closers.find((x) => x.id === b.closerId);
  /* El director es siempre el que está activo (Santi): quien ya no está (Noelia) no se ofrece. */
  const directores = e.equipo.filter((x) => x.rol === "director" && x.activo);
  const setters = e.equipo.filter((x) => x.activo && x.rol === "setter");
  /* El vendedor es quien atendió: si la llamada figura de otro, se avisa acá que cambia de nombre con la venta (lib/pasar-llamadas.ts). */
  const plan = llamada ? paseDeLaVenta(llamada, b.closerId || undefined, e, { por: "", cuando: "" }) : null;
  const pase = plan ? { de: closerDeLlamada({ anfitrion: plan.plan.de }, e.equipo).nombre, a: plan.destino.miembro.nombre } : null;
  return (
    <>
      <Pregunta texto="¿Quién es el vendedor?" sub="De acá salen las comisiones: el vendedor cobra sobre lo que entra, neto de procesador." />
      <div className="hk-field">
        <label className="hk-label">Vendedor</label>
        <Select
          value={b.closerId} placeholder="Elegí el vendedor" aria-label="Vendedor"
          onChange={(ev) => set({ closerId: ev.target.value })}
          opciones={closers.map((x) => ({ valor: x.id, texto: x.nombre }))}
        />
        {pase && (
          <span className="hk-help">
            {pase.de
              ? `La llamada figura a nombre de ${pase.de}. Al guardar la venta pasa a nombre de ${pase.a}, que es quien la atendió.`
              : `La llamada no tiene closer. Al guardar la venta queda a nombre de ${pase.a}.`}
          </span>
        )}
        {sinComision && vendedor && <span className="hk-help">Con {vendedor.nombre} como vendedor no comisiona nadie.</span>}
      </div>

      <div className="form-grid">
        {!sinComision && directores.length > 0 && (
          <div className="hk-field">
            <label className="hk-label">Director</label>
            <Select
              value={b.directorId} aria-label="Director"
              onChange={(ev) => set({ directorId: ev.target.value })}
              opciones={[{ valor: "", texto: "Sin director" }, ...directores.map((x) => ({ valor: x.id, texto: x.nombre }))]}
            />
          </div>
        )}
        <div className="hk-field">
          <label className="hk-label">¿Tuvo setter?</label>
          <Select
            value={b.setterId} aria-label="Nombre del setter"
            onChange={(ev) => set({ setterId: ev.target.value })}
            opciones={[{ valor: "", texto: "Sin setter" }, ...setters.map((x) => ({ valor: x.id, texto: x.nombre }))]}
          />
          {setterMarcado && (b.setterId === setterMarcado || !b.setterId) && (
            <span className="hk-help">{e.equipo.find((x) => x.id === setterMarcado)?.nombre ?? "El setter"} marcó esta agenda como suya. Si no corresponde, avisale al director.</span>
          )}
        </div>
        <div className="hk-field">
          <label className="hk-label">¿Es referido?</label>
          <Select
            value={b.esReferido ? "si" : "no"} aria-label="¿Es referido?"
            onChange={(ev) => set({ esReferido: ev.target.value === "si" })}
            opciones={[{ valor: "no", texto: "No" }, { valor: "si", texto: `Sí · el referidor cobra ${pct((e.ajustes.comisionReferidor ?? 0.1) * 100, 0)}` }]}
          />
        </div>
      </div>

      {b.esReferido && (
        <div className="form-grid">
          <div className="hk-field">
            <label className="hk-label">Nombre del referidor</label>
            <Input value={b.referidorNombre} onChange={(ev) => set({ referidorNombre: ev.target.value })} placeholder="Quién lo refirió" />
          </div>
          <div className="hk-field">
            <label className="hk-label">Número de teléfono</label>
            <Input type="tel" value={b.referidorTelefono} onChange={(ev) => set({ referidorTelefono: ev.target.value })} placeholder="Del referidor" />
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Paso 6: plan de cobro ---------- */

function PasoPlan({ b, setB, M, diferencia, moneda, completando }: {
  b: Borrador;
  setB: React.Dispatch<React.SetStateAction<Borrador>>;
  M: (n: number, d?: number) => string; diferencia: number; moneda: string;
  /* Completando una reserva: la reserva ya está cobrada y fija; sólo se arma el plan de lo que falta. */
  completando?: boolean;
}) {
  const pagado = sumar(b.fijas);
  /* «Sólo la reserva»: el valor de la venta pasa a ser la reserva y los datos del contrato se rearman (cambia la
     plantilla). Al volver, recupera el valor que tenía. */
  const elegirSoloReserva = (solo: boolean) => setB((x) => x.soloReserva === solo ? x : ({
    ...x, soloReserva: solo, planTocado: false,
    precioPrograma: solo ? x.precioAcordado : x.precioPrograma,
    precioAcordado: solo ? x.reserva : (x.precioPrograma || x.precioAcordado),
    contrato: { ...x.contrato, datos: null },
  }));
  const cambiarReserva = (monto: number) => setB((x) => ({
    ...x, reserva: monto, planTocado: false,
    ...(x.soloReserva ? { precioAcordado: monto } : {}),
    /* Si ya se armó el contrato de la reserva, el monto lo sigue. */
    contrato: x.soloReserva && x.contrato.datos?.reserva
      ? { ...x.contrato, datos: { ...x.contrato.datos, modalidad: modalidadDeReserva(monto, moneda) } } : x.contrato,
  }));
  /* Cambiar una fecha a mano ya es un plan con fechas a medida: la frecuencia lo dice. */
  const editarCuota = (id: string, cambios: Partial<LineaCuota>) =>
    setB((x) => ({ ...x, planTocado: true, ...(cambios.vence ? { frecuencia: "medida" as const } : {}), cuotas: x.cuotas.map((c) => (c.id === id ? { ...c, ...cambios } : c)) }));

  const rehacer = () => setB((x) => ({ ...x, planTocado: false, frecuencia: x.frecuencia === "medida" ? "mensual" : x.frecuencia }));

  return (
    <>
      <Pregunta
        texto={completando ? "¿Cómo paga lo que falta?" : "¿Cuál es el plan de pago?"}
        sub={completando
          ? `La reserva de ${M(pagado, 2)} ya está cobrada y queda como está. Faltan ${M(redondear(b.precioAcordado - pagado), 2)}: en un pago o en cuotas.`
          : b.soloReserva
            ? "Sólo deja la reserva: no hay cuotas. El contrato sale con el monto de la reserva."
            : "La reserva es una cuota más. Después podés mover monto y fecha de cualquiera."}
      />

      {!completando && (
        <div className="row-wrap" style={{ gap: 6 }} role="group" aria-label="Qué se cobra">
          <Chip activo={!b.soloReserva} onClick={() => elegirSoloReserva(false)}>Con plan de cuotas</Chip>
          <Chip activo={b.soloReserva} onClick={() => elegirSoloReserva(true)}>Sólo la reserva</Chip>
        </div>
      )}

      <div className="form-grid">
        {completando ? (
          /* La venta conserva su fecha: lo que se elige es desde cuándo vence lo que falta. */
          <div className="hk-field">
            <label className="hk-label">Vence la primera cuota</label>
            <Input
              type="date" value={isoDia(b.primerVencimiento)} aria-label="Vence la primera cuota"
              onChange={(ev) => {
                if (!ev.target.value) return;
                const f = new Date(ev.target.value + "T12:00:00").toISOString();
                setB((x) => ({ ...x, primerVencimiento: f, planTocado: false, frecuencia: x.frecuencia === "medida" ? "mensual" : x.frecuencia }));
              }}
            />
          </div>
        ) : (
          <div className="hk-field">
            <label className="hk-label">Fecha de la venta</label>
            <Input
              type="date" value={isoDia(b.fecha)} aria-label="Fecha de la venta"
              onChange={(ev) => {
                if (!ev.target.value) return;
                const f = new Date(ev.target.value + "T12:00:00").toISOString();
                setB((x) => ({ ...x, fecha: f, primerVencimiento: f }));
              }}
            />
          </div>
        )}
        {!b.soloReserva && (
          <div className="hk-field">
            <label className="hk-label">Plan de pago</label>
            <Select
              value={b.planTocado ? "" : String(b.cantidadCuotas)} placeholder="A mano" aria-label="Plan de pago"
              onChange={(ev) => setB((x) => ({ ...x, cantidadCuotas: Number(ev.target.value), planTocado: false }))}
              opciones={[1, 2, 3, 4, 5, 6].map((n) => ({ valor: String(n), texto: n === 1 ? "1 Cuota" : `${n} Cuotas` }))}
            />
          </div>
        )}
      </div>

      {(!completando || b.cantidadCuotas > 1) && <div className="form-grid">
        {!completando && (
          <div className="hk-field">
            <label className="hk-label">{b.soloReserva ? "Monto de la reserva" : "Reserva"}</label>
            <InputMonto value={b.reserva || ""} placeholder="0" aria-label={b.soloReserva ? "Monto de la reserva" : "Reserva"}
              onChange={(ev) => cambiarReserva(montoDe(ev.target.value))} />
            <span className="hk-help">{b.soloReserva ? "Es todo lo que paga hoy: se descuenta del precio del programa si avanza." : "Lo que dejó de seña el día que cerró."}</span>
          </div>
        )}
        {/* Con un solo pago no hay nada que espaciar. */}
        {!b.soloReserva && b.cantidadCuotas > 1 && (
          <div className="hk-field">
            <label className="hk-label">Frecuencia</label>
            <Select value={b.frecuencia}
              onChange={(ev) => {
                const f = ev.target.value as Frecuencia;
                /* A medida no rearma nada: deja las fechas como están para cambiarlas una por una. */
                setB((x) => (f === "medida" ? { ...x, frecuencia: f } : { ...x, frecuencia: f, planTocado: false }));
              }}
              opciones={[
                { valor: "mensual", texto: "Mensual" },
                { valor: "quincenal", texto: "Quincenal" },
                { valor: "semanal", texto: "Semanal" },
                { valor: "medida", texto: "Fechas a medida" },
              ]} />
            <span className="hk-help">{b.frecuencia === "medida"
              ? "Poné la fecha de cada cuota en el plan de abajo."
              : "Arma las fechas solas desde la primera. Si le diste otras, cambialas abajo una por una."}</span>
          </div>
        )}
      </div>}

      <div className="stack-2">
        <div className="row">
          <span className="t-label">El plan queda así</span>
          {b.planTocado && (
            <Button sm variante="ghost" className="spacer" onClick={rehacer}>Rehacer parejo</Button>
          )}
        </div>
        {b.cuotas.map((c) => c.fija ? (
          /* Lo que ya estaba cobrado: se ve, no se cambia. */
          <div className="cuota-linea" key={c.id} data-fija>
            <span className="cuota-linea__nombre">
              {c.esReserva ? "Reserva" : `Cuota ${c.numero}`}
              <Badge variante="success"><Check size={13} />ya cobrada</Badge>
            </span>
            <span className="t-num t-strong" style={{ textAlign: "right", paddingRight: 12 }}>{M(c.monto, 2)}</span>
            <span className="t-sm t-subtle">{fechaLarga(c.vence)}</span>
          </div>
        ) : (
          <div className="cuota-linea" key={c.id}>
            <span className="cuota-linea__nombre">
              {c.esReserva ? "Reserva" : `Cuota ${c.numero}`}
              {c.esReserva && <Badge variante="info">seña</Badge>}
            </span>
            <InputMonto value={c.monto}
              onChange={(ev) => editarCuota(c.id, { monto: montoDe(ev.target.value) })} aria-label="Monto" />
            <Input type="date" value={isoDia(c.vence)}
              onChange={(ev) => editarCuota(c.id, { vence: new Date(ev.target.value + "T12:00:00").toISOString() })}
              aria-label="Vencimiento" />
          </div>
        ))}
        <div className="row t-sm" style={{ paddingTop: 4 }}>
          <span className="t-subtle">{b.cuotas.length} {b.cuotas.length === 1 ? "cuota" : "cuotas"}</span>
          <span className="spacer t-num t-strong" style={{ color: Math.abs(diferencia) > 0.5 ? "var(--warning)" : "var(--ink)" }}>
            {M(sumar(b.cuotas), 2)} de {M(b.precioAcordado, 2)}
          </span>
        </div>
        {Math.abs(diferencia) > 0.5 && (
          <Button sm variante="secondary" onClick={rehacer}>{completando ? "Repartir de nuevo lo que falta" : "Repartir de nuevo el precio entero"}</Button>
        )}
      </div>
    </>
  );
}

/* ---------- Paso 7: cobros y conciliación ---------- */

function PasoCobros({ b, setB, e, M, onSubiendo }: {
  b: Borrador; setB: React.Dispatch<React.SetStateAction<Borrador>>;
  e: EstadoApp; M: (n: number, d?: number) => string;
  onSubiendo: (cobroId: string, subiendo: boolean) => void;
}) {
  const procesadores = useMemo(() => cuentasPorUso(e), [e.procesadores, e.pagos]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Lo que usan de cada pago de pasarela los cobros de las OTRAS cuotas. */
  const usadoFuera = useCallback((cuotaId?: string) => {
    const usado = new Map<string, number>();
    for (const c of b.cuotas) {
      if (c.id === cuotaId) continue;
      for (const p of c.cobros) if (p.movimientoId) usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
    }
    return usado;
  }, [b.cuotas]);

  /* Pagos de pasarela sin conciliar que son de este cliente: mismo mail, o nombre y apellido. Un nombre en común no
     alcanza: a Dante le ofrecía la seña de Andres Lopez en la venta de Andres Gallego (23/10) y la imputó ahí. Los de
     otra persona (la pareja que pagó, la empresa) se eligen igual desde cada cuota, y ahí se pide confirmarlo. */
  const candidatos = useMemo(() => {
    const usado = usadoFuera();
    const cliente = { nombre: b.contactoNombre, email: b.contactoEmail };
    return e.movimientos
      .filter((m) => m.estado === "pendiente" && disponibleDe(m, e.pagos, usado) > 0.009)
      .filter((m) => quienPagoVsCliente(m, cliente) === "es")
      .sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha))
      .slice(0, 6);
  }, [e.movimientos, e.pagos, b.contactoNombre, b.contactoEmail, usadoFuera]);

  const cambiarCobros = (cuotaId: string) => (f: (cobros: Cobro[]) => Cobro[]) =>
    setB((x) => ({ ...x, cuotas: x.cuotas.map((c) => (c.id === cuotaId ? { ...c, cobros: f(c.cobros) } : c)) }));

  const vaciarCuota = (cuotaId: string) => {
    for (const p of b.cuotas.find((c) => c.id === cuotaId)?.cobros ?? []) {
      if (p.comprobante) void descartarComprobante(p.comprobante);
      onSubiendo(p.id, false);
    }
    cambiarCobros(cuotaId)(() => []);
  };

  return (
    <>
      <Pregunta
        texto={b.fijas.length > 0 ? "¿Ya pagó lo que faltaba?" : "¿Algo de esto ya entró?"}
        sub={b.fijas.length > 0
          ? "La reserva ya está cargada: no la vuelvas a cargar. Marcá sólo lo nuevo que entró; cada cobro se prueba con el pago de la pasarela o con el comprobante. Lo que no se cobró queda en Por cobrar."
          : "Marcá lo que ya se cobró. Cada cobro se prueba conciliándolo con el pago que llegó a la pasarela o subiendo el comprobante. Lo que no se cobró queda en Por cobrar."}
      />

      {candidatos.length > 0 && (
        <div className="help-card">
          <Sparkles size={18} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="help-card__title">Hay pagos en las pasarelas que parecen de este cliente</div>
            <div className="help-card__text" style={{ marginBottom: 8 }}>
              Si los usás, el cobro queda conciliado y el fee que se registra es el real de la pasarela.
            </div>
            <div className="stack-2">
              {candidatos.map((m) => (
                <div className="row" key={m.id} style={{ gap: 8, flexWrap: "wrap" }}>
                  <Badge variante="neutral">{medioDeMovimiento(e, m)}</Badge>
                  <span className="t-sm">{m.clienteNombre ?? "—"}</span>
                  <span className="t-sm t-subtle">{fechaLarga(m.fecha)}</span>
                  <span className="t-sm t-num t-strong spacer">{M(m.monto, 2)}</span>
                  <Select
                    value="" placeholder="Imputar a…" aria-label={`Imputar el pago de ${m.clienteNombre ?? "este cliente"}`}
                    onChange={(ev) => {
                      const cuota = b.cuotas.find((c) => c.id === ev.target.value);
                      if (!cuota) return;
                      const disponible = disponibleDe(m, e.pagos, usadoFuera());
                      const falta = redondear(cuota.monto - sumar(cuota.cobros));
                      cambiarCobros(cuota.id)((xs) => [...xs, cobroNuevo(
                        procesadorDeMovimiento(e, m)?.id ?? "",
                        Math.min(disponible, falta > 0.01 ? falta : disponible),
                        { fecha: m.fecha, referencia: m.referencia, movimientoId: m.id },
                      )]);
                    }}
                    opciones={b.cuotas.filter((c) => !c.fija).map((c) => ({
                      valor: c.id,
                      texto: `${c.esReserva ? "Reserva" : `Cuota ${c.numero}`} — ${M(c.monto, 2)}`,
                    }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="stack-3">
        {b.cuotas.map((c) => {
          const cobrado = sumar(c.cobros);
          const falta = redondear(c.monto - cobrado);
          const abierto = c.cobros.length > 0;
          /* Lo que ya estaba cobrado (la reserva que se completa): a la vista, sin interruptor. */
          if (c.fija) {
            return (
              <div className="cobro-bloque" key={c.id} data-fija>
                <div className="cobro-bloque__head">
                  <span className="t-strong">{c.esReserva ? "Reserva" : `Cuota ${c.numero}`}</span>
                  <span className="t-sm t-subtle">ya estaba cargada</span>
                  <span className="spacer t-num t-strong">{M(c.monto, 2)}</span>
                  <Badge variante="success"><Check size={13} />Cobrada</Badge>
                </div>
              </div>
            );
          }
          return (
            <div className="cobro-bloque" key={c.id}>
              <div className="cobro-bloque__head">
                <span className="t-strong">{c.esReserva ? "Reserva" : `Cuota ${c.numero}`}</span>
                <span className="t-sm t-subtle">vence {fechaLarga(c.vence)}</span>
                <span className="spacer t-num t-strong">{M(c.monto, 2)}</span>
                {abierto
                  ? (falta < -0.01
                      ? <Badge variante="warning">Sobran {M(-falta, 2)}</Badge>
                      : falta <= 0.01
                        ? <Badge variante="success"><Check size={13} />Cobrada</Badge>
                        : <Badge variante="accent">Falta {M(falta, 2)}</Badge>)
                  : <Badge variante="neutral">Pendiente</Badge>}
                <Switch
                  checked={abierto}
                  etiqueta={`Marcar como cobrada ${c.esReserva ? "la reserva" : `la cuota ${c.numero}`}`}
                  onChange={(v) => {
                    if (v) cambiarCobros(c.id)((xs) => agregarMedio(xs, c.monto, procesadores[0]?.id ?? ""));
                    else vaciarCuota(c.id);
                  }}
                />
              </div>

              {abierto && (
                <div className="cobro-bloque__body">
                  <EditorCobros
                    e={e} cobros={c.cobros} onCambio={cambiarCobros(c.id)} objetivo={c.monto}
                    cliente={{ nombre: b.contactoNombre, email: b.contactoEmail }}
                    usadoFuera={usadoFuera(c.id)} onSubiendo={onSubiendo}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- Paso: contrato ----------
   Como «¿Se le manda el contrato?» de Blue OS: el closer decide si sale ahora y carga los datos que van a la
   plantilla del programa (los del alumno, la modalidad, las sesiones 1 a 1 y los bonos). Si a esa persona ya se
   le mandó un contrato desde la app, queda elegido «Ya se le mandó»: no se le manda otro sin querer. */

function PasoContrato({ b, setB, e, esDueno, modo, encendido, completando, ventaCompletando }: {
  b: Borrador; setB: React.Dispatch<React.SetStateAction<Borrador>>; e: EstadoApp;
  esDueno: boolean; modo: "produccion" | "prueba"; encendido: boolean;
  /* Completando una reserva: el contrato de la reserva ya salió; el que falta es el del programa. */
  completando?: boolean;
  /* La venta que se completa: un contrato del programa atado a ella cuenta como «ya se le mandó», sea de cuando sea. */
  ventaCompletando?: string;
}) {
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const [previo, setPrevio] = useState<Contrato | null | undefined>(undefined);
  /* El contrato de la reserva que ya tiene (sólo al completar): se le cuenta al closer que ahora sale el otro. */
  const [deReservaPrevio, setDeReservaPrevio] = useState<Contrato | null>(null);
  /* El contrato firmado de otra compra (el del Downsell de quien ahora sube al programa): se le cuenta al closer que sale el nuevo. */
  const [deOtraCompra, setDeOtraCompra] = useState<Contrato | null>(null);
  const ct = b.contrato;
  const setCt = useCallback((cambios: Partial<Borrador["contrato"]>) => setB((x) => ({ ...x, contrato: { ...x.contrato, ...cambios } })), [setB]);

  /* Al llegar: los datos salen de la persona, su ficha de servicio (si ya es alumno) y el plan de cuotas. */
  useEffect(() => {
    if (ct.datos) return;
    const lead = b.contactoId ? e.leads.find((l) => l.id === b.contactoId) : undefined;
    const contacto = b.contactoId ? e.contactos.find((c) => c.id === b.contactoId) : undefined;
    const alumno = b.contactoId ? e.alumnos.find((a) => a.leadId === b.contactoId) : undefined;
    const seg = alumno ? (e.seguimientos ?? []).find((x) => x.alumnoId === alumno.id) : undefined;
    const programa = programaDeProducto(programas, b.productoId);
    /* La de su ficha de alumno o, si no, la que contestó al agendar en Calendly: el closer no se la vuelve a pedir. */
    const nacimiento = seg?.nacimiento || nacimientoDeLaPersona(e, b.contactoId) || undefined;
    /* Si por ahora sólo se cobró la reserva, el contrato que sale es el de la reserva (el del programa da los accesos al
       firmar: Luis Mejía, 27/10). Se puede cambiar en «Programa». */
    const deReserva = !completando && (b.soloReserva || soloSeCobroLaReserva(b.cuotas));
    /* Completando sin ningún pago nuevo: el contrato del programa puede esperar al pago (queda en «Todavía no»). */
    const sinPagoNuevo = Boolean(completando) && !b.cuotas.some((l) => !l.fija && l.cobros.length > 0);
    const datos: DatosContrato = {
      nombre: (contacto?.nombre || lead?.nombre || b.contactoNombre).trim(),
      email: (b.contactoEmail || contacto?.email || lead?.email || "").trim(),
      telefono: (b.contactoTelefono || (contacto as { telefono?: string } | undefined)?.telefono || lead?.telefono || seg?.telefono || "").trim(),
      documento: seg?.dni ?? "",
      domicilio: seg?.domicilio ?? "",
      ...(nacimiento ? { nacimiento } : {}),
      /* Sin país cargado, el del prefijo de su teléfono: el contrato no sale con el país vacío. */
      pais: paisCon(b.contactoPais || contacto?.pais || lead?.pais, b.contactoTelefono || (contacto as { telefono?: string } | undefined)?.telefono || lead?.telefono || seg?.telefono),
      modalidad: deReserva ? modalidadDeReserva(b.reserva > 0 ? b.reserva : b.cuotas.filter((l) => l.esReserva).reduce((n, l) => n + l.monto, 0), e.ajustes.monedaBase || "USD") : modalidadDeCuotas(b.cuotas, e.ajustes.monedaBase || "USD"),
      sesiones: seg?.sesionesMentor ?? 0,
      bonos: [],
      fecha: diaDeNegocio(new Date().toISOString()),
      ...(deReserva ? { reserva: true } : {}),
    };
    /* Sin plantilla: un programa sin contrato no lleva; una reserva sin contrato de reserva se manda después. */
    const sinPlantilla = deReserva ? "despues" : "no-lleva";
    setCt({ datos, programaId: programa?.id ?? "", decision: !plantillaDelContrato(programa, deReserva).id ? sinPlantilla : sinPagoNuevo ? "despues" : ct.decision });
  }, [ct.datos, ct.decision, b, e, programas, setCt, completando]);

  /* ¿Ya se le mandó el de esta compra desde la app? El de una compra anterior (el Downsell de quien ahora pasa a Hackear AI) no cuenta:
     sale el del programa nuevo, que al firmarse le suma los accesos que le faltan (lib/contratos.ts → contratoDeEstaCompra). */
  const programaDeLaVenta = programaDeProducto(programas, b.productoId)?.id ?? "";
  useEffect(() => {
    let vivo = true;
    if (!b.contactoId) { setPrevio(null); setDeOtraCompra(null); return; }
    void leerContratos({ leadId: b.contactoId }).then((r) => {
      if (!vivo) return;
      const vivos = r.contratos.filter((c) => c.estado !== "anulado" && c.estado !== "error" && c.estado !== "rechazado");
      const vigente = contratoDeEstaCompra(r.contratos, programaDeLaVenta, { completando, ventaId: ventaCompletando });
      setPrevio(vigente);
      setDeOtraCompra(contratoDeOtraCompra(r.contratos, programaDeLaVenta, { completando, ventaId: ventaCompletando }));
      const deReserva = completando ? vivos.find((c) => c.datos?.reserva) ?? null : null;
      setDeReservaPrevio(deReserva);
      /* Lo que ya puso para el contrato de la reserva (documento, domicilio, nacimiento) no se le vuelve a pedir: completa lo vacío. */
      if (deReserva?.datos) {
        const antes = deReserva.datos;
        setB((x) => {
          const d = x.contrato.datos;
          if (!d) return x;
          const lleno: DatosContrato = {
            ...d,
            documento: d.documento || antes.documento || "",
            domicilio: d.domicilio || antes.domicilio || "",
            telefono: d.telefono || antes.telefono || "",
            ...(d.nacimiento || !antes.nacimiento ? {} : { nacimiento: antes.nacimiento }),
            ...(d.perfil || !antes.perfil ? {} : { perfil: antes.perfil }),
          };
          return { ...x, contrato: { ...x.contrato, datos: lleno } };
        });
      }
      if (vigente) setCt({ decision: "ya" });
    }).catch(() => { if (vivo) { setPrevio(null); setDeOtraCompra(null); } });
    return () => { vivo = false; };
  }, [b.contactoId, programaDeLaVenta, setCt, setB, completando, ventaCompletando]);

  const programa = programas.find((p) => p.id === ct.programaId);
  /* Lo que se manda es el contrato de la reserva si así quedó elegido en «Programa» (aunque la venta sea con plan de cuotas). */
  const esReserva = Boolean(ct.datos?.reserva) || b.soloReserva;
  const plantilla = plantillaDelContrato(programa, esReserva, ct.datos?.sesiones);
  const opciones: { valor: DecisionContrato; nombre: string; sub: string }[] = [
    { valor: "mandar", nombre: completando ? "Sí, mandalo al completar la reserva" : "Sí, mandalo al registrar la venta", sub: esReserva
      ? "Le llega por mail el contrato de la reserva para firmar. No da accesos: los da el contrato del programa."
      : "Le llega por mail para firmar. Al firmar, se le dan los accesos del programa." },
    { valor: "ya", nombre: "Ya se le mandó", sub: "No sale otro." },
    { valor: "despues", nombre: "Todavía no", sub: "Lo mandás después desde la ficha de la venta." },
    { valor: "no-lleva", nombre: "No lleva contrato", sub: "Un evento, una cena o algo que no tiene contrato." },
  ];
  return (
    <div className="stack-4">
      <Pregunta texto={esReserva ? "¿Se le manda el contrato de la reserva?" : completando ? "¿Se le manda el contrato del programa?" : "¿Se le manda el contrato?"}
        sub={plantilla.nombre ? `Sale de la plantilla «${plantilla.nombre}» de PandaDoc.` : "Sale de la plantilla de PandaDoc del programa."} />
      {esReserva && programa && !plantilla.id && (
        <p className="t-sm" style={{ color: "var(--warning)" }}>
          {programa.nombre} todavía no tiene contrato de reserva: se elige en Ajustes → Integraciones → Programas. Mientras tanto, la venta se registra y el contrato se manda después desde la ficha.
        </p>
      )}
      {!esReserva && b.reserva > 0 && !b.soloReserva && (
        <p className="t-sm t-muted">
          Este contrato da todos los accesos al firmar. Si por ahora sólo dejó la reserva de US$ {b.reserva.toLocaleString("es-AR")}, elegí abajo en «Programa» la opción «sólo la reserva»:
          el contrato del programa se manda cuando pague.
        </p>
      )}
      {completando && !previo && (
        <p className="t-sm t-muted" role="note">
          {deReservaPrevio
            ? `Ya tiene el contrato de la reserva (${ROTULO_ESTADO[deReservaPrevio.estado].texto.toLowerCase()}), que no da accesos. `
            : ""}
          El del programa es el que da los accesos al firmar{b.cuotas.some((l) => !l.fija && l.cobros.length > 0) ? "." : ": como todavía no cargaste ningún pago nuevo, quedó en «Todavía no»; si lo mandás igual, los accesos esperan al primer pago."}
        </p>
      )}
      {!previo && deOtraCompra && !completando && (
        <p className="t-sm t-muted" role="note">
          Ya tiene firmado el contrato de {programas.find((p) => p.id === deOtraCompra.programa)?.nombre ?? deOtraCompra.plantillaNombre}, de su compra anterior.
          Este es otro: {programa ? `el de ${programa.nombre}` : "el del servicio nuevo"}. Al firmarlo se le suman los accesos que le faltan y se le mantienen los que ya tiene.
        </p>
      )}
      {previo && (
        <p className="t-sm" style={{ color: "var(--warning)" }}>
          A esta persona ya se le mandó un contrato de {programas.find((p) => p.id === previo.programa)?.nombre ?? previo.plantillaNombre}
          {previo.enviadoEn ? ` el ${fechaLarga(previo.enviadoEn)}` : ""} ({ROTULO_ESTADO[previo.estado].texto.toLowerCase()}). Por eso quedó elegido «Ya se le mandó».
        </p>
      )}
      <div className="stack-2">
        {opciones.map((o, k) => (
          <Opcion key={o.valor} tecla={String(k + 1)} nombre={o.nombre} sub={o.sub} activo={ct.decision === o.valor} onClick={() => setCt({ decision: o.valor })} />
        ))}
      </div>
      {ct.decision === "mandar" && ct.datos && (
        <div className="stack-3">
          <DatosDelContrato
            datos={ct.datos} programas={programas} programaId={ct.programaId}
            onPrograma={(id) => setCt({ programaId: id })}
            onReserva={completando ? undefined : (reserva) => {
              const { reserva: _antes, ...resto } = ct.datos!;
              const moneda = e.ajustes.monedaBase || "USD";
              setCt({ datos: { ...resto, ...(reserva ? { reserva: true, modalidad: modalidadDeReserva(b.reserva, moneda) } : { modalidad: modalidadDeCuotas(b.cuotas, moneda) }) } });
            }}
            onCambio={(c) => setCt({ datos: { ...ct.datos!, ...c } })}
          />
          {esDueno && encendido && (
            <div className="row-wrap" style={{ gap: 8 }}>
              <Switch checked={ct.prueba} onChange={(v) => setCt({ prueba: v })} etiqueta="Mandar como prueba" />
              <span className="t-sm t-muted">Mandar como prueba (sandbox: sólo a mails @apicanta.com, con marca de agua)</span>
            </div>
          )}
          {modo === "prueba" && <p className="t-sm t-subtle">Es un contrato de prueba: sólo puede ir a un mail @apicanta.com.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- Paso 8: resumen ---------- */

function PasoResumen({ b, set, e, M, sinComision, totalCobrado, setterMarcado, aviso, completando }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp;
  M: (n: number, d?: number) => string; sinComision: boolean; totalCobrado: number; setterMarcado?: string;
  /* Completando una reserva: se muestra cómo queda ESA venta; el origen, el setter y lo demás no se tocan. */
  completando?: boolean;
  /* Un cartel arriba del resumen (la venta idéntica ya cargada). */
  aviso?: React.ReactNode;
}) {
  const producto = e.productos.find((p) => p.id === b.productoId);
  const closer = e.equipo.find((x) => x.id === b.closerId);
  const director = e.equipo.find((x) => x.id === b.directorId);
  /* El origen, como va a quedar: el de la UTM de quien compró (el estándar
     o una regla de Ajustes) o, si no dice nada, lo que traía el lead. */
  const lanzamiento = b.lanzamientoInterno === true;
  const o = lanzamiento ? undefined : origenDeUtm(e, b.contactoId, b.fecha);
  const embudo = e.embudos.find((x) => x.id === (lanzamiento ? EMBUDO_LANZAMIENTO_INTERNO : (o?.embudoId ?? b.embudoId)));
  const proyecto = lanzamiento ? undefined : (o?.proyecto ?? b.proyecto);
  const webinar = lanzamiento ? undefined : (e.webinars.find((x) => x.id === (o?.webinarId ?? b.webinarId))
    ?? webinarDeProyecto(proyecto, e.webinars, b.fecha));
  const setter = e.equipo.find((x) => x.id === (b.setterId || setterMarcado || o?.setterId));
  const referidor = b.esReferido && b.referidorNombre.trim() ? b.referidorNombre.trim() : o?.referidorNombre;
  const conciliados = b.cuotas.flatMap((c) => c.cobros).filter((p) => p.movimientoId).length;

  return (
    <>
      <Pregunta
        texto="Así queda la venta"
        sub={completando
          ? "Es la misma venta de la reserva, ahora por el programa entero: no se crea otra. Revisá y confirmá."
          : "Revisá y confirmá. Después se puede editar todo desde la ficha."}
      />
      {aviso}

      <dl className="dl">
        <dt>Quién compró</dt>
        <dd>
          {b.contactoNombre}
          {!b.contactoId && b.crearContacto && <span className="t-subtle"> · cliente nuevo</span>}
        </dd>
        {(b.contactoEmail || b.contactoTelefono) && (
          <><dt>Contacto</dt><dd>{[b.contactoEmail, b.contactoTelefono].filter(Boolean).join(" · ")}</dd></>
        )}
        <dt>Servicio adquirido</dt><dd>{producto?.nombre ?? "—"}</dd>
        <dt>Valor total</dt><dd className="t-num">{M(b.precioAcordado, 2)}</dd>
        <dt>Vendedor</dt><dd>{closer?.nombre ?? "—"}{sinComision && <span className="t-subtle"> · no comisiona nadie</span>}</dd>
        {!sinComision && <><dt>Director</dt><dd>{director?.nombre ?? "—"}</dd></>}
        {!completando && <><dt>Origen</dt>
        <dd>
          {embudo || proyecto || webinar
            ? [embudo?.nombre ?? (lanzamiento ? "Lanzamiento interno" : undefined), proyecto, webinar?.titulo].filter(Boolean).join(" · ")
            : <span className="t-subtle">Sin origen todavía</span>}
          {!lanzamiento && !o?.embudoId && (
            <div style={{ marginTop: 6, maxWidth: 320 }}>
              <Select value={b.embudoId} placeholder="Elegí la estrategia" aria-label="Estrategia de la venta" error={!b.embudoId}
                onChange={(ev) => set({ embudoId: ev.target.value })}
                opciones={e.embudos.filter((x) => x.activo).sort((a, c) => a.orden - c.orden).map((x) => ({ valor: x.id, texto: x.nombre }))} />
            </div>
          )}
          <span className="t-sm t-subtle" style={{ display: "block" }}>
            {lanzamiento ? "Del lanzamiento interno: no se mira la UTM con la que la persona llegó. Agustín comisiona esta venta."
              : o ? `De la UTM ${textoUtm(o.utm)}.`
              : "Quien compró no llegó con una UTM del estándar ni con una que tenga regla: si se asigna en Ajustes → UTMs, se completa solo."}
          </span>
        </dd></>}
        {!completando && setter && <><dt>Setter</dt><dd>{setter.nombre}</dd></>}
        {!completando && referidor && <><dt>Referidor</dt><dd>{referidor}{b.esReferido && b.referidorTelefono ? ` · ${b.referidorTelefono}` : ""}</dd></>}
        <dt>Plan de pago</dt><dd>{b.soloReserva ? `Sólo la reserva: ${M(b.reserva)}`
          : `${planDePago({ estado: "activa" } as Venta, b.cuotas.map((c) => ({ esReserva: c.esReserva }) as Cuota))}${b.reserva > 0 ? ` + reserva de ${M(b.reserva)}` : b.fijas.some((c) => c.esReserva) ? ` + reserva de ${M(sumar(b.fijas.filter((c) => c.esReserva)))}` : ""}`}</dd>
        <dt>{completando ? "Fecha de la venta" : "Fecha"}</dt><dd>{fechaLarga(b.fecha)}{completando && <span className="t-subtle"> · la del día de la reserva</span>}</dd>
      </dl>

      <div className="stack-2">
        <span className="t-label">Plan de cobro</span>
        {b.cuotas.map((c) => {
          const cobrado = sumar(c.cobros);
          return (
            <div key={c.id}>
              <div className="row t-sm" style={{ gap: 8 }}>
                <span className="t-strong">{c.esReserva ? "Reserva" : `Cuota ${c.numero}`}</span>
                <span className="t-subtle">{fechaLarga(c.vence)}</span>
                <span className="spacer t-num">{M(c.monto, 2)}</span>
                {c.fija
                  ? <Badge variante="success"><Check size={13} />Ya cobrada</Badge>
                  : cobrado >= c.monto - 0.01
                  ? <Badge variante="success"><Check size={13} />Cobrada</Badge>
                  : cobrado > 0
                    ? <Badge variante="accent">Parcial {M(cobrado, 2)}</Badge>
                    : <Badge variante="neutral">Pendiente</Badge>}
              </div>
              {/* Con qué se pagó: un renglón por medio, y cómo se prueba cada uno. */}
              {c.cobros.length > 0 && (
                <div className="cobro-subitems">
                  {c.cobros.map((p) => (
                    <div className="row t-sm" key={p.id} style={{ gap: 8 }}>
                      <span className="t-muted">{e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "Sin medio"}</span>
                      {p.movimientoId
                        ? <span className="t-subtle" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Link2 size={12} />conciliado</span>
                        : p.comprobante
                          ? <span className="t-subtle" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Paperclip size={12} />comprobante</span>
                          : null}
                      <span className="spacer t-num">{M(p.monto, 2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div className="row t-sm" style={{ paddingTop: 6, borderTop: "1px solid var(--border)" }}>
          <span className="t-subtle">Entra hoy</span>
          <span className="spacer t-num t-strong">{M(totalCobrado, 2)}</span>
        </div>
        {conciliados > 0 && (
          <span className="t-sm" style={{ color: "var(--success)" }}>
            {conciliados} {conciliados === 1 ? "cobro queda conciliado" : "cobros quedan conciliados"} con su movimiento de pasarela.
          </span>
        )}
      </div>

      {!completando && (
        <div className="row-3">
          <Switch checked={lanzamiento} etiqueta="Lanzamiento interno"
            onChange={(v) => set({ lanzamientoInterno: v })} />
          <span className="t-body t-muted">
            <strong>Lanzamiento interno</strong>
            <span className="t-subtle"> · queda con esa estrategia, fuera de los anuncios, y Agustín la comisiona</span>
          </span>
        </div>
      )}

      {!completando && (
        <div className="row-3">
          <Switch checked={b.excluidoMarketing || sinComision || lanzamiento} etiqueta="Excluida de marketing"
            onChange={(v) => { if (!lanzamiento) set({ excluidoMarketing: v }); }} />
          <span className="t-body t-muted">
            <strong>Excluida de marketing</strong>
            {sinComision && <span className="t-subtle"> (se marca sola con este closer)</span>}
            {lanzamiento && <span className="t-subtle"> (se marca sola en el lanzamiento interno)</span>}
          </span>
        </div>
      )}

      <div className="hk-field">
        <label className="hk-label">Observaciones / Plan de pagos</label>
        <Textarea rows={2} value={b.notas} onChange={(ev) => set({ notas: ev.target.value })}
          placeholder="Lo que haya que recordar de esta venta" />
      </div>
    </>
  );
}
