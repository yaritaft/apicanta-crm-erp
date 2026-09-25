"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, Plus, Star } from "lucide-react";
import {
  CAMPO, fechaCrm, textoDe, valorDe,
  type CampoCrm, type ClaveCampo, type FilaCrm, type Pintor,
} from "@/lib/crm";
import type { CampoOpcionesCrm, OpcionCrm } from "@/lib/types";
import { Casilla, Chip, IconoCampo, MarcaAuto } from "./piezas";
import { EditorTextoLargo, SelectorOpciones } from "./Editores";

/* ==================================================================
   La grilla del CRM, como la de Airtable.

   - El número de fila y el nombre quedan fijos al scrollear de costado;
     el encabezado arriba y el total de registros abajo.
   - Un clic elige la celda (borde azul); otro clic, Enter o empezar a
     escribir la abre. Las flechas, Tab, Inicio y Fin se mueven como en
     una planilla; Espacio abre el registro entero; Supr la vacía.
   - Se editan sólo las columnas del equipo. Las que llegan de la agenda
     se ven igual pero no se tocan: vienen de Calendly.
   - Sólo se dibujan las filas que se ven: con miles de agendas anda
     igual de rápido.
   ================================================================== */

export type AltoFila = "corta" | "media" | "alta" | "extra";
export const ALTOS: Record<AltoFila, number> = { corta: 32, media: 56, alta: 88, extra: 128 };

export type Item =
  | { tipo: "grupo"; clave: string; campo: ClaveCampo; valor: string; cuenta: number; abierto: boolean }
  | { tipo: "fila"; f: FilaCrm; n: number };

const NUM = 68;       // el número de fila, la casilla y el botón de abrir
const CABEZA = 32;    // el encabezado
const GRUPO = 44;     // el encabezado de un grupo
const PIE = 34;       // la barra de abajo con el total
const MAS = 94;       // la columna del «+»
const EXTRA = 6;      // filas de más arriba y abajo de lo que se ve

export interface PropsGrilla {
  items: Item[];
  primario: CampoCrm;
  columnas: CampoCrm[];
  anchos: Record<string, number>;
  alto: number;
  pintar: Pintor;
  opciones: Record<CampoOpcionesCrm, OpcionCrm[]>;
  /* Las columnas que filtran, ordenan o agrupan la vista: se tiñen como en Airtable. */
  tintes: Partial<Record<ClaveCampo, "filtro" | "orden" | "grupo">>;
  colorFila?: (f: FilaCrm) => string | undefined;
  marcadas: Set<string>;
  onMarcar: (ids: string[], marcar: boolean) => void;
  onAbrir: (id: string) => void;
  onGuardar: (f: FilaCrm, clave: ClaveCampo, valor: string) => void;
  onAncho: (clave: string, px: number) => void;
  onEncabezado: (clave: ClaveCampo, el: HTMLElement) => void;
  onMas: (el: HTMLElement) => void;
  /* ⌘Z: deshace el último cambio (lo lleva la página, que sabe qué era). */
  onDeshacer?: () => void;
  onGrupo: (clave: string) => void;
  onError: (mensaje: string) => void;
  /* Las que acaban de llegar de Calendly: se prenden un momento. */
  nuevas: Set<string>;
  totalFilas: number;
  pie?: React.ReactNode;
  vacio?: React.ReactNode;
  /* La fila que se acaba de editar no salta de lugar ni se esconde hasta
     que se elige otra: avisa cuál es la activa. */
  onActiva?: (id: string | null) => void;
  /* Cambia con la tabla y la vista: la grilla vuelve arriba a la izquierda. */
  reinicio?: string;
}

interface Activa { id: string; col: number }
interface Edicion extends Activa { inicial?: string }

const editable = (c: CampoCrm) => c.origen === "equipo";
const digitos = (s: string) => s.replace(/[^\d]/g, "");

