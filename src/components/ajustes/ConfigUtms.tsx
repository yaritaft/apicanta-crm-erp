"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, IconButton, Input, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, num } from "@/lib/format";
import { proyectoDeWebinar, webinarDeProyecto } from "@/lib/angelo";
import {
  CAMPOS_UTM, estrategiaDeFunnel, normalizarUtm, origenDe, textoUtm, utmsDetectadas, ventasParaCompletar,
  type CampoUtm, type OrigenUtm, type Utm,
} from "@/lib/utms";
import {
  armarPaqueteWebinar, armarUtm, CASOS, diaUtm, EVENTOS, FUENTES, FUNNELS, linkConUtm, MEDIOS, MOMENTOS_EVENTO, problemasDeUtm, queryUtm, slugUtm,
  textoDelPaquete,
  type CasoUtm, type Funnel, type GrupoArmado, type IdCaso, type Utm as UtmCruda, type ValoresCaso,
} from "@/lib/utm-estandar";
import type { EstadoApp, ReglaUtm } from "@/lib/types";

/* ==================================================================
   Ajustes → UTMs: el creador de links y el estándar de UTMs de Yari.

   - El creador arma el link de cada vía de agenda como dice el estándar
     (lib/utm-estandar.ts): se elige el caso, se completa lo que cambia
     (la fecha, el setter, el video…) y sale el link listo para copiar,
     con cómo lo va a leer la app.
   - El estándar: qué estrategia de la planilla es cada funnel. Sale solo
     (la clase cero y el Q&A van con el webinar, del que son parte), y se
     puede cambiar acá.
   - Las reglas propias, para los links que no siguen el estándar (los
     viejos, o una campaña especial).
   - Las UTMs que llegaron, con de qué quedó cada una y si siguen el
     estándar, y las ventas a las que les falta el origen.
   ================================================================== */

const ETIQUETA: Record<CampoUtm, string> = { source: "utm_source", medium: "utm_medium", campaign: "utm_campaign", content: "utm_content" };

