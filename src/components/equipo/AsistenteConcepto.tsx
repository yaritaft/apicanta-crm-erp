"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { Chip, Input, Switch, Textarea } from "@/components/ui/ui";
import { nuevoId, useEstado } from "@/lib/store";
import { escribirMonto, leerMonto } from "@/lib/gastos";
import {
  ALCANCES, BASES, TIPOS_CONCEPTO, describirConcepto, infoBase, plata, quienesNoComisionan,
} from "@/lib/honorarios";
import type {
  AlcanceVentas, BaseMedicion, ConceptoPago, EstadoApp, MiembroEquipo, Moneda, TipoConcepto,
} from "@/lib/types";

/* ==================================================================
   Una parte de lo que cobra alguien, una pregunta por pantalla.

   Qué es (fijo, bono, comisión, tramo o pieza) decide el resto: una
   comisión pregunta sobre qué se mide, de qué ventas y qué porcentaje;
   un tramo, sobre qué, de qué y cuánto por cada cuánto; una pieza, cómo
   se llama y cuánto se paga. Al final, la regla dicha en castellano: lo
   que se lee ahí es lo que la liquidación va a calcular.

   Para editar se entra directo al resumen, como en los gastos.
   ================================================================== */

type PasoId = "tipo" | "monto" | "pieza" | "base" | "deque" | "tasa" | "tramo" | "resumen";

const TITULO: Record<PasoId, string> = {
  tipo: "Qué es", monto: "Monto", pieza: "Pieza", base: "Sobre qué", deque: "De qué",
  tasa: "Porcentaje", tramo: "Tramo", resumen: "Resumen",
};

function pasosDe(tipo: TipoConcepto | null): PasoId[] {
  switch (tipo) {
    case "porcentaje": return ["tipo", "base", "deque", "tasa", "resumen"];
    case "tramo": return ["tipo", "base", "deque", "tramo", "resumen"];
    case "unidad": return ["tipo", "pieza", "resumen"];
    default: return ["tipo", "monto", "resumen"];
  }
}

interface Borrador {
  tipo: TipoConcepto | null;
  nombre: string;
  /* Escrito a mano: la sugerencia ya no lo pisa. */
  nombreTocado: boolean;
  /* Texto, no número: "25.000" en pesos son veinticinco mil (leerMonto). */
  monto: string;
  moneda: Moneda;
  tasa: string;
  base?: BaseMedicion;
  cada: string;
  alcance?: AlcanceVentas;
  productoIds: string[];
  sinVentasSinComision: boolean;
  sinExcluidasMarketing: boolean;
  utmSource: string;
  unidad: string;
  condicion: string;
  desde: string;
  hasta: string;
  notas: string;
}

const alcanceDeRol = (m: MiembroEquipo): AlcanceVentas =>
  m.rol === "closer" || m.rol === "ceo" ? "closer" : m.rol === "setter" ? "setter" : m.rol === "director" ? "director" : "todas";

function inicial(m: MiembroEquipo, c: ConceptoPago | null | undefined, base: Moneda): Borrador {
  if (!c) {
    const reparte = m.rol === "growth" || m.rol === "socio";
    return {
      tipo: null, nombre: "", nombreTocado: false, monto: "", moneda: base, tasa: "",
      base: reparte ? "profit" : "cash-neto", cada: "", alcance: alcanceDeRol(m), productoIds: [],
      sinVentasSinComision: false, sinExcluidasMarketing: m.rol === "growth",
      utmSource: "", unidad: "", condicion: "", desde: "", hasta: "", notas: "",
    };
  }
  return {
    tipo: c.tipo, nombre: c.nombre, nombreTocado: true,
    monto: c.monto !== undefined ? escribirMonto(c.monto) : "", moneda: c.moneda,
    tasa: c.tasa !== undefined ? escribirMonto(Math.round(c.tasa * 1e6) / 1e4) : "",
    base: c.base, cada: c.cada !== undefined ? escribirMonto(c.cada) : "",
    alcance: c.alcance ?? "todas", productoIds: c.productoIds ?? [],
    sinVentasSinComision: Boolean(c.sinVentasSinComision), sinExcluidasMarketing: Boolean(c.sinExcluidasMarketing),
    utmSource: c.utmSource ?? "", unidad: c.unidad ?? "", condicion: c.condicion ?? "",
    desde: c.desde ?? "", hasta: c.hasta ?? "", notas: c.notas ?? "",
  };
}

