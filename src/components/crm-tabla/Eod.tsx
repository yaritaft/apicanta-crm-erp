"use client";

import React, { useMemo, useRef, useState } from "react";
import { Check, ShoppingBag, Star } from "lucide-react";
import { Asistente, Pregunta, type PasoAsistente } from "@/components/ui/Asistente";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { num } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { miembroDeCloser } from "@/lib/crm";
import { leadDeSesion } from "@/lib/etapas-auto";
import { filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import {
  atajosDeCierre, cambiosDelEod, closersConLlamadas, esDelCloser, estadoPorResultado, faltaEnRespuesta, llamadasDelDia, objecionesDe,
  respuestaDe, TEXTO_ESTADO, TEXTO_RESULTADO, type RespuestaEod,
} from "@/lib/eod";
import type { EstadoSesion, ResultadoLlamada, Sesion } from "@/lib/types";
import { VARIANTE_RESULTADO } from "./resultado";
import { textoFecha } from "./FiltroColumna";
import { GrabacionDeLlamada } from "./GrabacionDeLlamada";

/* ==================================================================
   El cierre del día (EOD), como un Typeform: una pantalla por llamada.

   Arriba de cada una, lo que ya se sabe de la persona (de dónde vino, el
   ad, el país, qué contestó): no se vuelve a cargar. Abajo, cómo terminó,
   y si no cerró, por qué, si hizo la oferta y para cuándo estima
   cerrarlo: cada cosa en su desplegable. Si compró, se carga la venta en
   el asistente de siempre, con la persona y el closer ya elegidos.

   Cada llamada se guarda al pasar a la siguiente: si se cierra a la
   mitad, lo cargado queda. Suma las llamadas de días anteriores que
   quedaron sin cargar (las de las últimas dos semanas).
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const DIAS_PENDIENTES = 14;

/* El nombre de pila, escrito como nombre: en Calendly cada uno lo carga
   como quiere («EDISON», «sebastian»). */
const nombreDePila = (nombre: string) => {
  const n = nombre.trim().split(/\s+/)[0] ?? "";
  return n ? n.charAt(0).toLocaleUpperCase("es") + n.slice(1).toLocaleLowerCase("es") : nombre;
};

const OPCIONES_RESULTADO: { valor: ResultadoLlamada; nombre: string; sub: string }[] = [
  { valor: "compro", nombre: "Compró", sub: "Se carga la venta y pasa a cliente" },
  { valor: "no-compro", nombre: "No compró", sub: "Contás por qué, si hiciste la oferta y para cuándo lo ves" },
  { valor: "no-vino", nombre: "No se presentó", sub: "Queda como que no vino" },
  { valor: "reprogramo", nombre: "Se reprogramó", sub: "La agenda nueva entra sola de Calendly" },
];

export function Eod({ onCerrar, soloSesionId }: { onCerrar: () => void; soloSesionId?: string }) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const { esDueno } = useAcceso();
  const hoy = diaDeNegocio(new Date().toISOString());
  const closers = useMemo(() => closersConLlamadas(e), [e]);
  const soyCloser = yo.miembro && closers.includes(yo.miembro.nombre) ? yo.miembro.nombre : "";
  const [closer, setCloser] = useState(soyCloser);
  const [dia, setDia] = useState(hoy);
  const [conPendientes, setConPendientes] = useState(true);
  const [paso, setPaso] = useState(0);
  const [resp, setResp] = useState<Record<string, RespuestaEod>>({});
  const [guardadas, setGuardadas] = useState<Set<string>>(() => new Set());
  const [vendiendo, setVendiendo] = useState<string | null>(null);

  const filas = useMemo(() => new Map<string, FilaTabla>(filasTabla(e).map((f) => [f.id, f])), [e]);
  const ahora = Date.now();

  /* Las llamadas del día que ya empezaron, y las pendientes de antes. */
  const { delDia, pendientes } = useMemo(() => {
    if (soloSesionId) return { delDia: e.sesiones.filter((s) => s.id === soloSesionId), pendientes: [] as Sesion[] };
    if (!closer) return { delDia: [] as Sesion[], pendientes: [] as Sesion[] };
    const desde = new Date(Date.parse(`${dia}T12:00:00Z`) - DIAS_PENDIENTES * 86_400_000).toISOString().slice(0, 10);
    return {
      delDia: llamadasDelDia(e, closer, dia).filter((s) => Date.parse(s.inicia) <= ahora),
      pendientes: e.sesiones
        .filter((s) => {
          const f = filas.get(s.id);
          const d = diaDeNegocio(s.inicia);
          return f?.sinCargar && d < dia && d >= desde && esDelCloser(s, closer, e.equipo);
        })
        .sort((a, b) => a.inicia.localeCompare(b.inicia)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, closer, dia, filas, soloSesionId]);
  /* La lista queda fija mientras se carga: una llamada que se carga no se
     va de la lista (dejaría de estar "sin cargar"). */
  const [fijas, setFijas] = useState<Sesion[] | null>(null);
  const llamadas = fijas ?? [...(conPendientes ? pendientes : []), ...delDia];
  const ultimaDe = (id: string) => e.sesiones.find((s) => s.id === id);

  const conInicio = !soloSesionId;
  const pasos: PasoAsistente[] = [
    ...(conInicio ? [{ id: "inicio", titulo: "Tu día" }] : []),
    ...llamadas.map((s) => ({ id: s.id, titulo: nombreDePila(filas.get(s.id)?.nombre || s.invitado || "Llamada") })),
    { id: "fin", titulo: "Listo" },
  ];
  const actual = pasos[paso];
  const sesion = llamadas.find((s) => s.id === actual?.id);
  const respuesta = (s: Sesion) => resp[s.id] ?? respuestaDe(ultimaDe(s.id) ?? s);

  function responder(s: Sesion, cambios: Partial<RespuestaEod>) {
    setResp((p) => {
      const previa = p[s.id] ?? respuestaDe(s);
      const nueva = { ...(previa ?? {}), ...cambios } as RespuestaEod;
      /* El resultado dice cómo quedó la llamada (hecha, no vino); después se puede cambiar a mano. */
      if (cambios.resultado && cambios.estado === undefined) nueva.estado = estadoPorResultado(cambios.resultado, s.estado);
      return { ...p, [s.id]: nueva };
    });
    setGuardadas((g) => { const n = new Set(g); n.delete(s.id); return n; });
  }

  /* Guardar una llamada: sólo si la respuesta está completa y cambió. */
  function guardar(id: string) {
    const r = resp[id];
    const s = ultimaDe(id);
    if (!r || !s || guardadas.has(id) || faltaEnRespuesta(r)) return false;
    acciones.editarLlamada(id, cambiosDelEod(r, s, e.ajustes, yo.nombre, new Date().toISOString()),
      r.resultado
        ? `Cierre del día${closer ? ` de ${closer}` : ""}: ${TEXTO_RESULTADO[r.resultado]}${r.objecion ? ` (${r.objecion})` : ""}.`
        : `Cierre del día${closer ? ` de ${closer}` : ""}: la llamada quedó como ${TEXTO_ESTADO[r.estado ?? s.estado].toLowerCase()}.`);
    setGuardadas((g) => new Set(g).add(id));
    return true;
  }

  function cambiarPaso(i: number) {
    /* Al salir de "Tu día" la lista queda fija; al volver, se rearma. */
    if (actual?.id === "inicio" && i > paso) setFijas([...(conPendientes ? pendientes : []), ...delDia]);
    if (i === 0 && conInicio) setFijas(null);
    if (sesion && i > paso) guardar(sesion.id);
    setPaso(i);
  }

  function terminar() {
    for (const s of llamadas) guardar(s.id);
    const cargadas = llamadas.filter((s) => resp[s.id] || respuestaDe(ultimaDe(s.id) ?? s)).length;
    toast(soloSesionId ? "Listo: quedó cargado cómo terminó la llamada." : `Día cerrado: ${num(cargadas)} de ${num(llamadas.length)} llamadas cargadas.`);
    onCerrar();
  }

  /* La venta se carga en el asistente de siempre, en lugar del EOD (dos
     asistentes a la vez se pelearían el teclado). Al volver, sigue donde
     estaba. */
  if (vendiendo) {
    const s = ultimaDe(vendiendo);
    const f = filas.get(vendiendo);
    const lead = s ? leadDeSesion(e.leads, s) : undefined;
    return (
      <AsistenteVenta
        cliente={lead && f ? { contactoId: lead.id, nombre: f.nombre, email: f.email } : undefined}
        closerId={s?.anfitrion ? miembroDeCloser(s.anfitrion, e.equipo)?.id : undefined}
        sesionId={vendiendo}
        onCerrar={() => setVendiendo(null)}
        onListo={(_id, nombre) => {
          if (s) responder(s, { resultado: "compro" });
          setVendiendo(null);
          toast(`Venta de ${nombre} registrada: ya es cliente.`);
        }}
      />
    );
  }

  const problema = actual?.id === "inicio"
    ? (!closer ? "Elegí de quién es el día" : llamadas.length === 0 ? "No hay llamadas para cargar" : null)
    : sesion ? faltaEnRespuesta(respuesta(sesion)) : null;

  return (
    <Asistente
      etiqueta="Cerrar el día" pasos={pasos} actual={paso} onCambiarPaso={cambiarPaso}
      problema={problema} onCerrar={() => { if (sesion) guardar(sesion.id); onCerrar(); }}
      terminarTexto={soloSesionId ? "Guardar" : "Terminar el día"} onTerminar={terminar}
    >
      {actual?.id === "inicio" && (
        <Inicio
          closers={closers} closer={closer} fijo={Boolean(soyCloser)} onCloser={setCloser}
          dia={dia} hoy={hoy} onDia={setDia}
          delDia={delDia.length} pendientes={pendientes.length} conPendientes={conPendientes} onConPendientes={setConPendientes}
        />
      )}
      {sesion && (
        <PasoLlamada
          key={sesion.id} s={ultimaDe(sesion.id) ?? sesion} f={filas.get(sesion.id)} hoy={hoy}
          r={respuesta(sesion)} objeciones={objecionesDe(e.ajustes)}
          onResponder={(c) => responder(sesion, c)}
          buscaEnFathom={esDueno || Boolean(yo.miembro && esDelCloser(sesion, yo.miembro.nombre, e.equipo))}
          onVender={() => setVendiendo(sesion.id)}
          onSaltear={() => setPaso(paso + 1)}
        />
      )}
      {actual?.id === "fin" && (
        <Fin llamadas={llamadas.map((s) => ({ s, f: filas.get(s.id), r: respuesta(s) }))} />
      )}
    </Asistente>
  );
}

/* ---------- Tu día ---------- */

function Inicio({ closers, closer, fijo, onCloser, dia, hoy, onDia, delDia, pendientes, conPendientes, onConPendientes }: {
  closers: string[]; closer: string; fijo: boolean; onCloser: (c: string) => void;
  dia: string; hoy: string; onDia: (d: string) => void;
  delDia: number; pendientes: number; conPendientes: boolean; onConPendientes: (v: boolean) => void;
}) {
  const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  /* «Otro día» deja el desplegable ahí aunque se elija justo hoy o ayer. */
  const [otroDia, setOtroDia] = useState(dia !== hoy && dia !== ayer);
  return (
    <div className="stack-5">
      <Pregunta texto={fijo ? `Cerrá tu día, ${closer.split(" ")[0]}` : "¿De quién es el día?"}
        sub="Pasás por cada llamada y contás cómo terminó. Lo demás (quién es, de dónde vino, qué contestó) ya lo sabe la app." />
      {!fijo && (
        <div style={{ maxWidth: 360 }}>
          <Select value={closer} placeholder="Elegí el closer" aria-label="Closer" onChange={(ev) => onCloser(ev.target.value)}
            opciones={closers.map((c) => ({ valor: c, texto: c }))} />
        </div>
      )}
      <div className="crm-eod__campos" style={{ maxWidth: 420 }}>
        <div className="crm-eod__campo">
          <span className="t-label">¿Qué día?</span>
          <Select
            aria-label="Qué día" value={otroDia ? "otro" : dia === ayer ? "ayer" : "hoy"}
            opciones={[
              { valor: "hoy", texto: `Hoy (${textoFecha(hoy)})` },
              { valor: "ayer", texto: `Ayer (${textoFecha(ayer)})` },
              { valor: "otro", texto: "Otro día…" },
            ]}
            onChange={(ev) => {
              const v = ev.target.value;
              setOtroDia(v === "otro");
              if (v !== "otro") onDia(v === "ayer" ? ayer : hoy);
            }}
          />
        </div>
        {otroDia && (
          <div className="crm-eod__campo">
            <span className="t-label">¿Cuál?</span>
            <Input type="date" value={dia} max={hoy} aria-label="Otro día" onChange={(ev) => ev.target.value && onDia(ev.target.value)} />
          </div>
        )}
      </div>
      {closer && (
        <div className="crm-eod__cuenta">
          <span className="crm-eod__numero t-num">{num(delDia + (conPendientes ? pendientes : 0))}</span>
          <span>
            {delDia === 1 ? "llamada" : "llamadas"} del {dia === hoy ? "día" : textoFecha(dia)} para cargar
            {pendientes > 0 && (
              <label className="crm-eod__pendientes">
                <input type="checkbox" checked={conPendientes} onChange={(ev) => onConPendientes(ev.target.checked)} />
                Sumar {num(pendientes)} de días anteriores que quedaron sin cargar
              </label>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- Una llamada ---------- */

function PasoLlamada({ s, f, hoy, r, objeciones, buscaEnFathom, onResponder, onVender, onSaltear }: {
  s: Sesion; f?: FilaTabla; hoy: string; r?: RespuestaEod; objeciones: string[];
  /* Quien atendió la llamada o un dueño: puede buscar su grabación en Fathom. */
  buscaEnFathom: boolean;
  onResponder: (c: Partial<RespuestaEod>) => void; onVender: () => void; onSaltear: () => void;
}) {
  const nombre = f?.nombre || s.invitado || "la persona";
  const dia = diaDeNegocio(s.inicia);
  /* Los atajos del cierre (esta semana, este mes, más adelante), sin
     repetir el día: un domingo que es fin de mes es una sola opción. */
  const atajos = atajosDeCierre(hoy).filter((a, i, xs) => xs.findIndex((b) => b.valor === a.valor) === i);
  const cajaCierre = useRef<HTMLDivElement>(null);
  /* «Otra fecha» deja el desplegable ahí hasta que se elige el día. */
  const [otraFecha, setOtraFecha] = useState(() => typeof r?.cierreEstimado === "string" && !atajos.some((a) => a.valor === r.cierreEstimado));
  const cierre = r?.cierreEstimado;
  const valorCierre = cierre === null ? "nunca" : otraFecha ? "otra" : cierre ?? "";
  const elegido = OPCIONES_RESULTADO.find((o) => o.valor === r?.resultado);
  const datos: [string, string][] = ([
    ["Vía", f?.via ?? ""], ["Ad", f?.ad ?? ""], ["País", f?.pais ?? ""], ["Edad", f?.edad ?? ""],
    ["Tecnologías", f?.tecnologias.join(", ") ?? ""], ["Inglés", f?.ingles ?? ""], ["Experiencia", f?.experiencia ?? ""],
    ["Gana por mes", f?.ingreso ?? ""], ["Puede invertir", f?.inversion ?? ""],
  ] as [string, string][]).filter(([, v]) => v);

  /* Al elegir cómo terminó, la persona y la pregunta se corren a la
     izquierda y lo que sigue (por qué, la oferta, el cierre, la nota)
     aparece a la derecha: todo en una pantalla, sin bajar. */
  return (
    <div className={`crm-eod__paso${r ? " crm-eod__paso--abierto" : ""}`}>
      <div className="crm-eod__izq stack-5">
      <div className="crm-eod__ficha">
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="crm-eod__nombre">{nombre}</span>
          {f?.calificada === "Sí" && <Badge variante="warning"><Star size={12} fill="currentColor" />Calificada</Badge>}
          <span className="t-sm t-subtle t-num">
            {dia === hoy ? "Hoy" : textoFecha(dia)} · {HORA.format(new Date(s.inicia))} hs{s.anfitrion ? ` · ${s.anfitrion}` : ""}
          </span>
        </div>
        {datos.length > 0 && (
          <dl className="crm-eod__datos">
            {datos.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>))}
          </dl>
        )}
      </div>

      <Pregunta texto={`¿Cómo terminó la llamada con ${nombreDePila(nombre)}?`} />
      <div className="crm-eod__campos">
        <div className="crm-eod__campo">
          <span className="t-label">Resultado</span>
          <Select
            aria-label="Cómo terminó la llamada" value={r?.resultado ?? ""} placeholder="Elegí cómo terminó" autoFocus={!r}
            opciones={OPCIONES_RESULTADO.map((o) => ({ valor: o.valor, texto: o.nombre }))}
            onChange={(ev) => {
              const v = ev.target.value as ResultadoLlamada | "";
              if (!v) return;
              onResponder(v === "no-compro" ? { resultado: v } : { resultado: v, objecion: undefined, hizoOferta: undefined, cierreEstimado: undefined });
            }}
          />
          {elegido && <span className="t-sm t-subtle">{elegido.sub}.</span>}
        </div>
        {/* Cómo quedó la llamada: lo pone el resultado y se puede cambiar. */}
        <div className="crm-eod__campo">
          <span className="t-label">Estado de la llamada</span>
          <Select
            aria-label="Estado de la llamada" value={r?.estado ?? s.estado}
            opciones={(Object.keys(TEXTO_ESTADO) as EstadoSesion[]).map((k) => ({ valor: k, texto: TEXTO_ESTADO[k] }))}
            onChange={(ev) => onResponder({ estado: ev.target.value as EstadoSesion })}
          />
        </div>
      </div>

      <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={onSaltear}>Saltear esta llamada por ahora</button>
      </div>

      <div className="crm-eod__der" aria-hidden={!r}>
      <div className="crm-eod__der-caja stack-4">
      {r?.resultado === "compro" && (
        <div className="crm-eod__bloque">
          {f?.venta ? (
            <p className="crm-eod__ok"><Check size={16} /> La venta ya está cargada: {f.venta}. Ya es cliente.</p>
          ) : (
            <>
              <Button variante="primary" icono={<ShoppingBag size={16} />} onClick={onVender}>Cargar la venta</Button>
              <p className="t-sm t-subtle">Se abre el asistente de venta con {nombreDePila(nombre)} y el closer ya elegidos. Al guardarla pasa a cliente y la llamada queda con cierre. Si la carga otra persona, seguí.</p>
            </>
          )}
        </div>
      )}

      {r?.resultado === "no-compro" && (
        <div className="crm-eod__bloque">
          <div className="crm-eod__campos">
            <div className="crm-eod__campo">
              <span className="t-label">¿Por qué no cerró?</span>
              <Select
                aria-label="Por qué no cerró" value={r.objecion ?? ""} placeholder="Elegí la objeción"
                /* Una objeción que ya no está en la lista de Ajustes se sigue viendo. */
                opciones={r.objecion && !objeciones.includes(r.objecion) ? [...objeciones, r.objecion] : objeciones}
                onChange={(ev) => onResponder({ objecion: ev.target.value || undefined })}
              />
            </div>
            <div className="crm-eod__campo">
              <span className="t-label">¿Hiciste la oferta?</span>
              <Select
                aria-label="Hiciste la oferta" value={r.hizoOferta === undefined ? "" : r.hizoOferta ? "si" : "no"} placeholder="Elegí"
                opciones={[{ valor: "si", texto: "Sí" }, { valor: "no", texto: "No" }]}
                onChange={(ev) => onResponder({ hizoOferta: ev.target.value ? ev.target.value === "si" : undefined })}
              />
            </div>
            {/* A lo ancho. Con «Otra fecha» el desplegable se acorta y, en el
                lugar que deja, aparece el día para elegir. */}
            <div className="crm-eod__campo crm-eod__campo--ancho">
              <span className="t-label">¿Para cuándo estimás cerrarlo?</span>
              <div className={`crm-eod__cierre${otraFecha ? " crm-eod__cierre--fecha" : ""}`} ref={cajaCierre}>
              <div className="crm-eod__cierre-cuando">
              <Select
                aria-label="Para cuándo estimás cerrarlo" value={valorCierre} placeholder="Elegí cuándo"
                opciones={[
                  ...atajos.map((a) => ({ valor: a.valor, texto: `${a.texto} (${textoFecha(a.valor)})` })),
                  { valor: "nunca", texto: "No se va a cerrar" },
                  { valor: "otra", texto: "Otra fecha…" },
                ]}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setOtraFecha(v === "otra");
                  /* «Otra fecha» conserva la que ya había, para corregirla. */
                  if (v === "otra") onResponder({ cierreEstimado: typeof cierre === "string" ? cierre : undefined });
                  else onResponder({ cierreEstimado: v === "nunca" ? null : v || undefined });
                  /* El día, a mano en cuanto aparece. */
                  if (v === "otra") window.setTimeout(() => cajaCierre.current?.querySelector<HTMLElement>(".crm-eod__cierre-dia input, .crm-eod__cierre-dia .fecha")?.focus(), 240);
                }}
              />
              </div>
              <div className="crm-eod__cierre-dia" aria-hidden={!otraFecha}>
                {otraFecha && (
                  <Input type="date" value={cierre ?? ""} min={hoy} aria-label="Qué día"
                    onChange={(ev) => onResponder({ cierreEstimado: ev.target.value || undefined })} />
                )}
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {r && (
        <div className="stack-3">
          <div className="stack-2">
            <span className="t-label">Nota <span className="t-subtle">(opcional)</span></span>
            <Textarea rows={2} value={r.nota ?? ""} onChange={(ev) => onResponder({ nota: ev.target.value })}
              placeholder={r.resultado === "no-compro" ? "Qué dijo, qué le falta, cuándo lo volvés a llamar…" : "Algo para acordarse"} />
          </div>
          <GrabacionDeLlamada s={s} valor={r.grabacion ?? s.grabacion ?? ""} buscar={buscaEnFathom} onCambiar={(link) => onResponder({ grabacion: link })} />
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

/* ---------- Listo ---------- */

function Fin({ llamadas }: { llamadas: { s: Sesion; f?: FilaTabla; r?: RespuestaEod }[] }) {
  const cargadas = llamadas.filter((x) => x.r).length;
  return (
    <div className="stack-4">
      <Pregunta texto={cargadas === llamadas.length ? "¡Listo! Día cerrado" : `Cargaste ${num(cargadas)} de ${num(llamadas.length)}`}
        sub={cargadas === llamadas.length ? "Todo queda en el CRM y en la ficha de cada persona." : "Las que salteaste siguen como «Sin cargar»: las podés cargar después."} />
      <div className="crm-eod__resumen">
        {llamadas.map(({ s, f, r }) => {
          const texto = r?.resultado ? TEXTO_RESULTADO[r.resultado] : r?.estado === "cancelada" ? "Cancelada" : "Sin cargar";
          return (
            <div key={s.id} className="crm-eod__fila">
              <span className="truncate t-strong">{f?.nombre || s.invitado}</span>
              <span className="t-sm t-subtle t-num">{HORA.format(new Date(s.inicia))}</span>
              <span className="spacer" />
              {r?.objecion && <span className="t-sm t-subtle truncate">{r.objecion}</span>}
              <Badge variante={VARIANTE_RESULTADO[texto] ?? "neutral"}>{texto}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
