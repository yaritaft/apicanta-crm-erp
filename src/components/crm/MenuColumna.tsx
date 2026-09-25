"use client";

import React, { useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, EyeOff, GripVertical, ListFilter, Pencil, Plus, SquareMenu, Trash2, Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { CAMPO, COLORES, conConfig, estiloColor, opcionesDe, type ClaveCampo } from "@/lib/crm";
import type { Ajustes, CampoOpcionesCrm, ColorCrm, OpcionCrm, OportunidadCrm, Sesion } from "@/lib/types";
import { Chip, Flotante, IconoCampo } from "./piezas";

/* ==================================================================
   El menú del encabezado de una columna: de dónde sale el dato, ordenar,
   filtrar, agrupar, ocultar y —en las listas que carga el equipo—
   editar sus opciones (nombre, color y qué dice de la llamada), como el
   «Editar campo» de Airtable.
   ================================================================== */

const SENTIDO: Partial<Record<string, [string, string]>> = {
  fecha: ["de la más vieja a la más nueva", "de la más nueva a la más vieja"],
};

export function MenuColumna({ clave, ancla, onCerrar, ajustes, sesiones, onOrdenar, onFiltrar, onAgrupar, onOcultar }: {
  clave: ClaveCampo;
  ancla: HTMLElement;
  onCerrar: () => void;
  ajustes: Ajustes;
  sesiones: Sesion[];
  onOrdenar: (desc: boolean) => void;
  onFiltrar: () => void;
  onAgrupar: () => void;
  onOcultar?: () => void;
}) {
  const c = CAMPO[clave];
  const [editando, setEditando] = useState(false);
  if (!c) return null;
  if (editando && c.opciones) {
    return <EditarOpciones campo={c.opciones} titulo={c.titulo} ancla={ancla} onCerrar={onCerrar} ajustes={ajustes} sesiones={sesiones} />;
  }
  const [asc, desc] = SENTIDO[c.tipo] ?? (c.opciones ? ["primero → último", "último → primero"] : ["A → Z", "Z → A"]);
  const agrupable = c.tipo === "seleccion" || c.tipo === "multiple" || c.etiqueta;
  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} className="crm-pop--herr crm-menu-col" ancho={300}>
      <div className="crm-menu-col__info">
        <div className="crm-menu-col__nombre">
          <IconoCampo tipo={c.tipo} />
          <strong>{c.titulo}</strong>
          {c.origen === "agenda" && <span className="crm-origen crm-origen--agenda"><Zap size={11} fill="currentColor" strokeWidth={0} aria-hidden />Se llena sola</span>}
          {c.origen === "equipo" && <span className="crm-origen">La carga el equipo</span>}
          {c.origen === "calculado" && <span className="crm-origen">Fórmula</span>}
        </div>
        <p>{c.fuente}</p>
      </div>
      <div className="crm-pop__lista">
        {c.opciones && (
          <button type="button" className="crm-pop__item" onClick={() => setEditando(true)}>
            <Pencil size={15} aria-hidden />Editar las opciones
          </button>
        )}
        <button type="button" className="crm-pop__item" onClick={() => onOrdenar(false)}>
          <ArrowUp size={15} aria-hidden />Ordenar {asc}
        </button>
        <button type="button" className="crm-pop__item" onClick={() => onOrdenar(true)}>
          <ArrowDown size={15} aria-hidden />Ordenar {desc}
        </button>
        {clave !== "id" && (
          <button type="button" className="crm-pop__item" onClick={onFiltrar}>
            <ListFilter size={15} aria-hidden />Filtrar por este campo
          </button>
        )}
        {agrupable && (
          <button type="button" className="crm-pop__item" onClick={onAgrupar}>
            <SquareMenu size={15} aria-hidden />Agrupar por este campo
          </button>
        )}
        {onOcultar && (
          <button type="button" className="crm-pop__item" onClick={onOcultar}>
            <EyeOff size={15} aria-hidden />Ocultar el campo
          </button>
        )}
      </div>
    </Flotante>
  );
}

/* ---------- Editar las opciones de una lista ---------- */

type Borrador = OpcionCrm & { _k: number; _antes?: string };

