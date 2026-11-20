"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Textarea } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { acciones } from "@/lib/store";
import { money } from "@/lib/format";
import type { PlanVisible, RecursoDeBaja, ResumenDeBaja } from "@/lib/baja-a-downsell-servidor";
import type { Moneda } from "@/lib/types";

/* ==================================================================
   «Pasar a Downsell · no puede seguir pagando», tipo Typeform (Lili,
   20/11). Tres preguntas: a qué downsell pasa (sale elegido el que se paga
   con lo que ya pagó), por qué, y cómo queda todo antes de confirmar: la
   venta, las cuotas que no se cobran, lo que se le saca hoy y lo que
   conserva hasta el fin de su programa, que no cambia. La regla está en
   lib/baja-a-downsell.ts y lo hace el servidor (api/alumnos/downsell).
   ================================================================== */

type PasoId = "downsell" | "motivo" | "resumen";
const TITULOS: Record<PasoId, string> = { downsell: "Downsell", motivo: "Motivo", resumen: "Así queda" };

const dia = (iso: string) => {
  const d = iso.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};
/* El corte es a la medianoche del día siguiente al fin: se muestra el último día que lo tiene. */
const ultimoDia = (venceEn: string) => dia(new Date(new Date(venceEn).getTime() - 3 * 3_600_000 - 1).toISOString());
const PLATAFORMA: Record<RecursoDeBaja["plataforma"], string> = { wisboo: "Wisboo", telegram: "Telegram", zoom: "Zoom" };

