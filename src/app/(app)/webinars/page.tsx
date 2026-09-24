"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Info, Pencil, Plus, Video, Youtube } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, CardHead, Chip, Empty, StatCard } from "@/components/ui/ui";
import { ConfigColumnas, type DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { DateRangePicker, diaDeNegocio, enRango, rangoMax, rangoSub } from "@/components/ui/DateRangePicker";
import { AreaChart } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { Planilla, type ColumnaPlanilla } from "@/components/webinars/Planilla";
import { FiltroWebinars } from "@/components/webinars/FiltroWebinars";
import { AsistenteWebinar } from "@/components/webinars/AsistenteWebinar";
import { guardarMetrica, guardarWebinar } from "@/components/webinars/guardar";
import { diaCorto, diaYHora, hoyArgentina } from "@/components/webinars/fechas";
import { AvisoEnVivo } from "@/components/webinars/AvisoEnVivo";
import { useWebinarsAlDia } from "@/components/webinars/useVivo";
import { CLAVE_LISTA, ESTADO_WEBINAR, ESTADOS, tonoRoas } from "@/components/webinars/estado";
import { useEstado } from "@/lib/store";
import { useRangoURL } from "@/lib/useRango";
import { money, num, pct } from "@/lib/format";
import {
  CAMPOS_MANUALES, metricasDeWebinar, sumarMetricas, type MetricasWebinar,
} from "@/lib/webinar";
import type { CampoPersonalizado, EstadoWebinar, Webinar } from "@/lib/types";

/* ==================================================================
   Webinars: una planilla viva.

   Cada fila es un webinar y cada número que se carga a mano se escribe
   en la celda, como en Excel: la pauta, los formularios, el grupo, las
   llamadas. Lo demás (costos, tasas, ROAS, profit) se recalcula en el
   momento. Los filtros de arriba recortan todo junto: KPIs, gráfico,
   planilla y totales.
   ================================================================== */

/* Lo que se calcula solo. `vacio` = si el divisor es cero, se muestra una
   raya: un CPA de US$ 0 cuando no hubo ventas diría que salió gratis. */
type Tipo = "plata" | "costo" | "cantidad" | "tasa" | "roas" | "profit";
const CALCULADAS: {
  clave: keyof MetricasWebinar; titulo: string; grupo: string; ayuda: string; tipo: Tipo; decimales?: number;
}[] = [
  { clave: "inversionTotal", titulo: "Inversión total", grupo: "Inversión", ayuda: "Pauta + DM Ads + WhatsApp API.", tipo: "plata" },
  { clave: "llamadas", titulo: "Llamadas agendadas", grupo: "Llamadas", ayuda: "Las agendadas en el vivo más las de después.", tipo: "cantidad" },
  { clave: "cplFormulario", titulo: "Costo por formulario", grupo: "Costos", ayuda: "Inversión total sobre formularios.", tipo: "costo", decimales: 2 },
  { clave: "cplGrupo", titulo: "Costo por unión al grupo", grupo: "Costos", ayuda: "Inversión total sobre los que entraron al grupo.", tipo: "costo", decimales: 2 },
  { clave: "cpLlamada", titulo: "Costo por llamada", grupo: "Costos", ayuda: "Inversión total sobre llamadas agendadas.", tipo: "costo" },
  { clave: "cpLlamadaCalificada", titulo: "Costo por llamada calificada", grupo: "Costos", ayuda: "Inversión total sobre llamadas calificadas.", tipo: "costo" },
  { clave: "cpa", titulo: "CPA", grupo: "Costos", ayuda: "Inversión total sobre ventas: lo que costó cada venta.", tipo: "costo" },
  { clave: "asistenciaFormulario", titulo: "Form → grupo", grupo: "Conversión", ayuda: "De los que completaron el formulario, cuántos entraron al grupo.", tipo: "tasa" },
  { clave: "asistenciaTaller", titulo: "Asistencia", grupo: "Conversión", ayuda: "Del grupo, cuántos estuvieron en el vivo.", tipo: "tasa" },
  { clave: "porcentajeAgenda", titulo: "Grupo → agenda", grupo: "Conversión", ayuda: "Del grupo, cuántos agendaron una llamada.", tipo: "tasa" },
  { clave: "agendaSobreAsisten", titulo: "Asisten → agenda", grupo: "Conversión", ayuda: "De los que vieron el vivo, cuántos agendaron.", tipo: "tasa" },
  { clave: "convLeadVenta", titulo: "Grupo → venta", grupo: "Conversión", ayuda: "Del grupo, cuántos compraron.", tipo: "tasa", decimales: 2 },
  { clave: "tasaCierre", titulo: "Tasa de cierre", grupo: "Conversión", ayuda: "Ventas sobre llamadas calificadas.", tipo: "tasa" },
  { clave: "ventas", titulo: "Ventas", grupo: "Plata", ayuda: "Las ventas cargadas con este webinar como origen. Entran solas.", tipo: "cantidad" },
  { clave: "facturado", titulo: "Facturado", grupo: "Plata", ayuda: "El precio acordado de esas ventas.", tipo: "plata" },
  { clave: "cobrado", titulo: "Cobrado", grupo: "Plata", ayuda: "La plata que ya entró de esas ventas.", tipo: "plata" },
  { clave: "comisiones", titulo: "Comisiones", grupo: "Plata", ayuda: "Closer y director, sobre lo cobrado neto de procesador.", tipo: "plata" },
  { clave: "procesador", titulo: "Procesador", grupo: "Plata", ayuda: "Lo que se quedaron las pasarelas de pago.", tipo: "plata" },
  { clave: "roasRev", titulo: "ROAS facturado", grupo: "Plata", ayuda: "Facturado sobre inversión total.", tipo: "roas" },
  { clave: "roasCC", titulo: "ROAS cobrado", grupo: "Plata", ayuda: "Cobrado sobre inversión total.", tipo: "roas" },
  { clave: "beneficioRev", titulo: "Profit facturado", grupo: "Plata", ayuda: "Facturado menos inversión, comisiones y procesador.", tipo: "profit" },
  { clave: "beneficioCC", titulo: "Profit cobrado", grupo: "Plata", ayuda: "Cobrado menos inversión, comisiones y procesador.", tipo: "profit" },
];

const COLUMNAS_FIJAS: DefColumna[] = [
  { clave: "titulo", titulo: "Webinar", fija: true },
  { clave: "fecha", titulo: "Fecha", grupo: "Identidad", ayuda: "Día y hora del vivo, en hora de Argentina." },
  { clave: "estado", titulo: "Estado", grupo: "Identidad" },
  ...CAMPOS_MANUALES.map((c) => ({ clave: c.campo, titulo: c.titulo, grupo: `${c.grupo} · a mano`, ayuda: c.ayuda })),
  ...CALCULADAS.map((c) => ({ clave: c.clave, titulo: c.titulo, grupo: c.grupo, ayuda: c.ayuda })),
];

/* Lo que se carga todos los días a la vista, más los cuatro números que
   dicen si el webinar funcionó. El resto se prende desde "Columnas". */
const POR_DEFECTO = [
  "titulo", "fecha", "estado",
  "inversion", "inversionDmAds", "costoWhatsappApi",
  "formularios", "grupoWpp", "asistentes",
  "llamadasVivo", "llamadasPosterior", "llamadasCalificadas",
  "cplFormulario", "cpa", "ventas", "roasCC", "beneficioCC",
];

const esNumerico = (c: CampoPersonalizado) => c.tipo === "numero" || c.tipo === "moneda";

export default function Webinars() {
  const e = useEstado();
  /* Las llamadas, los asistentes y el estado que completa el cron, al día. */
  useWebinarsAlDia(e.webinars.map((w) => w.id));
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [nuevo, setNuevo] = useState(false);

  const mon = e.ajustes.monedaBase;
  const M = useCallback((n: number, d = 0) => money(n, mon, d), [mon]);

  /* Los filtros viven en la URL, como en Leads y Marketing: se puede mandar
     el link de "los webinars de agosto" y volver de la ficha los conserva. */
  const setParams = useCallback((cambios: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    const s = q.toString();
    router.replace(s ? `/webinars?${s}` : "/webinars", { scroll: false });
  }, [params, router]);

  /* Links viejos: ?ver=<id> abría el panel lateral, que ahora es una
     pantalla propia. ?nuevo=1 abre el asistente. */
  useEffect(() => {
    const ver = params.get("ver");
    if (ver) { router.replace(`/webinars/${encodeURIComponent(ver)}`); return; }
    if (params.get("nuevo") === "1") { setNuevo(true); setParams({ nuevo: null }); }
  }, [params, router, setParams]);

  useEffect(() => {
    const q = params.toString();
    try { sessionStorage.setItem(CLAVE_LISTA, q ? `/webinars?${q}` : "/webinars"); } catch { /* modo privado */ }
  }, [params]);

  /* ---------- Período ----------
     Arranca en "Máximo": son dos webinars por mes, y los que vienen también
     tienen que verse (el que se crea para dentro de dos semanas no puede
     desaparecer de la lista). "Máximo" se recalcula siempre contra los
     datos, así un webinar nuevo más adelante no queda afuera de un rango
     guardado en la URL. */
  const limites = useMemo(() => {
    const dias = e.webinars.map((w) => diaDeNegocio(w.fecha)).filter(Boolean).sort();
    const hoy = hoyArgentina();
    const ultimo = dias[dias.length - 1];
    return { min: dias[0] ?? null, max: ultimo && ultimo > hoy ? ultimo : hoy };
  }, [e.webinars]);
  const [rangoURL, setRango] = useRangoURL("max");
  const sinPeriodo = !params.get("periodo");
  const rango = useMemo(
    () => (sinPeriodo || rangoURL.preset === "max" ? rangoMax(limites.min, limites.max) : rangoURL),
    [sinPeriodo, rangoURL, limites],
  );
  const periodoTexto = rango.preset === "max" ? "desde el primero" : rangoSub(rango);

  const estado = (ESTADOS as string[]).includes(params.get("estado") ?? "") ? (params.get("estado") as EstadoWebinar) : null;
  const elegidos = useMemo(() => (params.get("webinars") ?? "").split(",").filter(Boolean), [params]);

  const fuera = useMemo(
    () => new Set(e.webinars.filter((w) => !enRango(w.fecha, rango)).map((w) => w.id)),
    [e.webinars, rango],
  );
  /* Todo menos el estado: sobre esto cuentan los chips, así el chip elegido
     no se queda con todo y los demás en cero. */
  const base = useMemo(
    () => e.webinars.filter((w) => !fuera.has(w.id) && (elegidos.length === 0 || elegidos.includes(w.id))),
    [e.webinars, fuera, elegidos],
  );
  const filtrados = useMemo(() => base.filter((w) => !estado || w.estado === estado), [base, estado]);
  const hayFiltros = Boolean(estado || elegidos.length > 0 || (!sinPeriodo && rangoURL.preset !== "max"));

  /* Una vez por webinar y por cambio: la planilla lee de acá en cada celda. */
  const metricas = useMemo(
    () => new Map(filtrados.map((w) => [w.id, metricasDeWebinar(e, w)] as const)),
    [e, filtrados],
  );
  const total = useMemo(() => sumarMetricas([...metricas.values()]), [metricas]);
  const m = (w: Webinar) => metricas.get(w.id) ?? metricasDeWebinar(e, w);

  const serie = useMemo(
    () => filtrados
      .filter((w) => w.estado === "finalizado")
      .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
      .map((w) => ({ webinar: w, m: metricas.get(w.id)! })),
    [filtrados, metricas],
  );

  /* ---------- Columnas ----------
     Los campos que se agregan en Ajustes para los webinars también son
     columnas: los numéricos se cargan en la celda, igual que los demás. */
  const propios = useMemo(() => e.campos.filter((c) => c.entidad === "webinar"), [e.campos]);
  const todas = useMemo<DefColumna[]>(
    () => [...COLUMNAS_FIJAS, ...propios.map((c) => ({ clave: `extra:${c.clave}`, titulo: c.nombre, grupo: "Campos propios", ayuda: c.ayuda }))],
    [propios],
  );
  const cols = useColumnas("webinars", todas, POR_DEFECTO);

  const mostrar = (tipo: Tipo, n: number, decimales = 0): React.ReactNode => {
    if (tipo === "plata") return M(n, decimales);
    if (tipo === "cantidad") return num(n);
    if (n === 0) return <span className="t-subtle">—</span>;
    if (tipo === "costo") return M(n, decimales);
    if (tipo === "tasa") return pct(n, decimales || 1);
    if (tipo === "roas") return <span style={{ color: tonoRoas(n), fontWeight: 600 }}>{num(n, 2)}x</span>;
    return <span style={{ color: n >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{M(n)}</span>;
  };

  const DEF: Record<string, ColumnaPlanilla<Webinar>> = {
    titulo: {
      clave: "titulo", titulo: "Webinar", orden: (w) => (w.titulo ?? "").toLowerCase(),
      enlace: (w, nav) => (
        <Link href={`/webinars/${w.id}`} className="planilla__enlace" title={`Abrir «${w.titulo}»`} {...nav}>
          <span className="truncate">{w.titulo || "Sin título"}</span>
          {w.youtubeUrl && <Youtube size={14} className="planilla__yt" aria-label="Tiene video" />}
        </Link>
      ),
    },
    fecha: { clave: "fecha", titulo: "Fecha", orden: (w) => +new Date(w.fecha), celda: (w) => <span className="t-subtle">{diaYHora(w.fecha)}</span> },
    estado: {
      clave: "estado", titulo: "Estado", orden: (w) => ESTADOS.indexOf(w.estado),
      celda: (w) => {
        const et = ESTADO_WEBINAR[w.estado] ?? ESTADO_WEBINAR.borrador;
        return <Badge variante={et.variante}>{et.texto}</Badge>;
      },
    },
  };

  for (const c of CAMPOS_MANUALES) {
    const formato = (n: number) => (c.moneda ? M(n) : num(n));
    DEF[c.campo] = {
      clave: c.campo, titulo: c.titulo, ayuda: c.ayuda, num: true,
      orden: (w) => w[c.campo],
      editable: {
        valor: (w) => w[c.campo],
        guardar: (w, n) => guardarMetrica(w, c.campo, n, formato),
        formato,
        decimales: c.moneda ? 2 : 0,
        etiqueta: (w) => `${c.largo} de «${w.titulo}»`,
      },
      total: formato(filtrados.reduce((a, w) => a + w[c.campo], 0)),
    };
  }

  for (const c of CALCULADAS) {
    DEF[c.clave] = {
      clave: c.clave, titulo: c.titulo, ayuda: c.ayuda, num: true,
      orden: (w) => m(w)[c.clave],
      celda: (w) => mostrar(c.tipo, m(w)[c.clave], c.decimales),
      total: mostrar(c.tipo, total[c.clave], c.decimales),
    };
  }

  for (const c of propios) {
    const clave = `extra:${c.clave}`;
    if (esNumerico(c)) {
      const formato = (n: number) => (c.tipo === "moneda" ? M(n) : num(n, Number.isInteger(n) ? 0 : 2));
      const valor = (w: Webinar) => Number(w.extra?.[c.clave] ?? 0) || 0;
      DEF[clave] = {
        clave, titulo: c.nombre, ayuda: c.ayuda, num: true, orden: valor,
        editable: {
          valor, formato, decimales: 2,
          etiqueta: (w) => `${c.nombre} de «${w.titulo}»`,
          guardar: (w, n) => guardarWebinar(
            w, { extra: { ...w.extra, [c.clave]: n } },
            `${c.nombre} de «${w.titulo}»: ${formato(valor(w))} → ${formato(n)}.`,
          ),
        },
        total: formato(filtrados.reduce((a, w) => a + valor(w), 0)),
      };
    } else {
      const texto = (w: Webinar) => {
        const v = w.extra?.[c.clave];
        if (c.tipo === "booleano") return v ? "Sí" : "No";
        return v === undefined || v === null || v === "" ? "—" : String(v);
      };
      DEF[clave] = { clave, titulo: c.nombre, ayuda: c.ayuda, orden: texto, celda: texto };
    }
  }

  const columnas = cols.visibles.map((k) => DEF[k]).filter(Boolean);

  function limpiarFiltros() {
    setParams({ estado: null, webinars: null, periodo: null, desde: null, hasta: null });
  }

  return (
    <div className="stack-5">
      <PageHead
        titulo="Webinars"
        sub="Cada webinar con sus números, del formulario a la venta. Se cargan en la planilla, como en Excel, y todo lo demás se calcula solo."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max} onApply={setRango}
              footerNota="Por el día del vivo · hora de Argentina"
            />
            <FiltroWebinars
              webinars={e.webinars} elegidos={elegidos} fuera={fuera}
              onCambiar={(ids) => setParams({ webinars: ids.length ? ids.join(",") : null })}
            />
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setNuevo(true)}>Nuevo webinar</Button>
          </>
        }
      />

      <AvisoEnVivo />

      {e.webinars.length > 0 && (
        <div className="row-wrap">
          <Chip activo={!estado} onClick={() => setParams({ estado: null })} count={base.length}>Todos</Chip>
          {ESTADOS.map((k) => (
            <Chip key={k} activo={estado === k} onClick={() => setParams({ estado: estado === k ? null : k })}
              count={base.filter((w) => w.estado === k).length}>
              {ESTADO_WEBINAR[k].texto}
            </Chip>
          ))}
          {hayFiltros && (
            <button type="button" className="link t-sm" style={{ marginLeft: 8 }} onClick={limpiarFiltros}>Limpiar filtros</button>
          )}
        </div>
      )}

      <div className="grid-stats">
        <StatCard
          hero etiqueta="ROAS cobrado" valor={total.roasCC > 0 ? `${num(total.roasCC, 2)}x` : "—"}
          delta={total.roasRev > 0 ? `${num(total.roasRev, 2)}x facturado` : undefined} direccion="accent"
          contexto={`${filtrados.length} ${filtrados.length === 1 ? "webinar" : "webinars"} · ${periodoTexto}`}
          ayuda="Cash collected sobre la inversión total (pauta + DM Ads + WhatsApp API)."
        />
        <StatCard etiqueta="Inversión total" valor={M(total.inversionTotal)} contexto="pauta, DM Ads y WhatsApp API" />
        <StatCard
          etiqueta="Formularios" valor={num(total.formularios)}
          contexto={total.formularios > 0 ? `${M(total.cplFormulario, 2)} cada uno` : "todavía sin cargar"}
        />
        <StatCard
          etiqueta="Profit cobrado" valor={M(total.beneficioCC)}
          contexto={total.ventas > 0
            ? `${num(total.ventas)} ${total.ventas === 1 ? "venta" : "ventas"} · ${M(total.cpa)} de CPA`
            : "sin ventas todavía"}
          ayuda="Lo cobrado menos pauta, DM Ads, WhatsApp API, comisiones y procesador."
        />
      </div>

      {serie.length > 1 && (
        <Card>
          <CardHead titulo="Evolución del ROAS" sub="Webinar a webinar, en orden. La línea llena es lo cobrado; la punteada, lo facturado." />
          <AreaChart
            datos={serie.map(({ webinar, m: x }) => ({
              etiqueta: diaCorto(webinar.fecha).replace(/ \d{4}$/, ""), valor: x.roasCC, valor2: x.roasRev, completo: webinar.titulo,
            }))}
            serie="ROAS cobrado" serie2="ROAS facturado" formato={(n) => `${num(n, 1)}x`} alto={220}
          />
        </Card>
      )}

      <Card className="planilla-card">
        <div className="planilla-cabeza">
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <h2 className="card-head__title">Planilla</h2>
            <p className="card-head__sub">
              Las columnas con <Pencil size={11} aria-label="lápiz" /> se cargan a mano: click en la celda, escribí y
              Enter para bajar, o Tab para pasar a la de al lado. Esc deja todo como estaba. El título abre la ficha
              del webinar.
            </p>
          </div>
          <ConfigColumnas
            todas={todas} visibles={cols.visibles}
            alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar}
          />
        </div>
        <Planilla
          filas={filtrados}
          columnas={columnas}
          etiqueta="Planilla de webinars"
          ordenInicial={{ clave: "fecha", desc: true }}
          totalEtiqueta={<span>Total <span className="t-subtle t-num">· {filtrados.length}</span></span>}
          onError={(msg) => toast(msg, "err")}
          vacio={
            e.webinars.length === 0 ? (
              <Empty
                icono={<Video size={22} />}
                titulo="Todavía no cargaste ningún webinar"
                texto="Crealo con el título y la fecha. Los números los vas cargando acá mismo, como en una planilla, a medida que pasan."
                accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setNuevo(true)}>Crear el primero</Button>}
              />
            ) : (
              <Empty
                icono={<Video size={22} />}
                titulo="Ningún webinar coincide con los filtros"
                texto="Probá con otro período, otro estado o sacá los webinars elegidos."
                accion={<Button variante="secondary" onClick={limpiarFiltros}>Limpiar filtros</Button>}
              />
            )
          }
        />
      </Card>

      <Ayuda titulo="Por qué hay dos ROAS" icono={<Info size={18} />}>
        El <strong>facturado</strong> asume que todas las cuotas se van a pagar; el <strong>cobrado</strong> sólo
        cuenta la plata que ya entró. Un webinar puede tener ROAS 5 facturado y 2 cobrado: vendió bien, pero
        todavía falta cobrar. Los dos importan y por eso van siempre juntos.
      </Ayuda>

      {nuevo && (
        <AsistenteWebinar
          onCerrar={() => setNuevo(false)}
          onCreado={(id, titulo) => {
            setNuevo(false);
            toast(`«${titulo}» ya está. Los números los cargás en la ficha o en la planilla.`);
            router.push(`/webinars/${id}`);
          }}
        />
      )}
    </div>
  );
}
