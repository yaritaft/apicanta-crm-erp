"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link2, MessageCircle, Search } from "lucide-react";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { Badge, Chip, Input, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { num } from "@/lib/format";
import { ordenarGrupos, puedeVerWhatsapp, sugerirWebinar } from "@/lib/whatsapp";
import { atarGruposAlCrear, atarSolosAlCrear, useLector } from "@/lib/whatsapp-cliente";
import { idDeYoutube, miniaturaDe, type DatosYoutube } from "@/lib/youtube";
import type { Webinar } from "@/lib/types";
import { fechaCompleta, hoyArgentina, isoDesdeArgentina, partesArgentina, sumarDias } from "./fechas";
import { datosDeYoutube } from "./useYoutube";
import "./whatsapp.css";

/* ==================================================================
   Nuevo webinar, una pregunta por pantalla.

   Arranca por el link de YouTube, si ya está: con él se completan solos
   el título (y, con la clave de YouTube, el día y la hora del vivo), y
   quien carga sólo confirma. Sin link, se escriben a mano. Los números
   (inversión, formularios, llamadas) no se preguntan acá: se van
   cargando en la planilla y en la ficha a medida que pasan.

   Si el lector de WhatsApp ya detectó grupos que no son de ningún webinar, un
   último paso deja elegir el de éste (el que dice su fecha ya viene tildado) y
   queda atado al crearlo. Si todavía no lo armaron, se sigue sin elegir: en
   Webinars aparece un aviso con un clic para atarlo cuando el lector lo vea.
   ================================================================== */

const PASOS = [
  { id: "youtube", titulo: "YouTube" },
  { id: "titulo", titulo: "Título" },
  { id: "fecha", titulo: "Fecha y hora" },
];
const PASO_WHATSAPP = { id: "whatsapp", titulo: "WhatsApp" };

const HORAS = ["18:00", "19:00", "20:00", "21:00"];

