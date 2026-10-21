"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Badge, Button, Card, CardHead, type VarianteBadge } from "@/components/ui/ui";
import { cabeceras } from "@/components/webinars/useYoutube";
import { num } from "@/lib/format";
import { hayNube } from "@/lib/store";
import type { EstadoConexion } from "@/lib/accesos-alumnos";
import type { PruebaPandadoc, PruebaTelegram, PruebaWisboo, PruebaZoom } from "@/lib/accesos-alumnos-servidor";

/* ==================================================================
   Accesos de alumnos, en Ajustes → Integraciones: si cada una de las
   cuatro conexiones del onboarding anda, y qué ve con su clave. Es el
   primer paso del onboarding del Loom de Yari (20/10): antes de dar
   accesos solos, saber que las claves cargadas en Vercel sirven.

   Sólo prueba: no conecta el bot, no da accesos, no manda contratos.
   ================================================================== */

export interface Pruebas { telegram: PruebaTelegram; wisboo: PruebaWisboo; pandadoc: PruebaPandadoc; zoom: PruebaZoom }

const ROTULO: Record<EstadoConexion, { texto: string; variante: VarianteBadge }> = {
  ok: { texto: "Anda", variante: "success" },
  falta: { texto: "Falta la clave", variante: "warning" },
  error: { texto: "No anda", variante: "danger" },
};

const comando = (nombre: string) => `vercel env add ${nombre} production --sensitive --scope apicanta`;

export function AccesosAlumnosIntegracion() {
  const [pruebas, setPruebas] = useState<Pruebas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);

  const probar = useCallback(async () => {
    if (!hayNube) return;
    setProbando(true);
    setError(null);
    try {
      const r = await fetch("/api/accesos-alumnos/conexiones", { cache: "no-store", headers: await cabeceras() });
      const j = (await r.json().catch(() => ({}))) as Pruebas & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
      setPruebas(j);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo probar."); }
    setProbando(false);
  }, []);
  useEffect(() => { void probar(); }, [probar]);

  return (
    <Card>
      <CardHead
        titulo="Accesos de alumnos"
        sub="Telegram, Wisboo, PandaDoc y Zoom: lo que hace falta para que el alumno entre solo a sus grupos, su curso y sus reuniones al firmar el contrato. Por ahora sólo se prueba que cada clave sirva."
        acciones={<Button sm variante="ghost" icono={<RefreshCw size={14} />} disabled={probando || !hayNube} cargando={probando} onClick={() => void probar()}>Probar de nuevo</Button>}
      />
      {!hayNube ? (
        <p className="t-sm t-subtle">La app corre en este navegador, sin base: las conexiones se prueban en la app publicada.</p>
      ) : error ? (
        <p className="t-sm" style={{ color: "var(--danger)" }}>{error}</p>
      ) : !pruebas ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <ListaDeConexiones pruebas={pruebas} />
      )}
    </Card>
  );
}

/** Lo que vio cada conexión (separado del pedido para poder dibujarlo con datos de ejemplo). */
export function ListaDeConexiones({ pruebas }: { pruebas: Pruebas }) {
  return (
    <div className="stack-3">
      <Servicio nombre="Telegram" estado={pruebas.telegram.estado}>
        <Telegram p={pruebas.telegram} />
      </Servicio>
      <Servicio nombre="Wisboo" estado={pruebas.wisboo.estado}>
        <Wisboo p={pruebas.wisboo} />
      </Servicio>
      <Servicio nombre="PandaDoc" estado={pruebas.pandadoc.estado}>
        <Pandadoc p={pruebas.pandadoc} />
      </Servicio>
      <Servicio nombre="Zoom" estado={pruebas.zoom.estado}>
        <Zoom p={pruebas.zoom} />
      </Servicio>
    </div>
  );
}

function Servicio({ nombre, estado, children }: { nombre: string; estado: EstadoConexion; children: React.ReactNode }) {
  const r = ROTULO[estado];
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }} aria-label={nombre}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <h3 className="t-body" style={{ margin: 0, fontWeight: 500 }}>{nombre}</h3>
        <Badge variante={r.variante}>{r.texto}</Badge>
      </div>
      <div className="stack-2">{children}</div>
    </section>
  );
}

function Falta({ nombres }: { nombres: string[] }) {
  return (
    <div className="stack-1">
      <p className="t-sm t-muted">Falta cargar en Vercel {nombres.length === 1 ? "la variable" : "las variables"} {nombres.join(", ")}:</p>
      {nombres.map((n) => <code key={n} className="t-sm" style={{ wordBreak: "break-all" }}>{comando(n)}</code>)}
    </div>
  );
}

