"use client";

import React, { useMemo } from "react";
import { Select } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { num, pct } from "@/lib/format";
import { useParamsURL } from "@/lib/useParamsURL";
import { COLUMNA, DIMENSIONES, porDimension, resumenDe, type ClaveColumna, type FilaDimension, type FilaTabla } from "@/lib/crm-tabla";
import { textoFecha } from "./FiltroColumna";

/* ==================================================================
   Por qué no se cierra, con los mismos filtros que la tabla (Yari,
   29/09: "tener toda la información del lead y por qué no se cerró de
   forma fácilmente consumible, para después empezar a sacar
   conclusiones").

   Arriba, cuánto se cierra de lo que se presentó; al lado, las
   objeciones. Abajo, lo mismo abierto por lo que se elija: país, edad,
   tecnología, plata, ad… Un clic en una fila filtra la tabla por eso.
   ================================================================== */

export function ResumenCrm({ filas, onFiltrar }: { filas: FilaTabla[]; onFiltrar: (clave: ClaveColumna, valor: string) => void }) {
  const [v, setV] = useParamsURL({ abrir: "objecion" });
  const abrir = (DIMENSIONES.includes(v.abrir as ClaveColumna) ? v.abrir : "objecion") as ClaveColumna;
  const r = useMemo(() => resumenDe(filas), [filas]);
  const dim = useMemo(() => porDimension(filas, abrir), [filas, abrir]);
  const maxObj = Math.max(1, ...r.objeciones.map((o) => o.n));
  const conFecha = abrir === "cierre";

  const columnas: Columna<FilaDimension & { id: string }>[] = [
    { clave: "valor", titulo: COLUMNA[abrir].titulo, tipo: "primary", orden: (x) => x.valor,
      celda: (x) => <span className="truncate" title={x.valor}>{conFecha ? textoFecha(x.valor) : x.valor}</span> },
    { clave: "pasaron", titulo: "Llamadas", tipo: "num", orden: (x) => x.pasaron, celda: (x) => num(x.pasaron) },
    { clave: "presentaron", titulo: "Se presentaron", tipo: "num", orden: (x) => x.presentaron, celda: (x) => num(x.presentaron) },
    { clave: "cierres", titulo: "Con cierre", tipo: "num", orden: (x) => x.cierres, celda: (x) => num(x.cierres) },
    { clave: "pct", titulo: "% de cierre", tipo: "num", orden: (x) => x.pctCierre ?? -1,
      celda: (x) => (x.pctCierre === null ? <span className="t-subtle">—</span> : pct(x.pctCierre, 0)) },
    { clave: "noVino", titulo: "No vinieron", tipo: "num", orden: (x) => x.noVino, celda: (x) => num(x.noVino) },
    { clave: "objecion", titulo: "Objeción más común", orden: (x) => x.objeciones[0]?.objecion ?? "",
      celda: (x) => (x.objeciones[0] ? <span className="truncate">{x.objeciones[0].objecion} <span className="t-subtle">({num(x.objeciones[0].n)})</span></span> : <span className="t-subtle">—</span>) },
  ];

  return (
    <div className="stack-4 crm-res">
      <div className="crm-res__kpis">
        <Kpi etiqueta="Llamadas que pasaron" valor={num(r.pasaron)} sub={r.sinCargar ? `${num(r.sinCargar)} sin cargar` : "todas cargadas"} />
        <Kpi etiqueta="Se presentaron" valor={num(r.presentaron)} sub={r.pasaron ? `${pct((r.presentaron / r.pasaron) * 100, 0)} · ${num(r.noVino)} no vinieron` : undefined} />
        <Kpi etiqueta="Con cierre" valor={num(r.cierres)} sub={`${num(r.sinCierre)} sin cierre`} />
        <Kpi etiqueta="% de cierre" valor={r.pctCierre === null ? "—" : pct(r.pctCierre, 0)} sub="de los que se presentaron" />
      </div>

      <div className="crm-res__objeciones">
        <div className="t-label">Por qué no cerraron</div>
        {r.objeciones.length === 0 ? (
          <p className="t-sm t-subtle">Todavía no hay llamadas sin cierre cargadas en el EOD con estos filtros.</p>
        ) : (
          <div className="stack-2">
            {r.objeciones.map((o) => (
              <button key={o.objecion} type="button" className="crm-res__barra" onClick={() => onFiltrar("objecion", o.objecion)}
                title={`Ver las llamadas con «${o.objecion}»`}>
                <span className="crm-res__barra-nombre truncate">{o.objecion}</span>
                <span className="crm-res__barra-pista"><span style={{ width: `${(o.n / maxObj) * 100}%` }} /></span>
                <span className="crm-res__barra-n t-num">{num(o.n)} · {pct((o.n / r.sinCierre) * 100, 0)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stack-3">
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <span className="t-label">Abrir por</span>
          <div style={{ width: 220 }}>
            <Select value={abrir} aria-label="Abrir por" onChange={(ev) => setV({ abrir: ev.target.value })}
              opciones={DIMENSIONES.map((k) => ({ valor: k, texto: COLUMNA[k].titulo }))} />
          </div>
          <span className="t-sm t-subtle">Un clic en una fila filtra la tabla por eso.</span>
        </div>
        <DataTable
          filas={dim.map((x) => ({ ...x, id: x.valor }))}
          columnas={columnas}
          ordenInicial={{ clave: "presentaron", desc: true }}
          onFila={(x) => onFiltrar(abrir, x.valor)}
          etiquetaFila={(x) => `Filtrar por ${x.valor}`}
          vacio={<p className="t-sm t-subtle" style={{ padding: 16 }}>No hay llamadas con estos filtros.</p>}
        />
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub?: string }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num">{valor}</span>
      {sub && <span className="t-sm t-subtle t-num">{sub}</span>}
    </div>
  );
}
