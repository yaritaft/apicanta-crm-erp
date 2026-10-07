"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Lock, MessageCircle, Plug, QrCode, RefreshCw, Smartphone, WifiOff } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Select } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { diaCorto } from "@/components/webinars/fechas";
import { useAcceso } from "@/lib/acceso";
import { num, relativo } from "@/lib/format";
import { nivelEn } from "@/lib/permisos";
import { useEstado } from "@/lib/store";
import { estadoDelLector, ordenarGrupos, rotuloDeGrupo, sugerirWebinar, type EstadoLector, type GrupoWhatsapp } from "@/lib/whatsapp";
import { atarGrupoAWebinar, useAhora, useLectorEnVivo } from "@/lib/whatsapp-cliente";
import "@/components/webinars/whatsapp.css";

/* ==================================================================
   Ajustes → WhatsApp: el lector de WhatsApp, su conexión y los grupos que detectó.

   El lector es un servicio aparte (servicios/whatsapp-lector), con un número
   conectado en un servidor propio, que LEE los grupos y le avisa a la app
   quién entra y quién sale. Nunca manda mensajes.

   Para vincular el número no hace falta una terminal: cuando WhatsApp pide
   escanear, el lector manda el código QR a la app y se escanea desde acá, con
   el teléfono del número dedicado (WhatsApp → Dispositivos vinculados →
   Vincular un dispositivo). El código se renueva solo y desaparece al conectarse.
   Es una credencial (quien lo escanea lee ese WhatsApp): lo ve sólo quien edita
   Ajustes; los demás ven el estado.
   ================================================================== */

const ICONO: Record<EstadoLector["tipo"], React.ReactNode> = {
  "nunca": <Plug size={22} aria-hidden />,
  "conectado": <Check size={22} aria-hidden />,
  "esperando-qr": <QrCode size={22} aria-hidden />,
  "reconectando": <RefreshCw size={22} aria-hidden />,
  "cerrado": <AlertTriangle size={22} aria-hidden />,
  "sin-senal": <WifiOff size={22} aria-hidden />,
  "caido": <WifiOff size={22} aria-hidden />,
};

