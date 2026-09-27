"use client";

import React, { useMemo, useState } from "react";
import { HandCoins, Info, Landmark, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea } from "@/components/ui/ui";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar, Modal, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { aMonedaBase, escribirMonto, leerMonto } from "@/lib/gastos";
import {
  MESES_DE_COLCHON, cajaEsperada, entradasPorCuenta, runway, ultimoArqueo, type MovimientoCaja,
} from "@/lib/caja";
import type { Arqueo, EstadoApp, Gasto, Moneda, SaldoCuenta } from "@/lib/types";

/* ==================================================================
   Caja: cuánta plata hay de verdad, cuántos meses de vida le da al
   negocio y si las cuentas dan (lib/caja.ts).

   Yari: "una vez por semana la asistente de finanzas me decía: ¿cuánta
   plata tenés en Trust? Y así hacía el arqueo". Acá se cuenta cada cuenta
   (las que tienen API y las que no) y la app lo compara con lo que
   esperaba.
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
  const [ver, setVer] = useState<Arqueo | null>(null);
  const [borrar, setBorrar] = useState<Arqueo | null>(null);

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
              contexto={`Último arqueo: ${M(ultimo.total)} el ${fechaLarga(ultimo.fecha)}`}
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

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead titulo="Arqueos" sub="Cada vez que se contó la plata. La diferencia es contra lo que la app esperaba ese día: si no da, falta cargar un gasto, una venta o un cobro." />
        </div>
        <DataTable
          filas={arqueos}
          ordenInicial={{ clave: "fecha", desc: true }}
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
          ordenInicial={{ clave: "fecha", desc: true }}
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
        mes sin vender (gastos operativos y honorarios del CEO: sueldos, ads, software).
      </Ayuda>

      {arqueando && <NuevoArqueo e={e} onCerrar={() => setArqueando(false)} onListo={(a) => {
        setArqueando(false);
        toast(a.diferencia === null || a.diferencia === undefined ? "Arqueo guardado: es el punto de partida."
          : Math.abs(a.diferencia) < 1 ? "Arqueo guardado: las cuentas dan." : `Arqueo guardado: ${a.diferencia > 0 ? "sobran" : "faltan"} ${M(Math.abs(a.diferencia))}.`);
      }} />}
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
  const entro = useMemo(() => entradasPorCuenta(e, previo?.fecha ?? null, fecha), [e, previo, fecha]);
  const cuentas = e.procesadores.filter((p) => p.activo || entro.has(p.id) || previo?.saldos.some((s) => s.procesadorId === p.id));
  const tipoCambio = leerMonto(tc);

  const saldos: SaldoCuenta[] = cuentas.flatMap((p) => {
    const t = textos[p.id];
    if (t === undefined || t.trim() === "") return [];
    const monto = leerMonto(t);
    if (!Number.isFinite(monto)) return [];
    const moneda: Moneda = p.moneda ?? "USD";
    return [{ procesadorId: p.id, monto, moneda, montoBase: Math.round(aMonedaBase(monto, moneda, base, tipoCambio) * 100) / 100 }];
  });
  const total = Math.round(saldos.reduce((a, s) => a + s.montoBase, 0) * 100) / 100;
  const esperado = previo ? cajaEsperada(e, previo, fecha).esperado : null;
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
            <Input value={tc} onChange={(ev) => setTc(ev.target.value)} inputMode="decimal" />
          </Field>
        )}
      </div>
      <div className="arqueo-tabla" role="table" aria-label="Saldo de cada cuenta">
        <div className="arqueo-fila arqueo-fila--cabeza" role="row">
          <span role="columnheader">Cuenta</span>
          <span role="columnheader">Último arqueo</span>
          <span role="columnheader">Entró desde entonces</span>
          <span role="columnheader">Hay de verdad</span>
        </div>
        {cuentas.map((p) => {
          const antes = previo?.saldos.find((s) => s.procesadorId === p.id);
          const moneda = p.moneda ?? "USD";
          return (
            <div className="arqueo-fila" role="row" key={p.id}>
              <span role="cell" className="t-strong">{p.nombre}{moneda === "ARS" && <span className="t-sm t-subtle"> · en pesos</span>}</span>
              <span role="cell" className="t-num t-muted">{antes ? money(antes.monto, antes.moneda) : "—"}</span>
              <span role="cell" className="t-num t-muted" title="Lo cobrado por esta cuenta, neto de su comisión, según la app">{entro.get(p.id) ? M(entro.get(p.id)!) : "—"}</span>
              <span role="cell">
                <Input
                  aria-label={`Saldo de ${p.nombre}`} inputMode="decimal" placeholder={moneda === "ARS" ? "$ 0" : "US$ 0"}
                  value={textos[p.id] ?? ""} onChange={(ev) => setTextos({ ...textos, [p.id]: ev.target.value })}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className="arqueo-resumen">
        <span>Contado <strong className="t-num">{M(total)}</strong></span>
        {esperado !== null ? (
          <>
            <span>Esperado <strong className="t-num">{M(esperado)}</strong></span>
            {saldos.length > 0 && <Diferencia d={Math.round((total - esperado) * 100) / 100} M={M} />}
          </>
        ) : <span className="t-subtle">Es el primer arqueo: queda como punto de partida.</span>}
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
        <Field label="Monto (US$)"><Input autoFocus inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value)} placeholder="30.000" /></Field>
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
