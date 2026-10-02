"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, ImageOff } from "lucide-react";
import { formaDe, type CreativoVisto, type MedioAnuncio } from "@/lib/meta-creativo";
import { Avatar, Badge, Tag } from "@/components/ui/ui";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { AreaChart } from "@/components/charts/charts";
import { rangoSub, type RangoFechas } from "@/components/ui/DateRangePicker";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { cabeceras } from "@/components/webinars/useYoutube";
import { hayNube, useEstado } from "@/lib/store";
import { num, pct, relativo } from "@/lib/format";
import { claveEstado, filasMeta, gastoDiario, personasDelAnuncio, type PersonaDelAnuncio } from "@/lib/metricas";
import type { Ad } from "@/lib/types";
import { estadoDeAnuncio } from "./estados";

/* ==================================================================
   El detalle de un anuncio: arriba el anuncio mismo (su video o su
   imagen, con su forma), y abajo sus números del período y las personas
   que entraron por él. Lo abren Marketing (la tabla de anuncios) y el
   Dashboard (el gasto en Meta, anuncio por anuncio).
   ================================================================== */

export type FormatoPlata = (n: number, decimales?: number) => string;
/* A dónde lleva la campaña o el conjunto del anuncio, en Marketing. */
export interface DestinoMarketing { nivel: "conjuntos" | "anuncios"; campania: string | null; conjunto: string | null }
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DetalleAnuncio({ ad, rango, M, onCerrar, onIr }: {
  ad: Ad;
  rango: RangoFechas;
  M: FormatoPlata;
  onCerrar: () => void;
  onIr: (c: DestinoMarketing) => void;
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
  const estado = estadoDeAnuncio(f?.entrega ?? (claveEstado(ad.estado) || "sin-estado"));
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
      <div className="stack-5">
        <VistaPreviaAnuncio ad={ad} />
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
              /* Un anuncio que anda trae cientos: la lista scrollea adentro. */
              <div className="stack-2 lista-scroll">
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
      </div>
    </Drawer>
  );
}

/* ---------- El anuncio mismo ----------
   Se le pide al servidor cada vez que se abre el detalle (api/meta/preview),
   porque los links que da Meta vencen. Llega el material del anuncio (el
   video o la imagen, las tarjetas de un carrusel, o uno por lugar si tiene
   distinto material para el Feed y para Historias y Reels) y se muestra
   directo, cada uno con su forma. Si del creativo no sale ningún archivo,
   queda la vista previa que arma Meta, en su marco. Sin conexión con Meta,
   o si el anuncio ya no existe, se dice y el resto del detalle sigue. */

type Marco = { src: string; alto: number; aviso?: string };
type Vista =
  | { estado: "cargando" }
  | { estado: "material"; material: CreativoVisto }
  | { estado: "marco"; marco: Marco }
  | { estado: "sin"; motivo: string };

/* Para probar la pantalla sin Meta (la app sin nube): lo que contestaría
   el servidor, guardado a mano en este navegador. */
const CLAVE_DE_PRUEBA = "apicanta.previa-de-prueba";
function materialDePrueba(): CreativoVisto | null {
  try {
    const j = JSON.parse(window.localStorage.getItem(CLAVE_DE_PRUEBA) ?? "null") as CreativoVisto | null;
    return j && Array.isArray(j.medios) && j.medios.length > 0 ? j : null;
  } catch { return null; }
}

function VistaPreviaAnuncio({ ad }: { ad: Ad }) {
  const [vista, setVista] = useState<Vista>({ estado: "cargando" });
  /* «Ver como lo muestra Meta»: el marco, a pedido, debajo del material. */
  const [marco, setMarco] = useState<Marco | "cargando" | "no" | null>(null);
  const metaId = ad.metaId ?? "";

  useEffect(() => {
    setMarco(null);
    if (!hayNube) {
      const prueba = materialDePrueba();
      setVista(prueba ? { estado: "material", material: prueba } : { estado: "sin", motivo: "El anuncio se ve en la app publicada: acá no hay conexión con Meta." });
      return;
    }
    if (!metaId) { setVista({ estado: "sin", motivo: "Este anuncio no vino de Meta: no tiene vista previa." }); return; }
    let vivo = true;
    setVista({ estado: "cargando" });
    (async () => {
      try {
        const r = await fetch(`/api/meta/preview?ad=${encodeURIComponent(metaId)}`, { cache: "no-store", headers: await cabeceras() });
        const j = (await r.json().catch(() => ({}))) as Partial<CreativoVisto> & { src?: string; alto?: number; aviso?: string; error?: string };
        if (!vivo) return;
        if (r.ok && j.medios?.length) setVista({ estado: "material", material: { ...j, medios: j.medios } });
        else if (r.ok && j.src) setVista({ estado: "marco", marco: { src: j.src, alto: j.alto ?? 620, aviso: j.aviso } });
        else setVista({ estado: "sin", motivo: j.error ?? "Meta no devolvió este anuncio." });
      } catch {
        if (vivo) setVista({ estado: "sin", motivo: "No se pudo pedir el anuncio a Meta." });
      }
    })();
    return () => { vivo = false; };
  }, [metaId]);

  async function verElMarco() {
    setMarco("cargando");
    try {
      const r = await fetch(`/api/meta/preview?ad=${encodeURIComponent(metaId)}&marco=1`, { cache: "no-store", headers: await cabeceras() });
      const j = (await r.json().catch(() => ({}))) as { src?: string; alto?: number };
      setMarco(r.ok && j.src ? { src: j.src, alto: j.alto ?? 620 } : "no");
    } catch {
      setMarco("no");
    }
  }

  if (vista.estado === "sin") {
    return <p className="mk-previa mk-previa--sin t-sm t-subtle"><ImageOff size={15} aria-hidden /> {vista.motivo}</p>;
  }
  if (vista.estado === "cargando") {
    return <div className="mk-previa" style={{ height: 420 }}><div className="skeleton" style={{ width: "100%", height: "100%" }} aria-label="Cargando el anuncio" /></div>;
  }
  if (vista.estado === "marco") return <MarcoDeMeta marco={vista.marco} nombre={ad.nombre} />;

  return (
    <div className="stack-3">
      <MaterialDelAnuncio material={vista.material} nombre={ad.nombre} />
      {hayNube && metaId && (
        marco === null ? <div><button type="button" className="link t-sm" onClick={() => void verElMarco()}>Ver como lo muestra Meta</button></div>
          : marco === "cargando" ? <div className="mk-previa" style={{ height: 420 }}><div className="skeleton" style={{ width: "100%", height: "100%" }} aria-label="Cargando la vista de Meta" /></div>
            : marco === "no" ? <p className="t-sm t-subtle">Meta no devolvió su vista previa de este anuncio.</p>
              : <MarcoDeMeta marco={marco} nombre={ad.nombre} />
      )}
    </div>
  );
}

