"use client";

import React, { useId, useRef, useState } from "react";
import { useAncho } from "@/components/charts/charts";
import { Forma, SoloLector, type Marca } from "./comun";

/* Un gráfico en el tiempo con una o dos series, en líneas o en barras
   agrupadas. SVG propio, sin librerías.

   - Al pasar el mouse (o un dedo) aparece el valor de cada serie en ese punto.
   - Con el teclado: se entra con Tab y se recorre con las flechas (Inicio y
     Fin saltan a los extremos); Enter fija el punto y Escape lo suelta.
   - Un clic fija el punto; la leyenda prende y apaga cada serie.
   - No se apoya sólo en el color: cada serie tiene su forma de marca (círculo,
     rombo) y las barras del cobro llevan rayas. Los números van además en una
     tabla para lectores de pantalla. */

export interface SerieTiempo {
  id: string;
  nombre: string;
  color: string;
  borde: string;
  marca: Marca;
  /* Las barras de esta serie van rayadas. */
  patron?: boolean;
  valores: (number | null)[];
}

export interface PuntoTiempo {
  clave: string;
  /* Lo que se lee abajo, en el eje: corto. */
  eje: string;
  /* Lo que dice el tooltip: «jue 1 oct», «Septiembre 2026». */
  titulo: string;
}

/* Un techo y marcas redondas: 0, 25 mil, 50 mil… en vez de 0, 31.250, 62.500. */
function escala(max: number, partes = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const bruto = max / partes;
  const exp = Math.pow(10, Math.floor(Math.log10(bruto)));
  const f = bruto / exp;
  const paso = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  const top = Math.ceil(max / paso - 1e-9) * paso;
  const ticks: number[] = [];
  for (let k = 0; k * paso <= top + paso / 1000; k++) ticks.push(k * paso);
  return { top, ticks };
}

const acotar = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

