"use client";

import React, { useMemo, useState } from "react";
import { useAncho } from "@/components/charts/charts";
import { num } from "@/lib/format";
import { minutoLegible } from "@/lib/vivo";

/* ==================================================================
   La curva del vivo: una línea por minuto, con el pico marcado, la línea
   del pitch y, abajo, las barras del chat.

   Se puede tocar (o recorrer con las flechas) para elegir un minuto: la
   ficha usa ese minuto para marcar dónde arrancó el pitch. Mismo estilo
   que los gráficos de charts.tsx: SVG al ancho real de la caja, grilla
   tenue y tooltip flotante.
   ================================================================== */

export interface PuntoCurva {
  min: number;
  valor: number;
  /* Barras chicas abajo (mensajes del chat). */
  barra?: number;
  /* Agendas de Calendly en ese minuto: un punto verde sobre la curva. */
  agendas?: number;
  /* Lo que se lee en el tooltip además del valor. */
  detalle?: string;
}

export interface Marca { min: number; texto: string; tono: "pitch" | "elegido" }

export function CurvaVivo({
  puntos, alto = 260, formato = (n) => num(n), serie, serieBarra, pico, marcas = [], elegido, onElegir, etiqueta,
}: {
  puntos: PuntoCurva[];
  alto?: number;
  formato?: (n: number) => string;
  serie: string;
  serieBarra?: string;
  pico?: { min: number; valor: number };
  marcas?: Marca[];
  elegido?: number | null;
  onElegir?: (min: number) => void;
  etiqueta: string;
}) {
  const [caja, W] = useAncho();
  const [hover, setHover] = useState<number | null>(null);
  /* El borde de foco sólo cuando se llegó con el teclado: con el mouse, al
     tocar la curva para elegir un minuto, quedaba un rectángulo alrededor. */
  const [porTeclado, setPorTeclado] = useState(true);

  const maxV = useMemo(() => {
    const m = Math.max(1, ...puntos.map((p) => p.valor));
    const exp = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / exp) * exp;
  }, [puntos]);
  const maxB = useMemo(() => Math.max(1, ...puntos.map((p) => p.barra ?? 0)), [puntos]);
  const hayBarras = Boolean(serieBarra) && puntos.some((p) => (p.barra ?? 0) > 0);
  const hayAgendas = puntos.some((p) => (p.agendas ?? 0) > 0);

  if (puntos.length === 0) return null;

  const minMax = Math.max(1, puntos[puntos.length - 1].min);
  const ticksY = [0, 0.5, 1].map((t) => maxV * t);
  const P = { t: 18, r: 18, b: 26, l: Math.ceil(Math.max(...ticksY.map((t) => formato(t).length)) * 6.2) + 16 };
  const H = alto;
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const x = (min: number) => P.l + (min / minMax) * iw;
  const y = (v: number) => P.t + ih - (v / maxV) * ih;
  const altoBarra = ih * 0.22;

  const linea = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.min).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const area = `${linea} L${x(puntos[puntos.length - 1].min).toFixed(1)},${(P.t + ih).toFixed(1)} L${x(puntos[0].min).toFixed(1)},${(P.t + ih).toFixed(1)} Z`;

  /* Marcas del eje X: el paso más chico (5, 10, 15, 30 min, 1 h…) con el que
     las etiquetas entran sin pisarse en el ancho de la caja. */
  const anchoEtiqueta = 6.2 * 7 + 18;
  const paso = [5, 10, 15, 30, 60, 90, 120, 180, 240, 360, 480, 720]
    .find((p) => (minMax / p + 1) * anchoEtiqueta <= iw) ?? Math.ceil(minMax / 4);
  const ticksX: number[] = [];
  for (let m = 0; m <= minMax; m += paso) ticksX.push(m);

  const indice = (min: number) => {
    let mejor = 0;
    for (let i = 0; i < puntos.length; i++) if (Math.abs(puntos[i].min - min) < Math.abs(puntos[mejor].min - min)) mejor = i;
    return mejor;
  };
  const desdeEvento = (ev: React.MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    return indice(((px - P.l) / iw) * minMax);
  };

  const iElegido = elegido != null ? indice(elegido) : null;
  const iMostrado = hover ?? iElegido;
  const mostrado = iMostrado != null ? puntos[iMostrado] : null;

  return (
    <div className="wb-curva" ref={caja}>
      <svg
        className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        role={onElegir ? "slider" : "img"} aria-label={etiqueta}
        aria-valuemin={onElegir ? 0 : undefined} aria-valuemax={onElegir ? minMax : undefined}
        aria-valuenow={onElegir ? (iElegido != null ? puntos[iElegido].min : undefined) : undefined}
        aria-valuetext={onElegir && iElegido != null ? `${minutoLegible(puntos[iElegido].min)}: ${formato(puntos[iElegido].valor)} ${serie.toLowerCase()}` : undefined}
        tabIndex={onElegir ? 0 : undefined}
        style={{ cursor: onElegir ? "crosshair" : undefined, touchAction: "pan-y", outline: porTeclado ? undefined : "none" }}
        onPointerDown={() => setPorTeclado(false)}
        onBlur={() => setPorTeclado(true)}
        onPointerMove={(ev) => setHover(desdeEvento(ev))}
        onPointerLeave={() => setHover(null)}
        onClick={(ev) => onElegir?.(puntos[desdeEvento(ev)].min)}
        onKeyDown={(ev) => {
          if (!onElegir) return;
          setPorTeclado(true);
          const i = iElegido ?? (pico ? indice(pico.min) : 0);
          const salto = ev.shiftKey ? 10 : 1;
          if (ev.key === "ArrowRight") { ev.preventDefault(); onElegir(puntos[Math.min(puntos.length - 1, i + salto)].min); }
          if (ev.key === "ArrowLeft") { ev.preventDefault(); onElegir(puntos[Math.max(0, i - salto)].min); }
          if (ev.key === "Home") { ev.preventDefault(); onElegir(puntos[0].min); }
          if (ev.key === "End") { ev.preventDefault(); onElegir(puntos[puntos.length - 1].min); }
        }}
      >
        <defs>
          <linearGradient id="wb-curva-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticksY.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-subtle)">{formato(t)}</text>
          </g>
        ))}
        {ticksX.map((m) => (
          <text key={m} x={x(m)} y={H - 8} fontSize="11" fill="var(--ink-subtle)"
            textAnchor={m === 0 ? "start" : x(m) > W - P.r - 20 ? "end" : "middle"}>
            {m === 0 ? "Inicio" : minutoLegible(m)}
          </text>
        ))}

        {hayBarras && puntos.map((p) => {
          if ((p.barra ?? 0) <= 0) return null;
          /* Una barra por minuto: nunca más ancha que 8px (con pocos minutos
             quedaban enormes) y siempre adentro del gráfico. */
          const ancho = Math.min(8, Math.max(1.5, (iw / (minMax + 1)) * 0.7));
          const bx = Math.min(W - P.r - ancho, Math.max(P.l, x(p.min) - ancho / 2));
          const h = ((p.barra ?? 0) / maxB) * altoBarra;
          return <rect key={`b${p.min}`} x={bx} width={ancho} y={P.t + ih - h} height={h} fill="var(--info)" opacity="0.35" rx="1" />;
        })}

        <path d={area} fill="url(#wb-curva-g)" />
        <path d={linea} fill="none" stroke="var(--accent)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />

        {marcas.map((m) => {
          const color = m.tono === "pitch" ? "var(--warning)" : "var(--brand)";
          const cx = x(Math.min(minMax, Math.max(0, m.min)));
          const aLaDerecha = cx < W - P.r - 90;
          return (
            <g key={`${m.tono}${m.min}`}>
              <line x1={cx} x2={cx} y1={P.t - 6} y2={P.t + ih} stroke={color} strokeWidth="1.5" strokeDasharray={m.tono === "pitch" ? "5 4" : undefined} />
              <text x={aLaDerecha ? cx + 6 : cx - 6} y={P.t + 4} fontSize="11.5" fontWeight="700" fill={color} textAnchor={aLaDerecha ? "start" : "end"}>{m.texto}</text>
            </g>
          );
        })}

        {/* Las agendas: un punto verde en el minuto en que llegaron, con la
            cantidad arriba si fueron varias. */}
        {hayAgendas && puntos.map((p) => (p.agendas ?? 0) > 0 && (
          <g key={`a${p.min}`} pointerEvents="none">
            <circle cx={x(p.min)} cy={y(p.valor)} r={(p.agendas ?? 0) > 1 ? 6 : 4.5} fill="var(--success)" stroke="var(--surface-100)" strokeWidth="2" />
            {(p.agendas ?? 0) > 1 && (
              <text x={x(p.min)} y={y(p.valor) - 10} fontSize="11" fontWeight="700" fill="var(--success)" textAnchor="middle">{p.agendas}</text>
            )}
          </g>
        ))}

        {pico && (
          <g>
            <circle cx={x(pico.min)} cy={y(pico.valor)} r="5" fill="var(--accent)" stroke="var(--surface-100)" strokeWidth="2" />
            <text x={x(pico.min)} y={Math.max(12, y(pico.valor) - 10)} fontSize="11.5" fontWeight="700" fill="var(--ink)"
              textAnchor={x(pico.min) < P.l + 40 ? "start" : x(pico.min) > W - P.r - 40 ? "end" : "middle"}>
              Pico {formato(pico.valor)}
            </text>
          </g>
        )}

        {mostrado && (
          <g pointerEvents="none">
            <line x1={x(mostrado.min)} x2={x(mostrado.min)} y1={P.t} y2={P.t + ih} stroke="var(--border-strong)" />
            <circle cx={x(mostrado.min)} cy={y(mostrado.valor)} r="4.5" fill="var(--accent)" stroke="var(--surface-100)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {mostrado && hover != null && (
        <div className="wb-curva__tip" style={{ left: `${(x(mostrado.min) / W) * 100}%` }}>
          <strong>{minutoLegible(mostrado.min)}</strong>
          {mostrado.detalle && <span className="t-subtle"> · {mostrado.detalle}</span>}
          <br />
          <span className="t-num">{formato(mostrado.valor)}</span> <span className="t-subtle">{serie.toLowerCase()}</span>
          {serieBarra && mostrado.barra !== undefined && (
            <> · <span className="t-num">{num(mostrado.barra)}</span> <span className="t-subtle">{serieBarra.toLowerCase()}</span></>
          )}
          {(mostrado.agendas ?? 0) > 0 && (
            <> · <span className="t-num" style={{ color: "var(--success)", fontWeight: 600 }}>{num(mostrado.agendas ?? 0)} {mostrado.agendas === 1 ? "agenda" : "agendas"}</span></>
          )}
        </div>
      )}

      <div className="chart-legend">
        <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: "var(--accent)" }} />{serie}</span>
        {hayBarras && <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: "var(--info)" }} />{serieBarra}</span>}
        {hayAgendas && <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: "var(--success)" }} />Agendas</span>}
        {marcas.some((m) => m.tono === "pitch") && (
          <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: "var(--warning)" }} />Pitch</span>
        )}
      </div>
    </div>
  );
}
