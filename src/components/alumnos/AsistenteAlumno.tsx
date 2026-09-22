"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Info, Link2, Search } from "lucide-react";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { Badge, Chip, Field, Input, Textarea } from "@/components/ui/ui";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { acciones, useEstado } from "@/lib/store";
import {
  alumnoDeVenta, cohortesRecientes, cuotaMensualDeVenta, etapaInicialDeServicio, etapasDeServicio,
  opcionesDePlan, personaDeVenta, planDeVenta,
} from "@/lib/alumnos";
import { claveEmail, lleno } from "@/lib/contactos";
import { fechaLarga, isoDia, money } from "@/lib/format";
import type { Alumno, EstadoAlumno, EstadoApp, Moneda, Venta } from "@/lib/types";
import { BadgeEtapa, ESTADO_ALUMNO, ESTADOS_ALUMNO } from "./comun";

/* ==================================================================
   Alta de alumno, una pregunta por pantalla (el mismo formato que la
   venta). Lo primero es si viene de una venta: casi siempre sí, y en ese
   caso el nombre, el mail, el plan, la cuota y la fecha salen de ahí.

   Desde que registrar una venta crea el alumno solo, esto queda para las
   ventas de antes y para quien no pasó por Ventas. Por eso la búsqueda
   marca las ventas que ya tienen alumno y lleva a su ficha en vez de
   dejar cargarlo dos veces.
   ================================================================== */

type PasoId = "origen" | "persona" | "plan" | "cuota" | "etapa" | "notas";

const PASOS: { id: PasoId; titulo: string }[] = [
  { id: "origen", titulo: "Venta" },
  { id: "persona", titulo: "Persona" },
  { id: "plan", titulo: "Plan" },
  { id: "cuota", titulo: "Cuota" },
  { id: "etapa", titulo: "Etapa" },
  { id: "notas", titulo: "Notas" },
];

interface Borrador {
  modo: "venta" | "manual" | null;
  ventaId?: string;
  leadId?: string;
  busca: string;
  nombre: string;
  email: string;
  pais: string;
  plan: string;
  cohorte: string;
  cuotaMensual: number;
  moneda: Moneda;
  inicio: string;
  etapaServicioId: string;
  estado: EstadoAlumno;
  notas: string;
  extra: Record<string, unknown>;
}

/* Lo que sale de una venta. Se vuelve a esto al pasar a "a mano" después de
   haber elegido una, para no crear a alguien con los datos de otro. */
function datosVacios(e: EstadoApp): Pick<Borrador, "nombre" | "email" | "pais" | "plan" | "cuotaMensual" | "moneda" | "inicio"> {
  return {
    nombre: "", email: "", pais: "",
    plan: e.ajustes.planes[0] ?? "",
    cuotaMensual: 0, moneda: e.ajustes.monedaBase, inicio: new Date().toISOString(),
  };
}

function inicial(e: EstadoApp): Borrador {
  return {
    modo: null, busca: "", cohorte: "",
    ...datosVacios(e),
    etapaServicioId: etapaInicialDeServicio(e) ?? "",
    estado: "activo", notas: "", extra: {},
  };
}

/* Sin mayúsculas ni tildes: "Benitez" encuentra a "Benítez". */
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function describirVenta(e: EstadoApp, v: Venta): string {
  const producto = planDeVenta(e, v) || "Sin producto";
  const estado = v.estado === "cancelada" ? " · cancelada" : v.estado === "reembolsada" ? " · reembolsada" : "";
  return `${producto} · ${money(v.precioAcordado, v.moneda)} · ${fechaLarga(v.fecha)}${estado}`;
}

function validar(paso: PasoId, b: Borrador, e: EstadoApp): string | null {
  switch (paso) {
    case "origen":
      if (!b.modo) return "Elegí una opción";
      return b.modo === "venta" && !b.ventaId ? "Elegí la venta de la lista" : null;
    case "persona":
      if (b.nombre.trim().length < 2) return "Escribí el nombre";
      return b.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()) ? "Revisá el mail" : null;
    case "plan":
      return b.plan.trim() ? null : "Elegí el plan";
    case "cuota":
      if (!Number.isFinite(b.cuotaMensual) || b.cuotaMensual < 0) return "La cuota no puede ser negativa";
      return Number.isNaN(new Date(b.inicio).getTime()) ? "Poné la fecha de inicio" : null;
    case "etapa":
      return b.etapaServicioId || e.etapasServicio.length === 0 ? null : "Elegí la etapa";
    case "notas": {
      const falta = e.campos.find((c) => c.entidad === "alumno" && c.requerido && !lleno(b.extra[c.clave]));
      return falta ? `Completá «${falta.nombre}»` : null;
    }
  }
}

