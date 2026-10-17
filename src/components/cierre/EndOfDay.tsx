"use client";

import React, { useMemo, useState } from "react";
import { CalendarCheck, Check, CircleAlert } from "lucide-react";
import { Asistente, Opcion, Pregunta, type PasoAsistente } from "@/components/ui/Asistente";
import { Button, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { num } from "@/lib/format";
import {
  CIERRE_DEL_DIA, NOMBRE_CORTO, RESPUESTAS, claveEod, diasDelEod, pendientesDeAntes, preguntasDelDia, registrosEod,
  type DiaDelEod, type PreguntaDia, type RespuestaDia,
} from "@/lib/eod-finanzas";
import type { Chequeos } from "@/lib/finanzas-pasos";

/* ==================================================================
   El cierre del día de Finanzas (el EOD de Aldana), como el de los closers:
   una pantalla por tarea, y al final el día queda cerrado. La pestaña muestra
   cómo va hoy, los últimos días (cuáles se cerraron y cuáles no) y lo que
   quedó pendiente de antes; «Cerrar el día» abre el asistente.
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const fechaLarga = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fechaCorta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const letraDelDia = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
const nombreDePila = (nombre: string) => nombre.trim().split(/\s+/)[0] ?? "";

interface Props {
  ahora: number;
  esDueno: boolean;
  chequeos: Chequeos;
  marcar: (clave: string, nota?: string, estado?: string) => void;
  /* Una cuenta que sólo mira Finanzas ve los cierres pero no los hace: la base no le dejaría guardarlos. */
  soloMirar?: boolean;
}

