"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Search } from "lucide-react";

/* ==================================================================
   Desplegable y calendario propios.

   El <select> y el <input type="date"> nativos se ven distinto en cada
   sistema (el de Mac es una lista gris, el de Windows otra) y no respetan
   el tema. Estos se ven como el resto de la app, se manejan con teclado
   y mantienen la MISMA API que los nativos: `value` y
   `onChange(ev => ev.target.value)`. Por eso `Select` e `Input` de ui.tsx
   los usan por dentro y ninguna pantalla tuvo que cambiar.

   El panel flotante va al body (encima de modales y del asistente, sin
   que ningún contenedor con scroll lo recorte) y, mientras está abierto,
   lleva `data-flotante-abierto`: así Esc o Enter lo atienden primero a
   él y no cierran el modal o avanzan el asistente de abajo.
   ================================================================== */

type EventoValor = React.ChangeEvent<HTMLSelectElement & HTMLInputElement>;

/* Un evento con la forma que esperan los que usaban el nativo. */
function eventoCon(valor: string): EventoValor {
  const target = { value: valor } as HTMLSelectElement & HTMLInputElement;
  return { target, currentTarget: target } as unknown as EventoValor;
}

/* ---------- Panel flotante ---------- */

interface Posicion { top: number; left: number; width: number; arriba: boolean; maxAlto: number }

function usePosicion(ancla: React.RefObject<HTMLElement | null>, abierto: boolean, alto: number, anchoMin: number) {
  const [pos, setPos] = useState<Posicion | null>(null);
  const calcular = useCallback(() => {
    const el = ancla.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margen = 8;
    const abajo = window.innerHeight - r.bottom - margen;
    const encima = r.top - margen;
    const arriba = abajo < Math.min(alto, 240) && encima > abajo;
    const width = Math.max(r.width, anchoMin);
    const left = Math.min(Math.max(margen, r.left), window.innerWidth - width - margen);
    setPos({
      top: arriba ? r.top - 6 : r.bottom + 6,
      left, width, arriba,
      maxAlto: Math.max(160, (arriba ? encima : abajo) - 6),
    });
  }, [ancla, alto, anchoMin]);

  useLayoutEffect(() => { if (abierto) calcular(); }, [abierto, calcular]);
  useEffect(() => {
    if (!abierto) return;
    window.addEventListener("resize", calcular);
    window.addEventListener("scroll", calcular, true);
    return () => {
      window.removeEventListener("resize", calcular);
      window.removeEventListener("scroll", calcular, true);
    };
  }, [abierto, calcular]);
  return pos;
}

