"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardCheck, ExternalLink, Search, Star, X } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Input, Tabs } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ConfigColumnas, useColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { CopiarLink } from "@/components/ui/Filtros";
import { PageHead } from "@/components/shell/PageHead";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { closersConLlamadas } from "@/lib/eod";
import { num } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { useBusquedaURL, useEscribirURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import { useRangoURL } from "@/lib/useRango";
import {
  COLUMNA, COLUMNAS, coincideBusqueda, filasTabla, filtroAURL, filtrosDeURL, opcionesDeColumna, pasaFiltros,
  VISIBLES_POR_DEFECTO, type ClaveColumna, type FilaTabla, type FiltroColumna as Filtro,
} from "@/lib/crm-tabla";
import { FiltroColumna, textoFecha } from "./FiltroColumna";
import { ResumenCrm } from "./ResumenCrm";
import { Eod } from "./Eod";
import { VARIANTE_RESULTADO } from "./resultado";

/* ==================================================================
   El CRM: una tabla, fácil como un Excel.

   Una fila por llamada, con todo lo que se sabe de la persona: nadie
   carga nada acá (lo que cambia lo carga el closer en su cierre del día,
   el EOD). Cada columna se filtra con un clic en su título, y el
   período, la búsqueda, los filtros y el orden van en el link: se copia
   y abre igual. «Resumen» muestra, con los mismos filtros, cuánto se
   cierra y por qué no.
   ================================================================== */

const FECHAS = new Set<ClaveColumna>(["llamada", "agendo", "cierre"]);
const DEFS: DefColumna[] = COLUMNAS.map((c) => ({ clave: c.clave, titulo: c.titulo, grupo: c.grupo, fija: c.clave === "nombre" }));
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

export function CrmTabla() {
  const e = useEstado();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const [vista, setVista] = useParamsURL({ seccion: "tabla" });
  const [eod, setEod] = useState(false);

  /* El período, por el día de la llamada. De entrada, este mes. */
  const hoy = diaDeNegocio(new Date().toISOString());
  const limites = useMemo(() => {
    const dias = e.sesiones.map((s) => diaDeNegocio(s.inicia)).filter(Boolean).sort();
    const ultimo = dias[dias.length - 1];
    return { min: dias[0] ?? null, max: ultimo && ultimo > hoy ? ultimo : hoy };
  }, [e.sesiones, hoy]);
  const [rango, setRango] = useRangoURL("mes", { futuro: true, limites });

  /* `ahora` al minuto: la fila que pasa de "Por venir" a "Sin cargar". */
  const ahora = Math.floor(Date.now() / 60000) * 60000;
  const todas = useMemo(() => filasTabla(e, ahora), [e, ahora]);
  const enPeriodo = useMemo(
    () => todas.filter((f) => f.dia >= rango.desde && f.dia <= rango.hasta && coincideBusqueda(f, q)),
    [todas, rango.desde, rango.hasta, q],
  );
  const textoParams = params.toString();
  const filtros = useMemo(() => filtrosDeURL(new URLSearchParams(textoParams)), [textoParams]);
  const filas = useMemo(() => enPeriodo.filter((f) => pasaFiltros(f, filtros)), [enPeriodo, filtros]);

  const cols = useColumnas("crm", DEFS, VISIBLES_POR_DEFECTO);
  const tabla = useTablaURL("", { clave: "llamada", desc: true }, COLUMNAS.map((c) => c.clave));

  const cambiarFiltro = useCallback((clave: ClaveColumna, fc: Filtro | null) => {
    escribir({ ...filtroAURL(clave, fc), pag: null });
  }, [escribir]);
  const filtradas = Object.keys(filtros) as ClaveColumna[];
  const limpiar = () => escribir({ ...Object.assign({}, ...filtradas.map((k) => filtroAURL(k, null))), q: null, pag: null });

  /* Si quien mira es un closer, sus llamadas a un clic. */
  const yo = useUsuarioActual();
  const miNombre = yo.miembro && closersConLlamadas(e).includes(yo.miembro.nombre) ? yo.miembro.nombre : "";
  const soloMias = Boolean(miNombre) && filtros.closer?.modo === "solo" && filtros.closer.valores.length === 1 && filtros.closer.valores[0] === miNombre;

  const sinCargar = enPeriodo.filter((f) => f.sinCargar).length;
  const soloSinCargar = filtros.resultado?.modo === "solo" && filtros.resultado.valores.length === 1 && filtros.resultado.valores[0] === "Sin cargar";

  const columnas: Columna<FilaTabla>[] = cols.visibles.map((k) => {
    const col = COLUMNA[k as ClaveColumna];
    return {
      clave: col.clave,
      titulo: col.titulo,
      ancho: col.ancho,
      tipo: col.clave === "nombre" ? "primary" as const : undefined,
      orden: col.orden ?? ((f: FilaTabla) => col.valores(f)[0] ?? ""),
      encabezado: (
        <FiltroColumna
          titulo={col.titulo}
          opciones={() => opcionesDeColumna(enPeriodo, filtros, col.clave)}
          filtro={filtros[col.clave]}
          onFiltro={(fc) => cambiarFiltro(col.clave, fc)}
          orden={tabla.orden?.clave === col.clave ? (tabla.orden.desc ? "desc" : "asc") : undefined}
          onOrdenar={(desc) => tabla.onOrden({ clave: col.clave, desc })}
          fecha={FECHAS.has(col.clave)}
        />
      ),
      celda: (f: FilaTabla) => <Celda clave={col.clave} f={f} />,
    };
  });

  return (
    <div className="stack-5 crm-t">
      <PageHead
        titulo="CRM"
        sub="Cada llamada con todo lo que se sabe de la persona. Filtrá con un clic desde el título de cada columna, como en Excel."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max} futuro
              onApply={(r) => setRango(r, { pag: null })}
              footerNota="Por el día de la llamada · hora de Argentina"
            />
            <Button variante="primary" icono={<ClipboardCheck size={16} />} onClick={() => setEod(true)}>Cerrar el día</Button>
          </>
        }
      />

      <Card className="crm-t__card">
        <div className="crm-t__barra">
          <div className="crm-t__buscar">
            <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por nombre, mail o teléfono" aria-label="Buscar" />
          </div>
          {miNombre && (
            <Chip activo={soloMias} onClick={() => cambiarFiltro("closer", soloMias ? null : { modo: "solo", valores: [miNombre] })}>
              Mis llamadas
            </Chip>
          )}
          <Chip activo={soloSinCargar} count={sinCargar}
            onClick={() => cambiarFiltro("resultado", soloSinCargar ? null : { modo: "solo", valores: ["Sin cargar"] })}>
            Sin cargar
          </Chip>
          <span className="spacer" />
          <Tabs<"tabla" | "resumen">
            valor={vista.seccion === "resumen" ? "resumen" : "tabla"}
            onChange={(v) => setVista({ seccion: v === "tabla" ? null : v })}
            opciones={[{ valor: "tabla", texto: "Tabla" }, { valor: "resumen", texto: "Por qué no se cierra" }]}
          />
          {vista.seccion !== "resumen" && (
            <ConfigColumnas todas={DEFS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} />
          )}
          <CopiarLink />
        </div>

        {(filtradas.length > 0 || q) && (
          <div className="crm-t__filtros">
            {filtradas.map((k) => (
              <span key={k} className="crm-t__pastilla">
                <span className="t-subtle">{COLUMNA[k].titulo}{filtros[k]!.modo === "sin" ? " sin" : ""}:</span>
                <span className="truncate">{filtros[k]!.valores.map((v) => (FECHAS.has(k) ? textoFecha(v) : v)).join(", ")}</span>
                <button type="button" onClick={() => cambiarFiltro(k, null)} aria-label={`Quitar el filtro de ${COLUMNA[k].titulo}`}><X size={13} /></button>
              </span>
            ))}
            <button type="button" className="link t-sm" onClick={limpiar}>Limpiar todo</button>
          </div>
        )}

        <p className="t-sm t-subtle crm-t__cuenta">
          {num(filas.length)} {filas.length === 1 ? "llamada" : "llamadas"}
          {filas.length !== enPeriodo.length ? ` de ${num(enPeriodo.length)} en el período` : " en el período"}
        </p>

        {vista.seccion === "resumen" ? (
          <ResumenCrm filas={filas} onFiltrar={(clave, valor) => { escribir({ ...filtroAURL(clave, { modo: "solo", valores: [valor] }), seccion: null, pag: null }); }} />
        ) : (
          <DataTable
            filas={filas}
            columnas={columnas}
            orden={tabla.orden} onOrden={tabla.onOrden}
            pagina={tabla.pagina} onPagina={tabla.onPagina}
            porPagina={50}
            onFila={(f) => abrirFicha(f.sesion.contactoId ?? f.sesion.leadId ?? f.sesion.id, "llamadas")}
            etiquetaFila={(f) => `Abrir la ficha de ${f.nombre}`}
            vacio={
              <Empty
                icono={<Search size={22} />}
                titulo={filtradas.length || q ? "Ninguna llamada coincide" : "No hay llamadas en este período"}
                texto={filtradas.length || q ? "Probá sacando algún filtro." : "Elegí otro período arriba."}
                accion={filtradas.length || q ? <Button variante="secondary" onClick={limpiar}>Limpiar filtros</Button> : undefined}
              />
            }
          />
        )}
      </Card>

      {eod && <Eod onCerrar={() => setEod(false)} />}
    </div>
  );
}

