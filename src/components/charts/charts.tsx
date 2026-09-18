"use client";

import React, { useId, useMemo, useState } from "react";

/* Gráficos en SVG puro: sin dependencias, con tooltip y accesibles. */

export interface Punto {
  /* Lo que se lee abajo del eje: corto, porque el espacio es poco. */
  etiqueta: string;
  valor: number;
  valor2?: number;
  /* El nombre entero, para el tooltip. Si falta, se usa `etiqueta`. */
  completo?: string;
}

/* Corta por caracteres, no por palabras: "Cómo conseguir tu primer…" dice algo,
   "Cómo conseguir" no. */
export function truncar(texto: string, largo: number): string {
  return texto.length <= largo ? texto : `${texto.slice(0, largo - 1).trimEnd()}…`;
}

const C = {
  brand: "var(--brand)", accent: "var(--accent)", success: "var(--success)",
  danger: "var(--danger)", info: "var(--info)", warning: "var(--warning)",
  grid: "var(--border)", texto: "var(--ink-subtle)",
};

/* El eje Y lleva montos como "US$ 80.000". Con un margen fijo la etiqueta
   se sale de la tarjeta, así que se calcula a partir de la más larga.
   11px de Geist miden ~6,2px por carácter; +16 de aire contra el borde. */
function margenIzquierdo(etiquetas: string[]): number {
  const masLarga = Math.max(0, ...etiquetas.map((e) => e.length));
  return Math.ceil(masLarga * 6.2) + 16;
}

function escalaMax(datos: number[]): number {
  const m = Math.max(...datos, 0);
  if (m === 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(m)));
  return Math.ceil(m / exp) * exp;
}

/* ---------------- Área / Línea ---------------- */

