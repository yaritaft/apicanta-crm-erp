"use client";

import React, { useEffect, useState } from "react";
import { Copy, Mail, Map as MapaIcono, MessageCircle, Send } from "lucide-react";
import { Button, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { cabeceras } from "@/components/webinars/useYoutube";
import { BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";
import {
  conCodigoDelAlumno, guiaDeBienvenida, mensajeDelRoadmap, perfilDeStack, perfilEfectivo, PERFILES, roadmapYaEnviado, textoDeBienvenida,
} from "@/lib/bienvenida-alumno";
import { fechaLarga } from "@/lib/format";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import type { Contrato, EventoContrato } from "@/lib/contratos";
import { leerContratos, pedirContratoYRoadmap, type RoadmapPedido } from "./cliente";

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

  if (!contrato) return null;
  const guia = guiaDeBienvenida({ reserva: contrato.datos.reserva, programa: contrato.programa, perfil: perfilEfectivo(contrato.datos.perfil, stackDeLaFicha), config });
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
  return (
    <BloqueServicio titulo="Bienvenida" extra={
      contrato.bienvenidaMailEn
        ? <span className="hs-chip hs-chip--ok">Le llegó por mail</span>
        : <span className={`hs-chip${firmado ? " hs-chip--ambar" : ""}`}>{firmado ? "Mandásela vos" : "Sale al firmar"}</span>
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
        detalle={contrato.bienvenidaMailEn ? undefined : "Todavía no sale solo: copiá el mensaje y mandáselo por WhatsApp o mail."}>
        {contrato.bienvenidaMailEn
          ? <span className="t-num">{fechaLarga(contrato.bienvenidaMailEn)}</span>
          : <Button sm variante="secondary" icono={<Copy size={14} />} disabled={copiando} onClick={() => void copiar()}>Copiar el mensaje</Button>}
      </FilaServicio>
    </BloqueServicio>
  );
}
