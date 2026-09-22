"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { Chip, Input } from "@/components/ui/ui";
import { acciones } from "@/lib/store";
import { idDeYoutube, miniaturaDe } from "@/lib/youtube";
import type { Webinar } from "@/lib/types";
import { fechaCompleta, hoyArgentina, isoDesdeArgentina, sumarDias } from "./fechas";
import { tituloDeYoutube } from "./useYoutube";

/* ==================================================================
   Nuevo webinar, una pregunta por pantalla.

   Sólo lo que se sabe al crearlo: cómo se llama, cuándo es y, si ya
   está, el link de YouTube. Los números (inversión, formularios,
   llamadas) no se preguntan acá: se van cargando en la planilla y en
   la ficha a medida que pasan, que es como se viven.
   ================================================================== */

const PASOS = [
  { id: "titulo", titulo: "Título" },
  { id: "fecha", titulo: "Fecha y hora" },
  { id: "youtube", titulo: "YouTube" },
];

const HORAS = ["18:00", "19:00", "20:00", "21:00"];

export function AsistenteWebinar({ onCerrar, onCreado }: {
  onCerrar: () => void;
  onCreado: (id: string, titulo: string) => void;
}) {
  const hoy = hoyArgentina();
  const [paso, setPaso] = useState(0);
  const [titulo, setTitulo] = useState("");
  /* Uno cada quince días: el que viene suele caer en dos semanas. */
  const [dia, setDia] = useState(() => sumarDias(hoy, 14));
  const [hora, setHora] = useState("19:00");
  const [link, setLink] = useState("");
  const creado = useRef(false);

  const idVideo = idDeYoutube(link);
  const fecha = isoDesdeArgentina(dia, hora);

  /* El título del video, para confirmar que se pegó el que se quería.
     undefined = buscando; null = no se pudo confirmar. */
  const [video, setVideo] = useState<{ id: string; titulo: string | null } | null>(null);
  useEffect(() => {
    if (!idVideo) return;
    let vivo = true;
    tituloDeYoutube(idVideo).then((t) => { if (vivo) setVideo({ id: idVideo, titulo: t }); });
    return () => { vivo = false; };
  }, [idVideo]);
  const tituloVideo = video?.id === idVideo ? video.titulo : undefined;

  const problema = useMemo(() => {
    if (paso === 0) return titulo.trim().length >= 3 ? null : "Escribí el título del webinar";
    if (paso === 1) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "Elegí el día";
      if (!/^\d{2}:\d{2}$/.test(hora)) return "Elegí la hora";
      return fecha ? null : "Esa fecha no existe";
    }
    return link.trim() === "" || idVideo ? null : "Ese link no es de un video de YouTube";
  }, [paso, titulo, dia, hora, fecha, link, idVideo]);

  function crear() {
    /* Enter dos veces seguidas en el último paso no puede crear dos. */
    if (creado.current) return;
    creado.current = true;
    const nuevo: Omit<Webinar, "id"> = {
      titulo: titulo.trim(),
      fecha,
      duracionMin: 75,
      /* Si ya pasó, no está "programado": pasa al cargar los webinars viejos
         de la planilla de Yari. */
      estado: new Date(fecha).getTime() < Date.now() ? "finalizado" : "programado",
      registrados: 0, asistentes: 0, inversion: 0, inversionDmAds: 0, costoWhatsappApi: 0,
      formularios: 0, grupoWpp: 0,
      llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0,
      llamadasInasistidas: 0, llamadasNoCalificadas: 0, llamadasCalificadas: 0,
      enlaceRegistro: "", enlaceReplay: "", notas: "",
      /* Vacío va sin la clave: hasta que corra el SQL, mandar la columna
         haría que la cola la tenga que sacar y reintentar. */
      youtubeUrl: idVideo ? link.trim() : undefined,
      creadoEn: new Date().toISOString(),
      extra: {},
    };
    const id = acciones.crear<Webinar>("webinars", nuevo, nuevo.titulo);
    onCreado(id, nuevo.titulo);
  }

  const atajos = [
    { texto: "Hoy", dia: hoy },
    { texto: "Mañana", dia: sumarDias(hoy, 1) },
    { texto: "En una semana", dia: sumarDias(hoy, 7) },
    { texto: "En dos semanas", dia: sumarDias(hoy, 14) },
  ];

  return (
    <Asistente
      etiqueta="Nuevo webinar"
      pasos={PASOS}
      actual={paso}
      onCambiarPaso={setPaso}
      problema={problema}
      onCerrar={onCerrar}
      terminarTexto={link.trim() ? "Crear webinar" : "Crear sin el link"}
      onTerminar={crear}
    >
      {paso === 0 && (
        <>
          <Pregunta texto="¿Cómo se llama el webinar?" sub="El título con el que lo anunciás. Lo podés cambiar después." />
          <Input
            value={titulo} onChange={(ev) => setTitulo(ev.target.value)} maxLength={160}
            placeholder="Cómo conseguir tu primer trabajo remoto en USA" aria-label="Título del webinar"
          />
        </>
      )}

      {paso === 1 && (
        <>
          <Pregunta texto="¿Qué día y a qué hora es el vivo?" sub="En hora de Argentina." />
          <div className="form-grid">
            <div className="hk-field">
              <label className="hk-label" htmlFor="wb-nuevo-dia">Día</label>
              <Input id="wb-nuevo-dia" type="date" value={dia} onChange={(ev) => setDia(ev.target.value)} />
            </div>
            <div className="hk-field">
              <label className="hk-label" htmlFor="wb-nuevo-hora">Hora</label>
              <Input id="wb-nuevo-hora" type="time" step={300} value={hora} onChange={(ev) => setHora(ev.target.value)} />
            </div>
          </div>
          <div className="row-wrap">
            {atajos.map((a) => (
              <Chip key={a.texto} activo={dia === a.dia} onClick={() => setDia(a.dia)}>{a.texto}</Chip>
            ))}
          </div>
          <div className="row-wrap">
            {HORAS.map((h) => (
              <Chip key={h} activo={hora === h} onClick={() => setHora(h)}>{h} hs</Chip>
            ))}
          </div>
          {fecha && <p className="t-body t-muted">{fechaCompleta(fecha)}</p>}
        </>
      )}

      {paso === 2 && (
        <>
          <Pregunta
            texto="¿Tenés el link de YouTube?"
            sub="El del vivo o el de la grabación. Si todavía no está, dejalo vacío y lo pegás después en la ficha del webinar."
          />
          <Input
            icono={<Link2 size={18} />} value={link} onChange={(ev) => setLink(ev.target.value)}
            placeholder="https://youtube.com/live/…" inputMode="url" autoComplete="off"
            aria-label="Link de YouTube"
          />
          {idVideo && (
            <div className="wb-previa">
              {/* eslint-disable-next-line @next/next/no-img-element -- miniatura pública de YouTube, sin optimizar */}
              <img src={miniaturaDe(idVideo)} alt="" width={160} height={90} referrerPolicy="no-referrer" />
              <div className="stack-2" style={{ minWidth: 0 }}>
                <span className="t-label">Video</span>
                <span className="t-strong">
                  {tituloVideo === undefined
                    ? "Buscando el título…"
                    : tituloVideo || "No pude confirmar el título. Si el video es público, el link sirve igual."}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </Asistente>
  );
}
