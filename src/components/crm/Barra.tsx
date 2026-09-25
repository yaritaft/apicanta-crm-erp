"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp, Check, ChevronDown, Copy, EyeOff, GripVertical, ListChevronsUpDown, ListFilter,
  PaintBucket, Pencil, Plus, RotateCcw, Search, Sheet, SquareArrowOutUpRight, SquareMenu, Trash2, X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  CAMPO, CAMPOS, PERIODOS, completa, nuevaCondicion, operadoresDe, sinTildes, tipoDeFiltro, valoresDe,
  type ClaveCampo, type Condicion, type FilaCrm, type Orden, type Pintor, type VistaCrm,
} from "@/lib/crm";
import type { CampoOpcionesCrm, OpcionCrm } from "@/lib/types";
import { Chip, Flotante, IconoCampo, MarcaAuto } from "./piezas";
import type { AltoFila } from "./Grilla";
import type { AjusteVista } from "./useVistas";

/* ==================================================================
   La barra de la vista: el nombre (con su menú) y las herramientas de
   Airtable a la derecha — ocultar campos, filtrar, agrupar, ordenar,
   color, alto de fila, compartir y buscar. Cada una se prende de su
   color cuando está en uso, como en Airtable.
   ================================================================== */

type Herramienta = "ocultar" | "filtrar" | "agrupar" | "ordenar" | "color" | "alto" | "vista" | null;

export interface PropsBarra {
  vista: VistaCrm;
  esPropia: boolean;
  cambiada: boolean;
  filtros: Condicion[];
  conjuncion: "y" | "o";
  orden: Orden[];
  ocultos: ClaveCampo[];
  columnas: ClaveCampo[];
  alto: AltoFila;
  agrupar: ClaveCampo | null;
  color: CampoOpcionesCrm | null;
  filas: FilaCrm[];
  opciones: Record<CampoOpcionesCrm, OpcionCrm[]>;
  pintar: Pintor;
  onCambiar: (parcial: AjusteVista) => void;
  onRestablecer: () => void;
  onRenombrar: (nombre: string) => void;
  onBorrar: () => void;
  onDuplicar: (nombre: string) => void;
  buscando: boolean;
  onBuscando: (v: boolean) => void;
  /* El «+» de la grilla abre «Ocultar campos» pegado a él. */
  pedirCampos: HTMLElement | null;
  onPedirCampos: (el: HTMLElement | null) => void;
  /* «Filtrar por este campo», desde el encabezado de una columna. */
  filtrarPor?: ClaveCampo | null;
  onFiltrarUsado?: () => void;
}

const ALTOS_TEXTO: { valor: AltoFila; texto: string }[] = [
  { valor: "corta", texto: "Corta" }, { valor: "media", texto: "Media" },
  { valor: "alta", texto: "Alta" }, { valor: "extra", texto: "Extra alta" },
];

const CAMPOS_COLOR: { valor: CampoOpcionesCrm; texto: string }[] = [
  { valor: "estadoLlamada", texto: "Estado de Llamada" },
  { valor: "preCall", texto: "Pre-Call" },
  { valor: "estadoPreCall", texto: "Estado Pre-Call" },
];

