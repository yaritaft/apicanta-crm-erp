"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Clock, Minus, NotebookPen } from "lucide-react";
import { Button, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { num } from "@/lib/format";
import {
  CIERRE_DEL_DIA, NOMBRE_CORTO, RESPUESTAS, claveEod, cierreDe, cuentaDelDia, diasDelEod, preguntasConTareas, problemaDeRespuesta,
  registrosEod, respuestasDelDia, sigueFaltandoEnLaApp, tareasDelDia,
  type DiaDelEod, type PreguntaDia, type Respuesta, type RespuestaDia,
} from "@/lib/eod-finanzas";
import type { Chequeos } from "@/lib/finanzas-pasos";

/* ==================================================================
   El cierre del día de Finanzas (el EOD de Aldana) en una sola pantalla.

   Aldana (27/11): «completar el reporte diario me toma mucho tiempo porque
   las pantallas tardan en pasar… ¿tipo que esté en una sola pantalla tipo
   checklist?». Antes era un asistente de una pantalla por tarea, y cada
   «Continuar» recalculaba todo Finanzas cuatro veces. Ahora:
   - arriba los últimos 7 días (cuál se cerró y cuál no): tocar uno lo abre acá;
   - todas las tareas del día en una lista, cada una con lo que ve la app y
     sus tres respuestas a un toque; cada toque se guarda en el momento
     (la misma fila de siempre, `eod|día|tarea`);
   - abajo, fijo, cuántas faltan y «Cerrar el día», que se prende cuando no
     falta ninguna. Las reglas son las de antes: «No llegué» pide el motivo, y
     si dice «Hecho» donde la app todavía ve pendientes, se avisa.
   Lo pesado (lo que ve la app) se calcula una vez por día elegido y por
   minuto; tildar no vuelve a calcularlo.
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const fechaLarga = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const fechaCorta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const letraDelDia = (dia: string) => new Date(`${dia}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
const conMayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  /* El día que se está mirando: hoy, salvo que se toque otro (pasada la medianoche, «hoy» se mueve solo). */
  const [elegido, setElegido] = useState<string | null>(null);
  const dia = elegido && elegido <= hoy ? elegido : hoy;
  const dias = useMemo(() => diasDelEod(chequeos, ahora, 7), [chequeos, ahora]);
  /* Lo que ve la app (lo pesado) depende de lo cargado y del reloj, no de lo que se tilda. */
  const tareas = useMemo(() => tareasDelDia(e, dia, { ahora, esDueno }), [e, dia, ahora, esDueno]);
  const preguntas = useMemo(() => preguntasConTareas(tareas, dia, chequeos), [tareas, dia, chequeos]);

  return (
    <div className="cm-eod">
      <section className="cm-caja" aria-label="Los últimos días">
        <h2 className="cm-caja__tit">Los últimos 7 días</h2>
        <ul className="cm-semana">
          {dias.map((d) => (
            <li key={d.dia}>
              <button
                type="button" className={`cm-dial cm-dial--${d.estado}`} aria-pressed={d.dia === dia} onClick={() => setElegido(d.dia === hoy ? null : d.dia)}
                aria-label={`${fechaLarga(d.dia)}: ${ESTADO_DEL_DIA[d.estado].toLowerCase()}`}
                title={d.estado === "cerrado" ? resumenCorto(d) : d.estado === "sin-cerrar" && !soloMirar ? "Tocá para cerrarlo" : ESTADO_DEL_DIA[d.estado]}
              >
                <span className="cm-dial__dow">{letraDelDia(d.dia)}</span>
                <span className="cm-dial__num">{d.dia.slice(8, 10)}</span>
                <span className="cm-dial__marca" aria-hidden>
                  {d.estado === "cerrado" ? <Check size={15} strokeWidth={2.5} /> : d.estado === "sin-cerrar" ? <CircleAlert size={15} /> : <Minus size={15} />}
                </span>
                <span className="cm-dial__est">{d.estado === "cerrado" ? resumenCorto(d).split(" · ")[0] : ESTADO_DEL_DIA[d.estado]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Un día por vez: lo que se estaba escribiendo de otro día no se mezcla. */}
      <Checklist key={dia} dia={dia} hoy={hoy} preguntas={preguntas} chequeos={chequeos} marcar={marcar} soloMirar={soloMirar} />
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

/* ---------- El día: la lista ---------- */

const ICONO: Record<RespuestaDia, React.ReactNode> = {
  hecho: <Check size={15} strokeWidth={2.5} />,
  "no-llegue": <Clock size={15} />,
  "no-hacia-falta": <Minus size={15} />,
};

interface PropsChecklist {
  dia: string; hoy: string; preguntas: PreguntaDia[]; chequeos: Chequeos;
  marcar: Props["marcar"]; soloMirar: boolean;
}

function Checklist({ dia, hoy, preguntas, chequeos, marcar, soloMirar }: PropsChecklist) {
  const toast = useToast();
  const guardado = useMemo(() => respuestasDelDia(chequeos, dia), [chequeos, dia]);
  /* Lo que todavía no se guardó: un «No llegué» sin el motivo, o una nota a medio escribir. Lo demás se guarda al toque. */
  const [borradores, setBorradores] = useState<Record<string, Respuesta>>({});
  const cierre = cierreDe(chequeos, dia);
  const [notaDia, setNotaDia] = useState(() => cierre?.nota ?? "");
  const lista = useRef<HTMLOListElement>(null);

  const resp = (id: string): Respuesta => {
    const g = guardado[id];
    const b = borradores[id];
    if (!b) return g ?? {};
    return { estado: b.estado ?? g?.estado, nota: b.nota !== undefined ? b.nota : g?.nota };
  };
  const respuestas = Object.fromEntries(preguntas.map((p) => [p.id, resp(p.id)]));
  const cuenta = cuentaDelDia(preguntas, respuestas);
  const sinBorrador = (id: string) => setBorradores((b) => { if (!(id in b)) return b; const { [id]: _fuera, ...resto } = b; void _fuera; return resto; });

  /* Guarda una respuesta completa (si no cambió, no escribe). Devuelve si quedó guardada. */
  const guardar = (id: string, r: Respuesta): boolean => {
    if (soloMirar || problemaDeRespuesta(r)) return false;
    const nota = r.nota?.trim() || undefined;
    const g = guardado[id];
    if (!(g?.estado === r.estado && (g?.nota?.trim() || undefined) === nota)) marcar(claveEod(dia, id), nota, r.estado);
    sinBorrador(id);
    return true;
  };
  const elegir = (id: string, estado: RespuestaDia) => {
    const r = { ...resp(id), estado };
    if (estado === "no-llegue" && !r.nota?.trim()) {
      setBorradores((b) => ({ ...b, [id]: r }));
      /* El motivo es obligatorio: el foco va directo a escribirlo. */
      window.setTimeout(() => lista.current?.querySelector<HTMLTextAreaElement>(`[data-nota="${id}"] textarea`)?.focus(), 0);
      return;
    }
    guardar(id, r);
  };
  const escribir = (id: string, nota: string) => setBorradores((b) => ({ ...b, [id]: { ...resp(id), nota } }));
  const alSalir = (id: string) => { if (borradores[id]) guardar(id, resp(id)); };

  const listo = cuenta.faltan.length === 0 && cuenta.total > 0;
  /* Cerrado y después se cambió algo: se puede volver a cerrar para que el cierre diga lo último. Las horas se comparan como fechas: la base
     las devuelve con otro formato («+00:00») que las que escribe el navegador («Z»). */
  const cambiosDespues = Boolean(cierre) && (
    notaDia.trim() !== (cierre?.nota ?? "").trim()
    || Object.keys(borradores).length > 0
    || registrosEod(chequeos).some((r) => r.dia === dia && Date.parse(r.en) > Date.parse(cierre!.en))
  );

  const cerrar = () => {
    if (!listo || soloMirar) return;
    for (const p of preguntas) guardar(p.id, resp(p.id));
    marcar(claveEod(dia, CIERRE_DEL_DIA), notaDia.trim() || undefined, "cerrado");
    toast(`${dia === hoy ? "Día cerrado" : `Cerraste el ${fechaCorta(dia)}`}: ${num(cuenta.hechas)} ${cuenta.hechas === 1 ? "hecha" : "hechas"}${cuenta.noLlegue ? `, ${num(cuenta.noLlegue)} para mañana` : ""}.`);
  };
  const irALaQueFalta = () => {
    const p = cuenta.faltan[0];
    const fila = p && lista.current?.querySelector<HTMLElement>(`[data-tarea="${p.id}"]`);
    if (!fila) return;
    fila.scrollIntoView({ behavior: "smooth", block: "center" });
    (fila.querySelector<HTMLElement>("[data-nota] textarea") ?? fila.querySelector<HTMLElement>(".eodl-op"))?.focus({ preventScroll: true });
  };

  /* Los grupos en el orden de la lista: lo que quedó de la semana pasada va primero; los viernes, lo de la semana va después de lo del día. */
  const grupos: { cadencia: PreguntaDia["cadencia"]; preguntas: PreguntaDia[] }[] = [];
  for (const p of preguntas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.cadencia === p.cadencia) ultimo.preguntas.push(p);
    else grupos.push({ cadencia: p.cadencia, preguntas: [p] });
  }
  const semanaDeAntes = preguntas.some((p) => p.cadencia === "semana" && p.desde) && !preguntas.some((p) => p.cadencia === "semana" && !p.desde);

  return (
    <>
      <section className="cm-caja eodl" aria-label={`Las tareas del ${fechaLarga(dia)}`}>
        <header className="eodl-cab">
          <div className="eodl-cab__texto">
            <h2 className="eodl-dia">{dia === hoy ? `Hoy, ${fechaLarga(dia)}` : conMayuscula(fechaLarga(dia))}</h2>
            <p className="eodl-cab__sub">
              {cierre
                ? <>Lo cerró <b>{cierre.por ?? "alguien"}</b> a las {HORA.format(new Date(cierre.en))}{diaDeNegocio(cierre.en) !== dia ? ` del ${fechaCorta(diaDeNegocio(cierre.en))}` : ""}.</>
                : soloMirar ? "Tu cuenta sólo puede mirar Finanzas: el cierre lo hace quien la edita."
                  : "Tocá cómo te fue con cada tarea: se guarda al instante."}
            </p>
          </div>
          <div className="eodl-avance" aria-label={`${cuenta.contestadas} de ${cuenta.total} contestadas`}>
            <span className="eodl-avance__n"><b className="t-num">{num(cuenta.contestadas)}</b> de {num(cuenta.total)}</span>
            <span className="eodl-avance__pista" aria-hidden>
              <i data-listo={listo || undefined} style={{ width: `${cuenta.total ? (cuenta.contestadas / cuenta.total) * 100 : 0}%` }} />
            </span>
          </div>
        </header>

        <ol className="eodl-lista" ref={lista}>
          {grupos.map((g, i) => (
            <li key={`${g.cadencia}-${i}`} className="eodl-grupo">
              {grupos.length > 1 && (
                <h3 className="eodl-grupo__tit">{g.cadencia === "dia" ? "Todos los días" : semanaDeAntes ? "Quedó de la semana pasada" : "De la semana"}</h3>
              )}
              <ol className="eodl-grupo__lista">
                {g.preguntas.map((p) => (
                  <Tarea
                    key={p.id} p={p} r={respuestas[p.id]} soloMirar={soloMirar}
                    onElegir={(estado) => elegir(p.id, estado)} onNota={(n) => escribir(p.id, n)} onSalirDeLaNota={() => alSalir(p.id)}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>

        <div className="eodl-notadia">
          <label className="t-label" htmlFor={`nota-dia-${dia}`}>¿Algo más del día? <span className="eodl-opcional">opcional</span></label>
          <Textarea
            id={`nota-dia-${dia}`} rows={2} value={notaDia} readOnly={soloMirar} onChange={(ev) => setNotaDia(ev.target.value)}
            placeholder="Lo que quieras que lea el resto del equipo"
          />
        </div>
      </section>

      {!soloMirar && (
        <div className="eodl-pie" role="region" aria-label="Cerrar el día">
          <div className="eodl-pie__estado" aria-live="polite">
            {cuenta.faltan.length > 0 ? (
              <button type="button" className="eodl-pie__falta" onClick={irALaQueFalta}>
                <CircleAlert size={16} aria-hidden />
                <span>
                  {cuenta.faltan.length === 1 ? "Falta 1" : `Faltan ${num(cuenta.faltan.length)}`}: {cuenta.faltan.slice(0, 4).map((p) => NOMBRE_CORTO[p.id] ?? p.paso.titulo).join(", ")}
                  {cuenta.faltan.length > 4 ? "…" : ""}
                </span>
              </button>
            ) : cierre && !cambiosDespues ? (
              <span className="eodl-pie__ok"><Check size={16} strokeWidth={2.5} aria-hidden /> Día cerrado: {resumen(cuenta)}</span>
            ) : (
              <span className="eodl-pie__ok eodl-pie__ok--listo">Todo contestado: {resumen(cuenta)}</span>
            )}
          </div>
          {cierre && !cambiosDespues ? null : (
            <Button variante={cierre ? "secondary" : "primary"} icono={<Check size={16} />} disabled={!listo} onClick={cerrar}>
              {cierre ? "Actualizar el cierre" : dia === hoy ? "Cerrar el día" : `Cerrar el ${fechaCorta(dia)}`}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function resumen(c: ReturnType<typeof cuentaDelDia>): string {
  return [
    `${num(c.hechas)} ${c.hechas === 1 ? "hecha" : "hechas"}`,
    c.noLlegue ? `${num(c.noLlegue)} para mañana` : "",
    c.noHaciaFalta ? `${num(c.noHaciaFalta)} sin hacer falta` : "",
  ].filter(Boolean).join(", ");
}

/* ---------- Una tarea ---------- */

function Tarea({ p, r, soloMirar, onElegir, onNota, onSalirDeLaNota }: {
  p: PreguntaDia; r: Respuesta; soloMirar: boolean;
  onElegir: (e: RespuestaDia) => void; onNota: (n: string) => void; onSalirDeLaNota: () => void;
}) {
  const [conNota, setConNota] = useState(false);
  const pideMotivo = r.estado === "no-llegue";
  const verNota = pideMotivo || conNota || Boolean(r.nota);
  const faltaMotivo = pideMotivo && !r.nota?.trim();
  const calculada = p.paso.tipo !== "manual";
  const avisar = sigueFaltandoEnLaApp(p, r);
  const notaRef = useRef<HTMLDivElement>(null);
  /* Al abrir «Agregar una nota», el foco va a escribirla. */
  useEffect(() => { if (conNota) notaRef.current?.querySelector("textarea")?.focus(); }, [conNota]);

  return (
    <li className="eodl-tarea" data-tarea={p.id} data-estado={faltaMotivo ? "falta" : r.estado ?? "sin"}>
      <span className="eodl-marca" aria-hidden>
        {faltaMotivo ? <CircleAlert size={15} /> : r.estado ? ICONO[r.estado] : null}
      </span>
      <div className="eodl-tarea__cuerpo">
        <div className="eodl-tarea__fila">
          <div className="eodl-tarea__texto">
            <h4 className="eodl-tarea__titulo">
              {p.paso.titulo}
              {calculada && (
                <span className={`cm-cuenta${p.paso.faltan > 0 ? "" : " cm-cuenta--listo"} eodl-app`} title={p.paso.faltan > 0 ? "Lo que la app ve pendiente ahora" : "La app no ve nada pendiente"}>
                  {p.paso.faltan > 0 ? `${num(p.paso.faltan)} ${p.paso.faltan === 1 ? "pendiente" : "pendientes"}` : "Al día"}
                </span>
              )}
            </h4>
            {p.desde && (
              <p className="eodl-tarea__antes">Quedó pendiente desde el {fechaCorta(p.desde)}{p.notaAntes ? <>: <i>{p.notaAntes}</i></> : ""}</p>
            )}
            <p className="eodl-tarea__det">{p.paso.detalle}</p>
          </div>
          <div className="eodl-acciones">
            <div className="eodl-ops" role="radiogroup" aria-label={`Cómo te fue: ${p.paso.titulo}`}>
              {RESPUESTAS.map((x) => (
                <button
                  key={x.id} type="button" role="radio" aria-checked={r.estado === x.id} className="eodl-op" data-op={x.id}
                  disabled={soloMirar} title={x.sub} onClick={() => onElegir(x.id)}
                >
                  {ICONO[x.id]}<span>{x.corto}</span>
                </button>
              ))}
            </div>
            {/* Siempre en el mismo lugar (escondido cuando la nota ya está abierta), así las respuestas no se corren. */}
            {!soloMirar && (
              <button
                type="button" className="eodl-nota-btn" onClick={() => setConNota(true)} title="Agregar una nota" aria-label="Agregar una nota"
                data-oculto={verNota || undefined} tabIndex={verNota ? -1 : undefined} aria-hidden={verNota || undefined}
              >
                <NotebookPen size={16} />
              </button>
            )}
          </div>
        </div>
        {avisar && (
          <p className="eodl-tarea__aviso" role="note">
            <CircleAlert size={14} aria-hidden /> La app todavía ve pendientes acá. Si lo dejaste para después, elegí «No llegué».
          </p>
        )}
        {verNota && (
          <div className="eodl-nota" data-nota={p.id} data-falta={faltaMotivo || undefined} ref={notaRef}>
            <Textarea
              rows={pideMotivo ? 2 : 1} value={r.nota ?? ""} readOnly={soloMirar} aria-label={pideMotivo ? "Por qué no llegaste y para cuándo" : "Nota"}
              onChange={(ev) => onNota(ev.target.value)} onBlur={onSalirDeLaNota}
              placeholder={pideMotivo ? "¿Por qué no llegaste y para cuándo?" : "Una nota (opcional)"}
            />
          </div>
        )}
      </div>
    </li>
  );
}