/* La hora en pasos de media hora: el desplegable propio, no el reloj nativo. */
const HORARIOS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

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
  const toast = useToast();

  /* Los grupos que el lector detectó y todavía no son de ningún webinar (sólo para quien ve y edita Webinars). */
  const { acceso } = useAcceso();
  const puedeAtar = puedeVerWhatsapp(acceso) && nivelEn(acceso, "webinars") >= 2;
  const lector = useLector(puedeAtar);
  const libres = useMemo(() => (lector.datos?.tablas ? (lector.datos.grupos ?? []).filter((g) => !g.webinarId) : []), [lector.datos]);
  const hayPasoWhatsapp = puedeAtar && libres.length > 0;
  const pasos = hayPasoWhatsapp ? [...PASOS, PASO_WHATSAPP] : PASOS;
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [buscaGrupo, setBuscaGrupo] = useState("");
  const grupoTocado = useRef(false);
  /* Lo que la persona tocó a mano no se pisa con lo que trae YouTube. */
  const tocado = useRef({ titulo: false, fecha: false });

  const idVideo = idDeYoutube(link);
  const fecha = isoDesdeArgentina(dia, hora);

  /* El grupo que dice la fecha de este webinar viene tildado, hasta que la persona toca la lista. */
  const sugeridos = useMemo(
    () => (fecha ? libres.filter((g) => sugerirWebinar(g.nombre, [{ id: "nuevo", titulo, fecha }])?.webinarId === "nuevo") : []),
    [libres, titulo, fecha],
  );
  const claveSugeridos = sugeridos.map((g) => g.id).join("|");
  useEffect(() => {
    if (!grupoTocado.current) setElegidos(new Set(claveSugeridos ? claveSugeridos.split("|") : []));
  }, [claveSugeridos]);
  const listaGrupos = useMemo(() => {
    const es = new Set(sugeridos.map((g) => g.id));
    const q = buscaGrupo.trim().toLowerCase();
    const resto = ordenarGrupos(libres.filter((g) => !es.has(g.id)))
      .sort((a, b) => String(b.creadoEn ?? "").localeCompare(String(a.creadoEn ?? "")));
    return [...ordenarGrupos(sugeridos), ...resto].filter((g) => !q || g.nombre.toLowerCase().includes(q) || es.has(g.id)).slice(0, 60);
  }, [libres, sugeridos, buscaGrupo]);

  /* Los datos del video: confirman que se pegó el que se quería y completan
     solos el título y, si YouTube la da, la fecha del vivo.
     undefined = buscando; null = no se pudo confirmar. */
  const [video, setVideo] = useState<{ id: string; datos: DatosYoutube | null } | null>(null);
  useEffect(() => {
    if (!idVideo) return;
    let vivo = true;
    datosDeYoutube(idVideo).then((datos) => {
      if (!vivo) return;
      setVideo({ id: idVideo, datos });
      if (!datos) return;
      if (datos.titulo && !tocado.current.titulo) setTitulo(datos.titulo);
      const cuando = datos.vivo?.inicio ?? datos.vivo?.programado;
      if (cuando && !tocado.current.fecha) {
        const partes = partesArgentina(cuando);
        if (partes.dia) { setDia(partes.dia); setHora(partes.hora); }
      }
    });
    return () => { vivo = false; };
  }, [idVideo]);
  const datosVideo = video?.id === idVideo ? video.datos : undefined;
  const tituloVideo = datosVideo === undefined ? undefined : datosVideo?.titulo ?? null;
  const fechaDelVideo = Boolean(datosVideo?.vivo?.inicio ?? datosVideo?.vivo?.programado);

  const problema = useMemo(() => {
    if (paso === 0) return link.trim() === "" || idVideo ? null : "Ese link no es de un video de YouTube";
    if (paso === 1) return titulo.trim().length >= 3 ? null : "Escribí el título del webinar";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "Elegí el día";
    if (!/^\d{2}:\d{2}$/.test(hora)) return "Elegí la hora";
    return fecha ? null : "Esa fecha no existe";
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
    /* Los grupos elegidos se atan cuando el webinar ya está en la base (en segundo plano: la ficha se abre ya). Y después se ata solo
       cualquier otro grupo que diga la fecha completa de este webinar («Taller Online 21/10/26 #1»), lo haya tildado alguien o no. */
    const grupos = hayPasoWhatsapp ? [...elegidos] : [];
    void (async () => {
      if (grupos.length) {
        const faltan = await atarGruposAlCrear(grupos, id);
        const hechos = grupos.length - faltan.length;
        if (faltan.length === 0) toast(`${hechos === 1 ? "El grupo de WhatsApp quedó atado" : `Los ${hechos} grupos de WhatsApp quedaron atados`} a «${nuevo.titulo}».`);
        else toast(`No pude atar ${faltan.length === 1 ? "un grupo" : `${faltan.length} grupos`} de WhatsApp: atalo en la ficha del webinar.`, "err");
      }
      if (!puedeAtar) return;
      const solos = (await atarSolosAlCrear(id) ?? []).filter((a) => !grupos.includes(a.grupoId));
      if (solos.length) toast(`${solos.length === 1 ? "Un grupo de WhatsApp más quedó atado solo" : `${solos.length} grupos de WhatsApp más quedaron atados solos`} a «${nuevo.titulo}»: ${solos.length === 1 ? "su nombre dice" : "sus nombres dicen"} la fecha.`);
    })();
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
      pasos={pasos}
      actual={paso}
      onCambiarPaso={setPaso}
      problema={problema}
      onCerrar={onCerrar}
      terminarTexto="Crear webinar"
      onTerminar={crear}
    >
      {paso === 0 && (
        <>
          <Pregunta
            texto="¿Ya tenés el link de YouTube?"
            sub="El del vivo (aunque todavía esté programado) o el de la grabación. Con el link completamos el título solos. Si todavía no está, seguí sin él y lo pegás después."
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
                {datosVideo?.canal.nombre && <span className="t-sm t-subtle">{datosVideo.canal.nombre}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {paso === 1 && (
        <>
          <Pregunta
            texto="¿Cómo se llama el webinar?"
            sub={tituloVideo && titulo === tituloVideo ? "Lo trajimos de YouTube. Cambialo si lo anunciás distinto." : "El título con el que lo anunciás. Lo podés cambiar después."}
          />
          <Input
            value={titulo} onChange={(ev) => { tocado.current.titulo = true; setTitulo(ev.target.value); }} maxLength={160}
            placeholder="Cómo conseguir tu primer trabajo remoto en USA" aria-label="Título del webinar"
          />
        </>
      )}

      {paso === 2 && (
        <>
          <Pregunta
            texto="¿Qué día y a qué hora es el vivo?"
            sub={fechaDelVideo ? "La trajimos de YouTube, en hora de Argentina. Cambiala si no es." : "En hora de Argentina."}
          />
          <div className="form-grid">
            <div className="hk-field">
              <label className="hk-label" htmlFor="wb-nuevo-dia">Día</label>
              <Input id="wb-nuevo-dia" type="date" value={dia}
                onChange={(ev) => { tocado.current.fecha = true; if (ev.target.value) setDia(ev.target.value); }} />
            </div>
            <div className="hk-field">
              <label className="hk-label" htmlFor="wb-nuevo-hora">Hora</label>
              <Select id="wb-nuevo-hora" value={hora} aria-label="Hora del vivo"
                onChange={(ev) => { tocado.current.fecha = true; setHora(ev.target.value); }}
                opciones={(HORARIOS.includes(hora) ? HORARIOS : [hora, ...HORARIOS]).map((h) => ({ valor: h, texto: `${h} hs` }))} />
            </div>
          </div>
          <div className="row-wrap">
            {atajos.map((a) => (
              <Chip key={a.texto} activo={dia === a.dia} onClick={() => { tocado.current.fecha = true; setDia(a.dia); }}>{a.texto}</Chip>
            ))}
          </div>
          <div className="row-wrap">
            {HORAS.map((h) => (
              <Chip key={h} activo={hora === h} onClick={() => { tocado.current.fecha = true; setHora(h); }}>{h} hs</Chip>
            ))}
          </div>
          {fecha && <p className="t-body t-muted">{fechaCompleta(fecha)}</p>}
        </>
      )}

      {paso === 3 && hayPasoWhatsapp && (
        <>
          <Pregunta
            texto="¿Ya armaron el grupo de WhatsApp?"
            sub="El lector detectó estos grupos que todavía no son de ningún webinar. Los que dicen la fecha completa («Taller Online 21/10/26 #1») se atan solos al crearlo, y también los que se armen después (una vez por día); acá podés tildar otros. Si todavía no está, seguí sin elegir."
          />
          <Input icono={<Search size={16} />} value={buscaGrupo} onChange={(ev) => setBuscaGrupo(ev.target.value)} placeholder="Buscar un grupo por su nombre" aria-label="Buscar un grupo" />
          <div className="wb-grupos" role="group" aria-label="Grupos de WhatsApp sin webinar">
            {listaGrupos.length === 0 && <p className="t-sm t-subtle" style={{ padding: "var(--space-3)" }}>Ningún grupo se llama así.</p>}
            {listaGrupos.map((g) => (
              <label key={g.id} className="wb-grupo">
                <input
                  type="checkbox" checked={elegidos.has(g.id)}
                  onChange={() => { grupoTocado.current = true; setElegidos((x) => { const n = new Set(x); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; }); }}
                />
                <MessageCircle size={14} aria-hidden className="wb-grupo__ico" />
                <span className="wb-grupo__nombre">{g.nombre || "Grupo sin nombre"}</span>
                <span className="t-sm t-subtle t-num">{num(g.miembros)} personas</span>
                {sugeridos.some((x) => x.id === g.id) && <Badge variante="success">Dice su fecha</Badge>}
              </label>
            ))}
          </div>
          <p className="t-sm t-subtle">
            {elegidos.size === 0 ? "Ninguno elegido: el webinar se crea sin grupo." : `${elegidos.size === 1 ? "1 grupo elegido" : `${elegidos.size} grupos elegidos`}.`}
          </p>
        </>
      )}
    </Asistente>
  );
}
