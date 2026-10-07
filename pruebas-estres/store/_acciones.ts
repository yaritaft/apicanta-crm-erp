/* El catálogo de acciones del store para las pruebas de estrés (no es una prueba).

   Cada entrada sabe armar argumentos razonables (pero con textos y montos «raros») a
   partir de lo que hay en el estado, y llama a la acción real. Devuelve `NO` si en
   este estado no se puede (por ejemplo, borrar el seguimiento de un alumno que no
   tiene). Las usan las pruebas que corren secuencias al azar contra la base falsa. */
import type { Azar } from "./_aleatorio";
import { textoRaro } from "./_aleatorio";
import type { Store } from "./_fresco";
import { importarPlanilla as armarImportacion, type FilaVentas } from "@/lib/angelo";

/* El estado es un JSON de EstadoApp: acá no hace falta tipar cada colección. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type E = any;
export const NO = Symbol("no aplica");

export interface Accion {
  nombre: string;
  /** Más peso, sale más seguido. */
  peso?: number;
  correr: (a: Azar, e: E, S: Store) => unknown;
}

const AHORA = Date.parse("2026-10-07T15:00:00.000Z");
export const dia = (a: Azar, desde = -60, hasta = 0) => new Date(AHORA + a.entero(desde, hasta) * 86_400_000 + a.entero(0, 86_000) * 1000).toISOString();
export const soloDia = (iso: string) => iso.slice(0, 10);
export const dinero = (a: Azar) => Math.round((a.entero(20, 3000) + a.r()) * 100) / 100;
const NOMBRES = ["Ana", "Luis", "Marta", "Pablo", "Sofía", "Nicolás", "Valentina", "Joaquín", "Camila", "Tomás"];
const APELLIDOS = ["Gómez", "Pérez", "O'Connor", "Núñez", "Ñancupil", "Müller", "da Silva", "García-Márquez"];
export const persona = (a: Azar) => `${a.pick(NOMBRES)} ${a.pick(APELLIDOS)}`;
export const correo = (a: Azar, nombre: string) =>
  `${nombre.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}${a.entero(1, 99999)}@ejemplo.test`;
const uno = <T,>(xs: T[], a: Azar): T | typeof NO => (xs.length ? a.pick(xs) : NO);

/** Un texto libre: a veces vacío, a veces raro. */
export const libre = (a: Azar) => (a.prob(0.2) ? "" : textoRaro(a));

const conId = <T extends { id: string }>(xs: T[] | undefined) => (xs ?? []);