export function AreaChart({ datos, alto = 200, formato, color = C.accent, color2 = C.brand, serie2 }: {
  datos: Punto[]; alto?: number; formato?: (n: number) => string;
  color?: string; color2?: string; serie2?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const f = formato ?? ((n: number) => String(n));

  const max = useMemo(() => escalaMax(datos.flatMap((d) => [d.valor, d.valor2 ?? 0])), [datos]);
  const ticks = useMemo(() => [0, 0.5, 1].map((t) => max * t), [max]);

  const W = 640, H = alto;
  /* A la derecha hay que dejar media etiqueta del eje X, que va centrada. */
  const P = { t: 12, r: 18, b: 26, l: margenIzquierdo(ticks.map(f)) };

  if (datos.length === 0) return <div className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>Sin datos todavía.</div>;

  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const x = (i: number) => P.l + (datos.length === 1 ? iw / 2 : (i / (datos.length - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / max) * ih;

  const linea = (k: "valor" | "valor2") =>
    datos.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[k] ?? 0).toFixed(1)}`).join(" ");
  const area = `${linea("valor")} L${x(datos.length - 1).toFixed(1)},${(P.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(P.t + ih).toFixed(1)} Z`;

  return (
    <div style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de evolución" preserveAspectRatio="none" style={{ height: alto }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
            <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.texto}>{f(t)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#g${gid})`} />
        {serie2 && <path d={linea("valor2")} fill="none" stroke={color2} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" />}
        <path d={linea("valor")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {datos.map((d, i) => (
          <g key={i}>
            <text
              x={x(i)} y={H - 8} fontSize="11" fill={C.texto}
              textAnchor={i === 0 ? "start" : i === datos.length - 1 ? "end" : "middle"}
            >{d.etiqueta}</text>
            <circle cx={x(i)} cy={y(d.valor)} r={hover === i ? 5 : 3.5} fill={color} stroke="var(--surface-100)" strokeWidth="2" />
            <rect x={x(i) - iw / (datos.length * 2)} y={P.t} width={iw / datos.length} height={ih} fill="transparent"
              onMouseEnter={() => setHover(i)} style={{ cursor: "crosshair" }} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div style={{
          position: "absolute", top: 4, left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)",
          background: "var(--surface-300)", border: "1px solid var(--border-strong)", borderRadius: 8,
          padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "var(--shadow-md)",
        }}>
          <strong>{datos[hover].completo ?? datos[hover].etiqueta}</strong>{" · "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{f(datos[hover].valor)}</span>
          {serie2 && <> · <span style={{ color: "var(--ink-subtle)" }}>{serie2} {f(datos[hover].valor2 ?? 0)}</span></>}
        </div>
      )}
      {serie2 && (
        <div className="chart-legend">
          <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: color }} />Ingresos</span>
          <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: color2 }} />{serie2}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Barras ---------------- */

export function BarChart({ datos, alto = 200, formato, color = C.brand }: {
  datos: Punto[]; alto?: number; formato?: (n: number) => string; color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const f = formato ?? ((n: number) => String(n));

  const max = useMemo(() => escalaMax(datos.map((d) => d.valor)), [datos]);
  const ticks = useMemo(() => [0, 0.5, 1].map((t) => max * t), [max]);

  const W = 640, H = alto;
  const P = { t: 12, r: 18, b: 26, l: margenIzquierdo(ticks.map(f)) };

  if (datos.length === 0) return <div className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>Sin datos todavía.</div>;

  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const paso = iw / datos.length;
  const ancho = Math.min(paso * 0.6, 44);

  return (
    <div style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras" preserveAspectRatio="none" style={{ height: alto }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={P.t + ih - (t / max) * ih} y2={P.t + ih - (t / max) * ih} stroke={C.grid} />
            <text x={P.l - 8} y={P.t + ih - (t / max) * ih + 4} textAnchor="end" fontSize="11" fill={C.texto}>{f(t)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const h = Math.max((d.valor / max) * ih, d.valor > 0 ? 2 : 0);
          const cx = P.l + paso * i + paso / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} style={{ cursor: "crosshair" }}>
              <rect x={cx - paso / 2} y={P.t} width={paso} height={ih} fill="transparent" />
              <rect x={cx - ancho / 2} y={P.t + ih - h} width={ancho} height={h} rx="5"
                fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={C.texto}>{d.etiqueta}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div style={{
          position: "absolute", top: 4, left: `${((P.l + paso * hover + paso / 2) / W) * 100}%`, transform: "translateX(-50%)",
          background: "var(--surface-300)", border: "1px solid var(--border-strong)", borderRadius: 8,
          padding: "6px 10px", fontSize: 13, pointerEvents: "none", boxShadow: "var(--shadow-md)",
          maxWidth: 260, textAlign: "center",
        }}>
          <strong>{datos[hover].completo ?? datos[hover].etiqueta}</strong> · <span style={{ fontVariantNumeric: "tabular-nums" }}>{f(datos[hover].valor)}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Embudo ---------------- */

export function Funnel({ pasos, formato }: {
  pasos: { etiqueta: string; valor: number; color?: string }[];
  formato?: (n: number) => string;
}) {
  const max = Math.max(...pasos.map((p) => p.valor), 1);
  const f = formato ?? ((n: number) => String(n));
  return (
    <div className="stack-3">
      {pasos.map((p, i) => {
        const prev = i === 0 ? null : pasos[i - 1].valor;
        const conv = prev && prev > 0 ? (p.valor / prev) * 100 : null;
        return (
          <div key={p.etiqueta}>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="t-sm t-strong">{p.etiqueta}</span>
              <span className="spacer t-sm t-num t-muted">{f(p.valor)}</span>
              {conv !== null && (
                <span className="t-sm t-num" style={{ color: conv >= 40 ? "var(--success)" : conv >= 20 ? "var(--warning)" : "var(--ink-subtle)", minWidth: 52, textAlign: "right" }}>
                  {conv.toFixed(0).replace(".", ",")}%
                </span>
              )}
            </div>
            <div className="bar" style={{ height: 28, borderRadius: "var(--radius-sm)" }}>
              <div style={{
                height: "100%", width: `${(p.valor / max) * 100}%`,
                background: p.color ?? C.brand, borderRadius: "var(--radius-sm)",
                transition: "width 500ms cubic-bezier(.2,.8,.3,1)",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Dona ---------------- */

export function Donut({ datos, formato, total, totalEtiqueta }: {
  datos: { etiqueta: string; valor: number; color: string }[];
  formato?: (n: number) => string; total?: string; totalEtiqueta?: string;
}) {
  const suma = datos.reduce((a, d) => a + d.valor, 0);
  const f = formato ?? ((n: number) => String(n));
  const R = 70, G = 18, C2 = 2 * Math.PI * R;
  let acc = 0;
  if (suma === 0) return <div className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>Sin datos todavía.</div>;

  return (
    <div className="row-3" style={{ gap: "var(--space-5)", flexWrap: "wrap" }}>
      <svg width="176" height="176" viewBox="0 0 176 176" role="img" aria-label="Distribución" style={{ flex: "none" }}>
        <g transform="translate(88,88) rotate(-90)">
          <circle r={R} fill="none" stroke="var(--surface-300)" strokeWidth={G} />
          {datos.map((d) => {
            const frac = d.valor / suma;
            const el = (
              <circle key={d.etiqueta} r={R} fill="none" stroke={d.color} strokeWidth={G}
                strokeDasharray={`${(frac * C2).toFixed(2)} ${C2.toFixed(2)}`}
                strokeDashoffset={-(acc * C2)} strokeLinecap="butt" />
            );
            acc += frac;
            return el;
          })}
        </g>
        {total && (
          <>
            <text x="88" y="84" textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink)" style={{ fontVariantNumeric: "tabular-nums" }}>{total}</text>
            <text x="88" y="102" textAnchor="middle" fontSize="11" fill="var(--ink-subtle)">{totalEtiqueta}</text>
          </>
        )}
      </svg>
      <div className="stack-2" style={{ flex: 1, minWidth: 180 }}>
        {datos.map((d) => (
          <div key={d.etiqueta} className="row" style={{ gap: 8 }}>
            <i className="chart-legend__dot" style={{ background: d.color }} />
            <span className="t-sm t-muted truncate" style={{ minWidth: 0 }}>{d.etiqueta}</span>
            <span className="spacer t-sm t-num t-strong" style={{ whiteSpace: "nowrap" }}>{f(d.valor)}</span>
            <span className="t-sm t-subtle t-num" style={{ minWidth: 42, textAlign: "right" }}>
              {((d.valor / suma) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const COLORES = [C.brand, C.accent, C.success, C.info, C.warning, C.danger];
