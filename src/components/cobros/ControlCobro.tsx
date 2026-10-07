"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ExternalLink, FileText, ImageIcon, Link2, Loader2, Paperclip, ShieldAlert, ShieldCheck, Upload, X,
} from "lucide-react";
import { Badge, Button, Textarea } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CampoComprobante } from "@/components/cobros/CampoComprobante";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useSesion } from "@/lib/auth";
import {
  casilleroDe, comprobanteDeCobro, conciliacionDe, controlDeCobro, etiquetaDeControl, primerNombre, puedeCambiarComprobante,
  quienEs, ROL_DE_CASILLERO, type CasilleroChequeo, type ChequeoDeCasillero,
} from "@/lib/control-cobros";
import { descartarComprobante, tamanioLegible, urlDeComprobante, verComprobante } from "@/lib/comprobantes";
import { fechaHora, fechaLarga, money } from "@/lib/format";
import { nombrePasarela } from "@/lib/pasarelas";
import type { Comprobante, EstadoApp, Pago } from "@/lib/types";

/* ==================================================================
   El control cruzado de un cobro (lib/control-cobros.ts).

   Yari (02/10): no un tilde en la fila —«te confundís de fila»— sino una
   ventana: quien chequea ve el comprobante a un lado y lo que cargó el closer
   al otro (cliente, monto, medio, cuántos pagos), y confirma ahí, dos veces.
   «El que chequeó también es responsable»: queda escrito quién y cuándo.

   - `PildoraDeChequeo`: el estado con su dato adentro, para tablas.
   - `ChequeoDeCobro`: la pastilla con su ventana, para donde no hay una
     tabla que la maneje (la ficha de la venta).
   - `ModalChequeo`: la ventana.
   ================================================================== */

/** El correo que guarda la base como lo conoce el equipo. */
export function useNombreDeQuien(): (por?: string) => string {
  const equipo = useEstado().equipo;
  return useCallback((por?: string) => quienEs(equipo, por), [equipo]);
}

/** El estado de un cobro, con el dato adentro: «Sin chequear», «Chequeado ·
 *  Santiago», «Rechazado · Aldana». Con `onAbrir` es un botón. */
export function PildoraDeChequeo({ pago, onAbrir }: { pago: Pago; onAbrir?: () => void }) {
  const nombreDe = useNombreDeQuien();
  const et = etiquetaDeControl(controlDeCobro(pago), nombreDe);
  const icono = et.tono === "success" ? <Check size={13} aria-hidden /> : et.tono === "danger" ? <X size={13} aria-hidden /> : <ShieldAlert size={13} aria-hidden />;
  const clase = `hk-badge hk-badge--${et.tono}`;
  if (!onAbrir) return <span className={clase} title={et.detalle}>{icono}{et.texto}</span>;
  return (
    <button
      type="button" className={`${clase} chequeo-pildora`} title={`${et.detalle}\n\nClic para abrir el cobro`}
      onClick={(ev) => { ev.stopPropagation(); onAbrir(); }}
    >
      {icono}{et.texto}
    </button>
  );
}

/** La pastilla y, al hacer clic, su ventana. */
export function ChequeoDeCobro({ pago }: { pago: Pago }) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  return (
    <>
      <PildoraDeChequeo pago={pago} onAbrir={() => setAbierto(true)} />
      {abierto && <ModalChequeo pagoId={pago.id} onCerrar={cerrar} />}
    </>
  );
}

/* ---------- La vista previa del comprobante ---------- */

