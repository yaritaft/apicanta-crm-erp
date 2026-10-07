"use client";

import React, { useMemo, useState } from "react";
import { ArrowRight, ArrowRightLeft, Check, Pencil, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardHead, Chip, Field, IconButton, Input, Select, Textarea, type VarianteBadge } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { fecha, fechaLarga, money, num } from "@/lib/format";
import { escribirMonto, leerMonto } from "@/lib/gastos";
import { useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import {
  AYUDA_SITUACION, cambioDe, CATEGORIA_COSTO, costoDe, esperaLlegada, gastoDelCosto, LLEGADA_A_MANO, parecidos, resumenDePases, rutaDe, situacionDe,
  TEXTO_SITUACION, type Punta, type Situacion,
} from "@/lib/traspasos";
import type { EstadoApp, Moneda, Traspaso } from "@/lib/types";

/* ==================================================================
   Movimientos entre cuentas propias (lib/traspasos.ts), en la Caja.

   La plata que pasa de una cuenta a otra: no es ingreso ni gasto. La
   lista muestra de dónde a dónde, cuánto salió y cuánto llegó, lo que
   costó y en qué está cada uno: conciliado (se vio salir y llegar), en
   camino, salió y no llegó, por confirmar. Se cargan a mano o los trae
   «Buscar en las cuentas», que le pregunta a Mercury y a Stripe lo mismo
   que el cron revisa cada hora.
   ================================================================== */

const TONO: Record<Situacion, VarianteBadge> = {
  "conciliado": "success", "en-camino": "accent", "no-llego": "danger", "detectado": "info",
  "a-mano": "neutral", "por-confirmar": "warning", "ignorado": "neutral",
};

/* Quién dijo que no, en los avisos de «Buscar en las cuentas». */
const NOMBRE_DE: Record<string, string> = { mercury: "Mercury", stripe: "Stripe", supabase: "La base" };

type Filtro = "" | "por-confirmar" | "no-llego" | "en-camino" | "ignorado";
const diaAr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const monedaDe = (e: EstadoApp, id?: string): Moneda => e.procesadores.find((p) => p.id === id)?.moneda ?? "USD";
const plata = (n: number, m: Moneda) => money(n, m, Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
/* Un monto guardado, como se escribe en el formulario: 3.900 · 5.230,40. */
const enTexto = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

export function PasesEntreCuentas({ e, onNuevo, onEditar }: {
  e: EstadoApp;
  onNuevo: () => void;
  onEditar: (t: Traspaso) => void;
}) {
  const toast = useToast();
  const [v, setV] = useParamsURL({ pases: "" });
  const filtro = (["por-confirmar", "no-llego", "en-camino", "ignorado"].includes(v.pases) ? v.pases : "") as Filtro;
  const tabla = useTablaURL("pases", { clave: "fecha", desc: true }, ["fecha", "ruta", "sale", "llega", "costo", "estado"]);
  const [buscando, setBuscando] = useState(false);
  const [borrar, setBorrar] = useState<Traspaso | null>(null);

  const ahora = Math.floor(Date.now() / 60000) * 60000;
  const todos = useMemo(() => (e.traspasos ?? []).map((t) => ({ ...t, situacion: situacionDe(t, ahora) })), [e.traspasos, ahora]);
  const resumen = useMemo(() => resumenDePases(e.traspasos ?? [], ahora), [e.traspasos, ahora]);
  const descartados = todos.filter((t) => t.situacion === "ignorado").length;
  const filas = todos.filter((t) => (filtro ? t.situacion === filtro : t.situacion !== "ignorado"));
  /* El movimiento tal cual está guardado: la situación es sólo de esta lista. */
  const editar = (id: string) => { const t = (e.traspasos ?? []).find((x) => x.id === id); if (t) onEditar(t); };

  /* Le pregunta ahora a las cuentas conectadas (lo mismo que el cron
     revisa cada hora) y ata lo que encuentra. Con la base, guarda el
     servidor: parte de lo que hay guardado ahora, no de lo que este
     navegador cargó hace un rato, y después se vuelve a traer la lista. */
  async function buscar() {
    setBuscando(true);
    try {
      const sesion = nube ? (await nube.auth.getSession()).data.session : null;
      const r = await fetch(`/api/pasarelas/sync?solo=pases${nube ? "&guardar=1" : ""}`, { headers: sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {} });
      const data = (await r.json()) as {
        puntas?: Punta[]; pases?: { nuevos: number; conciliados: number }; pasesGuardados?: boolean;
        conectadas?: string[]; errores?: { proveedor: string; mensaje: string }[]; error?: string;
      };
      if (!r.ok) throw new Error(data.error ?? "No se pudo consultar las cuentas.");
      if (data.errores?.length) toast(`${NOMBRE_DE[data.errores[0].proveedor] ?? data.errores[0].proveedor}: ${data.errores[0].mensaje}`, "err");
      if (!data.conectadas?.length) {
        toast("Ninguna cuenta está conectada para avisar sola (Mercury, Stripe): mientras tanto, cargalos a mano.", "info");
        return;
      }
      const guardoElServidor = Boolean(data.pasesGuardados) && await acciones.traerTraspasos();
      const { nuevos, conciliados } = guardoElServidor ? data.pases ?? { nuevos: 0, conciliados: 0 } : acciones.importarPuntas(data.puntas ?? []);
      toast(nuevos || conciliados
        ? [nuevos ? `${num(nuevos)} ${nuevos === 1 ? "movimiento nuevo" : "movimientos nuevos"}` : "", conciliados ? `${num(conciliados)} ${conciliados === 1 ? "conciliado" : "conciliados"}` : ""].filter(Boolean).join(" y ") + "."
        : "No hay movimientos entre cuentas nuevos.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo consultar las cuentas.", "err");
    } finally {
      setBuscando(false);
    }
  }

  const cuenta = (id: string | undefined, falta: string) =>
    id ? <span className="truncate">{e.procesadores.find((p) => p.id === id)?.nombre ?? "Cuenta borrada"}</span> : <span className="t-subtle">{falta}</span>;

  return (
    <Card style={{ padding: 0 }}>
      <div className="pases__cabeza" style={{ padding: "var(--space-4) var(--space-4) 0" }}>
        <CardHead
          titulo="Movimientos entre cuentas"
          sub="La plata que pasa de una cuenta tuya a otra (de Stripe a Mercury, de Mercury a la Financiera). No es ingreso ni gasto: no mueve el total de la caja; lo que cueste el pase sí queda como gasto."
          acciones={
            <Button sm variante="secondary" icono={<RefreshCw size={15} />} cargando={buscando} onClick={() => void buscar()}
              title="Le pregunta ahora a Mercury y a Stripe. Igual se revisa solo cada hora.">Buscar en las cuentas</Button>
          }
        />
        <div className="row-wrap pases__filtros">
          <Chip activo={filtro === ""} onClick={() => setV({ pases: null })}>Todos</Chip>
          <Chip activo={filtro === "por-confirmar"} count={resumen.porConfirmar} onClick={() => setV({ pases: filtro === "por-confirmar" ? null : "por-confirmar" })}>Por confirmar</Chip>
          <Chip activo={filtro === "no-llego"} count={resumen.noLlegaron} onClick={() => setV({ pases: filtro === "no-llego" ? null : "no-llego" })}>Salieron y no llegaron</Chip>
          <Chip activo={filtro === "en-camino"} count={resumen.enCamino} onClick={() => setV({ pases: filtro === "en-camino" ? null : "en-camino" })}>En camino</Chip>
          {descartados > 0 && <Chip activo={filtro === "ignorado"} count={descartados} onClick={() => setV({ pases: filtro === "ignorado" ? null : "ignorado" })}>Descartados</Chip>}
        </div>
      </div>
      <DataTable
        filas={filas}
        orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina} porPagina={15}
        onFila={(t) => editar(t.id)}
        etiquetaFila={(t) => `Ver el movimiento de ${rutaDe(e, t)}`}
        columnas={[
          {
            clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (t) => t.fecha,
            celda: (t) => (
              <span className="pases__fecha">
                {fechaLarga(t.fecha)}
                {t.fechaLlega && diaAr(t.fechaLlega) !== diaAr(t.fecha) && <span className="pases__llego">llegó el {fecha(t.fechaLlega)}</span>}
              </span>
            ),
          },
          {
            clave: "ruta", titulo: "De qué cuenta a cuál", orden: (t) => rutaDe(e, t),
            celda: (t) => (
              <span className="pases__ruta" title={t.contraparte ? `Según el banco: ${t.contraparte}` : undefined}>
                {cuenta(t.origenId, "Falta de cuál")}
                <span className="pases__a"><ArrowRight size={14} aria-label="a" />{cuenta(t.destinoId, "Falta a cuál")}</span>
              </span>
            ),
          },
          { clave: "sale", titulo: "Salió", tipo: "num", orden: (t) => t.montoSale, celda: (t) => plata(t.montoSale, t.monedaSale) },
          {
            clave: "llega", titulo: "Llegó", tipo: "num", orden: (t) => t.montoLlega,
            celda: (t) => (t.situacion === "en-camino" || t.situacion === "no-llego"
              ? <span className="t-subtle">Todavía no</span> : plata(t.montoLlega, t.monedaLlega)),
          },
          {
            clave: "costo", titulo: "Costó", tipo: "num", orden: (t) => costoDe(t),
            celda: (t) => {
              const costo = costoDe(t);
              const cambio = cambioDe(t);
              if (cambio) return <span className="t-subtle" title="Entre pesos y dólares no es un costo: es el cambio.">a $ {num(cambio)}</span>;
              if (!(costo > 0)) return <span className="t-subtle">—</span>;
              return <span title={t.gastoId ? `Cargado como gasto en ${CATEGORIA_COSTO}` : "No se cargó como gasto"}>{plata(costo, t.monedaSale)}{!t.gastoId && <span className="t-sm t-subtle"> · sin cargar</span>}</span>;
            },
          },
          {
            clave: "estado", titulo: "Estado", orden: (t) => TEXTO_SITUACION[t.situacion],
            celda: (t) => <span title={AYUDA_SITUACION[t.situacion]}><Badge variante={TONO[t.situacion]}>{TEXTO_SITUACION[t.situacion]}</Badge></span>,
          },
        ]}
        acciones={(t) => (
          t.situacion === "por-confirmar" ? (
            /* Lo que hay que decidir, a la vista: no escondido hasta pasar el mouse. */
            <span className="pases__decidir">
              <Button sm variante="secondary" icono={<Check size={14} />} title="Sí, es plata que pasó entre dos cuentas tuyas" aria-label="Sí, es un movimiento entre cuentas"
                onClick={() => { acciones.marcarTraspaso(t.id, "confirmado"); toast("Confirmado: cuenta como movimiento entre cuentas."); }}>Sí</Button>
              <Button sm variante="ghost" icono={<X size={14} />} title="No es un movimiento entre cuentas: no se cuenta" aria-label="No es un movimiento entre cuentas"
                onClick={() => { acciones.marcarTraspaso(t.id, "ignorado"); toast("Descartado: no cuenta como movimiento entre cuentas.", "ok", { texto: "Deshacer", onClick: () => acciones.marcarTraspaso(t.id, "propuesto") }); }}>No</Button>
            </span>
          ) : t.situacion === "ignorado" ? (
            <IconButton etiqueta="Volver a contarlo" onClick={() => { acciones.marcarTraspaso(t.id, "confirmado"); toast("Vuelve a contar como movimiento entre cuentas."); }}><RotateCcw size={15} /></IconButton>
          ) : (
            <>
              <IconButton etiqueta="Corregir" onClick={() => editar(t.id)}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Borrar" onClick={() => setBorrar((e.traspasos ?? []).find((x) => x.id === t.id) ?? null)}><Trash2 size={15} /></IconButton>
            </>
          )
        )}
        vacio={
          filtro ? <p className="t-sm t-muted" style={{ padding: 16 }}>Ninguno en esa situación.</p> : (
            <div className="pases__vacio">
              <p className="t-sm t-muted">Todavía no hay movimientos entre cuentas. Cargá el primero, o buscá los que ya vieron las cuentas conectadas.</p>
              <Button sm variante="secondary" icono={<ArrowRightLeft size={15} />} onClick={onNuevo}>Registrar un movimiento</Button>
            </div>
          )
        }
      />
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)} confirmarTexto="Borrar"
        titulo="¿Borrar este movimiento entre cuentas?"
        texto={borrar ? `Se borra el de ${rutaDe(e, borrar)} del ${fechaLarga(borrar.fecha)}${borrar.gastoId ? ", con el gasto de lo que costó" : ""}.${borrar.origen === "api" ? " Lo detectó la sincronización: si lo que querés es que no cuente, descartalo en vez de borrarlo, porque al buscar de nuevo vuelve a aparecer." : ""}` : ""}
        onConfirmar={() => { if (borrar) { acciones.borrarTraspaso(borrar.id); toast("Movimiento borrado."); } }}
      />
    </Card>
  );
}