export function AsistenteAlumno({ onCerrar, onListo, onAbrirAlumno }: {
  onCerrar: () => void;
  onListo: (alumnoId: string, nombre: string) => void;
  /* Para ir a la ficha de alguien que ya es alumno en vez de duplicarlo. */
  onAbrirAlumno: (alumnoId: string) => void;
}) {
  const e = useEstado();
  const [i, setI] = useState(0);
  const [b, setB] = useState<Borrador>(() => inicial(e));
  const set = useCallback((cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios })), []);
  const creado = useRef(false);

  const paso = PASOS[i];
  const problema = useMemo(() => validar(paso.id, b, e), [paso.id, b, e]);
  const venta = b.ventaId ? e.ventas.find((v) => v.id === b.ventaId) : undefined;

  function elegirVenta(v: Venta) {
    const p = personaDeVenta(e, v);
    set({
      ventaId: v.id, leadId: v.contactoId, busca: v.contactoNombre,
      nombre: p.nombre, email: p.email, pais: p.pais,
      plan: planDeVenta(e, v) || b.plan,
      cuotaMensual: cuotaMensualDeVenta(e.cuotas.filter((c) => c.ventaId === v.id)),
      moneda: v.moneda, inicio: v.fecha,
    });
  }

  function aMano() {
    set({
      modo: "manual", ventaId: undefined, leadId: undefined,
      ...(b.ventaId ? datosVacios(e) : {}),
    });
  }

  function crear() {
    /* Enter dos veces rápido no puede crear dos alumnos. */
    if (creado.current) return;
    creado.current = true;
    const nombre = b.nombre.trim();
    const id = acciones.crear<Alumno>("alumnos", {
      nombre, email: b.email.trim(), pais: b.pais.trim() || undefined,
      cohorte: b.cohorte.trim(), plan: b.plan.trim(),
      cuotaMensual: Math.round(b.cuotaMensual * 100) / 100, moneda: b.moneda,
      estado: b.estado, inicio: b.inicio, progreso: 0,
      leadId: b.leadId, notas: b.notas.trim(), creadoEn: new Date().toISOString(), extra: b.extra,
      etapaServicioId: b.etapaServicioId || undefined, ventaId: b.ventaId,
    }, nombre);
    onListo(id, nombre);
  }

  return (
    <Asistente
      etiqueta="Nuevo alumno" pasos={PASOS} actual={i} onCambiarPaso={setI}
      problema={problema} onCerrar={onCerrar}
      terminarTexto="Crear alumno" onTerminar={crear}
    >
      {paso.id === "origen" && (
        <PasoOrigen
          b={b} set={set} e={e} venta={venta}
          onElegirVenta={elegirVenta} onManual={aMano} onAbrirAlumno={onAbrirAlumno}
        />
      )}
      {paso.id === "persona" && <PasoPersona b={b} set={set} e={e} onAbrirAlumno={onAbrirAlumno} />}
      {paso.id === "plan" && <PasoPlan b={b} set={set} e={e} venta={venta} />}
      {paso.id === "cuota" && <PasoCuota b={b} set={set} e={e} venta={venta} />}
      {paso.id === "etapa" && <PasoEtapa b={b} set={set} e={e} />}
      {paso.id === "notas" && <PasoNotas b={b} set={set} e={e} venta={venta} />}
    </Asistente>
  );
}

/* ---------- Paso 1: ¿viene de una venta? ---------- */

