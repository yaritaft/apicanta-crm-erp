"use client";

import React, { useEffect, useState } from "react";
import { Copy, Eye, Mail, Map as MapaIcono, MessageCircle, Send } from "lucide-react";
import { Button, Select } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { cabeceras } from "@/components/webinars/useYoutube";
import { BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";
import {
  conCodigoDelAlumno, estadoDelMail, guiaDeBienvenida, mensajeDelRoadmap, perfilDeStack, perfilEfectivo, PERFILES, roadmapYaEnviado, seguimientoDeBienvenida, textoDeBienvenida,
} from "@/lib/bienvenida-alumno";
import { fechaHora, fechaLarga } from "@/lib/format";
import { programaPorId, programasDe } from "@/lib/programas";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import type { Contrato, EventoContrato } from "@/lib/contratos";
import { leerContratos, pedirContratoYRoadmap, type MailEnviado, type RoadmapPedido } from "./cliente";

/* ==================================================================
   La bienvenida del alumno en Servicio → Contrato (Lili, 22/10): qué
   perfil cargó el closer, qué roadmap le toca y si el mail ya salió.
   Mientras el envío de mails no esté configurado (Resend), el mensaje se
   copia acá y se le manda por WhatsApp o por mail, con el link de su
   formulario semanal ya puesto.

   El perfil lo carga el closer en el contrato, pero si no lo cargó (o el
   contrato se mandó a mano desde PandaDoc) lo completa Servicio desde acá (Lili,
   25/10). Es el mismo dato que Programa → Perfil de la ficha: elegirlo acá lo deja
   en los dos lados, y cambiarlo en Programa cambia el roadmap de acá (26/10:
   «y viceversa»; ver perfilEfectivo).

   Si la bienvenida ya salió sin el roadmap (faltaba el perfil), al elegirlo le
   llega aparte por mail y Customer Success recibe un aviso para mandárselo por
   WhatsApp: el mensaje se copia desde la fila «Roadmap» (Juan Cruz, 26/10).
   ================================================================== */

const MODELO = { completo: "Programa completo", downsell: "Downsell", reserva: "Reserva" } as const;

/* Su código personal (el del reporte, que también lo anota a los simulacros): con él se arman sus links. */
async function codigoDelAlumno(alumnoId: string): Promise<string | null> {
  const r = await fetch("/api/reportes/enlace", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" },
    body: JSON.stringify({ alumnoId }),
  }).catch(() => null);
  const j = (await r?.json().catch(() => ({}))) as { codigo?: string } | undefined;
  return r?.ok && j?.codigo ? j.codigo : null;
}

