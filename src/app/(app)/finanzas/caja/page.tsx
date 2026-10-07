"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, Check, ChevronRight, HandCoins, Info, Landmark, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar, Modal, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { aMonedaBase, escribirMonto, leerMonto } from "@/lib/gastos";
import {
  MESES_DE_COLCHON, cajaEsperada, enOtros, runway, ultimoArqueo, type MovimientoCaja,
} from "@/lib/caja";
import { saldosEsperados } from "@/lib/traspasos";
import type { Arqueo, EstadoApp, Gasto, Moneda, Procesador, SaldoCuenta, Traspaso } from "@/lib/types";
import { CopiarLink } from "@/components/ui/Filtros";
import { FormTraspaso, PasesEntreCuentas } from "@/components/finanzas/PasesEntreCuentas";
import { useTablaURL } from "@/lib/useParamsURL";

/* ==================================================================
   Caja: cuánta plata hay de verdad, cuántos meses de vida le da al
   negocio y si las cuentas dan (lib/caja.ts).

   Yari: "una vez por semana la asistente de finanzas me decía: ¿cuánta
   plata tenés en Trust? Y así hacía el arqueo". Acá se cuenta cada cuenta
   (las que tienen API y las que no) y la app lo compara con lo que
   esperaba.

   La plata que pasa de una cuenta a otra (lib/traspasos.ts) no mueve el
   total, pero sí lo que tendría que haber en cada una: con los
   movimientos entre cuentas cargados, el arqueo lo dice cuenta por cuenta.
   ================================================================== */

const hoyIso = () => new Date().toISOString();
const diaAr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);

