"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { Chip } from "@/components/ui/ui";
import { fechaLarga, money } from "@/lib/format";
import { rutaDe, type PistaDeLlegada } from "@/lib/traspasos";
import type { EstadoApp, ID, Traspaso } from "@/lib/types";
import "./plata-en-camino.css";

/* ==================================================================
   «Plata en camino», dentro del arqueo.

   Aldana (11/11): «siempre me queda con diferencias por la plata que salió de una cuenta pero aún no llega a la otra. ¿Eso está bien así? Yo igual
   justifico todas las diferencias». Quien está contando es quien sabe si el banco ya acreditó una transferencia: acá lo dice con un clic, la cuenta
   de destino deja de esperarla y el casillero se pinta verde. Lo que dijo queda guardado en el movimiento (lib/traspasos.ts: cambioDeLlegada), así
   el próximo arqueo la suma cuando llegue y no marca un «sobra» que no es.
   ================================================================== */

export interface PaseEnPregunta {
  t: Traspaso;
  /* Cómo está ahora, con lo que ya se respondió en este arqueo. */
  enCamino: boolean;
}

export function PlataEnCamino({ e, preguntas, pistas, onCambiar }: {
  e: Pick<EstadoApp, "procesadores">;
  preguntas: readonly PaseEnPregunta[];
  pistas: readonly PistaDeLlegada[];
  onCambiar: (id: ID, enCamino: boolean) => void;
}) {
  if (preguntas.length === 0) return null;
  const nombre = (id: ID) => e.procesadores.find((p) => p.id === id)?.nombre ?? "la cuenta";
  const pistaDe = (id: ID) => pistas.find((p) => p.traspasoId === id);
  const hayPistas = pistas.length > 0;
  return (
    <section className={`camino${hayPistas ? " camino--pista" : ""}`} aria-label="Plata que puede estar en camino">
      <header className="camino__cabeza">
        <h3 className="camino__titulo">¿Hay plata en camino?</h3>
        <p className="t-sm t-muted camino__sub">
          Pases de los últimos días que ningún banco vio llegar. Si el banco todavía no lo acreditó, marcalo «En camino»: la cuenta de destino no lo espera
          y no te queda una diferencia para justificar.
        </p>
      </header>
      <ul className="camino__lista">
        {preguntas.map(({ t, enCamino }) => {
          const pista = pistaDe(t.id);
          const monto = money(t.montoLlega, t.monedaLlega, 2);
          return (
            <li key={t.id} className="camino__fila" data-en-camino={enCamino ? "si" : "no"}>
              <span className="camino__ruta">
                <span className="truncate">{t.origenId ? nombre(t.origenId) : "Sin cuenta de salida"}</span>
                <ArrowRight size={14} aria-label="a" />
                <span className="truncate">{t.destinoId ? nombre(t.destinoId) : "Sin cuenta de llegada"}</span>
              </span>
              <span className="camino__datos t-sm t-muted">
                <strong className="t-num">{monto}</strong> · salió el {fechaLarga(t.fecha)}
              </span>
              <span className="camino__elegir" role="group" aria-label={`¿Ya llegó ${rutaDe(e, t)}, ${monto}?`}>
                <Chip activo={!enCamino} onClick={() => onCambiar(t.id, false)}>Ya llegó</Chip>
                <Chip activo={enCamino} onClick={() => onCambiar(t.id, true)}>En camino</Chip>
              </span>
              {pista && (
                <span className="camino__pista t-sm" role="status">
                  {pista.sugiere === "camino"
                    ? `${nombre(pista.cuentaId)} marca ${money(Math.abs(pista.diferencia), t.monedaLlega, 2)} menos: justo lo de este pase. ¿Todavía no llegó?`
                    : `${nombre(pista.cuentaId)} marca ${money(Math.abs(pista.diferencia), t.monedaLlega, 2)} más: justo lo de este pase. ¿Ya llegó?`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