function Telegram({ p }: { p: PruebaTelegram }) {
  if (p.estado === "falta") return <Falta nombres={["TELEGRAM_BOT_TOKEN"]} />;
  if (p.estado === "error") return <p className="t-sm" style={{ color: "var(--danger)" }}>{p.error}</p>;
  const w = p.webhook;
  return (
    <>
      <p className="t-sm">Bot <b>@{p.bot?.usuario}</b>{p.bot?.nombre && p.bot.nombre !== p.bot.usuario ? ` (${p.bot.nombre})` : ""}.</p>
      {w?.uso === "otra" ? (
        <p className="t-sm" style={{ color: "var(--warning)" }}>
          Lo usa otra herramienta{w.host ? ` (${w.host})` : ""}: Telegram deja una sola conexión por bot, así que si se conecta a Apicanta esa deja de recibir.
          Si sigue en uso, conviene crear un bot nuevo sólo para Apicanta.
        </p>
      ) : w?.uso === "nuestro" ? (
        <p className="t-sm" style={{ color: "var(--success)" }}>Conectado a Apicanta.</p>
      ) : (
        <p className="t-sm t-muted">
          No lo usa ninguna otra herramienta por webhook: se puede conectar a Apicanta sin pisar nada.
          {w && w.pendientes > 0 ? ` Tiene ${num(w.pendientes)} ${w.pendientes === 1 ? "aviso esperando" : "avisos esperando"} sin leer.` : ""}
        </p>
      )}
      {w?.ultimoError && <p className="t-sm t-subtle">Último error de entrega que registró Telegram: {w.ultimoError}</p>}
    </>
  );
}

function Wisboo({ p }: { p: PruebaWisboo }) {
  if (p.estado === "falta") return <Falta nombres={p.falta ?? []} />;
  if (p.estado === "error") return <p className="t-sm" style={{ color: "var(--danger)" }}>{p.error}</p>;
  const encontrados = (p.programas ?? []).filter((x) => x.enWisboo).length;
  return (
    <>
      <p className="t-sm t-muted">
        La tienda tiene {num(p.total ?? 0)} {p.total === 1 ? "producto" : "productos"}. De los {num(p.programas?.length ?? 0)} de los programas, {num(encontrados)} {encontrados === 1 ? "está" : "están"}:
      </p>
      <ul className="stack-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(p.programas ?? []).map((x) => (
          <li key={x.id} className="t-sm row-wrap" style={{ gap: 6 }}>
            {x.enWisboo
              ? <Check size={14} aria-label="Está" style={{ color: "var(--success)" }} />
              : <X size={14} aria-label="No está" style={{ color: "var(--danger)" }} />}
            <span>{x.nombre}</span>
            {x.enWisboo && x.enWisboo.nombre !== x.nombre && <span className="t-subtle">(en Wisboo: {x.enWisboo.nombre})</span>}
            {x.enWisboo && x.enWisboo.estado && x.enWisboo.estado !== "published" && <span className="t-subtle">· sin publicar</span>}
          </li>
        ))}
      </ul>
      {(p.otros?.length ?? 0) > 0 && (
        <p className="t-sm t-subtle">Otros productos de la tienda: {p.otros!.map((o) => o.nombre).join(" · ")}</p>
      )}
    </>
  );
}

function Pandadoc({ p }: { p: PruebaPandadoc }) {
  if (p.estado === "falta") {
    return (
      <p className="t-sm t-muted">
        Falta la clave de este entorno: en la app publicada se usa PANDADOC_API_KEY; en local y en las versiones de prueba, PANDADOC_SANDBOX_KEY.
      </p>
    );
  }
  if (p.estado === "error") return <p className="t-sm" style={{ color: "var(--danger)" }}>{p.error}</p>;
  return (
    <>
      <p className="t-sm t-muted">
        {p.modo === "produccion" ? "Clave de producción" : "Clave de prueba (sandbox: sólo manda a mails del dominio de la cuenta)"}
        {p.cuenta ? ` de ${p.cuenta.email}${p.cuenta.espacio ? `, espacio «${p.cuenta.espacio}»` : ""}` : ""}.
        {" "}{num(p.plantillas?.length ?? 0)} {p.plantillas?.length === 1 ? "plantilla" : "plantillas"}:
      </p>
      {(p.plantillas?.length ?? 0) > 0 && (
        <ul className="stack-1" style={{ margin: 0, paddingLeft: 18 }}>
          {p.plantillas!.map((t) => <li key={t.id} className="t-sm">{t.nombre}</li>)}
        </ul>
      )}
    </>
  );
}

function Zoom({ p }: { p: PruebaZoom }) {
  if (p.estado === "falta") {
    return (
      <>
        <p className="t-sm t-muted">
          Falta la app «Server-to-Server OAuth» de Zoom. La crea un administrador de la cuenta en marketplace.zoom.us, y sus tres datos van a Vercel:
        </p>
        <Falta nombres={p.falta ?? []} />
      </>
    );
  }
  if (p.estado === "error") return <p className="t-sm" style={{ color: "var(--danger)" }}>{p.error}</p>;
  return (
    <>
      <p className="t-sm t-muted">{num(p.reuniones?.length ?? 0)} {p.reuniones?.length === 1 ? "reunión programada" : "reuniones programadas"}:</p>
      {(p.reuniones?.length ?? 0) > 0 && (
        <ul className="stack-1" style={{ margin: 0, paddingLeft: 18 }}>
          {p.reuniones!.map((m) => <li key={m.id} className="t-sm">{m.tema}</li>)}
        </ul>
      )}
    </>
  );
}
