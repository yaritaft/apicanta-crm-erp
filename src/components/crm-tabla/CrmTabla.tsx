"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardCheck, ExternalLink, Pencil, Search, Star, X } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Input, Tabs } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ConfigColumnas, useColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { CopiarLink } from "@/components/ui/Filtros";
import { PageHead } from "@/components/shell/PageHead";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { acciones, useEstado, type CambiosLlamada } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useUsuarioActual } from "@/lib/usuario";
import { closersConLlamadas, objecionesDe, TEXTO_RESULTADO } from "@/lib/eod";
import { miembroDeCloser } from "@/lib/crm";
import { leadDeSesion } from "@/lib/etapas-auto";
import type { ColorCrm, OpcionCrm } from "@/lib/types";
import { num } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { useBusquedaURL, useEscribirURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import { useRangoURL } from "@/lib/useRango";
import {
  COLUMNA, COLUMNAS, coincideBusqueda, EDITOR, escrituraDe, filasTabla, filtroAURL, filtrosDeURL, opcionesDeColumna,
  OPCIONES_ESTADO, OPCIONES_RESULTADO, PAISES, pasaFiltros, POR_QUE_NO, VACIAS, valorEditable,
  VISIBLES_POR_DEFECTO, type ClaveColumna, type FilaTabla, type FiltroColumna as Filtro,
} from "@/lib/crm-tabla";
import { tituloPerfil, type CampoPerfil } from "@/lib/perfil";
import { CeldaEditable } from "./CeldaEditable";
import { FiltroColumna, textoFecha } from "./FiltroColumna";
import { ResumenCrm } from "./ResumenCrm";
import { Eod } from "./Eod";
import { VARIANTE_RESULTADO } from "./resultado";

/* ==================================================================
   El CRM: una tabla, fácil como un Excel.

   Una fila por llamada, con todo lo que se sabe de la persona, que se
   llena sola (y con lo que el closer carga en su cierre del día, el EOD).
   Cada columna se filtra con un clic en su título, y el período, la
   búsqueda, los filtros y el orden van en el link: se copia y abre igual.
   «Resumen» muestra, con los mismos filtros, cuánto se cierra y por qué
   no.

   Y se corrige ahí mismo (02/10): un clic en la celda la abre, Enter
   guarda y el aviso trae «Deshacer». Lo que es de la llamada cambia esa
   llamada; lo que es de la persona, todas sus llamadas. Lo que sale solo
   (la fecha, la vía, el ad, si califica, la venta) no se edita y lo dice
   al pasar el mouse. El nombre abre la ficha. Qué guarda cada celda está
   en lib/crm-tabla (escrituraDe).
   ================================================================== */

const FECHAS = new Set<ClaveColumna>(["llamada", "agendo", "cierre"]);
const DEFS: DefColumna[] = COLUMNAS.map((c) => ({ clave: c.clave, titulo: c.titulo, grupo: c.grupo, fija: c.clave === "nombre" }));
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

/* Lo que es de la persona (se guarda en su contacto) y lo que es de la llamada. */
const DE_LA_PERSONA = new Set<ClaveColumna>(["nombre", "email", "telefono", "pais", "edad", "tecnologias", "ingles", "experiencia", "formacion", "ingreso", "inversion"]);
/* Las que se eligen de una lista y se pueden dejar vacías. */
const VACIABLES = new Set<ClaveColumna>(["resultado", "objecion", "oferta"]);
const PERFIL: Partial<Record<ClaveColumna, CampoPerfil>> = {
  edad: "edad", tecnologias: "tecnologias", ingles: "ingles", experiencia: "experiencia", formacion: "formacion", ingreso: "ingreso", inversion: "inversion",
};
const COLOR_RESULTADO: Record<string, ColorCrm> = {
  [TEXTO_RESULTADO.compro]: "verde2", [TEXTO_RESULTADO["no-compro"]]: "naranja1", [TEXTO_RESULTADO["no-vino"]]: "rojo1", [TEXTO_RESULTADO.reprogramo]: "azul1",
};
const COLOR_ESTADO: Record<string, ColorCrm> = { Agendada: "azul1", Hecha: "verde2", "No vino": "rojo1", Cancelada: "gris2" };
const opciones = (xs: string[], color: (x: string) => ColorCrm = () => "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color: color(nombre) }));

export function CrmTabla() {
  const e = useEstado();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const [vista, setVista] = useParamsURL({ seccion: "tabla" });
  const [eod, setEod] = useState(false);
  const toast = useToast();
  /* La celda que se está corrigiendo, y la llamada a la que se le carga la venta. */
  const [editando, setEditando] = useState<{ id: string; clave: ClaveColumna } | null>(null);
  const [ventaPara, setVentaPara] = useState<string | null>(null);
  /* Cada tipo de cuenta corrige lo que edita (y la base lo traba igual). */
  const { acceso } = useAcceso();
  const puedeLlamadas = puedeEditar(acceso, "sesiones");
  const puedePersonas = puedeEditar(acceso, "contactos");

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

  /* ---------- Corregir en la celda ---------- */
  const opcionesDe = useMemo<Partial<Record<ClaveColumna, OpcionCrm[]>>>(() => {
    const closers = new Set([...closersConLlamadas(e), ...e.equipo.filter((m) => m.rol === "closer" && m.activo).map((m) => m.nombre)]);
    return {
      closer: opciones([...closers].sort((a, b) => a.localeCompare(b, "es"))),
      estado: opciones(OPCIONES_ESTADO, (x) => COLOR_ESTADO[x] ?? "gris1"),
      resultado: opciones(OPCIONES_RESULTADO, (x) => COLOR_RESULTADO[x] ?? "gris1"),
      objecion: opciones(objecionesDe(e.ajustes), () => "amarillo1"),
      oferta: [{ nombre: "Sí", color: "verde1" }, { nombre: "No", color: "gris1" }],
    };
  }, [e]);
  /* Para escribir menos: los valores que ya existen en esa columna. */
  const sugerenciasDe = (clave: ClaveColumna): string[] | undefined => {
    if (clave === "pais") return PAISES;
    if (EDITOR[clave] !== "sugerencias") return undefined;
    return [...new Set(todas.flatMap((f) => COLUMNA[clave].valores(f)))].filter((v) => v !== VACIAS).sort((a, b) => a.localeCompare(b, "es", { numeric: true })).slice(0, 80);
  };

  const guardarCelda = (f: FilaTabla, clave: ClaveColumna, valor: string) => {
    const w = escrituraDe(f, clave, valor, { ajustes: e.ajustes, quien: yo.nombre, cuando: new Date().toISOString() });
    if (!w) return;
    const titulo = COLUMNA[clave].titulo;
    let deshacer: () => void;
    if (w.tipo === "llamada") {
      /* Lo que tenía la llamada en cada campo que cambia, y la etapa de su
         lead si el cambio lo movió: deshacer lo deja como estaba. */
      const antes = Object.fromEntries(Object.keys(w.cambios).map((k) => [k, (f.sesion as unknown as Record<string, unknown>)[k]])) as CambiosLlamada;
      const { etapas } = acciones.editarLlamadas([{ id: w.id, cambios: w.cambios, detalle: w.detalle }]);
      deshacer = () => { acciones.editarLlamadas([{ id: w.id, cambios: antes, detalle: `${f.nombre}: se deshizo el cambio de ${titulo}.` }], etapas); };
    } else if (w.tipo === "persona") {
      const antes = valorEditable(f, clave);
      acciones.corregirPersona(w.id, w.cambios);
      deshacer = () => acciones.corregirPersona(w.id, { [clave]: antes });
    } else {
      const antes = w.campo === "pais" ? f.paisCargado : f.corregido[w.campo] ?? "";
      acciones.corregirPerfil(w.id, w.campo, w.valor, w.detalle);
      deshacer = () => { acciones.corregirPerfil(w.id, w.campo, antes, `${f.nombre}: se deshizo el cambio de ${titulo}.`); };
    }
    /* Con cierre y sin la venta cargada: el botón para cargarla ahí mismo. */
    if (clave === "resultado" && valor === TEXTO_RESULTADO.compro && !f.venta) {
      toast(`${f.nombre || "La llamada"}: con cierre. ¿Cargás la venta?`, "info", { texto: "Cargar la venta", onClick: () => setVentaPara(f.id) });
      return;
    }
    const aQuienes = DE_LA_PERSONA.has(clave) && todas.filter((x) => x.personaId === f.personaId).length > 1 ? " (en todas sus llamadas)" : "";
    toast(`${titulo} de ${f.nombre || "la llamada"}: ${valor.trim() || "vacío"}${aQuienes}.`, "ok", { texto: "Deshacer", onClick: deshacer });
  };
  const verFicha = (f: FilaTabla) => abrirFicha(f.sesion.contactoId ?? f.sesion.leadId ?? f.sesion.id, "llamadas");

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
      celda: (f: FilaTabla) => {
        const abierta = editando?.id === f.id && editando.clave === col.clave;
        return (
          <CeldaCrm
            clave={col.clave} f={f} puede={DE_LA_PERSONA.has(col.clave) ? puedePersonas : puedeLlamadas}
            abierta={abierta} onAbrir={() => setEditando({ id: f.id, clave: col.clave })}
            onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === col.clave ? null : x))}
            onGuardar={(v) => guardarCelda(f, col.clave, v)} onFicha={() => verFicha(f)}
            opciones={opcionesDe[col.clave]} sugerencias={abierta ? sugerenciasDe(col.clave) : undefined}
          />
        );
      },
    };
  });

  /* La venta se carga en el asistente de siempre, con la persona y el
     closer de la llamada ya elegidos (igual que desde el cierre del día). */
  if (ventaPara) {
    const f = todas.find((x) => x.id === ventaPara);
    const lead = f ? leadDeSesion(e.leads, f.sesion) : undefined;
    return (
      <AsistenteVenta
        cliente={lead && f ? { contactoId: lead.id, nombre: f.nombre, email: f.email } : undefined}
        closerId={f?.sesion.anfitrion ? miembroDeCloser(f.sesion.anfitrion, e.equipo)?.id : undefined}
        sesionId={ventaPara}
        onCerrar={() => setVentaPara(null)}
        onListo={(_id, nombre) => { setVentaPara(null); toast(`Venta de ${nombre} registrada: ya es cliente.`); }}
      />
    );
  }

  return (
    <div className="stack-5 crm-t">
      <PageHead
        titulo="CRM"
        sub="Cada llamada con todo lo que se sabe de la persona. Filtrá desde el título de cada columna y corregí con un clic en la celda, como en Excel."
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

/* La celda con su edición. El nombre abre la ficha (lo de siempre) y se
   corrige con el lápiz; el resto de las que se editan, con un clic. */
function CeldaCrm({ clave, f, puede, abierta, onAbrir, onCerrar, onGuardar, onFicha, opciones, sugerencias }: {
  clave: ClaveColumna; f: FilaTabla; puede: boolean; abierta: boolean;
  onAbrir: () => void; onCerrar: () => void; onGuardar: (valor: string) => void; onFicha: () => void;
  opciones?: OpcionCrm[]; sugerencias?: string[];
}) {
  const editor = EDITOR[clave];
  const titulo = COLUMNA[clave].titulo;
  if (clave === "nombre") {
    if (abierta) return <CeldaEditable editor="texto" valor={f.nombre} titulo={titulo} abierta onAbrir={onAbrir} onCerrar={onCerrar} onGuardar={onGuardar}>{null}</CeldaEditable>;
    return (
      <span className="crm-t__persona">
        <button type="button" className="crm-t__abrir truncate" onClick={onFicha} title={`Abrir la ficha de ${f.nombre || "esta persona"}`}>{f.nombre || "Sin nombre"}</button>
        {f.calificada === "Sí" && <Star size={13} className="estrella-calificada" fill="currentColor" aria-label="Agenda calificada" />}
        {puede && (
          <button type="button" className="crm-t__lapiz" onClick={onAbrir} aria-label={`Corregir el nombre de ${f.nombre || "esta persona"}`} title="Corregir el nombre">
            <Pencil size={12} />
          </button>
        )}
      </span>
    );
  }
  if (!editor || !puede) {
    return <span className="crm-t__fija" title={POR_QUE_NO[clave]}><Celda clave={clave} f={f} /></span>;
  }
  const campo = PERFIL[clave];
  const corregida = Boolean(campo && f.corregido[campo]);
  return (
    <CeldaEditable
      editor={editor} valor={valorEditable(f, clave)} titulo={titulo} abierta={abierta}
      onAbrir={onAbrir} onCerrar={onCerrar} onGuardar={onGuardar}
      opciones={opciones} sugerencias={sugerencias} vaciable={VACIABLES.has(clave)}
      className={corregida ? "crm-t__editable--corregida" : undefined}
      ayuda={corregida && campo ? `${tituloPerfil(campo)} corregido a mano. Vaciá la celda para volver a lo que contestó al agendar.` : undefined}
    >
      <Celda clave={clave} f={f} />
    </CeldaEditable>
  );
}

function Celda({ clave, f }: { clave: ClaveColumna; f: FilaTabla }) {
  const nada = <span className="t-subtle">—</span>;
  switch (clave) {
    case "llamada": return <span className="t-num">{textoFecha(f.dia)} · {HORA.format(new Date(f.llamada))}</span>;
    case "agendo": return <span className="t-num">{textoFecha(diaDeNegocio(f.agendo))}</span>;
    case "cierre": return f.cierre ? <span className="t-num">{textoFecha(f.cierre)}</span> : nada;
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
