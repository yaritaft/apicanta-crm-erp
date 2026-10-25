"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { fechaLarga, money } from "@/lib/format";
import { esDeTestimonio, testimonioNormal, type FilaResell } from "@/lib/clientes-cs";
import { leerMontoCs } from "@/lib/importar-cs";
import type { Resell, Testimonio } from "@/lib/types";

/* ==================================================================
   «Cerrar» una llamada de resell o de testimonio, tipo Typeform (Lili,
   24/10): si grabó el testimonio (y el link), si compró (y qué), y el
   link del pitch. Queda en la agenda de resells y, si es de testimonio,
   también en el testimonio del alumno (su ficha): Lili no tiene que andar
   persiguiendo a nadie para saberlo.
   ================================================================== */

type Resultado = "si" | "activo" | "outboarding" | "seguimiento";
type PasoId = "testimonio" | "link" | "resell" | "compro" | "pitch";
const TITULOS: Record<PasoId, string> = { testimonio: "Testimonio", link: "Grabación", resell: "Resell", compro: "Qué compró", pitch: "Pitch" };

const RESULTADOS: { valor: Resultado; nombre: string; sub: string }[] = [
  { valor: "si", nombre: "Sí, compró", sub: "Renovó o subió de programa" },
  { valor: "activo", nombre: "No: sigue como alumno activo", sub: "Todavía tiene el programa vigente" },
  { valor: "outboarding", nombre: "No: pasa a outboarding", sub: "No quiere renovar" },
  { valor: "seguimiento", nombre: "Todavía no: queda en seguimiento", sub: "La llamada sigue abierta hasta que se defina" },
];
const PROGRAMAS = ["Upgrade a Hackear IA", "Renueva"];

const montoCs = (n: number) => money(n, "USD", Math.abs(n % 1) > 0.004 ? 2 : 0);

const estadoDe = (r: Resultado, programa: string): string =>
  r === "si" ? programa : r === "activo" ? "Alumno vigente" : r === "outboarding" ? "No quiere renovar, Outbording" : "Seguimiento";

