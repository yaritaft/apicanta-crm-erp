"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { ModalForm } from "@/components/ui/Modal";
import { Badge, Button, Chip } from "@/components/ui/ui";
import { acciones, nuevoId } from "@/lib/store";
import { isoDia, money } from "@/lib/format";
import {
  adivinarColumnas, armarFilas, CAMPOS_MASIVOS, catalogoDe, clavesCargadas, gastosDeFilas, leerFecha, parsearPegado, problemasDeFila,
  resumenDeFilas, tieneTitulos, yaEstaCargada, type CampoMasivo, type FilaMasiva,
} from "@/lib/gastos-masivos";
import type { EstadoApp, Moneda } from "@/lib/types";

/* ==================================================================
   Cargar varios gastos de una vez, pegando las filas de una planilla.

   Aldana (20/10): «son más de 100 egresos desde el 7, unos 30 consumos por
   día, y cargar tantos campos uno por uno toma horas». Se copian las filas
   de Excel y se pegan; la app lee las columnas, propone categoría y
   proveedor, marca lo que ya estaba cargado y deja corregir todo en una
   grilla (escribís encima, como en una hoja) antes de cargar. Se puede
   deshacer la carga entera. Las reglas están en lib/gastos-masivos.ts.
   ================================================================== */

type Filtro = "todas" | "problemas" | "ya" | "cargar";

const diaAr = (iso: string) => iso.split("-").reverse().join("/");

/* Una fecha escrita como se escribe acá: se lee al salir de la celda. */
function CeldaFecha({ valor, mal, onCambio, etiqueta }: { valor: string; mal: boolean; onCambio: (iso: string) => void; etiqueta: string }) {
  const [texto, setTexto] = useState(valor ? diaAr(valor) : "");
  const ultimo = useRef(valor);
  useEffect(() => { if (valor !== ultimo.current) { ultimo.current = valor; setTexto(valor ? diaAr(valor) : ""); } }, [valor]);
  return (
    <input
      className={`gm-celda${mal ? " gm-celda--mal" : ""}`} value={texto} placeholder="dd/mm/aaaa" aria-label={etiqueta} inputMode="numeric"
      onChange={(ev) => setTexto(ev.target.value)}
      onBlur={() => { const iso = leerFecha(texto) ?? ""; ultimo.current = iso; onCambio(iso); if (iso) setTexto(diaAr(iso)); }}
    />
  );
}

