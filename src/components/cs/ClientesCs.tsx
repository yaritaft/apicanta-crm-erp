"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDown, Hash, Pencil, PhoneCall, PhoneMissed, Plus, Settings2, UserX } from "lucide-react";
import { Button, Chip, IconButton } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { useGestos } from "@/components/alumnos/Seguimiento";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn, puedeEditar } from "@/lib/permisos";
import { useEscribirURL } from "@/lib/useParamsURL";
import { PAISES } from "@/lib/crm-tabla";
import { configSeguimiento, formatoDia, hoyDelNegocio, textoDeAtraso } from "@/lib/seguimiento";
import {
  aplicarEscritura, CONTRATOS, coincideCliente, EDITOR_CLIENTE, escrituraCliente, filasClientes, listasCs,
  MOTOR_CLIENTES, ORDEN_CLIENTES, ORDEN_REPORTE, OPCIONES_ESTADO_ALUMNO, POR_QUE_NO_CLIENTE, resumenClientes, SESIONES_MENTOR,
  valorEditableCliente, VISIBLES_CLIENTES, type ClaveCliente, type FilaCliente,
} from "@/lib/clientes-cs";
import { SI } from "@/lib/tabla-cs";
import type { Alumno, ColorCrm, OpcionCrm } from "@/lib/types";
import { FichaClienteCs } from "./FichaClienteCs";
import { AjustarCs } from "./AjustarCs";
import { ImportarCs } from "./ImportarCs";
import { Pastilla } from "./pastillas";
import { NADA, Recorte, TablaCs } from "./TablaCs";

/* ==================================================================
   Clientes: la lista de Customer Success con las 29 columnas que Lili lleva
   en su Airtable (respuesta del 09/10), más el CV y el LinkedIn corregidos.

   Una fila por alumno. Lo que ya sabe el alumno o su venta se lee de ahí; lo
   que sólo lleva Customer Success se corrige en la celda (un clic, Enter
   guarda, y el aviso trae «Deshacer») o en la ficha completa (el lápiz del
   nombre). La tabla se filtra como un Excel: cada columna tiene su filtro, y
   todo viaja en el link (lib/tabla-cs.ts).
   ================================================================== */

