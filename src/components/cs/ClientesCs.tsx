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
import { configSeguimiento, hoyDelNegocio } from "@/lib/seguimiento";
import {
  CONTRATOS, coincideCliente, EDITOR_CLIENTE, filasClientes, listasCs,
  MOTOR_CLIENTES, ORDEN_CLIENTES, ORDEN_REPORTE, OPCIONES_ESTADO_ALUMNO, POR_QUE_NO_CLIENTE, resumenClientes,
  valorEditableCliente, VISIBLES_CLIENTES, type ClaveCliente, type FilaCliente,
} from "@/lib/clientes-cs";
import { SI } from "@/lib/tabla-cs";
import { FichaClienteCs } from "./FichaClienteCs";
import { AjustarCs } from "./AjustarCs";
import { ImportarCs } from "./ImportarCs";
import { TablaCs } from "./TablaCs";
import { contenidoCliente, useEdicionCliente } from "./edicionCliente";

/* ==================================================================
   Clientes: la lista de Customer Success con las 29 columnas que Lili lleva
   en su Airtable (respuesta del 09/10), más el CV y el LinkedIn corregidos.

   Una fila por alumno. Lo que ya sabe el alumno o su venta se lee de ahí; lo
   que sólo lleva Customer Success se corrige en la celda (un clic, Enter
   guarda, y el aviso trae «Deshacer») o en la ficha completa (el lápiz del
   nombre). La tabla se filtra como un Excel: cada columna tiene su filtro, y
   todo viaja en el link (lib/tabla-cs.ts).
   ================================================================== */

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

  /* ---------- Corregir en la celda (lo mismo que la ficha: cs/edicionCliente) ---------- */
  const { opcionesDe, sugerenciasDe, guardar: guardarCelda } = useEdicionCliente(filas, hoy);

  /* ---------- Cada celda ---------- */
  const contenido = (clave: ClaveCliente, f: FilaCliente): React.ReactNode => contenidoCliente(clave, f, hoy);

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
        visiblesPorDefecto={VISIBLES_CLIENTES} ordenPorDefecto={ORDEN_CLIENTES} fija="nombre" fijaAntes="numero" ordenValores={ordenValores}
        celda={(col, f) => celda(col, f)} filaAcciones={filaAcciones}
        excel={{ nombre: "Clientes", hoy, valor: (col, f) => {
          const k = col.clave;
          if (col.numerica && col.orden) { const n = Number(col.orden(f)); return Number.isFinite(n) && col.orden(f) !== "" ? n : null; }
          if (k === "comentarios") return f.comentarios;
          if (k === "programa") return f.programas.join(", ");
          return MOTOR_CLIENTES.textoDeColumna(f, col);
        } }}
        atajos={atajos} singular="cliente" plural="clientes" placeholder="Buscar por nombre, mail, teléfono o DNI"
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

