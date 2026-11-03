"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { Cascada, Plegable, Segmentado, type PasoCascada } from "@/components/finanzas/visual/visual";
import { fechaLarga, money } from "@/lib/format";
import { moverPeriodo, nombrePeriodo, periodoDe, rangoDePeriodo } from "@/lib/periodos";
import { flujoDelPeriodo, saldosPorCuenta, type SaldoDeCuenta, type VistaDeSaldos } from "@/lib/saldos-vista";
import { nube } from "@/lib/supabase";
import type { LecturaDeSaldos } from "@/lib/useSaldosReales";
import type { EstadoApp, ID, Moneda } from "@/lib/types";
import "./saldos-vista.css";

/* ==================================================================
   Saldos: cuánta plata hay en cada cuenta y cuánta entró y salió.

   Juan Cruz a Aldana (01/11): «voy a construir una que sea saldo, cosa de que podamos ver fácil cuánta plata hay en cada plataforma».
   Las cuentas que se leen solas (Trust, Mercury, Stripe) muestran lo que hay de verdad, lo mismo que el Control de saldos; las demás,
   lo que la app espera desde el último arqueo, lo mismo que la columna «Tendría que haber» del arqueo. Las reglas están en
   lib/saldos-vista.ts; acá sólo se dibuja.
   ================================================================== */

const horaAr = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
const mes = (periodo: string) => { const n = nombrePeriodo(periodo).split(" ")[0]; return n.charAt(0).toUpperCase() + n.slice(1); };

export function SaldosVista({ e, lectura, rangoFijo }: {
  e: EstadoApp;
  lectura: LecturaDeSaldos;
  /* Adentro de un paso del cierre: el entró y salió es de esos días. */
  rangoFijo?: { desde: string; hasta: string };
}) {
  const { resp, cuando } = lectura;
  const base = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, base, d);
  const ahoraIso = useMemo(() => cuando ?? new Date().toISOString(), [cuando]);
  const vista = useMemo(() => saldosPorCuenta(e, resp?.saldos ?? [], ahoraIso), [e, resp, ahoraIso]);
  const nombre = (id: ID) => e.procesadores.find((p) => p.id === id)?.nombre ?? id;
  const mayor = Math.max(...vista.cuentas.map((c) => c.saldoBase ?? 0), 0);
  /* Lo que se leyó del banco va junto y lo que la app espera, aparte: se ve de un vistazo qué está confirmado. */
  const leidas = vista.cuentas.filter((c) => c.origen === "real");
  const esperadas = vista.cuentas.filter((c) => c.origen !== "real");

  return (
    <>
      <section className="fz-hero" aria-label="Saldos por cuenta">
        <div>
          <span className="fz-hero__etiqueta">
            Plata en las cuentas hoy
            <InfoMetrica
              titulo="Plata en las cuentas hoy" periodo={vista.desde ? `esperado desde el arqueo del ${fechaLarga(vista.desde)}` : undefined}
              ayuda="La suma de lo que hay en cada cuenta. De Trust, Mercury y Stripe es el saldo real, leído del banco. De las demás es lo que la app espera que haya: lo del último arqueo más lo cobrado, más o menos los pases entre cuentas, menos lo que salió de ahí."
              formula={"Σ de cada cuenta, en dólares\nCuentas que se leen solas: lo que hay de verdad (el mismo número del Control de saldos)\nLas demás: el saldo del último arqueo + lo cobrado + los pases − lo que salió de esa cuenta\n(la columna «Tendría que haber» del arqueo)\nLas cuentas en pesos van al tipo de cambio de Ajustes."}
              componentes={() => [
                ...vista.cuentas.filter((c) => c.saldoBase !== undefined).map((c) => ({ concepto: `${c.nombre} · ${ORIGEN[c.origen].texto.toLowerCase()}`, valor: M(c.saldoBase!, 2), signo: "+" as const })),
                { concepto: "Total", valor: M(vista.total, 2), signo: "=" as const },
              ]}
            />
          </span>
          <span className="fz-hero__valor">{M(vista.total)}</span>
          <p className="fz-hero__sub">
            {vista.porOrigen.real > 0 && <><b>{M(vista.porOrigen.real)}</b> leído del banco</>}
            {vista.porOrigen.real > 0 && vista.porOrigen.esperado + vista.porOrigen.parcial > 0 && " · "}
            {vista.porOrigen.esperado + vista.porOrigen.parcial > 0 && <><b>{M(vista.porOrigen.esperado + vista.porOrigen.parcial)}</b> esperado por la app</>}
          </p>
          {vista.desde && esperadas.length > 0 && <p className="fz-hero__sub">Lo esperado parte del arqueo del {fechaLarga(vista.desde)}</p>}
          {nube && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <Button sm variante="secondary" icono={<RefreshCw size={15} />} cargando={lectura.cargando} onClick={() => void lectura.leer()}>Volver a leer los bancos</Button>
              {cuando && <p className="fz-hero__sub">Leído a las {horaAr(cuando)}</p>}
            </div>
          )}
        </div>

        <div className="fz-hero__der">
          {vista.cuentas.length === 0 ? (
            <p className="t-sm t-muted" style={{ margin: 0 }}>
              Todavía no hay saldos para mostrar. Hacé un arqueo: ese es el punto de partida, desde ahí la app sabe cuánto hay en cada cuenta.
            </p>
          ) : (
            <ul className="sd-cuentas" aria-label="Cuánto hay en cada cuenta">
              {leidas.length > 0 && <li className="sd-grupo"><i className="sd-grupo__muestra" aria-hidden />Leído del banco</li>}
              {leidas.map((c) => <Fila key={c.cuentaId} c={c} vista={vista} mayor={mayor} M={M} base={base} />)}
              {esperadas.length > 0 && <li className="sd-grupo"><i className="sd-grupo__muestra" data-origen="esperado" aria-hidden />Esperado por la app</li>}
              {esperadas.map((c) => <Fila key={c.cuentaId} c={c} vista={vista} mayor={mayor} M={M} base={base} />)}
            </ul>
          )}
          <Avisos vista={vista} lectura={lectura} nombre={nombre} />
          {vista.contraLaCaja && <ContraLaCaja c={vista.contraLaCaja} M={M} />}
        </div>
      </section>

      <Flujo e={e} rangoFijo={rangoFijo} />
    </>
  );
}