export function BarraVista(p: PropsBarra) {
  const toast = useToast();
  const [abierta, setAbierta] = useState<Herramienta>(null);
  const refs = {
    vista: useRef<HTMLButtonElement>(null),
    ocultar: useRef<HTMLButtonElement>(null),
    filtrar: useRef<HTMLButtonElement>(null),
    agrupar: useRef<HTMLButtonElement>(null),
    ordenar: useRef<HTMLButtonElement>(null),
    color: useRef<HTMLButtonElement>(null),
    alto: useRef<HTMLButtonElement>(null),
  };
  const alternar = (h: Herramienta) => setAbierta((a) => (a === h ? null : h));
  const cerrar = () => setAbierta(null);

  /* «Filtrar por este campo»: abre el filtro con una condición nueva. */
  useEffect(() => {
    if (!p.filtrarPor) return;
    const campo = p.filtrarPor;
    p.onCambiar({ filtros: [...p.filtros, nuevaCondicion({ campo, op: operadoresDe(tipoDeFiltro(CAMPO[campo]))[0].valor })] });
    setAbierta("filtrar");
    p.onFiltrarUsado?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.filtrarPor]);

  const nOcultos = p.ocultos.length;
  const nFiltros = p.filtros.filter((c) => c.campo !== "lanzamiento" && completa(c)).length;

  function copiarLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete("registro");
    navigator.clipboard?.writeText(url.toString()).then(
      () => toast("Link copiado: el que lo abra ve esta misma vista."),
      () => toast("No se pudo copiar. Copiá la dirección desde la barra del navegador.", "err"),
    );
  }

  return (
    <>
      <button ref={refs.vista} type="button" className="crm-vista-nombre" onClick={() => alternar("vista")} aria-expanded={abierta === "vista"}>
        <Sheet size={16} className="crm-vista-nombre__icono" aria-hidden />
        {p.vista.marca && <span className={`crm-marca crm-marca--${p.vista.marca.forma}`} style={{ background: p.vista.marca.color }} aria-hidden />}
        <span className="crm-vista-nombre__txt">
          {p.vista.nombre}
          {p.vista.de && <span className="crm-vista-nombre__de"> · {p.vista.de}</span>}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {p.cambiada && (
        <button type="button" className="crm-cambiada" onClick={p.onRestablecer} title="Volver a como venía esta vista">
          <RotateCcw size={12} aria-hidden />Restablecer
        </button>
      )}

      <span className="crm-barra__espacio" />

      <div className="crm-herramientas" role="toolbar" aria-label="Herramientas de la vista">
        <BotonHerramienta r={refs.ocultar} etiqueta={nOcultos ? `${nOcultos} ${nOcultos === 1 ? "campo oculto" : "campos ocultos"}` : "Ocultar campos"}
          activo={nOcultos > 0} tono="ocultar" abierto={abierta === "ocultar"} onClick={() => alternar("ocultar")}>
          <EyeOff size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta r={refs.filtrar} etiqueta={nFiltros ? `Filtrado por ${nFiltros} ${nFiltros === 1 ? "campo" : "campos"}` : "Filtrar"}
          activo={nFiltros > 0} tono="filtrar" abierto={abierta === "filtrar"} onClick={() => alternar("filtrar")}>
          <ListFilter size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta r={refs.agrupar} etiqueta={p.agrupar ? `Agrupado por ${CAMPO[p.agrupar]?.titulo}` : "Agrupar"}
          activo={Boolean(p.agrupar)} tono="agrupar" abierto={abierta === "agrupar"} onClick={() => alternar("agrupar")}>
          <SquareMenu size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta r={refs.ordenar} etiqueta={p.orden.length ? `Ordenado por ${p.orden.length} ${p.orden.length === 1 ? "campo" : "campos"}` : "Ordenar"}
          activo={p.orden.length > 0} tono="ordenar" abierto={abierta === "ordenar"} onClick={() => alternar("ordenar")}>
          <ArrowDownUp size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta r={refs.color} etiqueta={p.color ? `Color según ${CAMPOS_COLOR.find((c) => c.valor === p.color)?.texto}` : "Color"}
          activo={Boolean(p.color)} tono="color" abierto={abierta === "color"} onClick={() => alternar("color")}>
          <PaintBucket size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta r={refs.alto} etiqueta="Alto de las filas" abierto={abierta === "alto"} onClick={() => alternar("alto")}>
          <ListChevronsUpDown size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta etiqueta="Copiar el link de esta vista" onClick={copiarLink}>
          <SquareArrowOutUpRight size={18} aria-hidden />
        </BotonHerramienta>
        <BotonHerramienta etiqueta="Buscar" activo={p.buscando} tono="buscar" onClick={() => p.onBuscando(!p.buscando)}>
          <Search size={18} aria-hidden />
        </BotonHerramienta>
      </div>

      {abierta === "vista" && (
        <MenuVista
          ancla={refs.vista.current} onCerrar={cerrar} vista={p.vista} esPropia={p.esPropia} cambiada={p.cambiada}
          onRestablecer={() => { p.onRestablecer(); cerrar(); }}
          onRenombrar={(n) => { p.onRenombrar(n); cerrar(); }}
          onBorrar={() => { p.onBorrar(); cerrar(); }}
          onDuplicar={(n) => { p.onDuplicar(n); cerrar(); }}
          onCopiar={() => { copiarLink(); cerrar(); }}
        />
      )}
      {(abierta === "ocultar" || p.pedirCampos) && (
        <PopOcultar
          ancla={p.pedirCampos ?? refs.ocultar.current}
          alinear={p.pedirCampos ? "derecha" : "derecha"}
          onCerrar={() => { cerrar(); p.onPedirCampos(null); }}
          columnas={p.columnas} ocultos={p.ocultos}
          onCambiar={(ocultos, columnas) => p.onCambiar({ ocultos, ...(columnas ? { columnas } : {}) })}
        />
      )}
      {abierta === "filtrar" && (
        <PopFiltrar
          ancla={refs.filtrar.current} onCerrar={cerrar}
          filtros={p.filtros} conjuncion={p.conjuncion} filas={p.filas} opciones={p.opciones} pintar={p.pintar}
          onCambiar={(filtros, conjuncion) => p.onCambiar({ filtros, ...(conjuncion ? { conjuncion } : {}) })}
          hayOcultos={p.filtros.some((c) => c.campo === "lanzamiento")}
        />
      )}
      {abierta === "agrupar" && (
        <Flotante ancla={refs.agrupar.current} onCerrar={cerrar} alinear="derecha" className="crm-pop--herr" ancho={340}>
          <div className="crm-pop__titulo">Agrupar por</div>
          {p.agrupar ? (
            <div className="crm-regla">
              <SelectorCampo valor={p.agrupar} onCambiar={(c) => p.onCambiar({ agrupar: c })} excluir={["notas", "grabacion", "id", "email", "telefono"]} />
              <button type="button" className="crm-icono" aria-label="Sacar el grupo" onClick={() => p.onCambiar({ agrupar: null })}><Trash2 size={15} aria-hidden /></button>
            </div>
          ) : (
            <div className="crm-pop__lista">
              {CAMPOS.filter((c) => ["seleccion", "multiple"].includes(c.tipo) || c.etiqueta).map((c) => (
                <button key={c.clave} type="button" className="crm-pop__item" onClick={() => p.onCambiar({ agrupar: c.clave })}>
                  <IconoCampo tipo={c.tipo} />{c.titulo}{c.origen === "agenda" && <MarcaAuto />}
                </button>
              ))}
            </div>
          )}
        </Flotante>
      )}
      {abierta === "ordenar" && (
        <PopOrdenar ancla={refs.ordenar.current} onCerrar={cerrar} orden={p.orden} onCambiar={(orden) => p.onCambiar({ orden })} />
      )}
      {abierta === "color" && (
        <Flotante ancla={refs.color.current} onCerrar={cerrar} alinear="derecha" className="crm-pop--herr" ancho={300}>
          <div className="crm-pop__titulo">Colorear los registros según</div>
          <div className="crm-pop__lista">
            {[{ valor: null, texto: "Ninguno" }, ...CAMPOS_COLOR].map((c) => (
              <button key={c.valor ?? "nada"} type="button" className="crm-pop__item" onClick={() => { p.onCambiar({ color: c.valor }); cerrar(); }}>
                <span className="crm-pop__check">{p.color === c.valor && <Check size={14} aria-hidden />}</span>
                {c.texto}
              </button>
            ))}
          </div>
          <p className="crm-pop__nota">Cada fila lleva a la izquierda el color de la opción elegida.</p>
        </Flotante>
      )}
      {abierta === "alto" && (
        <Flotante ancla={refs.alto.current} onCerrar={cerrar} alinear="derecha" className="crm-pop--herr" ancho={200}>
          <div className="crm-pop__titulo">Alto de las filas</div>
          <div className="crm-pop__lista">
            {ALTOS_TEXTO.map((a) => (
              <button key={a.valor} type="button" className="crm-pop__item" onClick={() => { p.onCambiar({ alto: a.valor }); cerrar(); }}>
                <span className="crm-pop__check">{p.alto === a.valor && <Check size={14} aria-hidden />}</span>
                {a.texto}
              </button>
            ))}
          </div>
        </Flotante>
      )}
    </>
  );
}

