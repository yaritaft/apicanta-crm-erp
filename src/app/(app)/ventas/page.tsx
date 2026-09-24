"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Download, HandCoins, Info, Pencil, Plus, Search, Trash2, Upload,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Bar, Button, Card, Chip, Empty, IconButton, Input,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { DateRangePicker, diaDeNegocio } from "@/components/ui/DateRangePicker";
import { CopiarLink, Filtro, opcionesDe, SIN, type OpcionFiltro } from "@/components/ui/Filtros";
import { Confirmar } from "@/components/ui/Modal";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { ImportarPlanilla } from "@/components/ventas/ImportarPlanilla";
import { aCSV, filasParaPlanilla } from "@/lib/exportarPlanilla";
import { desdeVenta, FormularioVenta, type BorradorVenta } from "@/components/ventas/FormularioVenta";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { useRangoURL } from "@/lib/useRango";
import { ordenAURL, ordenDeURL, paginaDeURL, useBusquedaURL, useParamsURL } from "@/lib/useParamsURL";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaLarga, money } from "@/lib/format";
import { saldoVenta } from "@/lib/finanzas";
import type { EstadoVenta, Venta } from "@/lib/types";

const ESTADO: Record<EstadoVenta, { texto: string; variante: "success" | "neutral" | "danger" }> = {
  "activa":      { texto: "Activa",      variante: "success" },
  "cancelada":   { texto: "Cancelada",   variante: "neutral" },
  "reembolsada": { texto: "Reembolsada", variante: "danger" },
};
const ESTADOS = Object.keys(ESTADO) as EstadoVenta[];

/* El reporte de ventas entero vive en la URL (ver lib/useParamsURL.ts): el
   link lleva los filtros, el orden y la página, y el período va aparte en
   ?periodo. Vacío es "sin filtro"; lo que está en su valor por defecto no se
   escribe, así un link sin tocar nada es /ventas a secas.
   - estado: saldo · activa · cancelada · reembolsada
   - vendedor, servicio, estrategia: el id, o "sin"
   - proyecto: el proyecto tal cual se escribió, o "sin"
   - cuenta: el id de la cuenta recaudadora de alguno de sus cobros
   - orden: la columna, con "-" adelante si va de mayor a menor
   - pag: la página, desde 1 */
const VISTA_VENTAS = {
  estado: "", vendedor: "", servicio: "", estrategia: "", proyecto: "", cuenta: "",
  orden: "-fecha", pag: "1",
};
const ORDEN_INICIAL = { clave: "fecha", desc: true };
const COLUMNAS_QUE_ORDENAN = ["contacto", "producto", "proyecto", "estrategia", "closer", "fecha", "precio", "saldo"];
const POR_PAGINA = 50;

type Faceta = "estado" | "vendedor" | "servicio" | "estrategia" | "proyecto" | "cuenta";
const FACETAS: Faceta[] = ["estado", "vendedor", "servicio", "estrategia", "proyecto", "cuenta"];

/* Lo que cada venta tiene en cada filtro de un solo valor. */
const valorDe = {
  vendedor: (v: Venta) => v.closerId || SIN,
  servicio: (v: Venta) => v.productoId || SIN,
  estrategia: (v: Venta) => v.embudoId || SIN,
  proyecto: (v: Venta) => v.proyecto?.trim() || SIN,
};