/* ---------- Una cuenta ---------- */

const ORIGEN: Record<SaldoDeCuenta["origen"], { texto: string; variante: "success" | "neutral" | "warning" }> = {
  real: { texto: "Leído", variante: "success" },
  esperado: { texto: "Esperado", variante: "neutral" },
  parcial: { texto: "Sin contar", variante: "warning" },
  "sin-dato": { texto: "Sin dato", variante: "neutral" },
};

function Fila({ c, vista, mayor, M, base }: { c: SaldoDeCuenta; vista: VistaDeSaldos; mayor: number; M: (n: number, d?: number) => string; base: Moneda }) {
  const noDa = c.control?.lectura === "sobra" || c.control?.lectura === "falta";
  const ancho = c.saldoBase !== undefined && mayor > 0 ? Math.max(c.saldoBase, 0) / mayor * 100 : 0;
  /* El esperado no lleva etiqueta (su grupo ya lo dice): sólo lo leído y lo que hay que mirar. */
  const o = noDa ? { texto: "No da", variante: "warning" as const } : c.origen === "esperado" ? null : ORIGEN[c.origen];
  const monto = c.saldoBase !== undefined ? M(c.saldoBase) : c.saldo !== undefined ? money(c.saldo, c.moneda, 0) : "—";
  const { texto: nota, alerta } = detalle(c, vista, M, base);
  const calculo = c.origen === "real" ? `Leído de ${c.control?.fuente ?? "la cuenta"} a las ${c.control ? horaAr(c.control.al) : ""}`
    : c.saldo === undefined ? undefined
      : `${c.partida !== undefined ? `Arqueo ${money(c.partida, c.moneda, 2)}` : "Sin saldo de partida"} · cobró ${money(c.entro ?? 0, c.moneda, 2)} · pases ${money(c.pases ?? 0, c.moneda, 2)} · salió ${money(c.salio ?? 0, c.moneda, 2)}${c.sinVenta ? ` · cobros sin venta ${money(c.sinVenta, base, 2)}` : ""}`;
  return (
    <li className="sd-cuenta" data-origen={c.origen} data-no-da={noDa || undefined}>
      <span className="sd-cuenta__nombre">
        <span className="sd-cuenta__texto" title={c.nombre}>{c.nombre}</span>
        {o && (
          <Badge variante={o.variante} icono={c.origen === "real" ? (noDa ? <AlertTriangle size={11} aria-hidden /> : <Check size={11} aria-hidden />) : undefined}>
            {c.origen === "real" && c.control && !noDa ? horaAr(c.control.al) : o.texto}
          </Badge>
        )}
      </span>
      <span className="sd-cuenta__pista" aria-hidden><span className="sd-cuenta__barra" style={{ width: `${ancho}%` }} /></span>
      <span className="sd-cuenta__monto" title={calculo}>{monto}</span>
      {nota && <span className="sd-cuenta__sub" data-alerta={alerta || undefined}>{alerta && <AlertTriangle size={12} aria-hidden />}{nota}</span>}
    </li>
  );
}