/* Cierra al tocar afuera del ancla y del panel. */
function useClicAfuera(abierto: boolean, refs: React.RefObject<HTMLElement | null>[], cerrar: () => void) {
  useEffect(() => {
    if (!abierto) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      cerrar();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [abierto, refs, cerrar]);
}

function Panel({ pos, children, panelRef, ancho, className = "" }: {
  pos: Posicion; children: React.ReactNode; panelRef: React.RefObject<HTMLDivElement | null>;
  ancho?: number; className?: string;
}) {
  return createPortal(
    <div
      ref={panelRef}
      className={`flotante ${className}`}
      data-flotante-abierto=""
      style={{
        position: "fixed", left: pos.left, width: ancho ?? pos.width,
        ...(pos.arriba ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
        maxHeight: pos.maxAlto,
      }}
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ================================================================
   Desplegable
   ================================================================ */

export interface OpcionSelect { valor: string; texto: string }

export function Desplegable({
  opciones, placeholder, error, value, onChange, disabled, autoFocus, id, name, style, className,
  "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby,
}: {
  opciones: readonly (string | OpcionSelect)[];
  placeholder?: string;
  error?: boolean;
  value?: string | number | readonly string[];
  onChange?: (ev: EventoValor) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  style?: React.CSSProperties;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const lista = useMemo<OpcionSelect[]>(() => {
    const xs = opciones.map((o) => (typeof o === "string" ? { valor: o, texto: o } : o));
    /* Como en el nativo, el placeholder es una opción más: la que vacía. */
    return placeholder ? [{ valor: "", texto: placeholder }, ...xs] : xs;
  }, [opciones, placeholder]);
  const valor = value === undefined || value === null ? "" : String(value);
  const elegida = lista.find((o) => o.valor === valor);

  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(0);
  const [q, setQ] = useState("");
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();
  const conBuscador = lista.length > 8;

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? lista.filter((o) => o.texto.toLowerCase().includes(t)) : lista;
  }, [lista, q]);

  const pos = usePosicion(boton, abierto, Math.min(visibles.length * 38 + (conBuscador ? 52 : 12), 340), 200);
  const cerrar = useCallback(() => { setAbierto(false); setQ(""); }, []);
  const refs = useMemo(() => [boton, panel], []);
  useClicAfuera(abierto, refs, cerrar);

  function abrir() {
    if (disabled) return;
    setQ("");
    setActiva(Math.max(0, lista.findIndex((o) => o.valor === valor)));
    setAbierto(true);
  }

  function elegir(o: OpcionSelect) {
    cerrar();
    boton.current?.focus();
    if (o.valor !== valor) onChange?.(eventoCon(o.valor));
  }

  /* Con el panel abierto el foco va al buscador (o a la lista). */
  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => {
      (panel.current?.querySelector<HTMLElement>(".sel__buscar input") ?? listaRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [abierto]);

  /* La opción activa siempre a la vista. */
  useEffect(() => {
    if (!abierto) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${activa}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activa, abierto]);

  /* Escribir con la lista cerrada salta a la primera opción que empieza así. */
  const tipeo = useRef({ texto: "", hasta: 0 });
  function saltarPorLetra(tecla: string) {
    const ahora = Date.now();
    tipeo.current = { texto: (ahora < tipeo.current.hasta ? tipeo.current.texto : "") + tecla.toLowerCase(), hasta: ahora + 700 };
    const i = lista.findIndex((o) => o.valor !== "" && o.texto.toLowerCase().startsWith(tipeo.current.texto));
    if (i >= 0 && lista[i].valor !== valor) onChange?.(eventoCon(lista[i].valor));
  }

  function teclaBoton(ev: React.KeyboardEvent) {
    if (disabled) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault(); ev.stopPropagation(); abrir();
    } else if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault(); ev.stopPropagation(); saltarPorLetra(ev.key);
    }
  }

  function teclaPanel(ev: React.KeyboardEvent) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActiva((i) => Math.min(i + 1, visibles.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActiva((i) => Math.max(i - 1, 0)); }
    else if (ev.key === "Home") { ev.preventDefault(); setActiva(0); }
    else if (ev.key === "End") { ev.preventDefault(); setActiva(visibles.length - 1); }
    else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); const o = visibles[activa]; if (o) elegir(o); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cerrar(); boton.current?.focus(); }
    else if (ev.key === "Tab") { cerrar(); }
  }

  return (
    <div className={`sel-caja${className ? ` ${className}` : ""}`} style={style}>
      <button
        ref={boton} type="button" id={id}
        className={`hk-input hk-input--select sel${error ? " hk-input--error" : ""}`}
        aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? idLista : undefined}
        aria-label={ariaLabel} aria-labelledby={ariaLabelledby}
        disabled={disabled} autoFocus={autoFocus}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={teclaBoton}
      >
        <span className={`sel__valor${!elegida || elegida.valor === "" ? " sel__valor--vacio" : ""}`}>
          {elegida?.texto ?? placeholder ?? "Elegí una opción"}
        </span>
      </button>
      {name && <input type="hidden" name={name} value={valor} />}

      {abierto && pos && (
        <Panel pos={pos} panelRef={panel} className="sel__panel">
          <div onKeyDown={teclaPanel} style={{ display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "inherit" }}>
            {conBuscador && (
              <div className="sel__buscar">
                <Search size={15} />
                <input
                  value={q} placeholder="Buscar…" aria-label="Buscar opción"
                  onChange={(ev) => { setQ(ev.target.value); setActiva(0); }}
                />
              </div>
            )}
            <div
              ref={listaRef} id={idLista} role="listbox" tabIndex={-1} className="sel__lista"
              aria-activedescendant={visibles[activa] ? `${idLista}-${activa}` : undefined}
              aria-label={ariaLabel}
            >
              {visibles.length === 0 && <div className="sel__vacio">Nada coincide</div>}
              {visibles.map((o, i) => (
                <div
                  key={`${o.valor}-${i}`} id={`${idLista}-${i}`} data-i={i}
                  role="option" aria-selected={o.valor === valor}
                  className={`sel__opcion${i === activa ? " sel__opcion--activa" : ""}${o.valor === "" ? " sel__opcion--vacia" : ""}`}
                  onMouseEnter={() => setActiva(i)}
                  onClick={() => elegir(o)}
                >
                  <span className="truncate">{o.texto}</span>
                  {o.valor === valor && <Check size={15} className="sel__check" />}
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ================================================================
   Calendario (fecha, y fecha y hora)
   ================================================================ */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DOWS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const dos = (n: number) => String(n).padStart(2, "0");
const isoDe = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
function desdeIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function CampoFecha({
  value, onChange, conHora = false, disabled, autoFocus, min, max, required, placeholder, id, style, className,
  "aria-label": ariaLabel,
}: {
  value?: string | number | readonly string[];
  onChange?: (ev: EventoValor) => void;
  /* type="datetime-local": el valor es "aaaa-mm-ddThh:mm" */
  conHora?: boolean;
  /* Todas las fechas de la app son obligatorias: "Borrar" aparece sólo
     con required={false} explícito (un filtro, por ejemplo). */
  disabled?: boolean;
  autoFocus?: boolean;
  min?: string | number;
  max?: string | number;
  required?: boolean;
  placeholder?: string;
  id?: string;
  style?: React.CSSProperties;
  className?: string;
  "aria-label"?: string;
}) {
  const valor = value === undefined || value === null ? "" : String(value);
  const dia = valor.slice(0, 10);
  const horaActual = conHora ? (valor.slice(11, 16) || "") : "";
  const fecha = desdeIso(dia);
  const minimo = min ? String(min).slice(0, 10) : null;
  const maximo = max ? String(max).slice(0, 10) : null;

  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState(() => { const d = fecha ?? new Date(); return d.getFullYear() * 12 + d.getMonth(); });
  const [foco, setFoco] = useState<string>(dia || isoDe(new Date()));
  const [hora, setHora] = useState(horaActual || "19:00");
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grilla = useRef<HTMLDivElement>(null);

  const pos = usePosicion(boton, abierto, conHora ? 380 : 330, 272);
  const cerrar = useCallback(() => setAbierto(false), []);
  const refs = useMemo(() => [boton, panel], []);
  useClicAfuera(abierto, refs, cerrar);

  function abrir() {
    if (disabled) return;
    const d = fecha ?? new Date();
    setVista(d.getFullYear() * 12 + d.getMonth());
    setFoco(dia || isoDe(new Date()));
    setHora(horaActual || "19:00");
    setAbierto(true);
  }

  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => grilla.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [abierto]);

  const fuera = (iso: string) => Boolean((minimo && iso < minimo) || (maximo && iso > maximo));

  function emitir(nuevoDia: string, nuevaHora = hora) {
    if (!nuevoDia) { onChange?.(eventoCon("")); return; }
    onChange?.(eventoCon(conHora ? `${nuevoDia}T${/^\d{2}:\d{2}$/.test(nuevaHora) ? nuevaHora : "00:00"}` : nuevoDia));
  }

  function elegir(iso: string) {
    if (fuera(iso)) return;
    emitir(iso);
    if (!conHora) { cerrar(); boton.current?.focus(); }
    else setFoco(iso);
  }

  /* Con teclas seguidas el render no llega a actualizar `foco`: se mueve
     desde el ref, que siempre tiene el último. */
  const focoRef = useRef(foco);
  focoRef.current = foco;
  function irA(d: Date) {
    const nuevo = isoDe(d);
    focoRef.current = nuevo;
    setFoco(nuevo);
    setVista(d.getFullYear() * 12 + d.getMonth());
  }
  function moverFoco(dias: number) {
    const d = desdeIso(focoRef.current) ?? new Date();
    d.setDate(d.getDate() + dias);
    irA(d);
  }

  function teclaGrilla(ev: React.KeyboardEvent) {
    const mapa: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (ev.key in mapa) { ev.preventDefault(); moverFoco(mapa[ev.key]); }
    else if (ev.key === "PageUp" || ev.key === "PageDown") {
      ev.preventDefault();
      const d = desdeIso(focoRef.current) ?? new Date();
      d.setMonth(d.getMonth() + (ev.key === "PageUp" ? -1 : 1));
      irA(d);
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault(); ev.stopPropagation();
      elegir(focoRef.current);
      if (conHora) { cerrar(); boton.current?.focus(); }
    }
  }

  function teclaPanel(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cerrar(); boton.current?.focus(); }
    if (ev.key === "Enter") ev.stopPropagation();
  }

  const texto = fecha
    ? `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}${conHora && horaActual ? `, ${horaActual}` : ""}`
    : (placeholder ?? (conHora ? "Elegí fecha y hora" : "Elegí una fecha"));

  const y = Math.floor(vista / 12), m = vista % 12;
  const huecos = (new Date(y, m, 1).getDay() + 6) % 7;
  const cantidad = new Date(y, m + 1, 0).getDate();
  const hoy = isoDe(new Date());

  return (
    <div className={`sel-caja${className ? ` ${className}` : ""}`} style={style}>
      <button
        ref={boton} type="button" id={id}
        className="hk-input fecha" aria-haspopup="dialog" aria-expanded={abierto}
        aria-label={ariaLabel ? `${ariaLabel}: ${fecha ? texto : "sin fecha"}` : undefined}
        disabled={disabled} autoFocus={autoFocus}
        onClick={() => (abierto ? cerrar() : abrir())}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); abrir(); }
        }}
      >
        <span className={`sel__valor t-num${fecha ? "" : " sel__valor--vacio"}`}>{texto}</span>
        <CalendarDays size={16} />
      </button>

      {abierto && pos && (
        <Panel pos={pos} panelRef={panel} ancho={272} className="fecha__panel">
          <div onKeyDown={teclaPanel} role="dialog" aria-label={ariaLabel ?? "Elegir fecha"}>
            <div className="fecha__nav">
              <button type="button" className="dp-nav-btn" aria-label="Mes anterior" onClick={() => setVista((v) => v - 1)}>
                <ChevronLeft size={15} />
              </button>
              <span className="fecha__mes">{MESES[m]} {y}</span>
              <button type="button" className="dp-nav-btn" aria-label="Mes siguiente" onClick={() => setVista((v) => v + 1)}>
                <ChevronRight size={15} />
              </button>
            </div>
            <div
              ref={grilla} className="dp-grid fecha__grilla" role="grid" tabIndex={0}
              aria-label={`${MESES[m]} de ${y}`} onKeyDown={teclaGrilla}
            >
              {DOWS.map((d) => <span key={d} className="dp-dow">{d}</span>)}
              {Array.from({ length: huecos }, (_, i) => <span key={`h${i}`} />)}
              {Array.from({ length: cantidad }, (_, i) => {
                const iso = isoDe(new Date(y, m, i + 1));
                const cls = `dp-day${iso === dia ? " dp-day--edge" : ""}${iso === hoy ? " dp-day--today" : ""}${fuera(iso) ? " dp-day--off" : ""}${iso === foco ? " fecha__foco" : ""}`;
                return (
                  <span key={iso} className={cls} role="gridcell" aria-selected={iso === dia} onClick={() => elegir(iso)}>
                    {i + 1}
                  </span>
                );
              })}
            </div>

            {conHora && (
              <label className="fecha__hora">
                <span className="t-sm t-subtle">Hora</span>
                <input
                  value={hora} inputMode="numeric" placeholder="19:00" aria-label="Hora (hh:mm)" maxLength={5}
                  onChange={(ev) => {
                    let t = ev.target.value.replace(/[^\d:]/g, "");
                    if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
                    setHora(t);
                    const ok = /^([01]?\d|2[0-3]):[0-5]\d$/.test(t);
                    if (ok && (dia || foco)) emitir(dia || foco, t.padStart(5, "0"));
                  }}
                />
              </label>
            )}

            <div className="fecha__pie">
              <button type="button" className="link t-sm" onClick={() => { const h = isoDe(new Date()); if (!fuera(h)) { elegir(h); setVista(new Date().getFullYear() * 12 + new Date().getMonth()); } }}>
                Hoy
              </button>
              {required === false && valor && (
                <button type="button" className="link t-sm" style={{ color: "var(--ink-subtle)" }} onClick={() => { emitir(""); cerrar(); boton.current?.focus(); }}>
                  Borrar
                </button>
              )}
              {conHora && (
                <button type="button" className="hk-btn hk-btn--primary hk-btn--sm" style={{ marginLeft: "auto" }}
                  onClick={() => { if (!dia) elegir(foco); cerrar(); boton.current?.focus(); }}>
                  Listo
                </button>
              )}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