function MarcoDeMeta({ marco, nombre }: { marco: Marco; nombre: string }) {
  return (
    <div className="stack-2">
      <div className="mk-previa" style={{ height: marco.alto }}>
        <iframe src={marco.src} title={`El anuncio ${nombre}, como lo muestra Meta`} loading="lazy" scrolling="yes" referrerPolicy="no-referrer" />
      </div>
      {/* Por qué no se ve el video o la imagen directo. */}
      {marco.aviso && <p className="t-sm t-subtle" style={{ margin: 0 }}>{marco.aviso}</p>}
    </div>
  );
}

/* El video o la imagen, sin nada alrededor. Uno solo va centrado; varios
   (un carrusel, o uno por lugar), en fila para pasar de costado. */
function MaterialDelAnuncio({ material, nombre }: { material: CreativoVisto; nombre: string }) {
  const { medios, texto, titulo, boton } = material;
  const [todo, setTodo] = useState(false);
  const largo = (texto?.length ?? 0) > 180 || (texto?.split("\n").length ?? 0) > 3;
  return (
    <div className="stack-3">
      {medios.length === 1
        ? <Medio m={medios[0]} nombre={nombre} />
        : (
          <div className="mk-medios" role="list" aria-label="El material del anuncio">
            {medios.map((m, i) => <Medio key={`${m.src}-${i}`} m={m} nombre={nombre} chip={m.etiqueta ?? `${i + 1} de ${medios.length}`} enFila />)}
          </div>
        )}
      {(titulo || texto || boton) && (
        <div className="mk-copy">
          {titulo && <div className="mk-copy__titulo">{titulo}</div>}
          {texto && <p className={`mk-copy__texto${todo || !largo ? "" : " mk-copy__texto--corto"}`}>{texto}</p>}
          <div className="row-wrap">
            {largo && <button type="button" className="link t-sm" onClick={() => setTodo(!todo)}>{todo ? "Ver menos" : "Ver todo el texto"}</button>}
            {boton && <Tag>Botón: {boton}</Tag>}
          </div>
        </div>
      )}
    </div>
  );
}

function Medio({ m, nombre, chip, enFila }: { m: MedioAnuncio; nombre: string; chip?: string; enFila?: boolean }) {
  /* La forma sale del tamaño que mandó Meta; si no vino, del archivo al cargar. */
  const [tam, setTam] = useState(m.ancho && m.alto ? { w: m.ancho, h: m.alto } : null);
  const medir = (w: number, h: number) => { if (w > 0 && h > 0 && (!tam || tam.w !== w || tam.h !== h)) setTam({ w, h }); };
  const forma = formaDe(tam?.w, tam?.h);
  const dice = `${m.tipo === "video" ? "Video" : m.sinArchivo ? "Portada del video" : "Imagen"}${forma ? ` · ${forma.toLowerCase()}` : ""} del anuncio ${nombre}`;
  return (
    <figure
      className={`mk-medio${enFila ? " mk-medio--en-fila" : ""}`} role={enFila ? "listitem" : undefined}
      style={{ "--proporcion": String(tam ? tam.w / tam.h : 4 / 5) } as React.CSSProperties}
    >
      {m.tipo === "video" ? (
        <video
          controls playsInline preload="metadata" poster={m.poster} src={m.src} aria-label={dice}
          onLoadedMetadata={(ev) => medir(ev.currentTarget.videoWidth, ev.currentTarget.videoHeight)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.src} alt={dice} loading="lazy" onLoad={(ev) => medir(ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight)} />
      )}
      {(chip || m.sinArchivo) && (
        <figcaption className="mk-medio__chip">{[chip, m.sinArchivo ? "Portada del video" : ""].filter(Boolean).join(" · ")}</figcaption>
      )}
    </figure>
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