export function GraficoTiempo({
  etiqueta, puntos, series, modo, formato, formatoEje, alto = 260, referencia, minimoMax = 0, techo, area, extra, sinDatos,
}: {
  /* Qué es, para quien no lo ve: «Revenue y Cash Collected por día». */
  etiqueta: string;
  puntos: PuntoTiempo[];
  series: SerieTiempo[];
  modo: "lineas" | "barras";
  formato: (n: number) => string;
  formatoEje: (n: number) => string;
  alto?: number;
  /* Una línea punteada, como el 100% de la tasa de cobro. */
  referencia?: { valor: number; texto: string };
  /* Que el eje llegue por lo menos hasta acá (el 100% en una tasa). */
  minimoMax?: number;
  /* El valor más alto que se dibuja: lo que lo pasa se corta en el borde de
     arriba (con una flecha) y su valor real está en el tooltip. Sirve para
     una tasa por día, donde un día sin ventas da 800% y aplasta a los demás. */
  techo?: number;
  /* Rellena debajo de la primera serie (para una sola línea). */
  area?: boolean;
  /* Más líneas en el tooltip de un punto (la variación contra el paso anterior). */
  extra?: (i: number) => React.ReactNode;
  /* Qué decir cuando no hay nada para dibujar. */
  sinDatos?: string;
}) {
  const [caja, W] = useAncho();
  const svg = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [activo, setActivo] = useState<number | null>(null);
  const [fijo, setFijo] = useState(false);

  const n = puntos.length;
  const visibles = series.filter((s) => !ocultas.has(s.id));
  const alternar = (id: string) => setOcultas((prev) => {
    const sig = new Set(prev);
    if (sig.has(id)) sig.delete(id);
    else if (visibles.length > 1) sig.add(id);
    return sig;
  });

  if (n === 0) return <div className="gr-vacio">No hay columnas para dibujar en este período.</div>;
  /* Sin un solo valor mayor que cero no hay qué dibujar: un eje de 0 a 1 no dice nada. */
  if (!series.some((s) => s.valores.some((v) => v !== null && v > 0))) {
    return <div className="gr-vacio gr-vacio--grafico" style={{ minHeight: Math.round(alto * 0.6) }} role="status">{sinDatos ?? "Sin movimiento en este período."}</div>;
  }

  const piso = Math.max(0, minimoMax, referencia?.valor ?? 0);
  const datoMax = Math.max(piso, ...visibles.flatMap((s) => s.valores.filter((v): v is number => v !== null)));
  const { top, ticks } = escala(techo !== undefined ? Math.min(datoMax, Math.max(techo, piso)) : datoMax);
  const cortados = visibles.reduce((a, s) => a + s.valores.filter((v) => v !== null && v > top).length, 0);
  const textosY = ticks.map(formatoEje);
  const P = { t: 12, r: 14, b: 26, l: Math.ceil(Math.max(...textosY.map((s) => s.length)) * 6.3) + 14 };
  const H = alto, iw = W - P.l - P.r, ih = H - P.t - P.b;
  const y = (v: number) => P.t + ih - (Math.min(v, top) / top) * ih;
  const paso = iw / n;
  /* Una línea necesita aire a los costados para que el primer y el último punto no se corten. */
  const holgura = modo === "lineas" ? Math.min(16, iw / (2 * n)) : 0;
  const x = (i: number) => (modo === "barras" ? P.l + (i + 0.5) * paso : P.l + holgura + (n === 1 ? (iw - 2 * holgura) / 2 : (i / (n - 1)) * (iw - 2 * holgura)));

  const masLargo = Math.max(...puntos.map((p) => p.eje.length));
  const salto = Math.max(1, Math.ceil((n * (masLargo * 6.2 + 12)) / Math.max(iw, 1)));

  const indiceDe = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    const px = clientX - (r?.left ?? 0);
    if (modo === "barras") return acotar(Math.floor((px - P.l) / paso), 0, n - 1);
    const util = iw - 2 * holgura;
    return n === 1 ? 0 : acotar(Math.round(((px - P.l - holgura) / util) * (n - 1)), 0, n - 1);
  };

  const trazo = (valores: (number | null)[]) => {
    let d = "", abierto = false;
    valores.forEach((v, i) => {
      if (v === null) { abierto = false; return; }
      d += `${abierto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      abierto = true;
    });
    return d;
  };
  const rellenar = (valores: (number | null)[]) => {
    /* Cada tramo seguido, cerrado contra el eje. */
    const tramos: number[][] = [];
    let actual: number[] = [];
    valores.forEach((v, i) => { if (v === null) { if (actual.length) tramos.push(actual); actual = []; } else actual.push(i); });
    if (actual.length) tramos.push(actual);
    return tramos.filter((t) => t.length > 1).map((t) => `M${x(t[0]).toFixed(1)},${(P.t + ih).toFixed(1)}${t.map((i) => `L${x(i).toFixed(1)},${y(valores[i] as number).toFixed(1)}`).join("")}L${x(t[t.length - 1]).toFixed(1)},${(P.t + ih).toFixed(1)}Z`).join(" ");
  };

  const textoDe = (i: number) =>
    `${puntos[i].titulo}: ${visibles.map((s) => `${s.nombre} ${s.valores[i] === null ? "sin dato" : formato(s.valores[i] as number)}`).join(", ")}`;

  const teclas = (ev: React.KeyboardEvent) => {
    const k = ev.key;
    if (k === "ArrowRight" || k === "ArrowLeft" || k === "Home" || k === "End") {
      ev.preventDefault();
      setActivo((a) => (k === "Home" ? 0 : k === "End" ? n - 1 : acotar((a ?? (k === "ArrowRight" ? -1 : n)) + (k === "ArrowRight" ? 1 : -1), 0, n - 1)));
    } else if (k === "Enter" || k === " ") {
      ev.preventDefault();
      if (activo === null) setActivo(n - 1);
      else setFijo((f) => !f);
    } else if (k === "Escape") {
      setFijo(false); setActivo(null);
    }
  };

  const gx = activo === null ? 0 : x(activo);
  const aLaDerecha = gx < W / 2;
  /* El tooltip va al costado del punto, sin salirse de la caja. */
  const tope = Math.max(4, W - 224);
  const guiaAncho = modo === "barras" ? paso : 0;

  return (
    <div className="gr-grafico">
      <div className="gr-leyenda" role="group" aria-label="Series: tocá una para ocultarla o mostrarla">
        {series.map((s) => (
          <button
            key={s.id} type="button" className="gr-leyenda__item" aria-pressed={!ocultas.has(s.id)}
            onClick={() => alternar(s.id)} title={ocultas.has(s.id) ? `Mostrar ${s.nombre}` : `Ocultar ${s.nombre}`}
          >
            <Forma forma={s.marca} color={s.color} borde={s.borde} patron={modo === "barras" && s.patron} />
            {s.nombre}
          </button>
        ))}
      </div>

      <div
        className="gr-caja" ref={caja} tabIndex={0} role="group" aria-roledescription="gráfico"
        aria-label={`${etiqueta}. Con las flechas recorrés los puntos; Enter fija uno y Escape lo suelta.`}
        onKeyDown={teclas}
        onFocus={(ev) => { if (activo === null && ev.currentTarget.matches(":focus-visible")) setActivo(n - 1); }}
        onBlur={() => { if (!fijo) setActivo(null); }}
      >
        <svg
          ref={svg} className="chart gr-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden
          onPointerMove={(ev) => { if (!fijo) setActivo(indiceDe(ev.clientX)); }}
          onPointerLeave={() => { if (!fijo) setActivo(null); }}
          onClick={(ev) => {
            const i = indiceDe(ev.clientX);
            if (fijo && activo === i) { setFijo(false); return; }
            setActivo(i); setFijo(true);
          }}
        >
          <defs>
            {series.filter((s) => s.patron).map((s) => (
              <pattern key={s.id} id={`gr-p-${uid}-${s.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={s.color} />
                <rect width="2.2" height="6" fill="var(--surface-100)" opacity=".55" />
              </pattern>
            ))}
            {area && visibles[0] && (
              <linearGradient id={`gr-a-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={visibles[0].color} stopOpacity=".28" />
                <stop offset="100%" stopColor={visibles[0].color} stopOpacity="0" />
              </linearGradient>
            )}
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className={t === 0 ? "gr-eje" : "gr-malla"} />
              <text x={P.l - 8} y={y(t) + 4} textAnchor="end" className="gr-texto-eje">{formatoEje(t)}</text>
            </g>
          ))}
          {referencia && (
            <g>
              <line x1={P.l} x2={W - P.r} y1={y(referencia.valor)} y2={y(referencia.valor)} className="gr-referencia" />
              <text x={P.l + 6} y={y(referencia.valor) - 5} textAnchor="start" className="gr-texto-eje gr-texto-ref">{referencia.texto}</text>
            </g>
          )}

          {activo !== null && (modo === "barras"
            ? <rect x={x(activo) - guiaAncho / 2} y={P.t} width={guiaAncho} height={ih} className="gr-guia-banda" />
            : <line x1={gx} x2={gx} y1={P.t} y2={P.t + ih} className="gr-guia" />)}

          {modo === "barras" ? (() => {
            const k = visibles.length;
            const grupo = Math.min(paso * 0.76, 58 * k);
            const ancho = Math.max(2, grupo / k - (k > 1 ? 2 : 0));
            return visibles.map((s, j) => s.valores.map((v, i) => {
              if (v === null) return null;
              const h = Math.max((Math.min(v, top) / top) * ih, v > 0 ? 2 : 0);
              const x0 = x(i) - grupo / 2 + j * (grupo / k) + (grupo / k - ancho) / 2;
              return (
                <rect
                  key={`${s.id}-${i}`} x={x0} y={P.t + ih - h} width={ancho} height={h} rx={Math.min(3, ancho / 2)}
                  fill={s.patron ? `url(#gr-p-${uid}-${s.id})` : s.color} stroke={s.borde} strokeWidth="1"
                  opacity={activo === null || activo === i ? 1 : 0.55}
                />
              );
            }));
          })() : visibles.map((s, j) => (
            <g key={s.id}>
              {area && j === 0 && <path d={rellenar(s.valores)} fill={`url(#gr-a-${uid})`} />}
              <path d={trazo(s.valores)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {s.valores.map((v, i) => {
                if (v === null) return null;
                const aislado = (i === 0 || s.valores[i - 1] === null) && (i === n - 1 || s.valores[i + 1] === null);
                if (!(n <= 40 || aislado || activo === i)) return null;
                const r = activo === i ? 5.5 : n > 40 ? 3 : 3.8;
                return <Marcador key={i} forma={s.marca} cx={x(i)} cy={y(v)} r={r} color={s.color} borde={s.borde} />;
              })}
              {s.valores.map((v, i) => {
                /* Pasa del techo: una flecha en el borde de arriba, para que no parezca que el dato es ése. */
                if (v === null || v <= top) return null;
                const cx = x(i), cy = P.t;
                return <path key={`corte-${i}`} d={`M${cx - 4.5},${cy + 7}L${cx},${cy - 1}L${cx + 4.5},${cy + 7}Z`} fill={s.color} stroke={s.borde} strokeWidth="1" />;
              })}
            </g>
          ))}

          {puntos.map((p, i) => ((n - 1 - i) % salto === 0 ? (
            <text key={p.clave} x={x(i)} y={H - 8} textAnchor="middle" className="gr-texto-eje">{p.eje}</text>
          ) : null))}
        </svg>

        {activo !== null && (
          <div className="gr-tip" aria-hidden style={{ top: P.t + 6, ...(aLaDerecha ? { left: acotar(gx + 14, 4, tope) } : { right: acotar(W - gx + 14, 4, tope) }) }}>
            <strong className="gr-tip__titulo">{puntos[activo].titulo}</strong>
            {visibles.map((s) => (
              <div key={s.id} className="gr-tip__fila">
                <Forma forma={s.marca} color={s.color} borde={s.borde} patron={modo === "barras" && s.patron} />
                <span className="gr-tip__nombre">{s.nombre}</span>
                <span className="gr-tip__valor">{s.valores[activo] === null ? "—" : formato(s.valores[activo] as number)}</span>
              </div>
            ))}
            {extra?.(activo)}
            {fijo && <span className="gr-tip__pie">Fijado · tocá de nuevo o apretá Escape</span>}
          </div>
        )}
      </div>

      {cortados > 0 && (
        <p className="gr-nota-chica">
          ▲ {cortados === 1 ? "Un punto pasa" : `${cortados} puntos pasan`} de {formatoEje(top)}: se dibuja en el borde de arriba y su valor real está en el tooltip.
        </p>
      )}

      <SoloLector vivo>{activo !== null ? textoDe(activo) : ""}</SoloLector>
      {/* Una tabla no se achica con width ni overflow: va dentro de una caja oculta que la recorta. */}
      <div className="gr-sr"><table>
        <caption>{etiqueta}</caption>
        <thead><tr><th scope="col">Período</th>{series.map((s) => <th key={s.id} scope="col">{s.nombre}</th>)}</tr></thead>
        <tbody>
          {puntos.map((p, i) => (
            <tr key={p.clave}>
              <th scope="row">{p.titulo}</th>
              {series.map((s) => <td key={s.id}>{s.valores[i] === null ? "sin dato" : formato(s.valores[i] as number)}</td>)}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Marcador({ forma, cx, cy, r, color, borde }: { forma: Marca; cx: number; cy: number; r: number; color: string; borde: string }) {
  const comun = { fill: color, stroke: borde, strokeWidth: 1.5 };
  if (forma === "rombo") return <rect x={cx - r * 0.85} y={cy - r * 0.85} width={r * 1.7} height={r * 1.7} transform={`rotate(45 ${cx} ${cy})`} {...comun} />;
  if (forma === "cuadrado") return <rect x={cx - r * 0.85} y={cy - r * 0.85} width={r * 1.7} height={r * 1.7} rx="1" {...comun} />;
  return <circle cx={cx} cy={cy} r={r} {...comun} />;
}
