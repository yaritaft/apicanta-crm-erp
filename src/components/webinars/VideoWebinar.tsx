"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink, Eye, Link2, MessageCircle, RefreshCw, ThumbsUp, Trash2, Youtube,
} from "lucide-react";
import { Avatar, Badge, Button, Card, Input } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { num, relativo } from "@/lib/format";
import {
  duracionLegible, embebidoDe, idDeYoutube, partirConLinks, videoDe, type DatosYoutube, type VivoDelCanal,
} from "@/lib/youtube";
import { useEstado } from "@/lib/store";
import type { Webinar } from "@/lib/types";
import { diaCorto, diaYHora, partesArgentina } from "./fechas";
import { guardarWebinar } from "./guardar";
import { useVivosDelCanal, useYoutube } from "./useYoutube";

/* ==================================================================
   El video del webinar: el vivo o la grabación, embebido, con lo que
   dice YouTube de él abajo.

   El embebido no depende de nada: con el link alcanza. Los números
   (vistas, likes, comentarios, suscriptores) vienen de /api/youtube, que
   necesita la clave de YouTube; sin ella se ve igual el video, el título
   y el canal, y se avisa qué falta.
   ================================================================== */

export function VideoWebinar({ w, className }: { w: Webinar; className?: string }) {
  const [cambiando, setCambiando] = useState(false);
  /* El link recién pegado: cuando lleguen los datos del video, lo que la
     ficha no sabía (la fecha del vivo) se completa solo. */
  const [recienPegado, setRecienPegado] = useState(false);

  /* Si nunca se cargó el link pero el del replay es de YouTube, se usa ése:
     muchos webinars viejos lo tienen ahí. Un "" guardado es "sin video"
     a propósito (se quitó), y ahí no se busca nada. */
  const propio = idDeYoutube(w.youtubeUrl);
  const delReplay = w.youtubeUrl == null ? idDeYoutube(w.enlaceReplay) : null;
  const id = propio ?? delReplay;

  if (!id || cambiando) {
    return (
      <Card className={className}>
        <PropuestaDeVivo
          w={w}
          onElegir={(v) => {
            guardarWebinar(w, { youtubeUrl: videoDe(v.id) }, `Se enlazó a «${w.titulo}» el vivo de YouTube «${v.titulo}».`);
            setCambiando(false);
            setRecienPegado(true);
          }}
        />
        <PegarLink
          w={w}
          inicial={w.youtubeUrl ?? ""}
          onListo={() => { setCambiando(false); setRecienPegado(true); }}
          onCancelar={cambiando ? () => setCambiando(false) : undefined}
        />
      </Card>
    );
  }

  return (
    <Card className={`wb-video${className ? ` ${className}` : ""}`}>
      <Reproductor id={id} titulo={w.titulo} />
      <InfoVideo
        w={w}
        id={id}
        recienPegado={recienPegado}
        onCompletado={() => setRecienPegado(false)}
        delReplay={Boolean(delReplay)}
        onCambiar={() => setCambiando(true)}
        onQuitar={() => guardarWebinar(w, { youtubeUrl: "" }, `Se sacó el video de YouTube de «${w.titulo}».`)}
      />
    </Card>
  );
}

