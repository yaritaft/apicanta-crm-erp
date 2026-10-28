"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Badge, Button, Card, Chip } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { fecha } from "@/lib/format";
import { corteDe, plata, rangoDePeriodo } from "@/lib/honorarios";
import { esPagoDeEquipo, gastosDelMes } from "@/lib/finanzas";
import { pagosSospechosos, type PagoSospechoso } from "@/lib/pagos-equipo";
import type { EstadoApp, Gasto, ResultadoLiquidacion } from "@/lib/types";

/* ==================================================================
   «Gastos que cuentan en los costos del mes».

   El profit de quienes cobran sobre él (Agus, Nahue) sale de los gastos que hay en Finanzas. Acá se ven todos, uno por uno, y se marcan los que
   son el pago de un sueldo o una comisión que la liquidación (o las comisiones que Finanzas calcula de las ventas) ya cuenta: si no, el mismo
   costo suma dos veces. (Aldana, 27/10: «hay cerca de 10k de diferencia con mi cuenta; quizás hay algo duplicado».)

   Marcar no borra nada: el gasto sigue en la caja, en Transacciones y en el arqueo. Sólo deja de sumar como costo.
   ================================================================== */

const diaISO = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const diaCorto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Filtro = "todos" | "sospechosos" | "marcados";

