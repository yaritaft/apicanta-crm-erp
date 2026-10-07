"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ClipboardCheck, ExternalLink, Pencil, Search, Star, X } from "lucide-react";
import { Button, Card, Chip, Empty, Input, Tabs } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ConfigColumnas, useColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { CopiarLink } from "@/components/ui/Filtros";
import { VistasGuardadas } from "@/components/ui/VistasGuardadas";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useToast } from "@/components/ui/Toast";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { PastillaEstado, useCambiarEstado } from "@/components/estados/EstadoLlamada";
import { acciones, useEstado, type CambiosLlamada } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useUsuarioActual } from "@/lib/usuario";
import { closersConLlamadas, objecionesDe } from "@/lib/eod";
import { destinosDePase } from "@/lib/pasar-llamadas";
import { usePasarLlamadas } from "@/components/closers/usePasarLlamadas";
import { AvisoMisLlamadas } from "@/components/closers/MisLlamadas";
import { miembroDeCloser, opcionesDe as opcionesDelCrm } from "@/lib/crm";
import { COLOR_AVISO, POR_VENIR, SIN_CARGAR } from "@/lib/estados";
import { leadDeSesion } from "@/lib/etapas-auto";
import { aLista } from "@/lib/compartirLink";
import { PARAM_VISTA } from "@/lib/vistas-guardadas";
import type { ColorCrm, OpcionCrm } from "@/lib/types";
import { num } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { paginaDeURL, useBusquedaURL, useEscribirURL, useParamsURL } from "@/lib/useParamsURL";
import { useRangoURL } from "@/lib/useRango";
import {
  CAMPO_DE_OPCIONES, COLUMNA, COLUMNAS, COLUMNAS_DE_ANTES, coincideBusqueda, EDITOR, escrituraDe, filasTabla, filtroAURL, filtrosDeURL,
  hayFiltro, MAX_ORDENES, opcionesDeColumna, ORDEN_POR_DEFECTO, ordenarFilas, ordenesAURL, ordenesDeURL, PAISES, pasaFiltros, POR_QUE_NO,
  textoDeFiltro, VACIAS, valorEditable, VISIBLES_POR_DEFECTO,
  type ClaveColumna, type FilaTabla, type FiltroColumna as Filtro, type OrdenColumna,
} from "@/lib/crm-tabla";
import { tituloPerfil, type CampoPerfil } from "@/lib/perfil";
import { CeldaEditable } from "./CeldaEditable";
import { FiltroColumna, textoFecha } from "./FiltroColumna";
import { ResumenCrm } from "./ResumenCrm";
import { Eod } from "./Eod";

/* ==================================================================
   El CRM: una tabla, fácil como un Excel.

   Una fila por llamada, con todo lo que se sabe de la persona, que se
   llena sola (y con lo que el closer carga en su cierre del día, el EOD).

   Todo lo de una columna está en su título: ordenar por ella (y por más
   de una), tildar los valores que se quieren ver, o filtrar por un texto
   o entre dos fechas. No hay un apartado de filtros donde buscar la
   columna en una lista y armarle condiciones. El período, la búsqueda,
   los filtros, el orden y las columnas van en el link, y se guardan como
   una vista con nombre, sólo para uno o para todo el equipo
   (components/ui/VistasGuardadas).

   Los estados son los dos del Airtable, los mismos en toda la app
   (lib/estados.ts). «Informe» muestra, con los mismos filtros, cuánto se
   cierra y por qué no.

   Y se corrige ahí mismo: un clic en la celda la abre, Enter guarda y el
   aviso trae «Deshacer». Lo que es de la llamada cambia esa llamada; lo
   que es de la persona, todas sus llamadas. Lo que sale solo (la fecha,
   la vía, el ad, si califica, la venta) no se edita y lo dice al pasar
   el mouse. El nombre abre la ficha. Qué guarda cada celda está en
   lib/crm-tabla (escrituraDe).
   ================================================================== */