export const CATALOGO: Accion[] = [
  /* ---------- Leads y personas ---------- */
  {
    nombre: "altaDeLead", peso: 3,
    correr: (a, e, S) => {
      const nombre = persona(a);
      const reusa = a.prob(0.25) && e.contactos.length;
      S.acciones.altaDeLead({
        nombre, email: reusa ? a.pick(e.contactos as { email: string }[]).email : correo(a, nombre),
        telefono: a.prob(0.6) ? `+54 9 11 ${a.entero(1000, 9999)}-${a.entero(1000, 9999)}` : undefined,
        pais: a.prob(0.5) ? a.pick(["Argentina", "México", "Colombia"]) : undefined,
        fuente: "Webinar", etapaId: e.etapas[0].id, monto: dinero(a), moneda: "USD", responsable: "Yari Taft",
        notas: libre(a), etiquetas: a.prob(0.3) ? ["prioridad"] : [], creadoEn: dia(a), actualizadoEn: dia(a), extra: {},
      } as never, `Lead ${nombre}`);
    },
  },
  {
    nombre: "editarLead", peso: 3,
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string; nombre: string };
      if (l === (NO as unknown)) return NO;
      const cambios = a.pick([
        { notas: libre(a) }, { telefono: `+54 9 11 ${a.entero(1000, 9999)}` }, { telefono: "" }, { campania: libre(a) },
        { nombre: persona(a) }, { pais: "Chile" }, { monto: dinero(a) }, { etiquetas: ["x", "y"] },
      ]);
      S.acciones.editarLead(l.id, { ...cambios, actualizadoEn: dia(a, -1, 0) } as never, l.nombre);
    },
  },
  {
    nombre: "moverLead", peso: 2,
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.moverLead(l.id, a.pick(e.etapas as { id: string }[]).id);
    },
  },
  {
    nombre: "convertirEnAlumno",
    correr: (a, e, S) => {
      const libres = (e.leads as { id: string }[]).filter((l) => !(e.alumnos as { leadId?: string }[]).some((x) => x.leadId === l.id));
      const l = uno(libres, a) as { id: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.convertirEnAlumno(l.id, { plan: "Mentoría", cuotaMensual: dinero(a), cohorte: `C${a.entero(1, 9)}`, inicio: dia(a, -20, 0) });
    },
  },
  {
    nombre: "importarLeads",
    correr: (a, e, S) => {
      const filas = Array.from({ length: a.entero(1, 4) }, () => {
        const nombre = persona(a);
        return {
          nombre, email: a.prob(0.3) && e.contactos.length ? a.pick(e.contactos as { email: string }[]).email : correo(a, nombre),
          fuente: "CSV", etapaId: e.etapas[0].id, monto: 0, moneda: "USD", responsable: "Yari Taft", etiquetas: [],
          creadoEn: dia(a), actualizadoEn: dia(a), extra: {},
        };
      });
      S.acciones.importarLeads(filas as never);
    },
  },
  {
    nombre: "corregirPersona",
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.corregirPersona(l.id, a.pick([{ nombre: persona(a) }, { telefono: `+54 9 11 ${a.entero(1000, 9999)}` }, { email: correo(a, "nuevo") }]));
    },
  },
  {
    nombre: "corregirPerfil",
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.corregirPerfil(l.id, "pais", a.pick(["Chile", "", "Perú"]));
    },
  },
  {
    nombre: "comentar+borrar",
    correr: (a, e, S) => {
      const c = uno(conId(e.contactos), a) as { id: string };
      if (c === (NO as unknown)) return NO;
      S.acciones.comentar(c.id, `Texto ${textoRaro(a)}`, "Yari", a.prob(0.5) ? "yari@apicanta.test" : undefined);
      if (a.prob(0.4) && e.comentarios.length) S.acciones.borrarComentario((a.pick(e.comentarios) as { id: string }).id);
    },
  },

  /* ---------- Llamadas (CRM y Agenda) ---------- */
  {
    nombre: "editarLlamadas", peso: 4,
    correr: (a, e, S) => {
      const ss = (e.sesiones as { id: string }[]);
      if (!ss.length) return NO;
      const opciones = ["Compra Full", "Compra en Cuotas", "No Interesado", "Inasistió", "Seguimiento", "Devolución", ""];
      const pedidos = Array.from({ length: a.entero(1, 3) }, () => ({
        id: a.pick(ss).id,
        cambios: a.pick([
          { estadoLlamada: a.pick(opciones) }, { preCall: a.pick(["1° Mje Enviado", "2° Mje Enviado", ""]) },
          { notas: libre(a) }, { grabacion: a.prob(0.5) ? "https://fathom.video/share/abc" : "" },
          { estadoPreCall: a.pick(["Confirmado", "Reagendar", ""]) }, { hizoOferta: a.prob(0.5) },
        ]),
        detalle: "cambio de la prueba",
      }));
      S.acciones.editarLlamadas(pedidos as never);
    },
  },
  {
    nombre: "actualizarParcial(sesion)", peso: 2,
    correr: (a, e, S) => {
      const s = uno(conId(e.sesiones), a) as { id: string; tipo: string; invitado: string };
      if (s === (NO as unknown)) return NO;
      S.acciones.actualizarParcial("sesiones", s.id, a.pick([{ notas: libre(a) }, { estado: a.pick(["hecha", "no-show", "cancelada", "agendada"]) }, { enlace: undefined }]) as never, `${s.tipo} — ${s.invitado}`);
    },
  },
  {
    nombre: "crear(sesion)",
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string; nombre: string; email: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.crear("sesiones", {
        titulo: "Llamada", leadId: l.id, invitado: l.nombre, email: l.email, inicia: dia(a, 0, 10), duracionMin: 45, estado: "agendada",
        tipo: "Llamada", origen: "manual", creadoEn: dia(a), extra: {},
      } as never, `Llamada ${l.nombre}`);
    },
  },

  /* ---------- Cosas simples: crear / actualizar / eliminar ---------- */
  {
    nombre: "crear+eliminar(meta)",
    correr: (a, _e, S) => {
      const id = S.acciones.crear("metas", { nombre: libre(a) || "m", metrica: "ingresos", objetivo: dinero(a), unidad: "cantidad", periodo: "2026-10", creadoEn: dia(a) } as never, "Meta");
      if (a.prob(0.5)) S.acciones.eliminar("metas", id, "Meta");
    },
  },
  {
    nombre: "crear(gasto)+actualizar", peso: 2,
    correr: (a, e, S) => {
      const fecha = dia(a, -40, 0);
      const id = S.acciones.crear("gastos", {
        categoria: "Software", grupo: "operativo", concepto: libre(a) || "Gasto", monto: dinero(a), moneda: "USD", fecha,
        fechaPago: a.prob(0.5) ? dia(a, 0, 5) : undefined, recurrente: a.prob(0.5), proveedor: a.prob(0.6) ? libre(a) : undefined,
        notas: a.prob(0.5) ? libre(a) : undefined, creadoEn: fecha, extra: {},
      } as never, "Gasto");
      void e;
      if (a.prob(0.7)) S.acciones.actualizar("gastos", id, a.pick([{ monto: dinero(a) }, { notas: libre(a) }, { fechaPago: dia(a, 0, 9) }, { proveedor: "Otro" }]) as never, "Gasto");
    },
  },
  {
    nombre: "actualizar(lead)", peso: 2,
    correr: (a, e, S) => {
      const l = uno(conId(e.leads), a) as { id: string; nombre: string };
      if (l === (NO as unknown)) return NO;
      S.acciones.actualizar("leads", l.id, a.pick([{ notas: libre(a) }, { monto: dinero(a) }, { responsable: persona(a) }]) as never, l.nombre);
    },
  },
  {
    nombre: "actualizar(venta)", peso: 2,
    correr: (a, e, S) => {
      const v = uno(conId(e.ventas), a) as { id: string; contactoNombre: string };
      if (v === (NO as unknown)) return NO;
      S.acciones.actualizar("ventas", v.id, a.pick([{ notas: libre(a) }, { ingresoComunidad: a.pick(["Si", "No", "En espera", "N/A"]) }, { proyecto: "MENT" }, { precioAcordado: dinero(a) }, { webinarId: undefined }]) as never, v.contactoNombre);
    },
  },
  {
    nombre: "actualizar(alumno)",
    correr: (a, e, S) => {
      const x = uno(conId(e.alumnos), a) as { id: string; nombre: string };
      if (x === (NO as unknown)) return NO;
      S.acciones.actualizar("alumnos", x.id, a.pick([{ progreso: a.entero(0, 100) }, { estado: a.pick(["activo", "pausado", "graduado"]) }, { notas: libre(a) }, { ventaId: undefined }]) as never, x.nombre);
    },
  },
  {
    nombre: "actualizar(webinar)",
    correr: (a, e, S) => {
      const w = uno(conId(e.webinars), a) as { id: string; titulo: string };
      if (w === (NO as unknown)) return NO;
      S.acciones.actualizar("webinars", w.id, a.pick([{ registrados: a.entero(0, 900) }, { notas: libre(a) }, { youtubeUrl: "https://youtu.be/abc" }]) as never, w.titulo);
    },
  },
  {
    nombre: "ajustes",
    correr: (a, _e, S) => {
      S.acciones.ajustes(a.pick([{ responsable: persona(a) }, { negocio: libre(a) || "Apicanta" }, { tipoCambio: dinero(a) }, { fuentes: ["Meta Ads", "Webinar", "Otra"] }]) as never);
    },
  },
  {
    nombre: "ajustesSilencioso",
    correr: (a, _e, S) => { S.acciones.ajustesSilencioso({ tourVisto: a.prob(0.5) } as never); },
  },

  /* ---------- Etapas de servicio y alumnos ---------- */
  {
    nombre: "etapasServicio", peso: 2,
    correr: (a, e, S) => {
      const accion = a.pick(["crear", "editar", "ordenar", "eliminar", "mover"]);
      const etapas = (e.etapasServicio as { id: string }[]);
      if (accion === "crear") S.acciones.crearEtapaServicio({ nombre: `Etapa ${a.entero(1, 99)}`, color: "azul" as never });
      else if (accion === "editar" && etapas.length) S.acciones.editarEtapaServicio(a.pick(etapas).id, { nombre: ` ${libre(a) || "x"} ` });
      else if (accion === "ordenar" && etapas.length) S.acciones.ordenarEtapasServicio(a.mezclar(etapas.map((x) => x.id)));
      else if (accion === "eliminar" && etapas.length > 1) S.acciones.eliminarEtapaServicio(a.pick(etapas).id, a.prob(0.5) ? a.pick(etapas).id : undefined);
      else if (accion === "mover" && etapas.length && e.alumnos.length) S.acciones.moverAlumno((a.pick(e.alumnos) as { id: string }).id, a.pick(etapas).id);
      else return NO;
    },
  },
  {
    nombre: "crearServicioDeVenta",
    correr: (a, e, S) => {
      const v = uno(conId(e.ventas), a) as { id: string };
      if (v === (NO as unknown)) return NO;
      S.acciones.crearServicioDeVenta(v.id);
    },
  },

  /* ---------- Customer Success ---------- */
  {
    nombre: "seguimiento", peso: 3,
    correr: (a, e, S) => {
      const al = uno(conId(e.alumnos), a) as { id: string };
      if (al === (NO as unknown)) return NO;
      const dia0 = soloDia(dia(a, -10, 0));
      const antes = S.acciones.guardarSeguimiento(al.id, (s) => a.pick([
        { ...s, ultimoContacto: dia0, proximoContacto: soloDia(dia(a, 0, 20)), intentosSinRespuesta: 0, ultimoIntento: null, dejoDeContestar: false },
        { ...s, intentosSinRespuesta: s.intentosSinRespuesta + 1, ultimoIntento: dia0, notas: libre(a) },
        { ...s, dejoDeContestar: true }, { ...s, cvCorregido: true, cvCorregidoEn: dia0 }, { ...s, cadenciaDias: a.pick([7, 15, 20]) },
        { ...s, ultimoContacto: null, proximoContacto: null, cvCorregido: false, cvCorregidoEn: null },
      ]), () => "seguimiento");
      if (antes && a.prob(0.3)) S.acciones.restaurarSeguimiento(antes, "deshacer");
    },
  },
  {
    nombre: "testimonio", peso: 2,
    correr: (a, e, S) => {
      const al = uno(conId(e.alumnos), a) as { id: string };
      if (al === (NO as unknown)) return NO;
      if (a.prob(0.3) && (e.testimonios ?? []).length) { S.acciones.borrarTestimonio((a.pick(e.testimonios) as { id: string }).id); return; }
      const previo = (e.testimonios ?? []).length && a.prob(0.4) ? a.pick(e.testimonios as { id: string }[]) : null;
      S.acciones.guardarTestimonio({
        id: previo?.id ?? `tes_${a.entero(1, 1e9)}`, alumnoId: previo ? (previo as unknown as { alumnoId: string }).alumnoId : al.id,
        estado: a.pick(["pedido", "grabado", "publicado"]), link: a.prob(0.5) ? "https://youtu.be/xyz" : "", fecha: a.prob(0.5) ? soloDia(dia(a)) : null,
        notas: libre(a), creadoEn: dia(a),
      } as never);
    },
  },
  {
    nombre: "configurarSeguimiento",
    correr: (a, _e, S) => {
      S.acciones.configurarSeguimiento({ cadencias: [7, 15, a.pick([20, 30])], cadenciaPorDefecto: 15, reintentoDias: a.entero(1, 7), intentosHastaDejar: a.entero(1, 5) });
    },
  },

  /* ---------- Caja ---------- */
  {
    nombre: "arqueo",
    correr: (a, e, S) => {
      const procs = (e.procesadores as { id: string; moneda?: string }[]).slice(0, 3);
      if (!procs.length) return NO;
      if (a.prob(0.3) && (e.arqueos ?? []).length) { S.acciones.borrarArqueo((a.pick(e.arqueos) as { id: string }).id); return; }
      const saldos = procs.map((p) => ({ procesadorId: p.id, monto: dinero(a), moneda: "USD", montoBase: dinero(a) }));
      S.acciones.guardarArqueo({
        id: `arq_${a.entero(1, 1e9)}`, fecha: dia(a, -5, 0), saldos, total: dinero(a), tipoCambio: a.prob(0.5) ? 1200 : undefined,
        esperado: a.prob(0.5) ? dinero(a) : null, diferencia: a.prob(0.5) ? dinero(a) : null, notas: a.prob(0.5) ? libre(a) : undefined, creadoEn: dia(a),
      } as never);
    },
  },
  {
    nombre: "traspasos", peso: 2,
    correr: (a, e, S) => {
      const procs = (e.procesadores as { id: string }[]);
      if (procs.length < 2) return NO;
      const ts = (e.traspasos ?? []) as { id: string; estado: string; gastoId?: string }[];
      const que = a.pick(["nuevo", "corregir", "marcar", "borrar", "puntas"]);
      if (que === "nuevo" || (!ts.length && que !== "puntas")) {
        const sale = dinero(a);
        const gasto = a.prob(0.5) ? { id: `gas_tra_${a.entero(1, 1e9)}`, categoria: "Comisiones bancarias", grupo: "operativo", concepto: "Pase", monto: 5, moneda: "USD", fecha: dia(a), recurrente: false, creadoEn: dia(a), extra: {} } : null;
        S.acciones.guardarTraspaso({
          id: `tra_${a.entero(1, 1e9)}`, fecha: dia(a, -9, 0), origenId: procs[0].id, destinoId: procs[1].id, montoSale: sale, monedaSale: "USD",
          montoLlega: sale - 5, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: dia(a),
          notas: a.prob(0.5) ? libre(a) : undefined,
        } as never, gasto as never);
      } else if (que === "corregir") {
        const t = a.pick(ts) as unknown as Record<string, unknown>;
        S.acciones.guardarTraspaso({ ...t, notas: a.prob(0.5) ? libre(a) : undefined, montoLlega: dinero(a) } as never, null);
      } else if (que === "marcar") {
        const t = a.pick(ts); S.acciones.marcarTraspaso(t.id, a.pick(["confirmado", "ignorado", "propuesto"]) as never);
      } else if (que === "borrar") S.acciones.borrarTraspaso(a.pick(ts).id);
      else {
        S.acciones.importarPuntas([{ lado: a.pick(["salida", "llegada"]), cuentaId: procs[0].id, otraCuentaId: procs[1].id, ref: `stripe:po_${a.entero(1, 1e6)}`, fecha: dia(a, -3, 0), monto: dinero(a), moneda: "USD", contraparte: "STRIPE", seguro: a.prob(0.5) } as never]);
      }
    },
  },

  /* ---------- Gastos fijos ---------- */
  {
    nombre: "gastosFijos", peso: 3,
    correr: (a, e, S) => {
      const ts = (e.gastosRecurrentes ?? []) as { id: string; proveedor?: string; cuentaId?: string; notas?: string; salteados: string[] }[];
      const que = a.pick(["nuevo", "corregir", "borrar", "aprobar", "saltear", "volver", "armar"]);
      if (que === "nuevo" || (!ts.length && !["armar"].includes(que))) {
        S.acciones.guardarGastoRecurrente({
          id: `rec_${a.entero(1, 1e9)}`, concepto: `Fijo ${a.entero(1, 999)}`, categoria: "Software", grupo: "operativo",
          proveedor: a.prob(0.6) ? libre(a) : undefined, monto: dinero(a), moneda: "USD", diaDelMes: a.entero(1, 28),
          cuentaId: a.prob(0.5) && e.procesadores.length ? a.pick(e.procesadores as { id: string }[]).id : undefined,
          notas: a.prob(0.4) ? libre(a) : undefined, activo: true, desde: "2026-10", salteados: [], creadoEn: dia(a),
        } as never);
      } else if (que === "corregir") {
        const t = a.pick(ts);
        S.acciones.guardarGastoRecurrente({ ...t, proveedor: a.prob(0.5) ? undefined : libre(a), notas: a.prob(0.5) ? undefined : libre(a), cuentaId: undefined, monto: dinero(a) } as never);
      } else if (que === "borrar") S.acciones.borrarGastoRecurrente(a.pick(ts).id);
      else if (que === "aprobar") S.acciones.aprobarGastosFijos(ts.slice(0, 3).map((t) => ({ id: t.id, mes: a.pick(["2026-10", "2026-11"]), monto: dinero(a) })));
      else if (que === "saltear") S.acciones.saltearGastoFijo(a.pick(ts).id, `2026-1${a.entero(0, 2)}`);
      else if (que === "volver") { const t = a.pick(ts); if (t.salteados[0]) S.acciones.volverAProponerGastoFijo(t.id, t.salteados[0]); else return NO; }
      else S.acciones.armarGastosFijos();
    },
  },

  /* ---------- Ventas, cobros y devoluciones ---------- */
  {
    nombre: "registrarVenta", peso: 3,
    correr: (a, e, S) => {
      const producto = uno(conId(e.productos), a) as { id: string };
      const closer = (e.equipo as { id: string; rol: string }[]).filter((m) => m.rol === "closer");
      if (producto === (NO as unknown) || !closer.length) return NO;
      const lead = a.prob(0.7) ? uno(conId(e.leads), a) as { id: string; nombre: string } : null;
      const nombre = lead && lead !== (NO as unknown) ? lead.nombre : persona(a);
      const precio = Math.round(dinero(a));
      const n = a.entero(1, 3);
      const vid = `ven_t${a.entero(1, 1e9)}`;
      const cuotas = Array.from({ length: n }, (_x, k) => ({
        id: `cuo_${vid}_${k}`, ventaId: vid, numero: k + 1, monto: k === n - 1 ? precio - Math.floor(precio / n) * (n - 1) : Math.floor(precio / n),
        vence: dia(a, k * 30, k * 30 + 5), estado: "pendiente", esReserva: false,
      }));
      const procs = (e.procesadores as { id: string }[]);
      const cobros = a.prob(0.6) ? [{ cuotaId: cuotas[0].id, monto: cuotas[0].monto, fecha: dia(a, -2, 0), procesadorId: a.pick(procs).id, referencia: a.prob(0.5) ? `ref${a.entero(1, 999)}` : undefined, pagador: a.prob(0.3) ? persona(a) : undefined }] : [];
      S.acciones.registrarVenta({
        venta: {
          id: vid, contactoId: lead && lead !== (NO as unknown) ? lead.id : undefined, contactoNombre: nombre, productoId: producto.id,
          precioAcordado: precio, moneda: "USD", closerId: a.pick(closer).id, excluidoMarketing: false, estado: "activa",
          fecha: dia(a, -3, 0), notas: a.prob(0.4) ? libre(a) : undefined, creadoEn: dia(a), extra: {},
        },
        cuotas: cuotas as never, cobros: cobros as never,
      } as never);
    },
  },
  {
    nombre: "registrarPago", peso: 3,
    correr: (a, e, S) => {
      const pend = (e.cuotas as { id: string; monto: number; estado: string; ventaId: string }[]).filter((c) => c.estado === "pendiente" && (e.ventas as { id: string; estado: string }[]).some((v) => v.id === c.ventaId && v.estado === "activa"));
      const c = uno(pend, a) as { id: string; monto: number };
      if (c === (NO as unknown)) return NO;
      const parte = a.prob(0.5) ? Math.round(c.monto * (0.3 + a.r() * 0.5) * 100) / 100 : c.monto;
      S.acciones.registrarPago({
        cuotaId: c.id, reajuste: a.pick(["repartir", "proxima", "pendiente"]),
        cobros: [{ monto: parte, fecha: dia(a, -2, 0), procesadorId: (a.pick(e.procesadores) as { id: string }).id, referencia: a.prob(0.5) ? `r${a.entero(1, 999)}` : undefined, tipoCambio: a.prob(0.3) ? 1100 : undefined, pagador: a.prob(0.4) ? persona(a) : undefined }] as never,
      });
    },
  },
  {
    nombre: "devoluciones", peso: 3,
    correr: (a, e, S) => {
      const ds = (e.devoluciones ?? []) as { id: string; estado: string }[];
      const que = a.pick(["registrar", "editar", "ignorar", "borrar", "reembolsos", "atar"]);
      const v = uno((e.ventas as { id: string; estado: string }[]).filter((x) => x.estado === "activa"), a) as { id: string };
      if (que === "registrar" || ds.length === 0) {
        if (v === (NO as unknown)) return NO;
        S.acciones.registrarDevolucion({
          ventaId: v.id, monto: dinero(a), fecha: dia(a, -5, 0), procesadorId: a.prob(0.6) ? (a.pick(e.procesadores) as { id: string }).id : undefined,
          montoArs: a.prob(0.2) ? 120000 : undefined, tipoCambio: a.prob(0.2) ? 1200 : undefined, noDescontarAlCloser: a.prob(0.3),
          motivo: a.prob(0.5) ? libre(a) : undefined, notas: a.prob(0.5) ? libre(a) : undefined, darDeBaja: a.prob(0.3), marcarLlamada: a.prob(0.3),
          referencia: a.prob(0.3) ? `stripe:re_${a.entero(1, 99999)}` : undefined, proveedor: "stripe",
        } as never);
      } else if (que === "editar") {
        const d = a.pick(ds);
        S.acciones.editarDevolucion(d.id, a.pick([{ motivo: undefined, notas: libre(a) }, { monto: dinero(a) }, { procesadorId: undefined }, { noDescontarAlCloser: true }, { comprobante: undefined, motivo: libre(a) }]) as never);
      } else if (que === "ignorar") S.acciones.ignorarDevolucion(a.pick(ds).id);
      else if (que === "borrar") S.acciones.borrarDevolucion(a.pick(ds).id);
      else if (que === "reembolsos") {
        S.acciones.importarReembolsos([{ proveedor: "stripe", referencia: `re_${a.entero(1, 99999)}`, referenciasCobro: [`pi_${a.entero(1, 99999)}`], monto: dinero(a), moneda: "USD", fecha: dia(a, -5, 0), clienteNombre: persona(a), motivo: "requested_by_customer" }] as never);
      } else {
        const prop = ds.filter((d) => d.estado === "propuesta"), conf = ds.filter((d) => d.estado === "confirmada");
        if (!prop.length || !conf.length) return NO;
        S.acciones.atarReembolsos([{ propuestaId: a.pick(prop).id, devolucionId: a.pick(conf).id }]);
      }
    },
  },
  {
    nombre: "editarPago", peso: 2,
    correr: (a, e, S) => {
      const p = uno(conId(e.pagos), a) as { id: string };
      if (p === (NO as unknown)) return NO;
      S.acciones.editarPago(p.id, a.pick([{ feeMonto: dinero(a) / 50 }, { pagador: persona(a) }, { cuit: "20-12345678-9" }, { tipoCambio: 1250 }, { tipoCambio: 0 }, { cvu: "0000 0031.000 123" }]) as never);
    },
  },
  {
    nombre: "chequearPago", peso: 2,
    correr: (a, e, S) => {
      const p = uno(conId(e.pagos), a) as { id: string };
      if (p === (NO as unknown)) return NO;
      const veredicto = a.pick(["chequeado", "rechazado", null] as const);
      S.acciones.chequearPago(p.id, { casillero: a.pick(["director", "finanzas"] as const), veredicto, nota: veredicto === "rechazado" ? `No coincide ${a.entero(1, 9)}` : undefined });
    },
  },
  {
    nombre: "cambiarComprobante",
    correr: (a, e, S) => {
      const p = uno(conId(e.pagos), a) as { id: string };
      if (p === (NO as unknown)) return NO;
      S.acciones.cambiarComprobante(p.id, { ruta: `comprobantes/${a.entero(1, 1e6)}.png`, nombre: "recibo.png", tipo: "image/png", tamanio: a.entero(1000, 9e5), subidoEn: dia(a) });
    },
  },

  /* ---------- Conciliación ---------- */
  {
    nombre: "conciliar+desconciliar", peso: 4,
    correr: (a, e, S) => {
      const mov = uno((e.movimientos as { id: string; estado: string; monto: number }[]).filter((m) => m.estado === "pendiente"), a) as { id: string; monto: number };
      const cuota = uno((e.cuotas as { id: string; estado: string; monto: number }[]).filter((c) => c.estado === "pendiente"), a) as { id: string; monto: number };
      if (mov !== (NO as unknown) && cuota !== (NO as unknown) && a.prob(0.7)) {
        const ok = S.acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: Math.min(mov.monto, cuota.monto) }]);
        if (ok && a.prob(0.6)) S.acciones.desconciliar(mov.id);
        return;
      }
      const conc = uno((e.movimientos as { id: string; estado: string }[]).filter((m) => m.estado === "conciliado"), a) as { id: string };
      if (conc === (NO as unknown)) return NO;
      S.acciones.desconciliar(conc.id);
    },
  },
  {
    nombre: "vincularConPagos",
    correr: (a, e, S) => {
      const movs = (e.movimientos as { id: string; estado: string }[]).filter((m) => m.estado === "pendiente");
      const pagos = (e.pagos as { id: string; movimientoId?: string }[]).filter((p) => !p.movimientoId);
      if (!movs.length || !pagos.length) return NO;
      S.acciones.vincularConPagos([{ movimientoId: a.pick(movs).id, pagoId: a.pick(pagos).id }]);
    },
  },
  {
    nombre: "marcarMovimiento",
    correr: (a, e, S) => {
      const m = uno(conId(e.movimientos), a) as { id: string };
      if (m === (NO as unknown)) return NO;
      S.acciones.marcarMovimiento(m.id, a.pick(["pendiente", "ignorado"]) as never);
    },
  },
  {
    nombre: "importarMovimientos",
    correr: (a, e, S) => {
      const procs = (e.procesadores as { id: string; proveedor?: string }[]).filter((p) => p.proveedor);
      if (!procs.length) return NO;
      const p = a.pick(procs);
      const repite = a.prob(0.3) && e.movimientos.length ? a.pick(e.movimientos as { referencia: string; proveedor: string }[]) : null;
      const monto = dinero(a);
      S.acciones.importarMovimientos([{
        proveedor: (repite?.proveedor ?? p.proveedor) as never, procesadorId: p.id, referencia: repite?.referencia ?? `ref_${a.entero(1, 1e9)}`,
        monto, moneda: "USD", fee: Math.round(monto * 3) / 100, neto: Math.round(monto * 97) / 100, fecha: dia(a, -4, 0),
        clienteNombre: a.prob(0.6) ? persona(a) : undefined, clienteEmail: a.prob(0.4) ? "x@ejemplo.test" : undefined, metodo: a.prob(0.3) ? "Tarjeta Visa" : undefined,
      }] as never, "csv");
    },
  },
  {
    nombre: "aplicarTasaDeCuenta",
    correr: (a, e, S) => {
      const p = uno(conId(e.procesadores), a) as { id: string };
      if (p === (NO as unknown)) return NO;
      S.acciones.actualizar("procesadores", p.id, { feeRate: Math.round(a.r() * 100) / 1000 } as never, "Cuenta");
      S.acciones.aplicarTasaDeCuenta(p.id);
    },
  },

  /* ---------- Equipo, honorarios, liquidaciones ---------- */
  {
    nombre: "equipo", peso: 2,
    correr: (a, e, S) => {
      const m = uno(conId(e.equipo), a) as Record<string, unknown>;
      if (m === (NO as unknown)) return NO;
      S.acciones.guardarMiembro(a.pick([{ ...m, puesto: libre(a) }, { ...m, email: correo(a, "eq") }, { ...m, activo: a.prob(0.5) }, { ...m, hasta: "" }, { id: `eq_${a.entero(1, 1e9)}`, nombre: persona(a), rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }]) as never);
    },
  },
  {
    nombre: "honorarios", peso: 2,
    correr: (a, e, S) => {
      const m = uno(conId(e.equipo), a) as { id: string };
      if (m === (NO as unknown)) return NO;
      S.acciones.guardarEsquema({
        id: `hon_${m.id}`, miembroId: m.id, categoriaGasto: "Equipo", actualizadoEn: "",
        conceptos: [{ id: `con_${a.entero(1, 99)}`, tipo: "fijo", nombre: "Sueldo", moneda: "USD", monto: dinero(a) }, ...(a.prob(0.5) ? [{ id: "con_p", tipo: "porcentaje", nombre: "Comisión", moneda: "USD", tasa: 0.05, base: "cash" }] : [])],
        /* FichaMiembro vacía «pendiente» con null (undefined no viaja): así lo hace la pantalla. */
        pendiente: a.prob(0.4) ? libre(a) : (null as never),
      } as never, "Yari");
    },
  },
  {
    nombre: "liquidaciones", peso: 2,
    correr: (a, e, S) => {
      const m = uno(conId(e.equipo), a) as { id: string };
      if (m === (NO as unknown)) return NO;
      const periodo = `2026-${String(a.entero(7, 11)).padStart(2, "0")}`;
      const liqs = (e.liquidaciones ?? []) as { id: string; estado: string; periodo: string }[];
      const que = a.pick(["extra", "guardar", "cerrar", "reabrir", "pagado", "quitar"]);
      const abierta = liqs.filter((l) => l.estado === "abierta"), cerradas = liqs.filter((l) => l.estado === "cerrada");
      if (que === "extra" || !liqs.length) {
        S.acciones.agregarExtraLiquidacion(periodo, { id: `ext_${a.entero(1, 1e9)}`, miembroId: m.id, concepto: libre(a) || "Adelanto", monto: -dinero(a), moneda: "USD", nota: a.prob(0.5) ? libre(a) : undefined, creadoEn: dia(a), creadoPor: "yari" });
      } else if (que === "guardar" && abierta.length) {
        const l = a.pick(abierta) as unknown as Record<string, unknown>;
        S.acciones.guardarLiquidacion({ ...l, tipoCambio: a.prob(0.5) ? 1200 : undefined, entradas: { [`${m.id}:x`]: { cantidad: a.entero(0, 9) } } } as never);
      } else if (que === "cerrar" && abierta.length) {
        const l = a.pick(abierta) as unknown as Record<string, unknown>;
        const g = { id: `gas_liq_${a.entero(1, 1e9)}`, categoria: "Equipo", grupo: "operativo", concepto: "Sueldos", monto: dinero(a), moneda: "USD", fecha: dia(a), recurrente: false, creadoEn: dia(a), extra: { liquidacionId: l.id } };
        S.acciones.cerrarLiquidacion(l as never, { personas: [], total: 1, fijo: 1, variable: 0, aPagar: {}, tipoCambio: 1200, profit: 0, calculadoEn: dia(a) } as never, a.prob(0.7) ? [g as never] : [], "Yari");
      } else if (que === "reabrir" && cerradas.length) S.acciones.reabrirLiquidacion(a.pick(cerradas) as never);
      else if (que === "pagado" && liqs.length) S.acciones.marcarPagado(a.pick(liqs) as never, m.id, a.prob(0.6), a.prob(0.5) ? "yari" : undefined);
      else if (que === "quitar" && liqs.length) { const l = a.pick(liqs) as unknown as { id: string; extras: { id: string }[] }; if (l.extras.length) S.acciones.quitarExtraLiquidacion(l.id, l.extras[0].id); else return NO; }
      else return NO;
    },
  },
  {
    nombre: "tiposDeCuenta",
    correr: (a, e, S) => {
      const tipos = (e.tiposCuenta ?? []) as { id: string }[];
      if (a.prob(0.5)) {
        S.acciones.guardarTipoCuenta({ id: `tipo_${a.entero(1, 99)}`, nombre: libre(a) || "Tipo", descripcion: libre(a), areas: { crm: "ver" }, soloLoSuyo: false, orden: 99 } as never, "tipo");
      } else if (tipos.length) S.acciones.borrarTipoCuenta(a.pick(tipos).id, "tipo");
      else return NO;
    },
  },
  {
    nombre: "reasignarCuotas",
    correr: (a, e, S) => {
      const cs = (e.cuotas as { id: string }[]);
      if (!cs.length) return NO;
      S.acciones.reasignarCuotas(Array.from({ length: a.entero(1, 3) }, () => a.pick(cs).id), a.prob(0.5) ? null : (a.pick(e.equipo) as { id: string }).id, "reasignar");
    },
  },
  {
    nombre: "atarVentasAWebinars",
    correr: (_a, _e, S) => { S.acciones.atarVentasAWebinars(); },
  },

  /* ---------- Catálogos, Meta y lo que llega de afuera ---------- */
  {
    nombre: "crear(catálogo)", peso: 2,
    correr: (a, e, S) => {
      const que = a.pick(["productos", "procesadores", "embudos", "equipo", "etapas", "campos", "webinars"]);
      if (que === "productos") S.acciones.crear("productos", { nombre: libre(a) || "Prod", precioLista: dinero(a), tipo: a.pick(["principal", "downsell", "upsell", "evento", "suscripcion"]), activo: true, orden: a.entero(0, 50) } as never, "Producto");
      else if (que === "procesadores") S.acciones.crear("procesadores", { nombre: libre(a) || "Cuenta", feeRate: Math.round(a.r() * 100) / 1000, activo: true, automatico: false, moneda: a.pick(["USD", "ARS"]), cajaOtros: a.prob(0.5) ? a.prob(0.5) : undefined, cuentasBancarias: a.prob(0.3) ? [{ titular: "T", banco: "B", numero: "1", alias: "a", cbu: "0".repeat(22), cuit: "20-1-2" }] : undefined } as never, "Cuenta");
      else if (que === "embudos") S.acciones.crear("embudos", { nombre: libre(a) || "Embudo", activo: true, orden: a.entero(0, 50), esWebinar: a.prob(0.3) } as never, "Embudo");
      else if (que === "equipo") S.acciones.crear("equipo", { nombre: persona(a), rol: a.pick(["closer", "director", "setter", "otro"]), comisionRate: Math.round(a.r() * 100) / 1000, activo: true, sinComision: false, email: a.prob(0.5) ? correo(a, "eq") : undefined, puesto: a.prob(0.5) ? libre(a) : undefined } as never, "Miembro");
      else if (que === "etapas") S.acciones.crear("etapas", { nombre: libre(a) || "Etapa", variante: "brand", probabilidad: a.entero(0, 100), orden: e.etapas.length, esGanada: a.prob(0.2) ? true : undefined } as never, "Etapa");
      else if (que === "campos") S.acciones.crear("campos", { entidad: "leads", nombre: libre(a) || "Campo", clave: `c_${a.entero(1, 1e6)}`, tipo: "texto", requerido: a.prob(0.5), ayuda: a.prob(0.5) ? libre(a) : undefined } as never, "Campo");
      else {
        const w = uno(conId(e.webinars), a) as Record<string, unknown>;
        if (w === (NO as unknown)) return NO;
        const { id: _id, ...resto } = w;
        void _id;
        S.acciones.crear("webinars", { ...resto, titulo: libre(a) || "Webinar", fecha: dia(a, 0, 20), estado: "programado" } as never, "Webinar");
      }
    },
  },
  {
    nombre: "actualizar(catálogo)", peso: 2,
    correr: (a, e, S) => {
      const que = a.pick(["productos", "procesadores", "embudos", "etapas", "campos"]);
      const fila = uno(conId(e[que]), a) as { id: string; nombre: string };
      if (fila === (NO as unknown)) return NO;
      const cambios = a.pick([{ nombre: libre(a) || "N" }, { activo: a.prob(0.5) }, { orden: a.entero(0, 80) }]);
      if (que === "etapas" && a.prob(0.3)) S.acciones.actualizarSilencioso("etapas", fila.id, { orden: a.entero(0, 9) } as never);
      else S.acciones.actualizar(que as never, fila.id, cambios as never, fila.nombre);
    },
  },
  {
    nombre: "importarMeta",
    correr: (a, _e, S) => {
      const n = a.entero(1, 3);
      const campaigns = Array.from({ length: n }, (_x, k) => ({ id: `m_c${k}_${a.entero(1, 5)}`, nombre: libre(a) || "Camp", objetivo: "LEADS", estado: "ACTIVE", desde: "2026-09-01" }));
      const adsets = campaigns.map((c, k) => ({ id: `m_s${k}`, campaignId: c.id, nombre: "Set", estado: "ACTIVE" }));
      const ads = adsets.map((s, k) => ({ id: `m_a${k}`, adsetId: s.id, campaignId: s.campaignId, nombre: "Ad", estado: "ACTIVE" }));
      const insights = ads.flatMap((ad) => ["2026-10-01", "2026-10-02"].map((dia0) => ({ adId: ad.id, dia: dia0, inversion: dinero(a), impresiones: a.entero(1, 9999), clicks: a.entero(0, 99), leads: a.entero(0, 9), alcance: 100, frecuencia: 1.2, ctr: 0.02, cpm: 5, cpc: 0.4, clicksEnlace: 10, ctrEnlace: 0.01, costoPorClickEnlace: 0.5, acciones: { lead: a.entero(0, 9) } })));
      S.acciones.importarMeta({ campaigns, adsets, ads, insights } as never);
    },
  },
  {
    nombre: "heredarDeFormulario",
    correr: (a, e, S) => {
      const c = uno(conId(e.contactos), a) as { id: string };
      if (c === (NO as unknown)) return NO;
      S.acciones.heredarDeFormulario(c.id, a.pick([{ telefono: "+54 9 11 5555-5555" }, { pais: "Uruguay", origenCanal: "webinar" }, { utm: { utm_source: "email" } }]) as never, "hereda");
    },
  },
  {
    nombre: "completarOrigenes",
    correr: (a, e, S) => {
      const vs = (e.ventas as { id: string }[]).slice(0, 5);
      if (!vs.length) return NO;
      S.acciones.completarOrigenes([{ id: a.pick(vs).id, cambios: { embudoId: a.pick(e.embudos as { id: string }[]).id, proyecto: "MENT" } as never }]);
    },
  },
  {
    nombre: "descartarAnuladosMercury",
    correr: (a, e, S) => {
      const ms = (e.movimientos as { referencia: string; proveedor: string; estado: string }[]).filter((m) => m.estado === "pendiente");
      if (!ms.length) return NO;
      S.acciones.descartarAnuladosMercury([a.pick(ms).referencia]);
    },
  },
  {
    nombre: "eliminar(sueltos)",
    correr: (a, e, S) => {
      /* Sólo lo que nadie referencia: la base rechaza (23503) borrar un lead con ventas. */
      const que = a.pick(["campos", "metas", "gastos", "reportes", "movimientos"]);
      const fila = uno(conId(e[que]), a) as { id: string; nombre?: string };
      if (fila === (NO as unknown)) return NO;
      if (que === "movimientos" && (e.pagos as { movimientoId?: string }[]).some((p) => p.movimientoId === fila.id)) return NO;
      if (que === "gastos" && ((e.traspasos ?? []) as { gastoId?: string }[]).some((t) => t.gastoId === fila.id)) return NO;
      S.acciones.eliminar(que as never, fila.id, fila.nombre ?? que);
    },
  },

  {
    nombre: "importarPlanilla", peso: 2,
    correr: (a, e, S) => {
      const productos = (e.productos as { nombre: string }[]), procs = (e.procesadores as { nombre: string }[]), closers = (e.equipo as { nombre: string; rol: string }[]).filter((m) => m.rol === "closer");
      if (!productos.length || !procs.length || !closers.length) return NO;
      let n = 2;
      const filas: FilaVentas[] = Array.from({ length: a.entero(1, 3) }, () => {
        const nombre = persona(a), email = correo(a, nombre), servicio = a.pick(productos).nombre, total = Math.round(dinero(a));
        const pagos = a.entero(1, 3);
        return Array.from({ length: pagos }, (_x, k): FilaVentas => ({
          fila: n++, fecha: `2026-0${a.entero(7, 9)}-${String(a.entero(1, 28)).padStart(2, "0")}T15:00:00.000Z`, nombre, email, pais: a.pick(["Argentina", "México", ""]), telefono: a.prob(0.5) ? `+54911${a.entero(10000000, 99999999)}` : "",
          vendedor: a.prob(0.2) ? persona(a) : a.pick(closers).nombre, servicio, proyecto: a.prob(0.5) ? "MENT" : "", estrategia: a.prob(0.5) ? "Webinar" : "",
          tipoPago: "Cuotas", plan: `${pagos} cuotas`, caracteristica: k === 0 && pagos > 1 ? "Reserva" : `Cuota #${k + 1}`, tipoVenta: k === 0 ? "Venta Nueva" : "Cuota",
          cuenta: a.prob(0.15) ? "Cuenta nueva de la planilla" : a.pick(procs).nombre, valorTotal: total, montoUsd: Math.round(total / pagos), chequeado: a.prob(0.5),
          montoArs: a.prob(0.3) ? 100000 : undefined, tipoCambio: a.prob(0.3) ? 1100 : undefined, pagador: a.prob(0.3) ? persona(a) : "", cuit: "", comprobante: a.prob(0.2) ? "https://drive.example/x" : "",
          observaciones: a.prob(0.3) ? libre(a) : "", setter: "", referidor: a.prob(0.2) ? persona(a) : "", referidorTelefono: "", ingresoComunidad: a.pick(["", "Si", "No"]),
        }));
      }).flat();
      S.acciones.importarPlanilla(armarImportacion(e, filas));
      /* La misma hoja otra vez: reimportar no duplica nada. */
      if (a.prob(0.5)) S.acciones.importarPlanilla(armarImportacion(JSON.parse(S.acciones.exportar()), filas));
    },
  },

  {
    nombre: "bajaDeVenta", peso: 2,
    correr: (a, e, S) => {
      const v = uno(conId(e.ventas), a) as { id: string; contactoNombre: string };
      if (v === (NO as unknown)) return NO;
      S.acciones.actualizar("ventas", v.id, { estado: a.pick(["cancelada", "reembolsada", "activa"]) } as never, v.contactoNombre);
    },
  },
  {
    nombre: "configurarCrm",
    correr: (a, e, S) => {
      const crm = { ...(e.ajustes.crm ?? {}), objeciones: ["Precio", libre(a) || "Tiempo"] };
      S.acciones.configurarCrm(crm as never, []);
    },
  },
];

/** Una acción al azar según su peso. */
export function elegir(a: Azar, lista: Accion[] = CATALOGO): Accion {
  const total = lista.reduce((n, x) => n + (x.peso ?? 1), 0);
  let t = a.r() * total;
  for (const x of lista) { t -= x.peso ?? 1; if (t <= 0) return x; }
  return lista[lista.length - 1];
}
