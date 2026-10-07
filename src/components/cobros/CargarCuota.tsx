"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Avatar, Badge, Chip, Input } from "@/components/ui/ui";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { RegistrarPago } from "@/components/cobros/RegistrarPago";
import { useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import {
  coincidencias, nombreDeCuota, opcionesDeFiltro, personaPorId, todosLosQueDeben,
  type CuotaPendiente, type FiltroPersonas, type PersonaBuscada,
} from "@/lib/buscar-cliente";

/* ==================================================================
   Cargar el pago de una cuota sin pasar por la ficha.

   Se busca a la persona (nombre, correo o teléfono), se elige la cuota
   que paga y el pago se carga con el mismo asistente de la ficha
   (RegistrarPago): cuánto, por dónde, cómo se prueba y qué hacer si
   pagó de menos. Sin buscar nada, arriba aparecen los más atrasados.

   Con decenas de personas atrasadas, buscar una por una no alcanza:
   arriba van los chips de closer y de servicio, y cada persona dice qué
   compró y quién lo cerró (Angelo, 06/10).
   ================================================================== */

/* Cuántas personas se listan: el resto se llega por la búsqueda o los chips. */
const VISIBLES = 10;

const deudaDe = (p: PersonaBuscada) => p.cuotas.reduce((a, c) => a + c.saldo, 0);
const atrasada = (c: CuotaPendiente) => c.diasAtraso > 0;
const unicos = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
/* «Mentoría · cerró Dante Barbieri»: lo que ayuda a reconocer a quién es. */
const queCompro = (p: PersonaBuscada) => {
  const servicios = unicos(p.cuotas.map((c) => c.producto));
  const closers = unicos(p.cuotas.map((c) => c.closer));
  return [servicios.join(", "), closers.length ? `cerró ${closers.join(", ")}` : "sin closer"].filter(Boolean).join(" · ");
};

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
  const [filtro, setFiltro] = useState<FiltroPersonas>({});
  const opciones = useMemo(() => opcionesDeFiltro(e, filtro), [e, filtro]);

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
  const todos = busca.trim() ? coincidencias(e, busca, true, filtro) : todosLosQueDeben(e, filtro);
  const lista = todos.slice(0, VISIBLES);
  const hayFiltro = Boolean(filtro.closerId || filtro.productoId);
  const alternar = (k: keyof FiltroPersonas, id: string) => setFiltro((f) => ({ ...f, [k]: f[k] === id ? undefined : id }));
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
          {(opciones.closers.length > 1 || opciones.servicios.length > 1 || hayFiltro) && (
            <div className="stack-2 cargar-filtros">
              {(opciones.closers.length > 1 || filtro.closerId) && (
                <div className="row-wrap" role="group" aria-label="Filtrar por closer">
                  <span className="t-label cargar-filtros__rotulo">Closer</span>
                  <Chip activo={!filtro.closerId} onClick={() => setFiltro((f) => ({ ...f, closerId: undefined }))}>Todos</Chip>
                  {opciones.closers.map((o) => (
                    <Chip key={o.id} activo={filtro.closerId === o.id} onClick={() => alternar("closerId", o.id)} count={o.personas}>{o.nombre}</Chip>
                  ))}
                </div>
              )}
              {(opciones.servicios.length > 1 || filtro.productoId) && (
                <div className="row-wrap" role="group" aria-label="Filtrar por servicio">
                  <span className="t-label cargar-filtros__rotulo">Servicio</span>
                  <Chip activo={!filtro.productoId} onClick={() => setFiltro((f) => ({ ...f, productoId: undefined }))}>Todos</Chip>
                  {opciones.servicios.map((o) => (
                    <Chip key={o.id} activo={filtro.productoId === o.id} onClick={() => alternar("productoId", o.id)} count={o.personas}>{o.nombre}</Chip>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="stack-2">
            <span className="t-label">{busca.trim() ? "Con cuotas por pagar" : "Los más atrasados"}</span>
            {lista.length === 0 ? (
              <p className="t-sm t-muted">
                {hayFiltro
                  ? "Con ese closer y ese servicio no hay cuotas por pagar. Probá con otro, o sacá el filtro."
                  : busca.trim()
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
                      <span className="opcion__sub">{queCompro(p)}</span>
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
            {todos.length > lista.length && (
              <p className="t-sm t-subtle">
                Se ven {lista.length} de {todos.length}. Para encontrar a alguien más, buscalo por nombre o elegí un closer o un servicio.
              </p>
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
                    {c.cuota.vence ? `Vence el ${fechaLarga(c.cuota.vence)}` : "Sin fecha"} · faltan {M(c.saldo)} · {c.closer ? `cerró ${c.closer}` : "sin closer"}
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