const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* El nombre que se propone mientras nadie escribió otro. */
function nombreSugerido(b: Borrador): string {
  switch (b.tipo) {
    case "fijo": return "Sueldo";
    case "bono": return "Bono de rendimiento";
    case "unidad": return mayuscula(b.unidad.trim()) || "Por pieza";
    case "porcentaje":
      if (b.base === "profit") return "Parte del profit";
      return b.alcance === "setter" ? "Comisión de setter" : b.alcance === "director" ? "Comisión de director" : "Comisión";
    case "tramo":
      if (b.base === "llamadas" || b.base === "llamadas-hechas") return b.utmSource.trim() ? `Llamadas de ${b.utmSource.trim()}` : "Bono por llamadas";
      if (b.base === "ventas") return "Bono por ventas";
      if (b.base === "manual") return b.unidad.trim() ? `Bono por ${b.unidad.trim()}` : "Bono por tramo";
      return b.base === "profit" ? "Bono por profit" : "Bono por cash";
    default: return "";
  }
}

/* El concepto que sale del borrador, sin los campos que su tipo no usa. */
function armar(b: Borrador, id: string, base: Moneda): ConceptoPago {
  const tipo = b.tipo ?? "fijo";
  const info = infoBase(b.base);
  const c: ConceptoPago = {
    id, tipo, nombre: (b.nombre.trim() || nombreSugerido(b)).trim(),
    /* Lo que sale de medir plata va en la moneda en que se mide. */
    moneda: (tipo === "porcentaje" || (tipo === "tramo" && info.plata)) ? base : b.moneda,
  };
  if (tipo === "fijo" || tipo === "bono" || tipo === "tramo" || tipo === "unidad") c.monto = leerMonto(b.monto) || 0;
  if (tipo === "porcentaje") c.tasa = (leerMonto(b.tasa) || 0) / 100;
  if (tipo === "porcentaje" || tipo === "tramo") {
    c.base = b.base;
    if (tipo === "tramo") c.cada = leerMonto(b.cada) || 0;
    if (info.deVentas) {
      c.alcance = b.alcance ?? "todas";
      if (b.productoIds.length) c.productoIds = b.productoIds;
      if (c.alcance === "todas" && b.sinVentasSinComision) c.sinVentasSinComision = true;
    }
    if ((info.deVentas || b.base === "profit") && b.sinExcluidasMarketing) c.sinExcluidasMarketing = true;
    if ((b.base === "llamadas" || b.base === "llamadas-hechas") && b.utmSource.trim()) c.utmSource = b.utmSource.trim();
    if (b.base === "manual" && b.unidad.trim()) c.unidad = b.unidad.trim();
  }
  if (tipo === "unidad") c.unidad = b.unidad.trim();
  if (tipo === "bono" && b.condicion.trim()) c.condicion = b.condicion.trim();
  if (b.desde) c.desde = b.desde;
  if (b.hasta) c.hasta = b.hasta;
  if (b.notas.trim()) c.notas = b.notas.trim();
  return c;
}

function validar(paso: PasoId, b: Borrador): string | null {
  switch (paso) {
    case "tipo": return b.tipo ? null : "Elegí qué es";
    case "monto": return leerMonto(b.monto) > 0 ? null : "Escribí el monto";
    case "pieza":
      if (!b.unidad.trim()) return "Escribí qué se paga";
      return leerMonto(b.monto) > 0 ? null : "Escribí cuánto se paga cada una";
    case "base": return b.base ? null : "Elegí sobre qué se mide";
    case "deque":
      if (infoBase(b.base).deVentas && !b.alcance) return "Elegí de qué ventas";
      if (b.base === "manual" && !b.unidad.trim()) return "Escribí qué se cuenta";
      return null;
    case "tasa": {
      /* 0% vale: es la forma de decir que alguien que vende ya no comisiona. */
      const t = leerMonto(b.tasa);
      return t >= 0 && t <= 100 ? null : "Escribí un porcentaje entre 0 y 100";
    }
    case "tramo":
      if (!(leerMonto(b.cada) > 0)) return "Escribí cada cuánto";
      return leerMonto(b.monto) > 0 ? null : "Escribí cuánto se paga por tramo";
    case "resumen":
      if (b.desde && b.hasta && b.desde > b.hasta) return "La fecha de fin es anterior a la de inicio";
      return null;
  }
}

