"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { CabeceraVista } from "@/components/finanzas/vistas/CabeceraVista";
import { CopiarLink } from "@/components/ui/Filtros";
import { Button, Card } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { Plegable, Segmentado } from "@/components/finanzas/visual/visual";
import { money } from "@/lib/format";
import { flujoDeFondos, type FlujoDeFondos, type MovimientoFuturo } from "@/lib/flujo-fondos";
import { nombrePeriodo } from "@/lib/periodos";
import { saldosPorCuenta } from "@/lib/saldos-vista";
import { useEstado } from "@/lib/store";
import { useSaldosReales } from "@/lib/useSaldosReales";
import "./saldos-vista.css";
import "./flujo-fondos.css";

/* ==================================================================
   Flujo de fondos: cuánta plata hay para operar hoy y cómo sigue con lo que se sabe que entra y sale. Las reglas están en
   lib/flujo-fondos.ts; acá sólo se dibuja.
   ================================================================== */

const HORIZONTES = [{ valor: "30", texto: "30 días" }, { valor: "60", texto: "60 días" }, { valor: "90", texto: "90 días" }] as const;
type Horizonte = (typeof HORIZONTES)[number]["valor"];
const DIAS_DE_LA_LISTA = 14;

const corta = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const conDia = (dia: string) => `${SEMANA[new Date(`${dia}T12:00:00.000Z`).getUTCDay()]} ${corta(dia)}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`.replace(".", ",");

