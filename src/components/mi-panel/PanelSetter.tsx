"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Tile } from "./Tile";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaHora, money, num } from "@/lib/format";
import { sinTildes } from "@/lib/crm";
import { CANCELADA, CON_CIERRE, HECHA, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE } from "@/lib/estados";
import type { AgendaDeSetter, MiPanel as Datos } from "@/lib/mi-panel";
import { acciones, useEstado } from "@/lib/store";
import { agendasParaMarcar, DIAS_ADELANTE, DIAS_ATRAS } from "@/lib/setter-agendas";
import type { ID } from "@/lib/types";
import { clic, pctTxt } from "./util";

/* ==================================================================
   El panel del setter (de Blue OS: «Mi día» y «Resultados»): las agendas
   que le cargaron, cuántas se presentaron y en cuántas terminó habiendo
   venta. Una agenda es suya si entró por su link (utm_campaign=setter_nombre)
   o si la marcó él con «Sumar agendas» (Daniel, 24/10: así no le tiene que
   avisar a cada closer; la venta lo toma sola, lib/setter-agendas.ts).
   ================================================================== */

/** Marcar o desmarcar desde el panel: lo hace la base y avisa con un toast. */
function useMarcar(setterId: ID) {
  const toast = useToast();
  const [marcando, setMarcando] = useState<ID | null>(null);
  const marcar = async (sesionId: ID, mia: boolean, nombre: string) => {
    setMarcando(sesionId);
    const r = await acciones.marcarAgendaDeSetter(sesionId, mia, setterId);
    setMarcando(null);
    if (!r.ok) { toast(r.error, "err"); return; }
    if (!mia) toast(`Sacaste a ${nombre} de tus agendas.`, "info");
    else toast(r.ventas > 0
      ? `Listo: ya quedaste de setter en la venta de ${nombre}.`
      : `Listo: si le venden a ${nombre}, quedás de setter solo.`);
  };
  return { marcando, marcar };
}

function resultadoDe(a: AgendaDeSetter, ahora: number): string {
  if (a.fila) return a.fila.resultado;
  const s = a.sesion;
  if (s.estado === "cancelada") return CANCELADA;
  if (s.estado === "no-show") return NO_SE_PRESENTO;
  if (s.estado === "hecha") return HECHA;
  return new Date(s.inicia).getTime() > ahora ? POR_VENIR : SIN_CARGAR;
}

const variante = (r: string) => r === CON_CIERRE ? "success" : r === NO_SE_PRESENTO ? "danger" : r === SIN_CARGAR ? "warning" : r === POR_VENIR ? "info" : "neutral";

