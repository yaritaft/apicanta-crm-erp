"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, RefreshCw } from "lucide-react";
import { Badge, Button, IconButton } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useEstado } from "@/lib/store";
import { fecha, fechaLarga, num, tasaTexto } from "@/lib/format";
import { calcularLiquidacion, mesesDelRenglon, nombrePeriodo, plata, renglonDe } from "@/lib/honorarios";
import type { DesgloseLinea, ItemDesglose, LineaLiquidada, ListaDesglose, PasoDesglose } from "@/lib/types";

/* ==================================================================
   «Ver cómo se calculó»: la ventana con la cuenta de un renglón de la
   liquidación (Angelo, 06/10: «un botón de ver cómo se calculó mes a mes,
   que quede el histórico, con todo el desglose»).

   Un mes abierto muestra la cuenta con los datos de hoy. Un mes cerrado
   muestra lo que quedó guardado al cerrar, no lo que daría hoy: la foto del
   mes no cambia sola. Si se cerró antes de que se guardara el desglose,
   lo dice y ofrece verlo recalculado con los datos de hoy, marcado como tal.

   La cuenta la escribió el motor (lib/honorarios.ts) al calcular el renglón,
   con los mismos números: acá sólo se lee.
   ================================================================== */

const SIMBOLO: Record<PasoDesglose["op"], { signo: string; dice: string }> = {
  base: { signo: "", dice: "" },
  mas: { signo: "+", dice: "más" },
  menos: { signo: "−", dice: "menos" },
  por: { signo: "×", dice: "por" },
  tramos: { signo: "÷", dice: "dividido en" },
  igual: { signo: "=", dice: "igual a" },
};

function valorDe(p: PasoDesglose): string {
  switch (p.formato) {
    case "plata": return plata(p.valor, p.moneda ?? "USD");
    case "tasa": return tasaTexto(p.valor);
    case "fraccion": return `${num(p.valor, Number.isInteger(p.valor) ? 0 : 2)} de ${p.de ?? 1}`;
    default: return num(p.valor, Number.isInteger(p.valor) ? 0 : 2);
  }
}

