"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHead, type VarianteBadge } from "@/components/ui/ui";
import { cabeceras } from "@/components/webinars/useYoutube";
import { hayNube } from "@/lib/store";
import type { EstadoConexion } from "@/lib/accesos-alumnos";
import type { PruebaPandadoc, PruebaTelegram, PruebaWisboo, PruebaZoom } from "@/lib/accesos-alumnos-servidor";
import { ContratosAjustes } from "./ContratosAjustes";

/* ==================================================================
   Accesos de alumnos, en Ajustes → Integraciones: cuál de las cuatro
   conexiones del onboarding está activa y cuál queda pendiente. Es el
   primer paso del onboarding del Loom de Yari (20/10): antes de dar
   accesos solos, saber que las claves cargadas en Vercel sirven.
   Juan Cruz (20/10): que diga activa o pendiente, sin el detalle.

   Sólo prueba: no conecta el bot, no da accesos, no manda contratos.
   ================================================================== */

export interface Pruebas { telegram: PruebaTelegram; wisboo: PruebaWisboo; pandadoc: PruebaPandadoc; zoom: PruebaZoom }

const ROTULO: Record<EstadoConexion, { texto: string; variante: VarianteBadge }> = {
  ok: { texto: "Activa", variante: "success" },
  falta: { texto: "Pendiente", variante: "warning" },
  error: { texto: "Con error", variante: "danger" },
};

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
        titulo="Contratos y accesos de alumnos"
        sub="El contrato de PandaDoc sale desde la carga de la venta y, cuando el alumno firma, entra solo a sus grupos, sus cursos y sus reuniones."
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
      {hayNube && <ContratosAjustes pruebas={pruebas} />}
    </Card>
  );
}

/** Cada conexión con su estado y, si hace falta, una sola línea de qué pasa
    (separado del pedido para poder dibujarlo con datos de ejemplo). */
export function ListaDeConexiones({ pruebas: p }: { pruebas: Pruebas }) {
  const filas: { nombre: string; estado: EstadoConexion; nota: string | null; aviso?: boolean }[] = [
    { nombre: "Telegram", estado: p.telegram.estado, ...notaTelegram(p.telegram) },
    { nombre: "Wisboo", estado: p.wisboo.estado, ...notaWisboo(p.wisboo) },
    { nombre: "PandaDoc", estado: p.pandadoc.estado, ...notaPandadoc(p.pandadoc) },
    { nombre: "Zoom", estado: p.zoom.estado, ...notaZoom(p.zoom) },
  ];
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {filas.map((f, i) => (
        <li key={f.nombre} className="row-wrap" style={{
          justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "10px 0",
          borderTop: i ? "1px solid var(--border)" : undefined,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="t-body" style={{ fontWeight: 500 }}>{f.nombre}</div>
            {f.nota && (
              <div className="t-sm" style={{ color: f.estado === "error" ? "var(--danger)" : f.aviso ? "var(--warning)" : "var(--ink-muted)" }}>
                {f.nota}
              </div>
            )}
          </div>
          <Badge variante={ROTULO[f.estado].variante}>{ROTULO[f.estado].texto}</Badge>
        </li>
      ))}
    </ul>
  );
}

type Nota = { nota: string | null; aviso?: boolean };

function notaTelegram(t: PruebaTelegram): Nota {
  if (t.estado === "falta") return { nota: "Falta TELEGRAM_BOT_TOKEN en Vercel." };
  if (t.estado === "error") return { nota: t.error ?? "No anda." };
  if (t.webhook?.uso === "otra") {
    return { nota: `@${t.bot?.usuario}. Lo usa otra herramienta${t.webhook.host ? ` (${t.webhook.host})` : ""}: conectarlo a Apicanta la dejaría sin avisos.`, aviso: true };
  }
  return { nota: `@${t.bot?.usuario}` };
}

function notaWisboo(w: PruebaWisboo): Nota {
  if (w.estado === "falta") return { nota: `Falta ${(w.falta ?? []).join(" y ")} en Vercel.` };
  if (w.estado === "error") return { nota: w.error ?? "No anda." };
  const faltan = (w.programas ?? []).filter((x) => !x.enWisboo).map((x) => x.nombre);
  return faltan.length
    ? { nota: `La tienda no tiene ${faltan.length === 1 ? "el producto" : "los productos"} ${faltan.join(", ")}.`, aviso: true }
    : { nota: null };
}

function notaPandadoc(d: PruebaPandadoc): Nota {
  if (d.estado === "falta") return { nota: "Falta la clave de este entorno (PANDADOC_API_KEY en la app publicada)." };
  if (d.estado === "error") return { nota: d.error ?? "No anda." };
  return { nota: d.modo === "prueba" ? "Con la clave de prueba (sandbox)." : null };
}

function notaZoom(z: PruebaZoom): Nota {
  if (z.estado === "falta") return { nota: "Falta crear la app «Server-to-Server OAuth» de Zoom y cargar sus tres datos en Vercel." };
  if (z.estado === "error") return { nota: z.error ?? "No anda." };
  return { nota: null };
}
