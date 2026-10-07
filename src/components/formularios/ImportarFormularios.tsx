"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Info, TriangleAlert, Upload } from "lucide-react";
import { Ayuda, Button, Input, Select } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useEstado } from "@/lib/store";
import { num } from "@/lib/format";
import { leerCSV } from "@/lib/pasarelas";
import { abrirXlsx } from "@/lib/xlsx";
import {
  adivinarMapeo, CAMPOS_IMPORT, fechaDeHoja, leerHoja, planificarImportacion,
  type CampoImport, type HojaAImportar, type Mapeo, type PlanImportacion,
} from "@/lib/registros-webinar";
import { existentesDeFechas, guardarRegistros } from "@/lib/registros-nube";

/* ==================================================================
   Importar las hojas del Excel de los formularios (una por webinar).

   Se sube el Excel entero (Google Sheets: Archivo → Descargar → Microsoft
   Excel) o una hoja en .csv. Cada hoja es un webinar: la fecha sale de su
   nombre y se puede corregir. El mapeo de columnas se adivina por los
   encabezados y se puede cambiar. Antes de escribir se muestra qué va a
   entrar, qué ya estaba y qué se descarta; recién al confirmar se guarda.

   Sólo agrega o completa: no borra nada, no pisa las marcas del equipo
   (unido, contactado, notas) y no manda nada a Meta. Reimportar el mismo
   archivo no duplica: la misma persona en el mismo webinar es la misma fila.
   ================================================================== */

interface HojaEditable extends HojaAImportar { id: number }