export function BienvenidaAlumno({ alumnoId, ventaId }: { alumnoId: string; ventaId?: string }) {
  const toast = useToast();
  const e = useEstado();
  const config = e.ajustes.bienvenida;
  const { acceso } = useAcceso();
  const puedeCambiar = puedeEditar(acceso, "alumnos");
  const stackDeLaFicha = (e.seguimientos ?? []).find((x) => x.alumnoId === alumnoId)?.stack;
  /* En Programa dice algo que no es un roadmap («Backend»): se le dice a Servicio, que es quien elige cuál le toca. */
  const otroEnPrograma = stackDeLaFicha?.trim() && !perfilDeStack(stackDeLaFicha) ? stackDeLaFicha.trim() : null;
  const [contrato, setContrato] = useState<Contrato | null | undefined>(undefined);
  const [eventos, setEventos] = useState<EventoContrato[]>([]);
  const [mandando, setMandando] = useState(false);
  const [vuelta, setVuelta] = useState(0);
  const [copiando, setCopiando] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  /* «Ver cómo salió»: el mail tal como le llegó al alumno (Lili, 17/11). `envio`: cuál de los envíos (el último por defecto). */
  const [verMail, setVerMail] = useState<{ cargando: boolean; mail: MailEnviado | null; error: string; envio: string } | null>(null);
  /* Cómo le salió el último mail según el servicio de mails (llegó, rebotó…): se pregunta al abrir y después de reenviar. */
  const [estadoMail, setEstadoMail] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void leerContratos({ alumnoId, ventaId }).then((r) => {
      if (!vivo) return;
      /* El último contrato que no se anuló: el que mira el alumno. */
      const c = r.contratos.find((x) => x.estado !== "anulado" && x.estado !== "error") ?? null;
      setContrato(c);
      setEventos(c ? r.eventos.filter((x) => x.contratoId === c.id) : []);
    });
    return () => { vivo = false; };
  }, [alumnoId, ventaId, vuelta]);

  const mailId = contrato?.bienvenidaMailId ?? null;
  const contratoId = contrato?.id ?? null;
  useEffect(() => {
    if (!contratoId || !mailId) { setEstadoMail(null); return; }
    let vivo = true;
    void pedirContratoYRoadmap({ accion: "estado-mail", id: contratoId }).then((r) => { if (vivo) setEstadoMail(r.estadoMail ?? null); }).catch(() => { if (vivo) setEstadoMail(null); });
    return () => { vivo = false; };
  }, [contratoId, mailId, vuelta]);

  if (!contrato) return null;
  /* Lo que trae su programa (Ajustes → Programas): el mensaje cuenta sólo lo suyo, igual que el mail (Lili, 20/11). */
  const guia = guiaDeBienvenida({
    reserva: contrato.datos.reserva, programa: contrato.programa, perfil: perfilEfectivo(contrato.datos.perfil, stackDeLaFicha), config,
    delPrograma: programaPorId(programasDe(e.ajustes), contrato.programa),
  });
  if (!guia) return null;

  const copiar = async () => {
    setCopiando(true);
    const codigo = guia.modelo === "completo" ? await codigoDelAlumno(alumnoId) : null;
    const { texto } = textoDeBienvenida(conCodigoDelAlumno(guia, window.location.origin, codigo), contrato.bienvenida ? `${window.location.origin}/bienvenida/${contrato.bienvenida}` : null);
    const ok = await copiarTexto(texto);
    setCopiando(false);
    toast(ok ? "Mensaje de bienvenida copiado: pegalo en WhatsApp o en un mail." : "No se pudo copiar.", ok ? "ok" : "err");
  };

  const nombre = contrato.destinatario?.nombre || contrato.datos.nombre || "";
  const yaLeLlego = roadmapYaEnviado(eventos, guia.perfil);
  const avisoDelRoadmap = (r?: RoadmapPedido) => !r ? ""
    : r.yaEstaba ? ""
      : r.mail ? ` Le mandamos su roadmap por mail; mandáselo también por WhatsApp (lo copiás en «Roadmap»).`
        : ` No salió el mail con su roadmap (${r.motivo ?? "sin motivo"}): mandáselo por WhatsApp desde «Roadmap».`;

  const copiarRoadmap = async () => {
    const texto = mensajeDelRoadmap(guia, nombre);
    if (!texto) return;
    const ok = await copiarTexto(texto);
    toast(ok ? "Mensaje con su roadmap copiado: pegalo en su WhatsApp." : "No se pudo copiar.", ok ? "ok" : "err");
  };

  const mandarRoadmap = async () => {
    setMandando(true);
    try {
      const { roadmap } = await pedirContratoYRoadmap({ accion: "roadmap", id: contrato.id });
      toast(roadmap?.mail ? `Le mandamos su roadmap (${guia.perfil}) por mail. Mandáselo también por WhatsApp.`
        : `No salió el mail: ${roadmap?.motivo ?? "probá de nuevo"}. Mandáselo por WhatsApp.`, roadmap?.mail ? "ok" : "err");
      setVuelta((x) => x + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo mandar.", "err");
    }
    setMandando(false);
  };

  const abrirMail = async (envio = "") => {
    setVerMail({ cargando: true, mail: null, error: "", envio });
    try {
      const { mailEnviado } = await pedirContratoYRoadmap({ accion: "ver-mail", id: contrato.id, ...(envio ? { envioId: envio } : {}) });
      setVerMail({ cargando: false, mail: mailEnviado ?? null, error: mailEnviado ? "" : "Este programa no tiene mail de bienvenida.", envio });
    } catch (err) {
      setVerMail({ cargando: false, mail: null, error: err instanceof Error ? err.message : "No se pudo traer el mail.", envio });
    }
  };

  const copiarMail = async () => {
    if (!verMail?.mail) return;
    const ok = await copiarTexto(verMail.mail.texto);
    toast(ok ? "Mail copiado." : "No se pudo copiar.", ok ? "ok" : "err");
  };

  /* «Reenviar»: vuelve a mandar el mismo mail de bienvenida (Lili, 17/11: por si el alumno lo perdió). */
  const reenviarBienvenida = async () => {
    setReenviando(true);
    try {
      const { bienvenida } = await pedirContratoYRoadmap({ accion: "bienvenida", id: contrato.id });
      toast(bienvenida?.mail ? "Le reenviamos el mail de bienvenida." : `No salió el mail: ${bienvenida?.motivo ?? "probá de nuevo"}`, bienvenida?.mail ? "ok" : "err");
      setVuelta((x) => x + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo reenviar.", "err");
    }
    setReenviando(false);
  };

  /* Lo elegido queda en el contrato (de ahí sale el mail de bienvenida) y en Programa → Perfil de la ficha. */
  const elegirPerfil = async (perfil: string) => {
    if (!perfil) return;
    setGuardando(true);
    try {
      const { contrato: guardado, roadmap } = await pedirContratoYRoadmap({ accion: "perfil", id: contrato.id, perfil });
      setContrato(guardado);
      setVuelta((x) => x + 1);
      /* El servidor ya lo dejó en la ficha; esto es para verlo al instante. */
      if (stackDeLaFicha !== perfil && puedeEditar(acceso, "seguimiento_alumnos")) {
        acciones.guardarSeguimiento(alumnoId, (x, quien) => ({ ...x, stack: perfil, actualizadoEn: new Date().toISOString(), actualizadoPor: quien }), () => `Perfil: ${perfil}.`);
      }
      setEligiendo(false);
      toast(`Perfil ${perfil}: quedó en el contrato y en Programa.${avisoDelRoadmap(roadmap)}`, roadmap && !roadmap.mail ? "err" : "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar el perfil.", "err");
    }
    setGuardando(false);
  };

  const firmado = contrato.estado === "firmado";
  const seg = seguimientoDeBienvenida(eventos);
  const envios = eventos.filter((x) => x.evento === "bienvenida" && x.detalle?.enviado === true && typeof x.detalle?.id === "string");
  const mail = estadoDelMail(estadoMail);
  return (
    <BloqueServicio titulo="Bienvenida" extra={
      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {contrato.bienvenidaMailEn
          ? mail?.tono === "malo"
            ? <span className="hs-chip hs-chip--rojo" title={mail.texto}>El mail no le llegó</span>
            : <span className="hs-chip hs-chip--ok">Le llegó por mail</span>
          : <span className={`hs-chip${firmado ? " hs-chip--ambar" : ""}`}>{firmado ? "Mandásela vos" : "Sale al firmar"}</span>}
        {firmado && contrato.bienvenida && (seg.vistas > 0
          ? <span className="hs-chip hs-chip--ok" title="Abrió su página de bienvenida">La vio</span>
          : contrato.bienvenidaMailEn ? <span className="hs-chip hs-chip--ambar" title="Todavía no abrió su página de bienvenida">Todavía no la abrió</span> : null)}
      </span>
    }>
      <FilaServicio icono={<MapaIcono size={15} />} rotulo="Perfil y roadmap" detalle={MODELO[guia.modelo]}>
        {eligiendo || (!guia.perfil && puedeCambiar) ? (
          <span className="stack-1" style={{ minWidth: 200 }}>
            <Select value={guia.perfil ?? ""} placeholder="Elegí el perfil" aria-label="Perfil del alumno" disabled={guardando}
              onChange={(ev) => void elegirPerfil(ev.target.value)} opciones={PERFILES.map((p) => ({ valor: p, texto: p }))} />
            {!guia.perfil && <span className="hs-rojo t-sm">{otroEnPrograma ? `En Programa dice «${otroEnPrograma}»: elegí qué roadmap le toca` : "Falta el perfil: elegilo y queda también en Programa"}</span>}
          </span>
        ) : (
          <>
            {guia.perfil && guia.roadmap
              ? <a className="link t-sm" href={guia.roadmap} target="_blank" rel="noopener noreferrer">{guia.perfil}</a>
              : guia.perfil ? <span className="hs-guion">{guia.perfil} · falta el link en Ajustes</span>
                : <span className="hs-rojo">Falta el perfil (lo elige Servicio)</span>}
            {guia.perfil && puedeCambiar && <button type="button" className="link t-sm" style={{ marginLeft: 8 }} onClick={() => setEligiendo(true)}>Cambiar</button>}
          </>
        )}
      </FilaServicio>
      {contrato.bienvenidaMailEn && guia.perfil && (
        <FilaServicio icono={<MessageCircle size={15} />} rotulo="Roadmap"
          detalle={!guia.roadmap ? undefined : yaLeLlego?.por === "bienvenida" ? "Fue en el mail de bienvenida"
            : yaLeLlego ? `Le llegó por mail el ${fechaLarga(yaLeLlego.cuando)}` : "La bienvenida salió sin el roadmap"}>
          {!guia.roadmap ? <span className="hs-guion">Falta el link en Ajustes</span> : (
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!yaLeLlego && puedeCambiar && (
                <Button sm variante="primary" icono={<Send size={14} />} disabled={mandando} onClick={() => void mandarRoadmap()}>Mandárselo por mail</Button>
              )}
              <Button sm variante="secondary" icono={<Copy size={14} />} onClick={() => void copiarRoadmap()}>Copiar para WhatsApp</Button>
            </span>
          )}
        </FilaServicio>
      )}
      <FilaServicio icono={<Mail size={15} />} rotulo="Mail de bienvenida"
        detalle={contrato.bienvenidaMailEn
          ? [seg.envios > 1 ? `Salió ${seg.envios} veces` : "", mail?.texto ?? ""].filter(Boolean).join(" · ") || undefined
          : "Todavía no sale solo: copiá el mensaje y mandáselo por WhatsApp o mail."}>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {contrato.bienvenidaMailEn && (
            <span className="t-num" style={mail?.tono === "malo" ? { color: "var(--danger)" } : undefined} title={seg.ultimoEnvio ? `Último envío: ${fechaHora(seg.ultimoEnvio)}` : undefined}>
              {fechaLarga(seg.ultimoEnvio ?? contrato.bienvenidaMailEn)}
            </span>
          )}
          {firmado && puedeCambiar && (
            <Button sm variante={contrato.bienvenidaMailEn ? "secondary" : "primary"} icono={<Send size={14} />} disabled={reenviando}
              onClick={() => void reenviarBienvenida()}>{contrato.bienvenidaMailEn ? "Reenviar" : "Mandar el mail"}</Button>
          )}
          {contrato.bienvenidaMailEn && (
            <Button sm variante="secondary" icono={<Eye size={14} />} onClick={() => void abrirMail()}>Ver cómo salió</Button>
          )}
          <Button sm variante="secondary" icono={<Copy size={14} />} disabled={copiando} onClick={() => void copiar()}>Copiar el mensaje</Button>
        </span>
      </FilaServicio>
      {firmado && contrato.bienvenida && (
        <FilaServicio icono={<Eye size={15} />} rotulo="Página de bienvenida"
          detalle={seg.vistas > 0 ? "Ya la abrió: los links de la página son los que usa para entrar." : "Todavía no la abrió: puede que no haya visto el mail."}>
          {seg.primeraVista
            ? <span className="t-num" title={seg.ultimaVista && seg.ultimaVista !== seg.primeraVista ? `Última vez: ${fechaHora(seg.ultimaVista)}` : undefined}>
              {fechaHora(seg.primeraVista)}{seg.vistas > 1 ? ` · volvió ${seg.vistas - 1} ${seg.vistas - 1 === 1 ? "vez" : "veces"}` : ""}
            </span>
            : <span className="hs-guion">Todavía no</span>}
        </FilaServicio>
      )}
      <Modal abierto={verMail !== null} onCerrar={() => setVerMail(null)} titulo="Mail de bienvenida"
        sub={verMail?.mail ? `Para ${verMail.mail.para || "—"}${verMail.mail.cuando ? ` · ${fechaHora(verMail.mail.cuando)}` : ""}` : undefined} ancho
        pie={verMail?.mail ? <Button sm variante="secondary" icono={<Copy size={14} />} onClick={() => void copiarMail()}>Copiar</Button> : undefined}>
        {verMail?.cargando && <p className="t-sm t-subtle">Trayendo el mail…</p>}
        {verMail?.error && <p className="t-sm" style={{ color: "var(--danger)" }}>{verMail.error}</p>}
        {verMail?.mail && (
          <div className="stack-2">
            {envios.length > 1 && (
              <Select value={verMail.envio || (envios[envios.length - 1].detalle.id as string)} aria-label="Qué envío ver"
                onChange={(ev) => void abrirMail(ev.target.value)}
                opciones={[...envios].reverse().map((x, i) => ({ valor: x.detalle.id as string, texto: `${fechaHora(x.cuando)}${x.detalle.reenvio ? " · reenvío" : i === envios.length - 1 ? " · el primero" : ""}` }))} />
            )}
            {verMail.mail.reconstruido && (
              <p className="t-sm hs-guion">Resend ya no guarda este mail: te mostramos el texto que saldría hoy, que puede diferir del que recibió.</p>
            )}
            <div className="t-label">Asunto</div>
            <div className="t-strong">{verMail.mail.asunto}</div>
            <div className="t-label">Mensaje</div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.55, maxHeight: "55vh", overflowY: "auto" }}>{verMail.mail.texto}</div>
          </div>
        )}
      </Modal>
    </BloqueServicio>
  );
}