/* Lo que hay que aclarar de una cuenta, en una línea. */
function detalle(c: SaldoDeCuenta, vista: VistaDeSaldos, M: (n: number, d?: number) => string, base: Moneda): { texto?: string; alerta?: boolean } {
  if (c.sinCambio) return { texto: `${money(c.saldo ?? 0, c.moneda, 0)}: no entra en el total, falta el tipo de cambio en Ajustes.`, alerta: true };
  if (c.origen === "sin-dato") return { texto: "Todavía no se contó: sumala en un arqueo.", alerta: true };
  if (c.origen === "parcial") return { texto: `Sólo lo que se movió desde el ${fechaLarga(vista.desde)}: contala en un arqueo para saber lo que ya tenía.`, alerta: true };
  if (c.origen === "real" && c.control) {
    const f = c.control;
    /* Una diferencia chica se ve con sus centavos: «US$ 9» escondería los 8,50 que faltan cargar. */
    const dif = Math.abs(f.diferencia ?? 0);
    const cuanto = money(dif, f.moneda, dif < 100 ? 2 : 0);
    if (f.lectura === "sobra" || f.lectura === "falta") return { texto: `No da: ${f.lectura === "sobra" ? "sobran" : "faltan"} ${cuanto} contra lo que la app esperaba (${money(f.esperado ?? 0, f.moneda, 0)}).`, alerta: true };
    if (f.lectura === "da-con-pendientes") return { texto: `Da, con ${cuanto} que el banco todavía no asentó.` };
    if (f.lectura === "sin-punto-de-partida") return { texto: "Todavía no hay un arqueo de esta cuenta para compararla." };
    return {};
  }
  const partes: string[] = [];
  if (c.moneda !== base && c.saldo !== undefined) partes.push(`${money(c.saldo, c.moneda, 0)} al cambio de ${money(vista.tipoCambio, c.moneda, 0)}`);
  if (c.sinVenta) partes.push(`incluye ${M(c.sinVenta)} de cobros que todavía no tienen su venta`);
  return { texto: partes.join(" · ") || undefined };
}

/* ---------- Avisos ---------- */