/* ---------- Registrar o corregir uno ---------- */

export function FormTraspaso({ e, traspaso, onCerrar, onListo }: {
  e: EstadoApp;
  /* El que se corrige; sin él, uno nuevo. */
  traspaso?: Traspaso | null;
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const t0 = traspaso ?? null;
  const [origenId, setOrigenId] = useState(t0?.origenId ?? "");
  const [destinoId, setDestinoId] = useState(t0?.destinoId ?? "");
  const [dia, setDia] = useState(diaAr(t0?.fecha ?? new Date().toISOString()));
  const [sale, setSale] = useState(t0 ? enTexto(t0.montoSale) : "");
  /* Lo que llegó sigue a lo que salió hasta que alguien lo cambia. */
  const [llega, setLlega] = useState(t0 ? enTexto(t0.montoLlega) : "");
  const [llegaTocado, setLlegaTocado] = useState(Boolean(t0));
  const [tc, setTc] = useState(e.ajustes.tipoCambio > 0 ? escribirMonto(e.ajustes.tipoCambio) : "");
  const [conGasto, setConGasto] = useState(t0 ? Boolean(t0.gastoId) || costoDe(t0) === 0 : true);
  const [notas, setNotas] = useState(t0?.notas ?? "");
  /* Lo vio salir una cuenta y falta verlo llegar a una que avisa: se puede
     dar por llegado a mano (y volver atrás, si se marcó de más). */
  const aMano = t0?.llegadaRef === LLEGADA_A_MANO;
  const [yaLlego, setYaLlego] = useState(aMano);
  const faltaLlegar = Boolean(t0) && esperaLlegada({ salidaRef: t0?.salidaRef, llegadaRef: aMano ? undefined : t0?.llegadaRef, destinoId: destinoId || undefined });

  const monedaSale = monedaDe(e, origenId);
  const monedaLlega = monedaDe(e, destinoId);
  const mismaMoneda = monedaSale === monedaLlega;
  const montoSale = leerMonto(sale);
  const montoLlega = leerMonto(llegaTocado || !mismaMoneda ? llega : sale);
  /* El que se corrige conserva su hora; el de hoy, ahora (no al mediodía:
     quedaría en el futuro y la caja no lo contaría hasta entonces). */
  const fechaIso = t0 && diaAr(t0.fecha) === dia ? t0.fecha
    : dia === diaAr(new Date().toISOString()) ? new Date().toISOString() : new Date(`${dia}T15:00:00.000Z`).toISOString();

  const borrador: Traspaso = {
    ...(t0 ?? { id: nuevoId("tra"), origen: "manual", creadoEn: new Date().toISOString(), por: e.ajustes.responsable || undefined }),
    fecha: fechaIso, origenId: origenId || undefined, destinoId: destinoId || undefined,
    montoSale: Number.isFinite(montoSale) ? montoSale : 0, monedaSale,
    montoLlega: Number.isFinite(montoLlega) ? montoLlega : 0, monedaLlega,
    estado: "confirmado",
    notas: notas.trim() || undefined,
    ...(faltaLlegar || aMano ? { llegadaRef: faltaLlegar && yaLlego ? LLEGADA_A_MANO : undefined } : {}),
  };
  const costo = costoDe(borrador);
  const cambio = cambioDe(borrador);
  const tipoCambio = leerMonto(tc);
  const enPesos = mismaMoneda && monedaSale !== e.ajustes.monedaBase;
  const gasto = conGasto && costo > 0 ? gastoDelCosto(e, borrador, enPesos ? tipoCambio : 0) : null;
  const faltaTc = conGasto && costo > 0 && enPesos && !(tipoCambio > 0);
  const yaHay = useMemo(
    () => parecidos(e.traspasos ?? [], borrador, t0?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [e.traspasos, origenId, destinoId, borrador.montoSale, dia, t0?.id],
  );

  const problema = !origenId || !destinoId ? "Elegí las dos cuentas"
    : origenId === destinoId ? "Las dos cuentas son la misma"
      : !(borrador.montoSale > 0) ? "Poné cuánto salió"
        : !(borrador.montoLlega > 0) ? "Poné cuánto llegó"
          : faltaTc ? "Poné el tipo de cambio para cargar el gasto" : null;

  /* Las cuentas activas, y las de este movimiento aunque ya no lo estén. */
  const cuentas = e.procesadores.filter((p) => p.activo || p.id === t0?.origenId || p.id === t0?.destinoId)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((p) => ({ valor: p.id, texto: `${p.nombre}${p.moneda === "ARS" ? " · en pesos" : ""}` }));

  function guardar() {
    if (problema) return;
    acciones.guardarTraspaso(borrador, gasto);
    onListo(`Movimiento de ${rutaDe(e, borrador)} ${t0 ? "corregido" : "registrado"}${gasto ? `: ${plata(costo, monedaSale)} quedaron como gasto` : ""}.`);
  }

  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={guardar} puedeGuardar={!problema}
      guardarTexto={t0 ? "Guardar los cambios" : "Registrar movimiento"}
      titulo={t0 ? "Movimiento entre cuentas" : "Registrar un movimiento entre cuentas"}
      sub="Plata que pasó de una cuenta tuya a otra. No es un ingreso ni un gasto."
    >
      <div className="form-grid">
        <Field label="De qué cuenta salió">
          <Select value={origenId} placeholder="Elegí la cuenta" aria-label="De qué cuenta salió" onChange={(ev) => setOrigenId(ev.target.value)} opciones={cuentas} />
        </Field>
        <Field label="A qué cuenta llegó" error={origenId && origenId === destinoId ? "Es la misma cuenta." : undefined}>
          <Select value={destinoId} placeholder="Elegí la cuenta" aria-label="A qué cuenta llegó" onChange={(ev) => setDestinoId(ev.target.value)} opciones={cuentas} />
        </Field>
        <Field label={`Salió (${monedaSale === "USD" ? "US$" : "$"})`}>
          <InputMonto value={sale} placeholder="5.000" aria-label="Cuánto salió" autoFocus={!t0}
            onChange={(ev) => setSale(ev.target.value)} />
        </Field>
        <Field label={`Llegó (${monedaLlega === "USD" ? "US$" : "$"})`} ayuda={mismaMoneda ? "Si llegó menos, la diferencia es lo que costó." : "En la moneda de la cuenta a la que llegó."}>
          <InputMonto value={llegaTocado || !mismaMoneda ? llega : sale} placeholder={mismaMoneda ? "Lo mismo" : "0"} aria-label="Cuánto llegó"
            onChange={(ev) => { setLlega(ev.target.value); setLlegaTocado(true); }} />
        </Field>
        <Field label="Día">
          <Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value || diaAr(new Date().toISOString()))} />
        </Field>
        {costo > 0 && enPesos && conGasto && (
          <Field label="Tipo de cambio (pesos por dólar)" ayuda="Para pasar el costo a dólares." error={faltaTc ? "Poné el tipo de cambio." : undefined}>
            <InputMonto decimales={4} value={tc} onChange={(ev) => setTc(ev.target.value)} />
          </Field>
        )}
      </div>

      {/* Lo que dice el movimiento, antes de guardarlo. */}
      {costo > 0 && (
        <label className="pases__costo">
          <input type="checkbox" checked={conGasto} onChange={(ev) => setConGasto(ev.target.checked)} />
          <span>
            <strong>Costó {plata(costo, monedaSale)}.</strong> Cargarlo como gasto en «{CATEGORIA_COSTO}»
            <span className="t-sm t-subtle"> · es lo único del movimiento que baja la caja y entra al P&L</span>
          </span>
        </label>
      )}
      {cambio && <p className="t-sm t-muted pases__nota">Entre pesos y dólares: a $ {num(cambio)} por dólar. No se carga ningún gasto.</p>}
      {mismaMoneda && borrador.montoLlega > borrador.montoSale && borrador.montoSale > 0 && (
        <p className="t-sm pases__nota pases__nota--ojo">Llegó más de lo que salió: revisá los montos.</p>
      )}
      {faltaLlegar && (
        <label className="pases__costo">
          <input type="checkbox" checked={yaLlego} onChange={(ev) => setYaLlego(ev.target.checked)} />
          <span><strong>Ya llegó.</strong> La cuenta lo vio salir pero ninguna conectada lo vio llegar: marcalo si lo comprobaste a mano.</span>
        </label>
      )}
      {t0 && t0.estado !== "confirmado" && (
        <p className="t-sm t-muted pases__nota">
          {t0.estado === "propuesto" ? "Está por confirmar" : "Estaba descartado"}: al guardarlo queda como un movimiento entre cuentas.
        </p>
      )}
      {yaHay.length > 0 && (
        <p className="t-sm pases__nota pases__nota--ojo">
          Ya hay {yaHay.length === 1 ? "uno parecido" : `${yaHay.length} parecidos`}: {yaHay.slice(0, 2).map((x) => `${fechaLarga(x.fecha)}, ${plata(x.montoSale, x.monedaSale)} (${TEXTO_SITUACION[situacionDe(x)].toLowerCase()})`).join(" · ")}. Fijate de no cargarlo dos veces.
        </p>
      )}
      {t0 && (t0.salidaRef || t0.llegadaRef || t0.contraparte) && (
        <p className="t-sm t-subtle pases__nota">
          {[t0.salidaRef ? "La cuenta de salida lo vio salir" : "", t0.llegadaRef && !aMano ? "la de llegada lo vio llegar" : "",
            aMano ? "la llegada la confirmó alguien a mano" : "", t0.contraparte ? `el banco dice «${t0.contraparte}»` : ""].filter(Boolean).join(" · ").replace(/^./, (x) => x.toUpperCase())}.
        </p>
      )}
      <Field label="Nota" span2><Textarea rows={2} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Para qué fue, quién lo hizo" /></Field>
      {problema && (sale || origenId || destinoId) && <p className="t-sm t-subtle" role="status">{problema}.</p>}
    </ModalForm>
  );
}