export default function Caja() {
  const e = useEstado();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);
  const [arqueando, setArqueando] = useState(false);
  const [retirando, setRetirando] = useState(false);
  /* El movimiento entre cuentas que se corrige, o uno nuevo. */
  const [pase, setPase] = useState<Traspaso | "nuevo" | null>(null);
  const [ver, setVer] = useState<Arqueo | null>(null);
  const [borrar, setBorrar] = useState<Arqueo | null>(null);
  /* El orden de cada cuadro va en el link: ?orden-arqueos y ?orden-retiros. */
  const tablaArqueos = useTablaURL("arqueos", { clave: "fecha", desc: true }, ["fecha", "total", "esperado", "dif", "por"]);
  const tablaRetiros = useTablaURL("retiros", { clave: "fecha", desc: true }, ["fecha", "concepto", "monto"]);

  const ultimo = ultimoArqueo(e);
  const mov = useMemo(() => (ultimo ? cajaEsperada(e, ultimo, hoyIso()) : null), [e, ultimo]);
  const caja = mov?.esperado ?? null;
  const vida = useMemo(() => runway(e, caja ?? 0), [e, caja]);
  const arqueos = useMemo(() => [...(e.arqueos ?? [])].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.arqueos]);
  const retiros = useMemo(
    () => e.gastos.filter((g) => g.grupo === "retiro").sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)),
    [e.gastos],
  );
  const anio = new Date().getFullYear();
  const retirosDelAnio = retiros.filter((g) => new Date(g.fecha).getFullYear() === anio).reduce((a, g) => a + g.monto, 0);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Caja"
        sub="Cuánta plata hay de verdad en las cuentas, si da con lo que la app esperaba y cuántos meses de vida le da al negocio."
        acciones={
          <>
            <CopiarLink sm={false} />
            <Button variante="secondary" icono={<ArrowRightLeft size={16} />} onClick={() => setPase("nuevo")}>Movimiento entre cuentas</Button>
            <Button variante="secondary" icono={<HandCoins size={16} />} onClick={() => setRetirando(true)}>Registrar retiro</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setArqueando(true)}>Hacer un arqueo</Button>
          </>
        }
      />

      {!ultimo ? (
        <Card>
          <Empty
            icono={<Landmark size={22} />} titulo="Todavía no hay ningún arqueo"
            texto="Contá cuánto hay hoy en cada cuenta (Stripe, Mercury, Trust, la Financiera, el efectivo) y cargalo. Ese es el punto de partida: desde ahí la app sabe cuánto tendría que haber y te avisa si no da."
            accion={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setArqueando(true)}>Hacer el primer arqueo</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid-stats">
            <StatCard
              hero etiqueta="Caja esperada hoy" valor={M(caja ?? 0)}
              contexto={`Último arqueo: ${M(ultimo.total)} el ${fechaLarga(ultimo.fecha)}${mov && mov.enCamino > 0 ? ` · ${M(mov.enCamino)} están en camino entre cuentas` : ""}`}
            />
            <StatCard
              etiqueta="Meses de vida" valor={vida.mesesDeVida === null ? "—" : num(vida.mesesDeVida, 1)}
              direccion={vida.mesesDeVida !== null && vida.mesesDeVida >= MESES_DE_COLCHON ? "up" : "down"}
              delta={`objetivo ${MESES_DE_COLCHON}`}
              contexto={`Un mes sin vender cuesta ${M(vida.gastoMensual)} (promedio de ${vida.meses})`}
            />
            <StatCard
              etiqueta={vida.excedente >= 0 ? "Se puede retirar" : "Falta para 6 meses"}
              valor={M(Math.abs(vida.excedente))}
              direccion={vida.excedente >= 0 ? "up" : "down"}
              contexto={`El colchón de ${MESES_DE_COLCHON} meses es ${M(vida.colchon)}`}
            />
            <StatCard
              etiqueta={`Retiros de ${anio}`} valor={M(retirosDelAnio)}
              contexto={retiros.length ? `${retiros.length} en total` : "Todavía ninguno"}
            />
          </div>

          {mov && <Movimiento mov={mov} M={M} />}
        </>
      )}

      <PasesEntreCuentas e={e} onNuevo={() => setPase("nuevo")} onEditar={(t) => setPase(t)} />

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead titulo="Arqueos" sub="Cada vez que se contó la plata. La diferencia es contra lo que la app esperaba ese día: si no da, falta cargar un gasto, una venta o un cobro." />
        </div>
        <DataTable
          filas={arqueos}
          orden={tablaArqueos.orden} onOrden={tablaArqueos.onOrden}
          onFila={(a) => setVer(a)}
          etiquetaFila={(a) => `Ver el arqueo del ${fechaLarga(a.fecha)}`}
          columnas={[
            { clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (a) => a.fecha, celda: (a) => fechaLarga(a.fecha) },
            { clave: "total", titulo: "Contado", tipo: "num", orden: (a) => a.total, celda: (a) => M(a.total) },
            { clave: "esperado", titulo: "Esperado", tipo: "num", orden: (a) => a.esperado ?? 0, celda: (a) => (a.esperado === null || a.esperado === undefined ? <span className="t-subtle">Punto de partida</span> : M(a.esperado)) },
            { clave: "dif", titulo: "Diferencia", tipo: "num", orden: (a) => a.diferencia ?? 0, celda: (a) => <Diferencia d={a.diferencia} M={M} /> },
            { clave: "por", titulo: "Lo cargó", tipo: "secondary", orden: (a) => a.por ?? "", celda: (a) => a.por ?? "—" },
          ]}
          acciones={(a) => <IconButton etiqueta="Borrar el arqueo" onClick={() => setBorrar(a)}><Trash2 size={15} /></IconButton>}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Sin arqueos todavía.</p>}
        />
      </Card>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead titulo="Retiros del dueño" sub="La plata que sale de la caja y no es un gasto del negocio (el retiro de fin de año): no resta del profit, sí de la caja." />
        </div>
        <DataTable
          filas={retiros}
          orden={tablaRetiros.orden} onOrden={tablaRetiros.onOrden}
          columnas={[
            { clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (g) => g.fecha, celda: (g) => fechaLarga(g.fecha) },
            { clave: "concepto", titulo: "Concepto", tipo: "secondary", orden: (g) => g.concepto, celda: (g) => g.concepto },
            { clave: "monto", titulo: "Monto", tipo: "num", orden: (g) => g.monto, celda: (g) => M(g.monto, 2) },
          ]}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Sin retiros cargados.</p>}
        />
      </Card>

      <Ayuda titulo="Cómo se calcula" icono={<Info size={18} />}>
        La caja esperada parte del último arqueo y le suma lo cobrado, menos procesadores, comisiones de closers y
        director, los gastos cargados, el growth partner y el socio, y los retiros. Las comisiones se pagan a mes
        vencido: al principio de mes la diferencia puede ser eso. Los meses de vida son la caja sobre lo que cuesta un
        mes sin vender (gastos operativos y honorarios del CEO: sueldos, ads, software). Un movimiento entre cuentas
        no cambia el total: sólo lo que tendría que haber en cada cuenta, y lo que costó el pase, que va como gasto.
        Mientras la plata viaja de una cuenta a otra sigue siendo de la caja, pero no está en ninguna: por eso el
        arqueo la descuenta de lo que tiene que dar al contar.
      </Ayuda>

      {arqueando && <NuevoArqueo e={e} onCerrar={() => setArqueando(false)} onListo={(a) => {
        setArqueando(false);
        toast(a.diferencia === null || a.diferencia === undefined ? "Arqueo guardado: es el punto de partida."
          : Math.abs(a.diferencia) < 1 ? "Arqueo guardado: las cuentas dan." : `Arqueo guardado: ${a.diferencia > 0 ? "sobran" : "faltan"} ${M(Math.abs(a.diferencia))}.`);
      }} />}
      {pase && (
        <FormTraspaso
          e={e} traspaso={pase === "nuevo" ? null : pase} onCerrar={() => setPase(null)}
          onListo={(mensaje) => { setPase(null); toast(mensaje); }}
        />
      )}
      {retirando && <NuevoRetiro e={e} onCerrar={() => setRetirando(false)} onListo={() => { setRetirando(false); toast("Retiro registrado."); }} />}
      {ver && <VerArqueo e={e} a={ver} onCerrar={() => setVer(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)} confirmarTexto="Borrar el arqueo"
        titulo="¿Borrar este arqueo?" texto={`Se borra el arqueo del ${borrar ? fechaLarga(borrar.fecha) : ""}. La caja esperada vuelve a partir del anterior.`}
        onConfirmar={() => { if (borrar) { acciones.borrarArqueo(borrar.id); toast("Arqueo borrado."); } }}
      />
    </div>
  );
}

