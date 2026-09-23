"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Download, HandCoins, Info, Pencil, Plus, Trash2, Upload,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Bar, Button, Card, Chip, Empty, IconButton,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { ImportarPlanilla } from "@/components/ventas/ImportarPlanilla";
import { aCSV, filasParaPlanilla } from "@/lib/exportarPlanilla";
import { desdeVenta, FormularioVenta, type BorradorVenta } from "@/components/ventas/FormularioVenta";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaLarga, money } from "@/lib/format";
import { saldoVenta } from "@/lib/finanzas";
import type { EstadoVenta, Venta } from "@/lib/types";

const ESTADO: Record<EstadoVenta, { texto: string; variante: "success" | "neutral" | "danger" }> = {
  "activa":      { texto: "Activa",      variante: "success" },
  "cancelada":   { texto: "Cancelada",   variante: "neutral" },
  "reembolsada": { texto: "Reembolsada", variante: "danger" },
};

export default function Ventas() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const abrirFicha = useAbrirFicha();
  const [filtro, setFiltro] = useState<"todas" | EstadoVenta | "conSaldo">("todas");
  const [form, setForm] = useState<BorradorVenta | null>(null);
  const [asistente, setAsistente] = useState(false);
  const [borrar, setBorrar] = useState<Venta | null>(null);
  const [importando, setImportando] = useState(false);

  /* La hoja Ventas de la planilla de Angelo, con sus 36 columnas. */
  function exportarPlanilla() {
    const blob = new Blob(["\ufeff" + aCSV(filasParaPlanilla(e))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ventas-planilla-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Se bajó la hoja Ventas con las columnas de la planilla.");
  }

  useEffect(() => {
    if (url.nuevo) { setAsistente(true); url.limpiar(); }
    /* ?ver=<venta> abre la ficha de la persona con esa venta a la vista. */
    else if (url.ver) abrirFicha(url.ver, "ventas", { venta: url.ver });
  }, [url, abrirFicha]);

  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const filas = useMemo(() => {
    let xs = e.ventas;
    if (filtro === "conSaldo") xs = xs.filter((v) => saldoVenta(e, v.id).saldo > 0.01 && v.estado === "activa");
    else if (filtro !== "todas") xs = xs.filter((v) => v.estado === filtro);
    return xs;
  }, [e, filtro]);


  const columnas: Columna<Venta>[] = [
    { clave: "contacto", titulo: "Nombre Completo", tipo: "primary", orden: (v) => v.contactoNombre, celda: (v) => v.contactoNombre },
    { clave: "producto", titulo: "Servicio adquirido", tipo: "secondary", orden: (v) => v.productoId ?? "", celda: (v) => e.productos.find((p) => p.id === v.productoId)?.nombre ?? "—" },
    { clave: "proyecto", titulo: "Proyecto", tipo: "secondary", orden: (v) => v.proyecto ?? "", celda: (v) => v.proyecto || "—" },
    { clave: "estrategia", titulo: "Estrategia", tipo: "secondary", orden: (v) => e.embudos.find((x) => x.id === v.embudoId)?.nombre ?? "", celda: (v) => e.embudos.find((x) => x.id === v.embudoId)?.nombre ?? "—" },
    { clave: "closer", titulo: "Vendedor", tipo: "secondary", orden: (v) => v.closerId ?? "", celda: (v) => e.equipo.find((x) => x.id === v.closerId)?.nombre ?? "—" },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (v) => v.fecha, celda: (v) => fechaLarga(v.fecha) },
    { clave: "precio", titulo: "Valor total", tipo: "num", orden: (v) => v.precioAcordado, celda: (v) => M(v.precioAcordado) },
    {
      clave: "saldo", titulo: "Cobrado", orden: (v) => { const s = saldoVenta(e, v.id); return s.total > 0 ? s.cobrado / s.total : 0; },
      celda: (v) => {
        const s = saldoVenta(e, v.id);
        const p = s.total > 0 ? (s.cobrado / s.total) * 100 : 0;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
            <span style={{ flex: 1 }}><Bar valor={p} tono={p >= 99 ? "success" : "accent"} /></span>
            <span className="t-sm t-num t-subtle">{Math.round(p)}%</span>
          </span>
        );
      },
    },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Ventas"
        sub="Cada venta con su plan de cuotas. Una cuota puede cobrarse con varios métodos y cada pago queda atado a su procesador."
        acciones={
          <>
            <Button variante="secondary" icono={<Upload size={16} />} onClick={() => setImportando(true)}>Importar planilla</Button>
            <Button variante="secondary" icono={<Download size={16} />} onClick={exportarPlanilla}>Exportar planilla</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Nueva venta</Button>
          </>
        }
      />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4)" }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Chip activo={filtro === "todas"} onClick={() => setFiltro("todas")} count={e.ventas.length}>Todas</Chip>
            <Chip activo={filtro === "conSaldo"} onClick={() => setFiltro("conSaldo")} count={e.ventas.filter((v) => v.estado === "activa" && saldoVenta(e, v.id).saldo > 0.01).length}>Con saldo</Chip>
            {(Object.keys(ESTADO) as EstadoVenta[]).map((k) => (
              <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={e.ventas.filter((v) => v.estado === k).length}>{ESTADO[k].texto}</Chip>
            ))}
          </div>
        </div>
        <DataTable
          alto={620}
          filas={filas} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          onFila={(v) => abrirFicha(v.id, "ventas", { venta: v.id })} etiquetaFila={(v) => `Ver la ficha de ${v.contactoNombre}`}
          acciones={(v) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm(desdeVenta(e, v))}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(v)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty icono={<HandCoins size={22} />} titulo="Todavía no cargaste ventas"
              texto="Cargá una venta con su plan de cuotas y los cobros empiezan a aparecer solos en Finanzas."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Cargar una venta</Button>} />
          }
        />
      </Card>

      <Ayuda titulo="Cómo se arma una venta" icono={<Info size={18} />}>
        El asistente va de a una pregunta: cliente, producto, precio, quién cerró, de dónde vino
        y cómo se paga. El plan de cuotas se arma solo y se puede tocar cuota por cuota. Si una
        cuota se cobró mitad por Stripe y mitad por USDT, van dos cobros sobre la misma
        cuota; y si la plata ya entró a una pasarela, el cobro se concilia ahí mismo y el fee que
        queda registrado es el real.
      </Ayuda>

      {importando && (
        <ImportarPlanilla onCerrar={() => setImportando(false)} onListo={(m) => { setImportando(false); toast(m); }} />
      )}

      {asistente && (
        <AsistenteVenta
          onCerrar={() => setAsistente(false)}
          onListo={(id, nombre) => { setAsistente(false); abrirFicha(id, "ventas", { venta: id }); toast(`Venta de ${nombre} cargada.`); }}
        />
      )}

      {/* ---------- Alta / edición ---------- */}
      {form && (
        <FormularioVenta
          borrador={form} onCerrar={() => setForm(null)}
          onGuardado={(nombre) => { toast(`Venta de ${nombre} guardada.`); setForm(null); }}
        />
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la venta de ${borrar?.contactoNombre}?`}
        texto="Se borran también sus cuotas y pagos, y el estado de resultados se recalcula. Si sólo se cayó el cliente, mejor cancelala en vez de borrarla."
        onConfirmar={() => { if (borrar) { acciones.eliminar("ventas", borrar.id, borrar.contactoNombre); toast("Venta eliminada."); } }}
      />
    </div>
  );
}
