"use client";

import React, { useEffect, useState } from "react";
import { Check, Link2, Plug, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHead } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import { conectarAnalytics, desconectarAnalytics, useConexionYoutube } from "@/components/webinars/useVivo";

/* ==================================================================
   YouTube, en Ajustes → Integraciones.

   Dos piezas, las dos del lado del servidor:
   - La clave de la API (YOUTUBE_API_KEY, en Vercel): los datos públicos de
     cada video y el vivo minuto a minuto con su chat.
   - YouTube Analytics: alguien con acceso al canal lo conecta una vez con
     Google y quedan la retención, las fuentes y los espectadores por
     minuto de los vivos pasados. Se conecta desde acá, sin tener que
     buscar un webinar con video.
   ================================================================== */

export function YoutubeIntegracion() {
  const toast = useToast();
  const yo = useUsuarioActual();
  const estado = useConexionYoutube();
  const [yendo, setYendo] = useState(false);
  const [desconectar, setDesconectar] = useState(false);

  /* Vuelta de Google después de conectar el canal. */
  useEffect(() => {
    const u = new URL(window.location.href);
    const r = u.searchParams.get("youtube");
    if (!r) return;
    const textos: Record<string, [string, "ok" | "err"]> = {
      "conectado": ["YouTube Analytics quedó conectado.", "ok"],
      "cancelado": ["Se canceló la conexión con YouTube.", "err"],
      "sin-canal": ["Esa cuenta de Google no tiene un canal de YouTube.", "err"],
      "sin-permiso-largo": ["Google no dio el permiso permanente. Probá de nuevo.", "err"],
    };
    const [texto, tono] = textos[r] ?? ["No se pudo conectar YouTube Analytics.", "err"];
    toast(texto, tono);
    u.searchParams.delete("youtube");
    window.history.replaceState(null, "", u.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez al volver de Google
  }, []);

  const d = estado.estado === "listo" ? estado.datos : null;

  async function conectar() {
    setYendo(true);
    const error = await conectarAnalytics(yo.nombre || yo.email || undefined);
    if (error) { toast(error, "err"); setYendo(false); }
  }

  const badge = !d
    ? <Badge variante="neutral">{estado.estado === "error" ? "Sin datos" : "Revisando…"}</Badge>
    : d.conectado
      ? <Badge variante="success" icono={<Check size={13} />}>Conectado</Badge>
      : d.hayClave
        ? <Badge variante="warning" icono={<Plug size={13} />}>Falta Analytics</Badge>
        : <Badge variante="neutral" icono={<Plug size={13} />}>Sin configurar</Badge>;

  return (
    <Card>
      <CardHead
        titulo="YouTube"
        sub="Los vivos de los webinars minuto a minuto, el chat, los comentarios y YouTube Analytics."
        acciones={badge}
      />

      {estado.estado === "error" && (
        <div className="row-wrap">
          <p className="t-sm t-muted" style={{ flex: 1 }}>{estado.error}</p>
          <Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={estado.recargar}>Reintentar</Button>
        </div>
      )}

      {d && (
        <div className="stack-4">
          <div className="wb-filas">
            <div className="wb-fila">
              <span className="wb-fila__texto">
                <span className="wb-fila__nombre">Clave de la API de YouTube</span>
                <span className="wb-fila__detalle">
                  {d.hayClave
                    ? "Trae vistas, likes, comentarios y, mientras el webinar está en el aire, los espectadores de cada minuto y el chat."
                    : "Falta YOUTUBE_API_KEY en Vercel."}
                </span>
              </span>
              <Badge variante={d.hayClave ? "success" : "neutral"}>{d.hayClave ? "Puesta" : "Falta"}</Badge>
            </div>
            <div className="wb-fila">
              <span className="wb-fila__texto">
                <span className="wb-fila__nombre">YouTube Analytics</span>
                <span className="wb-fila__detalle">
                  {d.conectado
                    ? `Canal ${d.canal ?? "sin nombre"}${d.conectadoPor ? ` · lo conectó ${d.conectadoPor}` : ""}${d.conectadoEn ? ` ${relativo(d.conectadoEn)}` : ""}. Retención, fuentes, países y espectadores por minuto de los vivos pasados.`
                    : !d.configurado
                      ? "Falta crear el cliente OAuth de Google y cargar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel."
                      : !d.hayBase
                        ? "Falta SUPABASE_SERVICE_ROLE_KEY: no hay dónde guardar el permiso."
                        : "Lo conecta una vez alguien con acceso al canal de Hackear IT, con su cuenta de Google. El permiso es de sólo lectura."}
                </span>
              </span>
              <Badge variante={d.conectado ? "success" : "neutral"}>{d.conectado ? "Conectado" : "Sin conectar"}</Badge>
            </div>
          </div>

          {d.configurado && d.hayBase && (
            <div className="row-wrap">
              <Button variante={d.conectado ? "secondary" : "primary"} icono={<Link2 size={16} />} disabled={yendo} onClick={conectar}>
                {yendo ? "Abriendo Google…" : d.conectado ? "Conectar otro canal" : "Conectar el canal"}
              </Button>
              {d.conectado && (
                <Button variante="ghost" icono={<Unplug size={16} />} onClick={() => setDesconectar(true)}>Desconectar</Button>
              )}
            </div>
          )}
          {!d.conectado && d.configurado && (
            <p className="t-sm t-subtle">
              Google va a decir que la app no está verificada: tocá «Configuración avanzada» → «Ir a Apicanta ERP». Es la app
              de ustedes, con permiso de sólo lectura.
            </p>
          )}
        </div>
      )}

      <Confirmar
        abierto={desconectar} onCerrar={() => setDesconectar(false)}
        titulo="¿Desconectar YouTube Analytics?" confirmarTexto="Desconectar"
        texto="Los webinars dejan de mostrar la retención, la audiencia y los espectadores por minuto de los vivos pasados. Lo guardado minuto a minuto durante los vivos queda. Se puede volver a conectar cuando quieras."
        onConfirmar={async () => {
          const error = await desconectarAnalytics();
          if (error) toast(error, "err");
          else { toast("YouTube Analytics quedó desconectado."); estado.recargar(); }
        }}
      />
    </Card>
  );
}
