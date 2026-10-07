"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Plug, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHead } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { fecha, num, relativo } from "@/lib/format";
import { hayNube } from "@/lib/store";
import { FathomDiagnostico } from "./FathomDiagnostico";

/* ==================================================================
   Fathom, en Ajustes → Integraciones: que cada llamada de venta tenga
   sola su grabación, el resumen, los accionables y la transcripción.

   - La clave (FATHOM_API_KEY) vive en Vercel.
   - «Conectar» crea el webhook en Fathom: desde ahí, cada reunión que
     termina llega sola y se ata a su llamada de Calendly por el correo del
     invitado y la hora. La que no tiene llamada (personal o interna) se
     descarta sin guardarse. El secreto del webhook lo guarda el servidor.
   - «Traer lo anterior» pide a Fathom las reuniones desde el día antes de
     la primera llamada de Calendly que hay en la app, de a una página,
     hasta que no hay más: primero todo lo que la clave ve y después las
     llamadas de cada equipo de ventas de Fathom (las «Team Calls»). Si
     Fathom pide una pausa, espera y sigue.
   - «Diagnosticar» (sólo dueños, FathomDiagnostico): por qué no llegan las
     llamadas de los closers, con la clave del servidor.
   ================================================================== */

interface Estado {
  clave: boolean; tablas?: boolean; conectado: boolean; aMano?: boolean; paraElEquipo?: boolean;
  conectadoEn?: string | null; conectadoPor?: string | null;
  grabaciones: number; atadas: number; ultima?: string | null; desde?: string | null; error?: string;
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

const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/* Cuántas veces se espera a Fathom antes de dejar para otro momento. */
const PAUSAS_MAXIMAS = 40;

export function FathomIntegracion() {
  const toast = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [avance, setAvance] = useState<{ atadas: number; nuevas: number; descartadas: number; equipo?: string | null } | null>(null);
  const [pausa, setPausa] = useState<number | null>(null);
  const [desconectar, setDesconectar] = useState(false);
  /* Si se cierra la pantalla en medio de «Traer lo anterior», se deja de pedir. */
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);

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
        ? "Fathom conectado: llegan las llamadas de venta de todo el equipo."
        : "Fathom conectado: llegan las de quien tiene la clave y las que le comparten.");
      await recargar();
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo conectar.", "err"); }
    setTrabajando(null);
  }

  async function importar() {
    setTrabajando("importar");
    setAvance({ atadas: 0, nuevas: 0, descartadas: 0 });
    /* Las vueltas por equipo repiten lo que trajo la general: se cuenta por grabación, no por página. */
    const atadas = new Set<string>(), vistas = new Set<string>();
    let cursor: string | null = null, nuevas = 0, pausas = 0, sinLlamadas = false;
    const cuenta = () => ({ atadas: atadas.size, nuevas, descartadas: vistas.size - atadas.size });
    try {
      for (let i = 0; i < 1000 && montado.current; i++) {
        const j = await pedir("POST", { accion: "importar", cursor });
        if (j.sinLlamadas) { sinLlamadas = true; break; }
        if (typeof j.esperar === "number") {
          /* Fathom pidió una pausa: se espera lo que dice y se pide la misma página. */
          if (++pausas > PAUSAS_MAXIMAS) throw new Error("Fathom sigue pidiendo pausas. Probá de nuevo en un rato: lo que ya se trajo queda guardado.");
          for (let s = Math.ceil(j.esperar); s > 0 && montado.current; s--) { setPausa(s); await dormir(1000); }
          setPausa(null);
          continue;
        }
        for (const id of (j.idsAtadas as string[] | undefined) ?? []) { atadas.add(id); vistas.add(id); }
        for (const id of (j.idsDescartadas as string[] | undefined) ?? []) vistas.add(id);
        nuevas += Number(j.nuevas ?? 0);
        setAvance({ ...cuenta(), equipo: (j.equipo as string | null | undefined) ?? null });
        cursor = (j.siguiente as string | null) ?? null;
        if (!cursor) break;
      }
      if (!montado.current) return;
      const c = cuenta();
      toast(sinLlamadas
        ? "Todavía no hay llamadas de Calendly en la app: no hay con qué atar las grabaciones."
        : `Listo: ${num(c.atadas)} ${c.atadas === 1 ? "grabación atada" : "grabaciones atadas"} a su llamada (${num(c.nuevas)} ${c.nuevas === 1 ? "nueva" : "nuevas"}).${c.descartadas
          ? ` ${num(c.descartadas)} ${c.descartadas === 1 ? "no tenía" : "no tenían"} llamada de Calendly y no se ${c.descartadas === 1 ? "guardó" : "guardaron"}.` : ""}`);
    } catch (err) { if (montado.current) toast(err instanceof Error ? err.message : "No se pudo traer.", "err"); }
    if (!montado.current) return;
    setPausa(null);
    setTrabajando(null);
    await recargar();
  }

  /* Las que llegaron antes de que se descartaran las que no tienen llamada. */
  const sinAtar = estado ? estado.grabaciones - estado.atadas : 0;

  return (
    <Card>
      <CardHead
        titulo="Fathom"
        sub="Cada llamada de venta con su grabación: el link, el resumen, los accionables y la transcripción llegan solos y se ven en la ficha de la persona, en Llamadas."
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
                ? "El webhook se creó a mano en Fathom (con FATHOM_WEBHOOK_SECRET en Vercel). "
                : `Conectado ${estado.conectadoEn ? relativo(estado.conectadoEn) : ""}${estado.conectadoPor ? ` por ${estado.conectadoPor}` : ""}. `}
              {!estado.aMano && (estado.paraElEquipo
                ? "Llegan las reuniones de todo el equipo de Fathom. "
                : "Llegan las reuniones de quien tiene la clave y las que le comparten: para las de cada closer, que las compartan con ese usuario o que estén en el mismo equipo de Fathom. ")}
              Se guardan sólo las de una llamada de Calendly: las personales o internas se descartan sin guardarse.
            </p>
          ) : (
            <p className="t-sm t-muted">
              Al conectar, Fathom avisa cada vez que termina una reunión y la app la ata sola a su llamada de Calendly, por el correo del invitado y la hora.
              Las que no tienen llamada (personales o internas) no se guardan.
            </p>
          )}

          <div className="row-wrap" style={{ gap: 8 }}>
            {!estado.conectado && (
              <Button variante="primary" icono={<Plug size={16} />} disabled={!estado.clave || estado.tablas === false || Boolean(trabajando)}
                cargando={trabajando === "conectar"} onClick={() => void conectar()}>Conectar</Button>
            )}
            <Button variante="secondary" icono={<Download size={16} />} disabled={!estado.clave || estado.tablas === false || Boolean(trabajando)}
              cargando={trabajando === "importar"} onClick={() => void importar()}>Traer lo anterior</Button>
            <Button sm variante="ghost" icono={<RefreshCw size={14} />} disabled={Boolean(trabajando)} onClick={() => void recargar()}>Actualizar</Button>
            {estado.conectado && !estado.aMano && (
              <Button sm variante="ghost" icono={<Unplug size={14} />} disabled={Boolean(trabajando)} onClick={() => setDesconectar(true)}>Desconectar</Button>
            )}
          </div>
          <p className="t-sm t-subtle">
            {estado.desde
              ? `«Traer lo anterior» busca desde el ${fecha(estado.desde)}: antes no hay llamadas de Calendly en la app para atarlas.`
              : "«Traer lo anterior» busca desde la primera llamada de Calendly que haya en la app."}
            {" "}Pide todo lo que ve la clave y también las llamadas de cada equipo de ventas de Fathom (el que se llame Sales, Ventas o Closers; si se llama distinto, se lo dice con FATHOM_EQUIPOS en Vercel).
          </p>
          {trabajando === "importar" && avance && (
            <p className="t-sm t-subtle" role="status">
              {pausa
                ? `Fathom pidió una pausa: sigo en ${pausa} s… (van ${num(avance.atadas)} atadas)`
                : `Trayendo${avance.equipo ? ` (equipo ${avance.equipo})` : ""}… ${num(avance.atadas)} atadas a su llamada, ${num(avance.descartadas)} sin llamada (no se guardan).`}
            </p>
          )}

          <div className="wb-kpis" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginBottom: 0 }}>
            <Kpi etiqueta="Llamadas con grabación" valor={num(estado.atadas)} />
            <Kpi etiqueta="La última llegó" valor={estado.ultima ? relativo(estado.ultima) : "—"} tenue={!estado.ultima} />
          </div>
          {sinAtar > 0 && (
            <p className="t-sm t-subtle">
              Hay {num(sinAtar)} {sinAtar === 1 ? "grabación guardada" : "grabaciones guardadas"} sin llamada, de antes de que se descartaran: no se muestran en ningún lado.
            </p>
          )}
          <FathomDiagnostico deshabilitado={!estado.clave || Boolean(trabajando)} />
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
