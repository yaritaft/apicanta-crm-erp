"use client";

import React, { useMemo, useState } from "react";
import { TriangleAlert, Upload } from "lucide-react";
import { Button, Select } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { num } from "@/lib/format";
import { leerCSV } from "@/lib/pasarelas";
import { abrirXlsx } from "@/lib/xlsx";
import { hoyDelNegocio } from "@/lib/seguimiento";
import {
  adivinarMapeoCs, CAMPOS_DE, detectarTipo, faltaParaImportar, filaDeEncabezados, NOMBRE_TABLA_CS, planificarImportacionCs,
  type MapeoCs, type TablaImport, type TipoTablaCs,
} from "@/lib/importar-cs";

/* ==================================================================
   Importar el Airtable de Customer Success.

   Se suben las tablas que Lili lleva en su Airtable (Download CSV de cada una)
   o un Excel con todas. Cada hoja se reconoce sola por sus encabezados
   (Clientes, Testimonios, Agenda de resells, Reportes semanales) y la columna
   de cada dato se adivina; las dos cosas se pueden corregir. Antes de escribir
   se muestra qué va a entrar, qué ya estaba y qué se descarta, y por qué.
   Reimportar el mismo archivo no duplica. (lib/importar-cs.ts)
   ================================================================== */

interface HojaAbierta {
  id: number;
  nombre: string;
  /* Todas las filas, encabezados incluidos. */
  filas: string[][];
  tipo: TipoTablaCs | "ignorar";
  mapeo: MapeoCs;
  /* Cuántas filas de encabezado hay arriba del primero con datos. */
  cabecera: number;
}

const TIPOS: TipoTablaCs[] = ["clientes", "testimonios", "resells", "reportes"];

function abrirHoja(id: number, nombre: string, filas: string[][]): HojaAbierta {
  const cabecera = filaDeEncabezados(filas);
  const encabezados = (filas[cabecera] ?? []).map((x) => (x ?? "").trim());
  const { tipo } = detectarTipo(encabezados, nombre);
  return { id, nombre, filas, tipo: tipo ?? "ignorar", mapeo: tipo ? adivinarMapeoCs(CAMPOS_DE[tipo], encabezados) : {}, cabecera };
}

const comoTabla = (h: HojaAbierta): TablaImport | null => {
  if (h.tipo === "ignorar") return null;
  return {
    nombre: h.nombre, tipo: h.tipo, encabezados: (h.filas[h.cabecera] ?? []).map((x) => (x ?? "").trim()),
    filas: h.filas.slice(h.cabecera + 1), mapeo: h.mapeo,
  };
};