const DEFS: DefColumna[] = COLUMNAS.map((c) => ({ clave: c.clave, titulo: c.titulo, grupo: c.grupo, fija: c.clave === "nombre" }));
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

/* Lo que es de la persona (se guarda en su contacto) y lo que es de la llamada. */
const DE_LA_PERSONA = new Set<ClaveColumna>(["nombre", "email", "telefono", "pais", "edad", "tecnologias", "ingles", "experiencia", "formacion", "ingreso", "inversion"]);
/* Las que se eligen de una lista y se pueden dejar vacías. */
const VACIABLES = new Set<ClaveColumna>(["estadoPreCall", "estadoLlamada", "preCall", "objecion", "oferta"]);
const PERFIL: Partial<Record<ClaveColumna, CampoPerfil>> = {
  edad: "edad", tecnologias: "tecnologias", ingles: "ingles", experiencia: "experiencia", formacion: "formacion", ingreso: "ingreso", inversion: "inversion",
};
const opciones = (xs: string[], color: (x: string) => ColorCrm = () => "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color: color(nombre) }));

/* `misLlamadas`: «Mis llamadas», la cuenta del closer. Es esta misma tabla, de
   hoy, con arriba cuántas llamadas hay hoy y cuántas faltan cargar; «Cerrar
   el día» va en ese aviso (entrada propia) y no en la barra. */
export function CrmTabla({ misLlamadas = false }: { misLlamadas?: boolean } = {}) {
  const e = useEstado();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const abrirFicha = useAbrirFicha();
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const [vista, setVista] = useParamsURL({ seccion: "tabla", pag: "1" });
  const [eod, setEod] = useState(false);
  const toast = useToast();
  const cambiarEstado = useCambiarEstado();
  const pasarLlamadas = usePasarLlamadas();
  /* La celda que se está corrigiendo, y la llamada a la que se le carga la venta. */
  const [editando, setEditando] = useState<{ id: string; clave: ClaveColumna } | null>(null);
  const [ventaPara, setVentaPara] = useState<string | null>(null);
  /* Cada tipo de cuenta corrige lo que edita (y la base lo traba igual). */
  const { acceso } = useAcceso();
  const puedeLlamadas = puedeEditar(acceso, "sesiones");
  const puedePersonas = puedeEditar(acceso, "contactos");
  /* Cambiar el closer de una llamada es pasarla a otro: lo hace quien dirige las
     ventas (un dueño, el director). A un closer la base se lo rechaza, así que ni se le ofrece. */
  const puedePasar = puedeLlamadas && !acceso?.soloLoSuyo;

  /* El período, por el día de la llamada. De entrada, este mes (hoy, en «Mis llamadas»). */
  const hoy = diaDeNegocio(new Date().toISOString());
  const limites = useMemo(() => {
    const dias = e.sesiones.map((s) => diaDeNegocio(s.inicia)).filter(Boolean).sort();
    const ultimo = dias[dias.length - 1];
    return { min: dias[0] ?? null, max: ultimo && ultimo > hoy ? ultimo : hoy };
  }, [e.sesiones, hoy]);
  const [rango, setRango] = useRangoURL(misLlamadas ? "hoy" : "mes", { futuro: true, limites });

  /* `ahora` al minuto: la fila que pasa de "Por venir" a "Sin cargar". */
  const ahora = Math.floor(Date.now() / 60000) * 60000;
  const todas = useMemo(() => filasTabla(e, ahora), [e, ahora]);
  const enPeriodo = useMemo(
    () => todas.filter((f) => f.dia >= rango.desde && f.dia <= rango.hasta && coincideBusqueda(f, q)),
    [todas, rango.desde, rango.hasta, q],
  );
  const textoParams = params.toString();
  const filtros = useMemo(() => filtrosDeURL(new URLSearchParams(textoParams)), [textoParams]);
  /* «Sin cargar»: las que ya pasaron y nadie cargó cómo terminaron (también
     las que sólo tienen el estado que pone la app, como «2da Agenda»). */
  const soloSinCargar = params.get("pendientes") === "1";
  const base = useMemo(() => (soloSinCargar ? enPeriodo.filter((f) => f.sinCargar) : enPeriodo), [enPeriodo, soloSinCargar]);
  const filtradas = useMemo(() => base.filter((f) => pasaFiltros(f, filtros)), [base, filtros]);

  /* Las opciones de los estados, las del Airtable: las mismas que en la grilla. */
  const estados = useMemo(() => ({
    estadoLlamada: opcionesDelCrm(e.ajustes, "estadoLlamada"),
    estadoPreCall: opcionesDelCrm(e.ajustes, "estadoPreCall"),
    preCall: opcionesDelCrm(e.ajustes, "preCall"),
  }), [e.ajustes]);
  /* Sus valores van en el orden del Airtable, no alfabético. */
  const ordenValores = useMemo<Partial<Record<ClaveColumna, string[]>>>(() => ({
    estadoLlamada: [...estados.estadoLlamada.map((o) => o.nombre), SIN_CARGAR, POR_VENIR],
    estadoPreCall: estados.estadoPreCall.map((o) => o.nombre),
    preCall: estados.preCall.map((o) => o.nombre),
  }), [estados]);
  const colorDe = useMemo<Partial<Record<ClaveColumna, Map<string, ColorCrm>>>>(() => ({
    estadoLlamada: new Map<string, ColorCrm>([...Object.entries(COLOR_AVISO), ...estados.estadoLlamada.map((o) => [o.nombre, o.color] as const)]),
    estadoPreCall: new Map(estados.estadoPreCall.map((o) => [o.nombre, o.color] as const)),
    preCall: new Map(estados.preCall.map((o) => [o.nombre, o.color] as const)),
  }), [estados]);

  /* El orden: por una columna o por varias, desde el título de cada una. */
  const ordenes = useMemo(() => ordenesDeURL(params.get("orden")), [params]);
  const filas = useMemo(
    /* A igual valor, la llamada más nueva primero. */
    () => ordenarFilas(filtradas, ordenes.some((o) => o.clave === "llamada") ? ordenes : [...ordenes, ...ORDEN_POR_DEFECTO], ordenValores),
    [filtradas, ordenes, ordenValores],
  );
  const ordenar = useCallback((os: OrdenColumna[]) => escribir({ orden: ordenesAURL(os), pag: null }), [escribir]);
  const ordenDeSiempre = ordenesAURL(ordenes) === null;

  const cols = useColumnas("crm", DEFS, VISIBLES_POR_DEFECTO, COLUMNAS_DE_ANTES);

  const cambiarFiltro = useCallback((clave: ClaveColumna, fc: Filtro | null) => {
    escribir({ ...filtroAURL(clave, fc), pag: null });
  }, [escribir]);
  const conFiltro = (Object.keys(filtros) as ClaveColumna[]).filter((k) => hayFiltro(filtros[k]));
  const hayAlgo = conFiltro.length > 0 || soloSinCargar || Boolean(q);
  const limpiar = () => escribir({
    ...Object.assign({}, ...(Object.keys(filtros) as ClaveColumna[]).map((k) => filtroAURL(k, null))),
    pendientes: null, q: null, pag: null, [PARAM_VISTA]: null,
  });

  /* Si quien mira atiende llamadas y ve las de todos, las suyas a un clic
     (el closer que ve sólo lo suyo ya las tiene filtradas por la base). */
  const yo = useUsuarioActual();
  const miNombre = yo.miembro && !acceso?.soloLoSuyo && closersConLlamadas(e).includes(yo.miembro.nombre) ? yo.miembro.nombre : "";
  const soloMias = Boolean(miNombre) && filtros.closer?.modo === "solo" && filtros.closer.valores.length === 1 && filtros.closer.valores[0] === miNombre;
  const sinCargar = enPeriodo.filter((f) => f.sinCargar).length;

  /* ---------- Corregir en la celda ---------- */
  const opcionesDe = useMemo<Partial<Record<ClaveColumna, OpcionCrm[]>>>(() => {
    return {
      closer: opciones(destinosDePase(e).map((d) => d.miembro.nombre)),
      ...estados,
      objecion: opciones(objecionesDe(e.ajustes), () => "amarillo1"),
      oferta: [{ nombre: "Sí", color: "verde1" }, { nombre: "No", color: "gris1" }],
    };
  }, [e, estados]);
  /* Para escribir menos: los valores que ya existen en esa columna. */
  const sugerenciasDe = (clave: ClaveColumna): string[] | undefined => {
    if (clave === "pais") return PAISES;
    if (EDITOR[clave] !== "sugerencias") return undefined;
    return [...new Set(todas.flatMap((f) => COLUMNA[clave].valores(f)))].filter((v) => v !== VACIAS).sort((a, b) => a.localeCompare(b, "es", { numeric: true })).slice(0, 80);
  };

  const guardarCelda = (f: FilaTabla, clave: ClaveColumna, valor: string) => {
    /* Un estado: lo mismo que cambiarlo en la Agenda, la ficha o la grilla. */
    const campo = CAMPO_DE_OPCIONES[clave];
    if (campo) { cambiarEstado(f.sesion, campo, valor.trim(), { conVenta: Boolean(f.venta), alVender: () => setVentaPara(f.id) }); return; }
    const w = escrituraDe(f, clave, valor, { ajustes: e.ajustes, quien: yo.nombre, cuando: new Date().toISOString() });
    if (!w) return;
    /* El closer: se pasa la llamada (queda con quien la atiende y Calendly no la vuelve a pisar). */
    if (w.tipo === "closer") {
      const destino = destinosDePase(e).find((d) => d.miembro.nombre === w.closer);
      if (!destino) toast(`${w.closer} no está entre los closers del equipo: cargalo en Equipo para poder pasarle llamadas.`, "err");
      else if (pasarLlamadas([f.sesion], destino) === 0) toast(`${destino.miembro.nombre} ya atiende esta llamada.`, "info");
      return;
    }
    const titulo = COLUMNA[clave].titulo;
    let deshacer: () => void;
    if (w.tipo === "llamada") {
      /* Lo que tenía la llamada en cada campo que cambia: deshacer lo deja como estaba. */
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
    const aQuienes = DE_LA_PERSONA.has(clave) && todas.filter((x) => x.personaId === f.personaId).length > 1 ? " (en todas sus llamadas)" : "";
    toast(`${titulo} de ${f.nombre || "la llamada"}: ${valor.trim() || "vacío"}${aQuienes}.`, "ok", { texto: "Deshacer", onClick: deshacer });
  };
  const verFicha = (f: FilaTabla) => abrirFicha(f.sesion.contactoId ?? f.sesion.leadId ?? f.sesion.id, "llamadas");

  const columnas: Columna<FilaTabla>[] = cols.visibles.map((k) => {
    const col = COLUMNA[k as ClaveColumna];
    const puesto = ordenes.findIndex((o) => o.clave === col.clave);
    const colores = colorDe[col.clave];
    return {
      clave: col.clave,
      titulo: col.titulo,
      ancho: col.ancho,
      tipo: col.clave === "nombre" ? "primary" as const : undefined,
      encabezado: (
        <FiltroColumna
          titulo={col.titulo}
          opciones={() => opcionesDeColumna(base, filtros, col.clave, ordenValores[col.clave])}
          filtro={filtros[col.clave]}
          onFiltro={(fc) => cambiarFiltro(col.clave, fc)}
          orden={puesto >= 0 ? { desc: ordenes[puesto].desc, puesto: puesto + 1, de: ordenes.length } : undefined}
          onOrdenar={(desc) => ordenar([{ clave: col.clave, desc }])}
          /* Como criterio siguiente; si ya ordena, le cambia el sentido. */
          onSumarOrden={(desc) => ordenar(puesto >= 0
            ? ordenes.map((o) => (o.clave === col.clave ? { ...o, desc } : o))
            : [...ordenes.slice(0, MAX_ORDENES - 1), { clave: col.clave, desc }])}
          onQuitarOrden={() => ordenar(ordenes.filter((o) => o.clave !== col.clave))}
          ordenaPrimero={ordenes[0].clave !== col.clave ? COLUMNA[ordenes[0].clave].titulo : undefined}
          fecha={col.fecha}
          pinta={colores ? (v) => colores.get(v) : undefined}
        />
      ),
      celda: (f: FilaTabla) => {
        const abierta = editando?.id === f.id && editando.clave === col.clave;
        return (
          <CeldaCrm
            clave={col.clave} f={f}
            puede={DE_LA_PERSONA.has(col.clave) ? puedePersonas : col.clave === "closer" ? puedePasar : puedeLlamadas}
            abierta={abierta} onAbrir={() => setEditando({ id: f.id, clave: col.clave })}
            onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === col.clave ? null : x))}
            onGuardar={(v) => guardarCelda(f, col.clave, v)} onFicha={() => verFicha(f)}
            opciones={opcionesDe[col.clave]} sugerencias={abierta ? sugerenciasDe(col.clave) : undefined}
            color={colores}
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

  const enInforme = vista.seccion === "resumen";
  return (
    <div className="crm-t">
      {misLlamadas && <AvisoMisLlamadas filas={todas} hoy={hoy} />}
      <Card className="crm-t__card">
        {/* Todo en una barra: el título ya está arriba, en la barra de la app. */}
        <div className="crm-t__barra">
          <VistasGuardadas pantalla="crm" todas="Todas las llamadas" extra={{ "cols-crm": aLista(cols.visibles.filter((k) => k !== "nombre")) }} />
          <div className="crm-t__buscar">
            <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por nombre, mail o teléfono" aria-label="Buscar" />
          </div>
          <DateRangePicker
            value={rango} minDate={limites.min} maxDate={limites.max} futuro
            onApply={(r) => setRango(r, { pag: null })}
            footerNota="Por el día de la llamada · hora de Argentina"
          />
          {miNombre && !misLlamadas && (
            <Chip activo={soloMias} onClick={() => cambiarFiltro("closer", soloMias ? null : { modo: "solo", valores: [miNombre] })}>
              Mis llamadas
            </Chip>
          )}
          <Chip activo={soloSinCargar} count={sinCargar} onClick={() => escribir({ pendientes: soloSinCargar ? null : "1", pag: null })}>
            Sin cargar
          </Chip>
          {/* A la derecha; si la pantalla es angosta, pasan juntas a otra fila. */}
          <div className="crm-t__acciones">
            <Tabs<"tabla" | "resumen">
              valor={enInforme ? "resumen" : "tabla"}
              onChange={(v) => setVista({ seccion: v === "tabla" ? null : v })}
              opciones={[{ valor: "tabla", texto: "Tabla" }, { valor: "resumen", texto: "Informe" }]}
            />
            {!enInforme && (
              <ConfigColumnas todas={DEFS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} compacto />
            )}
            <CopiarLink />
            {!misLlamadas && <Button variante="primary" sm icono={<ClipboardCheck size={15} />} onClick={() => setEod(true)}>Cerrar el día</Button>}
          </div>
        </div>

        <div className="crm-t__filtros">
          <span className="t-sm t-subtle t-num crm-t__cuenta">
            {num(filas.length)} {filas.length === 1 ? "llamada" : "llamadas"}
            {filas.length !== enPeriodo.length ? ` de ${num(enPeriodo.length)} en el período` : " en el período"}
          </span>
          {soloSinCargar && (
            <span className="crm-t__pastilla">
              <span className="truncate">Sin cargar</span>
              <button type="button" onClick={() => escribir({ pendientes: null, pag: null })} aria-label="Quitar «Sin cargar»"><X size={13} /></button>
            </span>
          )}
          {conFiltro.map((k) => (
            <span key={k} className="crm-t__pastilla">
              <span className="t-subtle">{COLUMNA[k].titulo}:</span>
              <span className="truncate">{textoDeFiltro(filtros[k]!, (v) => (COLUMNA[k].fecha ? textoFecha(v) : v))}</span>
              <button type="button" onClick={() => cambiarFiltro(k, null)} aria-label={`Quitar el filtro de ${COLUMNA[k].titulo}`}><X size={13} /></button>
            </span>
          ))}
          {!ordenDeSiempre && !enInforme && (
            <span className="crm-t__pastilla">
              <span className="t-subtle">Orden:</span>
              <span className="truncate crm-t__orden">
                {ordenes.map((o) => (
                  <span key={o.clave}>{COLUMNA[o.clave].titulo}{o.desc ? <ArrowDown size={12} aria-label="de mayor a menor" /> : <ArrowUp size={12} aria-label="de menor a mayor" />}</span>
                ))}
              </span>
              <button type="button" onClick={() => ordenar(ORDEN_POR_DEFECTO)} aria-label="Volver al orden de siempre"><X size={13} /></button>
            </span>
          )}
          {hayAlgo && <button type="button" className="link t-sm" onClick={limpiar}>Limpiar todo</button>}
        </div>

        {enInforme ? (
          <ResumenCrm filas={filas} onFiltrar={(clave, valor) => { escribir({ ...filtroAURL(clave, { modo: "solo", valores: [valor] }), seccion: null, pag: null }); }} />
        ) : (
          <DataTable
            filas={filas}
            columnas={columnas}
            pagina={paginaDeURL(vista.pag) - 1} onPagina={(p) => setVista({ pag: String(p + 1) })}
            porPagina={50}
            vacio={
              <Empty
                icono={<Search size={22} />}
                titulo={hayAlgo ? "Ninguna llamada coincide" : "No hay llamadas en este período"}
                texto={hayAlgo ? "Probá sacando algún filtro." : "Elegí otro período en la barra."}
                accion={hayAlgo ? <Button variante="secondary" onClick={limpiar}>Limpiar filtros</Button> : undefined}
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
function CeldaCrm({ clave, f, puede, abierta, onAbrir, onCerrar, onGuardar, onFicha, opciones, sugerencias, color }: {
  clave: ClaveColumna; f: FilaTabla; puede: boolean; abierta: boolean;
  onAbrir: () => void; onCerrar: () => void; onGuardar: (valor: string) => void; onFicha: () => void;
  opciones?: OpcionCrm[]; sugerencias?: string[];
  /* El color de cada opción, en las columnas de estado. */
  color?: Map<string, ColorCrm>;
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
    return <span className="crm-t__fija" title={POR_QUE_NO[clave]}><Celda clave={clave} f={f} color={color} /></span>;
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
      <Celda clave={clave} f={f} color={color} />
    </CeldaEditable>
  );
}

function Celda({ clave, f, color }: { clave: ClaveColumna; f: FilaTabla; color?: Map<string, ColorCrm> }) {
  const nada = <span className="t-subtle">—</span>;
  switch (clave) {
    /* Los estados, con la pastilla de su opción: la misma en toda la app. */
    case "estadoLlamada": {
      /* El cargado, el que pone la app o el aviso de que falta. */
      const v = f.estadoLlamada || f.aviso;
      return v ? <PastillaEstado texto={v} color={color?.get(v) ?? "gris1"} tenue={f.estadoAuto || !f.estadoLlamada} /> : nada;
    }
    case "estadoPreCall": case "preCall": {
      const v = f[clave];
      return v ? <PastillaEstado texto={v} color={color?.get(v) ?? "gris1"} /> : nada;
    }
    case "llamada": return <span className="t-num">{textoFecha(f.dia)} · {HORA.format(new Date(f.llamada))}</span>;
    case "agendo": return <span className="t-num">{textoFecha(diaDeNegocio(f.agendo))}</span>;
    case "cierre": return f.cierre ? <span className="t-num">{textoFecha(f.cierre)}</span> : nada;
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
