"use client";

import React, { useState } from "react";
import { Search } from "lucide-react";
import { Avatar, Badge, Input } from "@/components/ui/ui";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { RegistrarPago } from "@/components/cobros/RegistrarPago";
import { useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import {
  buscarPersonas, conCuotasPendientes, nombreDeCuota, personaPorId, type CuotaPendiente, type PersonaBuscada,
} from "@/lib/buscar-cliente";

/* ==================================================================
   Cargar el pago de una cuota sin pasar por la ficha.

   Se busca a la persona (nombre, correo o teléfono), se elige la cuota
   que paga y el pago se carga con el mismo asistente de la ficha
   (RegistrarPago): cuánto, por dónde, cómo se prueba y qué hacer si
   pagó de menos. Sin buscar nada, arriba aparecen los más atrasados.
   ================================================================== */

const deudaDe = (p: PersonaBuscada) => p.cuotas.reduce((a, c) => a + c.saldo, 0);
const atrasada = (c: CuotaPendiente) => c.diasAtraso > 0;

export function CargarCuota({ cuotaId, onCerrar, onListo }: {
  /* Ya elegida (desde el asistente de venta): se va derecho al pago. */
  cuotaId?: string;
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const e = useEstado();
  const M = (n: number) => money(n, e.ajustes.monedaBase, 0);
  const [busca, setBusca] = useState("");
  const [personaId, setPersonaId] = useState<string | undefined>();
  const [elegida, setElegida] = useState<string | undefined>();
  const [pagando, setPagando] = useState<string | undefined>(cuotaId);
  const [paso, setPaso] = useState(0);

  const cuota = pagando ? e.cuotas.find((c) => c.id === pagando) : undefined;
  if (cuota) {
    return (
      <RegistrarPago
        cuota={cuota} onGuardado={onListo}
        /* Salir del pago vuelve a elegir la cuota; si vino elegida de afuera, sale. */
        onCerrar={() => (cuotaId ? onCerrar() : setPagando(undefined))}
      />
    );
  }

  const persona = personaPorId(e, personaId);
  const lista = busca.trim() ? buscarPersonas(e, busca, 8, true) : conCuotasPendientes(e, 8);
  const pasos = [{ id: "quien", titulo: "Quién paga" }, { id: "cuota", titulo: "Qué cuota" }];
  const problema = paso === 0 ? (persona ? null : "Elegí a quién paga") : (elegida ? null : "Elegí la cuota");

  return (
    <Asistente
      etiqueta="Cargar el pago de una cuota" pasos={pasos} actual={paso} onCambiarPaso={setPaso}
      problema={problema} onCerrar={onCerrar} terminarTexto="Cargar el pago" onTerminar={() => setPagando(elegida)}
    >
      {paso === 0 && (
        <>
          <Pregunta
            texto="¿De quién es el pago?"
            sub="Buscá por nombre, correo o teléfono. Sin buscar, arriba están los que tienen cuotas más atrasadas."
          />
          <Input
            icono={<Search size={16} />} value={busca} onChange={(ev) => setBusca(ev.target.value)} autoFocus
            placeholder="Nombre, correo o teléfono" aria-label="Buscar a quien paga"
          />
          <div className="stack-2">
            <span className="t-label">{busca.trim() ? "Con cuotas por pagar" : "Los más atrasados"}</span>
            {lista.length === 0 ? (
              <p className="t-sm t-muted">
                {busca.trim()
                  ? "Nadie que coincida tiene cuotas por pagar. Si es una compra nueva, cargala como venta."
                  : "No hay cuotas por pagar."}
              </p>
            ) : (
              <div className="opciones opciones--lista">
                {lista.map((p) => (
                  <button
                    type="button" className="opcion" key={p.id} aria-pressed={p.id === personaId}
                    onClick={() => {
                      setPersonaId(p.id);
                      setElegida(p.cuotas.length === 1 ? p.cuotas[0].cuota.id : undefined);
                      setPaso(1);
                    }}
                  >
                    <span className="opcion__texto">
                      <span className="opcion__nombre">{p.nombre}</span>
                      <span className="opcion__sub">{[p.email, p.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</span>
                    </span>
                    <span className="opcion__extra">
                      <Badge variante={p.cuotas.some(atrasada) ? "danger" : "accent"}>
                        {p.cuotas.length === 1 ? "1 cuota" : `${p.cuotas.length} cuotas`} · {M(deudaDe(p))}
                      </Badge>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {paso === 1 && persona && (
        <>
          <Pregunta
            texto={`¿Qué cuota paga ${persona.nombre.split(" ")[0]}?`}
            sub="Las que debe, de la más atrasada a la que vence última. En el paso siguiente se carga cuánto pagó y por dónde."
          />
          <div className="cliente-elegido">
            <Avatar nombre={persona.nombre} size={40} />
            <div className="cliente-elegido__datos">
              <span className="cliente-elegido__nombre">{persona.nombre}</span>
              <span className="t-sm t-subtle">{[persona.email, persona.telefono].filter(Boolean).join(" · ") || "Sin correo ni teléfono"}</span>
            </div>
            <Badge variante={persona.cuotas.some(atrasada) ? "danger" : "accent"}>Debe {M(deudaDe(persona))}</Badge>
          </div>
          <div className="opciones opciones--lista">
            {persona.cuotas.map((c, k) => (
              <button
                type="button" className="opcion" key={c.cuota.id} aria-pressed={elegida === c.cuota.id}
                onClick={() => setElegida(c.cuota.id)}
              >
                <span className="opcion__tecla">{k + 1}</span>
                <span className="opcion__texto">
                  <span className="opcion__nombre">{nombreDeCuota(c)}</span>
                  <span className="opcion__sub">
                    {c.cuota.vence ? `Vence el ${fechaLarga(c.cuota.vence)}` : "Sin fecha"} · faltan {M(c.saldo)}
                  </span>
                </span>
                <span className="opcion__extra">
                  <Badge variante={atrasada(c) ? "danger" : "neutral"}>
                    {atrasada(c) ? `${c.diasAtraso} ${c.diasAtraso === 1 ? "día" : "días"} de atraso` : "Al día"}
                  </Badge>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Asistente>
  );
}