export function FlujoVista() {
  const e = useEstado();
  const router = useRouter();
  const lectura = useSaldosReales();
  const base = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, base, d);
  const [horizonte, setHorizonte] = useState<Horizonte>("30");
  const [cuotas, setCuotas] = useState<"todas" | "ponderadas">("todas");
  const ahoraIso = useMemo(() => lectura.cuando ?? new Date().toISOString(), [lectura.cuando]);
  const vista = useMemo(() => saldosPorCuenta(e, lectura.resp?.saldos ?? [], ahoraIso), [e, lectura.resp, ahoraIso]);
  const f = useMemo(
    () => flujoDeFondos(e, vista.cuentas, ahoraIso, { dias: Number(horizonte), ponderar: cuotas === "ponderadas" }),
    [e, vista, ahoraIso, horizonte, cuotas],
  );
  const s = f.supuestos;

  return (
    <div className="stack-5">
      <CabeceraVista embebido={false} titulo="Flujo de fondos"
        izquierda={<Segmentado etiqueta="Hasta" valor={horizonte} onCambiar={setHorizonte} opciones={[...HORIZONTES]} />}
        acciones={
          <>
            <CopiarLink variante="ghost" />
            <Button sm variante="ghost" icono={<Landmark size={15} />} onClick={() => router.push("/finanzas/saldos")}>Ver los saldos</Button>
          </>
        }
      />

      <section className="fz-hero" aria-label="Plata disponible">
        <div>
          <span className="fz-hero__etiqueta">
            Disponible hoy
            <InfoMetrica
              titulo="Disponible hoy"
              ayuda="La plata de los bancos y de las pasarelas que transfieren solas a los bancos: Whop todos los días, Stripe cada 1 a 3 días hábiles y Hotmart una vez por mes. Es el mismo saldo de la pantalla Saldos."
              componentes={() => [
                ...f.cuentasDisponibles.map((c) => ({ concepto: c.nombre, valor: M(c.saldoBase!, 2), signo: "+" as const })),
                { concepto: "Disponible", valor: M(f.disponible, 2), signo: "=" as const },
              ]}
            />
          </span>
          <span className="fz-hero__valor">{M(f.disponible)}</span>
          <p className="fz-hero__sub">En los bancos y las pasarelas que transfieren solas</p>
          {f.aparte !== 0 && (
            <p className="fz-hero__sub" title={f.cuentasAparte.map((c) => `${c.nombre}: ${M(c.saldoBase!)}`).join("\n")}>
              Aparte: <b>{M(f.aparte)}</b> en {f.cuentasAparte.map((c) => c.nombre).join(", ")}
            </p>
          )}
        </div>
        <div className="fz-hero__der">
          <div className="sd-cifras ff-cifras">
            <Cifra etiqueta={`En ${horizonte} días`} valor={M(f.final)} sub={`el ${conDia(f.hasta)}`} tono={f.final < 0 ? "mal" : undefined} />
            <Cifra etiqueta="El día más justo" valor={M(f.minimo.saldo)} sub={f.minimo.dia === f.hoy ? "hoy" : `el ${conDia(f.minimo.dia)}`} tono={f.minimo.saldo < 0 ? "mal" : undefined} />
            <Cifra etiqueta="Entra y sale" valor={`+${M(f.entra)}`} sub={`−${M(f.sale)}`} />
          </div>
          {f.minimo.saldo < 0 && (
            <p className="ff-alerta">Con lo que se sabe hoy, la plata disponible no alcanza el {conDia(f.minimo.dia)}: faltan {M(-f.minimo.saldo)}. Puede cubrirse con lo que está aparte o con ventas nuevas, que acá no se cuentan.</p>
          )}
        </div>
      </section>

      <Card>
        <div className="fz-cabtabla fz-cabtabla--suelta">
          <div className="fz-cabtabla__tit"><h2 className="card-head__title">Cómo sigue la plata disponible</h2></div>
          <Segmentado
            etiqueta="Cuotas" valor={cuotas} onCambiar={setCuotas}
            opciones={[
              { valor: "todas", texto: "Todas las cuotas" },
              ...(s.tasaDeCobro !== null ? [{ valor: "ponderadas" as const, texto: `Lo que se cobra (${pct(s.tasaDeCobro)})` }] : []),
            ]}
          />
        </div>
        <Grafico f={f} M={M} />
      </Card>

      <div className="ff-dos">
        <Card>
          <h2 className="card-head__title ff-titulo">Semana por semana</h2>
          <div className="ff-tabla__marco"><table className="ff-tabla">
            <thead><tr><th>Semana</th><th>Entra</th><th>Sale</th><th>Queda</th></tr></thead>
            <tbody>
              {f.semanas.map((w) => (
                <tr key={w.desde}>
                  <td>{corta(w.desde)} al {corta(w.hasta)}</td>
                  <td className="ff-entra">{w.entra ? `+${M(w.entra)}` : "—"}</td>
                  <td className="ff-sale">{w.sale ? `−${M(w.sale)}` : "—"}</td>
                  <td data-tono={w.saldo < 0 ? "mal" : undefined}>{M(w.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        <Card>
          <h2 className="card-head__title ff-titulo">Los próximos {DIAS_DE_LA_LISTA} días</h2>
          <Proximos f={f} M={M} />
        </Card>
      </div>

      <Card>
        <Plegable titulo="Cómo se arma" resumen="Qué entra, qué sale y qué queda afuera">
          <ul className="ff-supuestos">
            <li><b>Cuotas:</b> entran el día que vencen, menos la comisión promedio de las pasarelas de {nombrePeriodo(s.mesBase)} ({pct(s.comision)}).
              {s.ponderado ? ` Cuenta sólo la parte que se suele cobrar (${pct(s.tasaDeCobro!)}, medido con las cuotas que vencieron hace entre 15 y 105 días).` : " Cuentan completas."}
              {s.vencidas.cuotas > 0 && ` Hay ${s.vencidas.cuotas} cuotas vencidas sin cobrar por ${M(s.vencidas.monto)}: no se cuentan, porque no se sabe cuándo entran.`}</li>
            <li><b>Hotmart:</b> retiene 15 días cada cobro; entra el día que lo acredita.</li>
            <li><b>Gastos:</b> sale lo mismo que salió en {nombrePeriodo(s.mesBase)}, el mismo día de cada mes (sin los retiros del dueño). La tarjeta de Mercury se paga a diario por lo gastado, así que cuenta el día del cargo.
              {s.salidasDelMesBase.length > 0 && (
                <span className="ff-categorias">{s.salidasDelMesBase.map((x) => `${x.categoria} ${M(x.monto)}`).join(" · ")}</span>
              )}</li>
            <li><b>Publicidad de Meta:</b> {s.publicidadDiaria > 0 ? `${M(s.publicidadDiaria)} por día, al ritmo de los últimos 7 días.` : "en los últimos 7 días no hubo, así que no se proyecta."}</li>
            <li><b>No se cuentan:</b> las ventas nuevas (es lo que pasa si no se vende nada más), la plata que está aparte (la Financiera, dLocal, USDT, el efectivo) y lo que la Financiera vaya a pagar: todavía no se sabe cuándo.</li>
          </ul>
        </Plegable>
      </Card>
    </div>
  );
}

function Cifra({ etiqueta, valor, sub, tono }: { etiqueta: string; valor: string; sub?: string; tono?: "mal" }) {
  return (
    <div className="sd-cifra">
      <span className="sd-cifra__etiqueta">{etiqueta}</span>
      <span className="sd-cifra__valor" data-tono={tono}>{valor}</span>
      {sub && <span className="ff-cifra__sub">{sub}</span>}
    </div>
  );
}

/* ---------- El gráfico: el saldo disponible de cada día ---------- */

const ANCHO = 720, ALTO = 180;

function Grafico({ f, M }: { f: FlujoDeFondos; M: (n: number) => string }) {
  const saldos = f.dias.map((d) => d.saldo);
  const arriba = Math.max(...saldos, 0), abajo = Math.min(...saldos, 0);
  const rango = arriba - abajo || 1;
  const x = (i: number) => (f.dias.length > 1 ? (i / (f.dias.length - 1)) * ANCHO : 0);
  const y = (v: number) => ALTO - ((v - abajo) / rango) * ALTO;
  const linea = f.dias.map((d, i) => `${x(i).toFixed(1)},${y(d.saldo).toFixed(1)}`).join(" ");
  const iMin = f.dias.findIndex((d) => d.dia === f.minimo.dia);
  const medio = f.dias[Math.floor(f.dias.length / 2)];
  return (
    <figure className="ff-grafico" aria-label={`El saldo disponible va de ${M(f.disponible)} hoy a ${M(f.final)} el ${corta(f.hasta)}; el día más justo es el ${corta(f.minimo.dia)} con ${M(f.minimo.saldo)}`}>
      <div className="ff-grafico__ejes">
        <span>{M(arriba)}</span>
        <span>{M(abajo)}</span>
      </div>
      <div className="ff-grafico__lienzo">
        <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" role="presentation">
          <polygon className="ff-grafico__area" points={`0,${y(0)} ${linea} ${ANCHO},${y(0)}`} />
          {abajo < 0 && <line className="ff-grafico__cero" x1="0" x2={ANCHO} y1={y(0)} y2={y(0)} />}
          <polyline className="ff-grafico__linea" points={linea} />
        </svg>
        {iMin >= 0 && (
          <span className="ff-grafico__punto" data-tono={f.minimo.saldo < 0 ? "mal" : undefined}
            style={{ left: `${(x(iMin) / ANCHO) * 100}%`, top: `${(y(f.minimo.saldo) / ALTO) * 100}%` }}
            title={`El día más justo: ${conDia(f.minimo.dia)}, ${M(f.minimo.saldo)}`} />
        )}
      </div>
      <figcaption className="ff-grafico__fechas">
        <span>Hoy</span><span>{corta(medio.dia)}</span><span>{corta(f.hasta)}</span>
      </figcaption>
    </figure>
  );
}

/* ---------- La lista de lo que viene ---------- */

function Proximos({ f, M }: { f: FlujoDeFondos; M: (n: number) => string }) {
  const tope = f.dias[Math.min(DIAS_DE_LA_LISTA, f.dias.length - 1)].dia;
  const lista = f.movimientos.filter((m) => m.tipo !== "publicidad" && m.dia <= tope);
  const porDia = new Map<string, MovimientoFuturo[]>();
  for (const m of lista) porDia.set(m.dia, [...(porDia.get(m.dia) ?? []), m]);
  return (
    <div className="ff-proximos">
      {f.supuestos.publicidadDiaria > 0 && <p className="ff-pub">Además, todos los días: Publicidad de Meta −{M(f.supuestos.publicidadDiaria)}</p>}
      {porDia.size === 0 ? <p className="t-sm t-muted">Nada más en estos días.</p> : [...porDia].map(([dia, ms]) => (
        <div key={dia} className="ff-dia">
          <span className="ff-dia__fecha">{conDia(dia)}</span>
          <ul>
            {ms.map((m, i) => (
              <li key={i}>
                <span className="ff-dia__concepto">{m.concepto}{m.detalle && <small> · {m.detalle}</small>}</span>
                <span className={m.monto >= 0 ? "ff-entra" : "ff-sale"}>{m.monto >= 0 ? `+${M(m.monto)}` : `−${M(-m.monto)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