export function EndOfDay({ ahora, esDueno, chequeos, marcar, soloMirar = false }: Props) {
  const e = useEstado();
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  const [abierto, setAbierto] = useState<string | null>(null);
  const dias = useMemo(() => diasDelEod(chequeos, ahora, 7), [chequeos, ahora]);
  const deHoy = dias[dias.length - 1];
  const cuantas = useMemo(() => preguntasDelDia(e, hoy, chequeos, { ahora, esDueno }).length, [e, hoy, chequeos, ahora, esDueno]);
  const pendientes = useMemo(() => pendientesDeAntes(e, hoy, chequeos, { ahora, esDueno }), [e, hoy, chequeos, ahora, esDueno]);

  if (abierto) {
    return <CierreDelDia dia={abierto} ahora={ahora} esDueno={esDueno} chequeos={chequeos} marcar={marcar} onCerrar={() => setAbierto(null)} />;
  }

  const cerrado = deHoy.estado === "cerrado";
  return (
    <div className="cm-eod">
      <section className="cm-caja cm-eod__hoy" aria-label="El día de hoy">
        <div className="cm-eod__texto">
          <h3 className="cm-eod__titulo">{cerrado ? "El día de hoy está cerrado" : "Cerrá el día de hoy"}</h3>
          <p className="cm-eod__sub">
            {cerrado
              ? <>Lo cerró <b>{deHoy.cierre?.por ?? "alguien"}</b> a las {HORA.format(new Date(deHoy.cierre!.en))}: {resumenTexto(deHoy)}.</>
              : <>{fechaLarga(hoy)}. Son {num(cuantas)} {cuantas === 1 ? "tarea" : "tareas"}{pendientes.length ? `, ${num(pendientes.length)} de ellas ${pendientes.length === 1 ? "quedó" : "quedaron"} pendiente${pendientes.length === 1 ? "" : "s"} de antes` : ""}. Las contás de a una y el día queda cerrado.</>}
          </p>
        </div>
        {soloMirar ? (
          <span className="cm-eod__sub">Tu cuenta sólo puede mirar Finanzas: el cierre lo hace quien la edita.</span>
        ) : (
          <Button variante={cerrado ? "secondary" : "primary"} icono={cerrado ? <Check size={16} /> : <CalendarCheck size={16} />} onClick={() => setAbierto(hoy)}>
            {cerrado ? "Revisar el día" : "Cerrar el día"}
          </Button>
        )}
      </section>

      <section className="cm-caja" aria-label="Los últimos días">
        <h4 className="cm-caja__tit">Los últimos días</h4>
        <ul className="cm-dias">
          {[...dias].reverse().map((d) => (
            <li key={d.dia}>
              <button type="button" className={`cm-dia cm-dia--${d.estado}`} disabled={soloMirar} onClick={() => setAbierto(d.dia)} aria-label={`${fechaLarga(d.dia)}: ${ESTADO_DEL_DIA[d.estado].toLowerCase()}`}>
                <span className="cm-dia__fecha"><b>{letraDelDia(d.dia)}</b> {d.dia.slice(8, 10)}</span>
                <span className="cm-dia__estado">{ESTADO_DEL_DIA[d.estado]}</span>
                <span className="cm-dia__resumen">{d.estado === "cerrado" ? resumenCorto(d) : d.estado === "sin-cerrar" && !soloMirar ? "Tocá para cerrarlo" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {pendientes.length > 0 && (
        <section className="cm-caja" aria-label="Lo que quedó pendiente">
          <h4 className="cm-caja__tit">Quedó pendiente de antes <span className="cm-cuenta">{pendientes.length}</span></h4>
          {pendientes.map((p) => (
            <div key={p.id} className="cm-fila">
              <span className="cm-fila__texto">
                <span className="cm-fila__titulo">{p.paso.titulo}</span>
                <span className="cm-fila__sub">Desde el {fechaCorta(p.desde!)}{p.notaAntes ? ` · ${p.notaAntes}` : ""}</span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const ESTADO_DEL_DIA: Record<DiaDelEod["estado"], string> = { cerrado: "Cerrado", hoy: "Hoy", "sin-cerrar": "Sin cerrar", descanso: "Sin registro" };

function resumenCorto(d: DiaDelEod): string {
  return [
    d.hechas ? `${d.hechas} ${d.hechas === 1 ? "hecha" : "hechas"}` : "",
    d.noLlegue ? `${d.noLlegue} ${d.noLlegue === 1 ? "pendiente" : "pendientes"}` : "",
  ].filter(Boolean).join(" · ") || "Sin tareas";
}
function resumenTexto(d: DiaDelEod): string {
  const partes = [
    d.hechas ? `${num(d.hechas)} ${d.hechas === 1 ? "hecha" : "hechas"}` : "",
    d.noLlegue ? `${num(d.noLlegue)} ${d.noLlegue === 1 ? "quedó pendiente" : "quedaron pendientes"}` : "",
    d.noHaciaFalta ? `${num(d.noHaciaFalta)} sin hacer falta` : "",
  ].filter(Boolean);
  return partes.join(", ") || "sin tareas contestadas";
}

/* ---------- El asistente ---------- */

interface Resp { estado?: RespuestaDia; nota?: string }

function CierreDelDia({ dia, ahora, esDueno, chequeos, marcar, onCerrar }: Props & { dia: string; onCerrar: () => void }) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const toast = useToast();
  const hoy = diaDeNegocio(new Date(ahora).toISOString());

  /* La lista queda fija mientras se contesta: lo que se va contestando no cambia las preguntas. */
  const [preguntas] = useState<PreguntaDia[]>(() => preguntasDelDia(e, dia, chequeos, { ahora, esDueno }));
  const [paso, setPaso] = useState(0);
  /* Lo que ya estaba contestado de ese día (si se vuelve a abrir), y lo que se toca ahora. */
  const [resp, setResp] = useState<Record<string, Resp>>(() => {
    const r: Record<string, Resp> = {};
    for (const x of registrosEod(chequeos)) if (x.dia === dia) r[x.tarea] = { estado: x.estado, nota: x.nota };
    return r;
  });
  const [guardadas, setGuardadas] = useState<Set<string>>(() => new Set(registrosEod(chequeos).filter((x) => x.dia === dia).map((x) => x.tarea)));
  const [notaDia, setNotaDia] = useState(() => chequeos[claveEod(dia, CIERRE_DEL_DIA)]?.nota ?? "");

  const pasos: PasoAsistente[] = [
    { id: "inicio", titulo: "Tu día" },
    ...preguntas.map((p) => ({ id: p.id, titulo: NOMBRE_CORTO[p.id] ?? p.paso.titulo })),
    { id: "fin", titulo: "Listo" },
  ];
  const actual = pasos[paso];
  const pregunta = preguntas.find((p) => p.id === actual?.id);

  const responder = (id: string, cambios: Partial<Resp>) => {
    setResp((r) => ({ ...r, [id]: { ...r[id], ...cambios } }));
    setGuardadas((g) => { const n = new Set(g); n.delete(id); return n; });
  };
  const falta = (id: string): string | null => {
    const r = resp[id];
    if (!r?.estado) return "Elegí una opción";
    if (r.estado === "no-llegue" && !r.nota?.trim()) return "Contá por qué no llegaste y para cuándo";
    return null;
  };
  const guardar = (id: string) => {
    const r = resp[id];
    if (!r?.estado || guardadas.has(id)) return;
    marcar(claveEod(dia, id), r.nota?.trim() || undefined, r.estado);
    setGuardadas((g) => new Set(g).add(id));
  };
  const cambiarPaso = (i: number) => {
    if (pregunta && i > paso && !falta(pregunta.id)) guardar(pregunta.id);
    setPaso(i);
  };
  const sinContestar = preguntas.filter((p) => falta(p.id));
  const problema = pregunta ? falta(pregunta.id) : actual?.id === "fin" && sinContestar.length > 0 ? `Falta contestar: ${sinContestar.map((p) => NOMBRE_CORTO[p.id] ?? p.paso.titulo).join(", ")}` : null;

  const terminar = () => {
    for (const p of preguntas) if (!falta(p.id)) guardar(p.id);
    marcar(claveEod(dia, CIERRE_DEL_DIA), notaDia.trim() || undefined, "cerrado");
    const hechas = preguntas.filter((p) => resp[p.id]?.estado === "hecho").length;
    const pendientes = preguntas.filter((p) => resp[p.id]?.estado === "no-llegue").length;
    toast(`${dia === hoy ? "Día cerrado" : `Cerraste el ${fechaCorta(dia)}`}: ${num(hechas)} ${hechas === 1 ? "hecha" : "hechas"}${pendientes ? `, ${num(pendientes)} para mañana` : ""}.`);
    onCerrar();
  };

  return (
    <Asistente
      etiqueta="Cerrar el día de Finanzas" pasos={pasos} actual={paso} onCambiarPaso={cambiarPaso}
      problema={problema} onCerrar={() => { if (pregunta && !falta(pregunta.id)) guardar(pregunta.id); onCerrar(); }}
      terminarTexto="Cerrar el día" onTerminar={terminar}
      salirTexto="Cerrar: lo que contestaste queda guardado"
    >
      {actual?.id === "inicio" && <Inicio dia={dia} hoy={hoy} nombre={nombreDePila(yo.nombre)} preguntas={preguntas} />}
      {pregunta && (
        <PasoTarea
          key={pregunta.id} p={pregunta} r={resp[pregunta.id]}
          onEstado={(estado) => responder(pregunta.id, { estado })} onNota={(nota) => responder(pregunta.id, { nota })}
        />
      )}
      {actual?.id === "fin" && <Fin preguntas={preguntas} resp={resp} nota={notaDia} onNota={setNotaDia} />}
    </Asistente>
  );
}

function Inicio({ dia, hoy, nombre, preguntas }: { dia: string; hoy: string; nombre: string; preguntas: PreguntaDia[] }) {
  const deAntes = preguntas.filter((p) => p.desde).length;
  const semana = preguntas.filter((p) => p.cadencia === "semana").length;
  return (
    <div className="stack-5">
      <Pregunta
        texto={dia === hoy ? `Cerrá tu día${nombre ? `, ${nombre}` : ""}` : `Cerrá el ${fechaLarga(dia)}`}
        sub="Pasás por cada tarea y contás si la hiciste. Lo que no llegues a hacer no se pierde: mañana se vuelve a preguntar."
      />
      <div className="crm-eod__cuenta">
        <span className="crm-eod__numero t-num">{num(preguntas.length)}</span>
        <span>
          {preguntas.length === 1 ? "tarea" : "tareas"} para contar
          {deAntes > 0 && <>: {num(deAntes)} {deAntes === 1 ? "quedó" : "quedaron"} pendiente{deAntes === 1 ? "" : "s"} de antes</>}
          {semana > 0 && <>{deAntes > 0 ? " y" : ":"} {num(semana)} {semana === 1 ? "es" : "son"} de la semana</>}
        </span>
      </div>
    </div>
  );
}

function PasoTarea({ p, r, onEstado, onNota }: { p: PreguntaDia; r?: Resp; onEstado: (e: RespuestaDia) => void; onNota: (n: string) => void }) {
  const calculada = p.paso.tipo !== "manual";
  const sigueFaltando = calculada && r?.estado === "hecho" && p.paso.faltan > 0;
  return (
    <div className="stack-5">
      <Pregunta texto={p.paso.titulo} sub={p.cadencia === "semana" ? "Tarea de la semana" : undefined} />
      {p.desde && (
        <div className="cm-eod__antes" role="note">
          <CircleAlert size={16} aria-hidden />
          <span>Quedó pendiente desde el {fechaCorta(p.desde)}{p.notaAntes ? <>: <i>{p.notaAntes}</i></> : "."}</span>
        </div>
      )}
      <div className="cm-eod__app">
        <span className="t-label">{calculada ? "Lo que ve la app ahora" : "En qué consiste"}</span>
        <p>{p.paso.detalle}</p>
      </div>
      <div className="opciones opciones--lista">
        {RESPUESTAS.map((x, i) => <Opcion key={x.id} tecla={String(i + 1)} nombre={x.nombre} sub={x.sub} activo={r?.estado === x.id} onClick={() => onEstado(x.id)} />)}
      </div>
      {sigueFaltando && (
        <div className="cm-eod__antes" role="note">
          <CircleAlert size={16} aria-hidden />
          <span>La app todavía ve pendientes en esto. Si es porque lo dejaste para después, elegí «No llegué».</span>
        </div>
      )}
      {r?.estado && (
        <div className="stack-2">
          <span className="t-label">{r.estado === "no-llegue" ? "¿Por qué y para cuándo?" : "Una nota (opcional)"}</span>
          <Textarea
            rows={2} value={r.nota ?? ""} onChange={(ev) => onNota(ev.target.value)}
            placeholder={r.estado === "no-llegue" ? "Ej.: faltó el extracto de Mercury, lo hago mañana a primera hora" : "Algo que quieras dejar anotado"}
          />
        </div>
      )}
    </div>
  );
}

function Fin({ preguntas, resp, nota, onNota }: { preguntas: PreguntaDia[]; resp: Record<string, Resp>; nota: string; onNota: (n: string) => void }) {
  const cuenta = (e: RespuestaDia) => preguntas.filter((p) => resp[p.id]?.estado === e).length;
  const pendientes = preguntas.filter((p) => resp[p.id]?.estado === "no-llegue");
  const siguenEnLaApp = preguntas.filter((p) => p.paso.tipo !== "manual" && resp[p.id]?.estado === "hecho" && p.paso.faltan > 0);
  return (
    <div className="stack-5">
      <Pregunta texto="Listo: así quedó el día" sub="Si todo está bien, cerrá el día. Lo pendiente vuelve a preguntarse mañana." />
      <div className="cm-eod__totales">
        <div><b className="t-num">{num(cuenta("hecho"))}</b><span>hechas</span></div>
        <div><b className="t-num">{num(cuenta("no-llegue"))}</b><span>para mañana</span></div>
        <div><b className="t-num">{num(cuenta("no-hacia-falta"))}</b><span>sin hacer falta</span></div>
      </div>
      {pendientes.length > 0 && (
        <div className="cm-eod__lista">
          <span className="t-label">Quedan para mañana</span>
          {pendientes.map((p) => <p key={p.id}><b>{p.paso.titulo}</b>{resp[p.id]?.nota ? ` · ${resp[p.id]!.nota}` : ""}</p>)}
        </div>
      )}
      {siguenEnLaApp.length > 0 && (
        <div className="cm-eod__antes" role="note">
          <CircleAlert size={16} aria-hidden />
          <span>Dijiste «Hecho», pero la app todavía ve pendientes en: {siguenEnLaApp.map((p) => NOMBRE_CORTO[p.id] ?? p.paso.titulo).join(", ")}.</span>
        </div>
      )}
      <div className="stack-2">
        <span className="t-label">¿Algo más del día? (opcional)</span>
        <Textarea rows={2} value={nota} onChange={(ev) => onNota(ev.target.value)} placeholder="Lo que quieras que lea el resto del equipo" />
      </div>
    </div>
  );
}
