"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { money, num, pct } from "@/lib/format";
import {
  conMovimiento, desglosePor, DIMENSIONES, METRICAS, moraCategoria, ordenDeDimension, pesoDe, piezasDeDesglose, recortar, tasaCobro,
  textoDeDesglose, valorDe, type Categoria, type DimensionId, type MetricaDesglose, type QueSeVe,
} from "@/lib/kpis-graficos";
import type { Contexto } from "@/lib/kpis";
import type { Moneda } from "@/lib/types";
import { BORDE_CC, BORDE_REVENUE, CabezaGrafico, COLOR_CC, COLOR_REVENUE, COLOR_UNIDADES, Forma, InfoGrafico, Selector } from "./comun";

/* El desglose por dimensión: plan de pago, país, estrategia, servicio y
   proyecto. Una métrica a la vez (unidades, Revenue o CC), con barras
   horizontales ordenadas y, si son pocas categorías, una dona. Cada categoría
   dice su parte del total y su tasa de cobro; Revenue y CC van lado a lado
   para ver la diferencia. «Sin dato» se queda a la vista. */

const TOPE = 10;
const NOMBRE_TOTAL: Record<MetricaDesglose, string> = {
  unidades: "Ventas (el total de la tabla)", revenue: "Revenue (facturado), el total de la tabla", cc: "Cash Collected (CC), el total de la tabla",
};

const colorDe = (m: MetricaDesglose) => (m === "revenue" ? COLOR_REVENUE : m === "cc" ? COLOR_CC : COLOR_UNIDADES);
const bordeDe = (m: MetricaDesglose) => (m === "revenue" ? BORDE_REVENUE : m === "cc" ? BORDE_CC : "var(--brand)");

/* En el orden de la lista: el color de la métrica que se desvanece hacia el
   gris. Ordenadas por valor, «lo que pesa» salta a la vista; y no se usan
   colores que ya significan otra cosa (amarillo = Revenue, verde = CC). */
const rampa = (base: string, i: number, n: number) =>
  `color-mix(in srgb, ${base} ${Math.round(100 - (i * 68) / Math.max(n - 1, 1))}%, var(--ink-subtle))`;

