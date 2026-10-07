"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, MessageCircle, Users, X } from "lucide-react";
import { Card, CardHead, Empty, IconButton, Select } from "@/components/ui/ui";
import { InfoMetrica, type PropsInfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { num, relativo } from "@/lib/format";
import { nivelEn } from "@/lib/permisos";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { useEstado } from "@/lib/store";
import { sugerirWebinar, type GrupoWhatsapp as Grupo } from "@/lib/whatsapp";
import { useAhora, useGrupoDeWebinar } from "@/lib/whatsapp-cliente";
import type { Webinar } from "@/lib/types";
import { EstadoLectorBadge, useEstadoDelLector } from "./EstadoLector";
import "./whatsapp.css";

/* ==================================================================
   El grupo de WhatsApp de un webinar, en su ficha.

   El lector (servicios/whatsapp-lector) mira los grupos y la app sabe quién
   está adentro. Acá se elige cuál es el grupo de este webinar (puede haber
   varios: WhatsApp deja 1.024 por grupo) y se ve cómo viene. Quién de los que
   se anotaron entró y quién no, con las marcas «Unido» y «Contactado», se
   trabaja en Formularios: ahí la lista de registros ya lleva el estado que
   dice el lector.
   ================================================================== */

function Kpi({ etiqueta, valor, nota, info }: {
  etiqueta: string; valor: string; nota?: string; info: Omit<PropsInfoMetrica, "titulo">;
}) {
  return (
    <div className="wa-kpi">
      <span className="wa-kpi__etiqueta">{etiqueta}<InfoMetrica {...info} titulo={etiqueta} /></span>
      <span className="wa-kpi__valor">{valor}</span>
      {nota && <span className="wa-kpi__nota">{nota}</span>}
    </div>
  );
}

export function GrupoWhatsapp({ w }: { w: Webinar }) {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puedeAtar = nivelEn(acceso, "webinars") >= 2;
  const lector = useEstadoDelLector();
  const g = useGrupoDeWebinar(w.id);
  const ahora = useAhora();

  const datos = g.datos;
  const grupos = datos?.grupos ?? [];
  const hayGrupo = grupos.length > 0;
  const enElGrupo = datos?.dentro.length ?? 0;
  const sinTelefonoVisible = grupos.reduce((a, x) => a + x.sinTelefono, 0);
  const ultimaFoto = grupos.map((x) => x.ultimaFoto).filter((x): x is string => Boolean(x)).sort().at(-1);

  const fallo = (err: unknown, porDefecto: string) => toast(err instanceof Error ? err.message : porDefecto, "err");
  async function atar(grupoId: string) {
    try { await g.atar(grupoId); toast("Listo: el grupo quedó atado a este webinar."); }
    catch (err) { fallo(err, "No se pudo atar el grupo."); }
  }
  async function soltar(grupo: Grupo) {
    try {
      await g.soltar(grupo.id);
      toast(`«${grupo.nombre || "El grupo"}» ya no es de este webinar.`, "ok", { texto: "Deshacer", onClick: () => void g.atar(grupo.id).catch((err) => fallo(err, "No se pudo deshacer.")) });
    } catch (err) { fallo(err, "No se pudo sacar el grupo."); }
  }

  /* Los grupos que se pueden agregar: los que detectó el lector y todavía no son de este webinar, el sugerido por el nombre primero. */
  const detectados = lector.datos?.grupos ?? [];
  const candidatos = useMemo(() => {
    const ya = new Set(grupos.map((x) => x.id));
    return detectados
      .filter((x) => !ya.has(x.id))
      .map((x) => ({ g: x, sugerido: sugerirWebinar(x.nombre, e.webinars, ahora)?.webinarId === w.id }))
      .sort((a, b) => Number(b.sugerido) - Number(a.sugerido) || Number(Boolean(a.g.webinarId)) - Number(Boolean(b.g.webinarId)) || a.g.nombre.localeCompare(b.g.nombre, "es"));
  }, [detectados, grupos, e.webinars, w.id, ahora]);
  const tituloDe = (id: string | null) => (id ? e.webinars.find((x) => x.id === id)?.titulo ?? "otro webinar" : "");

  if (g.sinAcceso) return null;

  if (datos && !datos.tablas) {
    return (
      <Card>
        <CardHead titulo="Grupo de WhatsApp" sub="Quién se unió y quién no." />
        <Empty
          icono={<Users size={22} />} titulo="Falta preparar la base para esto"
          texto="Hay que correr supabase/whatsapp-lector.sql en Supabase. Después, acá se elige el grupo de este webinar."
        />
      </Card>
    );
  }

  const sub = !datos ? "Mirando el grupo…"
    : hayGrupo
      ? `El lector lo mira solo${ultimaFoto ? `: la última lista que mandó es ${relativo(ultimaFoto)}` : ""}.`
      : "Elegí el grupo de este webinar y la app sabe quién se unió.";

  return (
    <Card style={{ padding: 0 }}>
      <div className="wa-cabeza">
        <CardHead
          titulo="Grupo de WhatsApp" sub={sub}
          acciones={lector.hayLector ? <EstadoLectorBadge estado={lector.estado} /> : undefined}
        />

        {g.error && !datos && (
          <p className="t-sm" style={{ color: "var(--danger)" }} role="alert">
            No pude traer el grupo de WhatsApp: {g.error}{" "}
            <button type="button" className="link" onClick={() => void g.recargar()}>Reintentar</button>
          </p>
        )}

        {/* Los grupos de este webinar y cómo agregar otro. */}
        {(hayGrupo || (puedeAtar && candidatos.length > 0)) && (
          <div className="wa-grupos">
            {grupos.map((x) => (
              <span key={x.id} className="wa-grupo">
                <MessageCircle size={14} aria-hidden />
                <span className="wa-grupo__nombre" title={x.nombre}>{x.nombre || x.id}</span>
                <span className="wa-grupo__datos t-num">{num(x.miembros)} adentro</span>
                {x.sinTelefono > 0 && (
                  <span className="wa-grupo__datos wa-grupo__datos--aviso" title="WhatsApp muestra a estos participantes sin su teléfono: no se pueden comparar con la gente que se anotó.">
                    {num(x.sinTelefono)} sin teléfono visible
                  </span>
                )}
                {puedeAtar && (
                  <IconButton etiqueta={`Sacar «${x.nombre || x.id}» de este webinar`} onClick={() => void soltar(x)}>
                    <X size={14} aria-hidden />
                  </IconButton>
                )}
              </span>
            ))}
            {puedeAtar && candidatos.length > 0 && (
              <div className="wa-agregar">
                <Select
                  aria-label="Atar un grupo de WhatsApp a este webinar" value="" placeholder={hayGrupo ? "Agregar otro grupo…" : "Elegí el grupo de este webinar…"}
                  onChange={(ev) => { if (ev.target.value) void atar(ev.target.value); }}
                  opciones={candidatos.map(({ g: x, sugerido }) => ({
                    valor: x.id,
                    texto: `${sugerido ? "Sugerido · " : ""}${x.nombre || x.id} · ${num(x.miembros)} adentro${x.webinarId ? ` · es de «${tituloDe(x.webinarId)}»` : ""}`,
                  }))}
                />
              </div>
            )}
          </div>
        )}

        {datos && !hayGrupo && candidatos.length === 0 && (
          <p className="t-sm t-muted">
            {lector.hayLector
              ? "El lector todavía no detectó ningún grupo. Cuando el número del lector esté en el grupo de este webinar, aparece solo."
              : <>El lector de WhatsApp todavía no se conectó. Cuando esté andando, detecta los grupos solo y acá elegís el de este webinar.{" "}
                <Link href="/ajustes?seccion=whatsapp" className="link">Ver cómo se conecta</Link></>}
          </p>
        )}

        {hayGrupo && (
          <>
            <div className="wa-kpis wa-kpis--tres">
              <Kpi
                etiqueta="En el grupo" valor={num(enElGrupo)}
                nota={`${grupos.length === 1 ? "en 1 grupo" : `en ${num(grupos.length)} grupos`}`}
                info={{
                  ayuda: "Los teléfonos que hoy están adentro del grupo (o de los grupos) de este webinar, según el lector.",
                  componentes: () => [
                    ...grupos.map((x) => ({ concepto: x.nombre || x.id, valor: num(x.miembros), signo: "+" as const })),
                    { concepto: "Teléfonos distintos adentro", valor: num(enElGrupo), signo: "=" as const, nota: "quien está en dos grupos cuenta una vez" },
                  ],
                  ejemplo: w.grupoWpp > 0
                    ? `En la planilla de Webinars, «Grupo» dice ${num(w.grupoWpp)}: ese número se carga a mano y esto no lo cambia.`
                    : undefined,
                }}
              />
              <Kpi
                etiqueta="Sin teléfono visible" valor={num(sinTelefonoVisible)}
                nota={sinTelefonoVisible > 0 ? "WhatsApp no deja ver su número" : "Se ve el número de todos"}
                info={{
                  ayuda: "Participantes que WhatsApp muestra por un código interno, sin su teléfono. Se cuentan pero no se pueden comparar con la gente que se anotó, así que quien tiene su número oculto puede figurar como que no entró.",
                  componentes: () => grupos.map((x) => ({ concepto: x.nombre || x.id, valor: num(x.sinTelefono) })),
                }}
              />
              <Kpi
                etiqueta="Última lista" valor={ultimaFoto ? relativo(ultimaFoto) : "—"}
                nota="el lector la repite cada tanto y avisa cada entrada y salida"
                info={{
                  ayuda: "Cuándo mandó el lector la última lista completa de quienes están en el grupo. Entre una lista y otra avisa cada vez que alguien entra o sale.",
                }}
              />
            </div>
            <div>
              <Link href={`/formularios?webinar=${diaArgentina(w.fecha)}`} className="hk-btn hk-btn--secondary">
                Ver quién se unió y quién no<ArrowRight size={16} aria-hidden />
              </Link>
              <p className="t-sm t-subtle" style={{ marginTop: 6 }}>
                En Formularios cada persona que se anotó dice si está en el grupo, y ahí mismo se marca a quién ya se le escribió.
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
