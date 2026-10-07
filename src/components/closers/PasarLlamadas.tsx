"use client";

import React, { useMemo, useRef, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button, Select } from "@/components/ui/ui";
import { Opcion } from "@/components/ui/Asistente";
import { EstadoDeLlamada } from "@/components/estados/EstadoLlamada";
import { textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { useEstado } from "@/lib/store";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { filasCrm } from "@/lib/crm";
import { estadoVisible } from "@/lib/estados";
import { pasadaDe } from "@/lib/pasada-closer";
import {
  agruparPorCloser, avisosDePase, closerDeLlamada, destinosDePase, todaviaNoPaso, type GrupoDeCloser,
} from "@/lib/pasar-llamadas";
import type { Sesion } from "@/lib/types";
import { sePuedePasar, usePasarLlamadas } from "./usePasarLlamadas";
import "./closers.css";

/* ==================================================================
   «Pasar a otro closer» (reunión del 02/10: «debería ser tarea del
   director: bueno, tal te atiende»).

   Una llamada, desde su detalle en la Agenda o desde la ficha; o varias de
   un closer a otro (el lote), eligiendo de quién son y cuáles. Se elige a
   quién y se pasa: el nuevo la ve en su cuenta, el viejo deja de verla, y
   Calendly no la vuelve a pisar aunque el invitado cancele o reprograme.
   Lo que hay que saber antes se dice acá, no después: a quién le falta su
   correo, qué ventas ya están cargadas.

   Las reglas están en lib/pasar-llamadas.ts.
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const cuando = (iso: string) => `${textoFecha(diaDeNegocio(iso))} · ${HORA.format(new Date(iso))}`;
const cuentaLlamadas = (n: number) => `${n} ${n === 1 ? "llamada" : "llamadas"}`;

export function PasarLlamadas({ llamadas, lote = false, onCerrar }: {
  /* Las llamadas que se pueden pasar: la que se está mirando, o (en el lote) las que se ven. */
  llamadas: Sesion[];
  /* Varias de un closer a otro: se elige de quién y cuáles. */
  lote?: boolean;
  onCerrar: () => void;
}) {
  const e = useEstado();
  const pasar = usePasarLlamadas();
  const ahora = useRef(Date.now()).current;
  const destinos = useMemo(() => destinosDePase(e), [e]);
  /* La venta que salió de cada llamada: la sabe la fila del CRM. */
  const ventas = useMemo(() => new Map(filasCrm(e).map((f) => [f.id, f.venta])), [e]);

  const candidatas = useMemo(() => llamadas.filter(sePuedePasar), [llamadas]);
  const grupos = useMemo(() => agruparPorCloser(candidatas, e.equipo), [candidatas, e.equipo]);
  const [de, setDe] = useState(grupos[0]?.clave ?? "");
  const grupo = grupos.find((g) => g.clave === de) ?? grupos[0];
  /* De entrada, las que todavía no pasaron: es lo que se suele pasar. */
  const proximas = (g?: GrupoDeCloser<Sesion>) => new Set((g?.llamadas ?? []).filter((s) => todaviaNoPaso(s, ahora)).map((s) => s.id));
  const [elegidas, setElegidas] = useState<Set<string>>(() => proximas(grupos[0]));
  const [destinoId, setDestinoId] = useState("");

  const una = !lote ? candidatas[0] : undefined;
  const aPasar = lote ? (grupo?.llamadas ?? []).filter((s) => elegidas.has(s.id)) : una ? [una] : [];
  /* Quién las tiene hoy; un grupo sin closer no es de nadie. */
  const actual = una ? closerDeLlamada(una, e.equipo) : { nombre: grupo && grupo.clave !== "sin-closer" ? grupo.nombre : "", miembro: grupo?.miembro };
  const opciones = destinos.filter((d) => d.miembro.id !== actual.miembro?.id);
  const destino = opciones.find((d) => d.miembro.id === destinoId);
  const avisos = avisosDePase(aPasar, e, (id) => ventas.get(id));

  const cambiarDe = (clave: string) => {
    setDe(clave);
    setElegidas(proximas(grupos.find((g) => g.clave === clave)));
    /* Quien las tenía no puede ser el destino. */
    if (grupos.find((g) => g.clave === clave)?.miembro?.id === destinoId) setDestinoId("");
  };
  const alternar = (id: string) => setElegidas((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const unaSola = aPasar.length === 1;
  const quien = destino?.miembro.nombre ?? "";
  const confirmar = () => {
    if (!destino || aPasar.length === 0) return;
    pasar(aPasar, destino);
    onCerrar();
  };
  const previa = una ? pasadaDe(una) : undefined;

  return (
    <Modal
      abierto onCerrar={onCerrar} ancho
      titulo={lote ? "Pasar llamadas a otro closer" : "Pasar a otro closer"}
      sub={lote
        ? "Elegí de quién son, cuáles y a quién se las pasás."
        : una ? `${una.invitado?.trim() || "La llamada"} · ${cuando(una.inicia)}` : undefined}
      pie={
        <>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button variante="primary" disabled={!destino || aPasar.length === 0} onClick={confirmar}>
            {!destino ? "Elegí a quién" : unaSola ? `Pasar a ${quien}` : `Pasar ${cuentaLlamadas(aPasar.length)} a ${quien}`}
          </Button>
        </>
      }
    >
      <div className="pasar">
        {una && (
          <div className="pasar__llamada">
            <span className="pasar__llamada-datos">
              <span className="t-strong" style={{ color: "var(--ink)" }}>{actual.nombre ? `Hoy la atiende ${actual.nombre}` : "Todavía no la atiende nadie"}</span>
              <span className="t-sm t-subtle">
                {previa
                  ? `La pasó ${previa.por || "alguien"}${previa.calendly ? ` · en Calendly figura ${previa.calendly}` : ""}.`
                  : actual.miembro || !actual.nombre ? "Es el anfitrión del evento en Calendly." : "En Calendly figura así, y no está en Equipo: nadie más que los dueños la ve."}
              </span>
            </span>
            <EstadoDeLlamada ver={estadoVisible(e, una)} />
          </div>
        )}

        {lote && (
          grupos.length === 0 ? (
            <p className="t-sm t-subtle">No hay llamadas para pasar en lo que estás viendo.</p>
          ) : (
            <>
              <div className="pasar__bloque">
                <span className="t-label">¿De quién son?</span>
                <Select
                  aria-label="De quién son las llamadas" value={grupo?.clave ?? ""} onChange={(ev) => cambiarDe(ev.target.value)}
                  opciones={grupos.map((g) => ({ valor: g.clave, texto: `${g.nombre} · ${cuentaLlamadas(g.llamadas.length)}` }))}
                />
              </div>
              <div className="pasar__bloque">
                <div className="pasar__titulo">
                  <span className="t-label">¿Cuáles? <span className="t-subtle" style={{ textTransform: "none", letterSpacing: 0 }}>· {elegidas.size} de {grupo?.llamadas.length ?? 0}</span></span>
                  <span className="pasar__acciones">
                    <button type="button" className="link" onClick={() => setElegidas(new Set((grupo?.llamadas ?? []).map((s) => s.id)))}>Todas</button>
                    <button type="button" className="link" onClick={() => setElegidas(proximas(grupo))}>Las que vienen</button>
                    <button type="button" className="link" onClick={() => setElegidas(new Set())}>Ninguna</button>
                  </span>
                </div>
                <ul className="pasar__lista" aria-label="Llamadas de este closer">
                  {[...(grupo?.llamadas ?? [])].sort((a, b) => a.inicia.localeCompare(b.inicia)).map((s) => (
                    <li key={s.id}>
                      <label className="pasar__fila">
                        <input type="checkbox" checked={elegidas.has(s.id)} onChange={() => alternar(s.id)} aria-label={`Pasar la llamada con ${s.invitado}`} />
                        <span className="pasar__fila-cuando t-num">{cuando(s.inicia)}</span>
                        <span className="pasar__fila-quien truncate">{s.invitado?.trim() || "Sin nombre"}</span>
                        <span className="pasar__fila-estado"><EstadoDeLlamada ver={estadoVisible(e, s)} /></span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )
        )}

        {(!lote || grupos.length > 0) && (
          <div className="pasar__bloque">
            <span className="t-label">{lote ? "¿A quién se las pasás?" : "¿A quién se la pasás?"}</span>
            {opciones.length === 0 ? (
              <p className="t-sm t-subtle">No hay a quién pasársela: cargá más closers en Equipo (con rol «Closer»).</p>
            ) : (
              <div className="opciones pasar__destinos" role="group" aria-label="A quién pasarla">
                {opciones.map((d) => (
                  <Opcion
                    key={d.miembro.id} nombre={d.miembro.nombre} activo={d.miembro.id === destinoId}
                    sub={d.sinCorreo ? "Le falta el correo en Equipo" : undefined}
                    onClick={() => setDestinoId(d.miembro.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {destino && aPasar.length > 0 && (
          <div className="pasar__notas">
            <p className="pasar__nota">
              <Info size={15} aria-hidden />
              <span>
                {quien} {aPasar.length === 1 ? "la ve" : "las ve"} en su cuenta (Mis llamadas y el cierre del día)
                {actual.nombre ? ` y ${actual.nombre} deja de ${aPasar.length === 1 ? "verla" : "verlas"}` : ""}.
                Calendly no {aPasar.length === 1 ? "la" : "las"} vuelve a pisar: {aPasar.length === 1 ? "queda" : "quedan"} con {quien} aunque el invitado cancele o reprograme.
              </span>
            </p>
            {destino.sinCorreo && (
              <p className="pasar__nota pasar__nota--atencion">
                <TriangleAlert size={15} aria-hidden />
                <span>A {quien} le falta el correo en Equipo, así que la app no sabe quién es y no va a ver {aPasar.length === 1 ? "esta llamada" : "estas llamadas"}. Cargalo en Equipo → Accesos.</span>
              </p>
            )}
            {avisos.conVenta.length > 0 && (
              <p className="pasar__nota">
                <Info size={15} aria-hidden />
                <span>
                  {avisos.conVenta.length === 1 ? "Una ya tiene" : `${avisos.conVenta.length} ya tienen`} la venta cargada
                  ({avisos.conVenta.slice(0, 3).map((v) => `${v.persona}, de ${v.closer}`).join("; ")}{avisos.conVenta.length > 3 ? "…" : ""}):
                  la venta sigue a nombre de quien {avisos.conVenta.length === 1 ? "la atendió" : "las atendió"}. Las ventas que se carguen desde ahora salen a nombre de {quien}.
                </span>
              </p>
            )}
            {avisos.hechas > 0 && (
              <p className="pasar__nota">
                <Info size={15} aria-hidden />
                <span>{avisos.hechas === 1 ? "Una ya se hizo" : `${avisos.hechas} ya se hicieron`}: pasar {avisos.hechas === 1 ? "la" : "las"} sólo cambia quién figura atendiéndo{avisos.hechas === 1 ? "la" : "las"}.</span>
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
