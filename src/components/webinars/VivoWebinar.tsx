"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Flag, Link2, RefreshCw, X } from "lucide-react";
import { AreaChart } from "@/components/charts/charts";
import { Badge, Bar, Button, Card, CardHead, Empty, Tabs } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { num, pct, relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import { analizarVivo, minutoLegible, vivoDeEjemplo, type AnalisisVivo } from "@/lib/vivo";
import { duracionLegible, type AnalyticsVideo, type DatosVivo, type EstadoAnalytics, type FilaReparto } from "@/lib/youtube";
import type { Webinar } from "@/lib/types";
import { ConversacionWebinar } from "./ConversacionWebinar";
import { CurvaVivo, type Marca } from "./CurvaVivo";
import { diaCorto, diaYHora, partesArgentina } from "./fechas";
import { guardarWebinar } from "./guardar";
import {
  conectarAnalytics, useAgendasDesde, useAgendasWebinar, useAhora, useAnalytics, useDatosVivo, type Ahora,
} from "./useVivo";
import "./vivo.css";
import { useYoutube } from "./useYoutube";

/* ==================================================================
   El vivo, minuto a minuto.

   - Espectadores: cuántos miraban en cada minuto (lo guarda el cron
     mientras el webinar está en el aire), el pico, cuánto se quedaron y
     qué pasó desde el pitch. El pitch se marca tocando la curva.
   - Retención: la del vivo (sobre el pico) y la de la grabación, que da
     YouTube Analytics cuando el canal está conectado.
   - Audiencia: de dónde llegaron, países, edades, dispositivos
     (YouTube Analytics).
   - Después del vivo: cómo siguieron las vistas de la grabación.
   ================================================================== */

type Pestania = "espectadores" | "retencion" | "audiencia" | "despues";
type Fuente = "cron" | "analytics" | "ejemplo";

const MIN = 60_000;
const hora = (iso: string) => diaYHora(iso).split(" · ")[1] ?? "";
const enMinuto = (inicio: string, min: number) => new Date(+new Date(inicio) + min * MIN).toISOString();

/* ---------- Lo del vivo, compartido ----------
   La barra "En vivo" (arriba de la ficha) y las dos tarjetas (abajo) usan
   lo mismo: se pide una sola vez acá y se reparte. */

interface ContextoVivo {
  vivo: ReturnType<typeof useDatosVivo>;
  ahora: Ahora | null;
  enElAire: boolean;
}
const Ctx = createContext<ContextoVivo | null>(null);

export function VivoProvider({ w, videoId, children }: { w: Webinar; videoId: string; children: React.ReactNode }) {
  /* Se sigue si YouTube dijo que está en el aire, o si estamos cerca de la
     hora del webinar (puede arrancar en cualquier momento). En el aire,
     cada 20 segundos; cerca, cada minuto. */
  const f = +new Date(w.fecha);
  const cerca = Date.now() > f - 60 * MIN && Date.now() < f + 6 * 60 * MIN;
  const [enElAireAntes, setEnElAireAntes] = useState(false);
  const vivo = useDatosVivo(videoId, enElAireAntes ? 20_000 : cerca ? 60_000 : undefined);
  const guardadoEnVivo = vivo.estado === "listo" && vivo.datos.estado.estado === "en-vivo";
  const a = useAhora(videoId, cerca || guardadoEnVivo);
  const ahora = a.estado === "listo" ? a.datos : null;
  /* Manda YouTube ahora mismo; si todavía no contestó, lo último guardado. */
  const enElAire = ahora ? ahora.estado === "en-vivo" : guardadoEnVivo;
  useEffect(() => { setEnElAireAntes(enElAire); }, [enElAire]);
  return <Ctx.Provider value={{ vivo, ahora, enElAire }}>{children}</Ctx.Provider>;
}

/* ---------- La barra "En vivo" ----------
   Arriba de la ficha, pegada mientras se baja: cuántos miran ahora (cada
   15 segundos), el pico, el minuto del vivo, el chat y el botón para marcar
   el pitch en el segundo exacto. Después del pitch, cuánta gente se fue
   desde ahí, en directo. */

export function BannerVivo({ w }: { w: Webinar }) {
  const c = useContext(Ctx);
  const toast = useToast();
  const datos = c?.vivo.estado === "listo" ? c.vivo.datos : null;
  const inicio = c?.ahora?.inicio ?? datos?.estado.inicio;
  const a = useMemo(
    () => (datos ? analizarVivo(datos.minutos, datos.chat, { inicio, pitchEn: w.pitchEn }) : null),
    [datos, inicio, w.pitchEn],
  );
  if (!c?.enElAire) return null;

  const ultimo = a?.puntos[a.puntos.length - 1];
  const mirando = c.ahora?.espectadores ?? ultimo?.espectadores;
  const minVivo = inicio ? Math.max(0, Math.floor((Date.now() - +new Date(inicio)) / MIN)) : undefined;
  const enPitch = a?.pitch?.enElPitch.espectadores;
  const fuga = enPitch !== undefined && mirando !== undefined ? mirando - enPitch : undefined;
  const minPitch = w.pitchEn && inicio ? Math.max(0, Math.floor((+new Date(w.pitchEn) - +new Date(inicio)) / MIN)) : undefined;

  function arrancaPitch() {
    const iso = new Date().toISOString();
    const hh = new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false });
    guardarWebinar(w, { pitchEn: iso }, `El pitch de «${w.titulo}» arrancó a las ${hh}${minVivo !== undefined ? ` (${minutoLegible(minVivo)} del vivo)` : ""}.`);
    toast(`Pitch marcado a las ${hh}.`);
  }

  return (
    <div className="vivo-barra" role="region" aria-label="Webinar en vivo" aria-live="polite">
      <div className="vivo-barra__estado">
        <span className="vivo-etiqueta"><span className="vivo-punto" aria-hidden />En vivo</span>
        <span className="t-sm t-subtle t-num">
          {inicio ? `desde las ${hora(inicio)} hs` : "en el aire"}{minVivo !== undefined ? ` · ${minutoLegible(minVivo)}` : ""}
        </span>
      </div>
      <div className="vivo-barra__datos">
        <div className="vivo-dato">
          <span className="t-label">Mirando ahora</span>
          <span className="vivo-dato__valor t-num">{mirando !== undefined ? num(mirando) : "—"}</span>
          <span className="t-sm t-subtle">en este momento</span>
        </div>
        {a && (
          <div className="vivo-dato">
            <span className="t-label">Pico</span>
            <span className="vivo-dato__valor t-num">{num(a.pico.espectadores)}</span>
            <span className="t-sm t-subtle t-num">{minutoLegible(a.pico.min)} · {hora(a.pico.t)} hs</span>
          </div>
        )}
        <div className="vivo-dato">
          <span className="t-label">Chat</span>
          <span className="vivo-dato__valor t-num">{num(datos?.chatTotal ?? 0)}</span>
          <span className="t-sm t-subtle">mensajes</span>
        </div>
        {w.pitchEn && (
          <div className="vivo-dato">
            <span className="t-label">Desde el pitch</span>
            <span className="vivo-dato__valor t-num" style={{ color: fuga !== undefined && fuga < 0 ? "var(--danger)" : undefined }}>
              {fuga === undefined ? "—" : fuga < 0 ? `${num(fuga)} · ${pct((fuga / Math.max(1, enPitch ?? 1)) * 100, 0)}` : `+${num(fuga)}`}
            </span>
            <span className="t-sm t-subtle t-num">
              {minPitch !== undefined ? `pitch en el ${minutoLegible(minPitch)}` : "pitch marcado"}{enPitch !== undefined ? ` · había ${num(enPitch)}` : ""}
            </span>
          </div>
        )}
      </div>
      <div className="vivo-barra__acciones">
        {w.pitchEn ? (
          <Button sm variante="ghost" onClick={() => {
            guardarWebinar(w, { pitchEn: null }, `Se sacó la marca del pitch de «${w.titulo}».`);
            toast("Se sacó la marca del pitch.");
          }}>Deshacer el pitch</Button>
        ) : (
          <Button variante="primary" icono={<Flag size={18} />} lg className="vivo-pitch-btn" onClick={arrancaPitch}>
            Arranca el pitch
          </Button>
        )}
      </div>
    </div>
  );
}

