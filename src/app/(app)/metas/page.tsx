"use client";

import React, { useEffect, useState } from "react";
import { Info, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Bar, Button, Card, Empty, Field, IconButton, Input, Select, StatCard } from "@/components/ui/ui";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { money, nombreMes, num, pct } from "@/lib/format";
import { ETIQUETA_METRICA, progresoMeta, ultimosMeses, valorMetrica } from "@/lib/metricas";
import type { Meta, MetricaClave, UnidadMeta } from "@/lib/types";

const UNIDAD_DE: Record<MetricaClave, UnidadMeta> = {
  "ingresos": "moneda", "leads-nuevos": "cantidad", "inscriptos": "cantidad",
  "sesiones-hechas": "cantidad", "alumnos-activos": "cantidad",
  "margen": "porcentaje", "registrados-webinar": "cantidad",
};

const VACIA = (periodo: string): Omit<Meta, "id"> => ({
  nombre: "", metrica: "ingresos", objetivo: 10000, unidad: "moneda",
  periodo, creadoEn: new Date().toISOString(),
});

export default function Metas() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [form, setForm] = useState<(Omit<Meta, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Meta | null>(null);

  const meses = ultimosMeses(6);
  const actual = meses[meses.length - 1];

  useEffect(() => {
    if (url.nuevo) { setForm(VACIA(actual.clave)); url.limpiar(); }
  }, [url, actual.clave]);

  const fmt = (u: UnidadMeta) => (n: number) =>
    u === "moneda" ? money(n, e.ajustes.monedaBase) : u === "porcentaje" ? pct(n) : num(n);

  const logradas = e.metas.filter((m) => progresoMeta(e, m).pct >= 100).length;
  const promedio = e.metas.length > 0 ? e.metas.reduce((a, m) => a + Math.min(progresoMeta(e, m).pct, 100), 0) / e.metas.length : 0;

  function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) { toast("Ponele un nombre a la meta.", "err"); return; }
    const datos = { ...form, unidad: UNIDAD_DE[form.metrica] };
    if (form.id) { acciones.actualizar<Meta>("metas", form.id, datos, form.nombre); toast("Meta actualizada."); }
    else { acciones.crear<Meta>("metas", datos, form.nombre); toast(`Meta «${form.nombre}» creada.`); }
    setForm(null);
  }

  return (
    <div className="stack-5">
      <PageHead
        titulo="Metas"
        sub={`Los objetivos de ${nombreMes(actual.clave)}. Se miden solos con los datos que ya cargás — no hay que actualizar nada a mano.`}
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA(actual.clave))}>Nueva meta</Button>}
      />

      <div className="grid-3">
        <StatCard hero etiqueta="Metas del mes" valor={num(e.metas.length)} contexto="objetivos activos" />
        <StatCard etiqueta="Ya logradas" valor={`${num(logradas)}/${num(e.metas.length)}`} delta={logradas > 0 ? "Bien" : undefined} direccion="up" contexto="llegaron al 100%" />
        <StatCard etiqueta="Avance promedio" valor={pct(promedio, 0)} contexto="de todas las metas juntas" />
      </div>

      {e.metas.length === 0 ? (
        <Card>
          <Empty
            icono={<Target size={22} />}
            titulo="Todavía no pusiste ninguna meta"
            texto="Definí qué querés lograr este mes — facturación, leads, inscriptos — y te muestro en todo momento cuánto te falta."
            accion={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA(actual.clave))}>Crear mi primera meta</Button>}
          />
        </Card>
      ) : (
        <div className="grid-2">
          {e.metas.map((m) => {
            const p = progresoMeta(e, m);
            const f = fmt(m.unidad);
            const falta = Math.max(m.objetivo - p.actual, 0);
            return (
              <Card key={m.id}>
                <div className="row-3" style={{ alignItems: "flex-start", marginBottom: 16 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h2 className="t-h3 truncate">{m.nombre}</h2>
                    <p className="t-sm t-subtle" style={{ marginTop: 2 }}>{ETIQUETA_METRICA[m.metrica]} · {nombreMes(m.periodo)}</p>
                  </div>
                  <Badge variante={p.pct >= 100 ? "success" : p.pct >= 60 ? "accent" : "neutral"}>
                    {Math.round(p.pct)}%
                  </Badge>
                  <span style={{ display: "flex", gap: 2 }}>
                    <IconButton etiqueta="Editar" onClick={() => setForm({ ...m })}><Pencil size={15} /></IconButton>
                    <IconButton etiqueta="Eliminar" onClick={() => setBorrar(m)}><Trash2 size={15} /></IconButton>
                  </span>
                </div>

                <div className="row" style={{ marginBottom: 8, alignItems: "baseline" }}>
                  <span className="t-num" style={{ fontSize: 28, fontWeight: 600, color: p.pct >= 100 ? "var(--success)" : "var(--ink)" }}>{f(p.actual)}</span>
                  <span className="t-sm t-subtle">de {f(m.objetivo)}</span>
                </div>
                <Bar valor={p.pct} tono={p.pct >= 100 ? "success" : "accent"} />
                <p className="t-sm t-subtle" style={{ marginTop: 10 }}>
                  {p.pct >= 100
                    ? `Meta cumplida. Te pasaste por ${f(p.actual - m.objetivo)}.`
                    : `Te faltan ${f(falta)} para llegar.`}
                </p>

                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <div className="t-label" style={{ marginBottom: 10 }}>Cómo venías los meses anteriores</div>
                  <div className="row" style={{ gap: 6, alignItems: "flex-end", height: 44 }}>
                    {meses.map((mes) => {
                      const v = valorMetrica(e, m.metrica, mes);
                      const h = m.objetivo > 0 ? Math.min((v / m.objetivo) * 100, 100) : 0;
                      const logro = v >= m.objetivo;
                      return (
                        <div key={mes.clave} style={{ flex: 1, textAlign: "center" }} title={`${mes.etiqueta}: ${f(v)}`}>
                          <div style={{ height: 32, display: "flex", alignItems: "flex-end" }}>
                            <div style={{
                              width: "100%", height: `${Math.max(h, 4)}%`, borderRadius: 4,
                              background: logro ? "var(--success)" : "var(--brand-fill)",
                              transition: "height 400ms ease-out",
                            }} />
                          </div>
                          <div className="t-sm t-subtle" style={{ fontSize: 10, marginTop: 4 }}>{mes.etiqueta.split(" ")[0]}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Ayuda titulo="Cómo funcionan las metas" icono={<Info size={18} />}>
        Elegís qué querés medir y el número al que querés llegar. Apicanta lo calcula con los datos reales que ya
        tenés cargados: si registrás un cobro, la meta de facturación se mueve sola. Las barritas de abajo te muestran
        cómo venías los meses anteriores contra ese mismo objetivo.
      </Ayuda>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar}
          titulo={form.id ? "Editar meta" : "Nueva meta"}
          sub="Elegí qué medir y a cuánto querés llegar este mes."
          guardarTexto={form.id ? "Guardar cambios" : "Crear meta"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <Field label="Nombre" ayuda="Cómo la querés ver en el panel.">
            <Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Facturación del mes" autoFocus />
          </Field>
          <Field label="Qué medir" ayuda="Se calcula solo con lo que ya cargás.">
            <Select
              value={form.metrica}
              onChange={(ev) => { const k = ev.target.value as MetricaClave; setForm({ ...form, metrica: k, unidad: UNIDAD_DE[k] }); }}
              opciones={(Object.keys(ETIQUETA_METRICA) as MetricaClave[]).map((k) => ({ valor: k, texto: ETIQUETA_METRICA[k] }))}
            />
          </Field>
          <Field label="Objetivo" ayuda={UNIDAD_DE[form.metrica] === "moneda" ? "En USD." : UNIDAD_DE[form.metrica] === "porcentaje" ? "En porcentaje." : "Una cantidad."}>
            <Input type="number" min={0} value={form.objetivo} onChange={(ev) => setForm({ ...form, objetivo: Number(ev.target.value) })} />
          </Field>
          <Field label="Mes">
            <Select value={form.periodo} onChange={(ev) => setForm({ ...form, periodo: ev.target.value })}
              opciones={[...meses].reverse().map((m) => ({ valor: m.clave, texto: nombreMes(m.clave) }))} />
          </Field>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar esta meta?"
        texto={`Se borra «${borrar?.nombre}». Los datos que mide quedan intactos.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("metas", borrar.id, borrar.nombre); toast("Meta eliminada."); } }}
      />
    </div>
  );
}