/** La cuenta, de arriba hacia abajo: lo que se suma, se resta o se multiplica, y cada subtotal. */
function CuentaDelDesglose({ pasos }: { pasos: PasoDesglose[] }) {
  const ultimo = pasos.length - 1;
  return (
    <div className="desglose__tabla">
      <table className="liq-cuenta">
        <tbody>
          {pasos.map((p, i) => (
            <tr key={i} data-op={p.op} data-final={i === ultimo && p.op === "igual" ? true : undefined}>
              <td className="liq-cuenta__op" aria-label={SIMBOLO[p.op].dice || undefined}>{SIMBOLO[p.op].signo}</td>
              <td className="liq-cuenta__texto">
                {p.texto}
                {p.nota && <span className="liq-cuenta__nota">{p.nota}</span>}
              </td>
              <td className="liq-cuenta__valor">{valorDe(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaDeLoQueEntro({ lista }: { lista: ListaDesglose }) {
  const cobros = lista.tipo === "cobros";
  const moneda = lista.moneda;
  const fila = (x: ItemDesglose, i: number) => (
    <tr key={i}>
      <td className="liq-lista__fecha">{fecha(x.fecha)}</td>
      <td className="liq-lista__quien">
        <span>{x.cliente}</span>
        {(x.servicio || (cobros && x.procesador)) && (
          <span className="liq-lista__sub">{[x.servicio, cobros ? x.procesador : undefined].filter(Boolean).join(" · ")}</span>
        )}
      </td>
      <td className="liq-lista__num">{plata(x.monto, moneda)}</td>
      {cobros && <td className="liq-lista__num liq-lista__num--chico">{x.fee ? `−${plata(x.fee, moneda)}` : "—"}</td>}
      {cobros && <td className="liq-lista__num">{plata(x.neto ?? x.monto, moneda)}</td>}
    </tr>
  );
  return (
    <section className="stack-2" aria-label={lista.titulo}>
      <h4 className="t-label">{lista.titulo}{lista.resto ? ` (de ${lista.total})` : ` (${lista.total})`}</h4>
      <div className="desglose__tabla">
        <table className="liq-lista">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">{cobros ? "Cliente" : "Venta"}</th>
              <th scope="col" className="liq-lista__num">{cobros ? "Cobrado" : "Precio"}</th>
              {cobros && <th scope="col" className="liq-lista__num">Procesador</th>}
              {cobros && <th scope="col" className="liq-lista__num">Neto</th>}
            </tr>
          </thead>
          <tbody>
            {lista.items.map(fila)}
            {lista.resto && (
              <tr className="liq-lista__resto">
                <td />
                <td>Y {lista.resto.cantidad} {cobros ? (lista.resto.cantidad === 1 ? "cobro más" : "cobros más") : (lista.resto.cantidad === 1 ? "venta más" : "ventas más")}</td>
                <td className="liq-lista__num">{plata(lista.resto.monto, moneda)}</td>
                {cobros && <td className="liq-lista__num liq-lista__num--chico">{lista.resto.fee ? `−${plata(lista.resto.fee, moneda)}` : "—"}</td>}
                {cobros && <td className="liq-lista__num">{plata(lista.resto.neto ?? lista.resto.monto, moneda)}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* La cuenta entera de un renglón: regla, pasos, lo que entró y lo que conviene saber. */
function ContenidoDelDesglose({ d, monto }: { d: DesgloseLinea; monto?: number }) {
  return (
    <>
      <section className="stack-2" aria-label="La regla">
        <h4 className="t-label">La regla</h4>
        <p className="desglose__regla">{d.regla}</p>
      </section>

      <section className="stack-2" aria-label="La cuenta">
        <h4 className="t-label">La cuenta</h4>
        <CuentaDelDesglose pasos={d.pasos} />
      </section>

      {d.correccion && (
        <div className="liq__notapago" role="note">
          <AlertTriangle size={15} aria-hidden />
          <span>
            <b>Se corrigió a mano.</b> La cuenta da {plata(d.correccion.cuentaDaba, d.moneda)}
            {monto !== undefined ? `, pero se paga ${plata(monto, d.moneda)}` : ", pero se paga el monto corregido del renglón"}.
            {d.correccion.nota ? ` Motivo: ${d.correccion.nota}.` : ""}
          </span>
        </div>
      )}

      {d.lista && <ListaDeLoQueEntro lista={d.lista} />}

      {d.avisos && d.avisos.length > 0 && (
        <section className="stack-2" aria-label="Para tener en cuenta">
          <h4 className="t-label">Para tener en cuenta</h4>
          <ul className="desglose__avisos">
            {d.avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/* ---------- La ventana ---------- */

export function DesgloseRenglon({ miembroId, clave, periodo, onCerrar }: {
  miembroId: string; clave: string; periodo: string; onCerrar: () => void;
}) {
  const e = useEstado();
  const [mes, setMes] = useState(periodo);
  const [recalcular, setRecalcular] = useState(false);

  const liq = e.liquidaciones.find((x) => x.periodo === mes);
  const cerrada = liq?.estado === "cerrada" && Boolean(liq.resultado);
  /* El mes con el que se abrió la ventana, si sigue abierto: se calcula una vez y sirve para verlo y para la tabla de meses. */
  const liqInicial = e.liquidaciones.find((x) => x.periodo === periodo);
  const inicialAbierto = !(liqInicial?.estado === "cerrada" && liqInicial.resultado);
  const vivoInicial = useMemo(
    () => (inicialAbierto ? calcularLiquidacion(e, periodo, liqInicial) : null),
    [inicialAbierto, e, periodo, liqInicial],
  );
  /* Cerrada, con lo que quedó guardado; abierta (o recalculada a pedido), con los datos de hoy. */
  const deLaFoto = cerrada && !recalcular;
  const hoy = useMemo(
    () => (deLaFoto ? null : mes === periodo && vivoInicial ? vivoInicial : calcularLiquidacion(e, mes, liq)),
    [deLaFoto, e, mes, periodo, vivoInicial, liq],
  );
  const visto = renglonDe(deLaFoto ? liq?.resultado : hoy, miembroId, clave);
  const alCerrar = cerrada ? renglonDe(liq?.resultado, miembroId, clave) : undefined;

  /* Los meses de este renglón para ir y venir: los cerrados en los que estuvo, y el que se abrió. */
  const meses = useMemo(
    () => [...new Set([...mesesDelRenglon(e.liquidaciones, miembroId, clave), periodo])].sort(),
    [e.liquidaciones, miembroId, clave, periodo],
  );
  /* Lo que se liquidó (o se va a liquidar) ese mes: lo cerrado, con su foto; el abierto, con los datos de hoy. */
  const lineaDelMes = (m: string): LineaLiquidada | undefined => {
    const l = e.liquidaciones.find((x) => x.periodo === m);
    if (l?.estado === "cerrada" && l.resultado) return renglonDe(l.resultado, miembroId, clave)?.linea;
    return m === periodo ? renglonDe(vivoInicial, miembroId, clave)?.linea : undefined;
  };
  const i = meses.indexOf(mes);
  const irA = (p: string | undefined) => { if (p) { setMes(p); setRecalcular(false); } };

  const linea: LineaLiquidada | undefined = visto?.linea ?? alCerrar?.linea;
  const nombre = visto?.persona.nombre ?? alCerrar?.persona.nombre ?? "";
  const d = visto?.linea.desglose;

  const sinDesglose = deLaFoto && Boolean(visto) && !d;
  const cambio = recalcular && alCerrar && visto && Math.abs(alCerrar.linea.monto - visto.linea.monto) >= 0.005;

  return (
    <Modal
      abierto onCerrar={onCerrar} ancho
      titulo="Cómo se calculó"
      sub={[nombre, linea?.nombre, nombrePeriodo(mes)].filter(Boolean).join(" · ")}
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cerrar</Button></>}
    >
      <div className="desglose">
        {meses.length > 1 && (
          <div className="desglose__mes" role="group" aria-label="Mes a mes">
            <IconButton etiqueta="Mes anterior de este renglón" disabled={i <= 0} onClick={() => irA(meses[i - 1])}><ChevronLeft size={18} /></IconButton>
            <span className="desglose__mes-nombre">{nombrePeriodo(mes)}</span>
            <IconButton etiqueta="Mes siguiente de este renglón" disabled={i < 0 || i >= meses.length - 1} onClick={() => irA(meses[i + 1])}><ChevronRight size={18} /></IconButton>
            <span className="t-sm t-subtle">{i + 1} de {meses.length} meses</span>
          </div>
        )}

        <div className="row-wrap">
          {deLaFoto
            ? <Badge variante="brand" icono={<Lock size={12} />}>{d ? "Como quedó al cerrar" : "Cerrada"}{liq?.cerradaEn ? ` el ${fechaLarga(liq.cerradaEn)}` : ""}</Badge>
            : recalcular
              ? <Badge variante="warning" icono={<RefreshCw size={12} />}>Recalculado con los datos de hoy</Badge>
              : <Badge variante="neutral">Con los datos de hoy: el mes sigue abierto</Badge>}
          {linea && <span className="t-sm t-muted">Monto del renglón: <b>{plata(linea.monto, linea.moneda)}</b></span>}
        </div>

        {!visto && (
          <div className="liq__notapago" role="note">
            <AlertTriangle size={15} aria-hidden />
            <span>
              {recalcular
                ? "Esta regla ya no está en lo que cobra esta persona, así que no se puede recalcular con los datos de hoy."
                : "No encontré este renglón en la liquidación de ese mes."}
              {recalcular && <>{" "}<button type="button" className="link" onClick={() => setRecalcular(false)}>Volver a lo que se cerró</button></>}
            </span>
          </div>
        )}

        {sinDesglose && (
          <div className="liq__notapago" role="note">
            <AlertTriangle size={15} aria-hidden />
            <span>
              <b>Se cerró antes de que se guardara el desglose.</b> El monto que se pagó es el de la liquidación, pero no quedó escrito
              cómo se llegó a él. Se puede ver una cuenta nueva con los datos de hoy: puede no coincidir con lo que se cerró.
              <span className="desglose__accion">
                <Button sm variante="secondary" icono={<RefreshCw size={14} />} onClick={() => setRecalcular(true)}>
                  Verlo recalculado con los datos de hoy
                </Button>
              </span>
            </span>
          </div>
        )}

        {recalcular && visto && (
          <div className="liq__notapago" role="note">
            <AlertTriangle size={15} aria-hidden />
            <span>
              <b>{cambio ? "No es lo que se cerró." : "Cuenta nueva, con los datos de hoy."}</b>{" "}
              {alCerrar
                ? cambio
                  ? `Se cerró en ${plata(alCerrar.linea.monto, alCerrar.linea.moneda)}; con los datos de hoy daría ${plata(visto.linea.monto, visto.linea.moneda)}.`
                  : `Da lo mismo que se cerró: ${plata(alCerrar.linea.monto, alCerrar.linea.moneda)}.`
                : "Esta cuenta se hizo con los datos de hoy."}
              {" "}<button type="button" className="link" onClick={() => setRecalcular(false)}>Volver a lo que se cerró</button>
            </span>
          </div>
        )}

        {d && <ContenidoDelDesglose d={d} monto={visto?.linea.monto} />}
        {visto && !d && !sinDesglose && (
          <p className="t-sm t-subtle">Este renglón no tiene una cuenta para mostrar.</p>
        )}

        {meses.length > 1 && (
          <section className="stack-2" aria-label="Mes a mes">
            <h4 className="t-label">Mes a mes</h4>
            <div className="desglose__tabla">
              <table className="liq-lista liq-mesames">
                <thead>
                  <tr>
                    <th scope="col">Mes</th>
                    <th scope="col">Cómo dio</th>
                    <th scope="col" className="liq-lista__num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {[...meses].reverse().map((m) => {
                    const l = lineaDelMes(m);
                    return (
                      <tr key={m} data-actual={m === mes ? true : undefined}>
                        <th scope="row">
                          {m === mes
                            ? <span>{nombrePeriodo(m)}</span>
                            : <button type="button" className="link" onClick={() => irA(m)}>{nombrePeriodo(m)}</button>}
                        </th>
                        <td>{l?.detalle ?? "—"}</td>
                        <td className="liq-lista__num">{l ? plata(l.monto, l.moneda) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