function BotonHerramienta({ r, etiqueta, activo, tono, abierto, onClick, children }: {
  r?: React.RefObject<HTMLButtonElement | null>; etiqueta: string; activo?: boolean; tono?: string; abierto?: boolean;
  onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      ref={r} type="button"
      className={`crm-herr${activo && tono ? ` crm-herr--${tono}` : ""}${abierto ? " crm-herr--abierto" : ""}`}
      aria-label={etiqueta} title={etiqueta} aria-expanded={abierto}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- El menú de la vista ---------- */

function MenuVista({ ancla, onCerrar, vista, esPropia, cambiada, onRestablecer, onRenombrar, onBorrar, onDuplicar, onCopiar }: {
  ancla: HTMLElement | null; onCerrar: () => void; vista: VistaCrm; esPropia: boolean; cambiada: boolean;
  onRestablecer: () => void; onRenombrar: (n: string) => void; onBorrar: () => void; onDuplicar: (n: string) => void; onCopiar: () => void;
}) {
  const [nombre, setNombre] = useState<string | null>(null);
  const [modo, setModo] = useState<"renombrar" | "duplicar">("renombrar");
  if (nombre !== null) {
    return (
      <Flotante ancla={ancla} onCerrar={onCerrar} className="crm-pop--herr" ancho={300}>
        <div className="crm-pop__titulo">{modo === "renombrar" ? "Nombre de la vista" : "La vista nueva se llama"}</div>
        <form onSubmit={(ev) => { ev.preventDefault(); if (nombre.trim()) (modo === "renombrar" ? onRenombrar : onDuplicar)(nombre.trim()); }}>
          <input autoFocus className="crm-input" value={nombre} onChange={(ev) => setNombre(ev.target.value)} aria-label="Nombre de la vista" />
          <div className="crm-pop__botones">
            <button type="button" className="crm-boton crm-boton--quieto" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="crm-boton crm-boton--azul" disabled={!nombre.trim()}>{modo === "renombrar" ? "Guardar" : "Crear vista"}</button>
          </div>
        </form>
      </Flotante>
    );
  }
  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} className="crm-pop--herr" ancho={260}>
      <div className="crm-pop__lista">
        {esPropia && (
          <button type="button" className="crm-pop__item" onClick={() => { setModo("renombrar"); setNombre(vista.nombre); }}>
            <Pencil size={15} aria-hidden />Cambiarle el nombre
          </button>
        )}
        <button type="button" className="crm-pop__item" onClick={() => { setModo("duplicar"); setNombre(`${vista.nombre} (copia)`); }}>
          <Copy size={15} aria-hidden />Duplicar la vista
        </button>
        <button type="button" className="crm-pop__item" onClick={onCopiar}>
          <SquareArrowOutUpRight size={15} aria-hidden />Copiar el link
        </button>
        {cambiada && (
          <button type="button" className="crm-pop__item" onClick={onRestablecer}>
            <RotateCcw size={15} aria-hidden />Restablecer la vista
          </button>
        )}
        {esPropia && (
          <button type="button" className="crm-pop__item crm-pop__item--peligro" onClick={onBorrar}>
            <Trash2 size={15} aria-hidden />Borrar la vista
          </button>
        )}
      </div>
      {!esPropia && <p className="crm-pop__nota">Esta vista se arma sola. Lo que cambies (columnas, filtros, orden) queda sólo en tu navegador.</p>}
    </Flotante>
  );
}

