"use client";

import React, { useMemo, useState } from "react";
import { MessageCircle, MessagesSquare, RefreshCw, Search } from "lucide-react";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { Avatar, Badge, Button, Card, CardHead, Chip, Empty, Input, Tabs, type VarianteBadge } from "@/components/ui/ui";
import { num, relativo } from "@/lib/format";
import { useEstado } from "@/lib/store";
import { minutoLegible, nombreCruzable } from "@/lib/vivo";
import { personasDeWebinar } from "@/lib/webinar";
import { partirConLinks, type ComentarioYoutube, type DatosVivo } from "@/lib/youtube";
import type { Webinar } from "@/lib/types";
import { diaYHora } from "./fechas";
import { useComentarios, type useDatosVivo } from "./useVivo";

/* ==================================================================
   Lo que dijo la gente: el chat del vivo y los comentarios del video.

   Cada nombre se cruza con la base: si quien escribió es alguien del
   webinar (se registró, agendó o compró) o un lead, se ve su etapa y se
   abre su ficha. El cruce es por nombre y apellido enteros; un nombre
   solo ("Juan") no se cruza, porque coincidiría con media base.
   ================================================================== */

type Pestania = "chat" | "comentarios";

interface Conocido { id: string; nombre: string; etiqueta: string; variante: VarianteBadge }

const POR_PAGINA = 60;
const MIN = 60_000;

function useConocidos(w: Webinar): (autor: string) => Conocido | undefined {
  const e = useEstado();
  return useMemo(() => {
    const mapa = new Map<string, Conocido>();
    /* Primero la gente de este webinar, que es la que más importa. */
    for (const p of personasDeWebinar(e, w.id)) {
      const k = nombreCruzable(p.nombre);
      if (!k || mapa.has(k)) continue;
      const etapa = e.etapas.find((x) => x.id === p.etapaId);
      mapa.set(k, {
        id: p.contactoId ?? p.leadId ?? p.id,
        nombre: p.nombre,
        etiqueta: p.facturado > 0 ? "Compró" : etapa?.nombre ?? (p.leadId ? "Lead" : "Pre-lead"),
        variante: p.facturado > 0 ? "success" : etapa?.variante ?? "neutral",
      });
    }
    for (const l of e.leads) {
      const k = nombreCruzable(l.nombre);
      if (!k || mapa.has(k)) continue;
      const etapa = e.etapas.find((x) => x.id === l.etapaId);
      mapa.set(k, { id: l.contactoId ?? l.id, nombre: l.nombre, etiqueta: etapa?.nombre ?? "Lead", variante: etapa?.variante ?? "neutral" });
    }
    for (const c of e.contactos) {
      const k = nombreCruzable(c.nombre);
      if (!k || mapa.has(k)) continue;
      mapa.set(k, { id: c.id, nombre: c.nombre, etiqueta: "En la base", variante: "neutral" });
    }
    return (autor: string) => {
      const k = nombreCruzable(autor);
      return k ? mapa.get(k) : undefined;
    };
  }, [e, w.id]);
}

/* enVivo: mientras el webinar está en el aire va en la columna de la
   derecha, sólo con el chat y los mensajes más nuevos arriba. Después
   vuelve abajo de todo, con el chat y los comentarios. */
export function ConversacionWebinar({ w, videoId, vivo, enVivo, className }: {
  w: Webinar; videoId: string; vivo: ReturnType<typeof useDatosVivo>; enVivo?: boolean; className?: string;
}) {
  const datos = vivo.estado === "listo" ? vivo.datos : null;
  const hayChat = (datos?.chat.length ?? 0) > 0;
  /* Mientras nadie elija, se muestra el chat si hay (en un vivo, llega
     unos minutos después de abrir la ficha) y si no, los comentarios. */
  const [elegida, setPestania] = useState<Pestania | null>(null);
  const pestania: Pestania = elegida ?? (hayChat ? "chat" : "comentarios");
  const comentarios = useComentarios(videoId);
  const conocido = useConocidos(w);

  const nComentarios = comentarios.estado === "listo"
    ? comentarios.datos.comentarios.reduce((s, c) => s + 1 + c.respuestas.length, 0)
    : null;

  if (enVivo) {
    return (
      <Card className={`wb-charla wb-charla--vivo${className ? ` ${className}` : ""}`}>
        <CardHead
          titulo="Chat en vivo"
          sub="Los mensajes más nuevos arriba, con quién es cada uno en la base"
          /* Sólo el punto: un número acá se leía como "gente chateando ahora". */
          acciones={<span className="vivo-punto" role="img" aria-label="En vivo" title="En vivo" />}
        />
        <Chat w={w} datos={datos} cargando={vivo.estado === "cargando"} conocido={conocido} enVivo />
      </Card>
    );
  }

  return (
    <Card className={`wb-charla${className ? ` ${className}` : ""}`}>
      <CardHead
        titulo="Lo que dijo la gente"
        sub="El chat del vivo y los comentarios del video, con quién es cada uno en la base"
      />
      <div className="wb-vivo__tabs">
        <Tabs<Pestania>
          valor={pestania} onChange={setPestania}
          opciones={[
            { valor: "chat", texto: `Chat del vivo${datos ? ` · ${num(datos.chatTotal)}` : ""}` },
            { valor: "comentarios", texto: `Comentarios${nComentarios !== null ? ` · ${num(nComentarios)}` : ""}` },
          ]}
        />
      </div>
      {pestania === "chat"
        ? <Chat w={w} datos={datos} cargando={vivo.estado === "cargando"} conocido={conocido} />
        : <Comentarios estado={comentarios} conocido={conocido} />}
    </Card>
  );
}