function Avisos({ vista, lectura, nombre }: { vista: VistaDeSaldos; lectura: LecturaDeSaldos; nombre: (id: ID) => string }) {
  const { resp, error } = lectura;
  const lineas: { clave: string; texto: string; alerta?: boolean }[] = [];
  if (!nube && !resp) lineas.push({ clave: "local", texto: "Con la app local no se leen los saldos de los bancos: se ve lo que la app espera." });
  if (error) lineas.push({ clave: "error", texto: `No se pudieron leer los bancos (${error}). Se ve lo que la app espera.`, alerta: true });
  for (const x of resp?.errores ?? []) lineas.push({ clave: `err-${x.cuentaId}`, texto: `${nombre(x.cuentaId)}: ${x.mensaje}`, alerta: true });
  if (resp && resp.sinConexion.length > 0) lineas.push({ clave: "sin-conexion", texto: `Sin conectar (se ve lo esperado): ${resp.sinConexion.map(nombre).join(", ")}.` });
  if (vista.sinCambio.length > 0) lineas.push({ clave: "cambio", texto: `Falta el tipo de cambio en Ajustes: ${vista.sinCambio.map((c) => c.nombre).join(", ")} no entra${vista.sinCambio.length === 1 ? "" : "n"} en el total.`, alerta: true });
  if (vista.aparte.length > 0) lineas.push({ clave: "aparte", texto: `Sin saldo: ${vista.aparte.map((c) => c.nombre).join(", ")}.` });
  if (lineas.length === 0) return null;
  return (
    <div className="sd-avisos">
      {lineas.map((l) => <p key={l.clave} className="t-sm" data-alerta={l.alerta || undefined}>{l.texto}</p>)}
    </div>
  );
}

/* ---------- Contra la Caja esperada ---------- */

function ContraLaCaja({ c, M }: { c: NonNullable<VistaDeSaldos["contraLaCaja"]>; M: (n: number, d?: number) => string }) {
  const con = (n: number) => `${n < 0 ? "−" : "+"} ${M(Math.abs(n))}`;
  const lineas: [string, number, string][] = [
    ["Gastos que no dicen de qué cuenta salieron", c.sinCuenta, "La Caja los descontó; ninguna cuenta"],
    ["Cobros sin su venta", c.sinVenta, "Están en la cuenta; la Caja no los cuenta como cobrados hasta que se concilien"],
    ["Lo que marcan los bancos", c.bancosMarcan, "Hay de verdad contra lo que la app esperaba (la diferencia del Control de saldos)"],
  ];
  const hayResto = Math.abs(c.resto) >= 1;
  return (
    <div className="sd-caja"><Plegable
      titulo="Contra la Caja esperada"
      resumen={Math.abs(c.diferencia) < 1 ? "Dan lo mismo" : `Las cuentas suman ${M(Math.abs(c.diferencia))} ${c.diferencia > 0 ? "más" : "menos"}`}
    >
      <dl className="sd-concilia">
        <dt>La Caja espera en las cuentas</dt><dd>{M(c.cajaEnCuentas)}</dd>
        <dt>Las cuentas suman</dt><dd>{M(c.sumaDeCuentas)}</dd>
        <dt className="sd-concilia__total">Diferencia</dt><dd className="sd-concilia__total">{Math.abs(c.diferencia) < 1 ? M(0) : con(c.diferencia)}</dd>
        {lineas.filter(([, n]) => Math.abs(n) >= 1).map(([t, n, ayuda]) => (
          <React.Fragment key={t}><dt className="sd-concilia__parte" title={ayuda}>{t}</dt><dd className="sd-concilia__parte">{con(n)}</dd></React.Fragment>
        ))}
        {hayResto && <><dt className="sd-concilia__parte" title="Lo que queda: diferencias de tipo de cambio y redondeos">Resto</dt><dd className="sd-concilia__parte">{con(c.resto)}</dd></>}
      </dl>
    </Plegable></div>
  );
}

/* ---------- Entró y salió ---------- */

