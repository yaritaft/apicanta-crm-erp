"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAncho } from "@/components/charts/charts";
import { money, num, pct } from "@/lib/format";
import { MAPA_ALTO, MAPA_ANCHO, MAPA_PAISES, proyectar } from "@/lib/mapa-mundo";
import { nombreDePais } from "@/lib/paises";
import {
  desglosePor, paisesDelMapa, pesoDe, piezasDeDesglose, tasaCobro, TEXTOS, valorDe, ZONAS_MAPA,
  type Categoria, type MetricaDesglose, type QueSeVe, type ZonaMapa,
} from "@/lib/kpis-graficos";
import type { Contexto } from "@/lib/kpis";
import type { Moneda } from "@/lib/types";
import { BORDE_CC, BORDE_REVENUE, CabezaGrafico, COLOR_CC, COLOR_REVENUE, Forma, InfoGrafico, Selector } from "./comun";
import { DetalleCategoria } from "./PanelDesglose";

/* El mapa: dónde están los clientes. Los países en gris y, en cada uno, una
   burbuja amarilla con su Revenue y, adentro, una verde con su Cash Collected
   (CC); las dos con la misma escala, así lo verde se ve como la parte de lo
   amarillo que ya entró. A un costado, la lista ordenada con el peso de cada
   país sobre el total. SVG propio: la geometría es Natural Earth 110m
   (lib/mapa-mundo.ts) y las burbujas se ubican con la misma proyección. */

const TOPE = 6;

/* El radio de la burbuja más grande, en píxeles: más chico con el mundo entero
   (hay mucho país en poco lugar) y más grande al acercarse. */
const RADIO_MAX: Record<ZonaMapa, number> = { mundo: 17, americas: 22, latam: 28, europa: 24 };

/* Lo que se ve de cada zona: el recuadro del plano que ocupa, en las unidades del mapa. */
function cajaDeZona(id: ZonaMapa): { x: number; y: number; w: number; h: number } {
  if (id === "mundo") return { x: 0, y: 0, w: MAPA_ANCHO, h: MAPA_ALTO };
  const [oeste, sur, este, norte] = ZONAS_MAPA.find((z) => z.id === id)!.caja;
  /* La proyección curva los meridianos: se miden los cuatro bordes, no las esquinas. */
  const pts: [number, number][] = [];
  for (let lon = oeste; lon <= este; lon += 4) pts.push(proyectar(sur, lon), proyectar(norte, lon));
  for (let lat = sur; lat <= norte; lat += 4) pts.push(proyectar(lat, oeste), proyectar(lat, este));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const aire = Math.max(x1 - x0, y1 - y0) * 0.02;
  return { x: x0 - aire, y: y0 - aire, w: x1 - x0 + 2 * aire, h: y1 - y0 + 2 * aire };
}