export function CerrarLlamada({ fila, onCerrar, onListo }: { fila: FilaResell; onCerrar: () => void; onListo: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const r = fila.resell;
  const deTestimonio = esDeTestimonio(r) || r.casoDeExito;
  /* «No era de testimonio»: un «Próximos pasos» que fue sólo para el resell. Deja de ser caso de éxito. */
  const [testimonio, setTestimonio] = useState<Resell["testimonio"] | "no-era">(r.testimonio || "");
  const [link, setLink] = useState(r.linkTestimonio ?? "");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [programa, setPrograma] = useState(PROGRAMAS[0]);
  const [cash, setCash] = useState(r.cashCollect === null ? "" : String(r.cashCollect));
  const [pitch, setPitch] = useState(r.linkPitch ?? "");
  const [i, setI] = useState(0);
  const nombre = fila.alumno?.nombre || r.nombre || "el alumno";
  const primero = nombre.split(" ")[0];

  const ids: PasoId[] = [
    ...(deTestimonio ? (["testimonio"] as const) : []),
    ...(testimonio === "Grabó" ? (["link"] as const) : []),
    ...(testimonio === "Se reagenda" ? [] : (["resell"] as const)),
    ...(testimonio !== "Se reagenda" && resultado === "si" ? (["compro"] as const) : []),
    ...(testimonio === "Se reagenda" ? [] : (["pitch"] as const)),
  ];
  const pasos = ids.map((id) => ({ id, titulo: TITULOS[id] }));
  const actual = Math.min(i, pasos.length - 1);
  const id = ids[actual];
  const linkValido = /^https?:\/\/\S+\.\S+/.test(link.trim());
  const pitchValido = !pitch.trim() || /^https?:\/\/\S+\.\S+/.test(pitch.trim());
  const cashValido = !cash.trim() || (leerMontoCs(cash) ?? -1) >= 0;
  const falta = id === "testimonio" ? (testimonio ? null : "Elegí si grabó.")
    : id === "link" ? (linkValido ? null : "Pegá el link de la grabación (empieza con https://).")
      : id === "resell" ? (resultado ? null : "Elegí si compró.")
        : id === "compro" ? (cashValido ? null : "El cash collect tiene que ser un monto.")
          : id === "pitch" ? (pitchValido ? null : "El link del pitch tiene que empezar con https://.")
            : null;

  const guardar = () => {
    if (falta) return;
    const reagenda = testimonio === "Se reagenda";
    const noEra = testimonio === "no-era";
    const resultadoT = noEra ? "" : testimonio;
    const estado = reagenda || !resultado ? r.estado : estadoDe(resultado, programa);
    const cashCollect = resultado === "si" && cash.trim() ? leerMontoCs(cash) : r.cashCollect;
    acciones.guardarResell({
      ...r, estado, cashCollect, testimonio: resultadoT, casoDeExito: !noEra && (r.casoDeExito || Boolean(resultadoT)),
      linkTestimonio: testimonio === "Grabó" ? link.trim() : r.linkTestimonio ?? "", linkPitch: pitch.trim(),
    });
    /* Lo del testimonio pasa solo a la ficha del alumno (su Testimonio) en la base, lo cierre quien lo cierre
       (supabase/resells-testimonio.sql): Mariano y el director no editan alumnos. Si el alumno ya tiene su testimonio y esta
       cuenta lo ve, se cambia también acá, para verlo al instante (con lo mismo que escribe la base); uno nuevo lo crea la base. */
    const t0 = fila.alumno && resultadoT ? (e.testimonios ?? []).filter((t) => t.alumnoId === fila.alumno!.id).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))[0] : undefined;
    if (t0) {
      const base = testimonioNormal(t0);
      const resellT = resultado === "si" ? "Renueva" : resultado === "seguimiento" ? "Lo piensa" : resultado ? "No renueva" : base.resell;
      const cambios: Partial<Testimonio> = testimonio === "Grabó"
        ? { followUp: "Llamada agendada", fechaGrabacion: diaDeNegocio(r.fechaHora), conQuien: r.closer.split(" ")[0] || base.conQuien, link: link.trim() || base.link,
          estadoVideo: !base.estadoVideo || base.estadoVideo === "No quiso grabar" ? "Pendiente de subir" : base.estadoVideo, resell: resellT }
        : testimonio === "Se reagenda" ? { followUp: "Pendiente de agendar" }
          : { followUp: "No quiere grabar", estadoVideo: "No quiso grabar", resell: resellT };
      acciones.guardarTestimonio({ ...base, ...cambios });
    }
    toast(reagenda ? `Listo: la llamada de ${primero} queda como reagendada (la nueva agenda entra sola).`
      : resultado === "seguimiento" ? `Guardado. La llamada de ${primero} sigue en tu panel hasta que se defina.`
        : `Listo: la llamada de ${primero} quedó cerrada${resultado === "si" && cashCollect ? ` (${montoCs(cashCollect)})` : ""}.`);
    onListo();
  };

  return createPortal(
    <Asistente
      etiqueta={`Cerrar la llamada de ${nombre}`} pasos={pasos} actual={actual} onCambiarPaso={setI}
      problema={falta} onCerrar={onCerrar} terminarTexto="Guardar" onTerminar={guardar}
    >
      {id === "testimonio" && (
        <>
          <Pregunta texto={`¿Grabaron el testimonio de ${primero}?`} sub={`Llamada del ${fechaLarga(r.fechaHora)}${r.closer ? ` con ${r.closer}` : ""}.`} />
          <div className="opciones opciones--lista">
            {(["Grabó", "Se reagenda", "No quiso grabar", "no-era"] as const).map((t, k) => (
              <Opcion key={t} tecla={String(k + 1)} nombre={t === "Grabó" ? "Sí, grabamos" : t === "Se reagenda" ? "Se reagenda" : t === "no-era" ? "No era para testimonio" : "No quiso grabar"}
                sub={t === "Grabó" ? "Después pegás el link de la grabación" : t === "Se reagenda" ? "La nueva agenda entra sola por Calendly" : t === "no-era" ? "Fue sólo para el resell" : undefined}
                activo={testimonio === t} onClick={() => { setTestimonio(t); window.setTimeout(() => setI(actual + 1), 220); }} />
            ))}
          </div>
        </>
      )}
      {id === "link" && (
        <>
          <Pregunta texto="Pegá el link de la grabación" sub="El del video del testimonio (Drive, Zoom, YouTube). Queda en su ficha, en Testimonio." />
          <Input value={link} onChange={(ev) => setLink(ev.target.value)} placeholder="https://drive.google.com/…" aria-label="Link de la grabación" autoFocus />
        </>
      )}
      {id === "resell" && (
        <>
          <Pregunta texto={`¿${primero} compró?`} sub={deTestimonio ? "El pitch que se hace después del testimonio, para renovar o subir de programa." : `Llamada del ${fechaLarga(r.fechaHora)}${r.closer ? ` con ${r.closer}` : ""}.`} />
          <div className="opciones opciones--lista">
            {RESULTADOS.map((o, k) => (
              <Opcion key={o.valor} tecla={String(k + 1)} nombre={o.nombre} sub={o.sub} activo={resultado === o.valor}
                onClick={() => { setResultado(o.valor); window.setTimeout(() => setI(actual + 1), 220); }} />
            ))}
          </div>
        </>
      )}
      {id === "compro" && (
        <>
          <Pregunta texto="¿Qué compró?" sub="Y lo que se cobró, si ya pagó (opcional). La venta con su comprobante se carga como siempre." />
          <div className="opciones opciones--lista">
            {PROGRAMAS.map((p, k) => <Opcion key={p} tecla={String(k + 1)} nombre={p === "Renueva" ? "Renueva la mentoría" : p} activo={programa === p} onClick={() => setPrograma(p)} />)}
          </div>
          <div className="hk-field" style={{ maxWidth: 260 }}>
            <label className="hk-label">Cash collect (USD)</label>
            <Input value={cash} onChange={(ev) => setCash(ev.target.value)} placeholder="1.200" inputMode="decimal" aria-label="Cash collect" />
          </div>
        </>
      )}
      {id === "pitch" && (
        <>
          <Pregunta texto="¿El link del pitch?" sub="La grabación de la parte de la venta (Fathom, Zoom). Si no hay, dejalo vacío." />
          <Input value={pitch} onChange={(ev) => setPitch(ev.target.value)} placeholder="https://…" aria-label="Link del pitch" autoFocus />
        </>
      )}
    </Asistente>,
    document.body,
  );
}