function Flujo({ e, rangoFijo }: { e: EstadoApp; rangoFijo?: { desde: string; hasta: string } }) {
  const base = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, base, d);
  const [cual, setCual] = useState<"actual" | "anterior">("actual");
  const ahora = useMemo(() => new Date(), []);
  const hoyP = periodoDe(ahora);
  const periodo = cual === "actual" ? hoyP : moverPeriodo(hoyP, -1);
  const { desde, hasta, etiqueta } = useMemo(() => {
    if (rangoFijo) {
      const d = new Date(`${rangoFijo.desde}T00:00:00-03:00`), h = new Date(`${rangoFijo.hasta}T23:59:59.999-03:00`);
      return { desde: d, hasta: h, etiqueta: `del ${fechaLarga(d.toISOString())} al ${fechaLarga(h.toISOString())}` };
    }
    const r = rangoDePeriodo(periodo);
    /* Este mes llega hasta hoy: lo que todavía no pasó no cuenta. */
    const h = cual === "actual" && ahora < r.hasta ? ahora : r.hasta;
    return { desde: r.desde, hasta: h, etiqueta: `de ${nombrePeriodo(periodo)}${cual === "actual" ? ", hasta hoy" : ""}` };
  }, [rangoFijo, periodo, cual, ahora]);
  const flujo = useMemo(() => flujoDelPeriodo(e, desde, hasta), [e, desde, hasta]);

  const pasos: PasoCascada[] = [
    { id: "entro", nombre: "Cobrado", valor: flujo.entro, texto: `+${M(flujo.entro)}`, tipo: "suma", ayuda: "Todo lo que entró por las cuentas" },
    ...flujo.partes.filter((p) => Math.abs(p.monto) >= 0.5).map((p): PasoCascada => ({ id: p.id, nombre: p.nombre, valor: -p.monto, texto: M(-p.monto), tipo: "resta", ayuda: p.ayuda })),
    { id: "neto", nombre: flujo.neto >= 0 ? "Quedó" : "Faltó", valor: flujo.neto, texto: M(flujo.neto), tipo: "total", ayuda: "Lo cobrado menos todo lo que salió" },
  ];
  return (
    <Card>
      <div className="fz-cabtabla fz-cabtabla--suelta">
        <div className="fz-cabtabla__tit">
          <h2 className="card-head__title">Entró y salió {etiqueta}</h2>
          <InfoMetrica
            titulo="Entró y salió" periodo={etiqueta}
            ayuda="La plata que entró por las cuentas y la que salió en ese período, con la misma cuenta de la Caja. Un gasto cuenta el día que se pagó, y lo del equipo el día que se le pagó (no el mes que se ganó)."
            formula={"Entró = lo cobrado\nSalió = gastos pagados + pagos al equipo + procesadores + devoluciones + retiros\nQuedó = entró − salió"}
            componentes={() => [
              { concepto: "Cobrado", valor: M(flujo.entro, 2), signo: "+" },
              ...flujo.partes.filter((p) => Math.abs(p.monto) >= 0.005).map((p) => ({ concepto: p.nombre, valor: M(p.monto, 2), signo: "−" as const })),
              { concepto: flujo.neto >= 0 ? "Quedó" : "Faltó", valor: M(flujo.neto, 2), signo: "=" },
            ]}
          />
        </div>
        {!rangoFijo && (
          <Segmentado
            etiqueta="Período" valor={cual} onCambiar={setCual}
            opciones={[{ valor: "anterior", texto: mes(moverPeriodo(hoyP, -1)) }, { valor: "actual", texto: mes(hoyP) }]}
          />
        )}
      </div>
      <div className="sd-cifras">
        <Cifra etiqueta="Entró" valor={M(flujo.entro)} />
        <Cifra etiqueta="Salió" valor={M(flujo.salio)} />
        <Cifra etiqueta={flujo.neto >= 0 ? "Quedó" : "Faltó"} valor={M(flujo.neto)} tono={flujo.neto >= 0 ? "bien" : "mal"} />
      </div>
      <Cascada pasos={pasos} etiqueta="Lo que entró, lo que salió y lo que quedó" />
    </Card>
  );
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "bien" | "mal" }) {
  return (
    <div className="sd-cifra">
      <span className="sd-cifra__etiqueta">{etiqueta}</span>
      <span className="sd-cifra__valor" data-tono={tono}>{valor}</span>
    </div>
  );
}