export function MapaMundo({ ctx, moneda, ve, periodo, zona, onZona, onAbrir }: {
  ctx: Contexto; moneda: Moneda; ve: QueSeVe; periodo: string; zona: ZonaMapa; onZona: (z: ZonaMapa) => void;
  /* Abre las ventas o los cobros de un país, en el mismo panel que la tabla. */
  onAbrir?: (que: "ventas" | "cobros", cat: Categoria, metrica: MetricaDesglose) => void;
}) {
  const hayRevenue = ve.revenue, hayCC = ve.cc;
  const d = useMemo(() => desglosePor(ctx, "pais"), [ctx]);
  const { enMapa, sinUbicar } = useMemo(() => paisesDelMapa(d), [d]);
  const [caja, W] = useAncho();
  const lienzo = useRef<HTMLDivElement>(null);
  const [orden, setOrden] = useState<"revenue" | "cc">(hayRevenue ? "revenue" : "cc");
  const [sel, setSel] = useState<string | null>(null);
  const [tip, setTip] = useState<{ clave: string; x: number; y: number } | null>(null);
  const [expandido, setExpandido] = useState(false);

  const metrica: "revenue" | "cc" = (orden === "revenue" ? hayRevenue : hayCC) ? orden : hayRevenue ? "revenue" : "cc";
  const porIso = useMemo(() => new Map(enMapa.map((x) => [x.iso, x])), [enMapa]);
  const conPlata = (x: Categoria) => (hayRevenue && x.revenue > 0) || (hayCC && x.cc > 0);

  /* Revenue y CC con la misma escala: el área de la burbuja es el monto. */
  const referencia = Math.max(1e-9, ...enMapa.map((x) => Math.max(hayRevenue ? x.revenue : 0, hayCC ? x.cc : 0)));
  const vb = useMemo(() => cajaDeZona(zona), [zona]);
  const altoMax = W < 520 ? 380 : 470;
  const escala = Math.min(W / vb.w, altoMax / vb.h);
  const anchoPx = Math.round(vb.w * escala), altoPx = Math.round(vb.h * escala);
  const rMax = RADIO_MAX[zona] * (W < 520 ? 0.85 : 1);
  const radio = (v: number) => (v > 0 ? Math.max(Math.sqrt(v / referencia) * rMax, 3) / escala : 0);
  const aPx = (px: number, py: number) => ({ x: (px - vb.x) * escala, y: (py - vb.y) * escala });

  const burbujas = useMemo(
    () => enMapa
      .filter((x) => (hayRevenue && x.revenue > 0) || (hayCC && x.cc > 0))
      .map((x) => { const [px, py] = proyectar(x.lat, x.lon); return { x, px, py }; })
      .filter((b) => b.px >= vb.x - 5 && b.px <= vb.x + vb.w + 5 && b.py >= vb.y - 5 && b.py <= vb.y + vb.h + 5)
      /* Las grandes atrás: las chicas no quedan tapadas. */
      .sort((a, b) => Math.max(b.x.revenue, b.x.cc) - Math.max(a.x.revenue, a.x.cc)),
    [enMapa, hayRevenue, hayCC, vb],
  );

  /* La lista: los del mapa por la métrica elegida y, al final, lo que no se pudo ubicar. */
  const ordenadas = useMemo(
    () => enMapa.filter((x) => valorDe(x, metrica) > 0 || x.unidades > 0)
      .sort((a, b) => valorDe(b, metrica) - valorDe(a, metrica) || a.nombre.localeCompare(b.nombre, "es")),
    [enMapa, metrica],
  );
  const sinPlata = sinUbicar.filter((x) => x.revenue > 0 || x.cc > 0 || x.unidades > 0);
  const primeras = expandido ? ordenadas : ordenadas.slice(0, TOPE);
  const elegido = sel ? ordenadas.find((x) => x.clave === sel) : undefined;
  const visibles = elegido && !primeras.includes(elegido) ? [...primeras, elegido] : primeras;

  const totalRev = d.total.revenue, totalCC = d.total.cc;
  /* Qué tanto pesan los primeros: la concentración, de un vistazo. */
  const primerosPesan = (m: "revenue" | "cc") => pesoDe(ordenadas.slice(0, 5).reduce((a, x) => a + valorDe(x, m), 0), m === "revenue" ? totalRev : totalCC);
  const resumen = ordenadas.length === 0 ? "" : [
    `${ordenadas.length === 1 ? "El único país con ventas pesa" : `Los ${Math.min(5, ordenadas.length)} primeros países pesan`}`,
    hayRevenue ? ` ${pct(primerosPesan("revenue") ?? 0, 0)} del Revenue` : "",
    hayRevenue && hayCC ? " y" : "",
    hayCC ? ` ${pct(primerosPesan("cc") ?? 0, 0)} del CC` : "",
    ". Tocá un país en el mapa o en la lista para ver su detalle.",
  ].join("");
  const elegidoTodo = sel ? d.categorias.find((x) => x.clave === sel) : undefined;
  const enTip = tip ? d.categorias.find((x) => x.clave === tip.clave) : undefined;

  /* Con Escape se suelta lo elegido. */
  useEffect(() => {
    if (!sel) return;
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setSel(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [sel]);

  const alternar = (clave: string) => setSel((s) => (s === clave ? null : clave));
  const sobre = (clave: string, ev: React.PointerEvent) => {
    const r = lienzo.current?.getBoundingClientRect();
    if (r) setTip({ clave, x: ev.clientX - r.left, y: ev.clientY - r.top });
  };
  const sobreBurbuja = (clave: string, px: number, py: number) => setTip({ clave, ...aPx(px, py) });

  const fila = (x: Categoria, n?: number) => {
    const abierta = sel === x.clave;
    const tc = tasaCobro(x);
    const b = porIso.get(x.clave);
    return (
      <li key={x.clave}>
        <button
          type="button" className={`gr-pais${abierta ? " gr-pais--activa" : ""}${x.sinDato ? " gr-fila--sin" : ""}`}
          aria-pressed={b || x.sinDato ? abierta : undefined} disabled={!b && !x.sinDato}
          aria-label={`${x.nombre}: ${[hayRevenue ? `Revenue ${money(x.revenue, moneda, 0)}, ${pct(pesoDe(x.revenue, totalRev) ?? 0, 1)} del total` : "", hayCC ? `Cash Collected ${money(x.cc, moneda, 0)}, ${pct(pesoDe(x.cc, totalCC) ?? 0, 1)} del total` : "", ve.tasaCobro && tc !== null ? `tasa de cobro ${pct(tc, 0)}` : ""].filter(Boolean).join("; ")}`}
          onClick={() => { if (b || x.sinDato) alternar(x.clave); }}
          onMouseEnter={() => { if (b) { const [px, py] = proyectar(b.lat, b.lon); const p = aPx(px, py); if (p.x >= 0 && p.x <= anchoPx && p.y >= 0 && p.y <= altoPx) setTip({ clave: x.clave, ...p }); } }}
          onMouseLeave={() => setTip(null)}
        >
          <span className="gr-pais__rank" aria-hidden>{n ?? "·"}</span>
          <span className="gr-pais__nombre truncate" title={x.nombre}>{x.nombre}</span>
          {ve.tasaCobro && <span className="gr-pais__cobro t-num" title="Tasa de cobro: Cash Collected (CC) ÷ Revenue">{tc === null ? "—" : `cobro ${pct(tc, 0)}`}</span>}
          <span className="gr-pais__pesos">
            {hayRevenue && <Peso tipo="revenue" valor={x.revenue} total={totalRev} moneda={moneda} />}
            {hayCC && <Peso tipo="cc" valor={x.cc} total={totalCC} moneda={moneda} />}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="hk-card gr-card" aria-labelledby="gr-mapa">
      <CabezaGrafico
        id="gr-mapa" titulo="Mapa de países"
        info={(
          <InfoGrafico
            texto={TEXTOS.mapa} moneda={moneda} periodo={periodo}
            piezas={() => [
              ...(hayRevenue ? [{ titulo: "Revenue por país", filas: piezasDeDesglose(d, "revenue", "Revenue (facturado), el total de la tabla") }] : []),
              ...(hayCC ? [{ titulo: "Cash Collected (CC) por país", filas: piezasDeDesglose(d, "cc", "Cash Collected (CC), el total de la tabla") }] : []),
            ]}
          />
        )}
        sub={`${periodo} · el tamaño de la burbuja es el monto`}
        acciones={<Selector etiqueta="Zona del mapa" valor={zona} onCambiar={onZona} opciones={ZONAS_MAPA.map((z) => ({ id: z.id, titulo: z.titulo }))} />}
      />

      <div className="gr-mapa">
        <div className="gr-mapa__lienzo" ref={caja}>
          <div className="gr-leyenda gr-leyenda--mapa" aria-hidden>
            {hayRevenue && <span className="gr-leyenda__item"><Forma forma="circulo" color={COLOR_REVENUE} borde={BORDE_REVENUE} /> Revenue</span>}
            {hayCC && <span className="gr-leyenda__item"><Forma forma="rombo" color={COLOR_CC} borde={BORDE_CC} /> Cash Collected (CC)</span>}
          </div>

          <div className="gr-mapa__svg" ref={lienzo} style={{ width: anchoPx, height: altoPx }}>
            <svg
              width={anchoPx} height={altoPx} viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
              role="group" aria-label="Mapa del mundo con una burbuja por país. Los mismos números están en la lista."
              onPointerLeave={() => setTip(null)}
            >
              <g>
                {Object.entries(MAPA_PAISES).map(([iso, trazo]) => {
                  const x = porIso.get(iso);
                  const hay = Boolean(x && conPlata(x));
                  return (
                    <path
                      key={iso} d={trazo} vectorEffect="non-scaling-stroke"
                      className={`gr-forma-pais${hay ? " gr-forma-pais--con" : ""}${sel === iso ? " gr-forma-pais--sel" : ""}`}
                      onPointerMove={(ev) => sobre(iso, ev)} onClick={() => { if (hay) alternar(iso); else setSel(null); }}
                    />
                  );
                })}
              </g>

              {burbujas.map(({ x, px, py }) => {
                const rRev = hayRevenue ? radio(x.revenue) : 0, rCC = hayCC ? radio(x.cc) : 0;
                /* El Revenue es un círculo y el CC un rombo, del mismo área que un círculo de ese radio:
                   la misma forma que en la leyenda y en los gráficos, para no depender del color.
                   El círculo va atrás y el rombo adelante: siempre se ven los dos, sea cual sea más grande. */
                const grande = Math.max(rRev, rCC * 1.2533);
                const redondas = [
                  { k: "rev", r: rRev, color: COLOR_REVENUE, borde: BORDE_REVENUE },
                  { k: "cc", r: rCC, color: COLOR_CC, borde: BORDE_CC },
                ].filter((c) => c.r > 0);
                const descripcion = [
                  hayRevenue ? `Revenue ${money(x.revenue, moneda, 0)}, ${pct(pesoDe(x.revenue, totalRev) ?? 0, 1)} del total` : "",
                  hayCC ? `Cash Collected ${money(x.cc, moneda, 0)}, ${pct(pesoDe(x.cc, totalCC) ?? 0, 1)} del total` : "",
                ].filter(Boolean).join("; ");
                return (
                  <g
                    key={x.iso} className={`gr-burbuja${sel === x.iso || tip?.clave === x.iso ? " gr-burbuja--activa" : ""}`}
                    tabIndex={0} role="button" aria-pressed={sel === x.iso} aria-label={`${x.nombre}: ${descripcion}`}
                    onPointerMove={(ev) => sobre(x.iso, ev)} onFocus={() => sobreBurbuja(x.iso, px, py)} onBlur={() => setTip(null)}
                    onClick={() => alternar(x.iso)}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); alternar(x.iso); } }}
                  >
                    <circle cx={px} cy={py} r={Math.max(grande, 11 / escala)} className="gr-burbuja__toque" />
                    {redondas.map((c) => (c.k === "cc" ? (
                      <rect
                        key={c.k} x={px - c.r * 0.8862} y={py - c.r * 0.8862} width={c.r * 1.7725} height={c.r * 1.7725} transform={`rotate(45 ${px} ${py})`}
                        fill={c.color} stroke={c.borde} strokeWidth="1" vectorEffect="non-scaling-stroke" className="gr-burbuja__cc"
                      />
                    ) : (
                      <circle key={c.k} cx={px} cy={py} r={c.r} fill={c.color} stroke={c.borde} strokeWidth="1" vectorEffect="non-scaling-stroke" className="gr-burbuja__rev" />
                    )))}
                    {sel === x.iso && <circle cx={px} cy={py} r={grande + 4 / escala} fill="none" className="gr-burbuja__sel" vectorEffect="non-scaling-stroke" />}
                  </g>
                );
              })}
            </svg>

            {tip && (
              <div
                className="gr-tip gr-tip--mapa" aria-hidden
                style={{ left: Math.min(Math.max(tip.x, 100), Math.max(anchoPx - 100, 100)), top: tip.y, transform: tip.y < 130 ? "translate(-50%, 18px)" : "translate(-50%, calc(-100% - 14px))" }}
              >
                <strong className="gr-tip__titulo">{enTip?.nombre ?? nombreDePais(tip.clave)}</strong>
                {enTip && (conPlata(enTip) || enTip.unidades > 0) ? (
                  <>
                    {hayRevenue && (
                      <div className="gr-tip__fila">
                        <Forma forma="circulo" color={COLOR_REVENUE} borde={BORDE_REVENUE} /><span className="gr-tip__nombre">Revenue</span>
                        <span className="gr-tip__valor">{money(enTip.revenue, moneda, 0)}</span><span className="gr-tip__peso">{pct(pesoDe(enTip.revenue, totalRev) ?? 0, 1)}</span>
                      </div>
                    )}
                    {hayCC && (
                      <div className="gr-tip__fila">
                        <Forma forma="rombo" color={COLOR_CC} borde={BORDE_CC} /><span className="gr-tip__nombre">CC</span>
                        <span className="gr-tip__valor">{money(enTip.cc, moneda, 0)}</span><span className="gr-tip__peso">{pct(pesoDe(enTip.cc, totalCC) ?? 0, 1)}</span>
                      </div>
                    )}
                    <span className="gr-tip__pie">
                      {ve.tasaCobro && tasaCobro(enTip) !== null ? `Tasa de cobro ${pct(tasaCobro(enTip)!, 0)}` : ""}
                      {ve.tasaCobro && tasaCobro(enTip) !== null && ve.unidades ? " · " : ""}
                      {ve.unidades ? `${num(enTip.unidades)} ${enTip.unidades === 1 ? "venta" : "ventas"}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="gr-tip__pie">Sin ventas ni cobros en este período</span>
                )}
              </div>
            )}
          </div>

          <div className="gr-mapa__detalle" aria-live="polite">
            {elegidoTodo ? (
              <>
                <div className="gr-mapa__detalle-cabeza">
                  <strong>{elegidoTodo.nombre}</strong>
                  <button type="button" className="link t-sm" onClick={() => setSel(null)}>Soltar</button>
                </div>
                <DetalleCategoria
                  x={elegidoTodo} moneda={moneda} ve={ve} dim="pais" metrica={metrica} suelto
                  totales={{ revenue: totalRev, cc: totalCC, unidades: d.total.unidades }}
                  onAbrir={onAbrir ? (que) => onAbrir(que, elegidoTodo, metrica) : undefined}
                />
              </>
            ) : resumen && <p className="gr-mapa__resumen">{resumen}</p>}
          </div>

          {sinPlata.length > 0 && (
            <p className="gr-mapa__sin">
              {sinPlata.map((x, i) => {
                const v = hayRevenue ? x.revenue : x.cc;
                return <React.Fragment key={x.clave}>{i > 0 && " · "}<strong>{x.nombre}</strong> {money(v, moneda, 0)} ({pct(pesoDe(v, hayRevenue ? totalRev : totalCC) ?? 0, 1)})</React.Fragment>;
              })}
              : no se puede dibujar en el mapa.
            </p>
          )}
        </div>

        <div className="gr-mapa__lista">
          <div className="gr-mapa__orden">
            <span className="t-label">Peso de cada país</span>
            {hayRevenue && hayCC && (
              <Selector
                chico etiqueta="Ordenar la lista por" valor={metrica} onCambiar={setOrden}
                opciones={[{ id: "revenue", titulo: "Revenue" }, { id: "cc", titulo: "CC", ayuda: "Cash Collected (CC)" }]}
              />
            )}
          </div>

          <ol className="gr-paises-lista">
            {visibles.map((x, i) => fila(x, ordenadas.indexOf(x) + 1 || i + 1))}
            {sinPlata.map((x) => fila(x))}
          </ol>
          {ordenadas.length > TOPE && (
            <button type="button" className="gr-mas" onClick={() => setExpandido((v) => !v)}>
              {expandido ? <><ChevronUp size={14} aria-hidden /> Ver sólo los primeros</> : <><ChevronDown size={14} aria-hidden /> Ver los otros {ordenadas.length - TOPE} países</>}
            </button>
          )}
          {ordenadas.length === 0 && sinPlata.length === 0 && <p className="gr-vacio">No hay ventas ni cobros en este período.</p>}
        </div>
      </div>
    </section>
  );
}

/* El Revenue o el CC de un país y su peso sobre el total, con su marca. */
function Peso({ tipo, valor, total, moneda }: { tipo: "revenue" | "cc"; valor: number; total: number; moneda: Moneda }) {
  const peso = pesoDe(valor, total);
  return (
    <span className="gr-pais__grupo" title={tipo === "revenue" ? "Revenue y su peso sobre el total" : "Cash Collected (CC) y su peso sobre el total"}>
      <Forma forma={tipo === "revenue" ? "circulo" : "rombo"} color={tipo === "revenue" ? COLOR_REVENUE : COLOR_CC} borde={tipo === "revenue" ? BORDE_REVENUE : BORDE_CC} tam={9} />
      <span className="t-num">{money(valor, moneda, 0)}</span>
      <strong className="gr-pais__peso t-num">{peso === null ? "—" : pct(peso, 1)}</strong>
    </span>
  );
}