export function ImportarCs({ onCerrar }: { onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [hojas, setHojas] = useState<HojaAbierta[]>([]);
  const [modo, setModo] = useState<"completar" | "pisar">("completar");
  const [crearFaltantes, setCrearFaltantes] = useState(true);
  const [verMapeo, setVerMapeo] = useState<number | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  async function elegir(files: FileList) {
    setError(""); setLeyendo(true); setConfirmado(false);
    try {
      const abiertas: HojaAbierta[] = [];
      let id = hojas.length ? Math.max(...hojas.map((h) => h.id)) + 1 : 1;
      for (const f of Array.from(files)) {
        if (/\.(csv|tsv|txt)$/i.test(f.name)) {
          const filas = leerCSV(await f.text());
          if (filas.length > 1) abiertas.push(abrirHoja(id++, f.name.replace(/\.(csv|tsv|txt)$/i, ""), filas));
        } else {
          const libro = await abrirXlsx(await f.arrayBuffer());
          for (const nombre of libro.nombres) {
            const filas = await libro.hoja(nombre);
            if (filas && filas.length > 1) abiertas.push(abrirHoja(id++, nombre, filas));
          }
        }
      }
      if (abiertas.length === 0) throw new Error("No encontré hojas con datos en ese archivo.");
      setHojas((x) => [...x, ...abiertas]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  const tablas = useMemo(() => hojas.map(comoTabla).filter((t): t is TablaImport => t !== null), [hojas]);
  const faltas = tablas.map((t) => faltaParaImportar(t)).filter(Boolean);
  const hoy = hoyDelNegocio();
  /* El plan se arma cada vez que cambia algo: es puro y no escribe nada. */
  const plan = useMemo(
    () => (tablas.length && faltas.length === 0 ? planificarImportacionCs(e, tablas, { modo, crearFaltantes, hoy, ahora: new Date().toISOString(), quien: "Importación" }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [e.alumnos, e.seguimientos, e.testimonios, e.resells, e.reportes, tablas, modo, crearFaltantes, hoy, faltas.length],
  );
  const escribe = plan ? plan.alumnos.length + plan.seguimientos.length + plan.testimonios.length + plan.resells.length + plan.reportes.length : 0;

  function importar() {
    if (!plan || escribe === 0) return;
    const partes = TIPOS.filter((t) => plan.porTabla[t].filas > 0)
      .map((t) => `${NOMBRE_TABLA_CS[t]}: ${plan.porTabla[t].nuevas} nuevas, ${plan.porTabla[t].actualizadas} actualizadas`).join(" · ");
    acciones.importarClientesCs({
      alumnos: plan.alumnos, seguimientos: plan.seguimientos, testimonios: plan.testimonios, resells: plan.resells, reportes: plan.reportes,
      detalle: `Importación del Airtable de Customer Success (${partes}).`,
    });
    toast(`Listo: se importó el Airtable (${num(escribe)} registros).`);
    onCerrar();
  }

  const cambiar = (id: number, cambios: Partial<HojaAbierta>) => setHojas((xs) => xs.map((h) => (h.id === id ? { ...h, ...cambios } : h)));
  const cambiarTipo = (h: HojaAbierta, tipo: HojaAbierta["tipo"]) =>
    cambiar(h.id, { tipo, mapeo: tipo === "ignorar" ? {} : adivinarMapeoCs(CAMPOS_DE[tipo], (h.filas[h.cabecera] ?? []).map((x) => (x ?? "").trim())) });

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Importar el Airtable de Customer Success" ancho
      sub="Clientes, Testimonios, Agenda de resells y Reportes semanales. Antes de escribir nada se ve qué va a entrar."
      pie={(
        <>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button variante="primary" disabled={!plan || escribe === 0 || !confirmado} onClick={importar}>
            {plan && escribe > 0 ? `Importar ${num(escribe)} registros` : "Importar"}
          </Button>
        </>
      )}
    >
      <div className="cs-importar">
        <div className="stack-2">
          <label className="hk-btn hk-btn--secondary" style={{ cursor: "pointer", width: "fit-content" }}>
            <Upload size={16} aria-hidden />
            {hojas.length ? "Sumar otro archivo" : "Elegir los archivos"}
            <input type="file" accept=".xlsx,.csv,.tsv" multiple style={{ display: "none" }}
              onChange={(ev) => { if (ev.target.files?.length) void elegir(ev.target.files); ev.target.value = ""; }} />
          </label>
          <span className="t-sm t-subtle">
            {leyendo ? "Leyendo…" : "En Airtable: abrí cada tabla → ⋯ → «Download CSV». Podés subir los CSV juntos, o un Excel con una hoja por tabla. Las fechas se leen como día/mes/año."}
          </span>
        </div>

        {error && <p className="cs-importar__aviso" role="alert"><TriangleAlert size={14} aria-hidden /> {error}</p>}

        {hojas.map((h) => {
          const falta = h.tipo === "ignorar" ? null : faltaParaImportar({ tipo: h.tipo, mapeo: h.mapeo });
          const encabezados = (h.filas[h.cabecera] ?? []).map((x) => (x ?? "").trim());
          return (
            <section key={h.id} className="stack-2">
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{h.nombre}</strong>
                <span className="t-sm t-subtle">{num(Math.max(0, h.filas.length - h.cabecera - 1))} filas</span>
                <span style={{ minWidth: 200 }}>
                  <Select
                    value={h.tipo} aria-label={`Qué tabla es ${h.nombre}`}
                    opciones={[...TIPOS.map((t) => ({ valor: t, texto: NOMBRE_TABLA_CS[t] })), { valor: "ignorar", texto: "No importar esta hoja" }]}
                    onChange={(ev) => cambiarTipo(h, ev.target.value as HojaAbierta["tipo"])}
                  />
                </span>
                {h.tipo !== "ignorar" && (
                  <Button sm variante="ghost" onClick={() => setVerMapeo(verMapeo === h.id ? null : h.id)}>
                    {verMapeo === h.id ? "Ocultar las columnas" : "Ver qué columna es cada dato"}
                  </Button>
                )}
                <Button sm variante="ghost" onClick={() => setHojas((xs) => xs.filter((x) => x.id !== h.id))}>Sacar</Button>
              </div>
              {h.tipo === "ignorar" && <p className="t-sm t-subtle" style={{ margin: 0 }}>No se reconoció qué tabla es: elegila arriba si querés importarla.</p>}
              {falta && <p className="cs-importar__aviso" role="alert"><TriangleAlert size={14} aria-hidden /> {falta}</p>}
              {h.tipo !== "ignorar" && verMapeo === h.id && (
                <table className="cs-importar__mapa">
                  <thead><tr><th>Dato</th><th>Columna del archivo</th></tr></thead>
                  <tbody>
                    {CAMPOS_DE[h.tipo].map((c) => (
                      <tr key={c.campo}>
                        <td>{c.titulo}{c.ayuda && <div className="t-sm t-subtle">{c.ayuda}</div>}</td>
                        <td>
                          <Select
                            value={h.mapeo[c.campo] === undefined ? "" : String(h.mapeo[c.campo])} aria-label={`Columna de ${c.titulo}`} placeholder="— no traer —"
                            opciones={encabezados.map((t, i) => ({ valor: String(i), texto: t || `(columna ${i + 1})` }))}
                            onChange={(ev) => {
                              const m = { ...h.mapeo };
                              if (ev.target.value === "") delete m[c.campo]; else m[c.campo] = Number(ev.target.value);
                              cambiar(h.id, { mapeo: m });
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}

        {tablas.length > 0 && (
          <fieldset className="stack-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="t-strong" style={{ marginBottom: 6 }}>Si en la app ya hay un dato cargado</legend>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input type="radio" name="modo" checked={modo === "completar"} onChange={() => setModo("completar")} />
              <span>Dejar el de la app y completar sólo lo vacío <span className="t-subtle">(lo más seguro)</span></span>
            </label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input type="radio" name="modo" checked={modo === "pisar"} onChange={() => setModo("pisar")} />
              <span>Usar el del archivo <span className="t-subtle">(pisa lo que se corrigió en la app)</span></span>
            </label>
            <label className="row" style={{ gap: 8, cursor: "pointer", marginTop: 6 }}>
              <input type="checkbox" checked={crearFaltantes} onChange={(ev) => setCrearFaltantes(ev.target.checked)} />
              <span>Si un testimonio, reporte o agenda nombra a un alumno que no está, crearlo como egresado en vez de descartarlo</span>
            </label>
          </fieldset>
        )}

        {plan && (
          <section className="stack-3" aria-live="polite">
            <h3 className="cs-ficha__titulo">Qué va a entrar</h3>
            <div className="cs-importar__resumen">
              {TIPOS.filter((t) => plan.porTabla[t].filas > 0).map((t) => {
                const r = plan.porTabla[t];
                return (
                  <span key={t}><strong>{NOMBRE_TABLA_CS[t]}</strong>: {num(r.nuevas)} nuevas · {num(r.actualizadas)} actualizadas · {num(r.iguales)} ya estaban{r.descartadas ? ` · ${num(r.descartadas)} descartadas` : ""}</span>
                );
              })}
              {plan.alumnosCreadosPorOtraTabla > 0 && <span>Alumnos creados porque otra tabla los nombra: {num(plan.alumnosCreadosPorOtraTabla)}</span>}
            </div>
            {plan.avisos.length > 0 && (
              <div className="cs-importar__aviso">
                <strong>Para mirar ({num(plan.avisos.length)}):</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{plan.avisos.slice(0, 8).map((a, i) => <li key={i}>{a}</li>)}</ul>
                {plan.avisos.length > 8 && <span className="t-sm t-subtle">…y {num(plan.avisos.length - 8)} más.</span>}
              </div>
            )}
            {plan.descartadas.length > 0 && (
              <details>
                <summary className="link">Filas que no entran ({num(plan.descartadas.length)})</summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }} className="t-sm">
                  {plan.descartadas.slice(0, 40).map((d, i) => <li key={i}>{NOMBRE_TABLA_CS[d.tabla]}, fila {d.fila}: {d.motivo}</li>)}
                </ul>
                {plan.descartadas.length > 40 && <span className="t-sm t-subtle">…y {num(plan.descartadas.length - 40)} más.</span>}
              </details>
            )}
            {escribe > 0 ? (
              <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={confirmado} onChange={(ev) => setConfirmado(ev.target.checked)} />
                <span>Revisé el resumen: importar. <span className="t-subtle">Reimportar el mismo archivo no duplica nada.</span></span>
              </label>
            ) : (
              <p className="t-sm t-subtle" style={{ margin: 0 }}>No hay nada nuevo para escribir: todo lo del archivo ya está en la app.</p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