export function WhatsappLector() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puedeAtar = nivelEn(acceso, "webinars") >= 2;
  const l = useLectorEnVivo();
  const ahora = useAhora(15_000);
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const datos = l.datos;
  const lector = datos?.lector ?? null;
  const grupos = useMemo(() => ordenarGrupos(datos?.grupos ?? []), [datos?.grupos]);
  const estado = useMemo(() => estadoDelLector(lector, ahora), [lector, ahora]);

  /* Al conectarse (con la pantalla abierta, después de haber estado esperando o reconectando) se avisa. */
  const antes = useRef<EstadoLector["tipo"] | null>(null);
  useEffect(() => {
    const t = estado.tipo;
    if (antes.current && antes.current !== "conectado" && antes.current !== "nunca" && t === "conectado") {
      const mensaje = `Conectado: vigila ${num(lector?.grupos ?? 0)} ${lector?.grupos === 1 ? "grupo" : "grupos"}.`;
      setAviso(mensaje);
      toast(mensaje);
      const r = setTimeout(() => setAviso(null), 12_000);
      antes.current = t;
      return () => clearTimeout(r);
    }
    antes.current = t;
    return undefined;
  }, [estado.tipo, lector?.grupos, toast]);

  /* Los más nuevos primero: el webinar de esta semana es el que se busca. */
  const webinars = useMemo(() => [...e.webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.webinars]);
  const opcionesWebinar = useMemo(
    () => [{ valor: "", texto: "Sin atar a ningún webinar" }, ...webinars.map((w) => ({ valor: w.id, texto: `${diaCorto(w.fecha)} · ${w.titulo}` }))],
    [webinars],
  );
  const tituloDe = (id: string) => e.webinars.find((w) => w.id === id)?.titulo ?? "ese webinar";
  const sugerido = (g: GrupoWhatsapp) => (g.webinarId ? null : sugerirWebinar(g.nombre, e.webinars, ahora));
  const porAtar = grupos.map((g) => ({ g, s: sugerido(g) })).filter((x): x is { g: GrupoWhatsapp; s: NonNullable<ReturnType<typeof sugerido>> } => x.s !== null);

  async function actualizar() {
    setActualizando(true);
    await l.recargar();
    setActualizando(false);
  }

  async function atar(g: GrupoWhatsapp, webinarId: string | null) {
    try {
      await atarGrupoAWebinar(g.id, webinarId);
      await l.recargar();
      toast(webinarId ? `«${g.nombre || "El grupo"}» es del webinar «${tituloDe(webinarId)}».` : `«${g.nombre || "El grupo"}» quedó sin webinar.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar.", "err");
    }
  }

  async function atarSugeridos() {
    let hechos = 0;
    try {
      for (const { g, s } of porAtar) { await atarGrupoAWebinar(g.id, s.webinarId); hechos++; }
      toast(`Listo: ${num(hechos)} ${hechos === 1 ? "grupo atado" : "grupos atados"} a su webinar.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudieron atar todos.", "err");
    }
    await l.recargar();
  }

  const columnas: Columna<GrupoWhatsapp>[] = [
    {
      clave: "nombre", titulo: "Grupo", tipo: "primary", orden: (g) => (g.nombre || g.id).toLowerCase(),
      celda: (g) => (
        <span className="wa-grupo-fila">
          <span className="wa-grupo-fila__nombre">
            {g.nombre || "Sin nombre"}
            {rotuloDeGrupo(g.nombre) && <span className="wa-rotulo"><Badge variante="neutral">{rotuloDeGrupo(g.nombre)}</Badge></span>}
          </span>
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
        const s = sugerido(g);
        return (
          <div className="wa-selector-webinar">
            <Select
              aria-label={`Webinar de «${g.nombre || g.id}»`} value={g.webinarId ?? ""} disabled={!puedeAtar}
              onChange={(ev) => void atar(g, ev.target.value || null)} opciones={opcionesWebinar}
            />
            {s && puedeAtar && (
              <span className="wa-sugerencia" title={s.motivo}>
                Sugerido: «{tituloDe(s.webinarId)}»
                <Button sm variante="secondary" onClick={() => void atar(g, s.webinarId)}>Atar</Button>
              </span>
            )}
            {!g.webinarId && !s && <span className="wa-sugerencia">El nombre no trae una fecha de un webinar cargado: elegilo a mano.</span>}
          </div>
        );
      },
    },
  ];

  const esperando = estado.tipo === "esperando-qr";
  const cuentaGrupos = lector?.grupos ?? 0;

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="Lector de WhatsApp"
          sub="Un número de WhatsApp dedicado, conectado en un servidor propio, que lee los grupos de los talleres para saber solo quién se unió. Nunca manda mensajes ni marca nada como leído."
          acciones={<Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={actualizando} onClick={() => void actualizar()}>Actualizar</Button>}
        />
        {l.cargando && !datos ? (
          <div className="skeleton" style={{ height: 96 }} />
        ) : l.sinAcceso ? (
          <p className="t-sm t-muted">
            Tu tipo de cuenta no ve el estado de WhatsApp: lo ven quienes ven los Webinars sin estar limitados a lo suyo (y el código para vincular el número, quien edita Ajustes).
            Pedile a un dueño que te dé acceso.
          </p>
        ) : !datos ? (
          <p className="t-sm" style={{ color: "var(--danger)" }} role="alert">
            No pude preguntarle a la app: {l.error}{" "}
            <button type="button" className="link" onClick={() => void actualizar()}>Reintentar</button>
          </p>
        ) : (
          <div className="stack-4">
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

            {/* Si la última pregunta falló pero hay datos de antes, se dice: lo que se ve puede estar viejo (y el código, vencido, ya no está). */}
            {l.error && (
              <p className="t-sm" style={{ color: "var(--danger)" }} role="alert">
                No pude actualizar desde la app: {l.error} Lo que ves puede estar desactualizado.{" "}
                <button type="button" className="link" onClick={() => void actualizar()}>Reintentar</button>
              </p>
            )}

            {/* El estado, grande: lo primero que hay que saber. */}
            <div className={`wa-estado-grande wa-estado-grande--${estado.tono}`} role="status" aria-live="polite">
              <span className="wa-estado-grande__icono">{ICONO[estado.tipo]}</span>
              <div style={{ minWidth: 0 }}>
                <div className="wa-estado-grande__titulo">{estado.titulo}</div>
                <div className="wa-estado-grande__detalle">{estado.detalle}</div>
              </div>
            </div>

            {aviso && (
              <p className="wa-conectado-aviso" role="status"><Check size={16} aria-hidden /> {aviso}</p>
            )}

            {/* Hay que vincular el número: el código QR, para escanear desde acá. */}
            {esperando && (
              datos.puedeVerQr ? (
                <div className="wa-qr">
                  <div className="wa-qr__marco">
                    {datos.qr ? (
                      // eslint-disable-next-line @next/next/no-img-element -- una imagen en data URL que se renueva sola; next/image no aporta nada
                      <img className="wa-qr__imagen" src={datos.qr} alt="Código QR para vincular el número del lector" width={264} height={264} />
                    ) : (
                      <div className="wa-qr__espera" aria-live="polite">
                        {datos.qrSinTabla ? "Falta preparar la base para ver el código acá." : "Esperando el código… el lector lo manda en unos segundos."}
                      </div>
                    )}
                  </div>
                  <div className="stack-3" style={{ minWidth: 0 }}>
                    <h3 className="wa-qr__titulo"><Smartphone size={18} aria-hidden /> Vinculá el número del lector</h3>
                    <ol className="wa-pasos">
                      <li>En el teléfono del número dedicado: <strong>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</strong>.</li>
                      <li>Escaneá este código con la cámara que se abre.</li>
                      <li>Cuando se conecta, el código desaparece y acá dice «Conectado».</li>
                    </ol>
                    <p className="t-sm t-subtle">El código se renueva solo cada pocos segundos: dejá esta pantalla abierta hasta que se conecte.</p>
                    <p className="wa-qr__cuidado"><Lock size={14} aria-hidden /> Este código da acceso a ese WhatsApp. No lo compartas ni le saques una captura.</p>
                    {datos.qrSinTabla && (
                      <p className="t-sm" style={{ color: "var(--warning)" }}>
                        Falta correr <code className="wa-codigo">supabase/whatsapp-lector-qr.sql</code> en la base. Mientras tanto se puede escanear desde la terminal del servidor
                        (guía en <code className="wa-codigo">servicios/whatsapp-lector/README.md</code>).
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="t-sm t-muted wa-qr__sin-permiso">
                  <Lock size={14} aria-hidden /> El lector está esperando que lo vinculen. El código lo ve sólo un dueño (o quien edita Ajustes): pedile que abra esta pantalla y
                  lo escanee con el teléfono del número del lector.
                </p>
              )
            )}

            {lector && (
              <dl className="dl wb-dl">
                <dt>Último latido</dt><dd>{relativo(lector.ultimoLatido)}</dd>
                <dt>Conectado a WhatsApp</dt>
                <dd>
                  {lector.conectado
                    ? <span className="row-3" style={{ gap: 4, color: "var(--success)" }}><Check size={14} aria-hidden /> Sí</span>
                    : lector.ultimaConexion ? `No. La última vez fue ${relativo(lector.ultimaConexion)}.` : "Todavía no"}
                </dd>
                <dt>Grupos que vigila</dt><dd>{num(cuentaGrupos)}</dd>
                <dt>Prendido desde</dt><dd>{relativo(lector.desde ?? lector.ultimoLatido)}</dd>
              </dl>
            )}

            <details className="t-sm">
              <summary className="link" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plug size={14} aria-hidden /> Cómo se conecta</summary>
              <ol className="wa-pasos" style={{ marginTop: 8 }}>
                <li>En Supabase, correr <code>supabase/whatsapp-lector.sql</code> y <code>supabase/whatsapp-lector-qr.sql</code>.</li>
                <li>En Vercel, poner <code>WHATSAPP_LECTOR_TOKEN</code> (un secreto largo que se inventa) y volver a publicar.</li>
                <li>
                  En el servidor (Ubuntu, en Hostinger): copiar la carpeta <code>servicios/whatsapp-lector</code>, completar su <code>.env</code> con la dirección de
                  esta app y el mismo token, y dejarla corriendo como servicio (systemd).
                </li>
                <li>Volver a esta pantalla: aparece el código QR. Escanearlo con el teléfono del número dedicado.</li>
                <li>Agregar ese número a los grupos de los talleres, como a cualquier persona.</li>
              </ol>
              <p className="t-sm t-subtle" style={{ marginTop: 8 }}>
                Es una conexión no oficial de WhatsApp Web: conviene un número dedicado, no el principal del negocio. La guía paso a paso está en{" "}
                <code className="wa-codigo">servicios/whatsapp-lector/README.md</code>.
              </p>
            </details>
          </div>
        )}
      </Card>

      {datos && datos.tablas && datos.sinGrupos && (
        <p className="t-sm t-muted">Tu tipo de cuenta no ve los Webinars: acá se ve el estado del lector y el código para vincularlo, pero no los grupos.</p>
      )}

      {datos && datos.tablas && !datos.sinGrupos && (
        <Card style={{ padding: 0 }}>
          <div className="wa-cabeza">
            <CardHead
              titulo="Grupos detectados"
              sub="Los grupos en los que está el número del lector. Cada taller tiene varios (WhatsApp deja 1.024 por grupo: «Taller Online 08/10/26 #1», #2…): se atan todos al mismo webinar, y la app sugiere cuál por la fecha del nombre."
              acciones={porAtar.length > 0 && puedeAtar
                ? <Button sm variante="secondary" onClick={() => void atarSugeridos()}>Atar los {num(porAtar.length)} {porAtar.length === 1 ? "sugerido" : "sugeridos"}</Button>
                : undefined}
            />
          </div>
          <DataTable
            filas={grupos}
            columnas={columnas}
            ordenInicial={{ clave: "nombre", desc: false }}
            etiquetaFila={(g) => g.nombre || g.id}
            vacio={
              <Empty
                icono={<MessageCircle size={22} />} titulo="Todavía no se detectó ningún grupo"
                texto={lector
                  ? "El lector está andando pero no ve grupos que coincidan con su GRUPOS_REGEX. Revisá que su número esté en los grupos de los talleres."
                  : "Cuando el lector se conecte, los grupos aparecen solos."}
              />
            }
          />
        </Card>
      )}
    </div>
  );
}
