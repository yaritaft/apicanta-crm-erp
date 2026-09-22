"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Megaphone, Search, SearchX, X } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Avatar, Badge, Button, Card, CardHead, Chip, Empty, Input, Select, StatCard, Tabs, Tag,
  type VarianteBadge,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { ConectarMeta } from "@/components/shell/ConectarMeta";
import { AreaChart, BarChart, COLORES, Donut, truncar } from "@/components/charts/charts";
import { DateRangePicker, diaDeNegocio, rangoSub, type RangoFechas } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useToast } from "@/components/ui/Toast";
import { useEstado, useSync } from "@/lib/store";
import { money, num, pct, relativo } from "@/lib/format";
import {
  claveEstado, filasMeta, gastoDiario, personasDelAnuncio, primerDiaConDatos, totalesMeta,
  type FilaMeta, type MetricasMeta, type NivelMeta, type PersonaDelAnuncio,
} from "@/lib/metricas";
import type { Ad } from "@/lib/types";

/* Marketing como el Administrador de anuncios: campañas → conjuntos →
   anuncios, cada nivel en su tabla. Tocar una campaña baja a sus conjuntos,
   tocar un conjunto baja a sus anuncios, y tocar un anuncio abre su detalle
   con las personas que entraron por él.

   Dónde se está parado vive en la URL (?nivel=, ?campania=, ?conjunto=,
   ?anuncio=): un link lleva exactamente a esa vista, y desde la ficha de un
   lead se llega a su anuncio. */

type Nivel = "campanias" | "conjuntos" | "anuncios";
type Vista = Nivel | "resumen";
const VISTAS: readonly Vista[] = ["campanias", "conjuntos", "anuncios", "resumen"];
const esVista = (v: string | null): v is Vista => v !== null && (VISTAS as readonly string[]).includes(v);

const NIVEL_META: Record<Nivel, NivelMeta> = { campanias: "campania", conjuntos: "conjunto", anuncios: "anuncio" };

/* Cómo se nombra cada nivel en los textos. El género importa: "campaña
   activa", "conjunto activo", "ninguna campaña", "ningún anuncio". */
const PALABRAS: Record<Nivel, { titulo: string; uno: string; varios: string; fem: boolean; buscar: string }> = {
  campanias: { titulo: "Campaña", uno: "campaña", varios: "campañas", fem: true, buscar: "Buscá una campaña" },
  conjuntos: { titulo: "Conjunto", uno: "conjunto", varios: "conjuntos", fem: false, buscar: "Buscá un conjunto" },
  anuncios: { titulo: "Anuncio", uno: "anuncio", varios: "anuncios", fem: false, buscar: "Buscá un anuncio" },
};