/* Sin mayúsculas ni tildes: "benitez" encuentra a "Benítez". */
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function Ventas() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const abrirFicha = useAbrirFicha();
  const [form, setForm] = useState<BorradorVenta | null>(null);
  const [asistente, setAsistente] = useState(false);
  const [borrar, setBorrar] = useState<Venta | null>(null);
  const [importando, setImportando] = useState(false);

  const [vista, setVista] = useParamsURL(VISTA_VENTAS);
  const [busca, setBusca] = useBusquedaURL("q", ["pag"]);

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

  /* ---------- Período ----------
     Arranca en "Máximo", que es lo que se veía siempre: todas las ventas. Va
     de la primera venta a la última (o a hoy) y se recalcula contra los
     datos, así una venta nueva nunca queda afuera de un link guardado. */
  const limites = useMemo(() => {
    const dias = e.ventas.map((v) => diaDeNegocio(v.fecha)).filter(Boolean).sort();
    const hoy = diaDeNegocio(new Date().toISOString());
    const ultimo = dias[dias.length - 1];
    return { min: dias[0] ?? null, max: ultimo && ultimo > hoy ? ultimo : hoy };
  }, [e.ventas]);
  const [rango, setRango] = useRangoURL("max", { limites });

  /* Una pasada por venta: el chip "Con saldo", su filtro y la columna Cobrado
     leen de acá, en vez de recorrer cuotas y cobros en cada celda. */
  const saldos = useMemo(() => new Map(e.ventas.map((v) => [v.id, saldoVenta(e, v.id)])), [e]);

  /* Por qué cuentas entró la plata de cada venta: el cobro cuelga de una
     cuota, y la cuota de la venta. */
  const cuentasDeVenta = useMemo(() => {
    const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId]));
    const m = new Map<string, Set<string>>();
    for (const p of e.pagos) {
      const ventaId = ventaDeCuota.get(p.cuotaId);
      if (!ventaId || !p.procesadorId) continue;
      if (!m.has(ventaId)) m.set(ventaId, new Set());
      m.get(ventaId)!.add(p.procesadorId);
    }
    return m;
  }, [e.cuotas, e.pagos]);

  /* Cada desplegable ofrece lo que existe en las ventas, no el catálogo
     entero: un vendedor que nunca vendió no filtra nada. */
  const opciones = useMemo(() => {
    const nombre = (xs: { id: string; nombre: string }[], id: string, otro: string) =>
      xs.find((x) => x.id === id)?.nombre ?? otro;
    return {
      vendedor: opcionesDe(e.ventas.map(valorDe.vendedor), (id) => nombre(e.equipo, id, "Ya no está en el equipo"), "Sin vendedor"),
      servicio: opcionesDe(e.ventas.map(valorDe.servicio), (id) => nombre(e.productos, id, "Servicio borrado"), "Sin servicio"),
      estrategia: opcionesDe(e.ventas.map(valorDe.estrategia), (id) => nombre(e.embudos, id, "Estrategia borrada"), "Sin estrategia"),
      proyecto: opcionesDe(e.ventas.map(valorDe.proyecto), (p) => p, "Sin proyecto"),
      cuenta: opcionesDe([...cuentasDeVenta.values()].flatMap((s) => [...s]), (id) => nombre(e.procesadores, id, "Cuenta borrada"), ""),
    };
  }, [e.ventas, e.equipo, e.productos, e.embudos, e.procesadores, cuentasDeVenta]);

  /* Lo que dice la URL, validado: un filtro que apunta a algo que ya no
     existe (un link viejo, un vendedor borrado) se ignora en vez de dejar la
     tabla vacía sin explicación. */
  const f = useMemo<Record<Faceta, string>>(() => {
    const valido = (lista: OpcionFiltro[], v: string) => (lista.some((o) => o.valor === v) ? v : "");
    return {
      estado: vista.estado === "saldo" || (ESTADOS as string[]).includes(vista.estado) ? vista.estado : "",
      vendedor: valido(opciones.vendedor, vista.vendedor),
      servicio: valido(opciones.servicio, vista.servicio),
      estrategia: valido(opciones.estrategia, vista.estrategia),
      proyecto: valido(opciones.proyecto, vista.proyecto),
      cuenta: valido(opciones.cuenta, vista.cuenta),
    };
  }, [vista, opciones]);

  /* Las filas, y cuántas hay de cada opción. Cada filtro cuenta sobre lo que
     dejan pasar los DEMÁS (el período, la búsqueda y el resto de los
     filtros), no sobre la base entera: si el período es "este mes", un
     número que cuenta todo el histórico le miente al que lo lee. */
  const { filas, cuentas } = useMemo(() => {
    const conSaldo = (v: Venta) => v.estado === "activa" && (saldos.get(v.id)?.saldo ?? 0) > 0.01;
    const pasa: Record<Faceta, (v: Venta) => boolean> = {
      estado: (v) => !f.estado || (f.estado === "saldo" ? conSaldo(v) : v.estado === f.estado),
      vendedor: (v) => !f.vendedor || valorDe.vendedor(v) === f.vendedor,
      servicio: (v) => !f.servicio || valorDe.servicio(v) === f.servicio,
      estrategia: (v) => !f.estrategia || valorDe.estrategia(v) === f.estrategia,
      proyecto: (v) => !f.proyecto || valorDe.proyecto(v) === f.proyecto,
      cuenta: (v) => !f.cuenta || !!cuentasDeVenta.get(v.id)?.has(f.cuenta),
    };
    const t = normal(busca.trim());
    const base = e.ventas.filter((v) => {
      /* Una venta sin fecha sólo aparece en "Máximo": no se puede decir que
         sea de este mes, pero tampoco puede desaparecer del todo. */
      const dia = diaDeNegocio(v.fecha);
      const enPeriodo = dia ? dia >= rango.desde && dia <= rango.hasta : rango.preset === "max";
      return enPeriodo && (!t || normal(v.contactoNombre).includes(t));
    });
    const salvo = (x: Faceta) => base.filter((v) => FACETAS.every((g) => g === x || pasa[g](v)));
    const contar = (xs: Venta[], claves: (v: Venta) => Iterable<string>) => {
      const m = new Map<string, number>();
      for (const v of xs) for (const k of claves(v)) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const paraEstado = salvo("estado");
    return {
      filas: base.filter((v) => FACETAS.every((g) => pasa[g](v))),
      cuentas: {
        estado: {
          todas: paraEstado.length,
          saldo: paraEstado.filter(conSaldo).length,
          porEstado: contar(paraEstado, (v) => [v.estado]),
        },
        vendedor: contar(salvo("vendedor"), (v) => [valorDe.vendedor(v)]),
        servicio: contar(salvo("servicio"), (v) => [valorDe.servicio(v)]),
        estrategia: contar(salvo("estrategia"), (v) => [valorDe.estrategia(v)]),
        proyecto: contar(salvo("proyecto"), (v) => [valorDe.proyecto(v)]),
        cuenta: contar(salvo("cuenta"), (v) => cuentasDeVenta.get(v.id) ?? []),
      },
    };
  }, [e.ventas, rango, busca, f, saldos, cuentasDeVenta]);

  const conCuenta = (xs: OpcionFiltro[], m: Map<string, number>) => xs.map((o) => ({ ...o, cuenta: m.get(o.valor) ?? 0 }));

  /* Cambiar un filtro vuelve a la primera página: quedarse en la 7 de un
     resultado que ahora tiene 2 muestra una tabla vacía. */
  const filtrar = (faceta: Faceta, valor: string) => setVista({ [faceta]: valor || null, pag: null });

  /* Limpia lo que recorta la lista. El período y el orden quedan: se eligen
     aparte, arriba y en la tabla, y se ven siempre. */
  const hayFiltros = FACETAS.some((k) => f[k]) || busca.trim() !== "";
  function limpiarFiltros() {
    setBusca("");
    setVista(
      { estado: null, vendedor: null, servicio: null, estrategia: null, proyecto: null, cuenta: null, pag: null },
      { q: null },
    );
  }

  const nombreDe = (xs: { id: string; nombre: string }[], id?: string) => (id ? xs.find((x) => x.id === id)?.nombre : undefined);

  const columnas: Columna<Venta>[] = [
    { clave: "contacto", titulo: "Nombre Completo", tipo: "primary", orden: (v) => v.contactoNombre, celda: (v) => v.contactoNombre },
    /* Se ordena por el nombre que se ve, no por el id: ordenar por id dejaba
       los servicios agrupados en un orden que nadie entendía. */
    { clave: "producto", titulo: "Servicio adquirido", tipo: "secondary", orden: (v) => nombreDe(e.productos, v.productoId) ?? "", celda: (v) => nombreDe(e.productos, v.productoId) ?? "—" },
    { clave: "proyecto", titulo: "Proyecto", tipo: "secondary", orden: (v) => v.proyecto ?? "", celda: (v) => v.proyecto || "—" },
    { clave: "estrategia", titulo: "Estrategia", tipo: "secondary", orden: (v) => nombreDe(e.embudos, v.embudoId) ?? "", celda: (v) => nombreDe(e.embudos, v.embudoId) ?? "—" },
    { clave: "closer", titulo: "Vendedor", tipo: "secondary", orden: (v) => nombreDe(e.equipo, v.closerId) ?? "", celda: (v) => nombreDe(e.equipo, v.closerId) ?? "—" },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (v) => v.fecha, celda: (v) => fechaLarga(v.fecha) },
    { clave: "precio", titulo: "Valor total", tipo: "num", orden: (v) => v.precioAcordado, celda: (v) => M(v.precioAcordado) },
    {
      clave: "saldo", titulo: "Cobrado", orden: (v) => { const s = saldos.get(v.id); return s && s.total > 0 ? s.cobrado / s.total : 0; },
      celda: (v) => {
        const s = saldos.get(v.id);
        const p = s && s.total > 0 ? (s.cobrado / s.total) * 100 : 0;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
            <span style={{ flex: 1 }}><Bar valor={p} tono={p >= 99 ? "success" : "accent"} /></span>
            <span className="t-sm t-num t-subtle">{Math.round(p)}%</span>
          </span>
        );
      },
    },
  ];

  const orden = ordenDeURL(vista.orden, COLUMNAS_QUE_ORDENAN, ORDEN_INICIAL);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Ventas"
        sub="Cada venta con su plan de cuotas. Una cuota puede cobrarse con varios métodos y cada pago queda atado a su procesador."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max}
              onApply={(r) => setRango(r, { pag: null })}
              footerNota="Por la fecha de la venta · zona horaria de Argentina"
            />
            <Button variante="secondary" icono={<Upload size={16} />} onClick={() => setImportando(true)}>Importar planilla</Button>
            <Button variante="secondary" icono={<Download size={16} />} onClick={exportarPlanilla}>Exportar planilla</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Nueva venta</Button>
          </>
        }
      />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          {/* Un desplegable de una sola opción no recorta nada: no se muestra.
              La cuenta es otra cosa — "cobró por acá" deja afuera las ventas
              sin cobros —, así que con una ya sirve. */}
          <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
            {opciones.vendedor.length > 1 && (
              <Filtro etiqueta="Filtrar por vendedor" todos="Todos los vendedores" valor={f.vendedor}
                opciones={conCuenta(opciones.vendedor, cuentas.vendedor)} onCambiar={(v) => filtrar("vendedor", v)} />
            )}
            {opciones.servicio.length > 1 && (
              <Filtro etiqueta="Filtrar por servicio" todos="Todos los servicios" valor={f.servicio}
                opciones={conCuenta(opciones.servicio, cuentas.servicio)} onCambiar={(v) => filtrar("servicio", v)} />
            )}
            {opciones.estrategia.length > 1 && (
              <Filtro etiqueta="Filtrar por estrategia" todos="Todas las estrategias" valor={f.estrategia}
                opciones={conCuenta(opciones.estrategia, cuentas.estrategia)} onCambiar={(v) => filtrar("estrategia", v)} />
            )}
            {opciones.proyecto.length > 1 && (
              <Filtro etiqueta="Filtrar por proyecto" todos="Todos los proyectos" valor={f.proyecto}
                opciones={conCuenta(opciones.proyecto, cuentas.proyecto)} onCambiar={(v) => filtrar("proyecto", v)} />
            )}
            {opciones.cuenta.length > 0 && (
              <Filtro etiqueta="Filtrar por cuenta recaudadora" todos="Todas las cuentas" valor={f.cuenta}
                opciones={conCuenta(opciones.cuenta, cuentas.cuenta)} onCambiar={(v) => filtrar("cuenta", v)} />
            )}
            <div className="buscador">
              <Input
                icono={<Search size={18} />} value={busca} onChange={(ev) => setBusca(ev.target.value)}
                placeholder="Buscá por nombre…" aria-label="Buscar ventas por nombre"
              />
            </div>
          </div>
          <div className="toolbar">
            <Chip activo={!f.estado} onClick={() => filtrar("estado", "")} count={cuentas.estado.todas}>Todas</Chip>
            <Chip activo={f.estado === "saldo"} onClick={() => filtrar("estado", "saldo")} count={cuentas.estado.saldo}>Con saldo</Chip>
            {ESTADOS.map((k) => (
              <Chip key={k} activo={f.estado === k} onClick={() => filtrar("estado", k)} count={cuentas.estado.porEstado.get(k) ?? 0}>{ESTADO[k].texto}</Chip>
            ))}
            <span className="spacer" />
            {hayFiltros && <Button sm variante="ghost" onClick={limpiarFiltros}>Limpiar filtros</Button>}
            <CopiarLink />
          </div>
        </div>
        <DataTable
          alto={620} porPagina={POR_PAGINA}
          filas={filas} columnas={columnas}
          orden={orden} onOrden={(o) => setVista({ orden: ordenAURL(o), pag: null })}
          pagina={paginaDeURL(vista.pag) - 1} onPagina={(p) => setVista({ pag: String(p + 1) })}
          onFila={(v) => abrirFicha(v.id, "ventas", { venta: v.id })} etiquetaFila={(v) => `Ver la ficha de ${v.contactoNombre}`}
          acciones={(v) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm(desdeVenta(e, v))}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(v)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={e.ventas.length === 0 ? (
            <Empty icono={<HandCoins size={22} />} titulo="Todavía no cargaste ventas"
              texto="Cargá una venta con su plan de cuotas y los cobros empiezan a aparecer solos en Finanzas."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Cargar una venta</Button>} />
          ) : (
            <Empty icono={<HandCoins size={22} />} titulo="Ninguna venta coincide"
              texto={hayFiltros ? "Probá con otro período o sacá algún filtro." : "No hay ventas en este período. Probá con otro."}
              accion={hayFiltros ? <Button variante="secondary" onClick={limpiarFiltros}>Limpiar filtros</Button> : undefined} />
          )}
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
