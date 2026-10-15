"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Flag, Link2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Button, Card, CardHead, Empty, Field, Select, StatCard, Textarea } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { useParamsURL } from "@/lib/useParamsURL";
import { fecha, fechaLarga, money } from "@/lib/format";
import { moverPeriodo, nombrePeriodo, periodoDe, rangoDePeriodo, esPeriodo } from "@/lib/periodos";
import { conPanel, miPanelDe, type CobroCargado, type MiPanel as Datos } from "@/lib/mi-panel";
import { etiquetaDeControl } from "@/lib/control-cobros";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { personaDe } from "@/lib/persona";
import "./closers.css";

/* ==================================================================
   «Mi panel» (reunión del 15/10): lo mío en una pantalla. El closer ve sus
   comisiones, las cuotas que le quedan por cobrar, sus próximas llamadas y,
   de los cobros que cargó, cuáles finanzas ya validó. El setter, las agendas
   que le cargaron. Y puede disputar una comisión: queda como un comentario
   en la ficha de esa persona, donde lo ven los dueños.

   Un dueño mira el de cualquiera («ver como»): elige la persona arriba y ve
   lo mismo que vería ella o él. Es sólo mirar: no cambia la cuenta con la que
   se entró (lo que protege los datos sigue siendo la base).
   ================================================================== */

/* Cómo empieza el comentario de una disputa: así se las encuentra después. */
export const MARCA_DISPUTA = "🚩 Disputa de comisión";

export function MiPanel() {
  const e = useEstado();
  const yo = useUsuarioActual();
  const { esDueno } = useAcceso();
  const [v, cambiar] = useParamsURL({ persona: "", mes: "" });

  /* A quién se mira: la persona elegida (sólo un dueño elige) o uno mismo. */
  const candidatos = useMemo(() => e.equipo.filter(conPanel).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [e.equipo]);
  const elegida = esDueno && v.persona ? e.equipo.find((x) => x.id === v.persona) : undefined;
  const miembro = elegida ?? yo.miembro ?? (esDueno ? candidatos[0] : undefined);
  const mesClave = esPeriodo(v.mes) ? v.mes : periodoDe(new Date());
  const mes = useMemo(() => rangoDePeriodo(mesClave), [mesClave]);

  /* Cada minuto, para que «próximas llamadas» no se quede en el pasado. */
  const [reloj, setReloj] = useState(() => Date.now());
  React.useEffect(() => { const t = window.setInterval(() => setReloj(Date.now()), 60000); return () => window.clearInterval(t); }, []);

  const datos = useMemo(() => (miembro ? miPanelDe(e, miembro, mes, reloj) : null), [e, miembro, mes, reloj]);
  const viendoOtro = Boolean(miembro && yo.miembro?.id !== miembro.id);

  if (!miembro || !datos) {
    return (
      <>
        <PageHead titulo="Mi panel" sub="Tus comisiones, tus cuotas por cobrar y tus llamadas, en un solo lugar." />
        <Empty
          icono={<Eye size={22} />}
          titulo="No encontramos tu usuario en Equipo"
          texto={`Entraste con ${yo.email ?? "otro correo"}, pero ese correo no está cargado en una ficha de Equipo. Pedile a un dueño que lo cargue (Equipo → Accesos).`}
        />
      </>
    );
  }

  const fueraDelMes = nombrePeriodo(mesClave);
  const esteMes = mesClave === periodoDe(new Date());

  return (
    <>
      <PageHead
        titulo={viendoOtro ? `Panel de ${miembro.nombre}` : "Mi panel"}
        sub={viendoOtro
          ? `Así ve ${miembro.nombre} su panel.`
          : datos.vista === "setter"
            ? "Las agendas que te cargaron como setter y cómo van."
            : "Tus comisiones, tus cuotas por cobrar, tus llamadas y qué pasó con los cobros que cargaste."}
        acciones={
          <div className="row" style={{ gap: 6 }}>
            <Button sm variante="secondary" icono={<ChevronLeft size={15} />} aria-label="Mes anterior" onClick={() => cambiar({ mes: moverPeriodo(mesClave, -1) })} />
            <span className="t-strong" style={{ minWidth: 112, textAlign: "center", textTransform: "capitalize" }}>{fueraDelMes}</span>
            <Button sm variante="secondary" icono={<ChevronRight size={15} />} aria-label="Mes siguiente" disabled={esteMes} onClick={() => cambiar({ mes: moverPeriodo(mesClave, 1) })} />
          </div>
        }
      />

      {esDueno && (
        <div className="mi-panel__ver-como" role="group" aria-label="Ver el panel de otra persona">
          <Eye size={18} aria-hidden />
          <div className="mi-panel__ver-como-texto">
            <span className="t-strong">{viendoOtro ? `Estás viendo el panel de ${miembro.nombre}, tal cual lo ve esa persona.` : "Mirá el panel de cualquiera del equipo, tal cual lo ve."}</span>
            <span className="t-sm t-subtle">Es sólo para mirar: no cambia nada ni entra con su cuenta.</span>
          </div>
          <div className="mi-panel__ver-como-select">
            <Select
              aria-label="Persona"
              value={miembro.id}
              onChange={(ev) => cambiar({ persona: ev.target.value === yo.miembro?.id ? null : ev.target.value })}
              opciones={candidatos.map((x) => ({ valor: x.id, texto: `${x.nombre} · ${x.rol === "closer" ? "closer" : x.rol === "setter" ? "setter" : "director"}` }))}
            />
          </div>
        </div>
      )}

      {datos.vista === "setter" ? <PanelSetter datos={datos} /> : <PanelCloser datos={datos} esDueno={esDueno} comoOtro={viendoOtro} />}
    </>
  );
}