export function ImportarFormularios({ onCerrar, onListo }: { onCerrar: () => void; onListo: (mensaje: string) => void }) {
  const e = useEstado();
  const [archivo, setArchivo] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [hojas, setHojas] = useState<HojaEditable[]>([]);
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [plan, setPlan] = useState<{ plan: PlanImportacion; enLaApp: Map<string, number> } | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [avance, setAvance] = useState(0);

  const anioNum = Number.parseInt(anio, 10) || new Date().getFullYear();

  async function elegir(f: File) {
    setError(""); setHojas([]); setPlan(null); setArchivo(f.name); setLeyendo(true);
    try {
      const crudas: { nombre: string; tabla: string[][] }[] = [];
      if (/\.csv$/i.test(f.name)) {
        crudas.push({ nombre: f.name.replace(/\.csv$/i, ""), tabla: leerCSV(await f.text()) });
      } else {
        const libro = await abrirXlsx(await f.arrayBuffer());
        for (const nombre of libro.nombres) {
          const tabla = await libro.hoja(nombre);
          if (tabla && tabla.length > 1) crudas.push({ nombre, tabla });
        }
        if (crudas.length === 0) throw new Error("El Excel no tiene hojas con datos.");
      }
      setHojas(crudas.map((h, i) => ({
        id: i, nombre: h.nombre, tabla: h.tabla, mapeo: adivinarMapeo(h.tabla[0] ?? []),
        fechaWebinar: fechaDeHoja(h.nombre, anioNum), incluir: Boolean(adivinarMapeo(h.tabla[0] ?? []).email !== undefined),
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  const cambiarHoja = (id: number, c: Partial<HojaEditable>) => setHojas((hs) => hs.map((h) => (h.id === id ? { ...h, ...c } : h)));

  /* El resumen se recalcula solo cuando cambia algo (la fecha de una hoja, el
     mapeo, cuáles entran): lo que ya está en la base se pide una vez por fecha. */
  const clave = useMemo(() => JSON.stringify(hojas.map((h) => [h.id, h.incluir, h.fechaWebinar, h.mapeo])) + anio, [hojas, anio]);
  useEffect(() => {
    const activas = hojas.filter((h) => h.incluir && h.mapeo.email !== undefined);
    if (activas.length === 0) { setPlan(null); return; }
    let vigente = true;
    setCalculando(true);
    (async () => {
      const existentes = await existentesDeFechas(activas.map((h) => h.fechaWebinar));
      const leidas = activas.map((h) => leerHoja(h, { webinars: e.webinars, ads: e.ads, anio: anioNum }));
      const enLaApp = new Map<string, number>();
      for (const r of existentes.values()) {
        const k = r.fechaWebinar ?? "sin";
        enLaApp.set(k, (enLaApp.get(k) ?? 0) + 1);
      }
      if (vigente) { setPlan({ plan: planificarImportacion(leidas, existentes), enLaApp }); setCalculando(false); }
    })().catch((err) => { if (vigente) { setError(err instanceof Error ? err.message : "No se pudo calcular."); setCalculando(false); } });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  async function importar() {
    if (!plan) return;
    setGuardando(true); setError(""); setAvance(0);
    const r = await guardarRegistros(plan.plan.aEscribir, setAvance);
    setGuardando(false);
    if (!r.ok) { setError(`${r.error ?? "No se pudo guardar."}${r.escritos ? ` Se alcanzaron a guardar ${num(r.escritos)}; reimportar completa el resto sin duplicar.` : ""}`); return; }
    const t = plan.plan.totales;
    onListo(`Se importaron ${num(t.nuevos)} registros nuevos y se completaron ${num(t.yaEstaban)} que ya estaban.`);
  }

  const t = plan?.plan.totales;
  const sinEmail = hojas.filter((h) => h.mapeo.email === undefined);

  return (
    <Modal
      abierto onCerrar={guardando ? () => undefined : onCerrar} ancho
      titulo="Importar del Excel de los formularios"
      sub="Una hoja por webinar: la fecha sale del nombre de la hoja. No borra nada ni pisa lo que marcó el equipo."
      pie={
        <>
          <Button variante="secondary" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button variante="brand" onClick={() => void importar()} cargando={guardando} disabled={!plan || calculando || (t?.nuevos ?? 0) + (t?.yaEstaban ?? 0) === 0}>
            {guardando ? `Guardando… ${num(avance)} de ${num(plan?.plan.aEscribir.length ?? 0)}` : t ? `Importar ${num(t.nuevos + t.yaEstaban)} registros` : "Importar"}
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <label className="importar-caja">
          <input type="file" accept=".xlsx,.csv" style={{ display: "none" }}
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void elegir(f); ev.target.value = ""; }} />
          <FileSpreadsheet size={22} />
          <span style={{ minWidth: 0 }}>
            <span className="t-strong" style={{ display: "block" }}>{archivo || "Elegí el Excel con las hojas de los webinars"}</span>
            <span className="t-sm t-subtle">{leyendo ? "Leyendo…" : "El .xlsx entero o una hoja en .csv."}</span>
          </span>
          <span className="hk-btn hk-btn--secondary hk-btn--sm" style={{ marginLeft: "auto" }}><Upload size={14} />Elegir</span>
        </label>

        {error && <p className="t-sm" style={{ color: "var(--danger)" }}>{error}</p>}

        {hojas.length > 0 && (
          <>
            <div className="fm-imp-anio">
              <span className="t-sm">Año de las hojas que no lo dicen («Webinar 23/09»)</span>
              <Input type="number" value={anio} onChange={(ev) => setAnio(ev.target.value)} style={{ width: 100 }} aria-label="Año" />
            </div>
            <div className="fm-imp-hojas">
              {hojas.map((h) => (
                <details key={h.id} className="fm-imp-hoja">
                  <summary>
                    <input type="checkbox" checked={h.incluir} disabled={h.mapeo.email === undefined}
                      onChange={(ev) => cambiarHoja(h.id, { incluir: ev.target.checked })} onClick={(ev) => ev.stopPropagation()} aria-label={`Importar la hoja ${h.nombre}`} />
                    <span className="t-strong">{h.nombre}</span>
                    <span className="t-sm t-subtle">{num(h.tabla.length - 1)} filas</span>
                    <span onClick={(ev) => ev.stopPropagation()} className="fm-imp-fecha">
                      <span className="t-sm t-subtle">Webinar del</span>
                      <Input type="date" value={h.fechaWebinar ?? ""} onChange={(ev) => cambiarHoja(h.id, { fechaWebinar: ev.target.value || undefined })} aria-label={`Fecha del webinar de la hoja ${h.nombre}`} />
                    </span>
                  </summary>
                  <MapeoColumnas hoja={h} onCambiar={(mapeo) => cambiarHoja(h.id, { mapeo })} onATodas={() => setHojas((hs) => hs.map((x) => ({ ...x, mapeo: h.mapeo })))} />
                </details>
              ))}
            </div>
            {sinEmail.length > 0 && (
              <p className="t-sm t-subtle">
                <TriangleAlert size={14} style={{ verticalAlign: "-2px", color: "var(--warning)" }} /> No se encontró la columna del mail en: {sinEmail.map((h) => h.nombre).join(", ")}.
                Abrí la hoja y elegí cuál es; sin mail no se puede importar.
              </p>
            )}
          </>
        )}

        {calculando && <p className="t-sm t-subtle">Calculando qué va a entrar…</p>}

        {plan && !calculando && t && (
          <div className="stack-3">
            <div className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="t-label">Resumen antes de importar</span>
              <InfoMetrica
                titulo="Resumen de la importación"
                ayuda="Qué va a pasar si confirmás, sin escribir nada todavía. Cada persona se identifica por su mail y la fecha del webinar: si ya estaba, se completan los datos que faltaban y no se tocan las marcas del equipo."
                formula="En el Excel = filas con datos. Nuevos + Ya estaban + Sin mail + Repetidos = filas del Excel. «Quedan en la app» = lo que ya había en esa fecha + los nuevos."
              />
            </div>
            <div className="fm-imp-tabla" role="table" aria-label="Resumen por hoja">
              <div className="fm-imp-fila fm-imp-fila--cab" role="row">
                <span>Hoja</span><span>En el Excel</span><span>Nuevos</span><span>Ya estaban</span><span>Sin mail</span><span>Repetidos</span><span>Quedan en la app</span>
              </div>
              {plan.plan.hojas.map((h) => (
                <div key={h.nombre} className="fm-imp-fila" role="row">
                  <span title={h.nombre}>{h.nombre}{h.fechaWebinar ? <span className="t-subtle"> · {h.fechaWebinar.split("-").reverse().join("/")}</span> : null}</span>
                  <span className="t-num">{num(h.filas)}</span>
                  <span className="t-num t-strong">{num(h.nuevos)}</span>
                  <span className="t-num">{num(h.yaEstaban)}</span>
                  <span className="t-num">{num(h.sinMail)}</span>
                  <span className="t-num">{num(h.repetidos)}</span>
                  <span className="t-num">{num((plan.enLaApp.get(h.fechaWebinar ?? "sin") ?? 0) + h.nuevos)}</span>
                </div>
              ))}
              <div className="fm-imp-fila fm-imp-fila--total" role="row">
                <span>Total</span><span className="t-num">{num(t.filas)}</span><span className="t-num">{num(t.nuevos)}</span><span className="t-num">{num(t.yaEstaban)}</span>
                <span className="t-num">{num(t.sinMail)}</span><span className="t-num">{num(t.repetidos)}</span><span />
              </div>
            </div>
            {plan.plan.avisos.map((a) => (
              <div key={a} className="row t-sm" style={{ gap: 8, alignItems: "flex-start" }}>
                <TriangleAlert size={15} style={{ flex: "none", marginTop: 2, color: "var(--warning)" }} /><span>{a}</span>
              </div>
            ))}
            <Ayuda titulo="Se puede importar de nuevo" icono={<Info size={18} />}>
              Si el archivo ya se importó, los registros figuran en «Ya estaban»: se completan los datos que faltaban y las marcas del equipo
              (unido, contactado, notas) quedan como están. No se manda nada a Meta ni a ActiveCampaign.
            </Ayuda>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* Qué columna de la hoja es cada dato: se adivina por el encabezado y se corrige acá. */
function MapeoColumnas({ hoja, onCambiar, onATodas }: { hoja: HojaEditable; onCambiar: (m: Mapeo) => void; onATodas: () => void }) {
  const encabezados = hoja.tabla[0] ?? [];
  const opciones = encabezados.map((h, i) => ({ valor: String(i), texto: `${columnaLetra(i)} · ${h.trim() || "(sin título)"}` })).filter((o) => encabezados[Number(o.valor)]?.trim());
  const sinMapear = encabezados.filter((h, i) => h.trim() && !Object.values(hoja.mapeo).includes(i));
  return (
    <div className="stack-3" style={{ padding: "var(--space-3) 0 var(--space-2)" }}>
      <div className="fm-imp-mapeo">
        {CAMPOS_IMPORT.map((c) => (
          <div key={c.campo} className="hk-field">
            <label className="hk-label">{c.titulo}</label>
            <Select
              value={hoja.mapeo[c.campo] === undefined ? "" : String(hoja.mapeo[c.campo])} placeholder="— no está en la hoja —" opciones={opciones}
              onChange={(ev) => {
                const m: Mapeo = { ...hoja.mapeo };
                const nuevo = ev.target.value === "" ? undefined : Number(ev.target.value);
                /* Una columna sirve para un solo dato: se la saca de donde estaba. */
                for (const k of Object.keys(m) as CampoImport[]) if (nuevo !== undefined && m[k] === nuevo) delete m[k];
                if (nuevo === undefined) delete m[c.campo]; else m[c.campo] = nuevo;
                onCambiar(m);
              }}
            />
          </div>
        ))}
      </div>
      <div className="row-wrap">
        <Button sm variante="secondary" onClick={onATodas}>Usar este mapeo en todas las hojas</Button>
        <span className="t-sm t-subtle">
          {sinMapear.length > 0 ? `Quedan como respuestas del formulario: ${sinMapear.slice(0, 6).join(", ")}${sinMapear.length > 6 ? "…" : ""}.` : "No sobran columnas."}
        </span>
      </div>
    </div>
  );
}

const columnaLetra = (i: number): string => (i >= 26 ? columnaLetra(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