export function AsistenteConcepto({ miembro, concepto, onCerrar, onListo }: {
  miembro: MiembroEquipo;
  /* Con un concepto, se edita; sin, se agrega uno. */
  concepto?: ConceptoPago | null;
  onCerrar: () => void;
  onListo: (c: ConceptoPago) => void;
}) {
  const e = useEstado();
  const base = e.ajustes.monedaBase;
  const editando = Boolean(concepto);
  const [b, setB] = useState<Borrador>(() => inicial(miembro, concepto, base));
  const set = useCallback((cambios: Partial<Borrador>) => setB((x) => ({ ...x, ...cambios })), []);

  const pasos = pasosDe(b.tipo);
  const resumen = pasos.length - 1;
  const [i, setI] = useState(editando ? resumen : 0);
  const [vioResumen, setVioResumen] = useState(editando);
  const paso = pasos[Math.min(i, resumen)];
  const problema = validar(paso, b);

  const irA = (k: number) => {
    setI(k);
    if (k === pasosDe(b.tipo).length - 1) setVioResumen(true);
  };

  const final = useMemo(() => armar(b, concepto?.id ?? "nuevo", base), [b, concepto?.id, base]);

  const volverAlResumen = vioResumen && paso !== "resumen" && problema === null
    ? <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={() => irA(resumen)}>Listo, volver al resumen</button>
    : null;

  return (
    <Asistente
      etiqueta={editando ? `Editar lo que cobra ${miembro.nombre}` : `Agregar a lo que cobra ${miembro.nombre}`}
      pasos={pasos.map((id) => ({ id, titulo: TITULO[id] }))} actual={Math.min(i, resumen)} onCambiarPaso={irA}
      problema={problema} onCerrar={onCerrar}
      terminarTexto={editando ? "Guardar cambios" : "Agregar"}
      onTerminar={() => onListo(armar(b, concepto?.id ?? nuevoId("con"), base))}
    >
      {paso === "tipo" && <PasoTipo b={b} set={set} miembro={miembro} editando={editando} />}
      {paso === "monto" && <PasoMonto b={b} set={set} />}
      {paso === "pieza" && <PasoPieza b={b} set={set} />}
      {paso === "base" && <PasoBase b={b} set={set} />}
      {paso === "deque" && <PasoDeQue b={b} set={set} e={e} miembro={miembro} />}
      {paso === "tasa" && <PasoTasa b={b} set={set} />}
      {paso === "tramo" && <PasoTramo b={b} set={set} base={base} />}
      {paso === "resumen" && (
        <PasoResumen b={b} set={set} e={e} final={final} editando={editando} pasos={pasos} irA={irA} miembro={miembro} />
      )}
      {volverAlResumen}
    </Asistente>
  );
}

type Poner = (c: Partial<Borrador>) => void;

/* ---------- Qué es ---------- */