const cuantos = (n: number, nivel: Nivel) => `${num(n)} ${n === 1 ? PALABRAS[nivel].uno : PALABRAS[nivel].varios}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ---------- Estados ----------
   Las claves son las de Meta en minúscula (ver `claveEstado`). Las dos
   "apagado" no son un estado de Meta sino la entrega: el anuncio está activo
   pero su campaña o su conjunto no, así que no sale. Es lo que Meta muestra en
   la columna "Entrega". */
const ESTADOS: Record<string, { f: string; m: string; variante: VarianteBadge }> = {
  active: { f: "Activa", m: "Activo", variante: "success" },
  paused: { f: "Pausada", m: "Pausado", variante: "warning" },
  campaign_paused: { f: "Campaña apagada", m: "Campaña apagada", variante: "neutral" },
  adset_paused: { f: "Conjunto apagado", m: "Conjunto apagado", variante: "neutral" },
  in_process: { f: "En proceso", m: "En proceso", variante: "info" },
  pending_review: { f: "En revisión", m: "En revisión", variante: "info" },
  preapproved: { f: "Preaprobada", m: "Preaprobado", variante: "info" },
  with_issues: { f: "Con problemas", m: "Con problemas", variante: "danger" },
  disapproved: { f: "Rechazada", m: "Rechazado", variante: "danger" },
  pending_billing_info: { f: "Falta el pago", m: "Falta el pago", variante: "warning" },
  archived: { f: "Archivada", m: "Archivado", variante: "neutral" },
  deleted: { f: "Eliminada", m: "Eliminado", variante: "neutral" },
  "sin-estado": { f: "Sin estado", m: "Sin estado", variante: "neutral" },
};
const ORDEN_ESTADOS = Object.keys(ESTADOS);
const posicionEstado = (k: string) => {
  const i = ORDEN_ESTADOS.indexOf(k);
  return i === -1 ? ORDEN_ESTADOS.length : i;
};

function estadoDe(clave: string, nivel: Nivel): { texto: string; variante: VarianteBadge } {
  const e = ESTADOS[clave];
  if (e) return { texto: PALABRAS[nivel].fem ? e.f : e.m, variante: e.variante };
  /* Uno que Meta agregue mañana: se muestra legible en vez de romper. */
  return { texto: capital(clave.replace(/_/g, " ")), variante: "neutral" };
}

/* ---------- Columnas ----------
   Los nombres y el orden son los del Ads Manager, para que quien viene de ahí
   no tenga que traducir nada. Primero lo de Meta; al final, lo nuestro: las
   personas que entraron y lo que compraron. */
const METRICAS: DefColumna[] = [
  { clave: "inversion", titulo: "Inversión", grupo: "Inversión" },
  { clave: "cpm", titulo: "CPM", grupo: "Inversión", ayuda: "Costo por mil impresiones." },

  { clave: "impresiones", titulo: "Impresiones", grupo: "Alcance", ayuda: "Veces que se mostró, contando repetidas." },
  { clave: "alcance", titulo: "Alcance (suma diaria)", grupo: "Alcance", ayuda: "Personas alcanzadas, sumadas día por día. Meta cuenta personas distintas en todo el período; acá quien lo vio dos días cuenta dos veces, así que da más que en el Administrador de anuncios." },
  { clave: "frecuencia", titulo: "Frecuencia diaria", grupo: "Alcance", ayuda: "Veces por día que lo vio cada persona, en promedio. Alta con el CTR cayendo es fatiga de creativo." },

  { clave: "clicks", titulo: "Clicks", grupo: "Clicks", ayuda: "Todos: incluye likes, comentarios y «ver más»." },
  { clave: "ctr", titulo: "CTR", grupo: "Clicks" },
  { clave: "cpc", titulo: "CPC", grupo: "Clicks" },
  { clave: "clicksEnlace", titulo: "Clicks en el enlace", grupo: "Clicks", ayuda: "Los que se fueron a la landing. Para el embudo, vale éste." },
  { clave: "ctrEnlace", titulo: "CTR del enlace", grupo: "Clicks" },
  { clave: "cpcEnlace", titulo: "Costo por click en enlace", grupo: "Clicks" },

  { clave: "leads", titulo: "Leads según Meta", grupo: "Conversión", ayuda: "Los registros que contó el píxel de Meta." },
  { clave: "cpl", titulo: "Costo por lead", grupo: "Conversión", ayuda: "Inversión sobre los leads según Meta." },

  { clave: "personas", titulo: "Personas", grupo: "Personas", ayuda: "Contactos que entraron por estos anuncios en el período: la gente que tenemos en la base, no lo que cuenta el píxel." },
  { clave: "costoPersona", titulo: "Costo por persona", grupo: "Personas" },

  { clave: "ventas", titulo: "Ventas", grupo: "Negocio", ayuda: "Lo que compraron esas personas, sin importar cuándo. Las canceladas no cuentan." },
  { clave: "costoVenta", titulo: "Costo por venta", grupo: "Negocio" },
  { clave: "facturado", titulo: "Facturado", grupo: "Negocio" },
  { clave: "cobrado", titulo: "Cobrado", grupo: "Negocio" },
  { clave: "roas", titulo: "ROAS", grupo: "Negocio", ayuda: "Lo cobrado de esas ventas sobre la inversión." },

  { clave: "dias", titulo: "Días con datos", grupo: "Otras", ayuda: "Un costo bajísimo con un solo día de datos no es un costo bajo: es una muestra chica." },
];

const ESTADO: DefColumna = { clave: "estado", titulo: "Estado", grupo: "Identidad", ayuda: "Si está saliendo, según Meta." };
const ANUNCIOS: DefColumna = { clave: "anuncios", titulo: "Anuncios con datos", grupo: "Otras" };

/* Constantes de módulo a propósito: useColumnas las usa de dependencia, y un
   catálogo nuevo en cada render lo haría releer lo guardado sin parar. */
const CATALOGO: Record<Nivel, DefColumna[]> = {
  campanias: [
    { clave: "nombre", titulo: "Campaña", fija: true },
    ESTADO,
    { clave: "objetivo", titulo: "Objetivo", grupo: "Identidad" },
    ...METRICAS,
    ANUNCIOS,
  ],
  conjuntos: [
    { clave: "nombre", titulo: "Conjunto", fija: true },
    { clave: "campania", titulo: "Campaña", grupo: "Identidad" },
    ESTADO,
    ...METRICAS,
    ANUNCIOS,
  ],
  anuncios: [
    { clave: "nombre", titulo: "Anuncio", fija: true },
    { clave: "campania", titulo: "Campaña", grupo: "Identidad" },
    { clave: "conjunto", titulo: "Conjunto", grupo: "Identidad" },
    ESTADO,
    ...METRICAS,
  ],
};

const POR_DEFECTO: Record<Nivel, string[]> = {
  campanias: ["nombre", "estado", "inversion", "impresiones", "clicksEnlace", "leads", "cpl", "personas", "ventas", "roas"],
  conjuntos: ["nombre", "campania", "estado", "inversion", "impresiones", "clicksEnlace", "leads", "cpl", "personas", "ventas"],
  anuncios: ["nombre", "campania", "conjunto", "estado", "inversion", "impresiones", "clicksEnlace", "leads", "cpl", "personas"],
};

/* Cada métrica, definida una sola vez: de acá salen la celda, el orden y el
   total del pie, así la fila de totales no puede formatear distinto que las
   filas. `hay` dice cuándo el número significa algo: un costo por lead sin
   leads no es cero, es "no hay". Y al ordenar, lo que no hay va al final, no
   primero como si fuera lo más barato. */
type Metrica = {
  valor: (m: MetricasMeta) => number;
  texto: (m: MetricasMeta) => string;
  hay?: (m: MetricasMeta) => boolean;
  /* Dónde cae lo que no hay al ordenar: al final de menor a mayor para los
     costos, al final de mayor a menor para las tasas. */
  sinDato?: number;
};

type FormatoPlata = (n: number, decimales?: number) => string;

function metricas(M: FormatoPlata): Record<string, Metrica> {
  const COSTO = Number.MAX_VALUE, TASA = -1;
  return {
    inversion: { valor: (m) => m.inversion, texto: (m) => M(m.inversion) },
    cpm: { valor: (m) => m.cpm, texto: (m) => M(m.cpm, 2), hay: (m) => m.impresiones > 0, sinDato: COSTO },
    impresiones: { valor: (m) => m.impresiones, texto: (m) => num(m.impresiones) },
    alcance: { valor: (m) => m.alcance ?? 0, texto: (m) => num(m.alcance ?? 0), hay: (m) => m.alcance !== null, sinDato: TASA },
    frecuencia: { valor: (m) => m.frecuencia ?? 0, texto: (m) => num(m.frecuencia ?? 0, 2), hay: (m) => m.frecuencia !== null, sinDato: TASA },
    clicks: { valor: (m) => m.clicks, texto: (m) => num(m.clicks) },
    ctr: { valor: (m) => m.ctr, texto: (m) => pct(m.ctr, 2), hay: (m) => m.impresiones > 0, sinDato: TASA },
    cpc: { valor: (m) => m.cpc, texto: (m) => M(m.cpc, 2), hay: (m) => m.clicks > 0, sinDato: COSTO },
    clicksEnlace: { valor: (m) => m.clicksEnlace, texto: (m) => num(m.clicksEnlace) },
    ctrEnlace: { valor: (m) => m.ctrEnlace, texto: (m) => pct(m.ctrEnlace, 2), hay: (m) => m.impresiones > 0, sinDato: TASA },
    cpcEnlace: { valor: (m) => m.cpcEnlace, texto: (m) => M(m.cpcEnlace, 2), hay: (m) => m.clicksEnlace > 0, sinDato: COSTO },
    leads: { valor: (m) => m.leads, texto: (m) => num(m.leads) },
    cpl: { valor: (m) => m.cpl, texto: (m) => M(m.cpl, 2), hay: (m) => m.leads > 0, sinDato: COSTO },
    personas: { valor: (m) => m.personas, texto: (m) => num(m.personas) },
    costoPersona: { valor: (m) => m.costoPorPersona, texto: (m) => M(m.costoPorPersona, 2), hay: (m) => m.personas > 0, sinDato: COSTO },
    ventas: { valor: (m) => m.ventas, texto: (m) => num(m.ventas) },
    costoVenta: { valor: (m) => m.costoPorVenta, texto: (m) => M(m.costoPorVenta), hay: (m) => m.ventas > 0, sinDato: COSTO },
    facturado: { valor: (m) => m.facturado, texto: (m) => M(m.facturado) },
    cobrado: { valor: (m) => m.cobrado, texto: (m) => M(m.cobrado) },
    roas: { valor: (m) => m.roas, texto: (m) => `${num(m.roas, 2)}x`, hay: (m) => m.inversion > 0, sinDato: TASA },
  };
}

const mostrar = (x: Metrica, m: MetricasMeta) => (x.hay && !x.hay(m) ? "—" : x.texto(m));

function definirColumnas(
  nivel: Nivel, total: MetricasMeta & { anuncios: number }, cuantas: number, M: FormatoPlata,
): Record<string, Columna<FilaMeta>> {
  const cols: Record<string, Columna<FilaMeta>> = {
    nombre: {
      clave: "nombre", titulo: PALABRAS[nivel].titulo, tipo: "primary",
      orden: (f) => f.nombre,
      celda: (f) => (
        <span className="mk-nombre" title={f.nombre}>
          <span className="mk-nombre__txt">{f.nombre || "Sin nombre"}</span>
          {/* La flecha avisa que la fila baja un nivel; el anuncio abre su detalle. */}
          {nivel !== "anuncios" && <ChevronRight size={14} className="mk-nombre__ir" aria-hidden />}
        </span>
      ),
      pie: `Total · ${cuantos(cuantas, nivel)}`,
    },
    campania: {
      clave: "campania", titulo: "Campaña", tipo: "secondary",
      orden: (f) => f.campaignNombre,
      celda: (f) => <span className="mk-contexto" title={f.campaignNombre}>{f.campaignNombre || "—"}</span>,
    },
    conjunto: {
      clave: "conjunto", titulo: "Conjunto", tipo: "secondary",
      orden: (f) => f.adsetNombre ?? "",
      celda: (f) => <span className="mk-contexto" title={f.adsetNombre}>{f.adsetNombre || "—"}</span>,
    },
    estado: {
      clave: "estado", titulo: "Estado",
      orden: (f) => posicionEstado(f.entrega),
      celda: (f) => {
        const s = estadoDe(f.entrega, nivel);
        return <Badge variante={s.variante}>{s.texto}</Badge>;
      },
    },
    objetivo: {
      clave: "objetivo", titulo: "Objetivo", tipo: "secondary",
      orden: (f) => f.objetivo, celda: (f) => f.objetivo || "—",
    },
    dias: {
      clave: "dias", titulo: "Días con datos", tipo: "num",
      orden: (f) => f.dias, celda: (f) => num(f.dias),
    },
    anuncios: {
      clave: "anuncios", titulo: "Anuncios con datos", tipo: "num",
      orden: (f) => f.anuncios, celda: (f) => num(f.anuncios), pie: num(total.anuncios),
    },
  };

  const titulos = new Map(METRICAS.map((c) => [c.clave, c.titulo]));
  for (const [clave, x] of Object.entries(metricas(M))) {
    cols[clave] = {
      clave, titulo: titulos.get(clave) ?? clave, tipo: "num",
      orden: (f) => (x.hay && !x.hay(f) ? x.sinDato ?? 0 : x.valor(f)),
      celda: (f) => mostrar(x, f),
      pie: mostrar(x, total),
    };
  }
  return cols;
}

type CambiosURL = Partial<Record<"nivel" | "campania" | "conjunto" | "anuncio" | "ver", string | null>>;

export default function Marketing() {
  const e = useEstado();
  const sync = useSync();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [rango, setRango] = useRangoURL("mes");
  const { desde, hasta } = rango;

  /* ---------- Dónde se está parado ---------- */

  /* Al volver de conectar Meta (?meta=…) se arranca en el Resumen, que es
     donde está esa tarjeta. Se decide una sola vez: la tarjeta limpia la URL
     al leer el aviso, y la vista no puede saltar por eso. */
  const [vistaInicial] = useState<Vista>(() => (params.get("meta") ? "resumen" : "campanias"));
  const nivelURL = params.get("nivel");
  const vista: Vista = esVista(nivelURL) ? nivelURL : vistaInicial;
  const nivel: Nivel | null = vista === "resumen" ? null : vista;
  const campaniaId = params.get("campania");
  const conjuntoId = params.get("conjunto");
  const anuncioId = params.get("anuncio");
  const verViejo = params.get("ver");

  const navegar = useCallback((cambios: CambiosURL) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    /* replace y no push, igual que el rango: bajar de nivel no es cambiar de
       pantalla, y Atrás tiene que sacar de Marketing, no deshacer clicks. */
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  /* Los links viejos (?ver=<campaña>) abrían el panel lateral de la campaña.
     Ahora eso es entrar a ella: sus conjuntos, filtrados. */
  useEffect(() => {
    if (verViejo) navegar({ ver: null, nivel: "conjuntos", campania: verViejo, conjunto: null, anuncio: null });
  }, [verViejo, navegar]);

  const anuncio = useMemo(
    () => (anuncioId ? e.ads.find((a) => a.id === anuncioId) : undefined),
    [e.ads, anuncioId],
  );

  /* Un link a un anuncio (?anuncio=, desde la ficha de un lead) abre su
     detalle parado en su conjunto, con la campaña y el conjunto filtrados,
     como si se hubiera llegado bajando. Una sola vez por anuncio: al tocarlo
     en la tabla, los filtros quedan como estaban. */
  const encuadrado = useRef<string | null>(null);
  useEffect(() => {
    if (!anuncioId) encuadrado.current = null;
  }, [anuncioId]);
  useEffect(() => {
    if (!anuncio || encuadrado.current === anuncio.id) return;
    encuadrado.current = anuncio.id;
    if (vista !== "anuncios" || campaniaId !== anuncio.campaignId || conjuntoId !== anuncio.adsetId) {
      navegar({ nivel: "anuncios", campania: anuncio.campaignId, conjunto: anuncio.adsetId });
    }
  }, [anuncio, vista, campaniaId, conjuntoId, navegar]);

  /* Un anuncio que no está en la sincronización: se avisa y se saca de la URL,
     en vez de dejar un detalle que no abre nunca. Recién cuando terminó de
     cargar la nube: antes, no encontrarlo no quiere decir nada. */
  useEffect(() => {
    if (!anuncioId || anuncio || sync.estado === "cargando") return;
    toast("Ese anuncio todavía no llegó de Meta. Va a aparecer después de la próxima sincronización.", "err");
    navegar({ anuncio: null });
  }, [anuncioId, anuncio, sync.estado, toast, navegar]);

  /* ---------- Filtros de cada tabla ---------- */

  /* Cada nivel con su búsqueda y su estado: buscar un anuncio no tiene por
     qué vaciar la tabla de campañas. */
  const [busca, setBusca] = useState<Record<Nivel, string>>({ campanias: "", conjuntos: "", anuncios: "" });
  const [fEstado, setFEstado] = useState<Record<Nivel, string>>({ campanias: "", conjuntos: "", anuncios: "" });
  const [todas, setTodas] = useState(false);

  const colsCampanias = useColumnas("marketing-campanias", CATALOGO.campanias, POR_DEFECTO.campanias);
  const colsConjuntos = useColumnas("marketing-conjuntos", CATALOGO.conjuntos, POR_DEFECTO.conjuntos);
  const colsAnuncios = useColumnas("marketing-anuncios", CATALOGO.anuncios, POR_DEFECTO.anuncios);
  const cols = nivel === "conjuntos" ? colsConjuntos : nivel === "anuncios" ? colsAnuncios : colsCampanias;

  const M = useCallback<FormatoPlata>((n, d = 0) => money(n, e.ajustes.monedaBase, d), [e.ajustes.monedaBase]);

  /* Que "Máximo" no arranque en enero cuando la sincronizacion empieza en
     septiembre. */
  const primerDia = useMemo(() => primerDiaConDatos(e), [e]);

  /* Los tres niveles se calculan siempre: las pestañas muestran cuántos hay en
     cada uno, y el filtro de arriba (campaña, conjunto) recorta a los de abajo. */
  const base = useMemo<Record<Nivel, FilaMeta[]>>(() => ({
    campanias: filasMeta(e, desde, hasta, NIVEL_META.campanias, { incluirSinActividad: todas }),
    conjuntos: filasMeta(e, desde, hasta, NIVEL_META.conjuntos, { campaignId: campaniaId, incluirSinActividad: todas }),
    anuncios: filasMeta(e, desde, hasta, NIVEL_META.anuncios, {
      campaignId: campaniaId, adsetId: conjuntoId, incluirSinActividad: todas,
    }),
  }), [e, desde, hasta, campaniaId, conjuntoId, todas]);

  const filtradas = useMemo<Record<Nivel, FilaMeta[]>>(() => {
    const filtrar = (n: Nivel) => {
      /* Sin tildes: "publico" tiene que encontrar "Público frío". */
      const q = sinTildes(busca[n].trim());
      return base[n].filter((f) =>
        (!fEstado[n] || f.entrega === fEstado[n]) &&
        (!q || sinTildes(f.nombre).includes(q) || (n === "campanias" && sinTildes(f.objetivo).includes(q))));
    };
    return { campanias: filtrar("campanias"), conjuntos: filtrar("conjuntos"), anuncios: filtrar("anuncios") };
  }, [base, busca, fEstado]);

  /* Los KPIs de arriba y el pie de la tabla dicen lo mismo: lo que se está
     mirando. Si filtrás una campaña, el costo por venta es el de esa campaña. */
  const filasVista = nivel ? filtradas[nivel] : base.campanias;
  const tot = useMemo(() => totalesMeta(filasVista), [filasVista]);

  /* Sólo los estados que aparecen, con cuántos hay de cada uno. El elegido
     queda aunque ya no haya ninguno: si no, el desplegable diría "Todos"
     mientras la tabla sigue filtrada. */
  const opcionesEstado = useMemo(() => {
    if (!nivel) return [];
    const cuenta = new Map<string, number>();
    for (const f of base[nivel]) cuenta.set(f.entrega, (cuenta.get(f.entrega) ?? 0) + 1);
    const elegido = fEstado[nivel];
    if (elegido && !cuenta.has(elegido)) cuenta.set(elegido, 0);
    return [...cuenta.entries()]
      .sort(([a], [b]) => posicionEstado(a) - posicionEstado(b))
      .map(([k, n]) => ({ valor: k, texto: `${estadoDe(k, nivel).texto} · ${num(n)}` }));
  }, [base, nivel, fEstado]);

  /* Cada columna del catálogo, definida una sola vez. La tabla recibe sólo las
     prendidas, en el orden en que quedaron.

     La campaña o el conjunto por los que se está filtrando ya están en la
     miga: repetirlos en cada fila es ruido. Esa columna se esconde mientras
     dure el filtro y vuelve sola al sacarlo. */
  const columnas = useMemo(() => {
    if (!nivel) return [];
    const def = definirColumnas(nivel, tot, filtradas[nivel].length, M);
    const repetida = (k: string) =>
      (k === "campania" && Boolean(campaniaId)) || (k === "conjunto" && nivel === "anuncios" && Boolean(conjuntoId));
    return cols.visibles.filter((k) => !repetida(k)).map((k) => def[k]).filter(Boolean);
  }, [nivel, tot, filtradas, M, cols.visibles, campaniaId, conjuntoId]);

  /* ---------- Resumen ---------- */

  /* Los leads del período, no los de siempre: el resto de la pantalla habla
     del rango elegido. */
  const porFuente = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of e.leads) {
      const d = diaDeNegocio(l.creadoEn);
      if (!d || d < desde || d > hasta) continue;
      const f = l.fuente || "Sin fuente";
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([etiqueta, valor], i) => ({ etiqueta, valor, color: COLORES[i % COLORES.length] }));
  }, [e.leads, desde, hasta]);
  const leadsDelRango = porFuente.reduce((s, x) => s + x.valor, 0);

  const cplPorCampania = useMemo(
    () => base.campanias.filter((c) => c.leads > 0)
      .sort((a, b) => b.inversion - a.inversion)
      .slice(0, 12),
    [base.campanias],
  );

  /* ---------- Acciones ---------- */

  function abrir(f: FilaMeta) {
    if (f.nivel === "campania") navegar({ nivel: "conjuntos", campania: f.id, conjunto: null, anuncio: null });
    else if (f.nivel === "conjunto") navegar({ nivel: "anuncios", campania: f.campaignId, conjunto: f.id, anuncio: null });
    else {
      encuadrado.current = f.id;
      navegar({ anuncio: f.id });
    }
  }

  const campaniaFiltro = campaniaId ? e.campaigns.find((c) => c.id === campaniaId) : undefined;
  const conjuntoFiltro = conjuntoId ? e.adsets.find((s) => s.id === conjuntoId) : undefined;
  const conMigaCampania = (nivel === "conjuntos" || nivel === "anuncios") && Boolean(campaniaId);
  const conMigaConjunto = nivel === "anuncios" && Boolean(conjuntoId);

  /* La fila que se pinta: la campaña o el conjunto por los que se está
     filtrando abajo, o el anuncio abierto. */
  const activa = nivel === "campanias" ? campaniaId : nivel === "conjuntos" ? conjuntoId : anuncioId;

  function vacio(n: Nivel) {
    const p = PALABRAS[n];
    if (e.campaigns.length === 0) {
      return (
        <Empty
          icono={<Megaphone size={22} />}
          titulo="Todavía no trajiste nada de Meta"
          texto="Conectá Meta y apretá «Traer anuncios y días» en el Resumen."
          accion={<Button variante="secondary" onClick={() => navegar({ nivel: "resumen", anuncio: null })}>Ir al Resumen</Button>}
        />
      );
    }
    if (busca[n].trim() || fEstado[n]) {
      return (
        <Empty
          icono={<SearchX size={22} />}
          titulo={`${p.fem ? "Ninguna" : "Ningún"} ${p.uno} coincide`}
          texto="Probá con otro nombre, o sacá el filtro de estado."
          accion={
            <Button variante="secondary" onClick={() => { setBusca({ ...busca, [n]: "" }); setFEstado({ ...fEstado, [n]: "" }); }}>
              Limpiar filtros
            </Button>
          }
        />
      );
    }
    const ambito = n === "anuncios" && conjuntoId ? "Este conjunto" : n !== "campanias" && campaniaId ? "Esta campaña" : null;
    if (todas) {
      return (
        <Empty
          icono={<Megaphone size={22} />}
          titulo={`No hay ${p.varios} para mostrar`}
          texto={ambito ? `${ambito} no tiene ${p.varios} en la sincronización de Meta.` : `Meta todavía no mandó ${p.varios}.`}
        />
      );
    }
    return (
      <Empty
        icono={<Megaphone size={22} />}
        titulo={ambito ? `${ambito} no tuvo actividad en este período` : `${p.fem ? "Ninguna" : "Ningún"} ${p.uno} tuvo actividad en este período`}
        texto="Sin gasto y sin personas que hayan entrado. Probá con otro rango de fechas, o mostrá también lo que no tuvo actividad."
        accion={<Button variante="secondary" onClick={() => setTodas(true)}>Incluir sin actividad</Button>}
      />
    );
  }

  const direccionRoas = tot.roas >= 3 ? "up" : "accent";

  return (
    <div className="stack-5">
      <PageHead
        titulo="Marketing"
        sub="Lo que invertís y qué te devuelve: por campaña, por conjunto y por anuncio."
        acciones={
          <DateRangePicker
            value={rango} minDate={primerDia} onApply={setRango}
            footerNota="Días calendario · zona horaria de Argentina"
          />
        }
      />

      <div className="grid-stats">
        <StatCard
          hero etiqueta={`Inversión · ${rangoSub(rango)}`} valor={M(tot.inversion)}
          contexto={`en ${cuantos(filasVista.length, nivel ?? "campanias")}`}
        />
        <StatCard
          etiqueta="Costo por lead" valor={tot.leads > 0 ? M(tot.cpl, 2) : "—"}
          contexto={`${num(tot.leads)} según Meta · ${num(tot.personas)} ${tot.personas === 1 ? "persona" : "personas"} en la base`}
          ayuda="Inversión dividida por los leads que contó Meta. Al lado, las personas que entraron por esos anuncios y tenemos cargadas."
        />
        <StatCard
          etiqueta="Costo por venta" valor={tot.ventas > 0 ? M(tot.costoPorVenta) : "—"}
          contexto={`${num(tot.ventas)} ${tot.ventas === 1 ? "venta" : "ventas"} de esas personas`}
          ayuda="Inversión dividida por las ventas de las personas que entraron por estos anuncios en el período, sin importar cuándo compraron."
        />
        <StatCard
          etiqueta="ROAS" valor={tot.roas > 0 ? `${num(tot.roas, 2)}x` : "—"}
          delta={tot.roas >= 3 ? "Sano" : tot.roas > 0 ? "Justo" : undefined}
          direccion={direccionRoas}
          contexto={tot.cobrado > 0 ? `${M(tot.cobrado)} cobrados` : tot.ventas > 0 ? "nada cobrado todavía" : "cobrado sobre inversión"}
          ayuda="Lo cobrado de esas ventas sobre la inversión. Sobre lo cobrado, no sobre lo facturado."
        />
      </div>

      <Tabs
        valor={vista}
        onChange={(v) => navegar({ nivel: v, anuncio: null })}
        opciones={[
          { valor: "campanias", texto: `Campañas · ${num(filtradas.campanias.length)}` },
          { valor: "conjuntos", texto: `Conjuntos · ${num(filtradas.conjuntos.length)}` },
          { valor: "anuncios", texto: `Anuncios · ${num(filtradas.anuncios.length)}` },
          { valor: "resumen", texto: "Resumen" },
        ]}
      />

      {nivel && (
        <div className="stack-3">
          <div className="mk-barra">
            {(conMigaCampania || conMigaConjunto) && (
              <nav className="mk-migas" aria-label="Filtros de la tabla">
                {conMigaCampania && (
                  <Miga
                    tipo="Campaña" nombre={campaniaFiltro?.nombre ?? "Campaña sin sincronizar"}
                    onQuitar={() => navegar({ campania: null, conjunto: null })}
                  />
                )}
                {conMigaCampania && conMigaConjunto && <ChevronRight size={14} className="mk-migas__sep" aria-hidden />}
                {conMigaConjunto && (
                  <Miga
                    tipo="Conjunto" nombre={conjuntoFiltro?.nombre ?? "Conjunto sin sincronizar"}
                    onQuitar={() => navegar({ conjunto: null })}
                  />
                )}
              </nav>
            )}

            <div className="toolbar" style={{ marginBottom: 0 }}>
              <Input
                icono={<Search size={16} />} value={busca[nivel]}
                onChange={(ev) => setBusca({ ...busca, [nivel]: ev.target.value })}
                placeholder={PALABRAS[nivel].buscar} aria-label={PALABRAS[nivel].buscar}
              />
              <div style={{ width: 210 }}>
                <Select
                  value={fEstado[nivel]} onChange={(ev) => setFEstado({ ...fEstado, [nivel]: ev.target.value })}
                  placeholder="Todos los estados" opciones={opcionesEstado} aria-label="Filtrar por estado"
                />
              </div>
              <Chip activo={todas} onClick={() => setTodas((v) => !v)}>Incluir sin actividad</Chip>
              <span className="spacer" />
              <ConfigColumnas
                todas={CATALOGO[nivel]} visibles={cols.visibles}
                alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar}
              />
            </div>
          </div>

          <DataTable
            key={nivel}
            filas={filtradas[nivel]} columnas={columnas} alto={600} mostrarMas={50}
            ordenInicial={{ clave: "inversion", desc: true }}
            onFila={abrir}
            filaActiva={(f) => f.id === activa}
            etiquetaFila={(f) => (nivel === "campanias"
              ? `Ver los conjuntos de ${f.nombre}`
              : nivel === "conjuntos" ? `Ver los anuncios de ${f.nombre}` : `Ver el detalle de ${f.nombre}`)}
            vacio={vacio(nivel)}
          />
        </div>
      )}

      {vista === "resumen" && (
        <div className="stack-4">
          <ConectarMeta rango={rango} />

          <div className="grid-2">
            <Card>
              <CardHead titulo="De dónde vienen tus leads" sub={`Todas las fuentes, no sólo las pagas · ${rangoSub(rango)}.`} />
              <Donut datos={porFuente} formato={num} total={num(leadsDelRango)} totalEtiqueta="leads" />
            </Card>
            <Card>
              <CardHead titulo="Costo por lead por campaña" sub={`${capital(rangoSub(rango))}. Más bajo es mejor.`} />
              {cplPorCampania.length === 0
                ? <p className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>Ninguna campaña trajo leads en este período.</p>
                : <BarChart
                    datos={cplPorCampania.map((c) => ({ etiqueta: truncar(c.nombre, 12), valor: c.cpl, completo: c.nombre }))}
                    formato={(n) => M(n, 0)} alto={200} color="var(--accent)"
                  />}
            </Card>
          </div>
        </div>
      )}

      {anuncio && (
        <DetalleAnuncio
          ad={anuncio} rango={rango} M={M}
          onCerrar={() => navegar({ anuncio: null })}
          onIr={(c) => navegar({ ...c, anuncio: null })}
        />
      )}
    </div>
  );
}

/* ---------- La miga de un filtro ---------- */

function Miga({ tipo, nombre, onQuitar }: { tipo: string; nombre: string; onQuitar: () => void }) {
  return (
    <span className="mk-miga">
      <span className="mk-miga__tipo">{tipo}:</span>
      <span className="mk-miga__nombre" title={nombre}>{nombre}</span>
      <button
        type="button" className="mk-miga__quitar" onClick={onQuitar}
        aria-label={`Sacar el filtro de ${tipo.toLowerCase()}`} title="Sacar el filtro"
      >
        <X size={14} />
      </button>
    </span>
  );
}

/* ---------- Detalle de un anuncio ---------- */

function DetalleAnuncio({ ad, rango, M, onCerrar, onIr }: {
  ad: Ad;
  rango: RangoFechas;
  M: FormatoPlata;
  onCerrar: () => void;
  onIr: (c: { nivel: Nivel; campania: string | null; conjunto: string | null }) => void;
}) {
  const e = useEstado();
  const { desde, hasta } = rango;
  const [otras, setOtras] = useState(false);

  /* La misma fila que muestra la tabla, aunque el anuncio no haya tenido
     actividad en el rango: desde la ficha de un lead se llega por link, y el
     rango elegido acá no puede hacer que el link no abra nada. */
  const f = useMemo(
    () => filasMeta(e, desde, hasta, "anuncio", { adId: ad.id, incluirSinActividad: true })[0],
    [e, desde, hasta, ad.id],
  );
  const personas = useMemo(() => personasDelAnuncio(e, ad.id, desde, hasta), [e, ad.id, desde, hasta]);
  const serie = useMemo(() => gastoDiario(e, ad.id, desde, hasta), [e, ad.id, desde, hasta]);

  const campania = e.campaigns.find((c) => c.id === ad.campaignId);
  const conjunto = e.adsets.find((s) => s.id === ad.adsetId);
  const estado = estadoDe(f?.entrega ?? (claveEstado(ad.estado) || "sin-estado"), "anuncios");
  const enRango = personas.filter((p) => p.enRango);
  const deOtros = personas.filter((p) => !p.enRango);

  return (
    <Drawer
      abierto onCerrar={onCerrar} titulo={ad.nombre}
      cabecera={
        <div className="stack-2">
          <h2 className="t-h2" style={{ overflowWrap: "anywhere" }}>{ad.nombre || "Anuncio sin nombre"}</h2>
          <div className="mk-ruta">
            <button
              type="button" className="link" title={campania?.nombre}
              onClick={() => onIr({ nivel: "conjuntos", campania: ad.campaignId, conjunto: null })}
            >
              {campania?.nombre ?? "Campaña"}
            </button>
            <ChevronRight size={14} className="t-subtle" aria-hidden style={{ flexShrink: 0 }} />
            <button
              type="button" className="link" title={conjunto?.nombre}
              onClick={() => onIr({ nivel: "anuncios", campania: ad.campaignId, conjunto: ad.adsetId })}
            >
              {conjunto?.nombre ?? "Conjunto"}
            </button>
          </div>
          <div className="row-wrap">
            <Badge variante={estado.variante}>{estado.texto}</Badge>
            <Tag>{capital(rangoSub(rango))}</Tag>
          </div>
        </div>
      }
    >
      {f && (
        <div className="stack-5">
          <div className="grid-2" style={{ gap: 12 }}>
            <Mini etiqueta="Inversión" valor={M(f.inversion)} />
            <Mini etiqueta="Personas" valor={num(f.personas)} />
            <Mini etiqueta="Costo por persona" valor={f.personas > 0 ? M(f.costoPorPersona, 2) : "—"} />
            <Mini etiqueta="Costo por lead" valor={f.leads > 0 ? M(f.cpl, 2) : "—"} />
          </div>

          {serie.length > 1 && (
            <div>
              <div className="t-label" style={{ marginBottom: 8 }}>Gasto por día</div>
              <AreaChart
                datos={serie.map((d) => ({ etiqueta: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`, valor: d.inversion }))}
                formato={(n) => M(n)} alto={160} serie="Inversión"
              />
            </div>
          )}

          <div>
            <div className="t-label" style={{ marginBottom: 12 }}>Según Meta</div>
            <dl className="dl">
              <Dato label="Impresiones">{num(f.impresiones)}</Dato>
              <Dato label="Alcance">{f.alcance === null ? "—" : `${num(f.alcance)} (suma diaria)`}</Dato>
              <Dato label="Frecuencia">{f.frecuencia === null ? "—" : `${num(f.frecuencia, 2)} por día`}</Dato>
              <Dato label="Clicks">{num(f.clicks)}{f.impresiones > 0 ? ` · CTR ${pct(f.ctr, 2)}` : ""}</Dato>
              <Dato label="En el enlace">{num(f.clicksEnlace)}{f.impresiones > 0 ? ` · CTR ${pct(f.ctrEnlace, 2)}` : ""}</Dato>
              <Dato label="CPC">{f.clicks > 0 ? M(f.cpc, 2) : "—"}</Dato>
              <Dato label="CPM">{f.impresiones > 0 ? M(f.cpm, 2) : "—"}</Dato>
              <Dato label="Leads">{num(f.leads)}</Dato>
              <Dato label="Días con datos">{num(f.dias)}</Dato>
            </dl>
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 12 }}>Lo que devolvió</div>
            <dl className="dl">
              <Dato label="Ventas">{num(f.ventas)}</Dato>
              <Dato label="Costo por venta">{f.ventas > 0 ? M(f.costoPorVenta) : "—"}</Dato>
              <Dato label="Facturado">{M(f.facturado)}</Dato>
              <Dato label="Cobrado">{M(f.cobrado)}</Dato>
              <Dato label="ROAS">{f.inversion > 0 ? `${num(f.roas, 2)}x` : "—"}</Dato>
            </dl>
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 12 }}>
              Personas que entraron por este anuncio{personas.length > 0 ? ` · ${num(personas.length)}` : ""}
            </div>
            {personas.length === 0 ? (
              <p className="t-sm t-subtle">
                Todavía no hay nadie que sepamos que entró por acá. Una persona queda atada a su anuncio cuando se registra desde la landing.
              </p>
            ) : (
              <div className="stack-2">
                {enRango.length === 0 && (
                  <p className="t-sm t-subtle">Nadie en {rangoSub(rango)}.</p>
                )}
                {enRango.map((p) => <FilaPersona key={p.contacto.id} p={p} M={M} />)}

                {deOtros.length > 0 && !otras && (
                  <div>
                    <button type="button" className="link t-sm" onClick={() => setOtras(true)}>
                      Ver {deOtros.length === 1 ? "la persona de otro período" : `las ${num(deOtros.length)} personas de otros períodos`}
                    </button>
                  </div>
                )}
                {otras && deOtros.length > 0 && (
                  <>
                    <div className="t-sm t-subtle" style={{ marginTop: 8 }}>De otros períodos</div>
                    {deOtros.map((p) => <FilaPersona key={p.contacto.id} p={p} M={M} />)}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* Una persona que entró por el anuncio. Abre su ficha en Leads; si todavía no
   tiene un lead abierto, no hay ficha que abrir y la fila no es link. */
function FilaPersona({ p, M }: { p: PersonaDelAnuncio; M: FormatoPlata }) {
  const c = p.contacto;
  const abrirFicha = useAbrirFicha();
  const cuerpo = (
    <>
      <Avatar nombre={c.nombre || "?"} size={32} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="truncate" style={{ display: "block", fontWeight: 600, color: "var(--ink)" }}>
          {c.nombre || "Sin nombre"}
        </span>
        <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
          Entró {relativo(c.creadoEn)}{c.email ? ` · ${c.email}` : ""}
        </span>
      </span>
      {p.ventas > 0 && <Badge variante="success">Compró · {M(p.facturado)}</Badge>}
    </>
  );

  /* La ficha se abre encima de Marketing: al cerrarla, la tabla sigue
     filtrada donde estaba. */
  return (
    <button
      type="button" className="agenda-item" onClick={() => abrirFicha(c.id)}
      style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit" }}
      aria-label={`Abrir la ficha de ${c.nombre || "esta persona"}`}
    >
      {cuerpo}
      <ChevronRight size={16} className="t-subtle" style={{ flexShrink: 0 }} aria-hidden />
    </button>
  );
}

function Mini({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>{etiqueta}</div>
      <div className="t-num" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{valor}</div>
    </div>
  );
}