/* ---------- Chat ---------- */

function Chat({ w, datos, cargando, conocido, enVivo }: {
  w: Webinar; datos: DatosVivo | null; cargando: boolean; conocido: (a: string) => Conocido | undefined; enVivo?: boolean;
}) {
  const [q, setQ] = useState("");
  const [preguntas, setPreguntas] = useState(false);
  const [conocidos, setConocidos] = useState(false);
  const [enPitch, setEnPitch] = useState(false);
  const [autor, setAutor] = useState<string | null>(null);
  const [cuantos, setCuantos] = useState(POR_PAGINA);

  const chat = datos?.chat ?? [];
  const inicio = datos?.estado.inicio ?? chat[0]?.t;
  const minDe = (t: string) => (inicio ? Math.max(0, Math.floor((+new Date(t) - +new Date(inicio)) / MIN)) : 0);

  const resumen = useMemo(() => {
    const porAutor = new Map<string, { autor: string; n: number; foto?: string }>();
    for (const m of chat) {
      const k = m.autorCanalId ?? m.autor;
      const x = porAutor.get(k) ?? { autor: m.autor, n: 0, foto: m.foto };
      x.n++;
      porAutor.set(k, x);
    }
    const autores = [...porAutor.values()];
    return {
      personas: autores.length,
      conocidas: autores.filter((a) => conocido(a.autor)).length,
      top: autores.filter((a) => !chat.find((m) => m.autor === a.autor)?.esDueno).sort((a, b) => b.n - a.n).slice(0, 6),
      preguntas: chat.filter((m) => m.texto.includes("?")).length,
      superChats: chat.filter((m) => m.monto).length,
    };
  }, [chat, conocido]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pitch = w.pitchEn ? +new Date(w.pitchEn) : null;
    const lista = chat.filter((m) =>
      (!t || m.texto.toLowerCase().includes(t) || m.autor.toLowerCase().includes(t))
      && (!preguntas || m.texto.includes("?"))
      && (!conocidos || conocido(m.autor))
      && (!enPitch || (pitch !== null && +new Date(m.t) >= pitch))
      && (!autor || m.autor === autor));
    /* En vivo, lo último que se escribió es lo que importa: arriba. */
    return enVivo ? lista.reverse() : lista;
  }, [chat, q, preguntas, conocidos, enPitch, autor, conocido, w.pitchEn, enVivo]);

  if (cargando && !datos) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" aria-label="Trayendo el chat" />;
  if (chat.length === 0) {
    return (
      <Empty
        icono={<MessagesSquare size={22} />}
        titulo="No hay chat guardado de este vivo"
        texto={datos?.estado.errorChat
          ? `No se pudo leer el chat: ${datos.estado.errorChat}`
          : "El chat se guarda solo mientras el vivo está en el aire: YouTube no lo da cuando termina. En el próximo webinar queda acá, mensaje por mensaje."}
      />
    );
  }

  const lista = (
    <Lista
      vacio="Ningún mensaje coincide con los filtros."
      items={filtrados.slice(0, cuantos).map((m) => ({
        id: m.id, autor: m.autor, foto: m.foto, texto: m.texto, cuando: `${minutoLegible(minDe(m.t))} · ${diaYHora(m.t).split(" · ")[1]} hs`,
        marca: m.esDueno ? "Canal" : m.esModerador ? "Moderador" : m.monto ? `Super Chat ${m.monto}` : undefined,
        conocido: conocido(m.autor),
      }))}
    />
  );
  const masBoton = filtrados.length > cuantos && (
    <div><Button variante="secondary" onClick={() => setCuantos((c) => c + POR_PAGINA * 2)}>Mostrar más ({num(filtrados.length - cuantos)} quedan)</Button></div>
  );

  /* En vivo, sólo los mensajes: el resumen, los que más escribieron y los
     filtros ocupaban lugar mientras se mira el vivo. Vuelven cuando termina. */
  if (enVivo) return <div className="stack-3">{lista}{masBoton}</div>;

  const cortado = datos && datos.chatTotal > chat.length;
  return (
    <div className="stack-4">
      <p className="t-sm t-muted t-num">
        {num(chat.length)} mensajes de {num(resumen.personas)} personas · {num(resumen.conocidas)} están en la base
        · {num(resumen.preguntas)} preguntas{resumen.superChats ? ` · ${num(resumen.superChats)} Super Chats` : ""}
        {cortado ? ` · se muestran los primeros ${num(chat.length)} de ${num(datos.chatTotal)}` : ""}
      </p>

      {resumen.top.length > 0 && (
        <div className="stack-2">
          <span className="t-label">Los que más escribieron</span>
          <div className="row-wrap">
            {resumen.top.map((a) => (
              <Chip key={a.autor} activo={autor === a.autor} count={a.n} onClick={() => { setAutor(autor === a.autor ? null : a.autor); setCuantos(POR_PAGINA); }}>
                {a.autor}{conocido(a.autor) ? " · en la base" : ""}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Input icono={<Search size={18} />} value={q} onChange={(ev) => { setQ(ev.target.value); setCuantos(POR_PAGINA); }}
          placeholder="Buscá en el chat…" aria-label="Buscar en el chat" />
        <Chip activo={preguntas} onClick={() => setPreguntas((v) => !v)}>Preguntas</Chip>
        <Chip activo={conocidos} onClick={() => setConocidos((v) => !v)}>En la base</Chip>
        {w.pitchEn && <Chip activo={enPitch} onClick={() => setEnPitch((v) => !v)}>Desde el pitch</Chip>}
      </div>

      {lista}
      {masBoton}
    </div>
  );
}

/* ---------- Comentarios ---------- */

function Comentarios({ estado, conocido }: {
  estado: ReturnType<typeof useComentarios>; conocido: (a: string) => Conocido | undefined;
}) {
  const [q, setQ] = useState("");
  const [preguntas, setPreguntas] = useState(false);
  const [conocidos, setConocidos] = useState(false);
  const [orden, setOrden] = useState<"nuevos" | "likes">("nuevos");
  const [cuantos, setCuantos] = useState(POR_PAGINA);

  const lista = estado.estado === "listo" ? estado.datos.comentarios : [];
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    const coincide = (c: ComentarioYoutube) =>
      (!t || c.texto.toLowerCase().includes(t) || c.autor.toLowerCase().includes(t))
      && (!preguntas || c.texto.includes("?"))
      && (!conocidos || conocido(c.autor));
    return lista
      .filter((c) => coincide(c) || c.respuestas.some(coincide))
      .sort((a, b) => (orden === "likes" ? b.likes - a.likes : +new Date(b.t) - +new Date(a.t)));
  }, [lista, q, preguntas, conocidos, orden, conocido]);

  if (estado.estado === "cargando") return <div className="skeleton" style={{ height: 240 }} aria-busy="true" aria-label="Trayendo los comentarios" />;
  if (estado.estado === "error") {
    return (
      <Empty
        icono={<MessageCircle size={22} />}
        titulo={estado.sinClave ? "Falta conectar YouTube" : "No pude traer los comentarios"}
        texto={estado.error}
        accion={!estado.sinClave ? <Button variante="secondary" icono={<RefreshCw size={15} />} onClick={estado.recargar}>Reintentar</Button> : undefined}
      />
    );
  }
  if (estado.datos.cerrados) {
    return <Empty icono={<MessageCircle size={22} />} titulo="El video tiene los comentarios cerrados" texto="Si los abren en YouTube, aparecen acá solos." />;
  }
  if (lista.length === 0) {
    return <Empty icono={<MessageCircle size={22} />} titulo="Todavía no hay comentarios" texto="Cuando alguien comente el video, aparece acá con su nombre cruzado contra la base." />;
  }

  const personas = new Set(lista.flatMap((c) => [c.autor, ...c.respuestas.map((r) => r.autor)]));
  const enBase = [...personas].filter((a) => conocido(a)).length;
  return (
    <div className="stack-4">
      <p className="t-sm t-muted t-num">
        {num(lista.length)} comentarios de {num(personas.size)} personas · {num(enBase)} están en la base
        {estado.datos.cortado ? " · se muestran los 1.000 más nuevos" : ""}
      </p>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Input icono={<Search size={18} />} value={q} onChange={(ev) => { setQ(ev.target.value); setCuantos(POR_PAGINA); }}
          placeholder="Buscá en los comentarios…" aria-label="Buscar en los comentarios" />
        <Chip activo={preguntas} onClick={() => setPreguntas((v) => !v)}>Preguntas</Chip>
        <Chip activo={conocidos} onClick={() => setConocidos((v) => !v)}>En la base</Chip>
        <Chip activo={orden === "likes"} onClick={() => setOrden((o) => (o === "likes" ? "nuevos" : "likes"))}>Más votados</Chip>
      </div>
      <div className="wb-charla__lista">
        {filtrados.length === 0 && <p className="t-sm t-subtle">Ningún comentario coincide con los filtros.</p>}
        {filtrados.slice(0, cuantos).map((c) => <HiloComentario key={c.id} c={c} conocido={conocido} />)}
      </div>
      {filtrados.length > cuantos && (
        <div><Button variante="secondary" onClick={() => setCuantos((n) => n + POR_PAGINA)}>Mostrar más ({num(filtrados.length - cuantos)} quedan)</Button></div>
      )}
    </div>
  );
}

function HiloComentario({ c, conocido }: { c: ComentarioYoutube; conocido: (a: string) => Conocido | undefined }) {
  const [abierto, setAbierto] = useState(false);
  const item = (x: ComentarioYoutube) => ({
    id: x.id, autor: x.autor, foto: x.foto, texto: x.texto,
    cuando: `${relativo(x.t)}${x.editado ? " · editado" : ""}${x.likes ? ` · ${num(x.likes)} me gusta` : ""}`,
    conocido: conocido(x.autor),
  });
  return (
    <div className="wb-charla__hilo">
      <Mensaje {...item(c)} />
      {c.respuestas.length > 0 && (
        <div className="wb-charla__respuestas">
          <button type="button" className="link t-sm" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
            {abierto ? "Ocultar respuestas" : `Ver ${num(c.respuestas.length)} ${c.respuestas.length === 1 ? "respuesta" : "respuestas"}`}
          </button>
          {abierto && c.respuestas.map((r) => <Mensaje key={r.id} {...item(r)} />)}
        </div>
      )}
    </div>
  );
}

/* ---------- Un mensaje ---------- */

interface ItemMensaje { id: string; autor: string; foto?: string; texto: string; cuando: string; marca?: string; conocido?: Conocido }

function Lista({ items, vacio }: { items: ItemMensaje[]; vacio: string }) {
  if (items.length === 0) return <p className="t-sm t-subtle">{vacio}</p>;
  return <div className="wb-charla__lista">{items.map((m) => <Mensaje key={m.id} {...m} />)}</div>;
}

function Mensaje({ autor, foto, texto, cuando, marca, conocido }: ItemMensaje) {
  const abrirFicha = useAbrirFicha();
  return (
    <div className="wb-charla__msj">
      {foto
        /* eslint-disable-next-line @next/next/no-img-element -- avatar público de YouTube */
        ? <img src={foto} alt="" width={32} height={32} className="wb-canal__avatar wb-charla__avatar" referrerPolicy="no-referrer" loading="lazy" />
        : <Avatar nombre={autor} size={32} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="wb-charla__cabeza">
          <span className="t-strong truncate">{autor}</span>
          {marca && <Badge variante={marca.startsWith("Super") ? "warning" : "neutral"}>{marca}</Badge>}
          {conocido && (
            <button type="button" className="wb-charla__conocido" onClick={() => abrirFicha(conocido.id)}
              title={`Es ${conocido.nombre}: abrir su ficha`}>
              <Badge variante={conocido.variante}>{conocido.etiqueta}</Badge>
            </button>
          )}
          <span className="t-sm t-subtle t-num wb-charla__cuando">{cuando}</span>
        </div>
        <p className="wb-charla__texto">
          {partirConLinks(texto).map((p, i) =>
            p.url
              ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="link">{p.texto}</a>
              : <React.Fragment key={i}>{p.texto}</React.Fragment>)}
        </p>
      </div>
    </div>
  );
}