const EFECTOS: { valor: "" | "hecha" | "no-show"; texto: string }[] = [
  { valor: "", texto: "No toca la Agenda" },
  { valor: "hecha", texto: "La llamada se hizo" },
  { valor: "no-show", texto: "No vino" },
];

/* Qué dice de la oportunidad: una compra ofrece cargar la venta y la venta
   elige sola cuál; perdida pasa el lead a Perdido (lib/etapas-auto.ts). */
const OPORTUNIDADES: { valor: "" | OportunidadCrm; texto: string }[] = [
  { valor: "", texto: "No toca la etapa" },
  { valor: "compra-full", texto: "Compró al contado" },
  { valor: "compra-cuotas", texto: "Compró en cuotas" },
  { valor: "reserva", texto: "Reservó (seña)" },
  { valor: "downsell", texto: "Compró el downsell" },
  { valor: "perdida", texto: "Oportunidad perdida" },
  /* Perdida aunque ya hubiera comprado. */
  { valor: "devolucion", texto: "Devolución" },
];

const AUTO_TEXTO: Record<NonNullable<OpcionCrm["auto"]>, string> = {
  "no-show": "Se pone sola cuando la llamada queda como que no vino.",
  cancelada: "Se pone sola cuando canceló y no volvió a agendar.",
  segunda: "Se pone sola cuando la persona ya había agendado antes.",
};