/* ---------- Ocultar campos ---------- */

function PopOcultar({ ancla, alinear, onCerrar, columnas, ocultos, onCambiar }: {
  ancla: HTMLElement | null; alinear: "izquierda" | "derecha"; onCerrar: () => void;
  columnas: ClaveCampo[]; ocultos: ClaveCampo[];
  onCambiar: (ocultos: ClaveCampo[], columnas?: ClaveCampo[]) => void;
}) {
  const [q, setQ] = useState("");
  const [arrastra, setArrastra] = useState<ClaveCampo | null>(null);
  const [sobre, setSobre] = useState<ClaveCampo | null>(null);
  const set = new Set(ocultos);
  const lista = columnas.filter((k) => sinTildes(CAMPO[k].titulo).includes(sinTildes(q)));
  const soltar = (hasta: ClaveCampo) => {
    if (!arrastra || arrastra === hasta) return;
    const sin = columnas.filter((k) => k !== arrastra);
    const i = sin.indexOf(hasta);
    onCambiar(ocultos, [...sin.slice(0, i), arrastra, ...sin.slice(i)]);
  };
  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} alinear={alinear} className="crm-pop--herr crm-ocultar" ancho={330}>
      <div className="crm-pop__buscar">
        <Search size={14} aria-hidden />
        <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar un campo" aria-label="Buscar un campo" />
      </div>
      <p className="crm-pop__nota crm-pop__nota--leyenda"><MarcaAuto /> Se llena sola con la agenda de Calendly</p>
      <div className="crm-pop__lista crm-ocultar__lista">
        {lista.map((k) => {
          const c = CAMPO[k];
          const visible = !set.has(k);
          return (
            <div
              key={k} className={`crm-ocultar__item${sobre === k ? " crm-ocultar__item--sobre" : ""}`}
              draggable={!q}
              onDragStart={() => setArrastra(k)}
              onDragEnd={() => { setArrastra(null); setSobre(null); }}
              onDragOver={(ev) => { ev.preventDefault(); setSobre(k); }}
              onDrop={() => { soltar(k); setArrastra(null); setSobre(null); }}
            >
              <button
                type="button" role="switch" aria-checked={visible} aria-label={`${visible ? "Ocultar" : "Mostrar"} ${c.titulo}`}
                className={`crm-switch${visible ? " crm-switch--on" : ""}`}
                onClick={() => onCambiar(visible ? [...ocultos, k] : ocultos.filter((x) => x !== k))}
              >
                <span className="crm-switch__bola" />
              </button>
              <span className="crm-ocultar__icono"><IconoCampo tipo={c.tipo} /></span>
              <span className="crm-ocultar__nombre" title={c.fuente}>{c.titulo}</span>
              {c.origen === "agenda" && <MarcaAuto />}
              {!q && <GripVertical size={14} className="crm-ocultar__grip" aria-hidden />}
            </div>
          );
        })}
      </div>
      <div className="crm-pop__botones crm-pop__botones--parejos">
        <button type="button" className="crm-boton crm-boton--quieto" onClick={() => onCambiar(columnas)}>Ocultar todos</button>
        <button type="button" className="crm-boton crm-boton--quieto" onClick={() => onCambiar([])}>Mostrar todos</button>
      </div>
    </Flotante>
  );
}

