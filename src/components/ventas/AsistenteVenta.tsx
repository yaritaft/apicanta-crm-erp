"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, CornerDownLeft, Link2, Paperclip, Sparkles, UserPlus, X,
} from "lucide-react";
import { Badge, Button, Chip, IconButton, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import {
  agregarMedio, cobroNuevo, EditorCobros, problemaDeCobros, problemaDePasarelas, type CobroBorrador,
} from "@/components/cobros/EditorCobros";
import { disponibleDe } from "@/components/cobros/SelectorMovimiento";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, isoDia, money, pct } from "@/lib/format";
import { medioDeMovimiento, parecido, procesadorDeMovimiento } from "@/lib/conciliacion";
import { descartarComprobante } from "@/lib/comprobantes";
import type { Cuota, EstadoApp, Movimiento, Venta } from "@/lib/types";

/* ==================================================================
   Asistente de venta.

   Una pregunta por pantalla, como un formulario conversacional: el que
   carga no ve nunca veinte campos juntos, y cada respuesta cambia lo
   que se pregunta después. Enter avanza, Esc sale.

   La última parte es la que importa: una venta se cobra en cuotas, una
   cuota puede cobrarse con varios medios, y cada medio puede venir
   atado a un cobro real de una pasarela. Eso se decide acá, no después.
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
}

type PasoId = "cliente" | "producto" | "precio" | "equipo" | "origen" | "plan" | "cobros" | "resumen";

const PASOS: { id: PasoId; titulo: string }[] = [
  { id: "cliente",  titulo: "Cliente" },
  { id: "producto", titulo: "Producto" },
  { id: "precio",   titulo: "Precio" },
  { id: "equipo",   titulo: "Equipo" },
  { id: "origen",   titulo: "Origen" },
  { id: "plan",     titulo: "Plan de cobro" },
  { id: "cobros",   titulo: "Cobros" },
  { id: "resumen",  titulo: "Resumen" },
];

type Frecuencia = "mensual" | "quincenal" | "semanal";

interface Borrador {
  contactoId?: string;
  /* La persona no estaba cargada: se crea como lead inscripto recién al
     guardar la venta, así cancelar el asistente no deja un lead suelto. */
  crearContacto?: boolean;
  contactoNombre: string;
  contactoEmail: string;
  productoId: string;
  precioAcordado: number;
  precioTocado: boolean;
  closerId: string;
  directorId: string;
  embudoId: string;
  webinarId: string;
  fecha: string;
  excluidoMarketing: boolean;
  notas: string;
  reserva: number;
  cantidadCuotas: number;
  frecuencia: Frecuencia;
  primerVencimiento: string;
  cuotas: LineaCuota[];
  planTocado: boolean;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function sumar(xs: { monto: number }[]) {
  return redondear(xs.reduce((a, x) => a + x.monto, 0));
}

function sumarFecha(iso: string, frecuencia: Frecuencia, pasos: number): string {
  const d = new Date(iso);
  if (frecuencia === "mensual") d.setMonth(d.getMonth() + pasos);
  else d.setDate(d.getDate() + pasos * (frecuencia === "quincenal" ? 15 : 7));
  return d.toISOString();
}

