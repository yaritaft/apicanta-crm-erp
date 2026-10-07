"use client";

import React, { useMemo, useState } from "react";
import { Check, MessageCircle, Plug, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Select } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { EstadoLectorBadge, useEstadoDelLector } from "@/components/webinars/EstadoLector";
import { diaCorto } from "@/components/webinars/fechas";
import { useAcceso } from "@/lib/acceso";
import { num, relativo } from "@/lib/format";
import { nivelEn } from "@/lib/permisos";
import { useEstado } from "@/lib/store";
import { sugerirWebinar, type GrupoWhatsapp } from "@/lib/whatsapp";
import { atarGrupoAWebinar, useAhora } from "@/lib/whatsapp-cliente";
import "@/components/webinars/whatsapp.css";

/* ==================================================================
   Ajustes → WhatsApp: el lector de WhatsApp y los grupos que detectó.

   El lector es un servicio aparte (servicios/whatsapp-lector), con un número
   conectado por QR en un servidor propio, que LEE los grupos y le avisa a la
   app quién entra y quién sale. Nunca manda mensajes. Acá se ve si está vivo,
   qué grupos detectó y a qué webinar corresponde cada uno; la ficha de cada
   webinar usa eso para decir quién se unió.
   ================================================================== */

export function WhatsappLector() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puedeAtar = nivelEn(acceso, "webinars") >= 2;
  const l = useEstadoDelLector();
  const ahora = useAhora();
  const [actualizando, setActualizando] = useState(false);

  const datos = l.datos;
  const lector = datos?.lector ?? null;
  const grupos = datos?.grupos ?? [];

  /* Los más nuevos primero: el webinar de esta semana es el que se busca. */
  const webinars = useMemo(() => [...e.webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.webinars]);
  const opcionesWebinar = useMemo(
    () => [{ valor: "", texto: "Sin atar a ningún webinar" }, ...webinars.map((w) => ({ valor: w.id, texto: `${diaCorto(w.fecha)} · ${w.titulo}` }))],
    [webinars],
  );
  const tituloDe = (id: string) => e.webinars.find((w) => w.id === id)?.titulo ?? "ese webinar";

  async function actualizar() {
    setActualizando(true);
    await l.recargar();
    setActualizando(false);
  }

  async function atar(g: GrupoWhatsapp, webinarId: string | null) {
    try {
      await atarGrupoAWebinar(g.id, webinarId);
      toast(webinarId ? `«${g.nombre || "El grupo"}» es del webinar «${tituloDe(webinarId)}».` : `«${g.nombre || "El grupo"}» quedó sin webinar.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar.", "err");
    }
  }

  const columnas: Columna<GrupoWhatsapp>[] = [
    {
      clave: "nombre", titulo: "Grupo", tipo: "primary", orden: (g) => (g.nombre || g.id).toLowerCase(),
      celda: (g) => (
        <span className="wa-grupo-fila">
          <span className="wa-grupo-fila__nombre">{g.nombre || "Sin nombre"}</span>
          <span className="t-sm t-subtle">Lo detectó el lector {relativo(g.creadoEn)}</span>
        </span>
      ),
    },
    {
      clave: "miembros", titulo: "Adentro", tipo: "num", orden: (g) => g.miembros,
      celda: (g) => (
        <span className="wa-grupo-fila">
          <span className="t-num t-strong" style={{ color: "var(--ink)" }}>{num(g.miembros)}</span>
          {g.sinTelefono > 0 && (
            <span className="t-sm" style={{ color: "var(--warning)" }} title="WhatsApp muestra a estos participantes sin su teléfono: se cuentan pero no se pueden comparar con la gente de los webinars.">
              + {num(g.sinTelefono)} sin teléfono visible
            </span>
          )}
        </span>
      ),
    },
    {
      clave: "foto", titulo: "Última lista", tipo: "secondary", orden: (g) => (g.ultimaFoto ? Date.parse(g.ultimaFoto) : 0),
      celda: (g) => (g.ultimaFoto ? relativo(g.ultimaFoto) : <span className="t-subtle">Todavía ninguna</span>),
    },
    {
      clave: "webinar", titulo: "Webinar", orden: (g) => (g.webinarId ? tituloDe(g.webinarId).toLowerCase() : ""),
      celda: (g) => {
        const sugerencia = !g.webinarId ? sugerirWebinar(g.nombre, e.webinars, ahora) : null;
        return (
          <div className="wa-selector-webinar">
            <Select
              aria-label={`Webinar de «${g.nombre || g.id}»`} value={g.webinarId ?? ""} disabled={!puedeAtar}
              onChange={(ev) => void atar(g, ev.target.value || null)} opciones={opcionesWebinar}
            />
            {sugerencia && puedeAtar && (
              <span className="wa-sugerencia" title={sugerencia.motivo}>
                Sugerido: «{tituloDe(sugerencia.webinarId)}»
                <Button sm variante="secondary" onClick={() => void atar(g, sugerencia.webinarId)}>Atar</Button>
              </span>
            )}
            {!g.webinarId && !sugerencia && <span className="wa-sugerencia">El nombre no trae una fecha: elegilo a mano.</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="Lector de WhatsApp"
          sub="Un número conectado por QR en un servidor propio que lee los grupos de los webinars para saber solo quién se unió. Nunca manda mensajes ni marca nada como leído."
          acciones={l.hayLector ? <EstadoLectorBadge estado={l.estado} /> : <Badge variante="neutral">Sin conectar</Badge>}
        />
        {l.cargando && !datos ? (
          <div className="skeleton" style={{ height: 96 }} />
        ) : l.sinAcceso ? (
          <p className="t-sm t-muted">Tu tipo de cuenta no ve los Webinars, y los grupos de WhatsApp son de esa parte. Pedile a un dueño que te dé acceso.</p>
        ) : !datos ? (
          <p className="t-sm" style={{ color: "var(--danger)" }} role="alert">
            No pude preguntarle a la app: {l.error}{" "}
            <button type="button" className="link" onClick={() => void actualizar()}>Reintentar</button>
          </p>
        ) : (
          <div className="stack-3">
            {!datos.tablas && (
              <p className="t-sm" style={{ color: "var(--warning)" }}>Falta correr <code className="wa-codigo">supabase/whatsapp-lector.sql</code> en la base.</p>
            )}
            {!datos.configurado && (
              <p className="t-sm" style={{ color: "var(--warning)" }}>
                Falta la variable <code className="wa-codigo">WHATSAPP_LECTOR_TOKEN</code> en Vercel: sin ella la app no acepta nada del lector. Después de agregarla hay que volver a publicar.
              </p>
            )}
            {datos.modo === "prueba-local" && (
              <p className="t-sm t-muted">Estás probando sin base: lo que manda el lector se guarda en un archivo de esta compu, no en Supabase.</p>
            )}

            <p className="t-sm t-muted">{l.estado.detalle}</p>

            {lector && (
              <dl className="dl wb-dl">
                <dt>Último latido</dt><dd>{relativo(lector.ultimoLatido)}</dd>
                <dt>Conectado a WhatsApp</dt>
                <dd>
                  {lector.conectado
                    ? <span className="row-3" style={{ gap: 4, color: "var(--success)" }}><Check size={14} aria-hidden /> Sí</span>
                    : lector.ultimaConexion ? `No. La última vez fue ${relativo(lector.ultimaConexion)}.` : "Todavía no"}
                </dd>
                <dt>Grupos que vigila</dt><dd>{num(lector.grupos)}</dd>
                <dt>Prendido desde</dt><dd>{relativo(lector.desde ?? lector.ultimoLatido)}</dd>
              </dl>
            )}

            <div className="row-wrap" style={{ gap: 8 }}>
              <Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={actualizando} onClick={() => void actualizar()}>Actualizar</Button>
            </div>

            <details className="t-sm">
              <summary className="link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plug size={14} aria-hidden /> Cómo se conecta</summary>
              <ol className="wa-pasos" style={{ marginTop: 8 }}>
                <li>En Supabase, correr <code>supabase/whatsapp-lector.sql</code> (crea las tablas).</li>
                <li>En Vercel, poner <code>WHATSAPP_LECTOR_TOKEN</code> (un secreto largo que se inventa) y volver a publicar.</li>
                <li>
                  En el servidor (Ubuntu, en Hostinger): copiar la carpeta <code>servicios/whatsapp-lector</code>, completar su <code>.env</code> con la dirección de
                  esta app y el mismo token, y correrla. La primera vez muestra un código QR: se escanea desde el teléfono del número del lector
                  (WhatsApp → Dispositivos vinculados).
                </li>
                <li>Agregar ese número a los grupos de los webinars, como a cualquier persona.</li>
              </ol>
              <p className="t-sm t-subtle" style={{ marginTop: 8 }}>
                Es una conexión no oficial de WhatsApp Web: conviene un número dedicado, no el principal del negocio. La guía paso a paso está en{" "}
                <code className="wa-codigo">servicios/whatsapp-lector/README.md</code>.
              </p>
            </details>
          </div>
        )}
      </Card>

      {datos && datos.tablas && (
        <Card style={{ padding: 0 }}>
          <div className="wa-cabeza">
            <CardHead
              titulo="Grupos detectados"
              sub="Los grupos en los que está el número del lector. Cada uno se ata al webinar que corresponde; si un webinar tiene varios grupos (WhatsApp deja 1.024 por grupo), atalos todos al mismo."
            />
          </div>
          <DataTable
            filas={grupos}
            columnas={columnas}
            ordenInicial={{ clave: "foto", desc: true }}
            etiquetaFila={(g) => g.nombre || g.id}
            vacio={
              <Empty
                icono={<MessageCircle size={22} />} titulo="Todavía no se detectó ningún grupo"
                texto={l.hayLector
                  ? "El lector está andando pero no ve grupos que coincidan con su GRUPOS_REGEX. Revisá que su número esté en los grupos de los webinars."
                  : "Cuando el lector se conecte, los grupos aparecen solos."}
              />
            }
          />
        </Card>
      )}
    </div>
  );
}
