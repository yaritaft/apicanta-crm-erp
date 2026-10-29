"use client";

import React, { useState } from "react";
import { CalendarClock, Hourglass, PauseCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { egresoDelPrograma, egresoEscritoAMano, type FilaCliente } from "@/lib/clientes-cs";
import { conPausa, demoraDe, diasDe, diasDePausa, MAX_DEMORA_DIAS, MAX_PAUSA_DIAS, pasaDelTope, problemaDePausa, textoDePausa } from "@/lib/pausas";
import { diasEntre, formatoDia, sumarDias } from "@/lib/seguimiento";
import type { PausaServicio, SeguimientoAlumno } from "@/lib/types";
import { BloqueServicio, FilaServicio } from "./FilaServicio";

/* ==================================================================
   Demora de inicio y pausas, en Seguimiento (Lili, 22/10): el alumno
   arranca más tarde (hasta 60 días) o pausa (hasta 45) y el fin del
   programa se corre solo. Cada una queda en el historial, con su motivo,
   y se corrige o se borra con Deshacer. La regla está en lib/pausas.ts.
   ================================================================== */

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

export function PausasAlumno({ f, hoy, puede }: { f: FilaCliente; hoy: string; puede: boolean }) {
  const [form, setForm] = useState<{ tipo: PausaServicio["tipo"]; p?: PausaServicio } | null>(null);
  const [editandoFin, setEditandoFin] = useState(false);
  const pausas = f.seg.pausas ?? [];
  const aMano = egresoEscritoAMano(f.inicio, f.seg.fechaEgreso, f.duracion);
  const demora = demoraDe(pausas);
  const corrido = (demora ? diasDe(demora) : 0) + diasDePausa(pausas);
  const quedan = f.egreso ? diasEntre(hoy, f.egreso) : null;
  const fmt = (d: string) => formatoDia(d, hoy);

  const chip = f.enReserva
    ? <span className="hs-chip hs-chip--ambar">Reserva: todavía no arrancó</span>
    : f.pausa
    ? <span className="hs-chip hs-chip--ambar">{textoDePausa(f.pausa, hoy, fmt)}</span>
    : quedan === null ? undefined
      : quedan < 0 ? <span className="hs-chip">Terminó el {fmt(f.egreso as string)}</span>
        : <span className="hs-chip hs-chip--ok">Le {quedan === 1 ? "queda" : "quedan"} {dias(quedan)} de programa</span>;

  return (
    <BloqueServicio titulo="Demora de inicio y pausas" extra={chip}>
      <FilaServicio icono={<CalendarClock size={15} />} rotulo="Fin del programa"
        detalle={aMano ? "Fecha escrita a mano: es la definitiva y la demora y las pausas no la corren"
          : corrido ? `Corrido ${dias(corrido)} por la demora y las pausas` : "Sin demora ni pausas"}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {f.egreso ? <span className="t-num">{fmt(f.egreso)}</span> : <span className="hs-guion">Falta el inicio o la duración</span>}
          {puede && (
            <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setEditandoFin(true)} aria-label="Corregir la fecha de fin del programa">Editar</Button>
          )}
        </span>
      </FilaServicio>
      {pausas.length === 0 && <p className="hs-nada">Arrancó cuando ingresó y no pausó. Si arranca más tarde o pausa, cargalo acá y el fin se corre solo.</p>}
      {pausas.map((p) => (
        <FilaServicio key={p.id} icono={p.tipo === "demora" ? <Hourglass size={15} /> : <PauseCircle size={15} />}
          rotulo={p.tipo === "demora" ? `Demora de inicio: arranca el ${fmt(p.hasta)}` : `Pausa del ${fmt(p.desde)} al ${fmt(p.hasta)}`}
          detalle={[dias(diasDe(p)), p.motivo, p.autorizadoPor && `autorizó ${p.autorizadoPor}`, p.creadoPor && `cargó ${p.creadoPor}`].filter(Boolean).join(" · ")}>
          {puede && (
            <Button sm variante="ghost" icono={<Pencil size={13} />} onClick={() => setForm({ tipo: p.tipo, p })}
              aria-label={p.tipo === "demora" ? "Corregir la demora de inicio" : `Corregir la pausa del ${fmt(p.desde)}`}>Editar</Button>
          )}
        </FilaServicio>
      ))}
      {puede && (
        <div className="hs-pie-bloque" style={{ gap: 8 }}>
          {!demora && <Button sm variante="secondary" icono={<Hourglass size={14} />} onClick={() => setForm({ tipo: "demora" })}>Demorar el inicio</Button>}
          <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => setForm({ tipo: "pausa" })}>Pausar</Button>
        </div>
      )}
      {form && <FormPausa f={f} hoy={hoy} tipo={form.tipo} pausa={form.p} onCerrar={() => setForm(null)} />}
      {editandoFin && <FormFin f={f} hoy={hoy} aMano={aMano} onCerrar={() => setEditandoFin(false)} />}
    </BloqueServicio>
  );
}

