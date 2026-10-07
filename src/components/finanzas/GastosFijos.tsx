"use client";

import React, { useMemo, useState } from "react";
import { Check, Pause, Pencil, Play, Plus, Repeat, Trash2, Wand2 } from "lucide-react";
import { Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { money } from "@/lib/format";
import { categoriaDe, categoriasDisponibles, escribirMonto, leerMonto } from "@/lib/gastos";
import {
  cuantosFaltan, diaDe, mesDe, nombreDelMes, plantillasDesdeGastos, propuestas, type Propuesta,
} from "@/lib/gastos-recurrentes";
import type { EstadoApp, GastoRecurrente } from "@/lib/types";

/* ==================================================================
   Gastos fijos: lo que se paga todos los meses (Fathom, EverWebinar…).

   Cada mes la app los propone con el monto del mes anterior y alguien los
   aprueba (carga el gasto), los corrige (aprueba con otro monto) o los
   saltea. Nada se carga sin aprobación (lib/gastos-recurrentes.ts).
   ================================================================== */

const clave = (p: Propuesta) => `${p.plantilla.id}:${p.mes}`;
const enTexto = (n: number) => escribirMonto(n);

export function GastosFijos({ e }: { e: EstadoApp }) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const puede = puedeEditar(acceso, "gastos");
  const base = e.ajustes.monedaBase;
  const M = (n: number, m = base) => money(n, m, Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);

  /* Cada hora alcanza: la lista sólo cambia con el día. */
  const ahora = Math.floor(Date.now() / 3600000) * 3600000;
  const ahoraIso = useMemo(() => new Date(ahora).toISOString(), [ahora]);
  const lista = useMemo(() => propuestas(e, ahoraIso), [e, ahoraIso]);
  const faltan = useMemo(() => cuantosFaltan(e, ahoraIso), [e, ahoraIso]);
  const plantillas = useMemo(
    () => [...(e.gastosRecurrentes ?? [])].sort((a, b) => a.concepto.localeCompare(b.concepto, "es")),
    [e.gastosRecurrentes],
  );
  const paraArmar = useMemo(() => plantillasDesdeGastos(e, ahoraIso, () => "x").length, [e, ahoraIso]);

  /* Los montos corregidos a mano, por propuesta: el resto va con el propuesto. */
  const [corregidos, setCorregidos] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<GastoRecurrente | "nuevo" | null>(null);
  const [borrar, setBorrar] = useState<GastoRecurrente | null>(null);

  const montoDe = (p: Propuesta): number => {
    const t = corregidos[clave(p)];
    if (t === undefined) return p.monto;
    const n = leerMonto(t);
    return Number.isFinite(n) ? n : 0;
  };

  function aprobar(ps: Propuesta[]) {
    const items = ps.map((p) => ({ id: p.plantilla.id, mes: p.mes, monto: montoDe(p) })).filter((i) => i.monto > 0);
    if (items.length === 0) { toast("Poné el monto para aprobarlo.", "err"); return; }
    const hechos = acciones.aprobarGastosFijos(items);
    setCorregidos((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !ps.some((p) => clave(p) === k))));
    toast(hechos.length === 0 ? "Ya estaban cargados."
      : hechos.length === 1 ? `Gasto cargado: ${hechos[0].concepto}, ${M(hechos[0].monto)}.`
        : `Se cargaron ${hechos.length} gastos fijos.`);
  }

  const aprobables = lista.filter((p) => p.leToca);

  return (
    <div className="stack-4">
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead
            titulo={faltan > 0 ? `Gastos fijos por aprobar · ${faltan}` : "Gastos fijos por aprobar"}
            sub="Lo que pagás todos los meses, ya propuesto con lo del mes anterior. Aprobalo, corregí el monto o salteá el mes: nada se carga solo."
            acciones={puede && aprobables.length > 1 ? (
              <Button sm variante="secondary" icono={<Check size={15} />} onClick={() => aprobar(aprobables)}
                title="Carga todos los que ya les tocaba pagar, con el monto que se ve en cada uno">Aprobar los {aprobables.length}</Button>
            ) : undefined}
          />
        </div>
        {lista.length === 0 ? (
          <Empty
            icono={<Repeat size={22} />}
            titulo={plantillas.length === 0 ? "Todavía no hay gastos fijos" : "Todo al día"}
            texto={plantillas.length === 0
              ? "Armalos con los gastos «Fijo» que ya cargaste (Fathom, EverWebinar…) o creá el primero: desde el mes que viene se proponen solos para aprobar."
              : "No hay gastos fijos por aprobar. El mes que viene van a aparecer acá con el monto de este."}
            accion={puede && plantillas.length === 0 ? (
              <div className="row-wrap" style={{ justifyContent: "center" }}>
                {paraArmar > 0 && <Button sm variante="secondary" icono={<Wand2 size={15} />} onClick={() => toast(`Se armaron ${acciones.armarGastosFijos()} gastos fijos.`)}>Armar con los que ya cargué ({paraArmar})</Button>}
                <Button sm icono={<Plus size={15} />} onClick={() => setEditando("nuevo")}>Nuevo gasto fijo</Button>
              </div>
            ) : undefined}
          />
        ) : (
          <ul className="fijos__lista" style={{ listStyle: "none", margin: 0, padding: "var(--space-3) var(--space-4) var(--space-4)", display: "grid", gap: 8 }}>
            {lista.map((p) => {
              const cambio = corregidos[clave(p)] !== undefined && montoDe(p) !== p.monto;
              return (
                <li key={clave(p)} className="fijos__fila" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", opacity: p.leToca ? 1 : 0.7 }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div className="t-strong truncate">{p.plantilla.concepto} {p.atrasada && <Badge variante="warning">De {nombreDelMes(p.mes).split(" de ")[0]}</Badge>}{!p.leToca && <Badge variante="neutral">Todavía no le toca</Badge>}</div>
                    <div className="t-sm t-subtle truncate">
                      {[p.plantilla.proveedor, p.plantilla.categoria, `se paga el ${p.plantilla.diaDelMes}`].filter(Boolean).join(" · ")}
                      {p.deMes ? ` · en ${nombreDelMes(p.deMes).split(" de ")[0]} fue ${M(p.monto, p.plantilla.moneda)}` : " · lo habitual"}
                    </div>
                  </div>
                  <div style={{ width: 150 }}>
                    <InputMonto aria-label={`Monto de ${p.plantilla.concepto}`} value={corregidos[clave(p)] ?? enTexto(p.monto)} disabled={!puede}
                      onChange={(ev) => setCorregidos((c) => ({ ...c, [clave(p)]: ev.target.value }))} />
                  </div>
                  {puede && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button sm icono={<Check size={15} />} onClick={() => aprobar([p])}
                        title={cambio ? "Carga el gasto con el monto que corregiste" : "Carga el gasto con este monto"}>{cambio ? "Aprobar con este monto" : "Aprobar"}</Button>
                      <Button sm variante="ghost" onClick={() => {
                        acciones.saltearGastoFijo(p.plantilla.id, p.mes);
                        toast(`Salteado: ${p.plantilla.concepto} en ${nombreDelMes(p.mes).split(" de ")[0]}.`, "ok", { texto: "Deshacer", onClick: () => acciones.volverAProponerGastoFijo(p.plantilla.id, p.mes) });
                      }} title="Este mes no se pagó: no se carga y no vuelve a aparecer">Este mes no</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead
            titulo="Mis gastos fijos"
            sub="Las plantillas de las que salen las propuestas de cada mes: cuánto, qué día y de qué categoría."
            acciones={puede ? (
              <>
                {plantillas.length > 0 && paraArmar > 0 && (
                  <Button sm variante="secondary" icono={<Wand2 size={15} />} onClick={() => toast(`Se armaron ${acciones.armarGastosFijos()} gastos fijos más.`)}
                    title="Suma una plantilla por cada gasto «Fijo» ya cargado que todavía no tiene">Sumar los que ya cargué ({paraArmar})</Button>
                )}
                <Button sm icono={<Plus size={15} />} onClick={() => setEditando("nuevo")}>Nuevo gasto fijo</Button>
              </>
            ) : undefined}
          />
        </div>
        <DataTable
          filas={plantillas}
          columnas={[
            { clave: "concepto", titulo: "Gasto", tipo: "primary", orden: (t) => t.concepto, celda: (t) => <span>{t.concepto}{t.proveedor && <span className="t-subtle"> · {t.proveedor}</span>}</span> },
            { clave: "categoria", titulo: "Categoría", tipo: "secondary", orden: (t) => t.categoria, celda: (t) => t.categoria },
            { clave: "dia", titulo: "Día", tipo: "num", orden: (t) => t.diaDelMes, celda: (t) => `El ${t.diaDelMes}` },
            { clave: "monto", titulo: "Habitual", tipo: "num", orden: (t) => t.monto, celda: (t) => M(t.monto, t.moneda) },
            {
              clave: "estado", titulo: "Estado", orden: (t) => (t.activo ? 1 : 0),
              celda: (t) => (t.activo ? <Badge variante="success">Se propone</Badge> : <Badge variante="neutral">Pausado</Badge>),
            },
          ]}
          acciones={puede ? (t) => (
            <>
              <IconButton etiqueta="Corregir" onClick={() => setEditando(t)}><Pencil size={15} /></IconButton>
              <IconButton etiqueta={t.activo ? "Pausar: no proponerlo más" : "Volver a proponerlo"} onClick={() => acciones.guardarGastoRecurrente({ ...t, activo: !t.activo })}>
                {t.activo ? <Pause size={15} /> : <Play size={15} />}
              </IconButton>
              <IconButton etiqueta="Borrar" onClick={() => setBorrar(t)}><Trash2 size={15} /></IconButton>
            </>
          ) : undefined}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Todavía no hay gastos fijos.</p>}
        />
      </Card>

      <Ayuda titulo="Cómo funciona" icono={<Repeat size={18} />}>
        Cada gasto fijo se propone todos los meses, desde el día en que se paga, con lo que fue el mes anterior. Si el mes
        pasado fue distinto, se propone ese monto. «Aprobar» carga el gasto de verdad (con la fecha de ese día del mes, como
        «Fijo»); si cambiaste el monto, carga el que pusiste y ése queda para el mes que viene. «Este mes no» lo saltea sin
        cargar nada. Si ya cargaste a mano el gasto de ese mes, no se vuelve a proponer. Lo que se queda sin aprobar se sigue
        mostrando hasta dos meses para atrás.
      </Ayuda>

      {editando && (
        <FormGastoFijo
          e={e} fijo={editando === "nuevo" ? null : editando} onCerrar={() => setEditando(null)}
          onListo={(m) => { setEditando(null); toast(m); }}
        />
      )}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)} confirmarTexto="Borrar"
        titulo="¿Borrar este gasto fijo?"
        texto={borrar ? `Se borra la plantilla de «${borrar.concepto}»: no se propone más. Los gastos que ya se cargaron quedan como están.` : ""}
        onConfirmar={() => { if (borrar) { acciones.borrarGastoRecurrente(borrar.id); toast("Gasto fijo borrado."); } }}
      />
    </div>
  );
}

/* ---------- Crear o corregir uno ---------- */

function FormGastoFijo({ e, fijo, onCerrar, onListo }: {
  e: EstadoApp;
  fijo: GastoRecurrente | null;
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const base = e.ajustes.monedaBase;
  const [concepto, setConcepto] = useState(fijo?.concepto ?? "");
  const [categoria, setCategoria] = useState(fijo?.categoria ?? "");
  const [proveedor, setProveedor] = useState(fijo?.proveedor ?? "");
  const [monto, setMonto] = useState(fijo ? enTexto(fijo.monto) : "");
  const [dia, setDia] = useState(String(fijo?.diaDelMes ?? Math.min(28, diaDe(new Date().toISOString()))));
  const [cuentaId, setCuentaId] = useState(fijo?.cuentaId ?? "");
  const [notas, setNotas] = useState(fijo?.notas ?? "");

  const categorias = categoriasDisponibles(e);
  const montoNum = leerMonto(monto);
  const diaNum = Math.round(Number(dia));
  const problema = !concepto.trim() ? "Poné qué es"
    : !categoria ? "Elegí la categoría"
      : !(montoNum > 0) ? "Poné el monto habitual"
        : !(diaNum >= 1 && diaNum <= 28) ? "El día tiene que ser del 1 al 28" : null;

  function guardar() {
    if (problema) return;
    const cat = categoriaDe(e, categoria);
    const t: GastoRecurrente = {
      id: fijo?.id ?? nuevoId("rec"),
      concepto: concepto.trim(), categoria,
      grupo: cat?.grupo ?? fijo?.grupo ?? "operativo",
      proveedor: proveedor.trim() || undefined,
      monto: montoNum, moneda: base, diaDelMes: diaNum,
      cuentaId: cuentaId || undefined,
      webinarId: fijo?.webinarId,
      notas: notas.trim() || undefined,
      activo: fijo?.activo ?? true,
      desde: fijo?.desde ?? mesDe(new Date().toISOString()),
      salteados: fijo?.salteados ?? [],
      creadoEn: fijo?.creadoEn ?? new Date().toISOString(),
    };
    acciones.guardarGastoRecurrente(t);
    onListo(fijo ? `«${t.concepto}» corregido.` : `«${t.concepto}» se va a proponer todos los meses.`);
  }

  return (
    <ModalForm abierto ancho onCerrar={onCerrar} onGuardar={guardar} puedeGuardar={!problema}
      guardarTexto={fijo ? "Guardar los cambios" : "Crear el gasto fijo"}
      titulo={fijo ? "Gasto fijo" : "Nuevo gasto fijo"}
      sub="Algo que pagás todos los meses. Cada mes se propone con lo del mes anterior y lo aprobás.">
      <div className="form-grid">
        <Field label="Qué es" span2>
          <Input value={concepto} placeholder="Fathom" aria-label="Qué es" autoFocus={!fijo} onChange={(ev) => setConcepto(ev.target.value)} />
        </Field>
        <Field label="Categoría">
          <Select value={categoria} placeholder="Elegí la categoría" aria-label="Categoría" onChange={(ev) => setCategoria(ev.target.value)}
            opciones={categorias.map((c) => ({ valor: c.categoria, texto: c.categoria }))} />
        </Field>
        <Field label="A quién se le paga">
          <Input value={proveedor} placeholder="Fathom" aria-label="A quién se le paga" onChange={(ev) => setProveedor(ev.target.value)} />
        </Field>
        <Field label={`Monto habitual (${base === "USD" ? "US$" : "$"})`} ayuda="Cada mes se propone el del mes anterior; éste es el de partida.">
          <InputMonto value={monto} placeholder="140" aria-label="Monto habitual" onChange={(ev) => setMonto(ev.target.value)} />
        </Field>
        <Field label="Día del mes en que se paga" ayuda="Del 1 al 28. Desde ese día aparece para aprobar.">
          <Input type="number" min={1} max={28} value={dia} aria-label="Día del mes" onChange={(ev) => setDia(ev.target.value)} />
        </Field>
        <Field label="De qué cuenta sale" ayuda="Opcional: cuenta la salida en el arqueo de esa cuenta.">
          <Select value={cuentaId} placeholder="Sin cuenta" aria-label="De qué cuenta sale" onChange={(ev) => setCuentaId(ev.target.value)}
            opciones={[{ valor: "", texto: "Sin cuenta" }, ...e.procesadores.filter((p) => p.activo || p.id === fijo?.cuentaId).map((p) => ({ valor: p.id, texto: p.nombre }))]} />
        </Field>
        <Field label="Nota" span2><Textarea rows={2} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Por ejemplo, el plan que se paga" /></Field>
      </div>
      {problema && (concepto || monto) && <p className="t-sm t-subtle" role="status">{problema}.</p>}
    </ModalForm>
  );
}
