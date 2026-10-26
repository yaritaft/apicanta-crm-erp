"use client";

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Button, IconButton } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { Pastilla } from "@/components/cs/pastillas";
import { useEstado } from "@/lib/store";
import { formatoDia } from "@/lib/seguimiento";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { mesEnLetras, otroMes, resellsDelMes, resumenResells, textoParaPasar } from "@/lib/resells-agendados";
import { estadosDeResell } from "@/lib/clientes-cs";

/* ==================================================================
   Los resells que agendó Customer Success en el mes (Lili, 26/10: «necesito
   un reporte mensual de cuántos cargué en total, para la liquidación del
   sueldo, y verlo rápido para pasarlo»).

   El número del mes, con quién, y «Copiar para pasar» con el detalle. Es la
   misma cuenta que usa la liquidación de Honorarios (lib/resells-agendados.ts):
   cuenta el día en que se reservó la llamada, sin las canceladas.
   ================================================================== */

const VISIBLES = 6;

export function ResellsDelMes({ hoy, viendoOtro }: { hoy: string; viendoOtro: boolean }) {
  const e = useEstado();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const actual = hoy.slice(0, 7);
  const [mes, setMes] = useState(actual);
  const [todos, setTodos] = useState(false);
  const items = useMemo(() => resellsDelMes(e.resells, mes), [e.resells, mes]);
  const anterior = useMemo(() => resellsDelMes(e.resells, otroMes(mes, -1)).length, [e.resells, mes]);
  const resumen = resumenResells(items);
  const alumnoPorMail = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of e.alumnos) { const k = a.email.trim().toLowerCase(); if (k && !m.has(k)) m.set(k, a.id); }
    return m;
  }, [e.alumnos]);

  const copiar = async () => {
    const ok = await copiarTexto(textoParaPasar(mes, items));
    toast(ok ? `Copiado: ${resumen.total} ${resumen.total === 1 ? "resell" : "resells"} de ${mesEnLetras(mes)}, con el detalle.` : "No se pudo copiar.", ok ? "ok" : "err");
  };
  const ir = (cuantos: number) => { setMes((m) => otroMes(m, cuantos)); setTodos(false); };
  /* Lo último agendado arriba. */
  const recientes = [...items].reverse();
  const vistos = todos ? recientes : recientes.slice(0, VISIBLES);

  return (
    <section className="mp-card ps-card ps-rs" aria-label="Resells agendados">
      <div className="ps-rs__cab">
        <div>
          <h2 className="ps-tit">{viendoOtro ? "Resells que agendó" : "Resells que agendaste"}</h2>
          <p className="ps-ayuda">Los que entraron a la agenda de resells en el mes, por el día en que se reservaron, sin los cancelados. Es el número de la liquidación.</p>
        </div>
        <div className="ps-rs__mes" role="group" aria-label="Mes">
          <IconButton etiqueta="Mes anterior" onClick={() => ir(-1)}><ChevronLeft size={16} /></IconButton>
          <span className="ps-rs__mes-txt">{mesEnLetras(mes)}</span>
          <IconButton etiqueta="Mes siguiente" disabled={mes >= actual} onClick={() => ir(1)}><ChevronRight size={16} /></IconButton>
        </div>
      </div>

      <div className="ps-rs__cuerpo">
        <div className="ps-rs__total">
          <span className="ps-rs__n">{resumen.total}</span>
          <span className="ps-kpi__ctx">
            {resumen.total === 1 ? "resell agendado" : "resells agendados"}{mes === actual ? " hasta hoy" : ""}
            {` · ${anterior} en ${mesEnLetras(otroMes(mes, -1)).split(" ")[0]}`}
          </span>
        </div>
        <div className="ps-rs__detalle">
          {resumen.porCloser.map((x) => <span key={x.closer} className="ps-rs__chip">{x.closer} <b>{x.n}</b></span>)}
          {resumen.testimonio > 0 && <span className="ps-rs__chip">De testimonio <b>{resumen.testimonio}</b></span>}
        </div>
        <Button variante="secondary" icono={<Copy size={15} />} disabled={!resumen.total} onClick={() => void copiar()}>Copiar para pasar</Button>
      </div>

      {items.length > 0 && (
        <ul className="ps-rs__lista">
          {vistos.map(({ resell: r, dia, porLlamada }) => {
            const alumnoId = r.email ? alumnoPorMail.get(r.email.trim().toLowerCase()) : undefined;
            const llamada = diaDeNegocio(r.fechaHora);
            const abrir = alumnoId ? () => abrirFicha(alumnoId, "servicio", { hoja: "testimonio" }) : r.sesionId ? () => abrirFicha(r.sesionId!, "llamadas") : undefined;
            const estado = estadosDeResell(r.estado)[0];
            return (
              <li key={r.id} className="ps-rs__fila">
                {abrir
                  ? <button type="button" className="ps-rs__nombre truncate" onClick={abrir} title={`Abrir la ficha de ${r.nombre}`}>{r.nombre || "Sin nombre"}</button>
                  : <span className="ps-rs__nombre truncate">{r.nombre || "Sin nombre"}</span>}
                <span className="ps-rs__con truncate">con {r.closer.split(",")[0].trim().split(/\s+/)[0] || "—"}</span>
                <span className="ps-rs__cuando ps-num">{porLlamada ? `llamada ${formatoDia(dia, hoy)}` : `agendado ${formatoDia(dia, hoy)}`}{!porLlamada && llamada && llamada !== dia ? ` · llamada ${formatoDia(llamada, hoy)}` : ""}</span>
                <span className="ps-rs__estado">{estado ? <Pastilla texto={estado} /> : <span className="t-subtle t-sm">{Date.parse(r.fechaHora) > Date.now() ? "Por hacerse" : "Sin resultado"}</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > VISIBLES && (
        <button type="button" className="ps-rs__mas" onClick={() => setTodos((x) => !x)}>{todos ? "Ver menos" : `Ver los ${items.length}`}</button>
      )}
    </section>
  );
}