function PasoOrigen({ b, set, e, venta, onElegirVenta, onManual, onAbrirAlumno }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; venta?: Venta;
  onElegirVenta: (v: Venta) => void; onManual: () => void; onAbrirAlumno: (id: string) => void;
}) {
  const q = normal(b.busca.trim());

  /* Sin texto: las ventas más nuevas que todavía no tienen alumno, que son
     las que casi seguro se vienen a cargar. Con texto: todas las que
     coinciden, marcando las que ya son alumno. */
  const resultados = useMemo(() => {
    const todas = [...e.ventas].sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha));
    if (!q) {
      return todas
        .map((v) => ({ v, alumno: alumnoDeVenta(e, v) }))
        .filter((x) => !x.alumno)
        .slice(0, 6);
    }
    return todas
      .filter((v) => normal(v.contactoNombre).includes(q) || normal(personaDeVenta(e, v).email).includes(q))
      .slice(0, 8)
      .map((v) => ({ v, alumno: alumnoDeVenta(e, v) }));
  }, [e, q]);

  const primeraLibre = resultados.find((x) => !x.alumno)?.v;

  return (
    <>
      <Pregunta
        texto="¿Viene de una venta?"
        sub="Si la venta ya está cargada, enlazala: el nombre, el mail, el plan, la cuota y la fecha de inicio salen de ahí."
      />
      <div className="opciones">
        <Opcion
          tecla="1" nombre="Sí, de una venta" sub="La busco por el nombre del cliente"
          activo={b.modo === "venta"} onClick={() => set({ modo: "venta" })}
        />
        <Opcion
          tecla="2" nombre="No, lo cargo a mano" sub="Alguien que no pasó por Ventas"
          activo={b.modo === "manual"} onClick={onManual}
        />
      </div>

      {b.modo === "venta" && (
        <div className="stack-3">
          <Input
            icono={<Search size={18} />} value={b.busca} autoFocus
            onChange={(ev) => set({ busca: ev.target.value })}
            placeholder="Nombre del cliente…" aria-label="Buscar la venta por el nombre del cliente"
            onKeyDown={(ev) => {
              /* Enter con la búsqueda escrita elige la primera venta libre;
                 con una ya elegida, sigue de largo (lo maneja el asistente). */
              if (ev.key === "Enter" && !b.ventaId && primeraLibre) {
                ev.preventDefault();
                onElegirVenta(primeraLibre);
              }
            }}
          />
          {venta && (
            <div className="row-wrap">
              <Badge variante="brand" icono={<Link2 size={13} />}>Enlazada</Badge>
              <span className="t-sm">{venta.contactoNombre}</span>
              <span className="t-sm t-subtle">{describirVenta(e, venta)}</span>
            </div>
          )}
          <div className="stack-2">
            <span className="t-label">{q ? "Ventas que coinciden" : "Ventas recientes sin alumno"}</span>
            {resultados.length === 0 ? (
              <p className="t-sm t-subtle">
                {e.ventas.length === 0
                  ? "Todavía no hay ventas cargadas. Registrá la venta en Ventas (el alumno nace solo) o cargalo a mano."
                  : q
                    ? "No hay ninguna venta con ese nombre. Revisá cómo está escrito, o cargalo a mano."
                    : "Todas las ventas ya tienen su alumno. Buscá por nombre si querés ver una en particular."}
              </p>
            ) : (
              /* Una por renglón: el nombre, el producto y la fecha se leen
                 enteros, que es lo que distingue dos ventas parecidas. */
              <div className="opciones opciones--lista">
                {resultados.map(({ v, alumno }) => (
                  alumno ? (
                    <Opcion
                      key={v.id} nombre={v.contactoNombre} activo={false}
                      sub={`${describirVenta(e, v)} · ya es alumno: abrir su ficha`}
                      onClick={() => onAbrirAlumno(alumno.id)}
                    />
                  ) : (
                    <Opcion
                      key={v.id} nombre={v.contactoNombre} activo={b.ventaId === v.id}
                      sub={describirVenta(e, v)} onClick={() => onElegirVenta(v)}
                    />
                  )
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Paso 2: la persona ---------- */

function PasoPersona({ b, set, e, onAbrirAlumno }: {
  b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; onAbrirAlumno: (id: string) => void;
}) {
  /* El mismo mail ya es alumno: casi siempre es la misma persona. No se
     bloquea (puede ser un mail compartido), pero se avisa antes de crear. */
  const repetido = useMemo(() => {
    const k = claveEmail(b.email);
    return k ? e.alumnos.find((a) => claveEmail(a.email) === k) : undefined;
  }, [e.alumnos, b.email]);

  return (
    <>
      <Pregunta
        texto="¿Quién es?"
        sub={b.ventaId ? "Lo trajimos de la venta: corregí lo que haga falta." : "Sólo el nombre es obligatorio. El mail sirve para no cargarlo dos veces."}
      />
      <Input
        value={b.nombre} onChange={(ev) => set({ nombre: ev.target.value })}
        placeholder="Nombre y apellido" aria-label="Nombre y apellido" autoFocus
      />
      <div className="form-grid">
        <Field label="Email">
          <Input type="email" value={b.email} onChange={(ev) => set({ email: ev.target.value })} placeholder="martin@gmail.com" />
        </Field>
        <Field label="País">
          <Input value={b.pais} onChange={(ev) => set({ pais: ev.target.value })} placeholder="Argentina" />
        </Field>
      </div>
      {repetido && (
        <div className="help-card">
          <Info size={18} />
          <div>
            <div className="help-card__title">Ya hay un alumno con ese mail</div>
            <div className="help-card__text">
              {repetido.nombre}{repetido.plan ? ` · ${repetido.plan}` : ""}. Si es la misma persona,{" "}
              <button type="button" className="link" onClick={() => onAbrirAlumno(repetido.id)}>abrí su ficha</button>{" "}
              en vez de cargarlo de nuevo.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Paso 3: plan y cohorte ---------- */

function PasoPlan({ b, set, e, venta }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; venta?: Venta }) {
  const deVenta = venta ? planDeVenta(e, venta) : "";
  const planes = opcionesDePlan(e, deVenta, b.plan);
  const cohortes = useMemo(() => cohortesRecientes(e), [e]);

  return (
    <>
      <Pregunta texto="¿Qué plan hace?" sub="Y con qué cohorte arranca, si ya lo sabés. La cohorte se puede completar en el onboarding." />
      <div className="opciones">
        {planes.map((p, k) => (
          <Opcion
            key={p} tecla={k < 9 ? String(k + 1) : undefined} nombre={p}
            sub={p === deVenta ? "El producto de la venta" : undefined}
            activo={b.plan === p} onClick={() => set({ plan: p })}
          />
        ))}
      </div>
      <div className="stack-2">
        <span className="t-label">Cohorte</span>
        <Input value={b.cohorte} onChange={(ev) => set({ cohorte: ev.target.value })} placeholder="C9" aria-label="Cohorte" />
        {cohortes.length > 0 && (
          <div className="row-wrap">
            {cohortes.map((c) => (
              <Chip key={c} activo={b.cohorte === c} onClick={() => set({ cohorte: b.cohorte === c ? "" : c })}>{c}</Chip>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Paso 4: cuota y fecha de inicio ---------- */

function PasoCuota({ b, set, e, venta }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; venta?: Venta }) {
  const M = (n: number) => money(n, b.moneda);
  const deVenta = venta ? cuotaMensualDeVenta(e.cuotas.filter((c) => c.ventaId === venta.id)) : 0;

  /* Atajos: las cuotas que más se repiten entre los alumnos de hoy. */
  const atajos = useMemo(() => {
    const cuenta = new Map<number, number>();
    for (const a of e.alumnos) if (a.cuotaMensual > 0) cuenta.set(a.cuotaMensual, (cuenta.get(a.cuotaMensual) ?? 0) + 1);
    const comunes = [...cuenta.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n]) => n);
    return [0, ...new Set([...(deVenta > 0 ? [deVenta] : []), ...comunes.sort((x, y) => x - y)])];
  }, [e.alumnos, deVenta]);

  const sub = venta
    ? deVenta > 0
      ? `Sale del plan de cuotas de la venta: ${M(deVenta)} por mes.`
      : "La venta se pagó en un solo pago: no deja cuota mensual."
    : "Es lo que suma al MRR mientras esté activo. Si pagó todo junto, dejalo en cero.";

  return (
    <>
      <Pregunta texto="¿Cuánto paga por mes?" sub={sub} />
      <div className="monto-grande">
        <span className="monto-grande__signo">{b.moneda === "USD" ? "US$" : "$"}</span>
        <input
          type="number" min={0} step="1" inputMode="decimal" placeholder="0"
          value={b.cuotaMensual || ""}
          onChange={(ev) => set({ cuotaMensual: ev.target.value === "" ? 0 : Number(ev.target.value) })}
          aria-label="Cuota mensual"
        />
      </div>
      <div className="row-wrap">
        {atajos.map((n) => (
          <Chip key={n} activo={b.cuotaMensual === n} onClick={() => set({ cuotaMensual: n })}>
            {n === 0 ? "Sin cuota mensual" : M(n)}
          </Chip>
        ))}
      </div>
      <div className="stack-2">
        <span className="t-label">Fecha de inicio</span>
        <Input
          type="date" value={isoDia(b.inicio)} aria-label="Fecha de inicio"
          /* Mediodía y no medianoche: la medianoche UTC en Argentina es el
             día anterior, y la fecha elegida aparecía corrida uno para atrás. */
          onChange={(ev) => { if (ev.target.value) set({ inicio: new Date(`${ev.target.value}T12:00:00`).toISOString() }); }}
        />
        {venta && <span className="hk-help">Es la fecha de la venta. Cambiala si arranca otro día.</span>}
      </div>
    </>
  );
}

/* ---------- Paso 5: etapa del servicio y estado ---------- */

function PasoEtapa({ b, set, e }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp }) {
  const etapas = etapasDeServicio(e);
  return (
    <>
      <Pregunta texto="¿En qué etapa del servicio está?" sub="Es la columna del pipeline de alumnos en la que aparece. Después lo movés arrastrando." />
      <div className="opciones">
        {etapas.map((et, k) => (
          <Opcion
            key={et.id} tecla={k < 9 ? String(k + 1) : undefined} nombre={et.nombre}
            sub={k === 0 ? "Donde arranca quien recién compró" : undefined}
            activo={b.etapaServicioId === et.id} onClick={() => set({ etapaServicioId: et.id })}
          />
        ))}
      </div>
      <div className="stack-2">
        <span className="t-label">Estado</span>
        <div className="row-wrap">
          {ESTADOS_ALUMNO.map((k) => (
            <Chip key={k} activo={b.estado === k} onClick={() => set({ estado: k })}>{ESTADO_ALUMNO[k].texto}</Chip>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Paso 6: notas y resumen ---------- */

function PasoNotas({ b, set, e, venta }: { b: Borrador; set: (c: Partial<Borrador>) => void; e: EstadoApp; venta?: Venta }) {
  const etapa = etapasDeServicio(e).find((x) => x.id === b.etapaServicioId);
  const propios = e.campos.filter((c) => c.entidad === "alumno");
  return (
    <>
      <Pregunta texto="¿Algo para anotar?" sub="Opcional: lo que haya que saber para acompañarlo. Objetivos, horarios, lo que habló con el closer." />
      <Textarea rows={4} value={b.notas} onChange={(ev) => set({ notas: ev.target.value })} placeholder="Quiere entrevistas para backend. Puede de noche." aria-label="Notas" />
      {propios.length > 0 && (
        <div className="form-grid">
          <CamposExtra campos={e.campos} entidad="alumno" valores={b.extra} onChange={(k, v) => set({ extra: { ...b.extra, [k]: v } })} />
        </div>
      )}
      <div className="stack-2">
        <span className="t-label">Así queda</span>
        <dl className="dl">
          <dt>Alumno</dt><dd>{b.nombre.trim()}{b.email.trim() && <span className="t-subtle"> · {b.email.trim()}</span>}</dd>
          <dt>Plan</dt><dd>{b.plan}{b.cohorte.trim() ? ` · ${b.cohorte.trim()}` : ""}</dd>
          <dt>Cuota</dt><dd className="t-num">{b.cuotaMensual > 0 ? `${money(b.cuotaMensual, b.moneda)} por mes` : "Sin cuota mensual"}</dd>
          <dt>Empieza</dt><dd>{fechaLarga(b.inicio)}</dd>
          <dt>Etapa</dt><dd><span className="row-wrap"><BadgeEtapa etapa={etapa} /><span className="t-sm t-subtle">{ESTADO_ALUMNO[b.estado].texto}</span></span></dd>
          {venta && <><dt>Venta</dt><dd>{describirVenta(e, venta)}</dd></>}
        </dl>
      </div>
    </>
  );
}