/* ---------- Filtrar ---------- */

const CAMPOS_FILTRO = CAMPOS.filter((c) => c.clave !== "id");

function PopFiltrar({ ancla, onCerrar, filtros, conjuncion, filas, opciones, pintar, onCambiar, hayOcultos }: {
  ancla: HTMLElement | null; onCerrar: () => void;
  filtros: Condicion[]; conjuncion: "y" | "o"; filas: FilaCrm[];
  opciones: Record<CampoOpcionesCrm, OpcionCrm[]>; pintar: Pintor;
  onCambiar: (filtros: Condicion[], conjuncion?: "y" | "o") => void;
  hayOcultos: boolean;
}) {
  /* La condición del lanzamiento es la vista misma: no se muestra ni se toca. */
  const visibles = filtros.filter((c) => c.campo !== "lanzamiento");
  const fijas = filtros.filter((c) => c.campo === "lanzamiento");
  const poner = (xs: Condicion[]) => onCambiar([...fijas, ...xs]);
  const cambiar = (id: string, parcial: Partial<Condicion>) => poner(visibles.map((c) => (c.id === id ? { ...c, ...parcial } : c)));
  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} alinear="derecha" className="crm-pop--herr crm-filtrar" ancho={Math.min(640, typeof window === "undefined" ? 640 : window.innerWidth - 24)}>
      <div className="crm-pop__titulo">{visibles.length ? "En esta vista, mostrar los registros" : "Todavía no hay filtros en esta vista"}</div>
      {hayOcultos && <p className="crm-pop__nota">Además, la vista muestra sólo las agendas de su lanzamiento.</p>}
      <div className="crm-filtrar__reglas">
        {visibles.map((c, i) => {
          const campo = CAMPO[c.campo];
          const tipo = tipoDeFiltro(campo);
          const ops = operadoresDe(tipo);
          const conValores = c.op !== "vacio" && c.op !== "no-vacio";
          return (
            <div key={c.id} className="crm-regla crm-regla--filtro">
              <span className="crm-regla__une">
                {i === 0 ? "Donde" : i === 1 ? (
                  <select className="crm-select" value={conjuncion} onChange={(ev) => onCambiar(filtros, ev.target.value as "y" | "o")} aria-label="Cómo se juntan las condiciones">
                    <option value="y">y</option>
                    <option value="o">o</option>
                  </select>
                ) : conjuncion}
              </span>
              <SelectorCampo
                valor={c.campo}
                onCambiar={(k) => cambiar(c.id, { campo: k, op: operadoresDe(tipoDeFiltro(CAMPO[k]))[0].valor, valor: undefined })}
                excluir={["id"]}
              />
              <select className="crm-select" value={c.op} aria-label="Condición" onChange={(ev) => cambiar(c.id, { op: ev.target.value as Condicion["op"] })}>
                {ops.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
              </select>
              {conValores ? (
                tipo === "fecha" ? (
                  <select className="crm-select crm-regla__valor" value={String(c.valor ?? "")} aria-label="Período" onChange={(ev) => cambiar(c.id, { valor: ev.target.value })}>
                    <option value="">Elegí…</option>
                    {PERIODOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
                  </select>
                ) : tipo === "seleccion" || tipo === "multiple" ? (
                  <ElegirValores
                    campo={c.campo} valor={Array.isArray(c.valor) ? c.valor : c.valor ? [c.valor] : []}
                    opciones={campo?.opciones ? opciones[campo.opciones].map((o) => o.nombre) : valoresDe(filas, c.campo)}
                    pintar={pintar} onCambiar={(xs) => cambiar(c.id, { valor: xs })}
                  />
                ) : (
                  <input
                    className="crm-input crm-regla__valor" value={String(c.valor ?? "")} placeholder="Escribí un valor…"
                    aria-label="Valor" onChange={(ev) => cambiar(c.id, { valor: ev.target.value })}
                  />
                )
              ) : <span className="crm-regla__valor" />}
              <button type="button" className="crm-icono" aria-label="Sacar esta condición" onClick={() => poner(visibles.filter((x) => x.id !== c.id))}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <div className="crm-pop__botones crm-pop__botones--izq">
        <button type="button" className="crm-boton crm-boton--link" onClick={() => poner([...visibles, nuevaCondicion({ campo: "estadoLlamada", op: "alguno" })])}>
          <Plus size={14} aria-hidden />Agregar condición
        </button>
      </div>
    </Flotante>
  );
}

function SelectorCampo({ valor, onCambiar, excluir = [] }: { valor: ClaveCampo; onCambiar: (k: ClaveCampo) => void; excluir?: ClaveCampo[] }) {
  return (
    <select className="crm-select" value={valor} aria-label="Campo" onChange={(ev) => onCambiar(ev.target.value as ClaveCampo)}>
      {CAMPOS_FILTRO.filter((c) => !excluir.includes(c.clave)).map((c) => (
        <option key={c.clave} value={c.clave}>{c.titulo}</option>
      ))}
    </select>
  );
}

/* Varias opciones de una lista, con sus etiquetas. */
function ElegirValores({ campo, valor, opciones, pintar, onCambiar }: {
  campo: ClaveCampo; valor: string[]; opciones: string[]; pintar: Pintor; onCambiar: (xs: string[]) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const lista = opciones.filter((o) => sinTildes(o).includes(sinTildes(q)));
  return (
    <>
      <button ref={ref} type="button" className="crm-select crm-regla__valor crm-valores" onClick={() => setAbierto((v) => !v)} aria-label="Elegir valores">
        {valor.length === 0 ? <span className="crm-valores__vacio">Elegí una opción…</span> : valor.map((x) => <Chip key={x} texto={x} color={pintar(campo, x)} />)}
      </button>
      {abierto && (
        <Flotante ancla={ref.current} onCerrar={() => setAbierto(false)} className="crm-selector" ancho={260}>
          <input autoFocus className="crm-selector__buscar" placeholder="Encuentra una opción" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Buscar una opción" />
          <div className="crm-selector__lista" role="listbox" aria-multiselectable>
            {lista.map((o) => {
              const on = valor.includes(o);
              return (
                <div key={o} role="option" aria-selected={on} className="crm-selector__op"
                  onMouseDown={(ev) => { ev.preventDefault(); onCambiar(on ? valor.filter((x) => x !== o) : [...valor, o]); }}>
                  <Chip texto={o} color={pintar(campo, o)} />
                  {on && <Check size={14} className="crm-selector__check" aria-hidden />}
                </div>
              );
            })}
            {lista.length === 0 && <div className="crm-selector__vacio">Ninguna opción coincide</div>}
          </div>
        </Flotante>
      )}
    </>
  );
}

/* ---------- Ordenar ---------- */

function sentidos(k: ClaveCampo): [string, string] {
  const c = CAMPO[k];
  if (c?.tipo === "fecha") return ["La más vieja primero", "La más nueva primero"];
  if (c?.opciones) return ["Primero → último", "Último → primero"];
  if (k === "mes") return ["1 → 12", "12 → 1"];
  return ["A → Z", "Z → A"];
}

function PopOrdenar({ ancla, onCerrar, orden, onCambiar }: {
  ancla: HTMLElement | null; onCerrar: () => void; orden: Orden[]; onCambiar: (o: Orden[]) => void;
}) {
  const libres = CAMPOS_FILTRO.filter((c) => !orden.some((o) => o.campo === c.clave));
  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} alinear="derecha" className="crm-pop--herr" ancho={440}>
      <div className="crm-pop__titulo">Ordenar por</div>
      {orden.map((o, i) => {
        const [asc, desc] = sentidos(o.campo);
        return (
          <div key={`${o.campo}-${i}`} className="crm-regla">
            <SelectorCampo valor={o.campo} onCambiar={(k) => onCambiar(orden.map((x, j) => (j === i ? { ...x, campo: k } : x)))} />
            <select className="crm-select" value={o.desc ? "desc" : "asc"} aria-label="Sentido"
              onChange={(ev) => onCambiar(orden.map((x, j) => (j === i ? { ...x, desc: ev.target.value === "desc" } : x)))}>
              <option value="asc">{asc}</option>
              <option value="desc">{desc}</option>
            </select>
            <button type="button" className="crm-icono" aria-label="Sacar este orden" onClick={() => onCambiar(orden.filter((_, j) => j !== i))}>
              <X size={15} aria-hidden />
            </button>
          </div>
        );
      })}
      {libres.length > 0 && (
        <div className="crm-pop__botones crm-pop__botones--izq">
          <button type="button" className="crm-boton crm-boton--link" onClick={() => onCambiar([...orden, { campo: libres[0].clave, desc: false }])}>
            <Plus size={14} aria-hidden />{orden.length ? "Agregar otro orden" : "Elegir un campo para ordenar"}
          </button>
        </div>
      )}
    </Flotante>
  );
}