async function pedir(cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/api/alumnos/downsell", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

function Lista({ titulo, items, vacio, tono }: { titulo: string; items: React.ReactNode[]; vacio?: string; tono?: "alerta" | "bien" }) {
  if (!items.length && !vacio) return null;
  return (
    <div className="downsell-resumen__bloque" data-tono={tono}>
      <span className="downsell-resumen__titulo">{titulo}</span>
      {items.length ? <ul>{items.map((x, k) => <li key={k}>{x}</li>)}</ul> : <span className="t-sm t-subtle">{vacio}</span>}
    </div>
  );
}

export function PasarADownsell({ alumnoId, ventaId, nombre, onCerrar, onListo }: {
  alumnoId: string; ventaId: string; nombre: string; onCerrar: () => void; onListo?: () => void;
}) {
  const toast = useToast();
  const [resumen, setResumen] = useState<ResumenDeBaja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [programaId, setProgramaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [i, setI] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const primero = nombre.split(" ")[0] || "el alumno";

  useEffect(() => {
    let vivo = true;
    pedir({ alumnoId, ensayo: true })
      .then((j) => {
        if (!vivo) return;
        const r = j as unknown as ResumenDeBaja;
        setResumen(r);
        setProgramaId(r.opciones.find((o) => o.alcanza)?.programaId ?? r.opciones[0]?.programaId ?? "");
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo."));
    return () => { vivo = false; };
  }, [alumnoId]);

  const M = (n: number) => money(n, (resumen?.moneda ?? "USD") as Moneda, Math.abs(n % 1) > 0.004 ? 2 : 0);
  const listo = resumen && !resumen.problema;
  const ids: PasoId[] = listo ? ["downsell", "motivo", "resumen"] : ["resumen"];
  const pasos = ids.map((id) => ({ id, titulo: listo ? TITULOS[id] : "Downsell" }));
  const actual = Math.min(i, pasos.length - 1);
  const id = ids[actual];
  const opcion = resumen?.opciones.find((o) => o.programaId === programaId);
  const plan: PlanVisible | undefined = resumen?.planes[programaId];

  const falta = !resumen ? (error ? null : "Mirando sus pagos y sus accesos…")
    : resumen.problema ? null
      : id === "downsell" ? (opcion ? null : "Elegí a qué downsell pasa.")
        : id === "motivo" ? (motivo.trim() ? null : "Escribí por qué.")
          : guardando ? "Guardando…" : null;

  const terminar = async () => {
    if (!listo) { onCerrar(); return; }
    if (guardando || falta) return;
    setGuardando(true);
    try {
      const r = await pedir({ alumnoId, programaId, motivo });
      const fallaron = Array.isArray(r.fallaron) ? (r.fallaron as string[]) : [];
      await Promise.all([acciones.traerVentaDe(ventaId), acciones.traerFichaDe(alumnoId)]);
      toast(fallaron.length
        ? `${primero} pasó a ${opcion?.nombre}. No se pudo sacar: ${fallaron.join(", ")}: hacelo desde Accesos.`
        : `Listo: ${primero} pasó a ${opcion?.nombre} y sigue hasta el ${resumen?.fin ? dia(resumen.fin) : "fin de su programa"}.`, fallaron.length ? "err" : undefined);
      onListo?.();
      onCerrar();
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo.", "err");
      setGuardando(false);
    }
  };

  return createPortal(
    <Asistente
      etiqueta={`Pasar a Downsell a ${nombre}`} pasos={pasos} actual={actual} onCambiarPaso={setI}
      problema={falta} onCerrar={onCerrar} terminarTexto={listo ? "Pasar a Downsell" : "Entendido"} onTerminar={terminar}
    >
      {!resumen && (
        <Pregunta texto={error ? "No se pudo armar el cambio" : `Mirando los pagos de ${primero}…`} sub={error ?? "Un segundo: armamos qué le queda con lo que ya pagó."} />
      )}
      {resumen?.problema && (
        <Pregunta texto={`${primero} no puede pasar a Downsell`} sub={resumen.problema} />
      )}
      {listo && id === "downsell" && (
        <>
          <Pregunta texto={`¿A qué downsell pasa ${primero}?`}
            sub={`Pagó ${M(resumen.cobrado)} de los ${M(resumen.precioAnterior)} de ${resumen.desde.producto || resumen.desde.programa}. Sale elegido el que se paga con eso; la venta queda en lo que pagó.`} />
          <div className="opciones opciones--lista">
            {resumen.opciones.map((o, k) => (
              <Opcion key={o.programaId} tecla={String(k + 1)} nombre={o.nombre} activo={programaId === o.programaId}
                sub={o.precio <= resumen.cobrado + 0.009 ? `De lista ${M(o.precio)} · le alcanza con lo que pagó` : `De lista ${M(o.precio)} · pagó ${M(o.precio - resumen.cobrado)} menos`}
                onClick={() => { setProgramaId(o.programaId); window.setTimeout(() => setI(actual + 1), 220); }} />
            ))}
          </div>
        </>
      )}
      {listo && id === "motivo" && (
        <>
          <Pregunta texto="¿Por qué no sigue pagando?" sub="Queda en la venta y en las cuotas que no se cobran. Lo ven Finanzas y su closer." />
          <Textarea value={motivo} onChange={(ev) => setMotivo(ev.target.value)} rows={3} autoFocus aria-label="Motivo"
            placeholder="Ej.: no puede seguir pagando las cuotas, se queda con el contenido grabado" />
        </>
      )}
      {listo && id === "resumen" && plan && opcion && (
        <>
          <Pregunta texto={`Así queda ${primero}`} sub="Revisalo: al confirmar se hace todo junto." />
          <div className="downsell-resumen">
            <Lista titulo="La venta" items={[
              <><s className="t-subtle">{resumen.desde.producto || resumen.desde.programa} · {M(resumen.precioAnterior)}</s> → <strong>{opcion.nombre} · {M(resumen.cobrado)}</strong> (lo que pagó)</>,
              ...plan.noSeCobran.map((c) => <>{c.esReserva ? "La reserva" : `Cuota ${c.numero}`} de {M(c.monto)}: no se cobra</>),
              ...plan.saldadas.map((c) => <>{c.esReserva ? "La reserva" : `Cuota ${c.numero}`}: queda en lo que pagó ({M(c.monto)})</>),
              ...(plan.pagoMenos > 0.009 ? [<>Pagó {M(plan.pagoMenos)} menos que el precio de lista del {opcion.nombre}</>] : []),
            ]} />
            <Lista titulo="Se le saca hoy" tono="alerta" vacio="Nada de lo que dio la app"
              items={plan.seSacan.map((x) => <>{x.nombre} <span className="t-subtle">· {PLATAFORMA[x.plataforma]}</span></>)} />
            <Lista titulo={`Conserva hasta el ${resumen.fin ? dia(resumen.fin) : "fin de su programa"}`} tono="bien"
              items={plan.quedan.map((x) => <>{x.nombre} <span className="t-subtle">· {PLATAFORMA[x.plataforma]}{x.venceEn && resumen.fin && ultimoDia(x.venceEn) !== dia(resumen.fin) ? ` · hasta el ${ultimoDia(x.venceEn)}` : ""}</span></>)} />
            {(plan.aMano.hoy.length > 0 || plan.aMano.alFin.length > 0) && (
              <Lista titulo="A mano (estos accesos no los dio la app)" tono="alerta" items={[
                ...(plan.aMano.hoy.length ? [<>Sacale hoy: {plan.aMano.hoy.map((x) => x.nombre).join(", ")}</>] : []),
                ...(plan.aMano.alFin.length ? [<>El {resumen.fin ? dia(resumen.fin) : "día que termina"}, sacale {plan.aMano.alFin.map((x) => x.nombre).join(", ")}: ese día te llega el aviso</>] : []),
              ]} />
            )}
            <Lista titulo="Lo que no cambia" items={[
              <>Inicio {resumen.inicio ? dia(resumen.inicio) : "—"} y fin {resumen.fin ? dia(resumen.fin) : "—"}: el plazo sigue contando desde que empezó</>,
              <>En su ficha: {plan.programasFicha.join(" · ") || opcion.nombre}</>,
              <>Avisamos a Finanzas y a su closer</>,
            ]} />
          </div>
        </>
      )}
    </Asistente>,
    document.body,
  );
}