export function Grilla(p: PropsGrilla) {
  const {
    items, primario, columnas, anchos, alto, pintar, opciones, tintes, colorFila, marcadas,
    onMarcar, onAbrir, onGuardar, onAncho, onEncabezado, onMas, onGrupo, onError, nuevas, totalFilas, pie, vacio,
  } = p;
  const caja = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState({ top: 0, alto: 800, ancho: 1200 });
  const [activa, setActivaEstado] = useState<Activa | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [anchoVivo, setAnchoVivo] = useState<{ clave: string; px: number } | null>(null);

  const setActiva = useCallback((a: Activa | null) => {
    setActivaEstado(a);
    p.onActiva?.(a?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.onActiva]);

  /* ---------- Medidas ---------- */
  const todas = useMemo(() => [primario, ...columnas], [primario, columnas]);
  /* En un teléfono el nombre no puede tapar media pantalla: la columna fija
     deja siempre lugar para ver al menos otra. */
  const tope = Math.max(120, vista.ancho - NUM - 130);
  const ancho = useCallback((c: CampoCrm) => {
    const w = anchoVivo?.clave === c.clave ? anchoVivo.px : anchos[c.clave] ?? c.ancho;
    return c.clave === primario.clave ? Math.min(w, tope) : w;
  }, [anchos, anchoVivo, primario.clave, tope]);
  const fijo = NUM + ancho(primario);
  const izquierdas = useMemo(() => {
    let x = fijo;
    return columnas.map((c) => { const l = x; x += ancho(c); return l; });
  }, [columnas, fijo, ancho]);
  const anchoTotal = (izquierdas.length ? izquierdas[izquierdas.length - 1] + ancho(columnas[columnas.length - 1]) : fijo) + MAS;

  const tops = useMemo(() => {
    const t: number[] = [];
    let y = 0;
    for (const it of items) { t.push(y); y += it.tipo === "grupo" ? GRUPO : alto; }
    t.push(y);
    return t;
  }, [items, alto]);
  const altoCuerpo = tops[tops.length - 1];

  const indiceDe = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, k) => { if (it.tipo === "fila") m.set(it.f.id, k); });
    return m;
  }, [items]);
  const filasEnOrden = useMemo(() => items.map((it, k) => (it.tipo === "fila" ? k : -1)).filter((k) => k >= 0), [items]);

  /* ---------- Qué filas se dibujan ---------- */
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setVista({ top: el.scrollTop, alto: el.clientHeight, ancho: el.clientWidth });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const onScroll = () => {
    const el = caja.current;
    if (!el) return;
    setVista({ top: el.scrollTop, alto: el.clientHeight, ancho: el.clientWidth });
  };

  const buscar = (y: number) => {
    let a = 0, b = items.length;
    while (a < b) { const m = (a + b) >> 1; if (tops[m + 1] <= y) a = m + 1; else b = m; }
    return a;
  };
  const desde = Math.max(0, buscar(vista.top - CABEZA) - EXTRA);
  const hasta = Math.min(items.length, buscar(vista.top + vista.alto) + EXTRA + 1);

  /* ---------- Mover la celda activa ---------- */
  const mostrar = useCallback((k: number, col: number) => {
    const el = caja.current;
    if (!el) return;
    const top = CABEZA + tops[k];
    const bottom = top + (items[k]?.tipo === "grupo" ? GRUPO : alto);
    if (top - CABEZA < el.scrollTop) el.scrollTop = top - CABEZA;
    else if (bottom > el.scrollTop + el.clientHeight - PIE) el.scrollTop = bottom - el.clientHeight + PIE;
    if (col > 0) {
      const l = izquierdas[col - 1];
      const r = l + ancho(columnas[col - 1]);
      if (l - fijo < el.scrollLeft) el.scrollLeft = l - fijo;
      else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth;
    }
  }, [tops, items, alto, izquierdas, ancho, columnas, fijo]);

  const irA = useCallback((id: string, col: number) => {
    const k = indiceDe.get(id);
    if (k === undefined) return;
    const c = Math.max(0, Math.min(col, todas.length - 1));
    setActiva({ id, col: c });
    mostrar(k, c);
  }, [indiceDe, todas.length, mostrar, setActiva]);

  const moverFilas = (id: string, col: number, paso: number) => {
    const pos = filasEnOrden.indexOf(indiceDe.get(id) ?? -1);
    const destino = filasEnOrden[Math.max(0, Math.min(filasEnOrden.length - 1, pos + paso))];
    const it = items[destino];
    if (it?.tipo === "fila") irA(it.f.id, col);
  };

  /* Otra vista: arranca arriba a la izquierda y sin nada elegido. */
  useEffect(() => {
    const el = caja.current;
    if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
    setActivaEstado(null);
    setEdicion(null);
  }, [p.reinicio]);

  /* Si la fila activa desaparece (otro filtro), no queda nada elegido. */
  useEffect(() => {
    if (activa && !indiceDe.has(activa.id)) { setActivaEstado(null); setEdicion(null); }
  }, [activa, indiceDe]);

  const filaDe = (id: string): FilaCrm | undefined => {
    const k = indiceDe.get(id);
    const it = k === undefined ? undefined : items[k];
    return it?.tipo === "fila" ? it.f : undefined;
  };

  function editar(a: Activa, inicial?: string, avisar = true) {
    const c = todas[a.col];
    if (!c || !editable(c)) {
      if (c && avisar) {
        onError(c.origen === "agenda"
          ? `«${c.titulo}» se llena sola con la agenda de Calendly: no se edita acá.`
          : `«${c.titulo}» se calcula sola.`);
      }
      return;
    }
    setEdicion({ ...a, inicial });
  }

  function guardar(f: FilaCrm, c: CampoCrm, valor: string) {
    if (String(valorDe(f, c.clave)) === valor && !(c.clave === "estadoLlamada" && f.estadoAuto)) return;
    onGuardar(f, c.clave, valor);
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLDivElement>) {
    if (edicion) return;
    /* Sólo con el foco en la grilla misma: un botón del encabezado, un link
       o un editor (que viven en un portal pero burbujean por React) manejan
       sus propias teclas. */
    if (ev.target !== ev.currentTarget) return;
    if (!activa) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); p.onDeshacer?.(); return; }
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"].includes(ev.key)) {
        const primera = items[filasEnOrden[0]];
        if (primera?.tipo === "fila") { ev.preventDefault(); irA(primera.f.id, 0); }
      }
      return;
    }
    const { id, col } = activa;
    const f = filaDe(id);
    const c = todas[col];
    if (!f || !c) return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "c") {
      ev.preventDefault();
      void navigator.clipboard?.writeText(textoDe(f, c.clave));
      return;
    }
    if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
      ev.preventDefault();
      p.onDeshacer?.();
      return;
    }
    if (mod) return;
    const saltos: Record<string, () => void> = {
      ArrowUp: () => moverFilas(id, col, -1),
      ArrowDown: () => moverFilas(id, col, 1),
      ArrowLeft: () => irA(id, col - 1),
      ArrowRight: () => irA(id, col + 1),
      Tab: () => irA(id, col + (ev.shiftKey ? -1 : 1)),
      Home: () => irA(id, 0),
      End: () => irA(id, todas.length - 1),
      PageUp: () => moverFilas(id, col, -10),
      PageDown: () => moverFilas(id, col, 10),
    };
    /* Tab en la última columna (o Mayús+Tab en la primera) sale de la grilla. */
    if (ev.key === "Tab" && (ev.shiftKey ? col === 0 : col === todas.length - 1)) { setActiva(null); return; }
    if (saltos[ev.key]) { ev.preventDefault(); saltos[ev.key](); return; }
    /* El nombre llega de la agenda: Enter ahí abre el registro entero. */
    if ((ev.key === "Enter" || ev.key === "F2") && col === 0) { ev.preventDefault(); onAbrir(id); return; }
    if (ev.key === "Enter" || ev.key === "F2") { ev.preventDefault(); editar(activa); return; }
    if (ev.key === " ") { ev.preventDefault(); onAbrir(id); return; }
    if (ev.key === "Escape") { setActiva(null); return; }
    if (ev.key === "Backspace" || ev.key === "Delete") {
      ev.preventDefault();
      if (editable(c)) guardar(f, c, "");
      return;
    }
    if (ev.key.length === 1) {
      ev.preventDefault();
      editar(activa, ev.key);
    }
  }

  function onPaste(ev: React.ClipboardEvent<HTMLDivElement>) {
    if (edicion || !activa || ev.target !== ev.currentTarget) return;
    const f = filaDe(activa.id);
    const c = todas[activa.col];
    if (!f || !c || !editable(c)) return;
    const texto = ev.clipboardData.getData("text").trim();
    ev.preventDefault();
    if (c.opciones) {
      const op = opciones[c.opciones].find((o) => o.nombre.toLowerCase() === texto.toLowerCase());
      if (!op) { onError(`«${texto}» no es una opción de ${c.titulo}.`); return; }
      guardar(f, c, op.nombre);
    } else guardar(f, c, texto);
  }

  function clicCelda(ev: React.MouseEvent, id: string, col: number) {
    if (ev.button !== 0) return;
    const yaEra = activa?.id === id && activa.col === col;
    caja.current?.focus({ preventScroll: true });
    if (yaEra) { editar({ id, col }, undefined, false); return; }
    setEdicion(null);
    setActiva({ id, col });
  }

  /* ---------- Ancho de las columnas: arrastrando el borde ---------- */
  function empezarAncho(ev: React.PointerEvent, c: CampoCrm) {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX;
    const w0 = ancho(c);
    const mover = (e: PointerEvent) => setAnchoVivo({ clave: c.clave, px: Math.max(80, Math.round(w0 + e.clientX - x0)) });
    const soltar = (e: PointerEvent) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      onAncho(c.clave, Math.max(80, Math.round(w0 + e.clientX - x0)));
      setAnchoVivo(null);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  /* ---------- Dibujo ---------- */
  const filasVisibles = items.filter((it) => it.tipo === "fila") as Extract<Item, { tipo: "fila" }>[];
  const marcadasAca = filasVisibles.filter((it) => marcadas.has(it.f.id)).length;

  const tinte = (c: CampoCrm) => (tintes[c.clave] ? ` crm-col--${tintes[c.clave]}` : "");

  function contenido(f: FilaCrm, c: CampoCrm): React.ReactNode {
    const v = valorDe(f, c.clave);
    switch (c.tipo) {
      case "seleccion": {
        if (!v) return null;
        const chip = <Chip texto={String(v)} color={pintar(c.clave, String(v))} />;
        return c.clave === "estadoLlamada" && f.estadoAuto
          ? <span className="crm-auto-valor" title="Lo puso el CRM solo. Elegí otro para cambiarlo.">{chip}</span>
          : chip;
      }
      case "multiple":
        return (v as string[]).length ? (
          <span className="crm-chips">{(v as string[]).map((x) => <Chip key={x} texto={x} color={pintar(c.clave, x)} />)}</span>
        ) : null;
      case "fecha":
        return <span className="crm-txt crm-txt--num">{fechaCrm(String(v))}</span>;
      case "url":
        return v ? <a className="crm-link" href={String(v)} target="_blank" rel="noreferrer" onMouseDown={(e) => e.stopPropagation()}>{String(v)}</a> : null;
      case "email":
        return v ? <a className="crm-link" href={`mailto:${v}`} onMouseDown={(e) => e.stopPropagation()}>{String(v)}</a> : null;
      case "telefono":
        return v ? (
          <a className="crm-link crm-txt--num" href={`https://wa.me/${digitos(String(v))}`} target="_blank" rel="noreferrer"
            title="Abrir el chat de WhatsApp" onMouseDown={(e) => e.stopPropagation()}>{String(v)}</a>
        ) : null;
      case "formula":
        if (!v) return null;
        return c.etiqueta ? <Chip texto={String(v)} color={pintar(c.clave, String(v))} /> : <span className="crm-txt crm-txt--num">{String(v)}</span>;
      default:
        return <span className="crm-txt">{String(v)}</span>;
    }
  }

  const hayFilas = filasVisibles.length > 0;

  return (
    <div
      className={`crm-grilla${alto > 32 ? " crm-grilla--alta" : ""}`}
      style={{ "--crm-renglones": Math.max(1, Math.floor((alto - 12) / 19)) } as React.CSSProperties}
    >
      <div
        ref={caja}
        className="crm-grilla__caja"
        role="grid"
        aria-label="Agendas"
        aria-rowcount={totalFilas}
        aria-colcount={todas.length}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <div className="crm-grilla__lienzo" style={{ width: anchoTotal, minHeight: `max(100%, ${CABEZA + altoCuerpo + PIE}px)` }}>
          {/* ---------- Encabezado ---------- */}
          <div className="crm-cabeza" role="row" style={{ width: anchoTotal }}>
            <div className="crm-fija crm-fija--cabeza" style={{ width: fijo }}>
              <div className="crm-num crm-num--cabeza" style={{ width: NUM }}>
                <Casilla
                  etiqueta="Elegir todas" marcada={hayFilas && marcadasAca === filasVisibles.length}
                  mixta={marcadasAca > 0 && marcadasAca < filasVisibles.length}
                  onCambiar={(v) => onMarcar(filasVisibles.map((it) => it.f.id), v)}
                />
              </div>
              <Encabezado c={primario} ancho={ancho(primario)} tinte={tinte(primario)} onMenu={onEncabezado} onAncho={empezarAncho} />
            </div>
            {columnas.map((c) => (
              <Encabezado key={c.clave} c={c} ancho={ancho(c)} tinte={tinte(c)} onMenu={onEncabezado} onAncho={empezarAncho} />
            ))}
            <button
              type="button" className="crm-th crm-th--mas" style={{ width: MAS }} aria-label="Mostrar más campos"
              title="Mostrar más campos" onClick={(ev) => onMas(ev.currentTarget)}
            >
              <Plus size={16} aria-hidden />
            </button>
          </div>

          {/* ---------- Filas ---------- */}
          <div className="crm-cuerpo" style={{ height: altoCuerpo }}>
            {items.slice(desde, hasta).map((it, j) => {
              const k = desde + j;
              if (it.tipo === "grupo") {
                const campo = CAMPO[it.campo];
                return (
                  <div key={`g-${it.clave}`} className="crm-grupo" style={{ top: tops[k], height: GRUPO, width: anchoTotal }}>
                    <button type="button" className="crm-grupo__cabeza" onClick={() => onGrupo(it.clave)} aria-expanded={it.abierto}>
                      {it.abierto ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                      <span className="crm-grupo__campo">{campo?.titulo}</span>
                      {it.valor
                        ? (campo?.tipo === "seleccion" || campo?.tipo === "multiple" || campo?.etiqueta
                          ? <Chip texto={it.valor} color={pintar(it.campo, it.valor)} />
                          : <span className="crm-grupo__valor">{campo?.tipo === "fecha" ? fechaCrm(it.valor) : it.valor}</span>)
                        : <span className="crm-grupo__valor crm-grupo__valor--vacio">Vacío</span>}
                      <span className="crm-grupo__cuenta">{it.cuenta} {it.cuenta === 1 ? "registro" : "registros"}</span>
                    </button>
                  </div>
                );
              }
              const f = it.f;
              const marcada = marcadas.has(f.id);
              const esActiva = activa?.id === f.id;
              const color = colorFila?.(f);
              return (
                <div
                  key={f.id}
                  role="row"
                  aria-rowindex={it.n}
                  aria-selected={marcada}
                  className={`crm-fila${esActiva ? " crm-fila--activa" : ""}${marcada ? " crm-fila--marcada" : ""}${nuevas.has(f.id) ? " crm-fila--nueva" : ""}`}
                  style={{ top: tops[k], height: alto, width: anchoTotal }}
                >
                  <div className="crm-fija" style={{ width: fijo }}>
                    <div className="crm-num" style={{ width: NUM }}>
                      {color && <span className="crm-num__color" style={{ background: color }} aria-hidden />}
                      <span className="crm-num__n">{it.n}</span>
                      <span className="crm-num__casilla">
                        <Casilla etiqueta={`Elegir a ${f.nombre}`} marcada={marcada} onCambiar={(v) => onMarcar([f.id], v)} />
                      </span>
                      <button
                        type="button" className="crm-num__abrir" aria-label={`Abrir el registro de ${f.nombre}`}
                        title="Abrir el registro (Espacio)"
                        onMouseDown={(ev) => ev.stopPropagation()} onClick={() => onAbrir(f.id)}
                      >
                        <Maximize2 size={13} aria-hidden />
                      </button>
                    </div>
                    <Celda
                      f={f} c={primario} col={0} ancho={ancho(primario)} activa={esActiva && activa.col === 0}
                      tinte={tinte(primario)} alto={alto} onDown={clicCelda}
                      onDoble={() => onAbrir(f.id)}
                    >
                      <span className="crm-txt crm-txt--nombre">{f.nombre}</span>
                      {f.calificada === "Sí" && (
                        <span className="estrella-calificada crm-estrella" title="Agenda calificada: invierte +1000, inglés conversacional y carrera">
                          <Star size={13} fill="currentColor" aria-label="Agenda calificada" />
                        </span>
                      )}
                    </Celda>
                  </div>
                  {columnas.map((c, i) => {
                    const col = i + 1;
                    const act = esActiva && activa.col === col;
                    return (
                      <Celda
                        key={c.clave} f={f} c={c} col={col} ancho={ancho(c)} activa={act}
                        tinte={tinte(c)} alto={alto} onDown={clicCelda}
                        onDoble={() => editar({ id: f.id, col })}
                        abierta={edicion?.id === f.id && edicion.col === col}
                      >
                        {edicion?.id === f.id && edicion.col === col && c.tipo === "url"
                          ? (
                            <EditorLinea
                              valor={String(valorDe(f, c.clave))} inicial={edicion.inicial}
                              onGuardar={(v) => guardar(f, c, v)}
                              onCerrar={(mover) => {
                                setEdicion(null);
                                caja.current?.focus({ preventScroll: true });
                                if (mover === "abajo") moverFilas(f.id, col, 1);
                                if (mover === "derecha") irA(f.id, col + 1);
                              }}
                            />
                          )
                          : contenido(f, c)}
                        {act && c.opciones && <ChevronDown size={16} className="crm-td__flecha" aria-hidden />}
                      </Celda>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Con pocas filas, el pie igual va abajo de todo, como en Airtable. */}
          <div className="crm-grilla__resto" aria-hidden />

          {/* ---------- Pie: cuántos registros ---------- */}
          <div className="crm-pie" style={{ width: anchoTotal }}>
            <div className="crm-fija crm-fija--pie" style={{ width: fijo }}>
              <span className="crm-pie__cuenta">
                {marcadasAca > 0
                  ? `${marcadasAca} de ${totalFilas} ${totalFilas === 1 ? "registro" : "registros"}`
                  : `${totalFilas} ${totalFilas === 1 ? "registro" : "registros"}`}
              </span>
            </div>
          </div>
        </div>
        {!hayFilas && vacio && <div className="crm-grilla__vacio">{vacio}</div>}
      </div>
      {pie && <div className="crm-grilla__flota">{pie}</div>}

      {/* ---------- Editores flotantes ---------- */}
      {edicion && (() => {
        const f = filaDe(edicion.id);
        const c = todas[edicion.col];
        if (!f || !c) return null;
        const ancla = caja.current?.querySelector<HTMLElement>(`[data-celda="${f.id}:${edicion.col}"]`) ?? null;
        const cerrar = () => { setEdicion(null); caja.current?.focus({ preventScroll: true }); };
        if (c.opciones) {
          return (
            <SelectorOpciones
              ancla={ancla} opciones={opciones[c.opciones]} valor={f.estadoAuto && c.clave === "estadoLlamada" ? "" : String(valorDe(f, c.clave))}
              inicial={edicion.inicial} ancho={Math.max(ancho(c), 160)}
              onElegir={(v) => { guardar(f, c, v); cerrar(); }} onCerrar={cerrar}
            />
          );
        }
        if (c.tipo === "texto-largo") {
          return (
            <EditorTextoLargo
              ancla={ancla} valor={String(valorDe(f, c.clave))} inicial={edicion.inicial} titulo={c.titulo}
              onGuardar={(v) => guardar(f, c, v)} onCerrar={cerrar}
            />
          );
        }
        return null;
      })()}
    </div>
  );
}

function Encabezado({ c, ancho, tinte, onMenu, onAncho }: {
  c: CampoCrm; ancho: number; tinte: string;
  onMenu: (clave: ClaveCampo, el: HTMLElement) => void;
  onAncho: (ev: React.PointerEvent, c: CampoCrm) => void;
}) {
  const ayuda = `${c.titulo}: ${c.fuente}${c.origen === "agenda" ? " Se llena sola con la agenda." : c.origen === "calculado" ? " Se calcula sola." : " La carga el equipo."}`;
  return (
    <div className={`crm-th${tinte}`} role="columnheader" style={{ width: ancho }} title={ayuda}>
      <button type="button" className="crm-th__boton" onClick={(ev) => onMenu(c.clave, ev.currentTarget)}>
        <span className="crm-th__icono"><IconoCampo tipo={c.tipo} /></span>
        <span className="crm-th__titulo">{c.titulo}</span>
        {c.origen === "agenda" && <MarcaAuto />}
        <ChevronDown size={14} className="crm-th__menu" aria-hidden />
      </button>
      <span className="crm-th__ancho" onPointerDown={(ev) => onAncho(ev, c)} aria-hidden />
    </div>
  );
}

function Celda({ f, c, col, ancho, activa, tinte, alto, onDown, onDoble, abierta, children }: {
  f: FilaCrm; c: CampoCrm; col: number; ancho: number; activa: boolean; tinte: string; alto: number;
  onDown: (ev: React.MouseEvent, id: string, col: number) => void;
  onDoble: () => void;
  abierta?: boolean;
  children: React.ReactNode;
}) {
  const clases = [
    "crm-td",
    `crm-td--${c.tipo}`,
    activa ? "crm-td--activa" : "",
    abierta ? "crm-td--abierta" : "",
    alto > 32 ? "crm-td--alta" : "",
    c.origen !== "equipo" ? "crm-td--auto" : "",
  ].filter(Boolean).join(" ") + tinte;
  return (
    <div
      role="gridcell" data-celda={`${f.id}:${col}`} className={clases} style={{ width: ancho }}
      aria-selected={activa} aria-readonly={c.origen !== "equipo"}
      onMouseDown={(ev) => onDown(ev, f.id, col)}
      onDoubleClick={onDoble}
    >
      {children}
    </div>
  );
}

/* Una línea que se escribe en la celda misma (la grabación). */
function EditorLinea({ valor, inicial, onGuardar, onCerrar }: {
  valor: string; inicial?: string;
  onGuardar: (v: string) => void;
  onCerrar: (mover?: "abajo" | "derecha") => void;
}) {
  const [t, setT] = useState(inicial ?? valor);
  const hecho = useRef(false);
  const ultimo = useRef(t);
  ultimo.current = t;
  const cerrar = (guardarlo: boolean, mover?: "abajo" | "derecha") => {
    if (hecho.current) return;
    hecho.current = true;
    if (guardarlo && t.trim() !== valor) onGuardar(t.trim());
    onCerrar(mover);
  };
  /* Si la fila se va de la pantalla con el editor abierto, se guarda igual. */
  useEffect(() => () => {
    if (!hecho.current && ultimo.current.trim() !== valor) onGuardar(ultimo.current.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      autoFocus className="crm-td__input" value={t} spellCheck={false}
      onChange={(ev) => setT(ev.target.value)}
      onMouseDown={(ev) => ev.stopPropagation()}
      onBlur={() => cerrar(true)}
      onKeyDown={(ev) => {
        if (ev.nativeEvent.isComposing) return;
        if (ev.key === "Enter") { ev.preventDefault(); cerrar(true, "abajo"); }
        else if (ev.key === "Tab") { ev.preventDefault(); cerrar(true, "derecha"); }
        else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cerrar(false); }
      }}
    />
  );
}
