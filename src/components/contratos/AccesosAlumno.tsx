"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarX2, ClipboardCheck, Copy, GraduationCap, KeyRound, RotateCcw, Send, UserMinus, Video } from "lucide-react";
import { Badge, Button, Field, Select, type VarianteBadge } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { fecha, money, relativo } from "@/lib/format";
import { alumnoDeVenta } from "@/lib/alumnos";
import { bajaResuelta, pedidosDeBaja, queFaltaDeLaBaja } from "@/lib/bajas-falta-de-pago";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { programaDeProducto, programasDe } from "@/lib/programas";
import { accesosQueFaltan, resumenDelPrograma } from "@/lib/accesos-que-faltan";
import type { Alumno, Venta } from "@/lib/types";
import type { Acceso, EstadoAcceso, Plataforma } from "@/lib/accesos-servidor";
import { contratosPrendidos } from "./cliente";
import { mensajeDeBienvenida } from "@/lib/accesos-alumnos";
import { AccionesServicio, BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";
import { IdentidadTelegram } from "./IdentidadTelegram";

/* ==================================================================
   Los accesos de un alumno (el Loom de Yari), en la ficha → Servicio:
   Wisboo, Telegram y Zoom, cada uno con su estado pintado. Se ve SIEMPRE
   (Juan Cruz, 20/10: «que en la ficha salga qué onda el contrato, Zoom,
   Telegram y Wisboo»):
   - Si la app dio (o intentó dar) ese acceso, se ve lo que pasó: dado,
     entró al grupo, falló, quitado.
   - Si no, se ve lo marcado a mano en la ficha (lo del Airtable), con su
     editor de siempre (`manual`, lo pasa la vista Servicio).
   Los botones (dar accesos, reintentar, quitar, el outboarding) aparecen
   cuando los contratos y accesos están prendidos en Ajustes.
   Dos formas: «tarjeta» y «hoja» (la solapa Accesos de la ficha →
   Servicio: un bloque por plataforma con las mismas filas de la hoja).
   ================================================================== */

const ESTADO: Record<EstadoAcceso, { texto: string; variante: VarianteBadge }> = {
  pendiente: { texto: "Pendiente", variante: "neutral" },
  dado: { texto: "Con acceso", variante: "success" },
  entro: { texto: "Entró", variante: "success" },
  fallo: { texto: "Con error", variante: "danger" },
  quitado: { texto: "Quitado", variante: "neutral" },
};
const PLATAFORMAS: { clave: Plataforma; nombre: string; icono: React.ReactNode }[] = [
  { clave: "wisboo", nombre: "Wisboo", icono: <GraduationCap size={15} /> },
  { clave: "telegram", nombre: "Grupos de Telegram", icono: <Send size={15} /> },
  { clave: "zoom", nombre: "Reuniones de Zoom", icono: <Video size={15} /> },
];

/* La fila con el formato de la vista Servicio (hoja-servicio.css): ícono y rótulo a la izquierda, el estado a la derecha. */
function FilaPlataforma({ icono, rotulo, children }: { icono: React.ReactNode; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="hs-fila">
      <span className="hs-fila__rot"><span className="hs-fila__ico" aria-hidden>{icono}</span><span>{rotulo}</span></span>
      <div className="hs-fila__val">{children}</div>
    </div>
  );
}

/* El estado de un acceso: un link de Telegram que todavía no se usó es ámbar (falta que entre). */
function estadoDe(x: Acceso): { texto: string; variante: VarianteBadge } {
  if (x.plataforma === "telegram" && x.estado === "dado") return { texto: "Falta que entre", variante: "warning" };
  if (x.plataforma === "telegram" && x.estado === "entro") return { texto: "Está en el grupo", variante: "success" };
  if (x.plataforma === "zoom" && x.estado === "dado") return { texto: "Inscripto", variante: "success" };
  return ESTADO[x.estado];
}

/* Debajo del nombre: cuándo y cómo se dio (o se quitó), o el error; y si se corta solo, cuándo (el Hackear IA MID: la mentoría, al mes). */
function detalleDe(x: Acceso): string {
  const corte = x.venceEn && (x.estado === "dado" || x.estado === "entro") ? `Se corta solo el ${fecha(x.venceEn)}` : "";
  return [detalleBase(x), corte].filter(Boolean).join(" · ");
}

function detalleBase(x: Acceso): string {
  if (x.estado === "fallo") return x.error ?? "No se pudo dar";
  if (x.estado === "quitado" && x.quitadoEn) return `Quitado ${relativo(x.quitadoEn)}`;
  if (x.estado === "entro") return `Entró${typeof x.externo.telegramUsuario === "string" ? ` como @${x.externo.telegramUsuario}` : ""}`;
  if (!x.dadoEn) return "";
  return `${x.plataforma === "telegram" ? "Link generado" : x.plataforma === "zoom" ? "Inscripto" : "Dado"} ${relativo(x.dadoEn)}${x.origen === "manual" ? " a mano" : " al firmar"}`;
}

/* El estado de una plataforma entera: lo peor manda (un error se ve aunque otro curso esté bien). */
function resumen(xs: Acceso[], plataforma: Plataforma): { texto: string; variante: VarianteBadge } {
  if (xs.some((x) => x.estado === "fallo")) return { texto: "Con error", variante: "danger" };
  const vigentes = xs.filter((x) => x.estado !== "quitado");
  if (vigentes.length === 0) return { texto: "Quitado", variante: "neutral" };
  if (plataforma === "telegram") {
    return vigentes.every((x) => x.estado === "entro")
      ? { texto: "Está en el grupo", variante: "success" }
      : { texto: "Link listo, falta que entre", variante: "warning" };
  }
  return { texto: plataforma === "zoom" ? "Inscripto" : "Con acceso", variante: "success" };
}

/* Lo que el outboarding automático saca de verdad: lo que la app tiene registrado. Un alumno de antes, reconocido sólo en Telegram, no tiene
   su Wisboo ni su Zoom en la app: eso se saca a mano. */
const NOMBRE_DE_PLATAFORMA: Record<Plataforma, string> = { wisboo: "Wisboo", telegram: "Telegram", zoom: "Zoom" };
function queSeSacaSolo(vigentes: Acceso[]): string {
  const nombres = (["wisboo", "telegram", "zoom"] as const).filter((p) => vigentes.some((x) => x.plataforma === p)).map((p) => NOMBRE_DE_PLATAFORMA[p]);
  return nombres.length < 2 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}
function loDeAntes(vigentes: Acceso[]): string {
  const faltan = (["wisboo", "zoom"] as const).filter((p) => !vigentes.some((x) => x.plataforma === p)).map((p) => NOMBRE_DE_PLATAFORMA[p]);
  return faltan.length ? `Lo de ${faltan.join(" y ")} que tenga de antes se saca a mano. ` : "";
}

async function pedir(cuerpo: Record<string, unknown>) {
  const r = await fetch("/api/accesos-alumnos", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

/* La próxima pasada de la app (api/cron/contratos corre a las :25 de cada hora), en hora de Argentina. */
function proximaPasada(ahora = new Date()): string {
  const t = new Date(ahora);
  t.setMinutes(25, 0, 0);
  if (t.getTime() <= ahora.getTime()) t.setHours(t.getHours() + 1);
  return `${String(t.getHours()).padStart(2, "0")}:25`;
}

export function AccesosAlumno({ alumno, venta, manual, outboarding, forma = "tarjeta" }: {
  alumno: Alumno; venta?: Venta; forma?: "tarjeta" | "hoja";
  /* Lo marcado a mano en la ficha (Airtable), con su editor: se muestra donde la app todavía no dio nada. */
  manual?: Partial<Record<Plataforma | "whatsapp", React.ReactNode>>;
  /* Está en Outboarding: el día en que la app le saca los accesos sola y el fin de su programa (lib/outboarding.ts). */
  outboarding?: { dia: string; fin: string | null };
}) {
  const e = useEstado();
  const toast = useToast();
  const { esDueno, acceso } = useAcceso();
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const [accesos, setAccesos] = useState<Acceso[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [dar, setDar] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<{ ids?: string[]; texto: string; wisboo?: boolean } | null>(null);
  const prendidos = contratosPrendidos(e.ajustes.contratos, esDueno);
  /* Dar, quitar y reintentar accesos es de Alumnos (el servidor lo exige): el closer ve a qué tiene acceso su alumno, sin los botones. */
  const acciona = prendidos && nivelEn(acceso, "alumnos") === 2;

  const leer = useCallback(async () => {
    if (!nube) { setAccesos([]); return; }
    const r = await nube.from("accesos_alumno").select("*").eq("alumnoId", alumno.id).order("plataforma");
    setAccesos(r.error ? [] : (r.data ?? []) as Acceso[]);
  }, [alumno.id]);
  useEffect(() => { void leer(); }, [leer]);
  /* Los nombres de los grupos de Telegram, para decir cuál le falta (los cursos y las reuniones se conocen por su número). */
  const [nombresGrupos, setNombresGrupos] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!nube || forma !== "hoja") return;
    let vivo = true;
    void nube.from("telegram_grupos").select('"chatId", titulo').then((r) => {
      if (!vivo || r.error) return;
      setNombresGrupos(Object.fromEntries(((r.data ?? []) as { chatId: string; titulo: string | null }[]).filter((g) => g.titulo).map((g) => [`telegram:${g.chatId}`, g.titulo!])));
    });
    return () => { vivo = false; };
  }, [forma]);

  const lista = accesos ?? [];
  const vigentes = lista.filter((x) => x.estado !== "quitado");
  /* Un closer pidió la baja por falta de pago (lib/bajas-falta-de-pago.ts; Lili, 23/11): el aviso de la campanita abre acá. */
  const baja = useMemo(() => {
    const seg = (e.seguimientos ?? []).find((x) => x.alumnoId === alumno.id);
    if (bajaResuelta(seg?.followUp, alumno.estado)) return null;
    return pedidosDeBaja(e).find((p) => alumnoDeVenta(e, p.venta)?.id === alumno.id) ?? null;
  }, [e, alumno]);
  const linksTelegram = lista.filter((x) => x.plataforma === "telegram" && x.estado === "dado" && typeof x.externo.link === "string");
  const linksZoom = lista.filter((x) => x.plataforma === "zoom" && x.estado === "dado" && typeof x.externo.joinUrl === "string");

  async function correr(clave: string, cuerpo: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) {
    setTrabajando(clave);
    try {
      const j = await pedir({ alumnoId: alumno.id, ...cuerpo });
      toast(ok(j));
      if (typeof j.mensaje === "string" && j.mensaje) {
        /* El portapapeles puede no contestar nunca (la pestaña perdió el foco mientras se daban): no deja el botón girando (24/11). */
        const copio = await Promise.race([
          navigator.clipboard.writeText(j.mensaje).then(() => true, () => false),
          new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
        ]);
        if (copio) toast("Copié el mensaje de bienvenida con los links: pegáselo por WhatsApp.");
      }
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
    /* El servidor también marcó la ficha (Acceso, Wisboo, Zoom): que se vea sin recargar. */
    void acciones.traerFichaDe(alumno.id);
  }

  async function copiarMensaje() {
    const programa = programas.find((p) => p.id === (linksTelegram[0] ?? linksZoom[0])?.programa)?.nombre ?? "tu programa";
    const texto = mensajeDeBienvenida(alumno.nombre, programa, [
      ...linksTelegram.map((x) => ({ plataforma: "telegram" as const, nombre: x.recursoNombre, url: String(x.externo.link) })),
      ...linksZoom.map((x) => ({ plataforma: "zoom" as const, nombre: x.recursoNombre, url: String(x.externo.joinUrl) })),
    ]);
    try { await navigator.clipboard.writeText(texto); toast("Mensaje con los links copiado."); }
    catch { window.prompt("Copiá el mensaje:", texto); }
  }

  const delPrograma = programaDeProducto(programas, venta?.productoId);
  const programaSugerido = delPrograma?.id ?? "";
  /* Lo que su programa le da y todavía no tiene (Lili, 24/11): se ve en su bloque y se da con un clic. */
  const faltan = useMemo(() => (accesos === null ? [] : accesosQueFaltan(delPrograma, accesos, nombresGrupos)), [accesos, delPrograma, nombresGrupos]);
  const darLoQueFalta = () => void correr("faltan", { accion: "dar", programa: programaSugerido, solo: faltan.map((x) => ({ plataforma: x.plataforma, recurso: x.recurso })) },
    (j) => `Accesos: ${String(j.dados ?? 0)} dados${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}${Number(j.yaEstaban) ? `, ${String(j.yaEstaban)} ya los tenía` : ""}.`);
  /* Quién es en Telegram (Manu, 20/11): con eso «Quitar» y el outboarding lo pueden sacar de los grupos, también a los de antes de la app. */
  const identidad = (
    <IdentidadTelegram alumno={alumno} acciona={acciona} conAccesoVigente={vigentes.some((x) => x.plataforma === "telegram")}
      onCambio={() => { void leer(); void acciones.traerFichaDe(alumno.id); }} />
  );
  const modales = (
    <>
      {dar !== null && (
        <ModalForm abierto titulo="Dar accesos" onCerrar={() => setDar(null)} guardarTexto={trabajando === "dar" ? "Dando…" : "Dar accesos"}
          sub="Se le dan los cursos de Wisboo, los links a los grupos de Telegram y las reuniones de Zoom del programa. Lo que ya tenía no se repite."
          puedeGuardar={Boolean(dar) && trabajando !== "dar"}
          onGuardar={() => { const programa = dar; setDar(null); void correr("dar", { accion: "dar", programa }, (j) => `Accesos: ${String(j.dados ?? 0)} dados${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}${Number(j.yaEstaban) ? `, ${String(j.yaEstaban)} ya los tenía` : ""}.`); }}>
          <Field label="Programa" ayuda="Para un upsell, elegí el programa nuevo: se suman sus accesos.">
            <Select value={dar} onChange={(ev) => setDar(ev.target.value)} placeholder="Elegí el programa"
              opciones={programas.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
          </Field>
        </ModalForm>
      )}
      <Confirmar
        abierto={quitar !== null} onCerrar={() => setQuitar(null)} confirmarTexto="Quitar"
        titulo={quitar?.ids ? "¿Quitar este acceso?" : "¿Hacerle el outboarding?"}
        texto={`${quitar?.texto ?? ""}${quitar?.wisboo ? " Wisboo no deja borrar al alumno por API: queda en la tienda sin acceso." : ""}`}
        onConfirmar={() => { const q = quitar; if (q) void correr("quitar", { accion: "quitar", ids: q.ids }, (j) => `Quitados: ${String(j.quitados ?? 0)}${Number(j.fallaron) ? `, ${String(j.fallaron)} con error` : ""}.`); }}
      />
    </>
  );

  const reintentar = (x: Acceso) => (
    <Button sm variante="ghost" icono={<RotateCcw size={14} />} cargando={trabajando === x.id}
      onClick={() => void correr(x.id, { accion: "dar", programa: x.programa, solo: [{ plataforma: x.plataforma, recurso: x.recurso }] }, (j) => Number(j.fallaron) ? "Volvió a fallar." : "Listo, acceso dado.")}>
      Reintentar
    </Button>
  );

  /* ---------- La solapa Accesos de la ficha → Servicio ---------- */
  if (forma === "hoja") {
    return (
      <>
        {prendidos && (
          <AccionesServicio>
            {linksTelegram.length + linksZoom.length > 0 && <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarMensaje()}>Copiar mensaje con links</Button>}
            {acciona && vigentes.length > 0 && (
              <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Quitar todo</Button>
            )}
            {acciona && faltan.length > 0
              ? <Button sm variante="primary" icono={<KeyRound size={14} />} cargando={trabajando === "faltan"} onClick={darLoQueFalta}>Dar lo que falta ({faltan.length})</Button>
              : acciona && <Button sm variante="secondary" icono={<KeyRound size={14} />} onClick={() => setDar(programaSugerido)}>Dar accesos</Button>}
          </AccionesServicio>
        )}
        {/* Qué le da su programa y si ya lo tiene todo (Lili, 24/11): sin esto, lo que faltaba no se veía en ningún lado. */}
        {delPrograma && accesos !== null && (() => {
          const r = resumenDelPrograma(delPrograma, accesos, faltan);
          const incluidos = (delPrograma.incluye ?? []).map((id) => programas.find((p) => p.id === id)?.nombre ?? id);
          const estado = r.faltan > 0 ? `Le ${r.faltan === 1 ? "falta 1" : `faltan ${r.faltan}`}` : r.conError > 0 ? `${r.conError} con error` : "Tiene todo";
          const nota = [
            r.faltan > 0 ? `Lo que falta está en ámbar en cada bloque${acciona ? ": «Dar lo que falta» se lo da sin repetir lo que ya tiene" : ""}.` : "",
            r.sinEntrar > 0 ? `${r.sinEntrar === 1 ? "Un link de Telegram" : `${r.sinEntrar} links de Telegram`} sin usar: falta que entre.` : "",
          ].filter(Boolean).join(" ");
          return (
            <BloqueServicio titulo="Su programa">
              <FilaServicio icono={<ClipboardCheck size={15} />} rotulo={`${delPrograma.nombre}${incluidos.length ? ` (incluye ${incluidos.join(" y ")})` : ""}`}
                detalle={`Le da ${r.da || "nada todavía"}.${nota ? ` ${nota}` : ""}`}>
                <Badge variante={r.tieneTodo ? "success" : r.faltan > 0 ? "warning" : "danger"}>{estado}</Badge>
              </FilaServicio>
            </BloqueServicio>
          );
        })()}
        {baja && accesos !== null && (() => {
          const cuotas = baja.cuotas.map((c) => (c.esReserva ? "la reserva" : `la cuota ${c.numero}`)).join(" y ");
          const producto = e.productos.find((p) => p.id === baja.venta.productoId)?.nombre;
          const falta = baja.hecho ? [...baja.hecho.aMano, ...baja.hecho.fallaron].length > 0 : vigentes.length === 0;
          return (
            <BloqueServicio titulo="Baja por falta de pago">
              <FilaServicio icono={<UserMinus size={15} />} rotulo={`${baja.pidio} pidió la baja el ${formatoDia(diaDeNegocio(baja.en))}`}
                detalle={`No pagó ${cuotas}${producto ? ` de ${producto}` : ""} (${money(baja.debe, baja.venta.moneda || "USD", 0)}).${baja.nota ? ` «${baja.nota}».` : ""} `
                  + (baja.hecho ? `${queFaltaDeLaBaja(baja.hecho)}.`
                    : vigentes.length > 0 ? "Los accesos que le dio la app se le sacan solos en la próxima pasada; lo de antes, si tiene, va a mano."
                      : "Sus accesos no son de la app: sacáselos a mano.")
                  + " Cuando esté, pasá su Follow Up a Outboarding."}>
                {baja.hecho ? <Badge variante={falta ? "warning" : "success"}>{falta ? "Falta a mano" : "Hecho"}</Badge>
                  : vigentes.length > 0 ? <Badge variante="warning">{`Hoy a las ${proximaPasada()}`}</Badge>
                    : <Badge variante="neutral">A mano</Badge>}
                {acciona && !baja.hecho && vigentes.length > 0 && (
                  <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca ya el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Sacarlos ahora</Button>
                )}
              </FilaServicio>
            </BloqueServicio>
          );
        })()}
        {/* El outboarding automático (Lili, 26/10): cuándo se le sacan solos los accesos de la app. */}
        {outboarding && accesos !== null && (
          <BloqueServicio titulo="Outboarding">
            <FilaServicio icono={<CalendarX2 size={15} />} rotulo="Se le sacan los accesos solos"
              detalle={lista.length === 0 ? "La app no le dio accesos: lo que tenga de antes (Wisboo, grupos, Zoom) se le saca a mano."
                : vigentes.length === 0 ? "Ya se le sacaron los accesos que le dio la app."
                  : `${queSeSacaSolo(vigentes)}${outboarding.fin ? `: su programa termina el ${formatoDia(outboarding.fin)}` : ""}. ${loDeAntes(vigentes)}Si renueva, cambiale el Follow Up antes y no pasa nada.`}>
              {lista.length === 0 ? <Badge variante="neutral">A mano</Badge>
                : vigentes.length === 0 ? <Badge variante="success">Hecho</Badge>
                  : <Badge variante="warning">{outboarding.dia > hoyDelNegocio() ? `El ${formatoDia(outboarding.dia)}` : `Hoy a las ${proximaPasada()}`}</Badge>}
              {acciona && vigentes.length > 0 && (
                <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca ya el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Sacarlos ahora</Button>
              )}
            </FilaServicio>
          </BloqueServicio>
        )}
        {accesos === null ? <div className="skeleton" style={{ height: 132, borderRadius: 12 }} /> : PLATAFORMAS.map(({ clave, nombre, icono }) => {
          const xs = lista.filter((x) => x.plataforma === clave);
          const leFaltan = faltan.filter((x) => x.plataforma === clave);
          /* Sin estado general de la plataforma (Juan Cruz, 21/10): cada fila ya dice a qué tiene acceso y a qué no. */
          return (
            <BloqueServicio key={clave} titulo={nombre}>
              {clave === "telegram" && identidad}
              {xs.length === 0
                ? (leFaltan.length && !manual?.[clave] ? null : manual?.[clave] ?? <p className="hs-nada">Todavía no se le dio nada desde la app.</p>)
                : xs.map((x) => {
                  const est = estadoDe(x);
                  return (
                    <FilaServicio key={x.id} icono={icono} rotulo={x.recursoNombre || x.recurso} detalle={detalleDe(x) || undefined}>
                      <Badge variante={est.variante}>{est.texto}</Badge>
                      {acciona && x.estado === "fallo" && reintentar(x)}
                      {acciona && (x.estado === "dado" || x.estado === "entro") && (
                        <Button sm variante="ghost" onClick={() => setQuitar({ ids: [x.id], texto: `Se le saca «${x.recursoNombre || x.recurso}» (${nombre}).`, wisboo: x.plataforma === "wisboo" })}>Quitar</Button>
                      )}
                    </FilaServicio>
                  );
                })}
              {leFaltan.map((x) => (
                <FilaServicio key={`falta-${x.recurso}`} icono={icono} rotulo={x.nombre} detalle={`Su programa lo da y todavía no lo tiene${clave === "telegram" ? " (se le genera su link)" : clave === "zoom" ? " (se lo inscribe)" : ""}.`}>
                  <Badge variante="warning">Falta darlo</Badge>
                </FilaServicio>
              ))}
            </BloqueServicio>
          );
        })}
        {/* Los grupos de antes eran de WhatsApp: la marca del Airtable se sigue viendo y editando. */}
        {manual?.whatsapp && <BloqueServicio titulo="WhatsApp (los grupos de antes)">{manual.whatsapp}</BloqueServicio>}
        {modales}
      </>
    );
  }

  return (
    <div className="stack-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="t-label">Accesos</span>
        {prendidos && (
          <div className="row-wrap" style={{ gap: 6 }}>
            {linksTelegram.length + linksZoom.length > 0 && <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarMensaje()}>Copiar mensaje con links</Button>}
            {acciona && <Button sm variante="secondary" icono={<KeyRound size={14} />} onClick={() => setDar(programaSugerido)}>Dar accesos</Button>}
            {acciona && vigentes.length > 0 && (
              <Button sm variante="ghost" icono={<UserMinus size={14} />} onClick={() => setQuitar({ texto: "Se le saca el acceso a todos sus cursos de Wisboo, se lo saca de los grupos de Telegram y se cancela su inscripción a las reuniones de Zoom.", wisboo: true })}>Quitar todo</Button>
            )}
          </div>
        )}
      </div>

      {accesos === null ? <div className="skeleton" style={{ height: 32 }} /> : (
        <ul className="stack-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {PLATAFORMAS.map(({ clave, nombre, icono }) => {
            const xs = lista.filter((x) => x.plataforma === clave);
            /* Sin nada de la app: lo marcado a mano en la ficha (con su editor), o «sin acceso». */
            if (xs.length === 0) {
              return (
                <li key={clave} className={clave === "telegram" ? "stack-1" : undefined}>
                  {manual?.[clave] ?? <FilaPlataforma icono={icono} rotulo={nombre}><Badge variante="neutral">Sin acceso</Badge></FilaPlataforma>}
                  {clave === "telegram" && identidad}
                </li>
              );
            }
            const r = resumen(xs, clave);
            return (
              <li key={clave} className="stack-1">
                <FilaPlataforma icono={icono} rotulo={nombre}><Badge variante={r.variante}>{r.texto}</Badge></FilaPlataforma>
                {clave === "telegram" && identidad}
                <ul className="stack-1" style={{ listStyle: "none", margin: 0, padding: "0 0 0 34px" }}>
                  {xs.map((x) => (
                    <li key={x.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="t-sm">{x.recursoNombre || x.recurso}</span>
                        {x.error && x.estado === "fallo" && <span className="t-sm" style={{ display: "block", color: "var(--danger)" }}>{x.error}</span>}
                        {x.estado !== "fallo" && (x.dadoEn || x.quitadoEn) && (
                          <span className="t-sm t-subtle" style={{ display: "block" }}>
                            {x.estado === "quitado" && x.quitadoEn ? `quitado ${relativo(x.quitadoEn)}`
                              : x.estado === "entro" ? `entró${typeof x.externo.telegramUsuario === "string" ? ` como @${x.externo.telegramUsuario}` : ""}`
                              : x.dadoEn ? `${clave === "telegram" ? "link generado" : "dado"} ${relativo(x.dadoEn)}${x.origen === "manual" ? " a mano" : " al firmar"}` : ""}
                          </span>
                        )}
                      </span>
                      <Badge variante={estadoDe(x).variante}>{estadoDe(x).texto}</Badge>
                      {acciona && x.estado === "fallo" && (
                        <Button sm variante="ghost" icono={<RotateCcw size={14} />} cargando={trabajando === x.id}
                          onClick={() => void correr(x.id, { accion: "dar", programa: x.programa, solo: [{ plataforma: x.plataforma, recurso: x.recurso }] }, (j) => Number(j.fallaron) ? "Volvió a fallar." : "Listo, acceso dado.")}>
                          Reintentar
                        </Button>
                      )}
                      {acciona && (x.estado === "dado" || x.estado === "entro") && (
                        <Button sm variante="ghost" onClick={() => setQuitar({ ids: [x.id], texto: `Se le saca «${x.recursoNombre || x.recurso}» (${nombre}).`, wisboo: x.plataforma === "wisboo" })}>Quitar</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {/* Los grupos de antes eran de WhatsApp: la marca del Airtable se sigue viendo y editando. */}
          {manual?.whatsapp && <li>{manual.whatsapp}</li>}
        </ul>
      )}

      {modales}
    </div>
  );
}