export function CargaDeGastosMasiva({ e, onCerrar, onListo }: {
  e: EstadoApp;
  onCerrar: () => void;
  onListo: (r: { loteId: string; cargados: number }) => void;
}) {
  const base = e.ajustes.monedaBase;
  const [texto, setTexto] = useState("");
  const [titulosElegido, setTitulosElegido] = useState<boolean | null>(null);
  const [mapaElegido, setMapaElegido] = useState<(CampoMasivo | null)[] | null>(null);
  const [moneda, setMoneda] = useState<Moneda>(base);
  const [cuentaPorDefecto, setCuentaPorDefecto] = useState("");
  const [ediciones, setEdiciones] = useState<Record<string, Partial<FilaMasiva>>>({});
  const [manuales, setManuales] = useState<FilaMasiva[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [categoriaMasiva, setCategoriaMasiva] = useState("");

  const tabla = useMemo(() => parsearPegado(texto), [texto]);
  const conTitulos = titulosElegido ?? tieneTitulos(tabla);
  const mapaAuto = useMemo(() => adivinarColumnas(tabla, conTitulos), [tabla, conTitulos]);
  const mapa = mapaElegido && mapaElegido.length === mapaAuto.length ? mapaElegido : mapaAuto;

  const catalogo = useMemo(() => catalogoDe(e), [e]);
  const categorias = useMemo(() => [...catalogo.values()], [catalogo]);
  const cargadas = useMemo(() => clavesCargadas(e), [e]);

  /* Cada vez que se pega otra cosa o se cambia qué es cada columna, se vuelve a leer y lo editado se descarta. */
  const leidas = useMemo(
    () => (tabla.length ? armarFilas(tabla, mapa, conTitulos, { e, moneda, cuenta: cuentaPorDefecto }) : []),
    [tabla, mapa, conTitulos, e, moneda, cuentaPorDefecto],
  );
  useEffect(() => { setEdiciones({}); }, [texto, mapaElegido, titulosElegido]);

  const filas: FilaMasiva[] = useMemo(
    () => [...leidas, ...manuales].map((f) => {
      const x = { ...f, ...ediciones[f.id] };
      return { ...x, yaCargada: yaEstaCargada(x, cargadas) };
    }),
    [leidas, manuales, ediciones, cargadas],
  );
  const problemas = useMemo(() => new Map(filas.map((f) => [f.id, problemasDeFila(f, e, catalogo)] as const)), [filas, e, catalogo]);
  const resumen = useMemo(() => resumenDeFilas(filas, e, catalogo), [filas, e, catalogo]);

  const visibles = useMemo(() => filas.filter((f) => {
    const mal = Object.keys(problemas.get(f.id) ?? {}).length > 0;
    if (filtro === "problemas") return f.incluir && mal;
    if (filtro === "ya") return f.yaCargada;
    if (filtro === "cargar") return f.incluir && !mal;
    return true;
  }), [filas, problemas, filtro]);

  const sinCategoria = filas.filter((f) => f.incluir && !f.categoria.trim());
  /* Lo escrito en una fila leída se descarta al volver a leer la planilla; las filas agregadas a mano no. */
  const editar = (id: string, cambios: Partial<FilaMasiva>) => {
    if (id.startsWith("m")) setManuales((m) => m.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
    else setEdiciones((prev) => ({ ...prev, [id]: { ...prev[id], ...cambios } }));
  };
  const agregarFila = () => {
    const n = manuales.length + 1;
    setManuales((m) => [...m, {
      id: `m${n}`, incluir: true, fecha: isoDia(new Date().toISOString()), concepto: "", proveedor: "", categoria: "", monto: "", moneda,
      cuenta: cuentaPorDefecto, notas: "", ingreso: false, yaCargada: false,
    }]);
    setFiltro("todas");
  };

  /* Las cuentas que ya se usaron, para escribir una sin errores de tipeo. */
  const cuentas = useMemo(() => {
    const s = new Set<string>(e.procesadores.map((p) => p.nombre));
    for (const g of e.gastos) { const c = typeof g.extra?.cuenta === "string" ? g.extra.cuenta.trim() : ""; if (c) s.add(c); }
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [e]);

  const columnas = Math.max(0, ...tabla.map((f) => f.length));
  const muestra = (i: number) => tabla.slice(conTitulos ? 1 : 0, conTitulos ? 4 : 3).map((f) => f[i] ?? "").filter(Boolean).join(" · ");
  const ponerCampo = (i: number, campo: CampoMasivo | null) => {
    const m = [...mapa];
    if (campo) m.forEach((c, j) => { if (c === campo && j !== i) m[j] = null; });
    m[i] = campo;
    setMapaElegido(m);
  };

  function cargar() {
    if (resumen.aCargar === 0) return;
    const loteId = nuevoId("lote");
    const datos = gastosDeFilas(filas, e, loteId);
    const r = acciones.cargarGastosEnLote(datos, loteId);
    onListo({ loteId: r.loteId, cargados: r.ids.length });
  }

  const M = (n: number) => money(n, base, 0);
  const hayAlgo = filas.length > 0;

  /* Enter en una celda no carga todo: baja a la de abajo, como en una hoja. */
  const alApretar = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    const t = ev.target as HTMLElement;
    if (ev.key !== "Enter" || ev.shiftKey || !(t instanceof HTMLInputElement || t instanceof HTMLSelectElement) || (t instanceof HTMLInputElement && t.type === "checkbox")) return;
    ev.preventDefault();
    const celda = t.closest("td");
    const fila = celda?.parentElement;
    if (!celda || !fila) return;
    const i = Array.from(fila.children).indexOf(celda);
    (fila.nextElementSibling?.children[i]?.querySelector("input, select") as HTMLElement | null)?.focus();
  };

  return (
    <ModalForm
      abierto xl onCerrar={onCerrar} onGuardar={cargar} puedeGuardar={resumen.aCargar > 0}
      guardarTexto={resumen.aCargar === 1 ? "Cargar 1 gasto" : `Cargar ${resumen.aCargar} gastos`}
      titulo="Cargar varios gastos"
      sub="Copiá las filas de tu planilla (Excel o Google Sheets) y pegalas acá. Revisás todo antes de cargar y después se puede deshacer."
    >
      <div className="gm-raiz" onKeyDown={alApretar}>
      <div className="stack-2">
        <textarea
          className="gm-pegar" rows={tabla.length ? 2 : 5} value={texto} autoFocus aria-label="Pegá acá las filas de tu planilla"
          placeholder={"Pegá acá las filas copiadas de Excel.\nPor ejemplo:\n07/10/2026\tUber del aeropuerto\t12,50\n08/10/2026\tNotion\t20,00"}
          onChange={(ev) => { setTexto(ev.target.value); setTitulosElegido(null); setMapaElegido(null); }}
        />
        {tabla.length > 0 && (
          <p className="t-sm t-muted" role="status">
            Leí {tabla.length - (conTitulos ? 1 : 0)} {tabla.length - (conTitulos ? 1 : 0) === 1 ? "fila" : "filas"} y {columnas} {columnas === 1 ? "columna" : "columnas"}.
            Las fechas se leen día/mes (07/10 es el 7 de octubre).
          </p>
        )}
      </div>

      {tabla.length > 0 && (
        <div className="stack-2">
          <div className="row-wrap" style={{ alignItems: "center", gap: 12 }}>
            <span className="t-label">¿Qué es cada columna?</span>
            <label className="gm-check">
              <input type="checkbox" checked={conTitulos} onChange={(ev) => setTitulosElegido(ev.target.checked)} />
              <span>La primera fila son los títulos</span>
            </label>
          </div>
          <div className="gm-columnas">
            {Array.from({ length: columnas }, (_, i) => (
              <div key={i} className="gm-columna">
                <select className="gm-celda" aria-label={`Qué es la columna ${i + 1}`} value={mapa[i] ?? ""} onChange={(ev) => ponerCampo(i, (ev.target.value || null) as CampoMasivo | null)}>
                  <option value="">No usar</option>
                  {CAMPOS_MASIVOS.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                </select>
                <span className="gm-columna__muestra truncate" title={muestra(i)}>{muestra(i) || "—"}</span>
              </div>
            ))}
          </div>
          <div className="row-wrap" style={{ alignItems: "center", gap: 12 }}>
            <label className="gm-check">
              <span>Moneda si la planilla no la dice</span>
              <select className="gm-celda gm-celda--corta" aria-label="Moneda de la planilla" value={moneda} onChange={(ev) => setMoneda(ev.target.value as Moneda)}>
                <option value="USD">USD</option><option value="ARS">ARS</option>
              </select>
            </label>
            <label className="gm-check">
              <span>Cuenta si no la dice</span>
              <input className="gm-celda" list="gm-cuentas" aria-label="Cuenta por defecto" value={cuentaPorDefecto} placeholder="Mercury, USDT Trust…" onChange={(ev) => setCuentaPorDefecto(ev.target.value)} />
            </label>
          </div>
        </div>
      )}

      {(hayAlgo || tabla.length === 0) && (
        <div className="stack-2">
          <div className="row-wrap" style={{ alignItems: "center", gap: 8 }}>
            <Chip activo={filtro === "todas"} onClick={() => setFiltro("todas")} count={filas.length}>Todas</Chip>
            <Chip activo={filtro === "cargar"} onClick={() => setFiltro("cargar")} count={resumen.aCargar}>Para cargar</Chip>
            <Chip activo={filtro === "problemas"} onClick={() => setFiltro("problemas")} count={resumen.conProblemas}>Con problemas</Chip>
            <Chip activo={filtro === "ya"} onClick={() => setFiltro("ya")} count={filas.filter((f) => f.yaCargada).length}>Ya cargadas</Chip>
            <span className="spacer" />
            <Button sm variante="ghost" icono={<Plus size={14} />} onClick={agregarFila}>Agregar una fila</Button>
          </div>
          {sinCategoria.length > 0 && (
            <div className="row-wrap" style={{ alignItems: "center", gap: 8 }}>
              <span className="t-sm t-muted">{sinCategoria.length} {sinCategoria.length === 1 ? "fila sin categoría" : "filas sin categoría"}:</span>
              <select className="gm-celda gm-celda--media" aria-label="Categoría para las filas sin categoría" value={categoriaMasiva} onChange={(ev) => setCategoriaMasiva(ev.target.value)}>
                <option value="">Elegí una categoría</option>
                {categorias.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
              </select>
              <Button sm variante="secondary" disabled={!categoriaMasiva}
                onClick={() => { for (const f of sinCategoria) editar(f.id, { categoria: categoriaMasiva }); setCategoriaMasiva(""); }}>
                Ponérsela a esas filas
              </Button>
            </div>
          )}

          <div className="gm-tabla" role="region" aria-label="Los gastos a cargar" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th aria-label="Cargar"></th><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th>Categoría</th><th className="gm-num">Monto</th><th>Moneda</th><th>Cuenta</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f, i) => {
                  const p = problemas.get(f.id) ?? {};
                  const mal = Object.keys(p).length > 0;
                  const n = f.id.replace(/\D/g, "") || String(i + 1);
                  return (
                    <tr key={f.id} className={`${f.incluir ? "" : "gm-fila--fuera"}${f.incluir && mal ? " gm-fila--mal" : ""}`}>
                      <td><input type="checkbox" checked={f.incluir} aria-label={`Cargar la fila ${n}`} onChange={(ev) => editar(f.id, { incluir: ev.target.checked })} /></td>
                      <td><CeldaFecha valor={f.fecha} mal={f.incluir && Boolean(p.fecha)} etiqueta={`Fecha de la fila ${n}`} onCambio={(iso) => editar(f.id, { fecha: iso })} /></td>
                      <td><input className={`gm-celda${f.incluir && p.concepto ? " gm-celda--mal" : ""}`} aria-label={`Concepto de la fila ${n}`} value={f.concepto} onChange={(ev) => editar(f.id, { concepto: ev.target.value })} /></td>
                      <td><input className={`gm-celda${f.incluir && p.proveedor ? " gm-celda--mal" : ""}`} aria-label={`Proveedor de la fila ${n}`} value={f.proveedor} onChange={(ev) => editar(f.id, { proveedor: ev.target.value })} /></td>
                      <td>
                        <select className={`gm-celda${f.incluir && p.categoria ? " gm-celda--mal" : ""}`} aria-label={`Categoría de la fila ${n}`} value={f.categoria} onChange={(ev) => editar(f.id, { categoria: ev.target.value })}>
                          <option value="">Elegí una</option>
                          {f.categoria && !catalogo.has(f.categoria) && <option value={f.categoria}>{f.categoria}</option>}
                          {categorias.map((c) => <option key={c.categoria} value={c.categoria}>{c.categoria}</option>)}
                        </select>
                      </td>
                      <td className="gm-num">
                        <input className={`gm-celda gm-celda--num${f.incluir && p.monto ? " gm-celda--mal" : ""}`} aria-label={`Monto de la fila ${n}`} inputMode="decimal" value={f.monto} onChange={(ev) => editar(f.id, { monto: ev.target.value })} />
                      </td>
                      <td>
                        <select className="gm-celda gm-celda--corta" aria-label={`Moneda de la fila ${n}`} value={f.moneda} onChange={(ev) => editar(f.id, { moneda: ev.target.value as Moneda })}>
                          <option value="USD">USD</option><option value="ARS">ARS</option>
                        </select>
                      </td>
                      <td><input className="gm-celda" list="gm-cuentas" aria-label={`Cuenta de la fila ${n}`} value={f.cuenta} onChange={(ev) => editar(f.id, { cuenta: ev.target.value })} /></td>
                      <td className="gm-estado">
                        {f.yaCargada ? <Badge variante="neutral">Ya cargada</Badge>
                          : f.ingreso ? <Badge variante="success">Ingreso</Badge>
                            : f.incluir && mal ? <span className="gm-problema" title={Object.values(p).join(" · ")}>{Object.values(p)[0]}</span>
                              : f.incluir ? <span className="t-subtle">Lista</span> : <span className="t-subtle">Afuera</span>}
                      </td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={9} className="gm-vacia">{hayAlgo ? "Ninguna fila para este filtro." : "Pegá las filas arriba, o tocá «Agregar una fila» para escribir una."}</td></tr>
                )}
              </tbody>
            </table>
            <datalist id="gm-cuentas">{cuentas.map((c) => <option key={c} value={c} />)}</datalist>
          </div>

          {hayAlgo && (
            <p className="t-sm" role="status" style={{ margin: 0 }}>
              <strong>{resumen.aCargar === 1 ? "1 gasto para cargar" : `${resumen.aCargar} gastos para cargar`}</strong>
              {resumen.aCargar > 0 && <> · {M(resumen.gastosTotal)} en gastos{resumen.ingresos > 0 ? ` y ${M(resumen.ingresosTotal)} que ${resumen.ingresos === 1 ? "volvió" : "volvieron"}` : ""}</>}
              {resumen.yaCargadas > 0 && <span className="t-muted"> · {resumen.yaCargadas} ya {resumen.yaCargadas === 1 ? "estaba cargada" : "estaban cargadas"}, quedan afuera</span>}
              {resumen.conProblemas > 0 && <span style={{ color: "var(--warning)" }}> · {resumen.conProblemas} con problemas no se {resumen.conProblemas === 1 ? "carga" : "cargan"}: corregilas o sacalas</span>}
            </p>
          )}
        </div>
      )}
      </div>
    </ModalForm>
  );
}