function VistaDelComprobante({ pago }: { pago: Pago }) {
  const toast = useToast();
  const prueba = comprobanteDeCobro(pago);
  const archivo = prueba.tipo === "archivo" ? prueba.comprobante : null;
  const ruta = archivo?.ruta;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!archivo) return;
    let vivo = true;
    let propio: string | null = null;
    setUrl(null); setError(null);
    urlDeComprobante(archivo).then(
      (u) => { if (!vivo) return; if (u.startsWith("blob:")) propio = u; setUrl(u); },
      (err) => { if (vivo) setError(err instanceof Error ? err.message : "No se pudo traer el comprobante."); },
    );
    return () => { vivo = false; if (propio) URL.revokeObjectURL(propio); };
    // Se vuelve a pedir sólo si cambia el archivo (o se reintenta), no en cada dibujo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, intento]);

  if (prueba.tipo === "ninguno") {
    return (
      <div className="chequeo__vista chequeo__vista--vacia">
        <FileText size={26} aria-hidden />
        <strong>{pago.movimientoId ? "Este cobro viene de la pasarela" : "Este cobro no tiene comprobante"}</strong>
        <span className="t-sm t-subtle">
          {pago.movimientoId
            ? "La plata está conciliada con el pago que llegó a la pasarela: los datos de la derecha son los de ella."
            : "No hay nada para comparar con lo que se cargó. Pedíselo al closer, o subilo desde acá si ya lo tenés."}
        </span>
      </div>
    );
  }

  if (prueba.tipo === "link") {
    return (
      <div className="chequeo__vista chequeo__vista--vacia">
        <Link2 size={26} aria-hidden />
        <strong>El comprobante es un link</strong>
        <span className="t-sm t-muted" style={{ overflowWrap: "anywhere" }}>{prueba.texto}</span>
        {prueba.url
          ? <a className="hk-btn hk-btn--secondary hk-btn--sm" href={prueba.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir el link</a>
          : <span className="t-sm t-subtle">Lo que escribió la planilla: no es un link que se pueda abrir.</span>}
      </div>
    );
  }

  const c = prueba.comprobante;
  const esPdf = c.tipo === "application/pdf";
  return (
    <div className="stack-2">
      <div className="chequeo__vista">
        {error ? (
          <div className="chequeo__vista--vacia" role="alert">
            <AlertTriangle size={24} aria-hidden />
            <span className="t-sm">{error}</span>
            <Button sm variante="secondary" onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>
          </div>
        ) : !url ? (
          <span className="row t-sm t-subtle" style={{ gap: 8 }}><Loader2 size={16} className="gira" aria-hidden />Trayendo el comprobante…</span>
        ) : esPdf ? (
          <iframe src={url} title={`Comprobante: ${c.nombre}`} className="chequeo__pdf" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Comprobante: ${c.nombre}`} className="chequeo__imagen" />
        )}
      </div>
      <div className="row t-sm t-subtle" style={{ gap: 8, flexWrap: "wrap" }}>
        {esPdf ? <FileText size={14} aria-hidden /> : <ImageIcon size={14} aria-hidden />}
        <span className="truncate" style={{ minWidth: 0, flex: "1 1 160px" }}>{c.nombre}</span>
        <span>{tamanioLegible(c.tamanio)} · subido {fechaHora(c.subidoEn)}</span>
        <button
          type="button" className="link t-sm"
          onClick={() => verComprobante(c).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err"))}
        >
          <ExternalLink size={12} /> Abrir en otra pestaña
        </button>
      </div>
    </div>
  );
}

/* ---------- Cómo está cada casillero ---------- */

function FilaDeCasillero({ casillero, chequeo, nombreDe, esMio }: {
  casillero: CasilleroChequeo; chequeo?: ChequeoDeCasillero; nombreDe: (por?: string) => string; esMio: boolean;
}) {
  const rol = ROL_DE_CASILLERO[casillero];
  const quien = chequeo ? nombreDe(chequeo.por) : "";
  return (
    <div className="chequeo__casillero" data-estado={chequeo?.veredicto ?? "pendiente"}>
      <span className="chequeo__casillero-rol">{rol.largo}{esMio && <span className="t-subtle"> · vos</span>}</span>
      {!chequeo ? (
        <Badge variante="neutral">Pendiente</Badge>
      ) : chequeo.veredicto === "chequeado" ? (
        <Badge variante="success" icono={<Check size={13} />}>Chequeado</Badge>
      ) : (
        <Badge variante="danger" icono={<X size={13} />}>Rechazado</Badge>
      )}
      {chequeo && (
        <span className="t-sm t-muted chequeo__casillero-quien">
          {quien || "Sin nombre"}{chequeo.en ? ` · ${fechaHora(chequeo.en)}` : ""}
        </span>
      )}
      {chequeo?.nota && <span className="t-sm chequeo__casillero-nota">«{chequeo.nota}»</span>}
    </div>
  );
}

/* ---------- La ventana ---------- */

const MOTIVOS = ["No coincide el monto", "No coincide el nombre", "Falta una parte del pago", "Es de otro cliente", "No se lee bien"];

type Paso = "ver" | "confirmar" | "rechazar";

export function ModalChequeo({ pagoId, onCerrar }: { pagoId: string; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const sesion = useSesion();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const nombreDe = useNombreDeQuien();
  const [paso, setPaso] = useState<Paso>("ver");
  const [motivo, setMotivo] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  /* El Modal vuelve a enfocar el primer campo si cambia `onCerrar`: va estable. */
  const alCerrar = useRef(onCerrar);
  useEffect(() => { alCerrar.current = onCerrar; });
  const cerrar = useCallback(() => alCerrar.current(), []);

  const pago = e.pagos.find((p) => p.id === pagoId);
  const datos = useMemo(() => (pago ? datosDelCobro(e, pago) : null), [e, pago]);

  /* Si el cobro se borró mientras estaba abierta, se cierra sola. */
  useEffect(() => { if (!pago) cerrar(); }, [pago, cerrar]);
  if (!pago || !datos) return null;

  const { venta, cuota, persona, producto, proc, closer, hermanos, nombreCuota } = datos;
  const control = controlDeCobro(pago);
  const miCasillero = casilleroDe(acceso);
  const miVeredicto = miCasillero ? (miCasillero === "director" ? control.director : control.finanzas) : undefined;
  const puedeSubir = puedeCambiarComprobante(acceso);
  const prueba = comprobanteDeCobro(pago);
  const sinNadaQueComparar = prueba.tipo === "ninguno" && !pago.movimientoId;
  const yo = sesion.email?.toLowerCase() ?? null;
  const loCargueYo = Boolean(yo && pago.cargadoPor && pago.cargadoPor.toLowerCase() === yo);
  const quienSoy = nombreDe(yo ?? e.ajustes.responsable) || "vos";
  const concilia = conciliacionDe(e.procesadores, pago);
  const nombreCliente = venta?.contactoNombre ?? "este cliente";
  const monto = money(pago.monto, "USD", 2);
  const pagadoEnCuota = hermanos.reduce((a, p) => a + p.monto, 0);

  function chequear() {
    if (!miCasillero) return;
    if (acciones.chequearPago(pago!.id, { casillero: miCasillero, veredicto: "chequeado" })) {
      toast(`Cobro de ${nombreCliente} chequeado. Quedaste anotado como responsable.`);
      cerrar();
    } else toast("No se pudo guardar el chequeo: tu tipo de cuenta no puede chequear.", "err");
  }
  function rechazar() {
    if (!miCasillero || motivo.trim().length < 3) return;
    if (acciones.chequearPago(pago!.id, { casillero: miCasillero, veredicto: "rechazado", nota: motivo })) {
      toast(`Rechazaste el comprobante de ${nombreCliente}.`, "info");
      cerrar();
    } else toast("No se pudo guardar: tu tipo de cuenta no puede chequear.", "err");
  }
  function quitar() {
    if (!miCasillero) return;
    if (acciones.chequearPago(pago!.id, { casillero: miCasillero, veredicto: null })) {
      toast("Sacaste lo que habías dicho: el cobro de este casillero vuelve a pendiente.", "info");
      setPaso("ver");
    }
  }
  function otroComprobante(c?: Comprobante) {
    if (!c) return;
    if (acciones.cambiarComprobante(pago!.id, c)) {
      setCambiando(false);
      toast(prueba.tipo === "archivo" ? "Comprobante cambiado. Los chequeos anteriores vuelven a pendiente." : "Comprobante subido.");
    } else {
      void descartarComprobante(c);
      toast("Tu tipo de cuenta no puede cambiar el comprobante.", "err");
    }
  }

  const titulo = miCasillero ? `Chequear el cobro de ${nombreCliente}` : `Cobro de ${nombreCliente}`;
  const sub = [producto?.nombre, nombreCuota, fechaLarga(pago.fecha)].filter(Boolean).join(" · ");

  /* Lo que se hace: va en el pie de la ventana, que se queda a la vista aunque haya que
     bajar a mirar el comprobante. */
  const pieDelModal = (
    <div className="chequeo__pie">
    {paso === "ver" && (
      <div className="chequeo__acciones">
        {miCasillero ? (
          <>
            {loCargueYo && (
              <p className="chequeo__aviso">
                <AlertTriangle size={15} aria-hidden />
                <span>Este cobro lo cargaste vos. El control cruzado es que lo mire <strong>otra persona</strong>: si podés, que lo chequee alguien más.</span>
              </p>
            )}
            {sinNadaQueComparar && (
              <p className="chequeo__aviso">
                <AlertTriangle size={15} aria-hidden />
                <span>No hay comprobante para comparar, así que no se puede dar por bueno. Subilo desde acá o rechazalo para que el closer lo suba.</span>
              </p>
            )}
            <div className="row-wrap" style={{ justifyContent: "flex-end", gap: 8 }}>
              <Button variante="ghost" onClick={cerrar}>Cerrar</Button>
              {venta && (
                <Button sm variante="ghost" onClick={() => { cerrar(); abrirFicha(venta.id, "ventas", { venta: venta.id }); }}>Abrir la ficha</Button>
              )}
              <span className="spacer" />
              {miVeredicto && <Button variante="ghost" onClick={quitar}>Quitar lo que dije</Button>}
              {miVeredicto?.veredicto !== "rechazado" && (
                <Button variante="secondary" icono={<X size={15} />} onClick={() => { setMotivo(""); setPaso("rechazar"); }}>Rechazar…</Button>
              )}
              {miVeredicto?.veredicto !== "chequeado" && (
                <Button variante="primary" icono={<ShieldCheck size={15} />} disabled={sinNadaQueComparar} onClick={() => setPaso("confirmar")}>Chequeado</Button>
              )}
            </div>
          </>
        ) : (
          <div className="row-wrap" style={{ gap: 8 }}>
            <span className="t-sm t-subtle" style={{ flex: "1 1 240px" }}>
              Lo chequean el director comercial o finanzas.{puedeSubir && control.estado === "rechazado" ? " Si el comprobante no servía, subí el que corresponde y vuelve a quedar pendiente." : ""}
            </span>
            {venta && (
              <Button sm variante="ghost" onClick={() => { cerrar(); abrirFicha(venta.id, "ventas", { venta: venta.id }); }}>Abrir la ficha</Button>
            )}
            <Button variante="secondary" onClick={cerrar}>Cerrar</Button>
          </div>
        )}
      </div>
    )}

    {paso === "confirmar" && miCasillero && (
      <div className="chequeo__acciones chequeo__acciones--confirmar" role="group" aria-label="Confirmá el chequeo">
        <p className="t-body">
          <strong>Confirmá que el comprobante coincide con lo cargado.</strong>{" "}
          {nombreCliente}, <span className="t-num">{monto}</span>, {proc?.nombre ?? "sin cuenta"}, {nombreCuota.toLowerCase()}.
        </p>
        <p className="t-sm t-muted">
          Queda escrito que lo chequeó {ROL_DE_CASILLERO[miCasillero].por} ({quienSoy}) y cuándo: si después hay una diferencia, el que chequeó también es responsable.
        </p>
        <div className="row-wrap" style={{ gap: 8 }}>
          <Button variante="ghost" onClick={() => setPaso("ver")}>Volver</Button>
          <span className="spacer" />
          <Button variante="primary" icono={<ShieldCheck size={15} />} onClick={chequear}>Sí, coincide: confirmar</Button>
        </div>
      </div>
    )}

    {paso === "rechazar" && miCasillero && (
      <div className="chequeo__acciones" role="group" aria-label="Rechazar el comprobante">
        <p className="t-body"><strong>¿Por qué no sirve el comprobante?</strong> <span className="t-sm t-muted">Se lo ve el closer para poder arreglarlo.</span></p>
        <div className="row-wrap" style={{ gap: 6 }}>
          {MOTIVOS.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>
          ))}
        </div>
        <Textarea
          rows={2} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} autoFocus
          placeholder="Contá qué pasa: «el monto del comprobante es de US$ 300 y se cargaron US$ 1.000»" aria-label="Motivo del rechazo"
        />
        <div className="row-wrap" style={{ gap: 8 }}>
          <Button variante="ghost" onClick={() => setPaso("ver")}>Volver</Button>
          <span className="spacer" />
          <Button variante="danger" icono={<X size={15} />} disabled={motivo.trim().length < 3} onClick={rechazar}>Rechazar el comprobante</Button>
        </div>
      </div>
    )}
    </div>
  );

  return (
    <Modal abierto onCerrar={cerrar} titulo={titulo} sub={sub} ancho pie={pieDelModal}>
      <div className="chequeo">
        <section className="chequeo__lado" aria-label="El comprobante">
          <h4 className="chequeo__titulo">El comprobante</h4>
          <VistaDelComprobante pago={pago} />
          {puedeSubir && (
            cambiando ? (
              <div className="stack-2">
                <CampoComprobante
                  valor={undefined} obligatorio={false} borrarAlQuitar={false}
                  onCambio={otroComprobante} onSubiendo={setSubiendo}
                />
                {prueba.tipo === "archivo" && (
                  <p className="t-sm t-subtle">El de antes queda guardado. Los chequeos que tenga este cobro vuelven a pendiente: se miraron contra el anterior.</p>
                )}
                <Button sm variante="ghost" disabled={subiendo} onClick={() => setCambiando(false)} style={{ alignSelf: "flex-start" }}>No cambiar nada</Button>
              </div>
            ) : (
              <Button sm variante="secondary" icono={<Upload size={14} />} onClick={() => setCambiando(true)} style={{ alignSelf: "flex-start" }}>
                {prueba.tipo === "archivo" ? "Subir otro comprobante" : "Subir el comprobante"}
              </Button>
            )
          )}
        </section>

        <section className="chequeo__lado" aria-label="Lo que se cargó">
          <h4 className="chequeo__titulo">Lo que cargó {closer ? primerNombre(closer.nombre) : "el closer"}</h4>
          <dl className="dl chequeo__datos">
            <dt>Cliente</dt>
            <dd>
              <strong>{nombreCliente}</strong>
              {persona?.email && <span className="t-sm t-subtle" style={{ display: "block" }}>{persona.email}</span>}
            </dd>
            <dt>Monto</dt>
            <dd>
              <strong className="t-num">{monto}</strong>
              {pago.montoArs ? (
                <span className="t-sm t-subtle t-num" style={{ display: "block" }}>
                  {money(pago.montoArs, "ARS", 2)}{pago.tipoCambio ? ` · cambio ${money(pago.tipoCambio, "ARS", 2)}` : ""}
                </span>
              ) : null}
            </dd>
            <dt>Medio</dt>
            <dd>
              {proc?.nombre ?? "Sin cuenta"}
              <span className="t-sm t-subtle" style={{ display: "block" }}>
                {concilia === "conciliado" ? `Conciliado con ${proc?.proveedor ? nombrePasarela(proc.proveedor) : "la pasarela"}`
                  : concilia === "sin-conciliar" ? "Todavía sin conciliar con la pasarela"
                    : "Se prueba con el comprobante"}
              </span>
            </dd>
            <dt>Cuota</dt>
            <dd>{nombreCuota}{cuota?.vence ? <span className="t-sm t-subtle"> · vence {fechaLarga(cuota.vence)}</span> : null}</dd>
            {(pago.pagador || pago.cuit) && (
              <>
                <dt>Transfirió</dt>
                <dd>
                  {pago.pagador || "—"}
                  {pago.cuit && <span className="t-sm t-subtle" style={{ display: "block" }}>CUIT {pago.cuit}</span>}
                </dd>
              </>
            )}
            {pago.referencia && (<><dt>Referencia</dt><dd className="t-sm" style={{ overflowWrap: "anywhere" }}>{pago.referencia}</dd></>)}
            <dt>Lo cargó</dt>
            <dd>
              {pago.cargadoPor ? nombreDe(pago.cargadoPor) : closer?.nombre ?? "—"}
              <span className="t-sm t-subtle" style={{ display: "block" }}>{fechaHora(pago.creadoEn)}</span>
            </dd>
          </dl>

          {hermanos.length > 1 && (
            <div className="chequeo__cuota">
              <div className="row t-sm" style={{ gap: 8 }}>
                <strong>Los cobros de esta cuota</strong>
                <span className="spacer t-num t-subtle">{money(pagadoEnCuota, "USD", 2)} de {money(cuota?.monto ?? pagadoEnCuota, "USD", 2)}</span>
              </div>
              <ul className="chequeo__cuota-lista">
                {hermanos.map((h) => {
                  const hp = comprobanteDeCobro(h);
                  return (
                    <li key={h.id} data-este={h.id === pago.id || undefined}>
                      <span className="t-sm">{fechaLarga(h.fecha)}</span>
                      <span className="t-sm t-muted truncate">{e.procesadores.find((x) => x.id === h.procesadorId)?.nombre ?? "Sin cuenta"}</span>
                      <span className="t-sm t-num t-strong">{money(h.monto, "USD", 2)}</span>
                      {h.id === pago.id ? <span className="t-sm t-subtle">este</span>
                        : hp.tipo === "archivo" ? (
                          <button type="button" className="link t-sm" onClick={() => verComprobante(hp.comprobante).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err"))}>
                            <Paperclip size={12} /> ver
                          </button>
                        ) : hp.tipo === "link" && hp.url ? <a className="link t-sm" href={hp.url} target="_blank" rel="noreferrer"><Paperclip size={12} /> ver</a>
                          : <span className="t-sm t-subtle">{h.movimientoId ? "pasarela" : "sin comprobante"}</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="t-sm t-subtle">Si pagó en partes (una pruebita y después el resto), tiene que estar el comprobante de cada una.</p>
            </div>
          )}

          <div className="chequeo__control" aria-label="El control del cobro">
            <h4 className="chequeo__titulo">El control</h4>
            {(["director", "finanzas"] as const).map((c) => (
              <FilaDeCasillero key={c} casillero={c} chequeo={c === "director" ? control.director : control.finanzas} nombreDe={nombreDe} esMio={miCasillero === c} />
            ))}
            {control.deAntes && (
              <p className="t-sm t-subtle">
                {control.conciliado ? "Está conciliado con el cobro de la pasarela." : "Estaba marcado como chequeado antes del control cruzado (de la planilla o de Finanzas): no dice quién ni cuándo."}
              </p>
            )}
          </div>
        </section>
      </div>

    </Modal>
  );
}

/* Todo lo que el cobro sabe de su venta, junto. */
function datosDelCobro(e: EstadoApp, pago: Pago) {
  const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
  const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
  const persona = venta?.contactoId
    ? e.contactos.find((c) => c.id === venta.contactoId) ?? e.leads.find((l) => l.id === venta.contactoId)
    : undefined;
  const closerId = cuota?.closerId || venta?.closerId;
  return {
    cuota, venta, persona,
    producto: venta?.productoId ? e.productos.find((x) => x.id === venta.productoId) : undefined,
    proc: e.procesadores.find((x) => x.id === pago.procesadorId),
    closer: closerId ? e.equipo.find((x) => x.id === closerId) : undefined,
    hermanos: e.pagos.filter((p) => p.cuotaId === pago.cuotaId).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    nombreCuota: pago.caracteristica ?? (cuota ? (cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`) : "Cobro"),
  };
}