/* Corregir el fin del programa a mano (Lili, 28/10: «no me permite corregir la fecha de egreso»). Lo que se escribe es la fecha definitiva;
   «Volver a calcularlo» deja que lo calcule la app (inicio + duración, corrido por la demora y las pausas). */
function FormFin({ f, hoy, aMano, onCerrar }: { f: FilaCliente; hoy: string; aMano: boolean; onCerrar: () => void }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(f.egreso ?? "");
  const fmt = (d: string) => formatoDia(d, hoy);

  function guardar(nueva: string | null) {
    const ahora = new Date().toISOString();
    const antes = acciones.guardarSeguimiento(f.id, (s: SeguimientoAlumno, quien: string): SeguimientoAlumno => ({
      ...s, fechaEgreso: nueva, actualizadoEn: ahora, actualizadoPor: quien,
    }), (d) => {
      const fin = egresoDelPrograma(f.inicio, d.fechaEgreso, f.duracion, d.pausas ?? []);
      return nueva ? `El fin del programa de ${f.nombre} quedó el ${fmt(nueva)} (escrito a mano).` : `El fin del programa de ${f.nombre} se vuelve a calcular solo${fin ? `: ${fmt(fin)}` : ""}.`;
    });
    if (!antes) return;
    toast(nueva ? `Fin del programa de ${f.nombre}: ${fmt(nueva)}.` : `Fin del programa de ${f.nombre}: se calcula solo otra vez.`, "ok", {
      texto: "Deshacer", onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el cambio del fin del programa de ${f.nombre}.`),
    });
    onCerrar();
  }

  return (
    <ModalForm abierto onCerrar={onCerrar} titulo="Corregir el fin del programa"
      sub={`${f.nombre}. Lo que escribas es la fecha definitiva: la demora y las pausas no la mueven.`}
      puedeGuardar={Boolean(fecha) && fecha !== f.egreso} onGuardar={() => guardar(fecha)}>
      <div className="form-grid">
        <Field label="El programa termina el" span2>
          <Input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} aria-label="Fecha de fin del programa" />
        </Field>
        {(aMano || f.seg.fechaEgreso !== null) && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Button variante="ghost" sm onClick={() => guardar(null)}>Volver a calcularlo solo</Button>
          </div>
        )}
      </div>
    </ModalForm>
  );
}

function FormPausa({ f, hoy, tipo, pausa, onCerrar }: {
  f: FilaCliente; hoy: string; tipo: PausaServicio["tipo"]; pausa?: PausaServicio; onCerrar: () => void;
}) {
  const toast = useToast();
  const ingreso = f.inicio || hoy;
  const [b, setB] = useState({
    desde: pausa?.desde ?? (tipo === "demora" ? ingreso : hoy),
    hasta: pausa?.hasta ?? "",
    motivo: pausa?.motivo ?? "",
    autorizadoPor: pausa?.autorizadoPor ?? "",
  });
  const equipo = useEstado().equipo.filter((m) => m.activo !== false && m.nombre?.trim()).map((m) => m.nombre.trim()).sort((x, y) => x.localeCompare(y, "es"));
  const nueva: PausaServicio = {
    id: pausa?.id ?? nuevoId(tipo === "demora" ? "demora" : "pausa"), tipo,
    desde: tipo === "demora" ? ingreso : b.desde, hasta: b.hasta, motivo: b.motivo.trim(),
    creadoEn: pausa?.creadoEn ?? new Date().toISOString(), creadoPor: pausa?.creadoPor ?? "",
    ...(b.autorizadoPor.trim() ? { autorizadoPor: b.autorizadoPor.trim() } : {}),
  };
  const otras = (f.seg.pausas ?? []).filter((x) => x.id !== nueva.id);
  const problema = b.hasta ? problemaDePausa(nueva, f.inicio, otras) : null;
  const sobreTope = b.hasta ? pasaDelTope(nueva, otras) : null;
  const lista = conPausa(f.seg.pausas, nueva);
  const finNuevo = !problema && b.hasta ? egresoDelPrograma(f.inicio, f.seg.fechaEgreso, f.duracion, lista) : null;
  const fmt = (d: string) => formatoDia(d, hoy);
  const que = tipo === "demora" ? "La demora de inicio" : `La pausa del ${b.desde ? fmt(b.desde) : "—"}`;

  function escribir(borrar: boolean) {
    const ahora = new Date().toISOString();
    const antes = acciones.guardarSeguimiento(f.id, (s: SeguimientoAlumno, quien: string): SeguimientoAlumno => ({
      ...s, pausas: conPausa(s.pausas, { ...nueva, creadoPor: nueva.creadoPor || quien }, borrar), actualizadoEn: ahora, actualizadoPor: quien,
    }), (d) => {
      const fin = egresoDelPrograma(f.inicio, d.fechaEgreso, f.duracion, d.pausas ?? []);
      return `${que}${borrar ? " se borró" : tipo === "demora" ? `: arranca el ${fmt(nueva.hasta)}` : ` al ${fmt(nueva.hasta)}`}${nueva.motivo && !borrar ? ` (${nueva.motivo})` : ""}${nueva.autorizadoPor && !borrar ? `, autorizó ${nueva.autorizadoPor}` : ""}.${fin ? ` El programa termina el ${fmt(fin)}.` : ""}`;
    });
    if (!antes) return;
    toast(`${que} ${borrar ? "se borró" : pausa ? "quedó corregida" : "quedó cargada"} para ${f.nombre}.`, "ok", {
      texto: "Deshacer", onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el cambio de la demora o la pausa de ${f.nombre}.`),
    });
    onCerrar();
  }

  return (
    <ModalForm
      abierto onCerrar={onCerrar}
      titulo={tipo === "demora" ? (pausa ? "Corregir la demora de inicio" : "Demorar el inicio") : (pausa ? "Corregir la pausa" : "Pausar el programa")}
      sub={tipo === "demora"
        ? `${f.nombre} ingresó el ${fmt(ingreso)}. Puede arrancar hasta ${MAX_DEMORA_DIAS} días (dos meses) después: el programa cuenta desde ese día.`
        : `${f.nombre}. Las pausas suman hasta ${MAX_PAUSA_DIAS} días entre todas; el fin del programa se corre lo mismo que dure.`}
      puedeGuardar={Boolean(b.hasta) && !problema} onGuardar={() => escribir(false)}
    >
      <div className="form-grid">
        {tipo === "pausa" && (
          <Field label="Pausa desde"><Input type="date" value={b.desde} onChange={(ev) => setB((x) => ({ ...x, desde: ev.target.value }))} /></Field>
        )}
        <Field label={tipo === "demora" ? "Arranca el" : "Retoma el"} error={problema ?? undefined} span2={tipo === "demora"}>
          <Input type="date" value={b.hasta} min={tipo === "demora" ? sumarDias(ingreso, 1) : b.desde ? sumarDias(b.desde, 1) : undefined}
            onChange={(ev) => setB((x) => ({ ...x, hasta: ev.target.value }))} error={Boolean(problema)} />
        </Field>
        <Field label="Motivo" span2>
          <Textarea rows={2} value={b.motivo} onChange={(ev) => setB((x) => ({ ...x, motivo: ev.target.value }))}
            placeholder={tipo === "demora" ? "Por qué arranca más tarde (trabajo, viaje…)" : "Por qué pausa (salud, mudanza, trabajo…)"} />
        </Field>
        <Field label="Lo autoriza" span2
          ayuda={sobreTope ? `${sobreTope} Para dar más, alguien del equipo lo autoriza y queda anotado.` : "Opcional dentro del tope: quién del equipo se la dio (por ejemplo, el closer)."}>
          <Select value={b.autorizadoPor} placeholder="Nadie en particular" aria-label="Quién lo autoriza" error={Boolean(sobreTope && !b.autorizadoPor)}
            onChange={(ev) => setB((x) => ({ ...x, autorizadoPor: ev.target.value }))}
            opciones={[{ valor: "", texto: "Nadie en particular" }, ...equipo.map((n) => ({ valor: n, texto: n })),
              ...(b.autorizadoPor && !equipo.includes(b.autorizadoPor) ? [{ valor: b.autorizadoPor, texto: b.autorizadoPor }] : [])]} />
        </Field>
        {egresoEscritoAMano(f.inicio, f.seg.fechaEgreso, f.duracion) && (
          <p className="t-sm t-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
            Su fin del programa está escrito a mano ({f.egreso ? fmt(f.egreso) : "—"}): no se corre solo. Si cambia, corregilo en «Fin del programa».
          </p>
        )}
        {finNuevo && (
          <p className="t-sm t-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
            {b.hasta && `${dias(diasEntre(nueva.desde, b.hasta))} · `}El programa termina el <strong>{fmt(finNuevo)}</strong>
            {f.egreso && finNuevo !== f.egreso ? ` (antes, el ${fmt(f.egreso)})` : ""}.
          </p>
        )}
        {pausa && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Button variante="ghost" sm icono={<Trash2 size={14} />} onClick={() => escribir(true)}>
              {tipo === "demora" ? "Borrar la demora" : "Borrar esta pausa"}
            </Button>
          </div>
        )}
      </div>
    </ModalForm>
  );
}
