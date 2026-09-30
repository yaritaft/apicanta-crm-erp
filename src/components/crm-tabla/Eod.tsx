"use client";

import React, { useMemo, useState } from "react";
import { Check, ShoppingBag, Star } from "lucide-react";
import { Asistente, Opcion, Pregunta, type PasoAsistente } from "@/components/ui/Asistente";
import { Badge, Button, Chip, Input, Select, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { acciones, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { num } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { miembroDeCloser } from "@/lib/crm";
import { leadDeSesion } from "@/lib/etapas-auto";
import { filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import {
  atajosDeCierre, cambiosDelEod, closersConLlamadas, esDelCloser, faltaEnRespuesta, llamadasDelDia, objecionesDe,
  respuestaDe, TEXTO_RESULTADO, type RespuestaEod,
} from "@/lib/eod";
import type { ResultadoLlamada, Sesion } from "@/lib/types";
import { VARIANTE_RESULTADO } from "./resultado";
import { textoFecha } from "./FiltroColumna";

/* ==================================================================
   El cierre del día (EOD), como un Typeform: una pantalla por llamada.

   Arriba de cada una, lo que ya se sabe de la persona (de dónde vino, el
   ad, el país, qué contestó): no se vuelve a cargar. Abajo, cómo terminó,
   con un clic, y si no cerró, por qué, si hizo la oferta y para cuándo
   estima cerrarlo. Si compró, se carga la venta en el asistente de
   siempre, con la persona y el closer ya elegidos.

   Cada llamada se guarda al pasar a la siguiente: si se cierra a la
   mitad, lo cargado queda. Suma las llamadas de días anteriores que
   quedaron sin cargar (las de las últimas dos semanas).
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const DIAS_PENDIENTES = 14;

const OPCIONES_RESULTADO: { valor: ResultadoLlamada; nombre: string; sub: string }[] = [
  { valor: "compro", nombre: "Compró", sub: "Se carga la venta y pasa a cliente" },
  { valor: "no-compro", nombre: "No compró", sub: "Contás por qué, en dos clics" },
  { valor: "no-vino", nombre: "No se presentó", sub: "Queda como que no vino" },
  { valor: "reprogramo", nombre: "Se reprogramó", sub: "La agenda nueva entra sola de Calendly" },
];

export function Eod({ onCerrar, soloSesionId }: { onCerrar: () => void; soloSesionId?: string }) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
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
    ...llamadas.map((s) => ({ id: s.id, titulo: (filas.get(s.id)?.nombre || s.invitado || "Llamada").split(" ")[0] })),
    { id: "fin", titulo: "Listo" },
  ];
  const actual = pasos[paso];
  const sesion = llamadas.find((s) => s.id === actual?.id);
  const respuesta = (s: Sesion) => resp[s.id] ?? respuestaDe(ultimaDe(s.id) ?? s);

  function responder(s: Sesion, cambios: Partial<RespuestaEod>) {
    setResp((p) => {
      const previa = p[s.id] ?? respuestaDe(s);
      const nueva = { ...(previa ?? {}), ...cambios } as RespuestaEod;
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
      `Cierre del día${closer ? ` de ${closer}` : ""}: ${TEXTO_RESULTADO[r.resultado]}${r.objecion ? ` (${r.objecion})` : ""}.`);
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
      <div className="stack-2">
        <span className="t-label">¿Qué día?</span>
        <div className="row-wrap" style={{ gap: 8 }}>
          <Chip activo={dia === hoy} onClick={() => onDia(hoy)}>Hoy</Chip>
          <Chip activo={dia === ayer} onClick={() => onDia(ayer)}>Ayer</Chip>
          <div style={{ width: 170 }}>
            <Input type="date" value={dia} max={hoy} aria-label="Otro día" onChange={(ev) => ev.target.value && onDia(ev.target.value)} />
          </div>
        </div>
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

function PasoLlamada({ s, f, hoy, r, objeciones, onResponder, onVender, onSaltear }: {
  s: Sesion; f?: FilaTabla; hoy: string; r?: RespuestaEod; objeciones: string[];
  onResponder: (c: Partial<RespuestaEod>) => void; onVender: () => void; onSaltear: () => void;
}) {
  const nombre = f?.nombre || s.invitado || "la persona";
  const dia = diaDeNegocio(s.inicia);
  const atajos = atajosDeCierre(hoy);
  const datos: [string, string][] = ([
    ["Vía", f?.via ?? ""], ["Ad", f?.ad ?? ""], ["País", f?.pais ?? ""], ["Edad", f?.edad ?? ""],
    ["Tecnologías", f?.tecnologias.join(", ") ?? ""], ["Inglés", f?.ingles ?? ""], ["Experiencia", f?.experiencia ?? ""],
    ["Gana por mes", f?.ingreso ?? ""], ["Puede invertir", f?.inversion ?? ""],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <div className="stack-5">
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

      <Pregunta texto={`¿Cómo terminó la llamada con ${nombre.split(" ")[0]}?`} />
      <div className="opciones">
        {OPCIONES_RESULTADO.map((o, k) => (
          <Opcion key={o.valor} tecla={String(k + 1)} nombre={o.nombre} sub={o.sub} activo={r?.resultado === o.valor}
            onClick={() => onResponder(o.valor === "no-compro" ? { resultado: o.valor } : { resultado: o.valor, objecion: undefined, hizoOferta: undefined, cierreEstimado: undefined })} />
        ))}
      </div>

      {r?.resultado === "compro" && (
        <div className="crm-eod__bloque">
          {f?.venta ? (
            <p className="crm-eod__ok"><Check size={16} /> La venta ya está cargada: {f.venta}. Ya es cliente.</p>
          ) : (
            <>
              <Button variante="primary" icono={<ShoppingBag size={16} />} onClick={onVender}>Cargar la venta</Button>
              <p className="t-sm t-subtle">Se abre el asistente de venta con {nombre.split(" ")[0]} y el closer ya elegidos. Al guardarla pasa a cliente y la llamada queda con cierre. Si la carga otra persona, seguí.</p>
            </>
          )}
        </div>
      )}

      {r?.resultado === "no-compro" && (
        <div className="crm-eod__bloque stack-4">
          <div className="stack-2">
            <span className="t-label">¿Por qué no cerró?</span>
            <div className="row-wrap" style={{ gap: 8 }}>
              {objeciones.map((o) => <Chip key={o} activo={r.objecion === o} onClick={() => onResponder({ objecion: o })}>{o}</Chip>)}
            </div>
          </div>
          <div className="stack-2">
            <span className="t-label">¿Hiciste la oferta?</span>
            <div className="row-wrap" style={{ gap: 8 }}>
              <Chip activo={r.hizoOferta === true} onClick={() => onResponder({ hizoOferta: true })}>Sí</Chip>
              <Chip activo={r.hizoOferta === false} onClick={() => onResponder({ hizoOferta: false })}>No</Chip>
            </div>
          </div>
          <div className="stack-2">
            <span className="t-label">¿Para cuándo estimás cerrarlo?</span>
            <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              {atajos.map((a) => <Chip key={a.texto} activo={r.cierreEstimado === a.valor} onClick={() => onResponder({ cierreEstimado: a.valor })}>{a.texto}</Chip>)}
              <Chip activo={r.cierreEstimado === null} onClick={() => onResponder({ cierreEstimado: null })}>No se va a cerrar</Chip>
              <div style={{ width: 170 }}>
                <Input type="date" value={r.cierreEstimado ?? ""} min={hoy} aria-label="Otra fecha"
                  onChange={(ev) => onResponder({ cierreEstimado: ev.target.value || undefined })} />
              </div>
            </div>
          </div>
        </div>
      )}

      {r && (
        <div className="stack-3" style={{ maxWidth: 620 }}>
          <div className="stack-2">
            <span className="t-label">Nota <span className="t-subtle">(opcional)</span></span>
            <Textarea rows={2} value={r.nota ?? ""} onChange={(ev) => onResponder({ nota: ev.target.value })}
              placeholder={r.resultado === "no-compro" ? "Qué dijo, qué le falta, cuándo lo volvés a llamar…" : "Algo para acordarse"} />
          </div>
          {!s.grabacion && (
            <div className="stack-2">
              <span className="t-label">Link de la grabación <span className="t-subtle">(opcional)</span></span>
              <Input value={r.grabacion ?? ""} onChange={(ev) => onResponder({ grabacion: ev.target.value })} placeholder="https://fathom.video/…" />
            </div>
          )}
        </div>
      )}

      <button type="button" className="link t-sm" style={{ alignSelf: "flex-start" }} onClick={onSaltear}>Saltear esta llamada por ahora</button>
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
          const texto = r ? TEXTO_RESULTADO[r.resultado] : "Sin cargar";
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