function Reproductor({ id, titulo }: { id: string; titulo: string }) {
  return (
    <div className="wb-video__marco">
      <iframe
        src={embebidoDe(id)}
        title={`Video de YouTube de «${titulo}»`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        /* Sin referrer YouTube se niega a reproducir el embebido. */
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

function InfoVideo({ w, id, recienPegado, onCompletado, delReplay, onCambiar, onQuitar }: {
  w: Webinar; id: string; recienPegado: boolean; onCompletado: () => void;
  delReplay: boolean; onCambiar: () => void; onQuitar: () => void;
}) {
  const yt = useYoutube(id);
  const toast = useToast();

  /* Recién pegado el link: si YouTube dice cuándo es (o fue) el vivo y la
     ficha tiene otra fecha, manda YouTube. El título no se pisa: se ofrece
     abajo, porque el webinar puede anunciarse con otro nombre. */
  const datosListos = yt.estado === "listo" ? yt.datos : null;
  useEffect(() => {
    if (!recienPegado || !datosListos) return;
    onCompletado();
    const cuando = datosListos.vivo?.inicio ?? datosListos.vivo?.programado;
    if (cuando && Math.abs(new Date(cuando).getTime() - new Date(w.fecha).getTime()) > 30 * 60_000) {
      guardarWebinar(w, { fecha: cuando }, `La fecha de «${w.titulo}» se tomó del vivo en YouTube: ${diaYHora(cuando)}.`);
      toast(`Tomé la fecha del vivo de YouTube: ${diaYHora(cuando)}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- corre una vez por link pegado
  }, [recienPegado, datosListos]);
  /* Sin la clave de YouTube no hay números reales: esto muestra cómo va a
     quedar, con números de ejemplo marcados como tales. */
  const [vistaPrevia, setVistaPrevia] = useState(false);

  const acciones = (
    <div className="row-wrap wb-video__acciones">
      <a href={videoDe(id)} target="_blank" rel="noopener noreferrer" className="hk-btn hk-btn--secondary hk-btn--sm">
        <ExternalLink size={15} />Abrir en YouTube
      </a>
      <Button sm variante="ghost" icono={<Link2 size={15} />} onClick={onCambiar}>
        {delReplay ? "Usar otro link" : "Cambiar link"}
      </Button>
      {yt.estado === "listo" && (
        <Button sm variante="ghost" icono={<RefreshCw size={15} />} onClick={yt.recargar} title="Volver a preguntarle a YouTube">
          Actualizar
        </Button>
      )}
      {!delReplay && (
        <Button sm variante="ghost" icono={<Trash2 size={15} />} onClick={onQuitar}>Quitar</Button>
      )}
    </div>
  );

  if (yt.estado === "cargando" || yt.estado === "sin-video") {
    return (
      <div className="wb-video__info" aria-busy="true" aria-label="Trayendo los datos del video">
        <div className="skeleton" style={{ height: 22, width: "70%" }} />
        <div className="skeleton" style={{ height: 14, width: "40%" }} />
        <div className="wb-cifras">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 58 }} />)}
        </div>
      </div>
    );
  }

  if (yt.estado === "error") {
    return (
      <div className="wb-video__info">
        <p className="t-body" style={{ color: yt.noExiste ? "var(--warning)" : "var(--ink-muted)" }}>{yt.error}</p>
        <div className="row-wrap">
          {!yt.noExiste && <Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={yt.recargar}>Reintentar</Button>}
        </div>
        {acciones}
      </div>
    );
  }

  const d = yt.datos;
  return (
    <div className="wb-video__info">
      <div className="stack-2">
        <div className="row-wrap" style={{ alignItems: "flex-start" }}>
          <h2 className="t-h3 wb-video__titulo">{d.titulo || "Video sin título"}</h2>
          <EstadoVivo d={d} />
        </div>
        <p className="t-sm t-subtle t-num">
          {cuando(d)}
          {d.duracionSeg ? ` · ${duracionLegible(d.duracionSeg)}` : ""}
          {delReplay ? " · es el link del replay" : ""}
        </p>
      </div>

      {d.completo ? (
        <div className="wb-cifras">
          <Cifra icono={<Eye size={15} />} etiqueta="Vistas" valor={d.vistas} />
          <Cifra icono={<ThumbsUp size={15} />} etiqueta="Me gusta" valor={d.likes} siFalta="Ocultos" />
          <Cifra icono={<MessageCircle size={15} />} etiqueta="Comentarios" valor={d.comentarios} siFalta="Cerrados" />
          {/* "Mirando ahora" no va acá: este dato queda media hora en cache y
              contradecía a la barra "En vivo", que pregunta cada 15 segundos. */}
        </div>
      ) : vistaPrevia ? (
        <div className="wb-ejemplo" role="group" aria-label="Vista previa con números de ejemplo">
          <div className="row-wrap" style={{ gap: 8 }}>
            <Badge variante="warning">Ejemplo</Badge>
            <span className="t-sm t-muted" style={{ flex: 1, minWidth: 180 }}>
              Así se va a ver cuando esté la clave de YouTube. Estos números son inventados.
            </span>
            <button type="button" className="link t-sm" onClick={() => setVistaPrevia(false)}>Ocultar</button>
          </div>
          <div className="wb-cifras">
            <Cifra icono={<Eye size={15} />} etiqueta="Vistas" valor={ejemploDe(id).vistas} />
            <Cifra icono={<ThumbsUp size={15} />} etiqueta="Me gusta" valor={ejemploDe(id).likes} />
            <Cifra icono={<MessageCircle size={15} />} etiqueta="Comentarios" valor={ejemploDe(id).comentarios} />
          </div>
        </div>
      ) : null}

      {d.aviso && !vistaPrevia && (
        <p className="wb-aviso t-sm">
          <Youtube size={16} aria-hidden />
          <span style={{ flex: 1 }}>{d.aviso}</span>
          {!d.completo && (
            <button type="button" className="link t-sm" onClick={() => setVistaPrevia(true)}>Ver cómo va a quedar</button>
          )}
        </p>
      )}

      <SugerenciasDelVideo w={w} d={d} />

      <Canal d={d} suscriptoresEjemplo={vistaPrevia && !d.completo ? ejemploDe(id).suscriptores : undefined} />

      {d.descripcion
        ? <Descripcion texto={d.descripcion} />
        : vistaPrevia && !d.completo && (
          <p className="wb-desc wb-desc--ejemplo">
            Acá va la descripción del video tal como está en YouTube, con sus links y sus capítulos.
          </p>
        )}

      {acciones}
    </div>
  );
}

function cuando(d: DatosYoutube): string {
  const v = d.vivo;
  if (v?.estado === "en-vivo") return v.inicio ? `En vivo desde las ${diaYHora(v.inicio).split(" · ")[1]} hs` : "En vivo ahora";
  if (v?.estado === "programado" && v.programado) return `Programado para el ${diaYHora(v.programado)} hs`;
  if (v?.inicio) return `Transmitido el ${diaYHora(v.inicio)} hs`;
  if (d.publicado) return `Publicado el ${diaCorto(d.publicado)} · ${relativo(d.publicado)}`;
  return "YouTube no dice la fecha";
}

function EstadoVivo({ d }: { d: DatosYoutube }) {
  if (d.vivo?.estado === "en-vivo") return <Badge variante="danger">En vivo</Badge>;
  if (d.vivo?.estado === "programado") return <Badge variante="accent">Programado</Badge>;
  return null;
}

function Cifra({ icono, etiqueta, valor, siFalta = "—" }: {
  icono: React.ReactNode; etiqueta: string; valor?: number; siFalta?: string;
}) {
  return (
    <div className="wb-cifra">
      <span className="wb-cifra__etiqueta">{icono}{etiqueta}</span>
      <span className={`wb-cifra__valor t-num${valor === undefined ? " t-subtle" : ""}`}>
        {valor === undefined ? siFalta : num(valor)}
      </span>
    </div>
  );
}

function Canal({ d, suscriptoresEjemplo }: { d: DatosYoutube; suscriptoresEjemplo?: number }) {
  const c = d.canal;
  if (!c.nombre) return null;
  const subs = suscriptoresEjemplo !== undefined
    ? `${num(suscriptoresEjemplo)} suscriptores · ejemplo`
    : c.suscriptoresOcultos
      ? "El canal oculta sus suscriptores"
      : c.suscriptores !== undefined
        ? `${num(c.suscriptores)} suscriptores`
        : d.completo ? "Sin dato de suscriptores" : null;
  const contenido = (
    <>
      {c.avatar
        /* eslint-disable-next-line @next/next/no-img-element -- avatar público de YouTube */
        ? <img src={c.avatar} alt="" width={36} height={36} className="wb-canal__avatar" referrerPolicy="no-referrer" />
        : <Avatar nombre={c.nombre} size={36} />}
      <span style={{ minWidth: 0 }}>
        <span className="t-strong truncate" style={{ display: "block" }}>{c.nombre}</span>
        {subs && <span className="t-sm t-subtle t-num" style={{ display: "block" }}>{subs}</span>}
      </span>
    </>
  );
  return c.url
    ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="wb-canal">{contenido}</a>
    : <div className="wb-canal">{contenido}</div>;
}

/* Números de ejemplo para la vista previa: salen del id del video, así el
   mismo video muestra siempre los mismos y no parecen tirados al azar.
   Son proporciones típicas de un vivo (likes ≈ 4 %, comentarios ≈ 0,6 %). */
function ejemploDe(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const vistas = 1_200 + (h % 18_000);
  return {
    vistas,
    likes: Math.round(vistas * (0.03 + (h % 7) / 400)),
    comentarios: Math.round(vistas * (0.004 + (h % 5) / 1000)),
    suscriptores: 8_000 + (h % 60_000),
  };
}

/* Lo que YouTube sabe del webinar y la ficha todavía no tiene: el título
   con el que se publicó y el día y la hora del vivo (este último, con la
   clave). Se ofrece, no se pisa: puede que se anuncie con otro nombre. */
function SugerenciasDelVideo({ w, d }: { w: Webinar; d: DatosYoutube }) {
  const normal = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const otroTitulo = d.titulo && normal(d.titulo) !== normal(w.titulo) ? d.titulo : null;
  const cuando = d.vivo?.inicio ?? d.vivo?.programado;
  const otraFecha = cuando && Math.abs(new Date(cuando).getTime() - new Date(w.fecha).getTime()) > 30 * 60_000 ? cuando : null;
  if (!otroTitulo && !otraFecha) return null;
  return (
    <div className="row-wrap wb-sugerencias">
      {otroTitulo && (
        <Button sm variante="secondary" onClick={() => guardarWebinar(w, { titulo: otroTitulo }, `«${w.titulo}» pasó a llamarse como en YouTube: «${otroTitulo}».`)}>
          Usar el título de YouTube
        </Button>
      )}
      {otraFecha && (
        <Button sm variante="secondary" onClick={() => guardarWebinar(w, { fecha: otraFecha }, `La fecha de «${w.titulo}» pasó a la del vivo: ${diaYHora(otraFecha)}.`)}>
          Usar la fecha del vivo ({diaYHora(otraFecha)})
        </Button>
      )}
    </div>
  );
}

/* La descripción de un vivo suele ser larga (links, capítulos, redes):
   arranca corta y se abre a pedido. Los links se pueden tocar, pero sólo
   los http(s): el texto viene de afuera. */
function Descripcion({ texto }: { texto: string }) {
  const [abierta, setAbierta] = useState(false);
  const larga = texto.length > 280 || texto.split("\n").length > 5;
  return (
    <div className="stack-2">
      <p className={`wb-desc${larga && !abierta ? " wb-desc--corta" : ""}`}>
        {partirConLinks(texto).map((p, i) =>
          p.url
            ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="link">{p.texto}</a>
            : <React.Fragment key={i}>{p.texto}</React.Fragment>,
        )}
      </p>
      {larga && (
        <button type="button" className="link t-sm" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
          {abierta ? "Mostrar menos" : "Mostrar la descripción completa"}
        </button>
      )}
    </div>
  );
}

/* ---------- Sin video: el vivo de este día, propuesto solo ----------
   Con la clave de YouTube, se buscan los vivos del canal (el que tienen los
   otros webinars) y se propone el del mismo día. Si no hay, los de tres
   días para acá o para allá. Nada se enlaza sin que alguien lo elija. */

function PropuestaDeVivo({ w, onElegir }: { w: Webinar; onElegir: (v: VivoDelCanal) => void }) {
  const e = useEstado();
  const [descartados, setDescartados] = useState<Set<string>>(() => new Set());

  /* Los videos de los otros webinars: de ahí sale el canal, y no se
     proponen de nuevo. Los más recientes primero. */
  const { conocidos, usados } = useMemo(() => {
    const otros = e.webinars
      .filter((x) => x.id !== w.id)
      .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha))
      .map((x) => idDeYoutube(x.youtubeUrl) ?? idDeYoutube(x.enlaceReplay))
      .filter((x): x is string => Boolean(x));
    return { conocidos: [...new Set(otros)].slice(0, 10), usados: new Set(otros) };
  }, [e.webinars, w.id]);

  const vivos = useVivosDelCanal(conocidos);

  if (vivos.estado === "sin-videos") {
    return <p className="wb-propuesta__nota">Cuando algún webinar tenga su link de YouTube, en los demás te propongo solo el vivo de su día.</p>;
  }
  if (vivos.estado === "sin-clave") {
    return <p className="wb-propuesta__nota">Con la clave de YouTube conectada, acá te propongo solo el vivo de este día de tu canal.</p>;
  }
  if (vivos.estado === "cargando") {
    return <p className="wb-propuesta__nota" aria-live="polite">Buscando el vivo de este día en tu canal…</p>;
  }
  if (vivos.estado === "error") return <p className="wb-propuesta__nota">{vivos.error}</p>;

  const { canal } = vivos.datos;
  const dia = partesArgentina(w.fecha).dia;
  const libres = vivos.datos.vivos.filter((v) => !usados.has(v.id) && !descartados.has(v.id));
  const mismoDia = libres.filter((v) => partesArgentina(v.cuando).dia === dia);
  const cerca = mismoDia.length ? [] : libres
    .filter((v) => Math.abs(new Date(v.cuando).getTime() - new Date(w.fecha).getTime()) <= 3 * 86_400_000)
    .slice(0, 3);

  if (mismoDia.length === 0 && cerca.length === 0) {
    return <p className="wb-propuesta__nota">No encontré un vivo cerca del {diaCorto(w.fecha)} en {canal.nombre || "el canal"}. Si ya está, pegá el link abajo.</p>;
  }

  const lista = mismoDia.length ? mismoDia : cerca;
  return (
    <div className="wb-propuesta" aria-live="polite">
      <div className="t-label">
        {mismoDia.length
          ? `Encontré el vivo de este día en ${canal.nombre || "tu canal"}`
          : "No hay un vivo el mismo día. ¿Es alguno de estos?"}
      </div>
      {lista.map((v) => (
        <div className="wb-propuesta__item" key={v.id}>
          {v.miniatura
            /* eslint-disable-next-line @next/next/no-img-element -- miniatura pública de YouTube */
            ? <img src={v.miniatura} alt="" width={160} height={90} referrerPolicy="no-referrer" />
            : <span className="wb-propuesta__sin-img"><Youtube size={22} /></span>}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="t-strong" style={{ display: "block" }}>{v.titulo || "Video sin título"}</span>
            <span className="t-sm t-subtle t-num" style={{ display: "block" }}>
              {v.estado === "programado" ? "Programado para el " : v.estado === "en-vivo" ? "En vivo desde el " : "Transmitido el "}
              {diaYHora(v.cuando)} hs
            </span>
          </span>
          <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Button sm variante="primary" onClick={() => onElegir(v)}>Usar este</Button>
            <Button sm variante="ghost" onClick={() => setDescartados((x) => new Set(x).add(v.id))}>No es este</Button>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Sin video: el lugar para pegar el link ---------- */

function PegarLink({ w, inicial, onListo, onCancelar }: {
  w: Webinar; inicial: string; onListo: () => void; onCancelar?: () => void;
}) {
  const [link, setLink] = useState(inicial);
  const [error, setError] = useState<string | null>(
    inicial && !idDeYoutube(inicial) ? "El link guardado no es de un video de YouTube." : null,
  );
  const id = idDeYoutube(link);

  /* Pegar un link válido alcanza: se guarda solo y aparecen el video y sus
     datos. El botón queda para quien escribe el link a mano. */
  useEffect(() => {
    if (!id || link.trim() === (w.youtubeUrl ?? "").trim()) return;
    const t = window.setTimeout(() => guardar(), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- guardar lee el link de este render
  }, [id, link]);

  function guardar() {
    const limpio = link.trim();
    if (!limpio) { setError("Pegá el link del video."); return; }
    if (!id) { setError("Ese link no es de un video de YouTube. Copialo desde «Compartir», abajo del video."); return; }
    if (limpio !== (w.youtubeUrl ?? "")) {
      guardarWebinar(w, { youtubeUrl: limpio }, `Se agregó el video de YouTube a «${w.titulo}».`);
    }
    onListo();
  }

  return (
    <form className="wb-pegar" onSubmit={(ev) => { ev.preventDefault(); guardar(); }} noValidate>
      <span className="wb-pegar__ico"><Youtube size={24} /></span>
      <div className="stack-2" style={{ alignItems: "center" }}>
        <h2 className="t-h3">Pegá el link del vivo o de la grabación</h2>
        <p className="t-sm t-muted" style={{ maxWidth: "46ch" }}>
          El video queda acá, con su título, la descripción, las vistas, los comentarios y los suscriptores del canal.
        </p>
      </div>
      <div className="wb-pegar__fila">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            icono={<Link2 size={16} />} value={link} error={Boolean(error)} autoFocus={Boolean(onCancelar)}
            onChange={(ev) => { setLink(ev.target.value); setError(null); }}
            placeholder="https://youtube.com/live/…" inputMode="url" autoComplete="off"
            aria-label="Link de YouTube" aria-invalid={Boolean(error)}
          />
        </div>
        <Button type="submit" variante="primary">Guardar</Button>
        {onCancelar && <Button variante="ghost" onClick={onCancelar}>Cancelar</Button>}
      </div>
      <span className={`hk-help${error ? " hk-help--error" : ""}`} aria-live="polite">
        {error ?? (id ? "Es un link de YouTube: guardalo y aparece el video." : "Sirven los de youtube.com, youtu.be, /live/ y /shorts/.")}
      </span>
    </form>
  );
}