/** Reparte el precio en cuotas parejas; el resto cae en la última. */
function armarPlan(b: Borrador): LineaCuota[] {
  const lineas: LineaCuota[] = [];
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

export function AsistenteVenta({ onCerrar, onListo, desdeMovimiento, cliente }: {
  onCerrar: () => void;
  onListo: (ventaId: string, nombre: string) => void;
  desdeMovimiento?: Movimiento;
  /* Abierto desde la ficha de alguien (upsell, renovación): el cliente ya
     está elegido y se arranca por el producto. */
  cliente?: { contactoId: string; nombre: string; email: string };
}) {
  const e = useEstado();
  const mon = e.ajustes.monedaBase;
  const M = useCallback((n: number, d = 0) => money(n, mon, d), [mon]);

  const [i, setI] = useState(cliente ? 1 : 0);
  const [b, setB] = useState<Borrador>(() => inicial(e, desdeMovimiento, cliente));
  const set = useCallback((cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios })), []);
  const mainRef = useRef<HTMLDivElement>(null);

  const paso = PASOS[i];

  /* El plan se rearma solo mientras nadie lo toque a mano. */
  useEffect(() => {
    setB((x) => {
      if (x.planTocado) return x;
      const nuevas = armarPlan(x);
      /* Los cobros ya cargados se conservan por posición. */
      const conCobros = nuevas.map((linea, k) => ({ ...linea, cobros: x.cuotas[k]?.cobros ?? [] }));
      return { ...x, cuotas: conCobros };
    });
  }, [b.precioAcordado, b.reserva, b.cantidadCuotas, b.frecuencia, b.primerVencimiento, b.fecha, b.planTocado]);

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

  const problema = useMemo(
    () => validar(paso.id, b, diferenciaPlan, { e, subiendo: subiendo.size }),
    [paso.id, b, diferenciaPlan, e, subiendo.size],
  );
  const puedeAvanzar = problema === null;

  const avanzar = useCallback(() => {
    if (!puedeAvanzar) return;
    setI((x) => Math.min(x + 1, PASOS.length - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, [puedeAvanzar]);

  const volver = useCallback(() => {
    setI((x) => Math.max(0, x - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  function guardar() {
    const ventaId = nuevoId("ven");
    let contactoId = b.contactoId;
    if (!contactoId && b.crearContacto && b.contactoNombre.trim()) {
      const ahora = new Date().toISOString();
      contactoId = acciones.altaDeLead({
        nombre: b.contactoNombre.trim(), email: b.contactoEmail.trim(), telefono: "", pais: "",
        fuente: b.webinarId ? "Webinar" : "", webinarId: b.webinarId || undefined,
        /* Compró: entra directo en la etapa ganada. */
        etapaId: e.etapas.find((x) => x.esGanada)?.id ?? e.etapas[0]?.id ?? "",
        monto: redondear(b.precioAcordado), moneda: mon,
        responsable: e.equipo.find((x) => x.id === b.closerId)?.nombre ?? "",
        etiquetas: [], creadoEn: ahora, actualizadoEn: ahora, extra: {},
      }, b.contactoNombre.trim());
    }
    const venta: Venta = {
      id: ventaId,
      contactoId,
      contactoNombre: b.contactoNombre.trim(),
      productoId: b.productoId || undefined,
      webinarId: b.webinarId || undefined,
      embudoId: b.embudoId || undefined,
      precioAcordado: redondear(b.precioAcordado),
      moneda: mon,
      closerId: b.closerId || undefined,
      directorId: sinComision ? undefined : (b.directorId || undefined),
      excluidoMarketing: b.excluidoMarketing || sinComision,
      estado: "activa",
      fecha: b.fecha,
      notas: b.notas,
      creadoEn: new Date().toISOString(),
      extra: {},
    };

    const cuotas: Cuota[] = b.cuotas.map((c) => ({
      id: c.id, ventaId, numero: c.numero, monto: redondear(c.monto),
      vence: c.vence, estado: "pendiente", esReserva: c.esReserva,
    }));

    const cobros = b.cuotas.flatMap((c) =>
      c.cobros.filter((p) => p.monto > 0).map((p) => ({
        cuotaId: c.id,
        procesadorId: p.procesadorId || undefined,
        monto: redondear(p.monto),
        fecha: p.fecha,
        referencia: p.referencia,
        movimientoId: p.movimientoId,
        comprobante: p.comprobante,
      })),
    );

    acciones.registrarVenta({ venta, cuotas, cobros });
    onListo(ventaId, venta.contactoNombre);
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

  const progreso = ((i + (puedeAvanzar ? 1 : 0.35)) / PASOS.length) * 100;

  return (
    <div className="asistente" role="dialog" aria-modal="true" aria-label="Nueva venta">
      <div className="asistente__progreso">
        <div className="asistente__progreso-fill" style={{ width: `${progreso}%` }} />
      </div>

      <div className="asistente__head">
        <span className="asistente__paso-n">{i + 1} / {PASOS.length}</span>
        <span className="asistente__ruta">
          {PASOS.map((p, k) => (
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
          {paso.id === "cliente" && <PasoCliente b={b} set={set} e={e} />}
          {paso.id === "producto" && <PasoProducto b={b} set={set} e={e} M={M} />}
          {paso.id === "precio" && <PasoPrecio b={b} set={set} e={e} M={M} />}
          {paso.id === "equipo" && <PasoEquipo b={b} set={set} e={e} sinComision={sinComision} />}
          {paso.id === "origen" && <PasoOrigen b={b} set={set} e={e} />}
          {paso.id === "plan" && <PasoPlan b={b} setB={setB} M={M} diferencia={diferenciaPlan} />}
          {paso.id === "cobros" && <PasoCobros b={b} setB={setB} e={e} M={M} onSubiendo={onSubiendo} />}
          {paso.id === "resumen" && (
            <PasoResumen b={b} set={set} e={e} M={M} sinComision={sinComision} totalCobrado={totalCobrado} />
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
          <Button variante="primary" icono={<Check size={16} />} onClick={guardar} disabled={!puedeAvanzar}>Registrar la venta</Button>
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
  const producto = e.productos.find((p) => p.activo);
  const b: Borrador = {
    contactoId: cliente?.contactoId,
    contactoNombre: cliente?.nombre ?? mov?.clienteNombre ?? "",
    contactoEmail: cliente?.email ?? mov?.clienteEmail ?? "",
    productoId: producto?.id ?? "",
    precioAcordado: mov?.monto ?? producto?.precioLista ?? 0,
    precioTocado: Boolean(mov),
    closerId: "",
    directorId: e.equipo.find((x) => x.rol === "director")?.id ?? "",
    embudoId: e.embudos.find((x) => x.activo)?.id ?? "",
    webinarId: "",
    fecha: mov?.fecha ?? hoy,
    excluidoMarketing: false,
    notas: "",
    reserva: 0,
    cantidadCuotas: 1,
    frecuencia: "mensual",
    primerVencimiento: mov?.fecha ?? hoy,
    cuotas: [],
    planTocado: false,
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

/* ---------- Validación por paso ---------- */

function validar(paso: PasoId, b: Borrador, diferencia: number, ctx: { e: EstadoApp; subiendo: number }): string | null {
  switch (paso) {
    case "cliente":
      return b.contactoNombre.trim().length >= 2 ? null : "Escribí el nombre del cliente";
    case "producto":
      return b.productoId ? null : "Elegí un producto";
    case "precio":
      return b.precioAcordado > 0 ? null : "El precio tiene que ser mayor a cero";
    case "equipo":
      return b.closerId ? null : "Decí quién cerró la venta";
    case "origen":
      return b.embudoId ? null : "Elegí el embudo";
    case "plan":
      if (Math.abs(diferencia) > 0.5) {
        return diferencia > 0
          ? `Las cuotas suman ${diferencia.toFixed(2)} menos que el precio`
          : `Las cuotas suman ${Math.abs(diferencia).toFixed(2)} de más`;
      }
      return null;
    case "cobros":
    case "resumen": {
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

function Opcion({ tecla, nombre, sub, activo, onClick }: {
  tecla?: string; nombre: string; sub?: string; activo: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className="opcion" aria-pressed={activo} onClick={onClick}>
      {tecla && <span className="opcion__tecla">{tecla}</span>}
      <span className="opcion__texto">
        <span className="opcion__nombre">{nombre}</span>
        {sub && <span className="opcion__sub">{sub}</span>}
      </span>
      {activo && <Check size={16} style={{ marginLeft: "auto", color: "var(--brand)" }} />}
    </button>
  );
}

/* ---------- Paso 1: cliente ---------- */

function PasoCliente({ b, set, e }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp }) {
  const q = b.contactoNombre.trim().toLowerCase();
  const sugeridos = useMemo(() => {
    if (q.length < 2) return [];
    return e.leads
      .filter((l) => l.nombre.toLowerCase().includes(q) || l.email.toLowerCase().includes(q))
      .slice(0, 5);
  }, [e.leads, q]);

  return (
    <>
      <Pregunta texto="¿Quién compró?" sub="Escribí el nombre. Si ya está cargado como lead, elegilo de la lista y la venta queda pegada a su historia." />
      <Input
        value={b.contactoNombre}
        onChange={(ev) => set({ contactoNombre: ev.target.value, contactoId: undefined })}
        placeholder="Martín Quiroga"
        autoFocus
      />
      {b.contactoId && (
        <div className="row-wrap">
          <Badge variante="brand"><Link2 size={13} />Vinculado a un lead</Badge>
          <span className="t-sm t-subtle">{b.contactoEmail}</span>
        </div>
      )}
      {b.crearContacto && !b.contactoId && (
        <div className="stack-2">
          <div className="row-wrap">
            <Badge variante="accent"><UserPlus size={13} />Contacto nuevo: se crea al guardar la venta</Badge>
            <button type="button" className="link t-sm" onClick={() => set({ crearContacto: false })}>Deshacer</button>
          </div>
          <Input
            type="email" value={b.contactoEmail} placeholder="Su email (opcional)"
            onChange={(ev) => set({ contactoEmail: ev.target.value })}
          />
        </div>
      )}
      {!b.contactoId && q.length >= 2 && (sugeridos.length > 0 || !b.crearContacto) && (
        <div className="stack-2">
          {sugeridos.length > 0 && <span className="t-label">Leads que coinciden</span>}
          {/* En lista, uno por renglón: en grilla, el nombre y el mail
              quedaban cortados y costaba leer cuál era cuál. */}
          <div className="opciones opciones--lista">
            {sugeridos.map((l) => (
              <Opcion
                key={l.id} nombre={l.nombre} sub={l.email} activo={false}
                onClick={() => set({ contactoId: l.id, contactoNombre: l.nombre, contactoEmail: l.email, crearContacto: false })}
              />
            ))}
            {!b.crearContacto && !sugeridos.some((l) => l.nombre.trim().toLowerCase() === q) && (
              <Opcion
                nombre={`Crear «${b.contactoNombre.trim()}» como contacto nuevo`}
                sub="No está cargado: queda como lead inscripto, pegado a esta venta"
                activo={false} onClick={() => set({ crearContacto: true })}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Paso 2: producto ---------- */

function PasoProducto({ b, set, e, M }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; M: (n: number, d?: number) => string;
}) {
  const productos = e.productos.filter((p) => p.activo);
  return (
    <>
      <Pregunta texto="¿Qué le vendiste?" sub="El precio de lista se carga solo; en el próximo paso lo ajustás a lo que cerró el closer." />
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

/* ---------- Paso 3: precio ---------- */

function PasoPrecio({ b, set, e, M }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; M: (n: number, d?: number) => string;
}) {
  const producto = e.productos.find((p) => p.id === b.productoId);
  const lista = producto?.precioLista ?? 0;
  const dif = b.precioAcordado - lista;
  const atajos = [...new Set([lista, Math.round(lista * 0.9), Math.round(lista * 0.8), 500].filter((x) => x > 0))];

  return (
    <>
      <Pregunta texto="¿A cuánto lo cerró?" sub={lista > 0 ? `El precio de lista de ${producto?.nombre} es ${M(lista)}.` : undefined} />
      <div className="monto-grande">
        <span className="monto-grande__signo">US$</span>
        <input
          type="number" min={0} step="1" inputMode="decimal"
          value={b.precioAcordado || ""}
          onChange={(ev) => set({ precioAcordado: Number(ev.target.value), precioTocado: true })}
          aria-label="Precio cerrado"
        />
      </div>
      <div className="row-wrap">
        {atajos.map((n) => (
          <Chip key={n} activo={b.precioAcordado === n} onClick={() => set({ precioAcordado: n, precioTocado: true })}>
            {M(n)}
          </Chip>
        ))}
      </div>
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

/* ---------- Paso 4: equipo ---------- */

function PasoEquipo({ b, set, e, sinComision }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; sinComision: boolean;
}) {
  const closers = e.equipo.filter((x) => x.activo && (x.rol === "closer" || x.rol === "ceo"));
  const directores = e.equipo.filter((x) => x.rol === "director");
  return (
    <>
      <Pregunta texto="¿Quién la cerró?" sub="De acá salen las comisiones: el closer cobra sobre lo que entra, neto de procesador." />
      <div className="opciones">
        {closers.map((x, k) => (
          <Opcion
            key={x.id} tecla={String(k + 1)} nombre={x.nombre}
            sub={x.sinComision ? "No comisiona nadie" : `Comisión ${pct(x.comisionRate * 100, 0)}`}
            activo={b.closerId === x.id}
            onClick={() => set({ closerId: b.closerId === x.id ? "" : x.id })}
          />
        ))}
      </div>

      {sinComision ? null : (
        <div className="stack-2">
          <span className="t-label">Director</span>
          <div className="opciones">
            {directores.map((x) => (
              <Opcion
                key={x.id} nombre={x.nombre} sub={`Comisión ${pct(x.comisionRate * 100, 0)}`}
                activo={b.directorId === x.id}
                onClick={() => set({ directorId: b.directorId === x.id ? "" : x.id })}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Paso 5: origen ---------- */

function PasoOrigen({ b, set, e }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp }) {
  const webinars = [...e.webinars].sort((a, c) => +new Date(c.fecha) - +new Date(a.fecha)).slice(0, 12);
  return (
    <>
      <Pregunta texto="¿De dónde salió?" sub="Sin esto el profit por webinar y el costo de adquisición salen mal." />
      <div className="opciones">
        {e.embudos.filter((x) => x.activo).map((x, k) => (
          <Opcion key={x.id} tecla={String(k + 1)} nombre={x.nombre} activo={b.embudoId === x.id} onClick={() => set({ embudoId: x.id })} />
        ))}
      </div>
      <div className="stack-2">
        <span className="t-label">Webinar de origen</span>
        <Select
          value={b.webinarId} placeholder="Sin atribuir"
          onChange={(ev) => set({ webinarId: ev.target.value })}
          opciones={webinars.map((w) => ({ valor: w.id, texto: `${w.titulo} — ${fechaLarga(w.fecha)}` }))}
        />
      </div>
      <div className="stack-2">
        <span className="t-label">Fecha de la venta</span>
        <Input
          type="date" value={isoDia(b.fecha)}
          onChange={(ev) => set({ fecha: new Date(ev.target.value + "T12:00:00").toISOString(), primerVencimiento: new Date(ev.target.value + "T12:00:00").toISOString() })}
        />
      </div>
    </>
  );
}

/* ---------- Paso 6: plan de cobro ---------- */

function PasoPlan({ b, setB, M, diferencia }: {
  b: Borrador;
  setB: React.Dispatch<React.SetStateAction<Borrador>>;
  M: (n: number, d?: number) => string; diferencia: number;
}) {
  const editarCuota = (id: string, cambios: Partial<LineaCuota>) =>
    setB((x) => ({ ...x, planTocado: true, cuotas: x.cuotas.map((c) => (c.id === id ? { ...c, ...cambios } : c)) }));

  const rehacer = () => setB((x) => ({ ...x, planTocado: false }));

  return (
    <>
      <Pregunta texto="¿Cómo lo va a pagar?" sub="La reserva es una cuota más. Después podés mover monto y fecha de cualquiera." />

      <div className="row-wrap">
        {[1, 2, 3, 4, 6].map((n) => (
          <Chip key={n} activo={b.cantidadCuotas === n && !b.planTocado}
            onClick={() => setB((x) => ({ ...x, cantidadCuotas: n, planTocado: false }))}>
            {n === 1 ? "Un solo pago" : `${n} cuotas`}
          </Chip>
        ))}
      </div>

      <div className="form-grid">
        <div className="hk-field">
          <label className="hk-label">Reserva</label>
          <Input type="number" min={0} value={b.reserva || ""} placeholder="0"
            onChange={(ev) => setB((x) => ({ ...x, reserva: Number(ev.target.value), planTocado: false }))} />
          <span className="hk-help">Lo que dejó de seña el día que cerró.</span>
        </div>
        {/* Con un solo pago no hay nada que espaciar. */}
        {b.cantidadCuotas > 1 && (
          <div className="hk-field">
            <label className="hk-label">Frecuencia</label>
            <Select value={b.frecuencia}
              onChange={(ev) => setB((x) => ({ ...x, frecuencia: ev.target.value as Frecuencia, planTocado: false }))}
              opciones={[
                { valor: "mensual", texto: "Mensual" },
                { valor: "quincenal", texto: "Quincenal" },
                { valor: "semanal", texto: "Semanal" },
              ]} />
          </div>
        )}
      </div>

      <div className="stack-2">
        <div className="row">
          <span className="t-label">El plan queda así</span>
          {b.planTocado && (
            <Button sm variante="ghost" className="spacer" onClick={rehacer}>Rehacer parejo</Button>
          )}
        </div>
        {b.cuotas.map((c) => (
          <div className="cuota-linea" key={c.id}>
            <span className="cuota-linea__nombre">
              {c.esReserva ? "Reserva" : `Cuota ${c.numero}`}
              {c.esReserva && <Badge variante="info">seña</Badge>}
            </span>
            <Input type="number" min={0} step="0.01" value={c.monto}
              onChange={(ev) => editarCuota(c.id, { monto: Number(ev.target.value) })} aria-label="Monto" />
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
          <Button sm variante="secondary" onClick={rehacer}>Repartir de nuevo el precio entero</Button>
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
  const procesadores = e.procesadores.filter((p) => p.activo);

  /* Lo que usan de cada pago de pasarela los cobros de las OTRAS cuotas. */
  const usadoFuera = useCallback((cuotaId?: string) => {
    const usado = new Map<string, number>();
    for (const c of b.cuotas) {
      if (c.id === cuotaId) continue;
      for (const p of c.cobros) if (p.movimientoId) usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
    }
    return usado;
  }, [b.cuotas]);

  /* Pagos de pasarela sin conciliar que parecen de este cliente. */
  const candidatos = useMemo(() => {
    const usado = usadoFuera();
    return e.movimientos
      .filter((m) => m.estado === "pendiente" && disponibleDe(m, e.pagos, usado) > 0.009)
      .map((m) => {
        const porNombre = parecido(m.clienteNombre, b.contactoNombre);
        const porMail = b.contactoEmail && m.clienteEmail
          && m.clienteEmail.toLowerCase() === b.contactoEmail.toLowerCase() ? 1 : 0;
        return { m, afinidad: Math.max(porNombre, porMail) };
      })
      .filter((x) => x.afinidad >= 0.5)
      .sort((x, y) => y.afinidad - x.afinidad)
      .slice(0, 6)
      .map((x) => x.m);
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
        texto="¿Algo de esto ya entró?"
        sub="Marcá lo que ya se cobró. Cada cobro se prueba conciliándolo con el pago que llegó a la pasarela o subiendo el comprobante. Lo que no se cobró queda en Por cobrar."
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
                    opciones={b.cuotas.map((c) => ({
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

/* ---------- Paso 8: resumen ---------- */

function PasoResumen({ b, set, e, M, sinComision, totalCobrado }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp;
  M: (n: number, d?: number) => string; sinComision: boolean; totalCobrado: number;
}) {
  const producto = e.productos.find((p) => p.id === b.productoId);
  const closer = e.equipo.find((x) => x.id === b.closerId);
  const director = e.equipo.find((x) => x.id === b.directorId);
  const embudo = e.embudos.find((x) => x.id === b.embudoId);
  const webinar = e.webinars.find((x) => x.id === b.webinarId);
  const conciliados = b.cuotas.flatMap((c) => c.cobros).filter((p) => p.movimientoId).length;

  return (
    <>
      <Pregunta texto="Así queda la venta" sub="Revisá y confirmá. Después se puede editar todo desde la ficha." />

      <dl className="dl">
        <dt>Cliente</dt><dd>{b.contactoNombre}</dd>
        <dt>Producto</dt><dd>{producto?.nombre ?? "—"}</dd>
        <dt>Precio</dt><dd className="t-num">{M(b.precioAcordado, 2)}</dd>
        <dt>Closer</dt><dd>{closer?.nombre ?? "—"}{sinComision && <span className="t-subtle"> · no comisiona nadie</span>}</dd>
        {!sinComision && <><dt>Director</dt><dd>{director?.nombre ?? "—"}</dd></>}
        <dt>Origen</dt><dd>{embudo?.nombre ?? "—"}{webinar ? ` · ${webinar.titulo}` : ""}</dd>
        <dt>Fecha</dt><dd>{fechaLarga(b.fecha)}</dd>
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
                {cobrado >= c.monto - 0.01
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

      <div className="row-3">
        <Switch checked={b.excluidoMarketing || sinComision} etiqueta="Excluida de marketing"
          onChange={(v) => set({ excluidoMarketing: v })} />
        <span className="t-body t-muted">
          <strong>Excluida de marketing</strong> — el growth partner no comisiona esta venta
          {sinComision && <span className="t-subtle"> (se marca sola con este closer)</span>}
        </span>
      </div>

      <div className="hk-field">
        <label className="hk-label">Notas</label>
        <Textarea rows={2} value={b.notas} onChange={(ev) => set({ notas: ev.target.value })}
          placeholder="Lo que haya que recordar de esta venta" />
      </div>
    </>
  );
}