/* Cómo se ve el origen que la app le da a una UTM: "Webinar · WEB-24/09/26". */
function textoOrigen(e: EstadoApp, o: OrigenUtm | null): string {
  if (!o) return "Sin asignar";
  const partes = [
    e.embudos.find((x) => x.id === o.embudoId)?.nombre,
    o.proyecto,
    o.webinarId && !o.proyecto ? e.webinars.find((x) => x.id === o.webinarId)?.titulo : undefined,
    o.setterId ? `con ${e.equipo.find((x) => x.id === o.setterId)?.nombre ?? "su setter"}` : undefined,
    o.referidorNombre ? `referido por ${o.referidorNombre}` : undefined,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Sin estrategia";
}

export function ConfigUtms() {
  return (
    <div className="stack-4">
      <CreadorUtm />
      <EstandarUtm />
      <ReglasPropias />
      <UtmsQueLlegaron />
    </div>
  );
}

/* ---------- El creador ---------- */

const CLAVE_DESTINO = "apicanta:utm:destino";

/* El primer «caso» del selector no es del estándar: arma de una vez todos los
   links de un webinar, que es lo que se pide al prepararlo. */
const PAQUETE = "paquete-webinar";
type Modo = IdCaso | typeof PAQUETE;
const OTRA_FECHA = "__otra";
const PIDE_PAQUETE: CasoUtm["pide"] = ["fecha", "fuenteEvento"];

function CreadorUtm() {
  const e = useEstado();
  const toast = useToast();
  const [caso, setCaso] = useState<Modo>(PAQUETE);
  const [v, setV] = useState<ValoresCaso>({ fuenteEvento: "email" });
  const [destino, setDestino] = useState("");
  const [otraFecha, setOtraFecha] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const paquete = caso === PAQUETE;
  const c = paquete ? undefined : CASOS.find((x) => x.id === caso)!;
  const pide = c ? c.pide : PIDE_PAQUETE;

  /* Se llega con el webinar ya elegido desde su ficha: /ajustes?seccion=utms&webinar=<id>.
     Se aplica una sola vez, cuando el webinar está cargado, y después manda lo que se elija acá. */
  const webinarPedido = useSearchParams().get("webinar");
  const pedidoAplicado = useRef(false);
  useEffect(() => {
    if (!webinarPedido || pedidoAplicado.current) return;
    const w = e.webinars.find((x) => x.id === webinarPedido);
    if (!w) return;
    pedidoAplicado.current = true;
    setCaso(PAQUETE);
    setV((x) => ({ ...x, fecha: w.fecha }));
  }, [webinarPedido, e.webinars]);

  /* El link de destino (la landing o el Calendly) queda recordado en este navegador. */
  useEffect(() => {
    try { setDestino(localStorage.getItem(CLAVE_DESTINO) ?? ""); } catch { /* sin almacenamiento */ }
  }, []);
  function cambiarDestino(x: string) {
    setDestino(x);
    try { localStorage.setItem(CLAVE_DESTINO, x); } catch { /* sin almacenamiento */ }
  }

  const webinars = useMemo(() => [...e.webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)).slice(0, 12), [e.webinars]);
  const setters = e.equipo.filter((x) => x.rol === "setter" && x.activo);
  /* Un webinar que todavía no se cargó en la app también tiene links: se escribe su fecha. */
  const fechaPropia = otraFecha || Boolean(v.fecha && !webinars.some((w) => w.fecha === v.fecha));

  /* Los links de todo el webinar, juntos. */
  const armado: GrupoArmado[] = useMemo(() => (paquete ? armarPaqueteWebinar(destino, v) : []), [paquete, destino, v]);

  /* Las variantes que salen juntas: en un evento, vivo, replay y
     seguimiento; en la VSL orgánica, bio, historias y post; un setter, por
     DM y por comentario. */
  const variantes: { nombre: string; utm: UtmCruda }[] = useMemo(() => {
    if (!c) return [];
    if (EVENTOS.includes(c.funnel) && c.id !== "meta-vsl") {
      return MOMENTOS_EVENTO.map((m) => ({ nombre: m, utm: armarUtm(c.id, { ...v, momento: m }) }));
    }
    if (c.id === "vsl-organica") return (["bio", "historia", "post"] as const).map((l) => ({ nombre: l, utm: armarUtm(c.id, { ...v, lugarVsl: l }) }));
    if (c.id === "setter") return (["dm", "comentario"] as const).map((k) => ({ nombre: k, utm: armarUtm(c.id, { ...v, canalSetter: k }) }));
    return [{ nombre: "", utm: armarUtm(c.id, v) }];
  }, [c, v]);

  const falta = pide.includes("fecha") && !v.fecha ? (caso === "webinar" || paquete ? "Elegí la fecha del webinar" : "Elegí de qué webinar es")
    : pide.includes("setter") && !v.setter ? "Elegí el setter"
      : pide.includes("referidor") && !v.referidor?.trim() ? "Escribí quién refirió"
        : null;

  /* Cómo va a leer la app el link: con el primero alcanza (los de un webinar quedan todos en el mismo). */
  const lectura = useMemo(() => {
    const utm = paquete ? armado[0]?.links[0]?.utm : variantes[0]?.utm;
    if (!utm || caso === "meta-vsl") return null;
    return origenDe(e, normalizarUtm(utm as Record<string, string>), v.fecha ?? new Date().toISOString());
  }, [e, armado, variantes, caso, paquete, v.fecha]);

  async function copiar(texto: string, clave: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(clave);
      window.setTimeout(() => setCopiado((x) => (x === clave ? null : x)), 1600);
    } catch {
      toast("No se pudo copiar: seleccioná el link y copialo a mano.", "err");
    }
  }

  const etiquetaFecha = paquete || caso === "webinar" ? "Fecha del webinar" : "De qué webinar es";

  return (
    <Card>
      <CardHead
        titulo="Creador de UTMs"
        sub="Cada vía de agenda tiene un solo link, armado con el estándar de UTMs: minúsculas, sin tildes ni espacios, _ entre campos y - entre palabras, fechas aaaammdd. Para un webinar, elegí «Todos los links del webinar»: pegás el Calendly una vez y salen todos juntos."
      />
      <div className="stack-3">
        <div className="form-grid">
          <div className="hk-field">
            <label className="hk-label">Caso</label>
            <Select value={caso} aria-label="Caso" onChange={(ev) => { setCaso(ev.target.value as Modo); setCopiado(null); }}
              opciones={[{ valor: PAQUETE, texto: "Todos los links del webinar" }, ...CASOS.map((x) => ({ valor: x.id, texto: x.nombre }))]} />
          </div>
          {caso !== "meta-vsl" && (
            <div className="hk-field">
              <label className="hk-label">Link de destino</label>
              <Input value={destino} onChange={(ev) => cambiarDestino(ev.target.value)} placeholder="https://… (la landing o el Calendly)" aria-label="Link de destino" />
            </div>
          )}
        </div>

        {pide.length > 0 && (
          <div className="form-grid">
            {pide.includes("fecha") && (
              /* En la clase cero y el Q&A, la fecha es la del webinar del que
                 son parte: el link dice de qué webinar son. */
              <div className="hk-field">
                <label className="hk-label">{etiquetaFecha}</label>
                {webinars.length > 0 ? (
                  <div className="stack-2">
                    <Select value={fechaPropia ? OTRA_FECHA : (v.fecha ?? "")} placeholder="Elegí el webinar" aria-label="Webinar"
                      onChange={(ev) => {
                        if (ev.target.value === OTRA_FECHA) { setOtraFecha(true); setV({ ...v, fecha: undefined }); }
                        else { setOtraFecha(false); setV({ ...v, fecha: ev.target.value }); }
                      }}
                      opciones={[
                        ...webinars.map((w) => ({ valor: w.fecha, texto: `${fechaLarga(w.fecha)} — ${w.titulo}` })),
                        { valor: OTRA_FECHA, texto: "Otra fecha (todavía no está en la app)" },
                      ]} />
                    {fechaPropia && (
                      <Input type="date" value={v.fecha ? diaUtm(v.fecha) : ""} aria-label="Fecha del webinar"
                        onChange={(ev) => setV({ ...v, fecha: ev.target.value || undefined })} />
                    )}
                  </div>
                ) : (
                  <Input type="date" value={v.fecha ? diaUtm(v.fecha) : ""} aria-label={etiquetaFecha}
                    onChange={(ev) => setV({ ...v, fecha: ev.target.value || undefined })} />
                )}
              </div>
            )}
            {pide.includes("fuenteEvento") && (
              <div className="hk-field">
                <label className="hk-label">Por dónde se manda</label>
                <Select value={v.fuenteEvento ?? "email"} aria-label="Por dónde se manda"
                  onChange={(ev) => setV({ ...v, fuenteEvento: ev.target.value as "email" | "whatsapp" })}
                  opciones={[{ valor: "email", texto: "Email" }, { valor: "whatsapp", texto: "WhatsApp" }]} />
              </div>
            )}
            {pide.includes("video") && (
              <div className="hk-field">
                <label className="hk-label">Video de YouTube</label>
                <Input value={v.video ?? ""} onChange={(ev) => setV({ ...v, video: ev.target.value })} placeholder="como-conseguir-trabajo-remoto (vacío: desconocido)" aria-label="Video de YouTube" />
              </div>
            )}
            {pide.includes("setter") && (
              <div className="hk-field">
                <label className="hk-label">Setter</label>
                <Select value={v.setter ?? ""} placeholder={setters.length ? "Elegí el setter" : "No hay setters en Ajustes → Equipo"} aria-label="Setter"
                  onChange={(ev) => setV({ ...v, setter: ev.target.value })}
                  opciones={setters.map((x) => ({ valor: x.nombre.split(" ")[0], texto: x.nombre }))} />
              </div>
            )}
            {pide.includes("referidor") && (
              <div className="hk-field">
                <label className="hk-label">Quién refirió</label>
                <Input value={v.referidor ?? ""} onChange={(ev) => setV({ ...v, referidor: ev.target.value })} placeholder="Nombre o código" aria-label="Quién refirió" />
              </div>
            )}
          </div>
        )}

        <p className="t-sm t-subtle">
          {c ? c.nota : "Salen del mismo Calendly y de la misma fecha: cambia la campaña (webinar, charla de Nahuel y Q&A, clase cero) y el momento (en vivo, grabación, seguimiento). Todos quedan del mismo webinar."}
        </p>

        {falta ? (
          <p className="t-sm" style={{ color: "var(--warning)" }}>{falta}</p>
        ) : paquete ? (
          <div className="stack-3">
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <span className="t-sm t-subtle">{armado.length} lugares donde se agenda, {armado.reduce((n, g) => n + g.links.length, 0)} links: el de después del webinar lleva dos, uno para la grabación y otro para los mails y mensajes.</span>
              <Button variante="primary" icono={copiado === "paquete" ? <Check size={16} /> : <Copy size={16} />}
                onClick={() => copiar(textoDelPaquete(armado), "paquete")}>{copiado === "paquete" ? "Copiados" : "Copiar todos"}</Button>
            </div>
            {armado.map((g) => (
              <div key={g.id} className="caja-suave stack-2">
                <div>
                  <span className="t-strong">{g.titulo}</span>
                  <p className="t-sm t-subtle">{g.donde}</p>
                </div>
                {g.links.map((l) => {
                  const problemas = problemasDeUtm(l.utm);
                  return (
                    <div key={l.clave} className="utm-link">
                      {l.nombre && <span className="t-label">{l.nombre}</span>}
                      <div className="utm-link__fila">
                        <code className="utm-link__codigo">{l.link}</code>
                        <Button sm variante="secondary" icono={copiado === l.clave ? <Check size={14} /> : <Copy size={14} />}
                          onClick={() => copiar(l.link, l.clave)}>{copiado === l.clave ? "Copiado" : "Copiar"}</Button>
                      </div>
                      {problemas.length > 0 && <span className="t-sm" style={{ color: "var(--warning)" }}>{problemas.join(" · ")}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {!destino.trim() && <p className="t-sm t-subtle">Sin link de destino salen sólo las partes de los UTMs: pegalas al final del link.</p>}
          </div>
        ) : caso === "meta-vsl" ? (
          <div className="utm-link">
            <span className="t-label">Parámetros de URL, para pegar en el anuncio de Meta</span>
            <div className="utm-link__fila">
              <code className="utm-link__codigo">{queryUtm(variantes[0].utm)}</code>
              <Button sm variante="secondary" icono={copiado === "meta" ? <Check size={14} /> : <Copy size={14} />}
                onClick={() => copiar(queryUtm(variantes[0].utm), "meta")}>{copiado === "meta" ? "Copiado" : "Copiar"}</Button>
            </div>
          </div>
        ) : (
          <div className="stack-2">
            {variantes.map((x) => {
              const link = linkConUtm(destino, x.utm);
              const problemas = problemasDeUtm(x.utm);
              return (
                <div key={x.nombre || "unico"} className="utm-link">
                  {x.nombre && <span className="t-label">{x.nombre}</span>}
                  <div className="utm-link__fila">
                    <code className="utm-link__codigo">{link}</code>
                    <Button sm variante="secondary" icono={copiado === x.nombre ? <Check size={14} /> : <Copy size={14} />}
                      onClick={() => copiar(link, x.nombre)}>{copiado === x.nombre ? "Copiado" : "Copiar"}</Button>
                  </div>
                  {problemas.length > 0 && <span className="t-sm" style={{ color: "var(--warning)" }}>{problemas.join(" · ")}</span>}
                </div>
              );
            })}
            {!destino.trim() && <p className="t-sm t-subtle">Sin link de destino sale sólo la parte de los UTMs: pegala al final del link.</p>}
          </div>
        )}

        {caso !== "meta-vsl" && !falta && (
          <div className="caja-suave t-sm">
            <span className="t-subtle">{paquete ? "La app los lee como: " : "La app lo lee como: "}</span>
            <span className="t-strong">{textoOrigen(e, lectura)}</span>
            {lectura && !lectura.embudoId && <span className="t-subtle"> — elegí la estrategia de este funnel en «El estándar», acá abajo.</span>}
            {fechaPropia && lectura && !lectura.webinarId && (
              <span className="t-subtle"> — todavía no hay un webinar con esa fecha en la app: el link funciona, pero creá el webinar antes de mandarlo para que las agendas que lleguen queden atadas a él.</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- El estándar ---------- */

const FILAS_ESTANDAR: { funnel: Funnel; patron: string; regla: string; como: string }[] = [
  { funnel: "webinar", patron: "webinar_aaaammdd", regla: "webinar_*", como: "El webinar y su proyecto salen de la fecha." },
  { funnel: "clase0", patron: "clase0_webinar_aaaammdd", regla: "clase0_*", como: "La fecha es la del webinar del que es parte: el webinar y su proyecto salen de ahí." },
  { funnel: "qa", patron: "qa_webinar_aaaammdd", regla: "qa_*", como: "La fecha es la del webinar del que es parte: el webinar y su proyecto salen de ahí." },
  { funnel: "vsl-yt", patron: "vsl-yt", regla: "vsl-yt*", como: "El video va en utm_content." },
  { funnel: "setter", patron: "setter_{nombre}", regla: "setter_*", como: "El setter de la venta sale del nombre." },
  { funnel: "referido", patron: "referido", regla: "referido*", como: "El referidor de la venta sale de utm_content." },
];

function EstandarUtm() {
  const e = useEstado();
  const toast = useToast();
  const reglas = e.ajustes.reglasUtm ?? [];
  const estrategias = e.embudos.filter((x) => x.activo).sort((a, b) => a.orden - b.orden);
  const vsls = e.embudos.filter((x) => /vsl/i.test(x.nombre) && !/youtube/i.test(x.nombre));
  const organico = estrategiaDeFunnel(e, "vsl", "organica");

  /* La estrategia de un funnel: la de su regla ("clase0_*") si alguien la
     eligió, o la que corresponde por nombre en la planilla. */
  const reglaDe = (patron: string) => reglas.find((r) => !r.source && !r.medium && !r.content && (r.campaign ?? "").toLowerCase() === patron);
  function elegir(patron: string, funnel: Funnel, embudoId: string) {
    const ya = reglaDe(patron);
    const porDefecto = estrategiaDeFunnel(e, funnel);
    let nuevas: ReglaUtm[];
    if (!embudoId || embudoId === porDefecto) nuevas = reglas.filter((r) => r !== ya);
    else if (ya) nuevas = reglas.map((r) => (r === ya ? { ...r, embudoId } : r));
    else nuevas = [{ id: nuevoId("utm"), campaign: patron, embudoId, creadoEn: new Date().toISOString() }, ...reglas];
    acciones.ajustes({ reglasUtm: nuevas }, `La estrategia de ${patron} quedó en «${e.embudos.find((x) => x.id === embudoId)?.nombre ?? "la de la planilla"}».`);
    toast("Estrategia guardada.");
  }

  return (
    <Card>
      <CardHead
        titulo="El estándar"
        sub="utm_campaign arranca con el funnel, y de ahí sale la estrategia de la venta. Lo que cambia en cada link (la fecha, el setter, el referidor) también lo lee la app."
      />
      <div className="stack-3">
        <div className="lista-scroll catalogo-lista">
          {FILAS_ESTANDAR.map((f) => {
            const regla = reglaDe(f.regla);
            const actual = regla?.embudoId ?? estrategiaDeFunnel(e, f.funnel);
            return (
              <div key={f.funnel} className="utm-estandar">
                <span className="utm-estandar__funnel">
                  <code>{f.patron}</code>
                  <span className="t-sm t-subtle">{f.como}</span>
                </span>
                <Select aria-label={`Estrategia de ${f.patron}`} value={actual ?? ""} placeholder="Elegí la estrategia"
                  onChange={(ev) => elegir(f.regla, f.funnel, ev.target.value)}
                  opciones={estrategias.map((x) => ({ valor: x.id, texto: x.nombre }))} />
              </div>
            );
          })}
          <div className="utm-estandar">
            <span className="utm-estandar__funnel">
              <code>vsl_organica</code>
              <span className="t-sm t-subtle">La VSL desde Instagram (bio, historias, post).</span>
            </span>
            <span className="t-sm">{e.embudos.find((x) => x.id === organico)?.nombre ?? <span className="t-subtle">No hay una estrategia Orgánico</span>}</span>
          </div>
          <div className="utm-estandar">
            <span className="utm-estandar__funnel">
              <code>vsl_{"{nombre}"}</code>
              <span className="t-sm t-subtle">La pauta de Meta a una VSL: la campaña se nombra con la VSL, y así sale su estrategia.</span>
            </span>
            <span className="row-wrap" style={{ gap: 6 }}>
              {vsls.length === 0 ? <span className="t-sm t-subtle">No hay estrategias VSL</span> : vsls.map((x) => (
                <Badge key={x.id} variante="neutral">{`vsl_${slugUtm(x.nombre).replace(/^vsl-/, "")}`} → {x.nombre}</Badge>
              ))}
            </span>
          </div>
        </div>

        <details className="utm-diccionario">
          <summary className="t-sm t-strong">Diccionario y reglas de formato</summary>
          <dl className="dl dl--compacta">
            <dt>utm_source</dt><dd>{FUENTES.join(" · ")}</dd>
            <dt>utm_medium</dt><dd>{MEDIOS.join(" · ")} (outbound es setter; referral, referido)</dd>
            <dt>utm_campaign</dt><dd>{FUNNELS.join(" · ")}, seguido de _ y el detalle</dd>
            <dt>utm_term</dt><dd>Sólo en pauta: el nombre del conjunto de anuncios</dd>
            <dt>utm_content</dt><dd>El anuncio, el video, vivo · replay · seguimiento, el setter o el referidor</dd>
            <dt>Formato</dt><dd>Minúsculas, sin tildes ni espacios; _ separa campos y - separa palabras; fechas aaaammdd. No se inventan parámetros.</dd>
            <dt>Sin UTMs</dt><dd>Se guarda source=direct y medium=none: llegó sola, sin un link nuestro.</dd>
            <dt>First y last touch</dt><dd>La ficha guarda los dos: con qué apareció la persona la primera vez y con qué link agendó cada llamada.</dd>
          </dl>
        </details>
      </div>
    </Card>
  );
}

/* ---------- Las reglas propias ---------- */

function ReglasPropias() {
  const e = useEstado();
  const toast = useToast();
  const todas = e.ajustes.reglasUtm ?? [];
  /* Las del estándar (sólo campaign con *) se eligen arriba. */
  const reglas = todas.filter((r) => r.source || r.medium || r.content || !(r.campaign ?? "").endsWith("*"));
  const estrategias = e.embudos.filter((x) => x.activo).sort((a, b) => a.orden - b.orden);
  const webinars = useMemo(() => [...e.webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.webinars]);
  const proyectos = useMemo(() => {
    const lista = e.ajustes.proyectos ?? [];
    const deWebinars = webinars.slice(0, 20).map((w) => proyectoDeWebinar(w.fecha)).filter((x) => !lista.includes(x));
    return [...deWebinars, ...lista];
  }, [e.ajustes.proyectos, webinars]);

  function guardar(nuevas: ReglaUtm[], aviso?: string) {
    if (aviso) acciones.ajustes({ reglasUtm: nuevas }, aviso);
    else acciones.ajustesSilencioso({ reglasUtm: nuevas });
  }
  function cambiar(r: ReglaUtm, cambios: Partial<ReglaUtm>, aviso?: string) {
    guardar(todas.map((x) => (x.id === r.id ? { ...x, ...cambios } : x)));
    if (aviso) toast(aviso);
  }
  function crear() {
    const r: ReglaUtm = { id: nuevoId("utm"), creadoEn: new Date().toISOString() };
    guardar([r, ...todas], "Se agregó una regla de UTM.");
    toast("Regla agregada: completá qué tiene que traer el link y de qué es.");
    window.setTimeout(() => document.getElementById(`utm-${r.id}-source`)?.focus(), 60);
  }
  function borrar(r: ReglaUtm) {
    guardar(todas.filter((x) => x.id !== r.id), `Se borró la regla «${textoUtm(r)}».`);
    toast("Regla borrada. Las ventas que ya tomaron su origen no cambian.");
  }
  function elegirProyecto(r: ReglaUtm, proyecto: string) {
    const w = r.webinarId ? undefined : webinarDeProyecto(proyecto, e.webinars);
    cambiar(r, { proyecto: proyecto || undefined, ...(w ? { webinarId: w.id } : {}) }, "Proyecto guardado.");
  }
  function elegirWebinar(r: ReglaUtm, webinarId: string) {
    const w = e.webinars.find((x) => x.id === webinarId);
    cambiar(r, { webinarId: webinarId || undefined, ...(w && !r.proyecto ? { proyecto: proyectoDeWebinar(w.fecha) } : {}) }, "Webinar guardado.");
  }

  return (
    <Card>
      <CardHead
        titulo="Reglas propias"
        sub="Para los links que no siguen el estándar (los de antes, una campaña especial): lo que tiene que traer el link y de qué es. Mandan sobre el estándar. Un valor que termina en * es «empieza con»."
        acciones={<Button variante="secondary" icono={<Plus size={16} />} onClick={crear}>Agregar regla</Button>}
      />
      {reglas.length === 0 ? (
        <Empty icono={<Link2 size={22} />} titulo="No hay reglas propias"
          texto="Con el estándar no hacen falta: sirven para los links que no lo siguen." />
      ) : (
        <div className="catalogo-lista lista-scroll">
          {reglas.map((r) => (
            <div className="utm-regla" key={r.id}>
              <div className="utm-regla__utm">
                {CAMPOS_UTM.map((c) => (
                  <Input
                    key={c} id={`utm-${r.id}-${c}`} aria-label={ETIQUETA[c]} placeholder={ETIQUETA[c]} defaultValue={r[c] ?? ""}
                    onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (r[c] ?? "")) cambiar(r, { [c]: v || undefined }, "Regla guardada."); }}
                  />
                ))}
                <IconButton etiqueta={`Borrar la regla ${textoUtm(r)}`} onClick={() => borrar(r)}><Trash2 size={15} /></IconButton>
              </div>
              <div className="utm-regla__destino">
                <Select aria-label="Estrategia utilizada" value={r.embudoId ?? ""} placeholder="Estrategia"
                  onChange={(ev) => cambiar(r, { embudoId: ev.target.value || undefined }, "Estrategia guardada.")}
                  opciones={estrategias.map((x) => ({ valor: x.id, texto: x.nombre }))} />
                <Select aria-label="Proyecto" value={r.proyecto ?? ""} placeholder="Proyecto"
                  onChange={(ev) => elegirProyecto(r, ev.target.value)} opciones={proyectos} />
                <Select aria-label="Webinar" value={r.webinarId ?? ""} placeholder="Webinar"
                  onChange={(ev) => elegirWebinar(r, ev.target.value)}
                  opciones={webinars.slice(0, 30).map((w) => ({ valor: w.id, texto: `${fechaLarga(w.fecha)} — ${w.titulo}` }))} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- Lo que llegó ---------- */

function UtmsQueLlegaron() {
  const e = useEstado();
  const toast = useToast();
  const detectadas = useMemo(() => utmsDetectadas(e), [e]);
  const aCompletar = useMemo(() => ventasParaCompletar(e), [e]);
  /* Primero lo que no quedó asignado, después lo que no sigue el estándar. */
  const ordenadas = useMemo(() => [...detectadas].sort((a, b) =>
    Number(Boolean(a.origen)) - Number(Boolean(b.origen))
    || Number(problemasDeUtm(crudo(a.utm)).length === 0) - Number(problemasDeUtm(crudo(b.utm)).length === 0)
    || b.ultima.localeCompare(a.ultima)), [detectadas]);

  function completar() {
    const n = acciones.completarOrigenes(aCompletar.map((x) => ({ id: x.venta.id, cambios: x.cambios })));
    toast(`Se completó el origen de ${num(n)} ${n === 1 ? "venta" : "ventas"}.`);
  }
  function crearRegla(u: Utm) {
    const todas = e.ajustes.reglasUtm ?? [];
    acciones.ajustes({ reglasUtm: [{ id: nuevoId("utm"), ...u, creadoEn: new Date().toISOString() }, ...todas] }, `Se agregó la regla «${textoUtm(u)}».`);
    toast("Regla agregada en «Reglas propias»: elegí de qué es.");
  }

  return (
    <>
      {aCompletar.length > 0 && (
        <Card>
          <CardHead
            titulo={`${num(aCompletar.length)} ${aCompletar.length === 1 ? "venta no tiene" : "ventas no tienen"} el origen completo`}
            sub="Quien compró llegó con una UTM que ya dice de qué es. Se completa sólo lo que falta (estrategia, proyecto, webinar, setter o referidor); lo que alguien eligió a mano queda."
            acciones={<Button variante="primary" onClick={completar}>Completar el origen</Button>}
          />
        </Card>
      )}

      <Card>
        <CardHead
          titulo="UTMs que llegaron"
          sub="Los links con los que llegó gente (de sus agendas de Calendly y de su primer contacto), de qué quedó cada uno y si sigue el estándar."
        />
        {ordenadas.length === 0 ? (
          <p className="t-sm t-subtle">Todavía no llegó nadie con UTMs.</p>
        ) : (
          <div className="catalogo-lista lista-scroll">
            {ordenadas.map((d) => {
              const problemas = problemasDeUtm(crudo(d.utm));
              return (
                <div className="utm-detectada" key={CAMPOS_UTM.map((c) => `${c}=${d.utm[c] ?? ""}`).join("&")}>
                  <span className="utm-detectada__utm">
                    {CAMPOS_UTM.filter((c) => d.utm[c]).map((c) => (
                      <Badge key={c} variante="neutral">{ETIQUETA[c].replace("utm_", "")}: {d.utm[c]}</Badge>
                    ))}
                  </span>
                  <span className="t-sm t-subtle t-num">{num(d.personas)} {d.personas === 1 ? "persona" : "personas"} · última {fechaLarga(d.ultima)}</span>
                  <span className="utm-detectada__origen t-sm">
                    {d.origen ? <span>{textoOrigen(e, d.origen)}</span> : <Badge variante="warning">Sin asignar</Badge>}
                    {problemas.length > 0 && <span className="t-subtle" title={problemas.join(" · ")}> · no sigue el estándar</span>}
                  </span>
                  {!d.origen && (
                    <Button sm variante="ghost" icono={<Plus size={14} />} onClick={() => crearRegla(d.utm)}>Crear regla</Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

/* {source: "email"} → {utm_source: "email"}, para validarla con el estándar. */
const crudo = (u: Utm): UtmCruda =>
  Object.fromEntries(Object.entries(u).map(([k, v]) => [`utm_${k}`, v])) as UtmCruda;