/* ---------- Cada celda ---------- */

function Celda({ clave, f }: { clave: ClaveColumna; f: FilaTabla }) {
  const nada = <span className="t-subtle">—</span>;
  switch (clave) {
    case "llamada": return <span className="t-num">{textoFecha(f.dia)} · {HORA.format(new Date(f.llamada))}</span>;
    case "agendo": return <span className="t-num">{textoFecha(diaDeNegocio(f.agendo))}</span>;
    case "cierre": return f.cierre ? <span className="t-num">{textoFecha(f.cierre)}</span> : nada;
    case "nombre": return (
      <span className="crm-t__persona">
        <span className="truncate">{f.nombre || "Sin nombre"}</span>
        {f.calificada === "Sí" && <Star size={13} className="estrella-calificada" fill="currentColor" aria-label="Agenda calificada" />}
      </span>
    );
    case "estado": return <Badge variante={f.estado === "Hecha" ? "success" : f.estado === "No vino" ? "danger" : f.estado === "Agendada" ? "info" : "neutral"}>{f.estado}</Badge>;
    case "resultado": return <Badge variante={VARIANTE_RESULTADO[f.resultado] ?? "neutral"}>{f.resultado}</Badge>;
    case "calificada": return f.calificada === "Sí" ? <span className="crm-t__si"><Star size={13} fill="currentColor" className="estrella-calificada" />Sí</span> : <span className="t-subtle">No</span>;
    case "grabacion": return f.grabacion
      ? <a className="link t-sm" href={f.grabacion} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}><ExternalLink size={13} /> Ver</a>
      : nada;
    case "venta": return f.venta ? <span className="crm-t__venta">{f.venta}</span> : nada;
    case "tecnologias": return f.tecnologias.length ? <span className="truncate" title={f.tecnologias.join(", ")}>{f.tecnologias.join(", ")}</span> : nada;
    case "formacion": return f.formacion.length ? <span className="truncate" title={f.formacion.join(", ")}>{f.formacion.join(", ")}</span> : nada;
    default: {
      const v = (f as unknown as Record<string, string>)[clave] ?? "";
      return v ? <span className="truncate" title={v}>{v}</span> : nada;
    }
  }
}