export function GastosQueCuentan({ e, periodo, r, soloMirar }: { e: EstadoApp; periodo: string; r: ResultadoLiquidacion; soloMirar: boolean }) {
  const toast = useToast();
  const base = e.ajustes.monedaBase;
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());

  const datos = useMemo(() => {
    const rango = rangoDePeriodo(periodo);
    const hasta = r.corte ?? undefined;
    const corte = corteDe(periodo, r.corte);
    /* Lo que el motor toma: hasta el corte (si hay), sin lo que cargó esta misma liquidación al cerrar ni los honorarios del CEO. */
    const delMes = gastosDelMes(e, rango).filter((g) => g.grupo !== "dueno" && g.grupo !== "retiro" && !g.extra?.liquidacionId);
    const sospechas = new Map<string, PagoSospechoso>(pagosSospechosos(e, r, rango).map((s) => [s.gasto.id, s]));
    const despues = (g: Gasto) => Boolean(hasta && corte && diaISO(g.fecha) > hasta);
    const filas = [...delMes].sort((a, b) => a.categoria.localeCompare(b.categoria, "es") || +new Date(a.fecha) - +new Date(b.fecha));
    const cuentan = filas.filter((g) => !despues(g) && !esPagoDeEquipo(g));
    const marcados = filas.filter((g) => esPagoDeEquipo(g));
    const sosp = filas.filter((g) => sospechas.has(g.id));
    const suma = (xs: Gasto[]) => r2(xs.reduce((a, g) => a + g.monto, 0));
    return {
      filas, sospechas, despues,
      cuentan: { n: cuentan.length, total: suma(cuentan) },
      marcados: { n: marcados.length, total: suma(marcados) },
      sospechosos: { n: sosp.length, total: suma(sosp), antes: suma(sosp.filter((g) => !despues(g))) },
    };
  }, [e, periodo, r]);

  const visibles = datos.filas.filter((g) => (filtro === "todos" ? true : filtro === "marcados" ? esPagoDeEquipo(g) : datos.sospechas.has(g.id)));
  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const aMarcar = [...elegidos].filter((id) => { const g = datos.filas.find((x) => x.id === id); return g && !esPagoDeEquipo(g); });
  const aDesmarcar = [...elegidos].filter((id) => { const g = datos.filas.find((x) => x.id === id); return g && esPagoDeEquipo(g); });

  function marcar(ids: string[], si: boolean) {
    const n = acciones.marcarPagosDeEquipo(ids, si);
    setElegidos(new Set());
    toast(
      n === 0 ? "No cambió nada." : si
        ? `${n === 1 ? "Un gasto" : `${n} gastos`} marcado${n === 1 ? "" : "s"} como pago al equipo: ya no suma${n === 1 ? "" : "n"} como costo.`
        : `${n === 1 ? "Un gasto vuelve" : `${n} gastos vuelven`} a sumar como costo.`,
    );
  }
  function elegirSospechosos() {
    setFiltro("sospechosos");
    setAbierto(true);
    setElegidos(new Set(datos.filas.filter((g) => datos.sospechas.has(g.id) && !esPagoDeEquipo(g)).map((g) => g.id)));
  }
  async function copiar() {
    const estado = (g: Gasto) => esPagoDeEquipo(g) ? "Pago al equipo (no suma)" : datos.despues(g) ? "Después del corte" : datos.sospechas.has(g.id) ? `Parece pago a ${datos.sospechas.get(g.id)!.nombre}` : "Cuenta";
    const lineas = [["Fecha", "Categoría", "Gasto", "Proveedor", "Monto", "Estado"].join("\t")];
    for (const g of visibles) lineas.push([g.fecha.slice(0, 10), g.categoria, g.concepto, g.proveedor ?? "", g.monto.toFixed(2), estado(g)].join("\t"));
    try { await navigator.clipboard.writeText(lineas.join("\n")); toast(`Copiados ${visibles.length} gastos: pegalos en una planilla.`); }
    catch { toast("No pude copiar. Probá de nuevo.", "err"); }
  }

  if (datos.filas.length === 0) return null;
  const hasta = r.corte ? ` hasta el ${diaCorto(r.corte)}` : "";

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div className="pyl-head">
        <div className="pyl-head__texto">
          <h3 className="card-head__title">Gastos que cuentan en los costos del mes</h3>
          <p className="card-head__sub">
            El profit de quienes cobran sobre él sale de estos gastos. Si alguno es el pago de un sueldo o una comisión que la liquidación ya cuenta,
            marcalo para que no sume dos veces: sigue en la caja y en Transacciones.
          </p>
        </div>
        <Button sm variante="ghost" icono={abierto ? <ChevronUp size={15} /> : <ChevronDown size={15} />} onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Ocultar los gastos" : `Ver los ${datos.filas.length} gastos`}
        </Button>
      </div>

      <div className="gq__resumen">
        <div><span className="t-label">Cuentan{hasta}</span><b>{plata(datos.cuentan.total, base)}</b><span className="t-sm t-subtle">{datos.cuentan.n} gastos</span></div>
        {datos.marcados.n > 0 && (
          <div><span className="t-label">Marcados: no suman</span><b>{plata(datos.marcados.total, base)}</b><span className="t-sm t-subtle">{datos.marcados.n} {datos.marcados.n === 1 ? "pago" : "pagos"} al equipo</span></div>
        )}
        {datos.sospechosos.n > 0 && (
          <div className="gq__alerta">
            <span className="t-label">Parecen pagos al equipo</span><b>{plata(datos.sospechosos.total, base)}</b>
            <span className="t-sm">{datos.sospechosos.n} {datos.sospechosos.n === 1 ? "gasto" : "gastos"} sin marcar</span>
          </div>
        )}
      </div>

      {datos.sospechosos.n > 0 && !soloMirar && (
        <div className="gq__aviso" role="note">
          <AlertTriangle size={16} aria-hidden />
          <span>
            {datos.sospechosos.n === 1 ? "Hay un gasto que parece" : `Hay ${datos.sospechosos.n} gastos que parecen`} el pago de alguien de esta liquidación
            ({plata(datos.sospechosos.total, base)}). Si ya lo cuenta la liquidación, se cuenta dos veces: el profit baja de más y también lo que cobran Agus y Nahue.
          </span>
          <Button sm variante="secondary" onClick={elegirSospechosos}>Revisarlos</Button>
        </div>
      )}

      {abierto && (
        <div className="stack-3" style={{ padding: "0 var(--space-5) var(--space-5)" }}>
          <div className="row-wrap">
            <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={datos.filas.length}>Todos</Chip>
            <Chip activo={filtro === "sospechosos"} onClick={() => setFiltro("sospechosos")} count={datos.sospechosos.n}>Parecen pagos al equipo</Chip>
            <Chip activo={filtro === "marcados"} onClick={() => setFiltro("marcados")} count={datos.marcados.n}>Marcados</Chip>
            <span className="spacer" />
            <Button sm variante="ghost" icono={<Copy size={14} />} onClick={copiar}>Copiar la lista</Button>
          </div>

          {!soloMirar && elegidos.size > 0 && (
            <div className="row-wrap gq__acciones">
              <span className="t-sm">{elegidos.size} {elegidos.size === 1 ? "elegido" : "elegidos"}</span>
              {aMarcar.length > 0 && <Button sm variante="primary" onClick={() => marcar(aMarcar, true)}>Marcar {aMarcar.length} como pago al equipo</Button>}
              {aDesmarcar.length > 0 && <Button sm variante="secondary" onClick={() => marcar(aDesmarcar, false)}>Que {aDesmarcar.length === 1 ? "vuelva" : "vuelvan"} a sumar ({aDesmarcar.length})</Button>}
              <Button sm variante="ghost" onClick={() => setElegidos(new Set())}>Soltar</Button>
            </div>
          )}

          <div className="desglose__tabla desglose__tabla--larga">
            <table className="liq-lista">
              <thead>
                <tr>
                  {!soloMirar && <th scope="col" aria-label="Elegir" />}
                  <th scope="col">Fecha</th>
                  <th scope="col">Gasto</th>
                  <th scope="col">Categoría</th>
                  <th scope="col" className="liq-lista__num">Monto</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((g) => {
                  const marcado = esPagoDeEquipo(g);
                  const sosp = datos.sospechas.get(g.id);
                  const despues = datos.despues(g);
                  return (
                    <tr key={g.id} data-marcado={marcado ? true : undefined}>
                      {!soloMirar && (
                        <td>
                          <input type="checkbox" checked={elegidos.has(g.id)} onChange={() => alternar(g.id)} aria-label={`Elegir ${g.proveedor || g.concepto}`} />
                        </td>
                      )}
                      <td className="liq-lista__fecha">{fecha(g.fecha)}</td>
                      <td className="liq-lista__quien">
                        <span>{g.proveedor || g.concepto}</span>
                        {g.proveedor && g.concepto && g.concepto !== g.proveedor && <span className="liq-lista__sub">{g.concepto}</span>}
                      </td>
                      <td className="liq-lista__txt">{g.categoria}</td>
                      <td className="liq-lista__num">{plata(g.monto, g.moneda)}</td>
                      <td className="liq-lista__txt">
                        {marcado
                          ? <Badge variante="success">Pago al equipo · no suma</Badge>
                          : sosp
                            ? <span title={sosp.motivo === "nombre" ? "El nombre de la persona está en el gasto" : "El monto es lo que se le paga en esta liquidación"}><Badge variante="warning">Parece pago a {sosp.nombre.split(" ")[0]}</Badge></span>
                            : despues ? <span className="t-sm t-subtle">Después del corte</span> : <span className="t-sm t-subtle">Cuenta</span>}
                        {despues && (marcado || sosp) && <span className="liq-lista__sub">Después del corte</span>}
                      </td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr className="liq-lista__resto"><td colSpan={soloMirar ? 5 : 6}>No hay gastos con este filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
