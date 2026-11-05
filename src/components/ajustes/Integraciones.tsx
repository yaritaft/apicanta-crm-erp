"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useEstado } from "@/lib/store";
import { num, relativo } from "@/lib/format";
import { cabeceras } from "@/components/webinars/useYoutube";
import { useParamsURL } from "@/lib/useParamsURL";
import { useAcceso } from "@/lib/acceso";
import { Conexion, type EstadoConexion } from "./Conexion";
import { FormulariosMeta } from "./FormulariosMeta";
import { ConversionsApi } from "./ConversionsApi";
import { FathomIntegracion } from "./FathomIntegracion";
import { YoutubeIntegracion } from "./YoutubeIntegracion";
import { BancoIntegracion } from "./BancoIntegracion";
import { AccesosAlumnosIntegracion } from "./AccesosAlumnosIntegracion";

/* ==================================================================
   Ajustes → Integraciones: lo que entra solo. Una fila por conexión con
   su estado, agrupadas por para qué sirven; lo que pide algo dice qué
   en la misma fila y se abre solo. Nada de esto hace falta para que la
   app ande: sin una conexión, eso se carga a mano. Las claves viven en
   el servidor (Vercel), nunca en esta pantalla.
   ================================================================== */

export function Integraciones() {
  const [, cambiar] = useParamsURL({ seccion: "negocio" });
  const { esDueno } = useAcceso();
  return (
    <div className="aj-conexiones">
      <Grupo titulo="Marketing">
        <EstadoMeta />
        <FormulariosMeta />
        <ConversionsApi />
        <YoutubeIntegracion />
      </Grupo>
      <Grupo titulo="Ventas">
        <EstadoCalendly />
        <FathomIntegracion />
      </Grupo>
      <Grupo titulo="Finanzas">
        <BancoIntegracion />
      </Grupo>
      <Grupo titulo="Alumnos">
        <AccesosAlumnosIntegracion onConfigurar={esDueno ? () => cambiar({ seccion: "contratos" }) : undefined} />
      </Grupo>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="aj-conexiones__grupo" aria-label={titulo}>
      <h2 className="aj-conexiones__titulo">{titulo}</h2>
      <div className="aj-conexiones__lista">{children}</div>
    </section>
  );
}

/* Meta se conecta del lado del servidor: con el token del negocio (META_SYSTEM_TOKEN, en Vercel) o con el login de
   Meta desde Marketing. Acá se pregunta a la misma ruta que usa Marketing si está andando. */
function EstadoMeta() {
  const [estado, setEstado] = useState<
    { conectado: boolean; porSistema?: boolean; cuentas?: { id: string; nombre: string }[]; motivo?: string } | null
  >(null);
  useEffect(() => {
    let vivo = true;
    cabeceras()
      .then((headers) => fetch("/api/meta/cuentas", { cache: "no-store", headers }))
      .then((r) => r.json())
      .then((j) => { if (vivo) setEstado(j); })
      .catch(() => { if (vivo) setEstado({ conectado: false, motivo: "error" }); });
    return () => { vivo = false; };
  }, []);

  /* Meta frenó por límite: la conexión está bien, sólo hay que esperar. */
  const conectado = Boolean(estado?.conectado || estado?.motivo === "limite");
  const cuentas = estado?.cuentas ?? [];
  const tono: EstadoConexion = estado === null
    ? { tono: "revisando", texto: "Revisando…" }
    : conectado
      ? { tono: "bien", texto: "Conectado" }
      : {
        tono: "atencion", texto: "Sin conectar",
        detalle: estado.motivo === "sin-configurar"
          ? "Falta el token del negocio (META_SYSTEM_TOKEN) en el servidor."
          : estado.motivo === "error" ? "Meta no respondió bien: probá en un rato." : "Falta conectar la cuenta de Meta: se hace con un clic desde Marketing.",
      };

  return (
    <Conexion id="meta" titulo="Meta Ads" que="La inversión, las campañas y los anuncios, solos en Marketing." estado={tono}>
      <p className="t-sm t-muted">
        {conectado
          ? estado?.porSistema
            ? "Con el token del negocio, en el servidor: no depende de quién tenga la sesión abierta."
            : "Con tu sesión de Meta, en este navegador."
          : tono.detalle}
        {conectado && cuentas.length > 0 && ` ${num(cuentas.length)} ${cuentas.length === 1 ? "cuenta publicitaria" : "cuentas publicitarias"}: ${cuentas.map((c) => c.nombre).join(", ")}.`}
      </p>
      <p className="t-sm" style={{ marginTop: 8 }}>
        <Link href="/marketing" className="link">{conectado ? "Ver en Marketing" : "Ir a Marketing para conectar"}</Link>
      </p>
    </Conexion>
  );
}

/* Calendly se conecta del lado del servidor: el token vive en Vercel, no en esta pantalla. Acá sólo se muestra si está
   andando, preguntándole al propio webhook, y qué entró. */
function EstadoCalendly() {
  const e = useEstado();
  const [listo, setListo] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/calendly/webhook")
      .then((r) => r.json())
      .then((j: { listo?: boolean }) => { if (vivo) setListo(Boolean(j.listo)); })
      .catch(() => { if (vivo) setListo(false); });
    return () => { vivo = false; };
  }, []);
  /* Sólo las que trajo la integración: tienen el invitado de Calendly. Los datos de ejemplo también dicen origen
     "calendly" y harían creer que ya entraron llamadas que nunca existieron. */
  const deCalendly = e.sesiones.filter((s) => s.calendlyInvitadoUri);
  const ultima = deCalendly.reduce<string | null>((m, s) => (!m || s.creadoEn > m ? s.creadoEn : m), null);
  const tono: EstadoConexion = listo === null
    ? { tono: "revisando", texto: "Revisando…" }
    : listo
      ? { tono: "bien", texto: "Conectado" }
      : { tono: "atencion", texto: "Sin configurar", detalle: "Falta el token de Calendly y la firma del webhook en el servidor." };

  return (
    <Conexion
      id="calendly" titulo="Calendly"
      que={deCalendly.length ? `Cada agenda entra sola a la Agenda · ${num(deCalendly.length)} llamadas, la última ${relativo(ultima ?? "")}.` : "Cada agenda, cancelación y no-show entra sola a la Agenda."}
      estado={tono}
    >
      <p className="t-sm t-muted">
        {listo
          ? "Entra en segundos por webhook, y cada 30 minutos se repescan las que se hayan perdido. Trae el canal, los UTMs y lo que la persona contestó en el formulario."
          : tono.detalle}
      </p>
    </Conexion>
  );
}