function Diferencia({ d, M }: { d?: number | null; M: (n: number, dec?: number) => string }) {
  if (d === null || d === undefined) return <span className="t-subtle">—</span>;
  if (Math.abs(d) < 1) return <Badge variante="success">Da</Badge>;
  return <Badge variante={d < 0 ? "danger" : "warning"}>{d > 0 ? "Sobran " : "Faltan "}{M(Math.abs(d))}</Badge>;
}

function Movimiento({ mov, M }: { mov: MovimientoCaja; M: (n: number, d?: number) => string }) {
  const filas: [string, number, string?][] = [
    ["Caja del último arqueo", mov.inicial],
    ...(mov.enCaminoAntes ? [["+ Estaba en camino al contar", mov.enCaminoAntes, "Había salido de una cuenta y no había llegado a la otra"] as [string, number, string]] : []),
    ["+ Cobrado", mov.cobrado, "Todo lo que entró por las cuentas"],
    ["− Procesadores", -mov.procesador],
    ["− Comisiones de closers y director", -mov.comisiones, "Se pagan a mes vencido"],
    ["− Gastos cargados", -mov.gastos, "Directos, operativos y honorarios del CEO"],
    ["− Growth partner y socio", -mov.reparto],
    ["− Retiros del dueño", -mov.retiros],
  ];
  return (
    <Card>
      <CardHead titulo={`Desde el último arqueo (${fechaLarga(mov.desde)})`} sub="Lo que la app sabe que pasó con la plata. Si al contar no da, lo que falta está acá." />
      <dl className="caja-mov">
        {filas.map(([t, n, ayuda]) => (
          <React.Fragment key={t}>
            <dt>{t}{ayuda && <span className="t-sm t-subtle"> · {ayuda}</span>}</dt>
            <dd className="t-num">{M(n)}</dd>
          </React.Fragment>
        ))}
        <dt className="caja-mov__total">= Caja esperada hoy</dt>
        <dd className="caja-mov__total t-num">{M(mov.esperado)}</dd>
        {mov.enCamino > 0 && (
          <>
            <dt>− En camino entre cuentas<span className="t-sm t-subtle"> · Salió de una y todavía no llegó a la otra: al contar no está en ninguna</span></dt>
            <dd className="t-num">{M(-mov.enCamino)}</dd>
            <dt>= Lo que tendría que dar al contar las cuentas</dt>
            <dd className="t-num">{M(mov.enCuentas)}</dd>
          </>
        )}
      </dl>
    </Card>
  );
}

/* ---------- Un arqueo nuevo ---------- */