/* Las tarjetas del vivo. Van adentro de VivoProvider.
   - TarjetaVivo: el minuto a minuto, abajo del video.
   - ChatDelVivo: el chat. lugar="columna" sólo aparece mientras está en
     el aire (en la columna de la derecha); lugar="abajo" sólo cuando no
     (abajo de todo, con los comentarios). */
export function TarjetaVivo({ w, videoId, className }: { w: Webinar; videoId: string; className?: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  return <VivoWebinar w={w} videoId={videoId} vivo={c.vivo} className={className} />;
}

export function ChatDelVivo({ w, videoId, lugar, className }: {
  w: Webinar; videoId: string; lugar: "columna" | "abajo"; className?: string;
}) {
  const c = useContext(Ctx);
  if (!c || (lugar === "columna") !== c.enElAire) return null;
  if (lugar === "abajo") return <ConversacionWebinar w={w} videoId={videoId} vivo={c.vivo} className={className} />;
  /* En vivo: arriba del chat, las agendas desde que arrancó el pitch. En el
     celular, el mismo orden (className) para que queden juntos. */
  return (
    <>
      {w.pitchEn && <AgendasDelPitch desde={w.pitchEn} className={className} />}
      <ConversacionWebinar w={w} videoId={videoId} vivo={c.vivo} enVivo className={className} />
    </>
  );
}

/* ---------- La fila del video ----------
   El video a la izquierda. A la derecha, mientras está en el aire, las
   agendas y el chat, cortados a la altura del video (el chat scrollea
   adentro); si no, lo que venga en `sinVivo` (el resultado). Sin
   VivoProvider (webinar sin video) es siempre `sinVivo`. */

export function FilaVideo({ videoId, video, chat, sinVivo }: {
  videoId: string | null; video: React.ReactNode; chat: React.ReactNode; sinVivo: React.ReactNode;
}) {
  const c = useContext(Ctx);
  const enVivo = Boolean(videoId && c?.enElAire);
  return (
    <div className={`wb-arriba${enVivo ? " wb-arriba--vivo" : ""}`}>
      {video}
      {enVivo ? <div className="wb-arriba__chat"><div className="wb-arriba__chat-dentro">{chat}</div></div> : sinVivo}
    </div>
  );
}

/* Lo de adentro sólo mientras el webinar está en el aire. */
export function SoloEnVivo({ children }: { children: React.ReactNode }) {
  const c = useContext(Ctx);
  return c?.enElAire ? <>{children}</> : null;
}

/* ---------- Agendas desde el pitch ----------
   Cuántas llamadas se agendaron en Calendly desde que se tocó "Arranca el
   pitch". Llegan por el webhook en segundos y la tarjeta pregunta cada 10
   segundos: se ve subir el número en directo. */

function AgendasDelPitch({ desde, className }: { desde: string; className?: string }) {
  const r = useAgendasDesde(desde, true);
  const lista = r.estado === "listo" ? r.datos.agendas : [];
  const delWebinar = lista.filter((x) => x.delWebinar).length;
  const minutos = Math.max(1, (Date.now() - +new Date(desde)) / MIN);
  return (
    <Card className={`vivo-agendas${className ? ` ${className}` : ""}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stack-1">
          <span className="t-label">Agendas desde el pitch</span>
          <span className="vivo-agendas__numero t-num">{r.estado === "cargando" ? "…" : num(lista.length)}</span>
          <span className="t-sm t-subtle t-num">
            {r.estado === "error"
              ? r.error
              : `${num(delWebinar)} del webinar · pitch a las ${hora(desde)} hs · ${num(lista.length / minutos, 1)} por minuto`}
          </span>
        </div>
        <span className="vivo-etiqueta"><span className="vivo-punto" aria-hidden />Calendly</span>
      </div>
      {lista.length > 0 && (
        <div className="vivo-agendas__lista">
          {lista.map((x) => (
            <div key={x.id} className="vivo-agendas__fila">
              <span className="t-strong truncate" style={{ flex: 1, minWidth: 0 }}>{x.nombre}</span>
              {x.closer && <span className="t-sm t-subtle truncate">{x.closer}</span>}
              <span className="t-sm t-subtle t-num" style={{ whiteSpace: "nowrap" }}>{hora(x.agendadaEn)} hs</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function VivoWebinar({ w, videoId, vivo, className }: {
  w: Webinar; videoId: string; vivo: ReturnType<typeof useDatosVivo>; className?: string;
}) {
  const toast = useToast();
  const [pestania, setPestania] = useState<Pestania>("espectadores");
  const [ejemplo, setEjemplo] = useState(false);
  const datos = vivo.estado === "listo" ? vivo.datos : null;
  const enElAire = datos?.estado.estado === "en-vivo";
  const an = useAnalytics(videoId, desdeDe(w));
  const yt = useYoutube(videoId);
  const ag = useAgendasWebinar(w.id);
  const datosAg = ag.estado === "listo" ? ag.datos : null;
  const horasAgendas = useMemo(
    () => (datosAg ? datosAg.agendas.filter((x) => !x.cancelada).map((x) => x.agendadaEn) : []),
    [datosAg],
  );

  /* Vuelta de Google después de conectar el canal. */
  useEffect(() => {
    const u = new URL(window.location.href);
    const r = u.searchParams.get("youtube");
    if (!r) return;
    const textos: Record<string, [string, "ok" | "err"]> = {
      "conectado": ["YouTube Analytics quedó conectado.", "ok"],
      "cancelado": ["Se canceló la conexión con YouTube.", "err"],
      "sin-canal": ["Esa cuenta de Google no tiene un canal de YouTube.", "err"],
      "sin-permiso-largo": ["Google no dio el permiso permanente. Probá de nuevo.", "err"],
    };
    const [texto, tono] = textos[r] ?? ["No se pudo conectar YouTube Analytics.", "err"];
    toast(texto, tono);
    if (r === "conectado") setPestania("retencion");
    u.searchParams.delete("youtube");
    window.history.replaceState(null, "", u.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez al volver de Google
  }, []);

  /* De dónde salen los minutos: lo que guardó el cron durante el vivo; si
     no hay (un vivo pasado), los de YouTube Analytics, si el canal está
     conectado. El ejemplo es la misma pantalla con una curva inventada. */
  const estadoAn = an.estado === "listo" ? an.datos : null;
  const porMinutoAnalytics = useMemo(
    () => (estadoAn?.conectado ? estadoAn.datos?.porMinuto ?? [] : []),
    [estadoAn],
  );
  const inicioYoutube = yt.estado === "listo" ? yt.datos.vivo?.inicio : undefined;
  const muestra = useMemo(() => {
    if (ejemplo) {
      const ej = vivoDeEjemplo(w.id, w.fecha);
      return { fuente: "ejemplo" as Fuente, minutos: ej.muestras, chat: ej.chat, inicio: w.fecha, pitchEn: w.pitchEn ?? ej.pitchEn };
    }
    if (datos && datos.minutos.length > 0) {
      return { fuente: "cron" as Fuente, minutos: datos.minutos, chat: datos.chat, inicio: datos.estado.inicio, pitchEn: w.pitchEn };
    }
    if (porMinutoAnalytics.length > 0) {
      const inicio = datos?.estado.inicio ?? inicioYoutube ?? w.fecha;
      return {
        fuente: "analytics" as Fuente,
        minutos: porMinutoAnalytics.map((p) => ({
          t: enMinuto(inicio, p.min), enVivo: true, espectadores: Math.round(p.promedio ?? p.pico ?? 0),
        })),
        chat: datos?.chat ?? [], inicio, pitchEn: w.pitchEn,
      };
    }
    return null;
  }, [ejemplo, datos, porMinutoAnalytics, inicioYoutube, w.id, w.fecha, w.pitchEn]);

  const a = useMemo(
    () => (muestra ? analizarVivo(muestra.minutos, muestra.chat, { inicio: muestra.inicio, pitchEn: muestra.pitchEn }) : null),
    [muestra],
  );

  const sub = (() => {
    if (ejemplo) return "Vista previa con números inventados";
    if (enElAire) return "En vivo: se actualiza cada minuto";
    if (a) {
      const cuando = muestra?.inicio ? `${diaYHora(muestra.inicio)} hs · ` : "";
      return `${cuando}${duracionLegible(a.duracionMin * 60)} · pico de ${num(a.pico.espectadores)} en el ${minutoLegible(a.pico.min)}`;
    }
    return "Cuántos miraban en cada minuto, el pico y qué pasó cuando arrancó el pitch";
  })();

  return (
    <Card className={`wb-vivo${className ? ` ${className}` : ""}`}>
      <CardHead
        titulo="El vivo, minuto a minuto"
        sub={sub}
        acciones={
          /* A la derecha del título: "En vivo" y, al lado, las pestañas. */
          <div className="wb-vivo__cabeza">
            {enElAire && <span className="vivo-etiqueta"><span className="vivo-punto" aria-hidden />En vivo</span>}
            {ejemplo && <Badge variante="warning">Ejemplo</Badge>}
            {ejemplo && <Button sm variante="ghost" icono={<X size={15} />} onClick={() => setEjemplo(false)}>Salir del ejemplo</Button>}
            <Tabs<Pestania>
              valor={pestania} onChange={setPestania}
              opciones={[
                { valor: "espectadores", texto: "Espectadores" },
                { valor: "retencion", texto: "Retención" },
                { valor: "audiencia", texto: "Audiencia" },
                { valor: "despues", texto: "Después del vivo" },
              ]}
            />
          </div>
        }
      />

      {pestania === "espectadores" && (
        <Espectadores
          w={w} a={a} datos={datos} cargando={vivo.estado === "cargando"} error={vivo.estado === "error" ? vivo.error : null}
          ejemplo={ejemplo} enElAire={enElAire} onEjemplo={() => setEjemplo(true)} onRecargar={vivo.recargar}
          fuente={muestra?.fuente} conectado={an.estado === "listo" && an.datos.conectado}
          agendas={ejemplo ? [] : horasAgendas}
        />
      )}
      {pestania === "retencion" && <Retencion an={an} duracionSeg={yt.estado === "listo" ? yt.datos.duracionSeg : undefined} a={a} ejemplo={ejemplo} />}
      {pestania === "audiencia" && <Audiencia an={an} />}
      {pestania === "despues" && <Despues datos={datos} />}
    </Card>
  );
}

/* ---------- Espectadores ---------- */

function Espectadores({ w, a, datos, cargando, error, ejemplo, enElAire, onEjemplo, onRecargar, fuente, conectado, agendas }: {
  w: Webinar; a: AnalisisVivo | null; datos: DatosVivo | null; cargando: boolean; error: string | null;
  ejemplo: boolean; enElAire: boolean; onEjemplo: () => void; onRecargar: () => void;
  fuente?: Fuente; conectado: boolean;
  /* Cuándo se agendó cada llamada de Calendly de este webinar (sin las canceladas). */
  agendas: string[];
}) {
  const toast = useToast();
  const [elegido, setElegido] = useState<number | null>(null);

  if (cargando && !a) {
    return (
      <div className="stack-3" aria-busy="true" aria-label="Trayendo el vivo">
        <div className="wb-vivo__kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 76 }} />)}</div>
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }
  if (error && !a) {
    return (
      <div className="stack-3">
        <p className="t-body t-muted">{error}</p>
        <div><Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={onRecargar}>Reintentar</Button></div>
      </div>
    );
  }
  if (!a) return <SinMinutos w={w} datos={datos} onEjemplo={onEjemplo} conectado={conectado} />;

  const inicio = a.inicio;
  const pitch = a.pitch;
  /* Cada agenda, en el minuto del vivo en que llegó (al punto más cercano
     que haya: si ese minuto no tiene muestra, al anterior). */
  const agendasPorMinuto = new Map<number, number>();
  for (const t of agendas) {
    const min = Math.floor((+new Date(t) - +new Date(inicio)) / MIN);
    if (min < 0 || min > a.duracionMin) continue;
    let k = a.puntos[0].min;
    for (const p of a.puntos) { if (p.min <= min) k = p.min; else break; }
    agendasPorMinuto.set(k, (agendasPorMinuto.get(k) ?? 0) + 1);
  }
  const minPitch = pitch?.enElPitch.min;

  function marcarPitch(min: number) {
    if (ejemplo) { toast("En el ejemplo no se guarda el pitch: marcalo en un vivo de verdad."); return; }
    const iso = enMinuto(inicio, min);
    guardarWebinar(w, { pitchEn: iso }, `El pitch de «${w.titulo}» quedó en el ${minutoLegible(min)} del vivo (${hora(iso)} hs).`);
    toast(`Pitch marcado en el ${minutoLegible(min)}.`);
    setElegido(null);
  }

  const marcas: Marca[] = [];
  if (minPitch != null) marcas.push({ min: minPitch, texto: "Pitch", tono: "pitch" });
  if (elegido != null && elegido !== minPitch) marcas.push({ min: elegido, texto: minutoLegible(elegido), tono: "elegido" });
  const puntoElegido = elegido != null ? a.puntos.find((p) => p.min === elegido) ?? null : null;
  const ultima = datos?.estado.ultimaMuestra;

  return (
    <div className="stack-4">
      <div className="wb-vivo__kpis">
        <Kpi etiqueta="Pico" valor={num(a.pico.espectadores)} sub={`${minutoLegible(a.pico.min)} · ${hora(a.pico.t)} hs · a la vez`} />
        {!ejemplo && w.asistentes > 0 && (
          <Kpi
            etiqueta="Asistieron" valor={`≈ ${num(w.asistentes)}`}
            sub={w.extra?.asistentesFuente === "analytics" ? "vistas en vivo · YouTube Analytics" : "vistas durante el vivo"}
            ayuda="Cuánta gente pasó por el vivo. YouTube no da personas únicas: son las vistas del vivo, y quien se fue y volvió cuenta dos veces. Se completa solo; si alguien lo carga a mano, no se pisa."
          />
        )}
        <Kpi etiqueta="Promedio" valor={num(Math.round(a.promedio))} sub={`${pct(a.retencionMedia * 100, 0)} del pico en promedio`} />
        <Kpi
          etiqueta="Minutos vistos" valor={num(Math.round(a.minutosVistos))}
          sub={a.tiempoMedioMin ? `≈ ${num(a.tiempoMedioMin, 0)} min por vista` : "en vivo"}
          ayuda="La suma de los espectadores de cada minuto. El tiempo por vista es aproximado: se divide por las vistas del video al terminar el vivo, porque YouTube no da espectadores únicos."
        />
        <Kpi etiqueta="Chat" valor={num(a.mensajes)} sub={a.mensajes ? `${num(a.mensajes / Math.max(1, a.duracionMin), 1)} mensajes por minuto` : "sin mensajes guardados"} />
      </div>

      <CurvaVivo
        etiqueta="Espectadores del vivo, minuto a minuto. Tocá un minuto para marcar el pitch."
        serie="Mirando" serieBarra="Mensajes"
        puntos={a.puntos.map((p) => ({ min: p.min, valor: p.espectadores, barra: p.chat, agendas: agendasPorMinuto.get(p.min), detalle: `${hora(p.t)} hs` }))}
        pico={{ min: a.pico.min, valor: a.pico.espectadores }}
        marcas={marcas}
        elegido={elegido}
        onElegir={setElegido}
      />

      {puntoElegido ? (
        <div className="wb-vivo__eleccion" role="group" aria-label="Minuto elegido">
          <span className="t-sm" style={{ flex: 1, minWidth: 200 }}>
            <strong>{minutoLegible(puntoElegido.min)}</strong>
            <span className="t-subtle"> · {hora(puntoElegido.t)} hs · </span>
            <span className="t-num">{num(puntoElegido.espectadores)}</span> <span className="t-subtle">mirando</span>
          </span>
          <Button sm variante="primary" icono={<Flag size={15} />} onClick={() => marcarPitch(puntoElegido.min)}>
            {minPitch != null ? "Mover el pitch acá" : "El pitch arrancó acá"}
          </Button>
          <Button sm variante="ghost" onClick={() => setElegido(null)}>Cancelar</Button>
        </div>
      ) : !pitch && (
        <p className="wb-aviso t-sm">
          <Flag size={16} aria-hidden />
          <span style={{ flex: 1 }}>
            Tocá en la curva el minuto en que arrancó el pitch (o recorrela con las flechas) y vas a ver cuánta gente se fue desde ahí.
          </span>
          {enElAire && !ejemplo && (
            <button type="button" className="link t-sm" onClick={() => marcarPitch(a.duracionMin)}>Arrancó ahora</button>
          )}
        </p>
      )}

      {pitch && (
        <div className="wb-vivo__pitch">
          <div className="row-wrap" style={{ alignItems: "baseline" }}>
            <span className="t-label" style={{ flex: 1 }}>Desde el pitch · {minutoLegible(pitch.enElPitch.min)} · {hora(pitch.enElPitch.t)} hs</span>
            {!ejemplo && (
              <button type="button" className="link t-sm" onClick={() => {
                guardarWebinar(w, { pitchEn: null }, `Se sacó la marca del pitch de «${w.titulo}».`);
                toast("Se sacó la marca del pitch.");
              }}>Quitar la marca</button>
            )}
          </div>
          <div className="wb-vivo__kpis">
            <Kpi etiqueta="En el pitch" valor={num(pitch.enElPitch.espectadores)}
              sub={`${pct((pitch.enElPitch.espectadores / Math.max(1, a.pico.espectadores)) * 100, 0)} del pico`} />
            {pitch.despues.filter((d) => d.minutos === 10 || d.minutos === 30).map((d) => (
              <Kpi key={d.minutos} etiqueta={`A los ${d.minutos} min`} valor={num(d.momento.espectadores)}
                sub={`se quedó el ${pct(d.retenidos * 100, 0)}`}
                color={d.retenidos < 0.6 ? "var(--danger)" : d.retenidos < 0.8 ? "var(--warning)" : "var(--success)"} />
            ))}
            <Kpi etiqueta="Al final" valor={num(pitch.alFinal.espectadores)}
              sub={`${pct(pitch.retenidosAlFinal * 100, 0)} de los del pitch · ${minutoLegible(pitch.alFinal.min)}`} />
          </div>
          <p className="t-sm t-muted">{fraseDelPitch(pitch)}</p>
        </div>
      )}

      {a.caidas.length > 0 && (
        <div className="stack-2">
          <span className="t-label">Donde más gente se fue</span>
          <div className="wb-filas">
            {a.caidas.map((c) => (
              <button key={c.desde.min} type="button" className="wb-fila wb-vivo__caida" onClick={() => setElegido(c.desde.min)}
                title="Elegir este minuto en la curva">
                <span className="wb-fila__texto">
                  <span className="wb-fila__nombre">
                    {minutoLegible(c.desde.min)} → {minutoLegible(c.hasta.min)}
                    {minPitch != null && c.desde.min <= minPitch + 2 && c.hasta.min >= minPitch && <Badge variante="warning">Pitch</Badge>}
                  </span>
                  <span className="wb-fila__detalle">{hora(c.desde.t)} a {hora(c.hasta.t)} hs · de {num(c.desde.espectadores)} a {num(c.hasta.espectadores)}</span>
                </span>
                <span className="t-num t-strong" style={{ color: "var(--danger)" }}>−{num(c.perdidos)} · −{pct(c.proporcion * 100, 0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!ejemplo && (
        <p className="t-sm t-subtle">
          {fuente === "analytics"
            ? "Según YouTube Analytics: el promedio de espectadores a la vez en cada minuto del vivo."
            : enElAire
              ? `Se guarda una muestra por minuto${ultima ? ` · la última ${relativo(ultima)}` : ""}.`
              : "YouTube sólo dice cuántos miran en el momento: estos números se guardaron minuto a minuto mientras el vivo estaba en el aire."}
          {datos?.estado.errorChat && ` El chat no se pudo leer: ${datos.estado.errorChat}`}
        </p>
      )}
    </div>
  );
}

function fraseDelPitch(p: NonNullable<AnalisisVivo["pitch"]>): string {
  const partes: string[] = [];
  const a10 = p.despues.find((d) => d.minutos === 10);
  if (a10) {
    const perdidos = p.enElPitch.espectadores - a10.momento.espectadores;
    partes.push(perdidos > 0
      ? `En los 10 minutos siguientes al pitch se fueron ${num(perdidos)} personas (${num(p.fugaPorMinuto, 1)} por minuto)`
      : "En los 10 minutos siguientes al pitch no se fue gente");
    if (perdidos > 0 && p.fugaPorMinutoAntes !== undefined) {
      if (p.fugaPorMinutoAntes <= 0.5) partes[0] += ", cuando antes la sala estaba estable";
      else {
        const veces = p.fugaPorMinuto / p.fugaPorMinutoAntes;
        partes[0] += veces >= 1.3
          ? `, ${num(veces, 1)} veces más rápido que en los 10 minutos anteriores (${num(p.fugaPorMinutoAntes, 1)} por minuto)`
          : `, a un ritmo parecido al de antes (${num(p.fugaPorMinutoAntes, 1)} por minuto)`;
      }
    }
  }
  if (p.chatAntes > 0 || p.chatDurante > 0) {
    partes.push(`El chat pasó de ${num(p.chatAntes, 1)} a ${num(p.chatDurante, 1)} mensajes por minuto`);
  }
  return partes.length ? `${partes.join(". ")}.` : "Todavía no hay minutos después del pitch.";
}

function SinMinutos({ w, datos, onEjemplo, conectado }: {
  w: Webinar; datos: DatosVivo | null; onEjemplo: () => void; conectado: boolean;
}) {
  const e = datos?.estado;
  const pasado = +new Date(w.fecha) < Date.now() - 6 * 3600_000;
  let titulo: string;
  let texto: string;
  if (datos && !datos.hayBase) {
    titulo = "Acá se dibuja el vivo, minuto a minuto";
    texto = "Los espectadores se guardan en la base cada minuto mientras el webinar está en el aire. Esta copia de la app corre sin base, así que acá no hay nada guardado.";
  } else if (e?.estado === "programado" || (!pasado && e?.estado !== "terminado")) {
    titulo = "Cuando arranque el vivo, acá se dibuja minuto a minuto";
    texto = `Desde una hora antes (${diaYHora(new Date(+new Date(w.fecha) - 3600_000).toISOString())} hs) se revisa cada minuto si salió al aire, y desde ahí se guarda cuántos miran y el chat. No hace falta tener esta pantalla abierta.`;
  } else {
    titulo = "Este vivo no quedó registrado minuto a minuto";
    texto = conectado
      ? "No se guardó mientras estaba en el aire, y YouTube Analytics todavía no tiene los minutos de este vivo (tarda dos o tres días) o no es un vivo del canal conectado."
      : "No se guardó mientras estaba en el aire. Para los vivos pasados, los espectadores de cada minuto los da YouTube Analytics: conectá el canal en la pestaña Retención y aparecen acá.";
  }
  return (
    <Empty
      icono={<Activity size={22} />}
      titulo={titulo}
      texto={texto}
      accion={<Button variante="secondary" onClick={onEjemplo}>Ver cómo va a quedar</Button>}
    />
  );
}

function Kpi({ etiqueta, valor, sub, color, ayuda }: { etiqueta: string; valor: string; sub?: string; color?: string; ayuda?: string }) {
  return (
    <div className="wb-kpi" title={ayuda}>
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num" style={color ? { color } : undefined}>{valor}</span>
      {sub && <span className="t-sm t-subtle t-num">{sub}</span>}
    </div>
  );
}

/* ---------- Retención ---------- */

function Retencion({ an, duracionSeg, a, ejemplo }: {
  an: ReturnType<typeof useAnalytics>; duracionSeg?: number; a: AnalisisVivo | null; ejemplo: boolean;
}) {
  const duracionMin = duracionSeg ? duracionSeg / 60 : undefined;
  const pitchMin = a?.pitch?.enElPitch.min;

  return (
    <div className="stack-5">
      <section className="stack-3">
        <div className="stack-1">
          <span className="t-label">Del vivo</span>
          <span className="t-sm t-subtle">Qué parte del pico seguía mirando en cada minuto.</span>
        </div>
        {a ? (
          <CurvaVivo
            etiqueta="Retención del vivo sobre el pico, minuto a minuto" serie="Del pico" alto={220}
            formato={(n) => pct(n, 0)}
            puntos={a.puntos.map((p) => ({ min: p.min, valor: (p.espectadores / Math.max(1, a.pico.espectadores)) * 100, detalle: `${num(p.espectadores)} mirando` }))}
            marcas={pitchMin != null ? [{ min: pitchMin, texto: "Pitch", tono: "pitch" }] : []}
          />
        ) : (
          <p className="t-sm t-muted">Aparece cuando haya un vivo registrado minuto a minuto (pestaña Espectadores).</p>
        )}
      </section>

      <section className="stack-3">
        <div className="row-wrap" style={{ alignItems: "flex-end" }}>
          <div className="stack-1" style={{ flex: 1, minWidth: 220 }}>
            <span className="t-label">De la grabación · YouTube Analytics</span>
            <span className="t-sm t-subtle">Qué parte de la gente llega a cada minuto del video. Sirve también para los vivos pasados.</span>
          </div>
          {an.estado === "listo" && an.datos.conectado && (
            <Button sm variante="ghost" icono={<RefreshCw size={15} />} onClick={an.actualizar}>Actualizar</Button>
          )}
        </div>
        <ContenidoAnalytics an={an} render={(d) => (
          <div className="stack-4">
            <div className="wb-vivo__kpis">
              <Kpi etiqueta="Vistas" valor={d.resumen.vistas !== undefined ? num(d.resumen.vistas) : "—"} sub={`desde el ${diaCorto(d.desde)}`} />
              <Kpi etiqueta="Duración media" valor={d.resumen.duracionMediaSeg !== undefined ? duracionLegible(d.resumen.duracionMediaSeg) : "—"}
                sub={d.resumen.porcentajeMedio !== undefined ? `${pct(d.resumen.porcentajeMedio, 0)} del video` : undefined} />
              <Kpi etiqueta="Minutos vistos" valor={d.resumen.minutosVistos !== undefined ? num(d.resumen.minutosVistos) : "—"} sub="vivo y grabación" />
              {d.resumen.picoConcurrentes !== undefined
                ? <Kpi etiqueta="Pico en vivo" valor={num(d.resumen.picoConcurrentes)}
                    sub={d.resumen.promedioConcurrentes !== undefined ? `${num(d.resumen.promedioConcurrentes)} en promedio` : "espectadores a la vez"} />
                : <Kpi etiqueta="Suscriptores" valor={d.resumen.suscriptoresGanados !== undefined ? `+${num(d.resumen.suscriptoresGanados)}` : "—"}
                    sub={d.resumen.suscriptoresPerdidos ? `${num(d.resumen.suscriptoresPerdidos)} se dieron de baja` : "ganados con este video"} />}
            </div>
            {d.retencion.length > 0 ? (
              <CurvaVivo
                etiqueta="Retención de la grabación según YouTube Analytics" serie="Siguen mirando" alto={220}
                formato={(n) => pct(n, 0)}
                puntos={d.retencion.map((r) => ({
                  min: duracionMin ? Math.round(r.ratio * duracionMin) : Math.round(r.ratio * 100),
                  valor: r.mirando * 100,
                  detalle: duracionMin ? `${pct(r.ratio * 100, 0)} del video` : undefined,
                }))}
                marcas={pitchMin != null && duracionMin ? [{ min: pitchMin, texto: "Pitch", tono: "pitch" }] : []}
              />
            ) : (
              <p className="t-sm t-muted">YouTube todavía no tiene la retención de este video (tarda dos o tres días).</p>
            )}
            {!duracionMin && d.retencion.length > 0 && <p className="t-sm t-subtle">Sin la duración del video, el eje va en porcentaje del video.</p>}
            <Faltan d={d} />
          </div>
        )} />
      </section>
      {ejemplo && <p className="t-sm t-subtle">La curva del vivo es la del ejemplo; lo de YouTube Analytics es real.</p>}
    </div>
  );
}

/* Analytics cuenta por día: se pide desde el día anterior al webinar. */
function desdeDe(w: Webinar): string {
  const d = partesArgentina(w.fecha).dia;
  if (!d) return new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

function ContenidoAnalytics({ an, render }: {
  an: ReturnType<typeof useAnalytics>; render: (d: AnalyticsVideo) => React.ReactNode;
}) {
  if (an.estado === "cargando") return <div className="skeleton" style={{ height: 180 }} aria-busy="true" aria-label="Trayendo YouTube Analytics" />;
  if (an.estado === "error") return <p className="t-sm t-muted">{an.error}</p>;
  const e: EstadoAnalytics = an.datos;
  if (!e.conectado) return <ConectarAnalytics configurado={e.configurado} />;
  if (e.error) {
    return (
      <div className="stack-2">
        <p className="t-sm" style={{ color: "var(--warning)" }}>{e.error}</p>
        <p className="t-sm t-subtle">Canal conectado: {e.canal ?? "sin nombre"}.</p>
      </div>
    );
  }
  if (!e.datos) return null;
  return <>{render(e.datos)}</>;
}

function ConectarAnalytics({ configurado }: { configurado: boolean }) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [yendo, setYendo] = useState(false);
  return (
    <div className="wb-conectar">
      <span className="wb-pegar__ico"><BarChart3 size={22} /></span>
      <div className="stack-2" style={{ flex: 1, minWidth: 240 }}>
        <span className="t-strong">Conectá YouTube Analytics</span>
        <span className="t-sm t-muted">
          La retención, el tiempo de reproducción, de dónde llegó la gente, países, edades y dispositivos los ve sólo el
          dueño del canal. Se conecta una vez con la cuenta de Google que administra el canal de Hackear IT, con permiso
          de sólo lectura, y sirve para todos los webinars, también los pasados.
        </span>
        {!configurado && (
          <span className="t-sm t-subtle">
            Antes hay que crear el cliente OAuth de Google y cargar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel.
          </span>
        )}
      </div>
      {configurado && (
        <Button variante="primary" icono={<Link2 size={16} />} disabled={yendo} onClick={async () => {
          setYendo(true);
          const error = await conectarAnalytics(yo.nombre || yo.email || undefined);
          if (error) { toast(error, "err"); setYendo(false); }
        }}>
          {yendo ? "Abriendo Google…" : "Conectar el canal"}
        </Button>
      )}
    </div>
  );
}

function Faltan({ d }: { d: AnalyticsVideo }) {
  if (d.faltan.length === 0) return <p className="t-sm t-subtle">Actualizado {relativo(d.traidoEn)}. YouTube Analytics tarda dos o tres días en tener los números de un video.</p>;
  return <p className="t-sm t-subtle">YouTube no dio: {d.faltan.join(", ")}. Actualizado {relativo(d.traidoEn)}.</p>;
}

/* ---------- Audiencia ---------- */

const FUENTES: Record<string, string> = {
  ADVERTISING: "Anuncios", ANNOTATION: "Anotaciones", CAMPAIGN_CARD: "Tarjetas de campaña", END_SCREEN: "Pantallas finales",
  EXT_URL: "Links externos", HASHTAGS: "Hashtags", LIVE_REDIRECT: "Redirección de un vivo", NO_LINK_EMBEDDED: "Reproductor embebido",
  NO_LINK_OTHER: "Directo o desconocido", NOTIFICATION: "Notificaciones", PLAYLIST: "Listas de reproducción",
  PRODUCT_PAGE: "Página de producto", PROMOTED: "Promocionado", RELATED_VIDEO: "Videos sugeridos", SHORTS: "Shorts",
  SOUND_PAGE: "Página de sonido", SUBSCRIBER: "Inicio y suscripciones", VIDEO_REMIXES: "Remixes", YT_CHANNEL: "Página del canal",
  YT_OTHER_PAGE: "Otras páginas de YouTube", YT_PLAYLIST_PAGE: "Página de lista", YT_SEARCH: "Búsqueda de YouTube",
  IMMERSIVE_LIVE: "Vivo inmersivo",
};
const DISPOSITIVOS: Record<string, string> = {
  DESKTOP: "Computadora", MOBILE: "Celular", TABLET: "Tablet", TV: "Televisor", GAME_CONSOLE: "Consola", UNKNOWN_PLATFORM: "Otro",
};
const GENEROS: Record<string, string> = { female: "Mujeres", male: "Hombres", user_specified: "Otro" };
const VIVO_O_NO: Record<string, string> = { LIVE: "En vivo", ON_DEMAND: "Grabación" };

let nombresPais: Intl.DisplayNames | null = null;
function pais(codigo: string): string {
  try {
    nombresPais ??= new Intl.DisplayNames(["es"], { type: "region" });
    return nombresPais.of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

function Audiencia({ an }: { an: ReturnType<typeof useAnalytics> }) {
  return (
    <ContenidoAnalytics an={an} render={(d) => (
      <div className="stack-4">
        <div className="wb-reparto-grilla">
          <Reparto titulo="Vivo o grabación" filas={d.vivoVsGrabacion} nombre={(k) => VIVO_O_NO[k] ?? k} sub="vistas" />
          <Reparto titulo="De dónde llegaron" filas={d.fuentes} nombre={(k) => FUENTES[k] ?? k} sub="vistas" />
          <Reparto titulo="Países" filas={d.paises} nombre={pais} sub="vistas" />
          <Reparto titulo="Dispositivos" filas={d.dispositivos} nombre={(k) => DISPOSITIVOS[k] ?? k} sub="vistas" />
          <Reparto titulo="Edades" filas={d.edades} nombre={(k) => k.replace(/^age/, "").replace("-", "–") + " años"} porcentaje />
          <Reparto titulo="Géneros" filas={d.generos} nombre={(k) => GENEROS[k] ?? k} porcentaje />
        </div>
        <Faltan d={d} />
      </div>
    )} />
  );
}

function Reparto({ titulo, filas, nombre, sub, porcentaje }: {
  titulo: string; filas: FilaReparto[]; nombre: (k: string) => string; sub?: string; porcentaje?: boolean;
}) {
  const total = porcentaje ? 100 : filas.reduce((s, f) => s + f.valor, 0);
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <div className="wb-reparto-bloque">
      <span className="t-label">{titulo}</span>
      {filas.length === 0 ? <p className="t-sm t-subtle">Sin datos todavía.</p> : (
        <div className="stack-2">
          {filas.slice(0, 8).map((f) => (
            <div key={f.clave} className="wb-reparto-fila">
              <span className="wb-reparto-fila__nombre truncate" title={nombre(f.clave)}>{nombre(f.clave)}</span>
              <span className="wb-reparto-fila__barra"><Bar valor={(f.valor / max) * 100} tono="accent" /></span>
              <span className="t-sm t-num wb-reparto-fila__valor" title={sub ? `${num(f.valor)} ${sub}` : undefined}>
                {porcentaje ? pct(f.valor, 0) : `${pct(total ? (f.valor / total) * 100 : 0, 0)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Después del vivo ---------- */

function Despues({ datos }: { datos: DatosVivo | null }) {
  const serie = useMemo(() => {
    if (!datos) return [];
    const ultimaDelVivo = [...datos.minutos].reverse().find((m) => m.vistas !== undefined);
    return [...(ultimaDelVivo ? [ultimaDelVivo] : []), ...datos.despues]
      .filter((m) => m.vistas !== undefined)
      .sort((x, y) => +new Date(x.t) - +new Date(y.t));
  }, [datos]);

  if (serie.length < 2) {
    return (
      <Empty
        icono={<Activity size={22} />}
        titulo="Todavía no hay cómo seguir la grabación"
        texto="Después del vivo se guardan las vistas, likes y comentarios cada hora la primera semana, y una vez por día hasta el mes. Cuando haya dos fotos, acá se ve cómo crecen."
      />
    );
  }
  const primera = serie[0];
  const ultima = serie[serie.length - 1];
  const dif = (k: "vistas" | "likes" | "comentarios") => (ultima[k] ?? 0) - (primera[k] ?? 0);
  return (
    <div className="stack-4">
      <div className="wb-vivo__kpis">
        <Kpi etiqueta="Vistas" valor={num(ultima.vistas ?? 0)} sub={`+${num(dif("vistas"))} desde ${diaYHora(primera.t)} hs`} />
        <Kpi etiqueta="Me gusta" valor={ultima.likes !== undefined ? num(ultima.likes) : "Ocultos"} sub={ultima.likes !== undefined ? `+${num(dif("likes"))}` : undefined} />
        <Kpi etiqueta="Comentarios" valor={ultima.comentarios !== undefined ? num(ultima.comentarios) : "Cerrados"} sub={ultima.comentarios !== undefined ? `+${num(dif("comentarios"))}` : undefined} />
      </div>
      <AreaChart
        serie="Vistas" formato={(n) => num(n)}
        datos={serie.map((m) => ({ etiqueta: diaCorto(m.t), completo: `${diaYHora(m.t)} hs`, valor: m.vistas ?? 0 }))}
      />
      <p className="t-sm t-subtle">Última foto {relativo(ultima.t)}.</p>
    </div>
  );
}