export function PanelSetter({ datos, rangoTxt, ahora, puedeMarcar }: {
  datos: Datos; rangoTxt: string; ahora: number;
  /* Su propio panel (no un dueño mirándolo «como»): puede sumar y sacar agendas. */
  puedeMarcar: boolean;
}) {
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useState("");
  const [sumar, setSumar] = useState(false);
  const { marcando, marcar } = useMarcar(datos.miembro.id);
  const filas = useMemo(() => datos.agendasDeSetter.map((a) => ({ a, r: resultadoDe(a, ahora) })), [datos.agendasDeSetter, ahora]);
  const validas = filas.filter((x) => x.r !== CANCELADA && x.r !== REPROGRAMO);
  const porVenir = validas.filter((x) => x.r === POR_VENIR).length;
  const noShows = validas.filter((x) => x.r === NO_SE_PRESENTO).length;
  const seSentaron = validas.filter((x) => [CON_CIERRE, SIN_CIERRE, HECHA].includes(x.r)).length;
  const compraron = validas.filter((x) => x.a.venta || x.r === CON_CIERRE).length;
  const pasaron = validas.length - porVenir;
  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    return t ? filas.filter((x) => sinTildes(x.a.sesion.invitado).includes(t)) : filas;
  }, [filas, q]);

  return (
    <div className="mp">
      <section aria-labelledby="mp-set">
        <div className="mp-seccion"><h2 id="mp-set">Cómo te va</h2><span>{rangoTxt}</span></div>
        <div className="mp-tiles">
          <Tile rot="Agendas a tu nombre" valor={num(validas.length)} sub="por tu link o sumadas por vos" />
          <Tile rot="Por venir" valor={num(porVenir)} sub="todavía no pasaron" />
          <Tile rot="Se presentaron" valor={num(seSentaron)} sub={`${pctTxt(pasaron > 0 ? Math.round((seSentaron / pasaron) * 1000) / 10 : null)} de las que pasaron${noShows ? ` · ${noShows} no vinieron` : ""}`} />
          <Tile rot="Terminaron comprando" valor={num(compraron)} sub={datos.ventasDeSetter ? `${num(datos.ventasDeSetter)} ventas con vos de setter` : "ventas con vos de setter"} />
          {datos.comisionSetter > 0 && <Tile rot="Tu comisión" valor={money(datos.comisionSetter, "USD", 2)} sub="sobre las ventas donde figurás como setter" verde />}
        </div>
      </section>
      <section className="mp-card mp-card--sin-relleno" aria-label="Mis agendas">
        <div className="mp-cabeza">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ display: "inline" }}>Mis agendas</h2> <span className="mp-cuenta">{validas.length}</span>
            <span className="mp-nota" style={{ marginTop: 4 }}>
              {puedeMarcar
                ? "Las que entraron por tu link y las que sumaste vos. Si setteaste una que no está, sumala: si le venden, quedás de setter solo."
                : "Las que entraron por su link y las que marcó como suyas."}
            </span>
          </div>
          <div className="mp-cabeza__der">
            <input className="mp-buscar" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar nombre…" aria-label="Buscar una agenda por nombre" />
            <Link href="/agenda" className="link t-sm">Ver la agenda</Link>
            {puedeMarcar && <Button sm variante="primary" icono={<Plus size={14} />} onClick={() => setSumar(true)}>Sumar agendas</Button>}
          </div>
        </div>
        {visibles.length === 0 ? (
          <p className="mp-vacio mp-lista__vacio">
            {filas.length === 0 ? "Todavía no hay agendas a tu nombre en este rango. Entran solas cuando alguien agenda con tu link (utm_campaign=setter_tunombre), y las que setteaste por otro lado las sumás con «Sumar agendas»." : "Ninguna agenda coincide con la búsqueda."}
          </p>
        ) : (
          <div className="mp-lista">
            {visibles.slice(0, 60).map(({ a, r }) => {
              const id = a.sesion.contactoId ?? a.sesion.leadId;
              return (
                <div key={a.sesion.id} className={`mp-lista__fila mp-lista__fila--setter${id ? " mp-lista__fila--clic" : ""}${r === CANCELADA ? " mp-lista__fila--tachada" : ""}`} {...(id ? clic(() => abrirFicha(id, "llamadas")) : {})}>
                  <span className="mp-lista__hora">{fechaHora(a.sesion.inicia)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="mp-lista__nombre" style={{ display: "block" }}>{a.sesion.invitado}</span>
                    <span className="mp-lista__origen">
                      {a.porLink ? "Por tu link" : "La sumaste vos"}
                      {a.marcada && !a.porLink && puedeMarcar && (
                        <>
                          {" · "}
                          <button type="button" className="link" disabled={marcando === a.sesion.id}
                            onClick={(ev) => { ev.stopPropagation(); void marcar(a.sesion.id, false, a.sesion.invitado); }}>
                            {marcando === a.sesion.id ? "Sacando…" : "Sacar"}
                          </button>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="t-sm t-subtle" style={{ whiteSpace: "nowrap" }}>{a.sesion.anfitrion ? `con ${a.sesion.anfitrion}` : "sin closer"}</span>
                  <Badge variante={a.venta ? "success" : variante(r)}>{a.venta ? "Compró" : a.fila?.estadoLlamada || a.fila?.aviso || r}</Badge>
                </div>
              );
            })}
          </div>
        )}
        {visibles.length > 60 && <div className="mp-lista__pie">Y {visibles.length - 60} más. Se muestran las 60 más recientes: afiná con la búsqueda o el rango.</div>}
      </section>
      {sumar && <SumarAgendas setterId={datos.miembro.id} ahora={ahora} marcando={marcando} marcar={marcar} onCerrar={() => setSumar(false)} />}
    </div>
  );
}

/* ---------- Sumar agendas: buscar la persona y marcarla como suya ---------- */

function SumarAgendas({ setterId, ahora, marcando, marcar, onCerrar }: {
  setterId: ID; ahora: number; marcando: ID | null;
  marcar: (sesionId: ID, mia: boolean, nombre: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const e = useEstado();
  const [q, setQ] = useState("");
  const lista = useMemo(() => agendasParaMarcar(e, setterId, ahora, q), [e, setterId, ahora, q]);
  const tope = 80;
  return (
    <Modal abierto onCerrar={onCerrar} ancho titulo="Sumar agendas que setteaste"
      sub={`Las agendas de las últimas ${DIAS_ATRAS / 7} semanas y las próximas ${DIAS_ADELANTE / 7}. Si a esa persona le venden, quedás de setter en la venta sin que el closer lo elija.`}>
      <div className="sumar-agendas">
        <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por nombre o mail" aria-label="Buscar una agenda" autoFocus />
        {lista.length === 0 ? (
          <p className="t-sm t-subtle" style={{ margin: 0 }}>{q ? "Ninguna agenda coincide con la búsqueda." : "No hay agendas en estas semanas."}</p>
        ) : (
          <div className="sumar-agendas__lista" role="list">
            {lista.slice(0, tope).map(({ sesion: s, marcadaPor, porLink, yaPaso }, i, xs) => {
              const mia = marcadaPor?.id === setterId;
              const titulo = i === 0 || xs[i - 1].yaPaso !== yaPaso ? (yaPaso ? "Ya pasaron" : "Próximas") : null;
              return (
                <React.Fragment key={s.id}>
                  {titulo && <div className="sumar-agendas__grupo">{titulo}</div>}
                  <div role="listitem" className="sumar-agendas__fila" data-mia={mia || porLink || undefined}>
                    <span className="sumar-agendas__fecha t-sm">{fechaHora(s.inicia)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="truncate t-strong" style={{ display: "block" }}>{s.invitado}</span>
                      <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
                        {[s.anfitrion ? `con ${s.anfitrion}` : "sin closer", s.email].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {mia ? (
                      <span className="sumar-agendas__accion">
                        <Badge variante="success">Es tuya</Badge>
                        <button type="button" className="link t-sm" disabled={marcando === s.id} onClick={() => void marcar(s.id, false, s.invitado)}>
                          {marcando === s.id ? "Sacando…" : "Sacar"}
                        </button>
                      </span>
                    ) : porLink ? (
                      <Badge variante="success">Por tu link</Badge>
                    ) : marcadaPor ? (
                      <Badge variante="neutral">La sumó {marcadaPor.nombre.split(" ")[0]}</Badge>
                    ) : (
                      <Button sm variante="secondary" disabled={marcando === s.id} onClick={() => void marcar(s.id, true, s.invitado)}>
                        {marcando === s.id ? "Sumando…" : "La setteé yo"}
                      </Button>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
        {lista.length > tope && <p className="t-sm t-subtle" style={{ margin: 0 }}>Y {lista.length - tope} más: buscá por nombre.</p>}
      </div>
    </Modal>
  );
}