function NuevoArqueo({ e, onCerrar, onListo }: { e: EstadoApp; onCerrar: () => void; onListo: (a: Arqueo) => void }) {
  const base = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, base, d);
  const [dia, setDia] = useState(diaAr(hoyIso()));
  const [tc, setTc] = useState(e.ajustes.tipoCambio > 0 ? escribirMonto(e.ajustes.tipoCambio) : "");
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState("");

  /* Si es hoy, ahora; si es otro día, a las 20 de ese día. */
  const fecha = dia === diaAr(hoyIso()) ? hoyIso() : new Date(`${dia}T23:00:00.000Z`).toISOString();
  const previo = ultimoArqueo(e, fecha);
  /* Lo que tendría que haber en cada cuenta, en su moneda. */
  const porCuenta = useMemo(() => saldosEsperados(e, previo, fecha), [e, previo, fecha]);
  const cuentas = e.procesadores.filter((p) => {
    const s = porCuenta.get(p.id);
    return p.activo || Boolean(s && (s.entro || s.pases || s.salio)) || previo?.saldos.some((x) => x.procesadorId === p.id);
  });
  const tipoCambio = leerMonto(tc);
  const hayPases = cuentas.some((p) => porCuenta.get(p.id)?.pases);
  /* Lo que se usa todo el tiempo arriba; lo demás, en «Otros» (plegado salvo que ya tenga un saldo escrito). */
  const [verOtros, setVerOtros] = useState(false);
  const principales = cuentas.filter((p) => !enOtros(p));
  const otros = cuentas.filter(enOtros);
  const otrosAbiertos = verOtros || otros.some((p) => textos[p.id]?.trim());

  const saldos: SaldoCuenta[] = cuentas.flatMap((p) => {
    const t = textos[p.id];
    if (t === undefined || t.trim() === "") return [];
    const monto = leerMonto(t);
    if (!Number.isFinite(monto)) return [];
    const moneda: Moneda = p.moneda ?? "USD";
    return [{ procesadorId: p.id, monto, moneda, montoBase: Math.round(aMonedaBase(monto, moneda, base, tipoCambio) * 100) / 100 }];
  });
  const total = Math.round(saldos.reduce((a, s) => a + s.montoBase, 0) * 100) / 100;
  /* Contra lo que tiene que dar al contar: lo que viaja entre cuentas no está en ninguna. */
  const mov = previo ? cajaEsperada(e, previo, fecha, tipoCambio) : null;
  const esperado = mov ? mov.enCuentas : null;
  const hayPesos = cuentas.some((p) => p.moneda === "ARS");
  const faltaTc = hayPesos && saldos.some((s) => s.moneda === "ARS") && !(tipoCambio > 0);

  function guardar() {
    const a: Arqueo = {
      id: nuevoId("arq"), fecha, saldos, total,
      tipoCambio: tipoCambio > 0 ? tipoCambio : undefined,
      esperado, diferencia: esperado === null ? null : Math.round((total - esperado) * 100) / 100,
      notas: notas.trim() || undefined, por: e.ajustes.responsable || undefined, creadoEn: hoyIso(),
    };
    acciones.guardarArqueo(a);
    onListo(a);
  }

  /* Una cuenta del arqueo. */
  const fila = (p: Procesador) => {
      const s = porCuenta.get(p.id);
      const moneda = p.moneda ?? "USD";
      const enSuMoneda = (n: number, signo = false) => `${signo && n > 0 ? "+ " : n < 0 ? "− " : ""}${money(Math.abs(n), moneda)}`;
      const contado = textos[p.id]?.trim() ? leerMonto(textos[p.id]) : NaN;
      const dif = s?.esperado !== undefined && Number.isFinite(contado) ? Math.round((contado - s.esperado) * 100) / 100 : null;
      /* Lo contado contra lo que tendría que haber: el casillero se pinta
         (verde si da, ámbar si no) y adentro va el tilde o la diferencia. */
      const da = dif !== null && Math.abs(dif) < 1;
      /* En pesos la diferencia puede ser de millones: adentro va corta (−1,25 M) y entera al pasar el mouse. */
      const cuanto = dif === null ? 0 : Math.abs(dif);
      const marca = dif === null || da ? ""
        : `${dif > 0 ? "+" : "−"}${cuanto >= 1e6 ? `${(cuanto / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 2 })} M` : num(cuanto)}`;
      const dice = dif === null ? undefined : da ? "Da con lo que tendría que haber en esta cuenta"
        : `${dif > 0 ? "Sobran" : "Faltan"} ${money(Math.abs(dif), moneda)} contra lo que tendría que haber en esta cuenta`;
      return (
        <div className="arqueo-fila" role="row" key={p.id}>
          <span role="cell" className="t-strong">{p.nombre}{moneda === "ARS" && <span className="t-sm t-subtle"> · en pesos</span>}</span>
          <span role="cell" data-titulo="Último arqueo" className="t-num t-muted">{s?.anterior !== undefined ? money(s.anterior, moneda) : "—"}</span>
          <span role="cell" data-titulo="Cobró" className="t-num t-muted" title="Lo cobrado por esta cuenta desde el último arqueo, neto de su comisión">{s?.entro ? enSuMoneda(s.entro, true) : "—"}</span>
          <span role="cell" data-titulo="Pases" className="t-num t-muted" title="Lo que recibió de otras cuentas menos lo que les mandó">{s?.pases ? enSuMoneda(s.pases, true) : "—"}</span>
          <span role="cell" data-titulo="Tendría que haber" className="t-num" title={s?.salio ? `Ya descuenta ${money(s.salio, moneda)} de retiros que salieron de esta cuenta` : undefined}>
            {s?.esperado !== undefined ? money(s.esperado, moneda) : "—"}
          </span>
          <span
            role="cell" className="arqueo-hay" title={dice} data-estado={dif === null ? undefined : da ? "da" : "difiere"}
            style={marca ? { "--marca": `${Math.round(marca.length * 6.5)}px` } as React.CSSProperties : undefined}
          >
            <InputMonto
              aria-label={`Saldo de ${p.nombre}`} placeholder={moneda === "ARS" ? "$ 0" : "US$ 0"}
              value={textos[p.id] ?? ""} onChange={(ev) => setTextos({ ...textos, [p.id]: ev.target.value })}
            />
            {dif !== null && (da
              ? <Check size={16} className="arqueo-hay__marca" aria-label={dice} />
              : <span className="arqueo-hay__marca" aria-label={dice}>{marca}</span>)}
          </span>
        </div>
      );
  };

  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={guardar} guardarTexto="Guardar el arqueo"
      puedeGuardar={saldos.length > 0 && !faltaTc}
      titulo="Arqueo de caja"
      sub="Escribí cuánto hay hoy en cada cuenta, en su moneda. Las que no tocás no se cuentan."
    >
      <div className="form-grid">
        <Field label="Día del arqueo"><Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value || diaAr(hoyIso()))} /></Field>
        {hayPesos && (
          <Field label="Tipo de cambio (pesos por dólar)" ayuda="Para pasar a dólares las cuentas en pesos." error={faltaTc ? "Poné el tipo de cambio." : undefined}>
            <InputMonto decimales={4} value={tc} onChange={(ev) => setTc(ev.target.value)} />
          </Field>
        )}
      </div>
      <div className="arqueo-tabla" role="table" aria-label="Saldo de cada cuenta">
        <div className="arqueo-fila arqueo-fila--cabeza" role="row">
          <span role="columnheader">Cuenta</span>
          <span role="columnheader">Último arqueo</span>
          <span role="columnheader">Cobró</span>
          <span role="columnheader">Pases</span>
          <span role="columnheader">Tendría que haber</span>
          <span role="columnheader">Hay de verdad</span>
        </div>
        {principales.map(fila)}
        {otros.length > 0 && (
          <>
            <button type="button" className="arqueo-otros" aria-expanded={otrosAbiertos} onClick={() => setVerOtros(!otrosAbiertos)}>
              <ChevronRight size={14} aria-hidden />
              <span>Otros ({otros.length})</span>
              <span className="t-sm t-subtle">cuentas que no se usan seguido</span>
            </button>
            {otrosAbiertos && otros.map(fila)}
          </>
        )}
      </div>
      {previo && (
        <p className="t-sm t-subtle arqueo-nota">
          «Tendría que haber» es lo del último arqueo más lo que cobró la cuenta, más o menos los movimientos entre cuentas
          {hayPases ? "" : " (todavía no hay ninguno cargado desde entonces)"} y menos los retiros que dicen de qué cuenta salieron.
          No descuenta los gastos ni los sueldos, porque la app no sabe de qué cuenta se pagó cada uno: en la cuenta desde la que
          pagás va a faltar eso. El control que tiene que dar es el del total.
        </p>
      )}
      <div className="arqueo-resumen">
        <span>Contado <strong className="t-num">{M(total)}</strong></span>
        {esperado !== null ? (
          <>
            <span>Esperado <strong className="t-num">{M(esperado)}</strong></span>
            {saldos.length > 0 && <Diferencia d={Math.round((total - esperado) * 100) / 100} M={M} />}
          </>
        ) : <span className="t-subtle">Es el primer arqueo: queda como punto de partida.</span>}
        {mov && mov.enCamino > 0 && (
          <span className="t-sm t-subtle arqueo-resumen__nota">
            El esperado ya descuenta {M(mov.enCamino)} que están en camino entre cuentas: salieron de una y todavía no se vieron llegar a la otra.
          </span>
        )}
      </div>
      <Field label="Notas" span2><Textarea rows={2} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Qué se revisó, qué no dio" /></Field>
    </ModalForm>
  );
}

