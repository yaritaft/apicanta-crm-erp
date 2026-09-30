"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Download, Plug, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHead, Select } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { num, relativo } from "@/lib/format";
import { hayNube } from "@/lib/store";

/* ==================================================================
   Fathom, en Ajustes → Integraciones: que cada llamada tenga sola su
   grabación, el resumen, los accionables y la transcripción.

   - La clave (FATHOM_API_KEY) vive en Vercel.
   - «Conectar» crea el webhook en Fathom: desde ahí, cada reunión que
     termina llega sola y se ata a su llamada por el correo del invitado y
     la hora. El secreto del webhook lo guarda el servidor.
   - «Traer lo anterior» pide a Fathom las reuniones de los últimos días,
     de a una página, hasta que no hay más.
   ================================================================== */

interface Estado {
  clave: boolean; tablas?: boolean; conectado: boolean; aMano?: boolean; paraElEquipo?: boolean;
  conectadoEn?: string | null; conectadoPor?: string | null;
  grabaciones: number; atadas: number; ultima?: string | null; error?: string;
}

async function pedir(metodo: "GET" | "POST", cuerpo?: object) {
  const r = await fetch("/api/fathom", {
    method: metodo, cache: "no-store",
    headers: { ...(await cabeceras()), ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

const DIAS = [
  { valor: "30", texto: "Los últimos 30 días" },
  { valor: "90", texto: "Los últimos 90 días" },
  { valor: "180", texto: "Los últimos 6 meses" },
  { valor: "365", texto: "El último año" },
];

export function FathomIntegracion() {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [dias, setDias] = useState("90");
  const [avance, setAvance] = useState<{ guardadas: number; atadas: number } | null>(null);
  const [desconectar, setDesconectar] = useState(false);

  const recargar = useCallback(async () => {
    if (!hayNube) { setEstado({ clave: false, conectado: false, grabaciones: 0, atadas: 0 }); return; }
    try { setEstado((await pedir("GET")) as unknown as Estado); }
    catch (err) { setEstado({ clave: false, conectado: false, grabaciones: 0, atadas: 0, error: err instanceof Error ? err.message : "No se pudo preguntar." }); }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);

  async function conectar() {
    setTrabajando("conectar");
    try {
      const j = await pedir("POST", { accion: "conectar" });
      toast(j.yaEstaba ? "Ya estaba conectado." : j.paraElEquipo
        ? "Fathom conectado: llegan las reuniones de todo el equipo."
        : "Fathom conectado: llegan las reuniones de quien tiene la clave y las que le comparten.");
      await recargar();
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo conectar.", "err"); }
    setTrabajando(null);
  }

  async function importar() {
    setTrabajando("importar");
    const desde = new Date(Date.now() - Number(dias) * 86_400_000).toISOString();
    let cursor: string | null = null, guardadas = 0, atadas = 0;
    try {
      for (let i = 0; i < 200; i++) {
        const j = await pedir("POST", { accion: "importar", desde, cursor });
        guardadas += Number(j.guardadas ?? 0);
        atadas += Number(j.atadas ?? 0);
        setAvance({ guardadas, atadas });
        cursor = (j.siguiente as string | null) ?? null;
        if (!cursor) break;
      }
      toast(`Listo: ${num(guardadas)} ${guardadas === 1 ? "grabación" : "grabaciones"}, ${num(atadas)} atadas a su llamada.`);
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo traer.", "err"); }
    setTrabajando(null);
    await recargar();
  }

  const sinAtar = estado ? estado.grabaciones - estado.atadas : 0;

  return (
    <Card>
      <CardHead
        titulo="Fathom"
        sub="Cada llamada con su grabación: el link, el resumen, los accionables y la transcripción llegan solos y se ven en la ficha de la persona, en Llamadas."
        acciones={estado?.conectado
          ? <Badge variante="success" icono={<Check size={12} />}>Conectado</Badge>
          : <Badge variante="neutral">Sin conectar</Badge>}
      />
      {!hayNube ? (
        <p className="t-sm t-subtle">La app corre en este navegador, sin base: Fathom se conecta en la app publicada.</p>
      ) : !estado ? (
        <div className="skeleton" style={{ height: 80 }} />
      ) : (
        <div className="stack-3">
          {estado.error && <p className="t-sm" style={{ color: "var(--danger)" }}>{estado.error}</p>}
          {!estado.clave && (
            <p className="t-sm" style={{ color: "var(--warning)" }}>Falta la clave de Fathom (FATHOM_API_KEY) en Vercel.</p>
          )}
          {estado.tablas === false && (
            <p className="t-sm" style={{ color: "var(--warning)" }}>Falta correr supabase/fathom.sql en la base.</p>
          )}

          {estado.conectado ? (
            <p className="t-sm t-muted">
              {estado.aMano
                ? "El webhook se creó a mano en Fathom (con FATHOM_WEBHOOK_SECRET en Vercel)."
                : `Conectado ${estado.conectadoEn ? relativo(estado.conectadoEn) : ""}${estado.conectadoPor ? ` por ${estado.conectadoPor}` : ""}. `}
              {!estado.aMano && (estado.paraElEquipo
                ? "Llegan las reuniones de todo el equipo de Fathom."
                : "Llegan las reuniones de quien tiene la clave y las que le comparten: para las de cada closer, que las compartan con ese usuario o que estén en el mismo equipo de Fathom.")}
            </p>
          ) : (
            <p className="t-sm t-muted">Al conectar, Fathom avisa cada vez que termina una reunión y la app la ata sola a su llamada, por el correo del invitado y la hora.</p>
          )}

          <div className="row-wrap" style={{ gap: 8 }}>
            {!estado.conectado && (
              <Button variante="primary" icono={<Plug size={16} />} disabled={!estado.clave || estado.tablas === false || Boolean(trabajando)}
                cargando={trabajando === "conectar"} onClick={() => void conectar()}>Conectar</Button>
            )}
            <div style={{ width: 200 }}>
              <Select value={dias} aria-label="Desde cuándo traer" opciones={DIAS} onChange={(ev) => setDias(ev.target.value)} />
            </div>
            <Button variante="secondary" icono={<Download size={16} />} disabled={!estado.clave || estado.tablas === false || Boolean(trabajando)}
              cargando={trabajando === "importar"} onClick={() => void importar()}>Traer lo anterior</Button>
            <Button sm variante="ghost" icono={<RefreshCw size={14} />} disabled={Boolean(trabajando)} onClick={() => void recargar()}>Actualizar</Button>
            {estado.conectado && !estado.aMano && (
              <Button sm variante="ghost" icono={<Unplug size={14} />} disabled={Boolean(trabajando)} onClick={() => setDesconectar(true)}>Desconectar</Button>
            )}
          </div>
          {trabajando === "importar" && avance && (
            <p className="t-sm t-subtle" role="status">Trayendo… {num(avance.guardadas)} grabaciones, {num(avance.atadas)} atadas.</p>
          )}

          <div className="wb-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 0 }}>
            <Kpi etiqueta="Grabaciones" valor={num(estado.grabaciones)} />
            <Kpi etiqueta="Atadas a su llamada" valor={num(estado.atadas)} />
            <Kpi etiqueta="Sin llamada" valor={num(sinAtar)} tenue />
          </div>
          {estado.ultima && <p className="t-sm t-subtle">La última llegó {relativo(estado.ultima)}.</p>}
          {sinAtar > 0 && (
            <p className="t-sm t-subtle">
              Las que quedan sin llamada son reuniones sin invitado de Calendly a esa hora (internas, o de alguien que agendó con otro correo).
            </p>
          )}
        </div>
      )}
      <Confirmar
        abierto={desconectar} onCerrar={() => setDesconectar(false)} confirmarTexto="Desconectar"
        titulo="¿Desconectar Fathom?"
        texto="Se borra el webhook en Fathom: las reuniones nuevas dejan de llegar solas. Las grabaciones que ya llegaron quedan."
        onConfirmar={async () => {
          try { await pedir("POST", { accion: "desconectar" }); toast("Fathom desconectado."); }
          catch (err) { toast(err instanceof Error ? err.message : "No se pudo desconectar.", "err"); }
          await recargar();
        }}
      />
    </Card>
  );
}

function Kpi({ etiqueta, valor, tenue }: { etiqueta: string; valor: string; tenue?: boolean }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num" style={tenue ? { color: "var(--ink-subtle)" } : undefined}>{valor}</span>
    </div>
  );
}