const opciones = (xs: readonly string[], color: ColorCrm = "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color }));

export function ClientesCs({ onNuevo }: { onNuevo: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const gestos = useGestos();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const puede = puedeEditar(acceso, "seguimiento_alumnos");
  const puedeAjustar = nivelEn(acceso, "ajustes") === 2;
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const filas = useMemo(() => filasClientes(e, hoy), [e, hoy]);
  const resumen = useMemo(() => resumenClientes(filas), [filas]);

  const [editando, setEditando] = useState<{ id: string; clave: ClaveCliente } | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState(false);
  const [importando, setImportando] = useState(false);

  /* Los valores de cada lista, en el orden en que se cargaron: así se ordena y se filtra. */
  const ordenValores = useMemo(() => ({
    stack: listas.stacks, acceso: listas.accesos, followUp: listas.followUps, contrato: CONTRATOS, estadoContrato: listas.estadosContrato,
    reporte: ORDEN_REPORTE as string[], estadoAlumno: OPCIONES_ESTADO_ALUMNO.map((o) => o.texto),
    programa: listas.programas,
  }), [listas]);

  /* ---------- Atajos ---------- */
  const filtros = MOTOR_CLIENTES.filtrosDeURL(new URLSearchParams(params.toString()));
  const atajo = (clave: ClaveCliente, valores: string[]) => {
    const f = filtros[clave];
    return Boolean(f && f.modo === "solo" && f.valores.length === valores.length && valores.every((v) => f.valores.includes(v)));
  };
  const alternarAtajo = (clave: ClaveCliente, valores: string[]) =>
    escribir({ ...MOTOR_CLIENTES.filtroAURL(clave, atajo(clave, valores) ? null : { modo: "solo", valores }), [MOTOR_CLIENTES.paramPagina]: null });
  const activos = filas.filter((f) => f.alumno.estado === "activo");
  const cuenta = (p: (f: FilaCliente) => boolean) => activos.filter(p).length;
  const atajos = (
    <div className="cs-atajos">
      <Chip activo={atajo("estadoAlumno", ["Activo"])} count={resumen.activos} onClick={() => alternarAtajo("estadoAlumno", ["Activo"])}>Activos</Chip>
      <Chip activo={atajo("cv", ["Pendiente"])} count={resumen.cvPendiente} onClick={() => alternarAtajo("cv", ["Pendiente"])}
        title="Alumnos activos con el CV sin corregir">CV pendiente</Chip>
      <Chip activo={atajo("linkedin", ["Pendiente"])} count={resumen.linkedinPendiente} onClick={() => alternarAtajo("linkedin", ["Pendiente"])}
        title="Alumnos activos con el LinkedIn sin corregir">LinkedIn pendiente</Chip>
      <Chip activo={atajo("reporte", ["Atrasado", "Inactivo"])} count={cuenta((f) => f.reporte.estado === "Atrasado" || f.reporte.estado === "Inactivo")}
        onClick={() => alternarAtajo("reporte", ["Atrasado", "Inactivo"])} title="Activos que deben el reporte semanal">Reporte atrasado</Chip>
    </div>
  );

  /* ---------- Corregir en la celda ---------- */
  const opcionesDe = (clave: ClaveCliente): OpcionCrm[] | undefined => {
    switch (clave) {
      case "stack": return opciones(listas.stacks);
      case "acceso": return opciones(listas.accesos);
      case "followUp": return opciones(listas.followUps);
      case "contrato": return opciones(CONTRATOS);
      case "estadoContrato": return opciones(listas.estadosContrato);
      case "mentor": return opciones(SESIONES_MENTOR.map((n) => `${n} ${n === 1 ? "sesión" : "sesiones"}`));
      case "estadoAlumno": return opciones(OPCIONES_ESTADO_ALUMNO.map((o) => o.texto));
      default: return undefined;
    }
  };
  const sugerenciasDe = (clave: ClaveCliente): string[] | undefined => {
    const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    if (clave === "pais") return PAISES;
    if (clave === "plan") return unicos(["Pago único", ...filas.map((f) => f.plan)]);
    if (clave === "garantia") return unicos([...listas.garantias, ...filas.map((f) => f.garantia)]);
    if (clave === "closer") return unicos(e.equipo.filter((m) => m.rol === "closer" && m.activo).map((m) => m.nombre));
    if (clave === "responsableCv") return unicos([...e.equipo.map((m) => m.nombre), ...filas.map((f) => f.responsableCv)]);
    return undefined;
  };

  const guardarCelda = (f: FilaCliente, clave: ClaveCliente, valor: string) => {
    const w = escrituraCliente(f, clave, valor, listas);
    const titulo = MOTOR_CLIENTES.columna[clave].titulo;
    if (w.tipo === "no") { toast(w.motivo, "err"); return; }
    if (w.tipo === "seguimiento" || w.tipo === "correccion") {
      const cuando = new Date().toISOString();
      const descripcion = w.tipo === "seguimiento" ? w.detalle : `${w.que === "cv" ? "CV" : "LinkedIn"} ${w.corregido ? "corregido" : "marcado como pendiente"}.`;
      const antes = acciones.guardarSeguimiento(f.id, (s, quien) => aplicarEscritura(s, w, hoy, quien, cuando), () => descripcion);
      if (!antes) return;
      toast(`${titulo} de ${f.nombre}: ${valor.trim() || "vacío"}.`, "ok", {
        texto: "Deshacer", onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el cambio de ${titulo} de ${f.nombre}.`),
      });
      return;
    }
    /* Lo del alumno (o de la persona): se guarda en el alumno y se corrige en todos lados. */
    const previo = Object.fromEntries(Object.keys(w.tipo === "alumno" ? w.cambios : w.alumno).map((k) => [k, (f.alumno as unknown as Record<string, unknown>)[k]]));
    const cambios = w.tipo === "alumno" ? w.cambios : w.alumno;
    if (Object.keys(cambios).length) acciones.actualizar<Alumno>("alumnos", f.id, cambios, f.nombre, w.detalle);
    if (w.tipo === "persona") acciones.corregirPersona(w.id, w.cambios);
    toast(`${titulo} de ${f.nombre}: ${valor.trim() || "vacío"}.`, "ok", {
      texto: "Deshacer",
      onClick: () => {
        if (Object.keys(previo).length) acciones.actualizar<Alumno>("alumnos", f.id, previo as Partial<Alumno>, f.alumno.nombre, `Se deshizo el cambio de ${titulo}.`);
      },
    });
  };

  /* ---------- Cada celda ---------- */
  const contenido = (clave: ClaveCliente, f: FilaCliente): React.ReactNode => {
    const sug = (txt: string, sugerido: boolean) => (txt ? <span className={sugerido ? "cs-sugerido" : undefined} title={sugerido ? "Sugerido: todavía no se cargó" : undefined}>{txt}</span> : NADA);
    switch (clave) {
      case "numero": return f.numero === null ? NADA : <span className="t-num">{f.numero}</span>;
      case "inicio": return f.inicio ? <span className="t-num">{formatoDia(f.inicio, hoy)}</span> : NADA;
      case "egreso": return f.egreso ? <span className={`t-num${f.egresoSugerido ? " cs-sugerido" : ""}`} title={f.egresoSugerido ? "Calculado: inicio más duración" : undefined}>{formatoDia(f.egreso, hoy)}</span> : NADA;
      case "contactoInicial": case "contactoSemana": case "ultimoContacto": {
        const d = clave === "contactoInicial" ? f.contactoInicial : clave === "contactoSemana" ? f.contactoSemana : f.ultimoContacto;
        return d ? <span className="t-num">{formatoDia(d, hoy)}</span> : NADA;
      }
      case "proximo": return f.situacion === "fuera" ? NADA : (
        <span className="stack-1"><span className="t-num">{formatoDia(f.proximo, hoy)}</span><span className="t-sm t-subtle">{f.situacion === "no-contesta" ? "Dejó de contestar" : textoDeAtraso(f.atraso)}</span></span>
      );
      case "edad": return f.edad === null ? NADA : sug(String(f.edad), f.edadSugerida);
      case "duracion": return f.duracion === null ? NADA : sug(`${f.duracion} ${f.duracion === 1 ? "mes" : "meses"}`, f.duracionSugerida);
      case "mentor": return f.mentor === null ? NADA : <span className="t-num">{f.mentor} {f.mentor === 1 ? "sesión" : "sesiones"}</span>;
      case "programa": return f.programas.length
        ? <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>{f.programas.map((p) => <Pastilla key={p} texto={p} tono="neutra" tenue={f.programasSugeridos} title={f.programasSugeridos ? "Sugerido por el servicio que compró: confirmalo en la ficha" : p} />)}</span>
        : NADA;
      case "plan": return sug(f.plan, f.planSugerido);
      case "stack": case "acceso": case "followUp": case "contrato": case "estadoContrato": case "estadoAlumno": case "etapa": case "testimonio":
        return <Pastilla texto={(f as unknown as Record<string, string>)[clave] ?? ""} tono={clave === "etapa" ? "neutra" : undefined} />;
      case "reporte": return <Pastilla texto={f.reporte.estado} title={f.reporte.origen === "reportes" ? "Según sus reportes semanales" : f.reporte.origen === "manual" ? "Marcado a mano en la ficha" : "Todavía no hay reportes"} />;
      case "semanasSin": return f.reporte.semanasSin === null ? NADA : <span className="t-num">{f.reporte.semanasSin}</span>;
      case "cadencia": return <span>Cada {f.cadencia} días</span>;
      case "cv": return <Pastilla texto={f.cv ? "Corregido" : "Pendiente"} />;
      case "linkedin": return <Pastilla texto={f.linkedin ? "Corregido" : "Pendiente"} />;
      case "wpp": return <Pastilla texto={f.wpp ? "Sí" : "No"} tono={f.wpp ? "ok" : "neutra"} />;
      case "zoom": return <Pastilla texto={f.zoom ? "Sí" : "No"} tono={f.zoom ? "ok" : "neutra"} />;
      case "wibo": return <Pastilla texto={f.wibo ? "Sí" : "No"} tono={f.wibo ? "ok" : "neutra"} />;
      case "comentarios": return <Recorte texto={f.comentarios} />;
      default: {
        const v = (f as unknown as Record<string, unknown>)[clave];
        return <Recorte texto={typeof v === "string" ? v : ""} />;
      }
    }
  };

  const celda = (col: { clave: ClaveCliente }, f: FilaCliente): React.ReactNode => {
    const clave = col.clave;
    const titulo = MOTOR_CLIENTES.columna[clave].titulo;
    const editor = EDITOR_CLIENTE[clave];
    if (clave === "nombre") {
      const abierta = editando?.id === f.id && editando.clave === clave;
      if (abierta) {
        return (
          <CeldaEditable editor="texto" valor={f.nombre} titulo={titulo} abierta onAbrir={() => undefined} onCerrar={() => setEditando(null)} onGuardar={(v) => guardarCelda(f, clave, v)}>{null}</CeldaEditable>
        );
      }
      return (
        <span className="crm-t__persona">
          <button type="button" className="crm-t__abrir truncate" onClick={() => abrirFicha(f.id, "servicio")} title={`Abrir la ficha de ${f.nombre}`}>{f.nombre || "Sin nombre"}</button>
          {puede && (
            <button type="button" className="crm-t__lapiz" onClick={() => setFicha(f.id)} aria-label={`Editar la ficha de Customer Success de ${f.nombre}`} title="Editar todos sus datos de Customer Success">
              <Pencil size={12} />
            </button>
          )}
        </span>
      );
    }
    if (!editor || !puede) return <span className="crm-t__fija" title={POR_QUE_NO_CLIENTE[clave]}>{contenido(clave, f)}</span>;
    if (editor === "si-no") {
      const hoyEs = valorEditableCliente(f, clave) === SI;
      return (
        <button
          type="button" className="cs-si-no" aria-pressed={hoyEs} aria-label={`${titulo} de ${f.nombre}: ${hoyEs ? "sí" : "no"}. Cambiar`}
          title={`${titulo}: clic para cambiar`} onClick={(ev) => { ev.stopPropagation(); guardarCelda(f, clave, hoyEs ? "No" : SI); }}
        >
          {contenido(clave, f)}
        </button>
      );
    }
    if (editor === "ficha") {
      return (
        <button type="button" className="crm-t__editable" onClick={(ev) => { ev.stopPropagation(); setFicha(f.id); }} title={`${titulo}: se corrige en la ficha`} style={{ textAlign: "left" }}>
          {contenido(clave, f)}
        </button>
      );
    }
    const abierta = editando?.id === f.id && editando.clave === clave;
    return (
      <CeldaEditable
        editor={editor} valor={valorEditableCliente(f, clave)} titulo={titulo} abierta={abierta}
        onAbrir={() => setEditando({ id: f.id, clave })} onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === clave ? null : x))}
        onGuardar={(v) => guardarCelda(f, clave, v)} opciones={opcionesDe(clave)} sugerencias={abierta ? sugerenciasDe(clave) : undefined}
        vaciable={clave !== "estadoAlumno"}
      >
        {contenido(clave, f)}
      </CeldaEditable>
    );
  };

  const filaAcciones = puede ? (f: FilaCliente) => (f.alumno.estado === "activo" ? (
    <span className="row" style={{ gap: 2 }}>
      <IconButton etiqueta={`Lo contacté: el próximo toca en ${f.cadencia} días`} onClick={() => gestos.contacte(f)}><PhoneCall size={15} /></IconButton>
      <IconButton etiqueta="No contestó: se vuelve a probar en unos días" onClick={() => gestos.noContesto(f, cfg)}><PhoneMissed size={15} /></IconButton>
      <IconButton etiqueta={f.seg.dejoDeContestar ? "Volver al seguimiento" : "Dejó de contestar: sale de la lista de hoy"} onClick={() => gestos.dejoDeContestar(f, !f.seg.dejoDeContestar)}><UserX size={15} /></IconButton>
    </span>
  ) : undefined) : undefined;

  const numerar = () => {
    const n = acciones.numerarAlumnos();
    toast(n ? `Listo: ${n} ${n === 1 ? "alumno tiene" : "alumnos tienen"} su N.º.` : "Todos tienen su N.º de alumno.", n ? "ok" : "info");
  };

  const fichaDe = ficha ? filas.find((x) => x.id === ficha) : undefined;
  return (
    <>
      <TablaCs
        motor={MOTOR_CLIENTES} pantalla="clientes-cs" filas={filas} coincide={coincideCliente}
        visiblesPorDefecto={VISIBLES_CLIENTES} ordenPorDefecto={ORDEN_CLIENTES} fija="nombre" ordenValores={ordenValores}
        celda={(col, f) => celda(col, f)} filaAcciones={filaAcciones}
        excel={{ nombre: "Clientes", hoy, valor: (col, f) => {
          const k = col.clave;
          if (col.numerica && col.orden) { const n = Number(col.orden(f)); return Number.isFinite(n) && col.orden(f) !== "" ? n : null; }
          if (k === "comentarios") return f.comentarios;
          if (k === "programa") return f.programas.join(", ");
          return MOTOR_CLIENTES.textoDeColumna(f, col);
        } }}
        atajos={atajos} singular="cliente" plural="clientes" placeholder="Buscar por nombre, mail, teléfono o DNI"
        onFila={(f) => abrirFicha(f.id, "servicio")} etiquetaFila={(f) => `Ver la ficha de ${f.nombre}`}
        vacio={{
          titulo: "Todavía no hay clientes",
          texto: "Cada venta crea su alumno sola. También podés cargar uno a mano o traer toda la lista de tu Airtable.",
          accion: puede ? <Button variante="brand" icono={<FileDown size={16} />} onClick={() => setImportando(true)}>Importar del Airtable</Button> : undefined,
        }}
        acciones={
          <>
            {puede && resumen.sinNumero > 0 && (
              <Button sm variante="ghost" icono={<Hash size={15} />} onClick={numerar} title="Les da su N.º de alumno, del más viejo al más nuevo, a los que todavía no tienen">
                Numerar ({resumen.sinNumero})
              </Button>
            )}
            {puede && <Button sm variante="secondary" icono={<FileDown size={15} />} onClick={() => setImportando(true)}>Importar</Button>}
            {puedeAjustar && <Button sm variante="secondary" icono={<Settings2 size={15} />} onClick={() => setAjustando(true)}>Ajustar</Button>}
            {puede && <Button sm variante="primary" icono={<Plus size={15} />} onClick={onNuevo}>Nuevo cliente</Button>}
          </>
        }
      />
      {fichaDe && <FichaClienteCs fila={fichaDe} onCerrar={() => setFicha(null)} />}
      {ajustando && <AjustarCs onCerrar={() => setAjustando(false)} />}
      {importando && <ImportarCs onCerrar={() => setImportando(false)} />}
    </>
  );
}