function VerArqueo({ e, a, onCerrar }: { e: EstadoApp; a: Arqueo; onCerrar: () => void }) {
  const M = (n: number) => money(n, e.ajustes.monedaBase);
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Arqueo del ${fechaLarga(a.fecha)}`} sub={a.por ? `Lo cargó ${a.por}` : undefined}>
      <dl className="caja-mov">
        {a.saldos.map((s) => (
          <React.Fragment key={s.procesadorId}>
            <dt>{e.procesadores.find((p) => p.id === s.procesadorId)?.nombre ?? "Cuenta borrada"}</dt>
            <dd className="t-num">{money(s.monto, s.moneda)}{s.moneda !== e.ajustes.monedaBase && <span className="t-sm t-subtle"> · {M(s.montoBase)}</span>}</dd>
          </React.Fragment>
        ))}
        <dt className="caja-mov__total">Total</dt>
        <dd className="caja-mov__total t-num">{M(a.total)}</dd>
        {a.esperado !== null && a.esperado !== undefined && (<><dt>Esperado</dt><dd className="t-num">{M(a.esperado)}</dd></>)}
      </dl>
      {a.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{a.notas}</p>}
    </Modal>
  );
}

/* ---------- Un retiro del dueño ---------- */

function NuevoRetiro({ e, onCerrar, onListo }: { e: EstadoApp; onCerrar: () => void; onListo: () => void }) {
  const [dia, setDia] = useState(diaAr(hoyIso()));
  const [monto, setMonto] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [concepto, setConcepto] = useState("Retiro de beneficios");
  const n = leerMonto(monto);
  function guardar() {
    const g: Gasto = {
      id: nuevoId("gas"), categoria: "Retiro de beneficios", grupo: "retiro", concepto: concepto.trim() || "Retiro de beneficios",
      monto: Math.round(n * 100) / 100, moneda: e.ajustes.monedaBase, fecha: new Date(`${dia}T15:00:00.000Z`).toISOString(),
      recurrente: false, proveedor: e.procesadores.find((p) => p.id === cuenta)?.nombre, creadoEn: hoyIso(),
      extra: cuenta ? { cuentaId: cuenta } : {},
    };
    acciones.crear<Gasto>("gastos", g, g.concepto);
    onListo();
  }
  return (
    <ModalForm
      abierto onCerrar={onCerrar} onGuardar={guardar} guardarTexto="Registrar retiro" puedeGuardar={n > 0}
      titulo="Retiro del dueño" sub="Plata que sacás de la caja del negocio. No es un gasto: no resta del profit, sí de la caja."
    >
      <div className="form-grid">
        <Field label="Monto (US$)"><InputMonto autoFocus value={monto} onChange={(ev) => setMonto(ev.target.value)} placeholder="30.000" /></Field>
        <Field label="Día"><Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value || diaAr(hoyIso()))} /></Field>
        <Field label="De qué cuenta salió">
          <Select value={cuenta} placeholder="Sin especificar" onChange={(ev) => setCuenta(ev.target.value)}
            opciones={e.procesadores.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
        </Field>
        <Field label="Concepto"><Input value={concepto} onChange={(ev) => setConcepto(ev.target.value)} /></Field>
      </div>
    </ModalForm>
  );
}