export function PanelDesglose({ ctx, moneda, ve, periodo, dim, onDim, metrica, onMetrica, onAbrir }: {
  ctx: Contexto;
  moneda: Moneda;
  ve: QueSeVe;
  periodo: string;
  dim: DimensionId;
  onDim: (d: DimensionId) => void;
  metrica: MetricaDesglose;
  onMetrica: (m: MetricaDesglose) => void;
  /* Abre las ventas o los cobros de una categoría, en el mismo panel que la tabla. */
  onAbrir?: (que: "ventas" | "cobros", cat: Categoria, dim: DimensionId, metrica: MetricaDesglose) => void;
}) {
  const def = DIMENSIONES.find((x) => x.id === dim)!;
  const d = useMemo(() => desglosePor(ctx, dim), [ctx, dim]);

  const disponibles = METRICAS.filter((m) => (m.id === "unidades" ? ve.unidades : m.id === "revenue" ? ve.revenue : ve.cc));
  const m: MetricaDesglose = disponibles.some((x) => x.id === metrica) ? metrica : disponibles[0].id;
  const color = colorDe(m), borde = bordeDe(m);

  const [expandido, setExpandido] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const lista = useMemo(() => conMovimiento(ordenDeDimension(d, m), m), [d, m]);
  const { visibles, resto } = useMemo(() => recortar(lista, expandido ? Infinity : TOPE), [lista, expandido]);
  const totalM = valorDe(d.total, m);
  const conDona = lista.length >= 2 && lista.length <= 6 && totalM > 0;

  const formato = (n: number) => (m === "unidades" ? num(n) : money(n, moneda, 0));
  /* Las barras comparten escala: así se ve cuánto menos entró que lo vendido. */
  const par: MetricaDesglose | null = m === "revenue" ? (ve.cc ? "cc" : null) : m === "cc" ? (ve.revenue ? "revenue" : null) : null;
  const maximo = Math.max(1e-9, ...lista.map((x) => Math.max(valorDe(x, m), par ? valorDe(x, par) : 0)));

  const activa = sel && lista.some((x) => x.clave === sel) ? lista.find((x) => x.clave === sel)! : null;
  const resaltada = hover ?? activa?.clave ?? null;
  /* El color de cada porción: del más grande al más chico, sin contar el «Sin dato», que va rayado en gris. */
  const colores = useMemo(() => {
    const conDato = lista.filter((x) => !x.sinDato);
    return new Map(conDato.map((x, i) => [x.clave, rampa(color, i, conDato.length)]));
  }, [lista, color]);
  const colorFila = (x: Categoria) => colores.get(x.clave) ?? null;

  return (
    <section className="hk-card gr-card" aria-labelledby="gr-desglose">
      <CabezaGrafico
        id="gr-desglose" titulo={`Desglose ${def.por}`}
        info={<InfoGrafico texto={textoDeDesglose(def, m)} periodo={periodo} moneda={moneda} piezas={() => piezasDeDesglose(d, m, NOMBRE_TOTAL[m])} />}
        sub={`${periodo} · ${disponibles.find((x) => x.id === m)!.titulo}`}
        acciones={disponibles.length > 1 ? (
          <Selector
            etiqueta="Qué medir" valor={m} onCambiar={(x) => { onMetrica(x); setSel(null); }}
            opciones={disponibles.map((x) => ({
              id: x.id, titulo: x.titulo === "Cash Collected (CC)" ? "CC" : x.titulo,
              ayuda: x.titulo === "Cash Collected (CC)" ? "Cash Collected (CC): la plata que entró" : undefined,
              icono: <Forma forma={x.id === "revenue" ? "circulo" : x.id === "cc" ? "rombo" : "cuadrado"} color={colorDe(x.id)} borde={bordeDe(x.id)} tam={9} patron={false} />,
            }))}
          />
        ) : undefined}
      />

      <Selector
        modo="tabs" etiqueta="Por qué dimensión repartir" valor={dim}
        onCambiar={(x) => { onDim(x); setSel(null); setHover(null); setExpandido(false); }}
        opciones={DIMENSIONES.map((x) => ({ id: x.id, titulo: x.titulo }))}
      />

      {lista.length === 0 ? (
        <p className="gr-vacio">No hay {m === "unidades" ? "ventas" : m === "revenue" ? "ventas" : "cobros"} en este período para repartir {def.por}.</p>
      ) : (
        <div className={`gr-desglose${conDona ? " gr-desglose--dona" : ""}`}>
          {conDona && (
            <Dona
              items={lista.map((x) => ({ clave: x.clave, nombre: x.nombre, valor: valorDe(x, m), color: colorFila(x), sinDato: x.sinDato }))}
              total={totalM} formato={formato} etiqueta={disponibles.find((x) => x.id === m)!.titulo}
              hover={resaltada} onHover={setHover} onSel={(k) => setSel((s) => (s === k ? null : k))}
            />
          )}

          <div className={`gr-filas${ve.tasaCobro ? "" : " gr-filas--sin-cobro"}`} role="group" aria-label={`${disponibles.find((x) => x.id === m)!.titulo} ${def.por}`}>
            <div className="gr-filas__cabeza" aria-hidden>
              <span>{def.titulo}</span>
              <span className="gr-filas__barras-t">{par ? <Pares m={m} par={par} /> : null}</span>
              <span className="gr-filas__num">{m === "unidades" ? "Ventas" : m === "revenue" ? "Revenue" : "CC"}</span>
              <span className="gr-filas__num">% total</span>
              {ve.tasaCobro && <span className="gr-filas__num" title="Cash Collected (CC) ÷ Revenue">Cobro</span>}
            </div>

            {visibles.map((x) => {
              const v = valorDe(x, m);
              const tc = tasaCobro(x);
              const peso = pesoDe(v, totalM);
              const dePar = par ? valorDe(x, par) : null;
              const abierta = activa?.clave === x.clave;
              return (
                <React.Fragment key={x.clave}>
                  <button
                    type="button"
                    className={`gr-fila${abierta ? " gr-fila--activa" : ""}${resaltada === x.clave ? " gr-fila--resaltada" : ""}${x.sinDato ? " gr-fila--sin" : ""}`}
                    aria-pressed={abierta} title={abierta ? "Tocá para cerrar el detalle" : "Tocá para ver el detalle y abrir sus ventas y cobros"}
                    aria-label={`${x.nombre}: ${disponibles.find((y) => y.id === m)!.titulo} ${formato(v)}${peso !== null ? `, ${pct(peso, 1)} del total` : ""}${par && dePar !== null ? `, ${METRICAS.find((y) => y.id === par)!.titulo} ${formato(dePar)}` : ""}${ve.tasaCobro && tc !== null ? `, tasa de cobro ${pct(tc, 0)}` : ""}`}
                    onClick={() => setSel((s) => (s === x.clave ? null : x.clave))}
                    onMouseEnter={() => setHover(x.clave)} onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(x.clave)} onBlur={() => setHover(null)}
                  >
                    <span className="gr-fila__nombre">
                      {conDona && <i className={`gr-fila__color${x.sinDato ? " gr-sin" : ""}`} style={colorFila(x) ? { background: colorFila(x)! } : undefined} aria-hidden />}
                      <span className="truncate" title={x.nombre}>{x.nombre}</span>
                    </span>
                    <span className="gr-fila__barras" aria-hidden>
                      <span className={`gr-barra${x.sinDato ? " gr-sin" : m === "cc" ? " gr-barra--rayada" : ""}`} style={{ width: `${Math.max((v / maximo) * 100, v > 0 ? 1.5 : 0)}%`, ...(x.sinDato ? {} : { backgroundColor: color, borderColor: borde }) }} />
                      {par && dePar !== null && (
                        <span
                          className={`gr-barra gr-barra--fina${par === "cc" ? " gr-barra--rayada" : ""}`}
                          style={{ width: `${Math.max((dePar / maximo) * 100, dePar > 0 ? 1.5 : 0)}%`, backgroundColor: colorDe(par), borderColor: bordeDe(par) }}
                        />
                      )}
                    </span>
                    <span className="gr-fila__num gr-fila__valor t-num">{formato(v)}</span>
                    <span className="gr-fila__num gr-fila__peso t-num">{peso === null ? "—" : pct(peso, 1)}</span>
                    {ve.tasaCobro && <span className="gr-fila__num gr-fila__cobro t-num">{tc === null ? "—" : pct(tc, 0)}</span>}
                  </button>
                  {abierta && (
                    <DetalleCategoria
                      x={x} moneda={moneda} ve={ve} dim={dim} metrica={m} totales={{ revenue: d.total.revenue, cc: d.total.cc, unidades: d.total.unidades }}
                      onAbrir={onAbrir ? (que) => onAbrir(que, x, dim, m) : undefined}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {resto.length > 0 && !expandido && (
              <button type="button" className="gr-mas" onClick={() => setExpandido(true)}>
                <ChevronDown size={14} aria-hidden /> Ver las otras {resto.length} ({formato(resto.reduce((a, x) => a + valorDe(x, m), 0))} entre todas)
              </button>
            )}
            {expandido && lista.length > TOPE && (
              <button type="button" className="gr-mas" onClick={() => setExpandido(false)}>
                <ChevronUp size={14} aria-hidden /> Ver sólo las primeras
              </button>
            )}

            <div className="gr-fila gr-fila--total">
              <span className="gr-fila__nombre"><strong>Total</strong><span className="t-sm t-subtle"> · igual que la tabla</span></span>
              <span className="gr-fila__barras" aria-hidden />
              <span className="gr-fila__num t-num"><strong>{formato(totalM)}</strong></span>
              <span className="gr-fila__num t-num">100%</span>
              {ve.tasaCobro && <span className="gr-fila__num gr-fila__cobro t-num">{tasaCobro(d.total) === null ? "—" : pct(tasaCobro(d.total)!, 0)}</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* La leyenda de las barras: la gruesa es la métrica; la fina, con la que se compara. */
function Pares({ m, par }: { m: MetricaDesglose; par: MetricaDesglose }) {
  const nombre = (x: MetricaDesglose) => (x === "revenue" ? "Revenue" : x === "cc" ? "CC" : "Unidades");
  return (
    <span className="gr-pares">
      <span><Forma forma={m === "revenue" ? "circulo" : "rombo"} color={colorDe(m)} borde={bordeDe(m)} tam={9} /> {nombre(m)}</span>
      <span><Forma forma={par === "revenue" ? "circulo" : "rombo"} color={colorDe(par)} borde={bordeDe(par)} tam={9} patron={par === "cc"} /> {nombre(par)}</span>
    </span>
  );
}

/* La dona: la parte de cada categoría en la métrica elegida. Al pasar el mouse
   por una porción (o por su fila), el centro dice cuál es. */
function Dona({ items, total, formato, etiqueta, hover, onHover, onSel }: {
  items: { clave: string; nombre: string; valor: number; color: string | null; sinDato: boolean }[];
  total: number; formato: (n: number) => string; etiqueta: string;
  hover: string | null; onHover: (k: string | null) => void; onSel: (k: string) => void;
}) {
  const R = 68, G = 16, C = 2 * Math.PI * R, hueco = items.length > 1 ? 1.6 : 0;
  const resaltado = items.find((x) => x.clave === hover);
  let acc = 0;
  return (
    <figure className="gr-dona" aria-hidden>
      <svg viewBox="0 0 176 176" className="gr-dona__svg">
        <defs>
          <pattern id="gr-dona-sin" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--ink-subtle)" opacity=".55" />
            <rect width="2.4" height="6" fill="var(--surface-100)" opacity=".7" />
          </pattern>
        </defs>
        <g transform="translate(88,88) rotate(-90)">
          <circle r={R} fill="none" stroke="var(--surface-300)" strokeWidth={G} />
          {items.map((x) => {
            const frac = x.valor / total, largo = Math.max(frac * C - hueco, 0.5);
            const el = (
              <circle
                key={x.clave} r={R} fill="none" stroke={x.sinDato ? "url(#gr-dona-sin)" : x.color ?? "var(--ink-subtle)"}
                strokeWidth={hover === x.clave ? G + 4 : G} strokeDasharray={`${largo.toFixed(2)} ${C.toFixed(2)}`}
                strokeDashoffset={-(acc * C + hueco / 2)} opacity={hover && hover !== x.clave ? 0.45 : 1}
                style={{ cursor: "pointer", transition: "stroke-width 120ms ease-out, opacity 120ms ease-out" }}
                onMouseEnter={() => onHover(x.clave)} onMouseLeave={() => onHover(null)} onClick={() => onSel(x.clave)}
              />
            );
            acc += frac;
            return el;
          })}
        </g>
        <text x="88" y={resaltado ? 80 : 84} textAnchor="middle" className="gr-dona__valor">{formato(resaltado ? resaltado.valor : total)}</text>
        <text x="88" y={resaltado ? 98 : 102} textAnchor="middle" className="gr-dona__sub">
          {resaltado ? `${resaltado.nombre.length > 20 ? `${resaltado.nombre.slice(0, 19)}…` : resaltado.nombre} · ${pct(pesoDe(resaltado.valor, total) ?? 0, 0)}` : etiqueta}
        </text>
      </svg>
    </figure>
  );
}

/* Lo de una categoría, abierto debajo de su fila. */
export function DetalleCategoria({ x, moneda, ve, dim, metrica, totales, onAbrir, suelto }: {
  x: Categoria; moneda: Moneda; ve: QueSeVe; dim: DimensionId; metrica: MetricaDesglose;
  totales: { revenue: number; cc: number; unidades: number };
  onAbrir?: (que: "ventas" | "cobros") => void;
  /* Solo, con su propio borde (no pegado a una fila). */
  suelto?: boolean;
}) {
  const tc = tasaCobro(x), mora = moraCategoria(x);
  const celdas: { t: string; v: string; sub?: string }[] = [];
  if (ve.unidades) celdas.push({ t: "Ventas", v: num(x.unidades), sub: pesoDe(x.unidades, totales.unidades) === null ? undefined : `${pct(pesoDe(x.unidades, totales.unidades)!, 1)} del total` });
  if (ve.revenue) celdas.push({ t: "Revenue", v: money(x.revenue, moneda, 0), sub: pesoDe(x.revenue, totales.revenue) === null ? undefined : `${pct(pesoDe(x.revenue, totales.revenue)!, 1)} del total` });
  if (ve.cc) celdas.push({ t: "Cash Collected (CC)", v: money(x.cc, moneda, 0), sub: pesoDe(x.cc, totales.cc) === null ? undefined : `${pct(pesoDe(x.cc, totales.cc)!, 1)} del total` });
  if (ve.tasaCobro) celdas.push({ t: "Tasa de cobro", v: tc === null ? "—" : pct(tc, 1) });
  if (ve.mora) celdas.push({ t: "Tasa de mora (hoy)", v: mora === null ? "—" : pct(mora, 1), sub: x.exigibles ? `${x.vencidas} de ${x.exigibles} cuotas` : undefined });
  return (
    <div className={`gr-detalle${suelto ? " gr-detalle--suelto" : ""}`} role="region" aria-label={`Detalle de ${x.nombre}`}>
      <dl className="gr-detalle__datos">
        {celdas.map((c) => (
          <div key={c.t}><dt>{c.t}</dt><dd className="t-num">{c.v}{c.sub && <span className="gr-detalle__sub">{c.sub}</span>}</dd></div>
        ))}
      </dl>
      {x.crudos && x.crudos.length > 0 && (
        <p className="gr-detalle__nota">
          Esto está escrito como {x.crudos.map((c, i) => <React.Fragment key={c}>{i > 0 ? ", " : ""}«{c}»</React.Fragment>)}: no se reconoce como un país. Corregilo en la ficha de la persona y suma donde corresponde.
        </p>
      )}
      {x.sinDato && !x.crudos?.length && (
        <p className="gr-detalle__nota">
          {dim === "pais"
            ? "Estas ventas no tienen país: ni la persona, ni su lead, ni su alumno lo tienen cargado. Cargalo en la ficha de la persona y pasa a su país. Se cuentan igual en el total."
            : dim === "plan"
              ? "Son cobros que no se pudieron atar a una venta. Se cuentan igual en el total."
              : `Estas ventas no tienen ${dim === "estrategia" ? "estrategia" : dim === "servicio" ? "servicio" : "proyecto"} cargado (o son cobros de una venta que ya no está). Se cuentan igual en el total.`}
        </p>
      )}
      {onAbrir && (
        <div className="gr-detalle__acciones">
          {(ve.revenue || ve.unidades) && x.revenue + x.unidades > 0 && (
            <button type="button" className="link t-sm" onClick={() => onAbrir("ventas")}>
              <ExternalLink size={13} aria-hidden /> Ver las ventas {metrica === "unidades" ? `(${x.unidades})` : ""}
            </button>
          )}
          {ve.cc && x.cc > 0 && (
            <button type="button" className="link t-sm" onClick={() => onAbrir("cobros")}>
              <ExternalLink size={13} aria-hidden /> Ver los cobros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