function PasoTipo({ b, set, miembro, editando }: { b: Borrador; set: Poner; miembro: MiembroEquipo; editando: boolean }) {
  return (
    <>
      <Pregunta
        texto={`¿Qué le vas a pagar a ${miembro.nombre.split(" ")[0]}?`}
        sub={editando
          ? "Si cambiás el tipo, revisá los pasos que siguen: cada tipo pregunta otras cosas."
          : "Una parte por vez. Si cobra fijo más comisión, se cargan como dos."}
      />
      <div className="opciones opciones--lista">
        {TIPOS_CONCEPTO.map((t, k) => (
          <Opcion
            key={t.tipo} tecla={String(k + 1)} nombre={t.nombre} sub={t.sub}
            activo={b.tipo === t.tipo}
            /* Un porcentaje es de plata: si venía de un tramo de llamadas, vuelve al cash. */
            onClick={() => set({ tipo: t.tipo, ...(t.tipo === "porcentaje" && !infoBase(b.base).plata ? { base: "cash-neto" } : {}) })}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- Monto: fijo y bono ---------- */

function CampoMonto({ b, set, etiqueta }: { b: Borrador; set: Poner; etiqueta: string }) {
  return (
    <>
      <div className="monto-grande">
        <span className="monto-grande__signo">{b.moneda === "USD" ? "US$" : "$"}</span>
        <input
          type="text" inputMode="decimal" autoComplete="off" value={b.monto}
          onChange={(ev) => set({ monto: ev.target.value })} aria-label={etiqueta} placeholder="0"
        />
      </div>
      <div className="row-wrap">
        <Chip activo={b.moneda === "USD"} onClick={() => set({ moneda: "USD" })}>Dólares (US$)</Chip>
        <Chip activo={b.moneda === "ARS"} onClick={() => set({ moneda: "ARS" })}>Pesos ($)</Chip>
      </div>
    </>
  );
}

function PasoMonto({ b, set }: { b: Borrador; set: Poner }) {
  const bono = b.tipo === "bono";
  return (
    <>
      <Pregunta
        texto={bono ? "¿De cuánto es el bono?" : "¿Cuánto es por mes?"}
        sub={bono
          ? "Al liquidar decidís si lo ganó: arranca incluido y se saca con un clic."
          : "Si empieza o termina a mitad de mes, en el resumen ponés desde cuándo y se prorratea solo."}
      />
      <CampoMonto b={b} set={set} etiqueta={bono ? "Monto del bono" : "Monto por mes"} />
      {bono && (
        <div className="hk-field">
          <label className="hk-label" htmlFor="con-condicion">Qué tiene que pasar para ganarlo (opcional)</label>
          <Input
            id="con-condicion" value={b.condicion} onChange={(ev) => set({ condicion: ev.target.value })}
            placeholder="Cumplir los objetivos del mes"
          />
          <span className="hk-help">Se lee al liquidar, al lado del bono.</span>
        </div>
      )}
    </>
  );
}

/* ---------- Pieza ---------- */

function PasoPieza({ b, set }: { b: Borrador; set: Poner }) {
  return (
    <>
      <Pregunta
        texto="¿Qué se paga y cuánto cada una?"
        sub="Una tarifa por pieza: cada mes, al liquidar, se carga cuántas fueron. Si cobra distinto por cosas distintas, se carga una tarifa por cada una."
      />
      <div className="hk-field">
        <label className="hk-label" htmlFor="con-unidad">Qué se paga, en singular</label>
        <Input
          id="con-unidad" value={b.unidad} autoFocus
          onChange={(ev) => set({ unidad: ev.target.value })}
          placeholder="Reel complejo, sesión de 3 horas, minuto de video"
        />
      </div>
      <CampoMonto b={b} set={set} etiqueta="Tarifa por pieza" />
    </>
  );
}

/* ---------- Sobre qué se mide ---------- */

function PasoBase({ b, set }: { b: Borrador; set: Poner }) {
  /* Un porcentaje es de plata; un tramo puede ser de plata o de cantidades. */
  const bases = BASES.filter((x) => b.tipo === "tramo" || x.plata);
  return (
    <>
      <Pregunta
        texto="¿Sobre qué se mide?"
        sub={b.tipo === "porcentaje"
          ? "El porcentaje se aplica a esto, con lo del mes que se liquida."
          : "Por cada tramo de esto se paga el monto: cada US$ 100.000, cada 15 llamadas."}
      />
      <div className="opciones opciones--lista">
        {bases.map((x, k) => (
          <Opcion
            key={x.base} tecla={k < 9 ? String(k + 1) : undefined} nombre={x.nombre} sub={x.sub}
            activo={b.base === x.base} onClick={() => set({ base: x.base })}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- De qué: qué ventas, qué llamadas, qué se cuenta ---------- */

function PasoDeQue({ b, set, e, miembro }: { b: Borrador; set: Poner; e: EstadoApp; miembro: MiembroEquipo }) {
  const info = infoBase(b.base);
  const yari = quienesNoComisionan(e);

  if (b.base === "profit") {
    return (
      <>
        <Pregunta
          texto="¿Cuenta todo el profit?"
          sub="El profit del mes sale de Finanzas, con los sueldos de esta misma liquidación adentro."
        />
        <div className="opciones opciones--lista">
          <Opcion tecla="1" nombre="Todo el profit" sub="El resultado operativo del mes, entero."
            activo={!b.sinExcluidasMarketing} onClick={() => set({ sinExcluidasMarketing: false })} />
          <Opcion tecla="2" nombre="Sin las ventas excluidas de marketing"
            sub="Se descuenta la parte de las ventas marcadas «Excluida de marketing» (eventos, conocidos, las que cierra Yari), como el reparto del growth partner."
            activo={b.sinExcluidasMarketing} onClick={() => set({ sinExcluidasMarketing: true })} />
        </div>
      </>
    );
  }

  if (b.base === "llamadas" || b.base === "llamadas-hechas") {
    /* Las fuentes que ya llegaron por Calendly, para elegir con un clic. */
    const fuentes = [...new Set(e.sesiones.map((s) => s.utm?.utm_source?.trim()).filter((x): x is string => Boolean(x)))].sort();
    return (
      <>
        <Pregunta
          texto="¿Qué llamadas cuentan?"
          sub="Salen de la Agenda. El embudo de cada llamada lo dice su utm_source: «Resell», «Webinar», «setter-ia»."
        />
        <div className="opciones opciones--lista">
          <Opcion tecla="1" nombre="Todas" sub="Cualquier llamada de la Agenda."
            activo={!b.utmSource.trim()} onClick={() => set({ utmSource: "" })} />
        </div>
        <div className="hk-field">
          <label className="hk-label" htmlFor="con-utm">Sólo las que llegaron con este utm_source</label>
          <Input id="con-utm" value={b.utmSource} onChange={(ev) => set({ utmSource: ev.target.value })} placeholder="Resell" />
          {fuentes.length > 0 && (
            <div className="row-wrap" style={{ marginTop: 8 }}>
              {fuentes.map((f) => (
                <Chip key={f} activo={b.utmSource.trim().toLowerCase() === f.toLowerCase()} onClick={() => set({ utmSource: f })}>{f}</Chip>
              ))}
            </div>
          )}
          <span className="hk-help">Si la Agenda no las tiene todas, al liquidar se corrige la cantidad a mano.</span>
        </div>
      </>
    );
  }

  if (b.base === "manual") {
    return (
      <>
        <Pregunta texto="¿Qué se cuenta?" sub="Cada mes, al liquidar, se escribe cuántas fueron." />
        <Input value={b.unidad} onChange={(ev) => set({ unidad: ev.target.value })} placeholder="Clases dadas, alumnos colocados" autoFocus aria-label="Qué se cuenta" />
      </>
    );
  }

  /* Cash, cash post pasarelas, facturado o ventas: de qué ventas. */
  const productos = e.productos.filter((p) => p.activo || b.productoIds.includes(p.id));
  const alternar = (id: string) =>
    set({ productoIds: b.productoIds.includes(id) ? b.productoIds.filter((x) => x !== id) : [...b.productoIds, id] });
  return (
    <>
      <Pregunta
        texto="¿De qué ventas?"
        sub={`${info.nombre} de las ventas que elijas, con lo que entró (o se cerró) en el mes que se liquida.`}
      />
      <div className="opciones opciones--lista">
        {ALCANCES.map((a, k) => (
          <Opcion
            key={a.alcance} tecla={String(k + 1)} nombre={a.nombre}
            sub={a.alcance === alcanceDeRol(miembro) && a.alcance !== "todas" ? `${a.sub} Es su rol.` : a.sub}
            activo={b.alcance === a.alcance} onClick={() => set({ alcance: a.alcance })}
          />
        ))}
      </div>
      {b.alcance && b.alcance !== "todas" && (
        <p className="t-sm t-subtle">Las que cerró {yari} no cuentan: «si la venta la cerró {yari}, no comisiona nadie», como en Finanzas.</p>
      )}
      <div className="stack-2">
        <span className="t-label">Sólo de estos servicios (opcional)</span>
        <div className="row-wrap">
          {productos.map((p) => (
            <Chip key={p.id} activo={b.productoIds.includes(p.id)} onClick={() => alternar(p.id)}>{p.nombre}</Chip>
          ))}
        </div>
        <span className="t-sm t-subtle">Sin elegir ninguno, cuentan todos.</span>
      </div>
      <div className="stack-2">
        {b.alcance === "todas" && (
          <label className="row" style={{ gap: 10 }}>
            <Switch checked={b.sinVentasSinComision} onChange={(v) => set({ sinVentasSinComision: v })} etiqueta={`Sin las que cerró ${yari}`} />
            <span className="t-sm">Sin las que cerró {yari}</span>
          </label>
        )}
        <label className="row" style={{ gap: 10 }}>
          <Switch checked={b.sinExcluidasMarketing} onChange={(v) => set({ sinExcluidasMarketing: v })} etiqueta="Sin las excluidas de marketing" />
          <span className="t-sm">Sin las ventas marcadas «Excluida de marketing»</span>
        </label>
      </div>
    </>
  );
}

/* ---------- Porcentaje ---------- */

function PasoTasa({ b, set }: { b: Borrador; set: Poner }) {
  return (
    <>
      <Pregunta texto="¿Qué porcentaje?" sub={`Del ${infoBase(b.base).nombre.toLowerCase()} que elegiste. Se aceptan decimales: 12,5.`} />
      <div className="monto-grande">
        <input
          type="text" inputMode="decimal" autoComplete="off" value={b.tasa}
          onChange={(ev) => set({ tasa: ev.target.value })} aria-label="Porcentaje" placeholder="0"
        />
        <span className="monto-grande__signo">%</span>
      </div>
    </>
  );
}

/* ---------- Tramo ---------- */

function PasoTramo({ b, set, base }: { b: Borrador; set: Poner; base: Moneda }) {
  const info = infoBase(b.base);
  const unidad = info.plata ? (base === "USD" ? "US$" : "$") : b.base === "manual" ? b.unidad.trim() || "unidades" : info.nombre.toLowerCase();
  return (
    <>
      <Pregunta
        texto="¿Cuánto por cada cuánto?"
        sub="Se paga una vez por cada tramo completo: con US$ 250.000 y tramos de US$ 100.000 son dos."
      />
      <div className="hk-field">
        <label className="hk-label" htmlFor="con-cada">Cada cuánto ({unidad})</label>
        <div className="monto-grande">
          {info.plata && <span className="monto-grande__signo">{unidad}</span>}
          <input
            id="con-cada" type="text" inputMode="decimal" autoComplete="off" value={b.cada}
            onChange={(ev) => set({ cada: ev.target.value })} placeholder={info.plata ? "100.000" : "15"}
          />
        </div>
      </div>
      <div className="hk-field">
        <label className="hk-label">Cuánto se paga por cada tramo</label>
        {info.plata ? (
          <div className="monto-grande">
            <span className="monto-grande__signo">{base === "USD" ? "US$" : "$"}</span>
            <input
              type="text" inputMode="decimal" autoComplete="off" value={b.monto}
              onChange={(ev) => set({ monto: ev.target.value })} aria-label="Monto por tramo" placeholder="0"
            />
          </div>
        ) : (
          <CampoMonto b={b} set={set} etiqueta="Monto por tramo" />
        )}
      </div>
    </>
  );
}

/* ---------- Resumen ---------- */

function PasoResumen({ b, set, e, final, editando, pasos, irA, miembro }: {
  b: Borrador; set: Poner; e: EstadoApp; final: ConceptoPago; editando: boolean;
  pasos: PasoId[]; irA: (k: number) => void; miembro: MiembroEquipo;
}) {
  const cambiar = (id: PasoId) => (
    <button type="button" className="link t-sm gasto-cambiar" onClick={() => irA(pasos.indexOf(id))}>Cambiar</button>
  );
  const tipo = TIPOS_CONCEPTO.find((t) => t.tipo === b.tipo);
  const numero = pasos.includes("tasa") ? "tasa" : pasos.includes("tramo") ? "tramo" : pasos.includes("pieza") ? "pieza" : "monto";

  return (
    <>
      <Pregunta
        texto={editando ? "Así está" : "Así queda"}
        sub={`Esto es lo que la liquidación de ${miembro.nombre.split(" ")[0]} va a calcular cada mes.`}
      />
      <div className="con-frase">{describirConcepto(final, e)}</div>

      <dl className="dl">
        <dt>Tipo</dt>
        <dd>{tipo?.nombre} {cambiar("tipo")}</dd>
        {pasos.includes("base") && (<><dt>Sobre qué</dt><dd>{infoBase(b.base).nombre} {cambiar("base")}</dd></>)}
        {pasos.includes("deque") && (
          <><dt>De qué</dt><dd>{deQueTexto(b, e)} {cambiar("deque")}</dd></>
        )}
        <dt>{numero === "tasa" ? "Porcentaje" : numero === "pieza" ? "Tarifa" : "Monto"}</dt>
        <dd className="t-num">{montoTexto(final)} {cambiar(numero)}</dd>
      </dl>

      <div className="form-grid">
        <div className="hk-field span-2">
          <label className="hk-label" htmlFor="con-nombre">Cómo se llama en la liquidación</label>
          <Input
            id="con-nombre" value={b.nombreTocado ? b.nombre : nombreSugerido(b)}
            onChange={(ev) => set({ nombre: ev.target.value, nombreTocado: true })}
          />
        </div>
        <div className="hk-field">
          <label className="hk-label">Desde (opcional)</label>
          {/* required={false}: son opcionales, así el calendario ofrece "Borrar". */}
          <Input type="date" value={b.desde} onChange={(ev) => set({ desde: ev.target.value })} aria-label="Desde" required={false} />
        </div>
        <div className="hk-field">
          <label className="hk-label">Hasta (opcional)</label>
          <Input type="date" value={b.hasta} onChange={(ev) => set({ hasta: ev.target.value })} aria-label="Hasta" required={false} />
          <span className="hk-help">Un fijo que empieza o termina a mitad de mes se prorratea por días.</span>
        </div>
        <div className="hk-field span-2">
          <label className="hk-label" htmlFor="con-notas">Notas</label>
          <Textarea id="con-notas" rows={2} value={b.notas} onChange={(ev) => set({ notas: ev.target.value })} placeholder="Lo que haya que recordar de este acuerdo" />
        </div>
      </div>
    </>
  );
}

function deQueTexto(b: Borrador, e: EstadoApp): string {
  if (b.base === "profit") return b.sinExcluidasMarketing ? "Sin las ventas excluidas de marketing" : "Todo el profit";
  if (b.base === "llamadas" || b.base === "llamadas-hechas") return b.utmSource.trim() ? `Las de utm_source ${b.utmSource.trim()}` : "Todas";
  if (b.base === "manual") return b.unidad.trim() || "—";
  const partes = [ALCANCES.find((a) => a.alcance === b.alcance)?.nombre ?? "—"];
  const prods = b.productoIds.map((id) => e.productos.find((p) => p.id === id)?.nombre).filter(Boolean);
  if (prods.length) partes.push(`sólo ${prods.join(", ")}`);
  if (b.alcance === "todas" && b.sinVentasSinComision) partes.push(`sin las de ${quienesNoComisionan(e)}`);
  if (b.sinExcluidasMarketing) partes.push("sin las excluidas de marketing");
  return partes.join(" · ");
}

function montoTexto(c: ConceptoPago): string {
  if (c.tipo === "porcentaje") return `${escribirMonto(Math.round((c.tasa ?? 0) * 1e6) / 1e4)}%`;
  if (c.tipo === "tramo") {
    const cada = infoBase(c.base).plata ? plata(c.cada ?? 0, c.moneda) : escribirMonto(c.cada ?? 0);
    return `${plata(c.monto ?? 0, c.moneda)} cada ${cada}`;
  }
  return plata(c.monto ?? 0, c.moneda);
}
