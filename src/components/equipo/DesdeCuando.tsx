"use client";

import React from "react";
import { Lock } from "lucide-react";
import { Opcion } from "@/components/ui/Asistente";
import { Input } from "@/components/ui/ui";
import {
  mesesCerradosDesde, primeroDelMes, primeroDelMesQueViene, seParteEnElMes, type DesdeCuando,
} from "@/lib/versiones-regla";
import type { Liquidacion, TipoConcepto } from "@/lib/types";

/* ==================================================================
   «¿Desde cuándo vale?» — la pregunta que evita pisar la historia.

   Cambiar cómo cobra alguien (o agregarle o sacarle algo) ya no toca los
   meses de antes salvo que se diga a propósito: se elige el día desde el
   que vale y lo de antes queda como estaba (lib/versiones-regla.ts).
   «Siempre fue así» es para lo que estaba mal cargado.
   ================================================================== */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const diaYMes = (dia: string) => `${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]}`;
const mesDe = (dia: string) => MESES[Number(dia.slice(5, 7)) - 1];
const mesAnterior = (dia: string) => MESES[(Number(dia.slice(5, 7)) + 10) % 12];
const nombreDePeriodo = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]}${p.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${p.slice(0, 4)}` : ""}`;

export const hoyLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Qué se está decidiendo: un cambio de una regla que ya valía, una regla nueva o sacar una. */
export type ModoDesdeCuando = "cambio" | "nueva" | "sacar";

type Clave = "mes" | "hoy" | "siguiente" | "otro" | "siempre";

function claveDe(v: DesdeCuando | null, hoy: string, otroAbierto: boolean): Clave | null {
  if (!v) return null;
  if (v.tipo === "siempre") return "siempre";
  if (otroAbierto) return "otro";
  if (v.dia === primeroDelMes(hoy)) return "mes";
  if (v.dia === hoy) return "hoy";
  if (v.dia === primeroDelMesQueViene(hoy)) return "siguiente";
  return "otro";
}

/** El día elegido, llevado al primero del mes cuando la regla no se puede repartir dentro de un mes (bono, tramo, pieza). */
export function ajustarDia(dia: string, tipo: TipoConcepto | null | undefined): string {
  return seParteEnElMes(tipo) ? dia : primeroDelMes(dia);
}

/** Lo que dice el botón de guardar según lo elegido. */
export function textoDeDesde(v: DesdeCuando | null, modo: ModoDesdeCuando): string {
  if (!v) return modo === "sacar" ? "Sacar" : "Guardar";
  if (v.tipo === "siempre") return modo === "sacar" ? "Borrarla" : modo === "nueva" ? "Agregar" : "Corregir";
  return `${modo === "sacar" ? "Deja de valer" : modo === "nueva" ? "Agregar" : "Guardar"} desde el ${diaYMes(v.dia)}`;
}

export function DesdeCuandoOpciones({ tipo, modo, valor, onCambiar, liquidaciones, antes, despues, otroAbierto, onOtroAbierto }: {
  tipo: TipoConcepto | null | undefined;
  modo: ModoDesdeCuando;
  valor: DesdeCuando | null;
  onCambiar: (v: DesdeCuando) => void;
  liquidaciones: Pick<Liquidacion, "periodo" | "estado">[];
  /** La regla como estaba y como queda, dichas en castellano, para mostrar lo que pasa con cada una. */
  antes?: string;
  despues?: string;
  /** «Desde otro día» se queda abierto aunque el día coincida con otra opción. */
  otroAbierto: boolean;
  onOtroAbierto: (v: boolean) => void;
}) {
  const hoy = hoyLocal();
  const mes = primeroDelMes(hoy);
  const siguiente = primeroDelMesQueViene(hoy);
  const partible = seParteEnElMes(tipo);
  const clave = claveDe(valor, hoy, otroAbierto);
  const elegir = (dia: string, otro = false) => { onOtroAbierto(otro); onCambiar({ tipo: "desde", dia: ajustarDia(dia, tipo) }); };

  const sub = {
    mes: modo === "sacar" ? `${mayus(mesDe(mes))} ya no la cuenta; ${mesAnterior(mes)} y antes, como estaban.`
      : modo === "nueva" ? `Cuenta en todo ${mesDe(mes)}; los meses de antes no cambian.`
        : `Todo ${mesDe(mes)} con la regla nueva; ${mesAnterior(mes)} y antes, como estaban.`,
    hoy: modo === "sacar" ? "Hasta ayer cuenta; desde hoy, no. El mes se reparte por días."
      : modo === "nueva" ? "Desde hoy; el mes se reparte por días."
        : "Hasta ayer, la regla de antes; desde hoy, la nueva. El mes se reparte por días.",
    siguiente: modo === "sacar" ? `Sigue contando todo ${mesDe(mes)}.`
      : modo === "nueva" ? `Arranca en ${mesDe(siguiente)}.`
        : `${mayus(mesDe(mes))} sigue con la regla de antes.`,
    siempre: modo === "sacar" ? "Como si nunca hubiera estado: los meses abiertos y Finanzas dejan de contarla."
      : modo === "nueva" ? "Cuenta también en los meses de antes que no estén cerrados."
        : "Corrige también los meses de antes: Finanzas, los webinars y los meses abiertos.",
  };

  const cerrados = valor?.tipo === "desde"
    ? mesesCerradosDesde(liquidaciones, valor.dia)
    : liquidaciones.filter((l) => l.estado === "cerrada").map((l) => l.periodo).sort();

  return (
    <div className="stack-3">
      <div className="opciones opciones--lista">
        <Opcion tecla="1" nombre={`Desde el 1 de ${mesDe(mes)}`} sub={sub.mes} activo={clave === "mes"} onClick={() => elegir(mes)} />
        {partible && hoy !== mes && (
          <Opcion tecla="2" nombre={`Desde hoy, ${diaYMes(hoy)}`} sub={sub.hoy} activo={clave === "hoy"} onClick={() => elegir(hoy)} />
        )}
        <Opcion tecla={partible && hoy !== mes ? "3" : "2"} nombre={`Desde el 1 de ${mesDe(siguiente)}`} sub={sub.siguiente} activo={clave === "siguiente"} onClick={() => elegir(siguiente)} />
        <Opcion
          tecla={partible && hoy !== mes ? "4" : "3"} nombre="Desde otro día"
          sub={partible ? "Elegís el día: lo de antes queda como estaba." : "Elegís el mes: un bono, un tramo o una pieza se cuentan por mes entero."}
          activo={clave === "otro"} onClick={() => elegir(valor?.tipo === "desde" ? valor.dia : mes, true)}
        />
        {clave === "otro" && (
          <div className="desde-cuando__otro">
            <Input
              type="date" aria-label="Desde qué día vale" value={valor?.tipo === "desde" ? valor.dia : mes}
              onChange={(ev) => { if (ev.target.value) elegir(ev.target.value, true); }}
            />
            {!partible && <span className="t-sm t-subtle">Va desde el primero de ese mes.</span>}
          </div>
        )}
        <Opcion
          tecla={partible && hoy !== mes ? "5" : "4"}
          nombre={modo === "sacar" ? "Borrarla: estaba mal cargada" : modo === "nueva" ? "Desde siempre" : "Siempre fue así: estaba mal cargada"}
          sub={sub.siempre} activo={clave === "siempre"}
          onClick={() => { onOtroAbierto(false); onCambiar({ tipo: "siempre" }); }}
        />
      </div>

      {valor && (() => {
        const lineas: React.ReactNode[] = [];
        if (valor.tipo === "desde" && antes) lineas.push(<p key="a"><strong>Hasta el {diaYMes(diaAntes(valor.dia))}:</strong> {antes}</p>);
        if (modo !== "sacar" && despues) {
          lineas.push(<p key="d"><strong>{valor.tipo === "desde" ? `Desde el ${diaYMes(valor.dia)}:` : "Siempre:"}</strong> {despues}</p>);
        }
        if (modo === "sacar" && valor.tipo === "desde") lineas.push(<p key="s"><strong>Desde el {diaYMes(valor.dia)}:</strong> no cobra esto.</p>);
        return lineas.length ? <div className="desde-cuando__queda" aria-live="polite">{lineas}</div> : null;
      })()}

      {cerrados.length > 0 && valor && (
        <p className="desde-cuando__cerrado">
          <Lock size={14} aria-hidden />
          {cerrados.length === 1 ? `${mayus(nombreDePeriodo(cerrados[0]))} ya está cerrado` : `${cerrados.map(nombreDePeriodo).join(", ")} ya están cerrados`}
          : lo que se liquidó y se pagó ahí no cambia.
        </p>
      )}
    </div>
  );
}

const mayus = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const diaAntes = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
};
