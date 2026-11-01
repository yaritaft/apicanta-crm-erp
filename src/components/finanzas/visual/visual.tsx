"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import "./visual.css";

/* ==================================================================
   Las piezas con las que Finanzas muestra la cuenta en vez de contarla:
   las partes de un total, una cascada, un avance, un medidor, señales de
   una línea y lo que se pliega. No calculan nada: dibujan lo que les pasan.
   ================================================================== */

/** «US$ 1.234,56» con los centavos más tenues: se lee el dólar y el centavo sigue ahí. */
export function Cifra({ texto }: { texto: string }) {
  const m = /^(.*),(\d{2})$/.exec(texto);
  if (!m) return <>{texto}</>;
  return <>{m[1]}<span className="fz-cents">,{m[2]}</span></>;
}

const COLORES = ["var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-1)"];

export interface Parte { id: string; nombre: string; valor: number; texto: string; ayuda?: string; tono?: "alerta" | "bien" | "apagado" }

/** Una barra con las partes de un total, en el mismo orden que su leyenda. */
export function PartesDeUnTotal({ partes, etiqueta, onElegir, activo }: {
  partes: Parte[]; etiqueta: string;
  /* Con esto, la barra y la leyenda también filtran lo que sigue abajo. */
  onElegir?: (id: string) => void; activo?: string;
}) {
  const total = partes.reduce((a, p) => a + Math.max(p.valor, 0), 0) || 1;
  /* La rampa la gastan sólo las partes sin tono propio: así no se repite un violeta mientras queden. */
  const sinTono = partes.filter((p) => !p.tono);
  const color = (p: Parte) => (p.tono === "alerta" ? "var(--warning)" : p.tono === "bien" ? "var(--success)" : p.tono === "apagado" ? "color-mix(in srgb, var(--ink-subtle) 45%, transparent)" : COLORES[sinTono.indexOf(p) % COLORES.length]);
  const atenuado = (p: Parte) => (activo && activo !== p.id ? { opacity: 0.35 } : undefined);
  return (
    <div className="fz-partes" role="group" aria-label={etiqueta}>
      <div className="fz-partes__barra" aria-hidden>
        {partes.map((p) => {
          if (p.valor <= 0) return null;
          const estilo = { flexGrow: p.valor / total, flexBasis: 0, background: color(p), ...atenuado(p) };
          return onElegir
            ? <button key={p.id} type="button" tabIndex={-1} className="fz-partes__tramo" style={estilo} title={`${p.nombre}: ${p.texto}`} onClick={() => onElegir(p.id)} />
            : <span key={p.id} className="fz-partes__tramo" style={estilo} title={`${p.nombre}: ${p.texto}`} />;
        })}
      </div>
      <ul className="fz-partes__leyenda">
        {partes.map((p) => {
          const dentro = (
            <>
              <span className="fz-partes__nombre"><span className="fz-partes__muestra" style={{ background: color(p) }} aria-hidden />{p.nombre}</span>
              <span className="fz-partes__valor">{p.texto}</span>
            </>
          );
          return (
            <li key={p.id} className="fz-partes__item" title={p.ayuda}>
              {onElegir
                ? <button type="button" className="fz-partes__boton" aria-pressed={activo === p.id} onClick={() => onElegir(p.id)}>{dentro}</button>
                : dentro}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Cuánto va de un total: lo pagado de lo que hay que pagar, las cuotas cobradas. */
export function Avance({ hecho, total, izquierda, derecha, tono = "bien" }: {
  hecho: number; total: number; izquierda: React.ReactNode; derecha?: React.ReactNode; tono?: "bien" | "brand" | "alerta";
}) {
  const parte = total > 0 ? Math.min(hecho / total, 1) : 0;
  return (
    <div className="fz-avance">
      <div className="fz-avance__cab"><span>{izquierda}</span>{derecha && <span>{derecha}</span>}</div>
      <div className="fz-avance__pista" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(parte * 100)}>
        {parte > 0 && <div className="fz-avance__lleno" data-tono={tono} style={{ width: `${parte * 100}%` }} />}
      </div>
    </div>
  );
}

export interface PasoCascada {
  id: string; nombre: string;
  /* Con su signo: lo que suma en positivo, lo que resta en negativo. El primero y el último son el total hasta ahí. */
  valor: number;
  texto: string;
  tipo: "base" | "suma" | "resta" | "total";
  ayuda?: string;
  onClick?: () => void;
}

/** La plata de punta a punta, siempre de izquierda a derecha: lo que entra llena la barra, lo que sale la va consumiendo desde
    la izquierda y el resultado es lo que queda al final, a la derecha. */
export function Cascada({ pasos, etiqueta }: { pasos: PasoCascada[]; etiqueta: string }) {
  /* El total de lo que entró: de ahí sale el largo de la barra y dónde termina el resultado. */
  const lleno = pasos.reduce((a, p) => (p.tipo === "base" || p.tipo === "suma" ? a + p.valor : a), 0);
  let entra = 0, sale = 0;
  const tramos = pasos.map((p) => {
    if (p.tipo === "base" || p.tipo === "suma") { const t = { desde: entra, hasta: entra + p.valor }; entra += p.valor; return t; }
    if (p.tipo === "resta") { const n = Math.abs(p.valor); const t = { desde: sale, hasta: sale + n }; sale += n; return t; }
    /* El resultado termina donde termina lo que entró; si es negativo, es lo que se pasó de largo. */
    return p.valor >= 0 ? { desde: lleno - p.valor, hasta: lleno } : { desde: lleno, hasta: lleno - p.valor };
  });
  const tope = Math.max(lleno, ...tramos.map((t) => t.hasta));
  const escala = tope > 0 ? 100 / tope : 0;
  return (
    <div className="fz-cascada" role="list" aria-label={etiqueta}>
      {pasos.map((p, i) => {
        const t = tramos[i];
        const negativo = p.tipo === "total" && p.valor < 0;
        const izq = Math.max(t.desde, 0) * escala;
        const ancho = Math.max(t.hasta - t.desde, 0) * escala;
        const dentro = (
          <>
            <span className="fz-cascada__nombre" title={p.ayuda ?? p.nombre}>{p.nombre}</span>
            <span className="fz-cascada__pista" aria-hidden><span className="fz-cascada__barra" style={{ left: `${izq}%`, width: `${ancho}%` }} /></span>
            <span className="fz-cascada__monto">{p.texto}</span>
          </>
        );
        const comunes = { "data-tipo": p.tipo, "data-negativo": negativo ? true : undefined };
        return p.onClick
          ? <button key={p.id} type="button" className="fz-cascada__fila" {...comunes} onClick={p.onClick} role="listitem">{dentro}</button>
          : <div key={p.id} className="fz-cascada__fila" {...comunes} role="listitem">{dentro}</div>;
      })}
    </div>
  );
}

/** Dónde estamos contra un objetivo. */
export function Medidor({ valor, unidad, parte, tono, desde, hasta, etiqueta }: {
  valor: string; unidad: string; parte: number; tono?: "alerta" | "bien"; desde: string; hasta: string; etiqueta: string;
}) {
  const p = Math.max(0, Math.min(parte, 1));
  return (
    <div className="fz-medidor">
      <div className="fz-medidor__cab">
        <span className="fz-medidor__valor">{valor}</span>
        <span className="fz-medidor__unidad">{unidad}</span>
      </div>
      <div className="fz-medidor__pista" role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
        <div className="fz-medidor__lleno" data-tono={tono} style={{ width: `${p * 100}%` }} />
      </div>
      <div className="fz-medidor__marcas"><span>{desde}</span><span>{hasta}</span></div>
    </div>
  );
}

/** La caja de señales: lo que hay que mirar, de a una línea. */
export function Senales({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="fz-senales" aria-label={titulo}>
      <h3 className="fz-senales__tit">{titulo}</h3>
      {children}
    </section>
  );
}

/** Una línea. Si trae `children`, se abre al tocarla. */
export function Senal({ tono = "info", icono, titulo, sub, der, children, abiertaDeEntrada = false }: {
  tono?: "info" | "atencion" | "urgente" | "bien";
  icono: React.ReactNode; titulo: React.ReactNode; sub?: React.ReactNode; der?: React.ReactNode;
  children?: React.ReactNode; abiertaDeEntrada?: boolean;
}) {
  const [abierta, setAbierta] = useState(abiertaDeEntrada);
  const textos = (
    <>
      <span className="fz-senal__icono" aria-hidden>{icono}</span>
      <span className="fz-senal__textos">
        <span className="fz-senal__titulo">{titulo}</span>
        {sub && <span className="fz-senal__sub">{sub}</span>}
      </span>
    </>
  );
  return (
    <div className="fz-senal" data-tono={tono} data-abierta={abierta || undefined}>
      {children ? (
        <button type="button" className="fz-senal__fila" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
          {textos}
          <span className="fz-senal__der">{der}<ChevronRight size={16} className="fz-senal__chev" aria-hidden /></span>
        </button>
      ) : (
        <div className="fz-senal__fila">
          {textos}
          {der && <span className="fz-senal__der">{der}</span>}
        </div>
      )}
      {children && abierta && <div className="fz-senal__cuerpo">{children}</div>}
    </div>
  );
}

/** Un título y un resumen de una línea; lo demás, al tocarlo. */
export function Plegable({ titulo, resumen, children, pegado = false, abiertoDeEntrada = false, antes }: {
  titulo: React.ReactNode; resumen?: React.ReactNode; children: React.ReactNode; pegado?: boolean; abiertoDeEntrada?: boolean; antes?: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(abiertoDeEntrada);
  return (
    <section className="fz-plegable" data-abierta={abierto || undefined}>
      <button type="button" className="fz-plegable__cab" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <ChevronRight size={16} className="fz-plegable__chev" aria-hidden />
        <span className="fz-plegable__titulo">{titulo}</span>
        {resumen && <span className="fz-plegable__resumen">{resumen}</span>}
      </button>
      {antes}
      {abierto && <div className={`fz-plegable__cuerpo${pegado ? " fz-plegable__cuerpo--pegado" : ""}`}>{children}</div>}
    </section>
  );
}

/** Dos formas de mirar lo mismo. */
export function Segmentado<T extends string>({ valor, opciones, onCambiar, etiqueta }: {
  valor: T; opciones: { valor: T; texto: React.ReactNode }[]; onCambiar: (v: T) => void; etiqueta: string;
}) {
  return (
    <div className="fz-seg" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.valor} type="button" className="fz-seg__op" aria-pressed={valor === o.valor} onClick={() => onCambiar(o.valor)}>{o.texto}</button>
      ))}
    </div>
  );
}