function EditarOpciones({ campo, titulo, ancla, onCerrar, ajustes, sesiones }: {
  campo: CampoOpcionesCrm; titulo: string; ancla: HTMLElement; onCerrar: () => void; ajustes: Ajustes; sesiones: Sesion[];
}) {
  const toast = useToast();
  const [ops, setOps] = useState<Borrador[]>(() => opcionesDe(ajustes, campo).map((o, i) => ({ ...o, _k: i, _antes: o.nombre })));
  const [color, setColor] = useState<{ k: number; el: HTMLElement } | null>(null);
  const [arrastra, setArrastra] = useState<number | null>(null);
  const siguiente = useRef(ops.length);
  const usos = (nombre?: string) => (nombre ? sesiones.filter((s) => s[campo] === nombre).length : 0);

  const cambiar = (k: number, parcial: Partial<Borrador>) => setOps((xs) => xs.map((o) => (o._k === k ? { ...o, ...parcial } : o)));

  function guardar() {
    const nombres = ops.map((o) => o.nombre.trim());
    if (nombres.some((n) => !n)) { toast("Todas las opciones necesitan un nombre.", "err"); return; }
    const repetido = nombres.find((n, i) => nombres.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
    if (repetido) { toast(`«${repetido}» está dos veces.`, "err"); return; }
    const antes = opcionesDe(ajustes, campo).map((o) => o.nombre);
    const renombres = [
      ...ops.filter((o) => o._antes && o._antes !== o.nombre.trim()).map((o) => ({ campo, de: o._antes!, a: o.nombre.trim() })),
      /* Una opción que se borra se vacía en las agendas que la tenían, como en Airtable. */
      ...antes.filter((n) => !ops.some((o) => o._antes === n)).map((n) => ({ campo, de: n, a: "" })),
    ];
    const limpias: OpcionCrm[] = ops.map(({ _k, _antes, ...o }) => {
      void _k; void _antes;
      return { ...o, nombre: o.nombre.trim(), ...(o.llamada ? {} : { llamada: undefined }), ...(o.oportunidad ? {} : { oportunidad: undefined }) };
    });
    acciones.configurarCrm(
      conConfig(ajustes, { opciones: { ...(ajustes.crm?.opciones ?? {}), [campo]: limpias } }),
      renombres,
      `Se editaron las opciones de «${titulo}».`,
    );
    const tocadas = renombres.reduce((a, r) => a + usos(r.de), 0);
    toast(tocadas ? `Listo: se actualizaron ${tocadas} ${tocadas === 1 ? "agenda" : "agendas"}.` : `Listo: «${titulo}» tiene sus opciones nuevas.`);
    onCerrar();
  }

  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} className="crm-pop--herr crm-opciones" ancho={campo === "estadoLlamada" ? 700 : 400}>
      <div className="crm-pop__titulo">Opciones de «{titulo}»</div>
      <p className="crm-pop__nota">
        Arrastrá para cambiar el orden (es el orden de la lista y el de ordenar). Renombrar una opción la cambia también en las agendas que la tienen.
        {campo === "estadoLlamada" && " Lo que dice de la llamada la marca en la Agenda; lo que dice de la oportunidad mueve su etapa (una devolución la pierde aunque haya comprado) y, si es una compra, ofrece cargar la venta."}
      </p>
      <div className="crm-opciones__lista">
        {ops.map((o) => {
          const est = estiloColor(o.color);
          return (
            <div
              key={o._k} className="crm-opciones__fila" draggable
              onDragStart={() => setArrastra(o._k)}
              onDragEnd={() => setArrastra(null)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => {
                if (arrastra === null || arrastra === o._k) return;
                setOps((xs) => {
                  const mov = xs.find((x) => x._k === arrastra)!;
                  const sin = xs.filter((x) => x._k !== arrastra);
                  const i = sin.findIndex((x) => x._k === o._k);
                  return [...sin.slice(0, i), mov, ...sin.slice(i)];
                });
              }}
            >
              <GripVertical size={14} className="crm-ocultar__grip" aria-hidden />
              <button
                type="button" className="crm-color" style={{ background: est.fondo }} aria-label={`Color de ${o.nombre}`}
                onClick={(ev) => setColor({ k: o._k, el: ev.currentTarget })}
              />
              <input className="crm-input crm-opciones__nombre" value={o.nombre} aria-label="Nombre de la opción"
                onChange={(ev) => cambiar(o._k, { nombre: ev.target.value })} />
              {campo === "estadoLlamada" && (
                <select className="crm-select crm-opciones__efecto" value={o.llamada ?? ""} aria-label="Qué dice de la llamada"
                  onChange={(ev) => cambiar(o._k, { llamada: (ev.target.value || undefined) as OpcionCrm["llamada"] })}>
                  {EFECTOS.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
                </select>
              )}
              {campo === "estadoLlamada" && (
                <select className="crm-select crm-opciones__efecto crm-opciones__oportunidad" value={o.oportunidad ?? ""} aria-label="Qué dice de la oportunidad"
                  onChange={(ev) => cambiar(o._k, { oportunidad: (ev.target.value || undefined) as OpcionCrm["oportunidad"] })}>
                  {OPORTUNIDADES.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
                </select>
              )}
              {o.auto && <span className="crm-opciones__auto" title={AUTO_TEXTO[o.auto]}><Zap size={11} fill="currentColor" strokeWidth={0} aria-label={AUTO_TEXTO[o.auto]} /></span>}
              <button type="button" className="crm-icono" aria-label={`Borrar ${o.nombre}`}
                title={usos(o._antes) ? `La tienen ${usos(o._antes)} agendas: se vacían.` : "Borrar la opción"}
                onClick={() => setOps((xs) => xs.filter((x) => x._k !== o._k))}>
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <div className="crm-pop__botones crm-pop__botones--entre">
        <button type="button" className="crm-boton crm-boton--link"
          onClick={() => { const k = siguiente.current++; setOps((xs) => [...xs, { _k: k, nombre: "", color: COLORES[(k * 7) % COLORES.length] }]); }}>
          <Plus size={14} aria-hidden />Agregar una opción
        </button>
        <span className="crm-pop__botones">
          <button type="button" className="crm-boton crm-boton--quieto" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="crm-boton crm-boton--azul" onClick={guardar}>Guardar</button>
        </span>
      </div>
      <div className="crm-opciones__muestra" aria-hidden>
        {ops.filter((o) => o.nombre.trim()).map((o) => <Chip key={o._k} texto={o.nombre} color={o.color} />)}
      </div>

      {color && (
        <Flotante ancla={color.el} onCerrar={() => setColor(null)} className="crm-paleta" ancho={232}>
          {COLORES.map((c: ColorCrm) => (
            <button
              key={c} type="button" className={`crm-color crm-color--chico${ops.find((o) => o._k === color.k)?.color === c ? " crm-color--elegido" : ""}`}
              style={{ background: estiloColor(c).fondo }} aria-label={c}
              onClick={() => { cambiar(color.k, { color: c }); setColor(null); }}
            />
          ))}
        </Flotante>
      )}
    </Flotante>
  );
}