/* ---------- El panel del closer (y del director) ---------- */

function PanelCloser({ datos, esDueno, comoOtro }: { datos: Datos; esDueno: boolean; comoOtro: boolean }) {
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const [disputa, setDisputa] = useState<{ venta: string } | null>(null);
  const { miembro: m, mes } = datos;
  const esDirector = datos.vista === "director";
  const total = esDirector ? datos.comisionDirector + datos.comisionCloser : datos.comisionCloser;
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";
  const sinTasa = datos.comisiones.length === 0;

  return (
    <div className="mi-panel">
      <div className="grid-stats">
        <StatCard
          hero etiqueta={`Comisión de ${mes.etiqueta}`} valor={money(total, "USD", 2)}
          contexto={datos.descuentoCierre > 0 ? `Sin ${money(datos.descuentoCierre, "USD", 2)} por días sin cierre` : `Sobre ${money(datos.cobradoMes, "USD", 0)} cobrados`}
          info={{ ayuda: "Lo que te toca de lo que se cobró este mes de tus ventas, con tu % en cada servicio. Se descuenta lo que no se paga por días sin cierre.", formula: "(Cobrado − comisión del procesador) × tu % del servicio" }}
        />
        <StatCard etiqueta="Ventas del mes" valor={String(datos.ventasDelMes.length)} contexto={`${money(datos.facturadoMes, "USD", 0)} facturados`} />
        <StatCard
          etiqueta="Cuotas por cobrar" valor={money(datos.porCobrarTotal, "USD", 0)}
          contexto={datos.porCobrarVencido > 0 ? `${money(datos.porCobrarVencido, "USD", 0)} ya vencido` : `${datos.porCobrar.length} ${datos.porCobrar.length === 1 ? "cuota" : "cuotas"}`}
          direccion={datos.porCobrarVencido > 0 ? "down" : "neutral"}
        />
        <StatCard
          etiqueta="Cobros validados" valor={datos.controlDeCobros.total === 0 ? "—" : `${datos.controlDeCobros.chequeados} de ${datos.controlDeCobros.total}`}
          contexto={datos.controlDeCobros.total === 0 ? "Sin cobros en los últimos 45 días" : `${datos.controlDeCobros.pendientes} sin validar${datos.controlDeCobros.rechazados ? ` · ${datos.controlDeCobros.rechazados} rechazados` : ""}`}
          direccion={datos.controlDeCobros.rechazados > 0 ? "down" : "neutral"}
        />
      </div>

      <div className="grid-2 mi-panel__dos">
        <Card>
          <CardHead titulo="Próximas llamadas" sub={datos.dia.hoy === 0 ? "Hoy no tenés llamadas." : `Hoy tenés ${datos.dia.hoy} ${datos.dia.hoy === 1 ? "llamada" : "llamadas"}.`} />
          {datos.proximasLlamadas.length === 0 ? (
            <p className="t-sm t-subtle">No hay llamadas agendadas. Cuando te agenden una en Calendly, aparece acá.</p>
          ) : (
            <ul className="mi-panel__lista">
              {datos.proximasLlamadas.map((f) => (
                <li key={f.id} className="mi-panel__fila">
                  <span className="mi-panel__cuando t-sm t-muted">{fechaLarga(f.llamada)}</span>
                  <button type="button" className="link mi-panel__quien" onClick={() => abrirFicha(f.personaId, "ventas")}>{f.nombre}</button>
                  <Badge variante="neutral">{f.estadoPreCall || "Sin pre-call"}</Badge>
                </li>
              ))}
            </ul>
          )}
          {(datos.dia.sinCargarHoy + datos.dia.sinCargarAntes > 0 || datos.strikes.total > 0) && (
            <div className="mi-panel__aviso" role="status">
              <span>
                {datos.dia.sinCargarHoy + datos.dia.sinCargarAntes > 0 && `Te faltan cargar ${datos.dia.sinCargarHoy + datos.dia.sinCargarAntes} ${datos.dia.sinCargarHoy + datos.dia.sinCargarAntes === 1 ? "llamada" : "llamadas"}. `}
                {datos.strikes.total > 0 && `Tenés ${datos.strikes.total} ${datos.strikes.total === 1 ? "día" : "días"} sin cierre.`}
              </span>
              {!comoOtro && <Link href="/cerrar-el-dia" className="link">Cerrar el día</Link>}
            </div>
          )}
        </Card>

        <Card>
          <CardHead titulo="Cuotas por cobrar" sub="Lo que falta cobrar de tus ventas, lo más vencido primero." />
          {datos.porCobrar.length === 0 ? (
            <p className="t-sm t-subtle">No tenés cuotas pendientes.</p>
          ) : (
            <ul className="mi-panel__lista">
              {datos.porCobrar.slice(0, 10).map(({ cuota, venta, falta }) => {
                const vencida = Boolean(cuota.vence) && new Date(cuota.vence!).getTime() < Date.now();
                return (
                  <li key={cuota.id} className="mi-panel__fila">
                    <span className="mi-panel__cuando t-sm t-muted" style={vencida ? { color: "var(--danger)" } : undefined}>{cuota.vence ? fecha(cuota.vence) : "Sin fecha"}{vencida ? " · vencida" : ""}</span>
                    <button type="button" className="link mi-panel__quien" onClick={() => abrirFicha(venta.id, "ventas", { venta: venta.id })}>{venta.contactoNombre}</button>
                    <span className="t-sm t-subtle">{cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`} · {productoDe(venta.productoId)}</span>
                    <span className="spacer t-num t-strong">{money(falta, venta.moneda, 0)}</span>
                  </li>
                );
              })}
              {datos.porCobrar.length > 10 && <li className="t-sm t-subtle" style={{ padding: "8px 0" }}>y {datos.porCobrar.length - 10} más…</li>}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHead titulo={`Mis comisiones de ${mes.etiqueta}`} sub="Cada venta con lo que se cobró y lo que te toca. Si algo no cierra, disputalo." />
        {sinTasa ? (
          <p className="t-sm t-subtle">Este mes todavía no se cobró nada de tus ventas.</p>
        ) : (
          <div className="mi-panel__tabla">
            <div className="mi-panel__tabla-cab">
              <span>Cliente</span><span>Servicio</span><span className="mi-panel__der">Cobrado</span><span className="mi-panel__der">%</span><span className="mi-panel__der">Te toca</span><span />
            </div>
            {datos.comisiones.map((c) => {
              const venta = e.ventas.find((x) => x.id === c.ventaId);
              const toca = c.closerId === m.id ? c.comisionCloser : c.comisionDirector;
              const tasa = c.closerId === m.id ? c.tasaCloser : c.tasaDirector;
              return (
                <div key={c.id} className="mi-panel__tabla-fila">
                  <span className="mi-panel__quien">{venta?.contactoNombre ?? "—"}{c.heredadaDe && <span className="t-sm t-subtle"> · cuota heredada de {c.heredadaDe}</span>}</span>
                  <span className="t-muted">{productoDe(c.productoId)}</span>
                  <span className="mi-panel__der t-num">{money(c.cobradoEnMes, "USD", 2)}</span>
                  <span className="mi-panel__der t-num">{c.sinComision ? "—" : `${Math.round(tasa * 1000) / 10}%`}</span>
                  <span className="mi-panel__der t-num t-strong" title={c.descuentoCierre ? `Se descontaron ${money(c.descuentoCierre, "USD", 2)} por un día sin cierre` : undefined}>
                    {money(toca, "USD", 2)}{c.descuentoCierre ? "*" : ""}
                  </span>
                  <span className="mi-panel__der">
                    {venta && !comoOtro && !esDueno && (
                      <Button sm variante="ghost" icono={<Flag size={14} />} onClick={() => setDisputa({ venta: venta.id })}>Disputar</Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <Disputas e={e} miembroNombre={m.nombre} />
      </Card>

      <Card>
        <CardHead titulo="Los cobros que cargué" sub="De los últimos 45 días: cuáles ya validó finanzas o el director, y cuáles todavía no." />
        {datos.cobros.length === 0 ? (
          <p className="t-sm t-subtle">No hay cobros en los últimos 45 días.</p>
        ) : (
          <ul className="mi-panel__lista">
            {datos.cobros.slice(0, 15).map((c) => <FilaCobro key={c.pago.id} c={c} e={e} onFicha={(id) => abrirFicha(id, "ventas", { venta: id })} />)}
            {datos.cobros.length > 15 && <li className="t-sm t-subtle" style={{ padding: "8px 0" }}>y {datos.cobros.length - 15} más…</li>}
          </ul>
        )}
      </Card>

      {disputa && <ModalDisputa ventaId={disputa.venta} mes={mes.etiqueta} onCerrar={() => setDisputa(null)} />}
    </div>
  );
}

function FilaCobro({ c, e, onFicha }: { c: CobroCargado; e: ReturnType<typeof useEstado>; onFicha: (id: string) => void }) {
  const etiqueta = etiquetaDeControl(c.control, (por) => e.equipo.find((x) => x.email?.toLowerCase() === por?.toLowerCase())?.nombre ?? por ?? "");
  return (
    <li className="mi-panel__fila">
      <span className="mi-panel__cuando t-sm t-muted">{fecha(c.pago.fecha)}</span>
      <button type="button" className="link mi-panel__quien" onClick={() => c.venta && onFicha(c.venta.id)}>{c.venta?.contactoNombre ?? "—"}</button>
      <span className="t-sm t-subtle">{e.procesadores.find((x) => x.id === c.pago.procesadorId)?.nombre ?? "Sin cuenta"}</span>
      {c.conciliacion === "conciliado" && <span className="t-sm" style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 4 }}><Link2 size={12} />conciliado</span>}
      <span title={etiqueta.detalle}><Badge variante={etiqueta.tono}>{etiqueta.texto}</Badge></span>
      <span className="spacer t-num t-strong">{money(c.pago.monto, c.pago.moneda, 2)}</span>
    </li>
  );
}

/* ---------- Disputar una comisión ---------- */

function Disputas({ e, miembroNombre }: { e: ReturnType<typeof useEstado>; miembroNombre: string }) {
  const mias = (e.comentarios ?? [])
    .filter((c) => c.texto.startsWith(MARCA_DISPUTA) && c.autor === miembroNombre)
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 5);
  if (mias.length === 0) return null;
  return (
    <div className="mi-panel__disputas">
      <span className="t-sm t-strong">Disputas que abriste</span>
      {mias.map((c) => (
        <p key={c.id} className="t-sm t-muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          <span className="t-subtle">{fecha(c.creadoEn)} · </span>{c.texto.replace(MARCA_DISPUTA, "").replace(/^\s*·?\s*/, "")}
        </p>
      ))}
    </div>
  );
}

function ModalDisputa({ ventaId, mes, onCerrar }: { ventaId: string; mes: string; onCerrar: () => void }) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const venta = e.ventas.find((x) => x.id === ventaId);
  const producto = e.productos.find((x) => x.id === venta?.productoId)?.nombre ?? "Venta";
  /* El chat de la ficha cuelga de la persona (su contacto), no de la venta. */
  const clave = personaDe(e, ventaId)?.clave;

  const enviar = () => {
    if (!clave || !texto.trim()) return;
    acciones.comentar(clave, `${MARCA_DISPUTA} · ${producto} · ${mes}\n${texto.trim()}`, yo.nombre, yo.email ?? undefined);
    toast("Listo: dejamos la disputa en la ficha para que la vean los dueños.");
    onCerrar();
  };

  return (
    <Modal
      abierto onCerrar={onCerrar} titulo="Disputar una comisión"
      sub={venta ? `${venta.contactoNombre} · ${producto} · ${mes}` : undefined}
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cancelar</Button><Button disabled={!texto.trim() || !clave} onClick={enviar}>Enviar la disputa</Button></>}
    >
      <Field label="¿Qué no cierra?" ayuda="Contá qué esperabas y qué ves: el %, un cobro que falta, un descuento. Queda en la ficha de esta persona y lo ven los dueños.">
        <Textarea rows={4} value={texto} onChange={(ev) => setTexto(ev.target.value)} placeholder="Ej.: este cliente pagó 1.500 y acá figura 1.300" />
      </Field>
    </Modal>
  );
}

/* ---------- El panel del setter ---------- */

function PanelSetter({ datos }: { datos: Datos }) {
  const abrirFicha = useAbrirFicha();
  const { agendasDeSetter: agendas } = datos;
  const ahora = Date.now();
  const futuras = agendas.filter((a) => new Date(a.sesion.inicia).getTime() >= ahora && a.sesion.estado !== "cancelada").length;
  const hechas = agendas.filter((a) => a.sesion.estado === "hecha").length;
  const noShow = agendas.filter((a) => a.sesion.estado === "no-show").length;
  const conVenta = agendas.filter((a) => a.venta).length;

  return (
    <div className="mi-panel">
      <div className="grid-stats">
        <StatCard hero etiqueta="Agendas cargadas a tu nombre" valor={String(agendas.length)} contexto="Las que entraron por tu link" />
        <StatCard etiqueta="Por venir" valor={String(futuras)} contexto="Todavía no pasaron" />
        <StatCard etiqueta="Se presentaron" valor={String(hechas)} contexto={noShow ? `${noShow} no se presentaron` : "Hechas"} />
        <StatCard etiqueta="Terminaron comprando" valor={String(conVenta)} contexto={datos.ventasDeSetter ? `${datos.ventasDeSetter} ventas con vos de setter` : "Ventas con vos de setter"} />
      </div>
      {datos.comisionSetter > 0 && (
        <StatCard etiqueta={`Comisión de ${datos.mes.etiqueta}`} valor={money(datos.comisionSetter, "USD", 2)} contexto="Sobre las ventas donde figurás como setter" />
      )}
      <Card>
        <CardHead
          titulo="Mis agendas"
          sub="Las llamadas que agendaste. Si falta alguna, avisale al closer que la tomó para que te ponga como setter al cargar la venta."
        />
        {agendas.length === 0 ? (
          <p className="t-sm t-subtle">Todavía no hay agendas a tu nombre. Entran solas cuando alguien agenda con tu link (utm_campaign=setter_tunombre).</p>
        ) : (
          <ul className="mi-panel__lista">
            {agendas.slice(0, 40).map(({ sesion, venta }) => (
              <li key={sesion.id} className="mi-panel__fila">
                <span className="mi-panel__cuando t-sm t-muted">{fechaLarga(sesion.inicia)}</span>
                <button type="button" className="link mi-panel__quien" onClick={() => (sesion.contactoId ?? sesion.leadId) && abrirFicha((sesion.contactoId ?? sesion.leadId)!, "ventas")}>{sesion.invitado}</button>
                <span className="t-sm t-subtle">{sesion.anfitrion ? `con ${sesion.anfitrion}` : "sin closer"}</span>
                <Badge variante={venta ? "success" : sesion.estado === "no-show" ? "danger" : "neutral"}>
                  {venta ? "Compró" : sesion.estadoLlamada || (sesion.estado === "cancelada" ? "Cancelada" : sesion.estado === "no-show" ? "No se presentó" : sesion.estado === "hecha" ? "Hecha" : "Agendada")}
                </Badge>
              </li>
            ))}
            {agendas.length > 40 && <li className="t-sm t-subtle" style={{ padding: "8px 0" }}>y {agendas.length - 40} más…</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
