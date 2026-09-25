"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Menu, PhoneCall, RefreshCcw, Search, Sheet, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { acciones, escrituraPendiente, useEstado } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { AGENDAR_A_MANO } from "@/lib/funciones";
import {
  CAMPO, CAMPOS, coincideBusqueda, estiloColor, filasCrm, ocultosDeTabla, opcionesDe, ordenar, pasa,
  pintor, tablasDe, valorDe, vistasDe,
  type ClaveCampo, type FilaCrm, type VistaCrm,
} from "@/lib/crm";
import type { CampoOpcionesCrm, OpcionCrm, Sesion } from "@/lib/types";
import { ALTOS, Grilla, type Item } from "./Grilla";
import { BarraVista } from "./Barra";
import { PanelVistas } from "./PanelVistas";
import { Registro } from "./Registro";
import { MenuColumna } from "./MenuColumna";
import { SelectorOpciones } from "./Editores";
import { useVistasGuardadas, usePreferencia, type AjusteVista, type VistaPropia } from "./useVistas";

/* ==================================================================
   El CRM de ventas, como el Airtable del equipo: una tabla por tipo de
   agenda (Booking Calls, Agendas Resells), vistas a la izquierda (por
   closer y día, el setter, cada lanzamiento) y la grilla.

   Las agendas entran solas: el webhook de Calendly las escribe en la
   base y Realtime las trae acá en segundos, sin recargar.
   ================================================================== */

export function Crm() {
  const e = useEstado();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();

  /* ---------- Tabla y vista: en la URL, así el link lleva a lo mismo ----------
     La vista va en ?v y no en ?vista: ?vista es de la ficha de la persona
     (ventas o servicio), que se abre encima de cualquier pantalla. */
  const tablas = useMemo(() => tablasDe(e.ajustes), [e.ajustes]);
  const tablaId = tablas.some((t) => t.id === params.get("tabla")) ? params.get("tabla")! : tablas[0].id;
  const [ultima, setUltima] = usePreferencia<Record<string, string>>("ultima-vista", {});
  const vistaUrl = params.get("v");
  const registroId = params.get("registro");

  const escribirUrl = useCallback((cambios: Record<string, string | null>, push = false) => {
    const u = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(cambios)) { if (v) u.set(k, v); else u.delete(k); }
    const s = u.toString();
    const destino = s ? `${window.location.pathname}?${s}` : window.location.pathname;
    if (push) router.push(destino, { scroll: false }); else router.replace(destino, { scroll: false });
  }, [router]);

  /* ---------- Las filas ---------- */
  const filasTodas = useMemo(() => filasCrm(e), [e]);
  const filasTabla = useMemo(() => filasTodas.filter((f) => f.tabla === tablaId), [filasTodas, tablaId]);
  const pintar = useMemo(() => pintor(e.ajustes, filasTabla, e.equipo), [e.ajustes, filasTabla, e.equipo]);
  const opciones = useMemo<Record<CampoOpcionesCrm, OpcionCrm[]>>(() => ({
    preCall: opcionesDe(e.ajustes, "preCall"),
    estadoLlamada: opcionesDe(e.ajustes, "estadoLlamada"),
    estadoPreCall: opcionesDe(e.ajustes, "estadoPreCall"),
  }), [e.ajustes]);

  /* ---------- Vistas ---------- */
  const guardadas = useVistasGuardadas(tablaId);
  const secciones = useMemo(() => vistasDe(filasTabla, e, tablaId), [filasTabla, e, tablaId]);
  const armadas = useMemo(() => secciones.flatMap((s) => s.vistas), [secciones]);
  const todasLasVistas: VistaCrm[] = useMemo(() => [...guardadas.propias, ...armadas], [guardadas.propias, armadas]);
  const vistaId = (vistaUrl && todasLasVistas.some((v) => v.id === vistaUrl) ? vistaUrl : null)
    ?? (ultima[tablaId] && todasLasVistas.some((v) => v.id === ultima[tablaId]) ? ultima[tablaId] : "todas");
  const base = todasLasVistas.find((v) => v.id === vistaId) ?? armadas[0];
  const esPropia = Boolean((base as VistaPropia).propia);
  const ajuste: AjusteVista = esPropia ? {} : guardadas.ajustes[base.id] ?? {};
  const v = {
    filtros: ajuste.filtros ?? base.filtros,
    conjuncion: ajuste.conjuncion ?? base.conjuncion,
    orden: ajuste.orden ?? base.orden,
    ocultos: ajuste.ocultos ?? base.ocultos ?? ocultosDeTabla(tablaId),
    columnas: ajuste.columnas ?? (base as VistaPropia).columnas,
    anchos: ajuste.anchos ?? (base as VistaPropia).anchos ?? {},
    alto: ajuste.alto ?? (base as VistaPropia).alto ?? "corta",
    agrupar: ajuste.agrupar !== undefined ? ajuste.agrupar : (base as VistaPropia).agrupar ?? null,
    color: ajuste.color !== undefined ? ajuste.color : (base as VistaPropia).color ?? null,
  };
  const cambiada = !esPropia && Object.keys(ajuste).some((k) => !["anchos", "columnas"].includes(k));
  const cambiarVista = useCallback((parcial: AjusteVista) => guardadas.cambiar(base.id, parcial, esPropia), [guardadas, base.id, esPropia]);

  function elegirVista(id: string) {
    setPanelAngosto(false);
    setUltima({ ...ultima, [tablaId]: id });
    escribirUrl({ v: id === "todas" ? null : id, registro: null });
    setMarcadas(new Set());
  }
  function elegirTabla(id: string) {
    escribirUrl({ tabla: id === tablas[0].id ? null : id, v: null, registro: null });
    setMarcadas(new Set());
  }

  /* ---------- Columnas visibles, en el orden de la vista ---------- */
  const orden = useMemo(() => {
    const todas = CAMPOS.filter((c) => c.clave !== "nombre").map((c) => c.clave);
    const guardado = (v.columnas ?? []).filter((k) => todas.includes(k));
    return [...guardado, ...todas.filter((k) => !guardado.includes(k))];
  }, [v.columnas]);
  const ocultos = useMemo(() => new Set(v.ocultos), [v.ocultos]);
  const columnas = useMemo(() => orden.filter((k) => !ocultos.has(k)).map((k) => CAMPO[k]), [orden, ocultos]);

  /* ---------- Filtrar, buscar y ordenar ----------
     La fila que se acaba de editar se queda donde está (aunque ya no pase
     el filtro o su orden cambie) hasta que se elige otra, como en Airtable:
     si no, desaparece o salta de lugar mientras se carga. */
  const [busqueda, setBusqueda] = useState("");
  const [retenida, setRetenida] = useState<string | null>(null);
  /* Sube cuando se suelta la fila retenida: recién ahí se vuelve a ordenar. */
  const [reordenar, setReordenar] = useState(0);
  const retenidaRef = useRef<string | null>(null);
  const visiblesClaves = useMemo(() => ["nombre" as ClaveCampo, ...columnas.map((c) => c.clave)], [columnas]);
  const filtradas = useMemo(() => filasTabla.filter((f) => f.id === retenida
    || (pasa(f, v.filtros, v.conjuncion) && coincideBusqueda(f, busqueda, visiblesClaves))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filasTabla, JSON.stringify(v.filtros), v.conjuncion, busqueda, visiblesClaves, retenida]);
  const idsClave = filtradas.map((f) => f.id).join("|");
  const ultimas = useRef(filtradas);
  ultimas.current = filtradas;
  const ordenIds = useMemo(() => {
    const criterio = [...(v.agrupar ? [{ campo: v.agrupar, desc: false }] : []), ...v.orden];
    return ordenar(ultimas.current, criterio, e.ajustes).map((f) => f.id);
    // Sólo el conjunto, el criterio y cuando se suelta la fila retenida: ver arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsClave, JSON.stringify(v.orden), v.agrupar, reordenar]);
  const porId = useMemo(() => new Map(filtradas.map((f) => [f.id, f])), [filtradas]);
  const filasVista = useMemo(() => ordenIds.map((id) => porId.get(id)).filter((f): f is FilaCrm => Boolean(f)), [ordenIds, porId]);

  /* ---------- Agrupar ---------- */
  const [plegados, setPlegados] = useState<Set<string>>(new Set());
  const items: Item[] = useMemo(() => {
    if (!v.agrupar) return filasVista.map((f, i) => ({ tipo: "fila" as const, f, n: i + 1 }));
    const g = v.agrupar;
    const grupos = new Map<string, FilaCrm[]>();
    for (const f of filasVista) {
      const val = valorDe(f, g);
      const k = Array.isArray(val) ? val.join(", ") : val;
      grupos.set(k, [...(grupos.get(k) ?? []), f]);
    }
    const salida: Item[] = [];
    let n = 0;
    for (const [valor, fs] of grupos) {
      const clave = `${g}:${valor}`;
      const abierto = !plegados.has(clave);
      salida.push({ tipo: "grupo", clave, campo: g, valor, cuenta: fs.length, abierto });
      if (abierto) for (const f of fs) salida.push({ tipo: "fila", f, n: ++n });
      else n += fs.length;
    }
    return salida;
  }, [filasVista, v.agrupar, plegados]);

  const tintes = useMemo(() => {
    const t: Partial<Record<ClaveCampo, "filtro" | "orden" | "grupo">> = {};
    for (const c of v.filtros) if (c.campo !== "lanzamiento") t[c.campo] = "filtro";
    for (const o of v.orden) t[o.campo] ??= "orden";
    if (v.agrupar) t[v.agrupar] = "grupo";
    return t;
  }, [v.filtros, v.orden, v.agrupar]);

  const colorFila = useMemo(() => {
    if (!v.color) return undefined;
    const campo = v.color;
    const colores = new Map(opciones[campo].map((o) => [o.nombre, estiloColor(o.color).fondo]));
    return (f: FilaCrm) => colores.get(String(valorDe(f, campo)));
  }, [v.color, opciones]);

  /* ---------- Guardar lo que carga el equipo ----------
     Cada cambio queda en una pila para deshacerlo con ⌘Z (con el estado de
     la llamada de antes: elegir «Compra Full» también la marcó como hecha). */
  type Cambio = { id: string; clave: ClaveCampo; antes: string; estado: Sesion["estado"]; nombre: string };
  /* Una entrada por gesto: cambiar varias filas juntas se deshace de una vez. */
  const deshacer = useRef<Cambio[][]>([]);
  const escribirCampo = useCallback((f: FilaCrm, clave: ClaveCampo, valor: string, detalle?: string): Cambio | null => {
    const campo = CAMPO[clave];
    if (!campo || campo.origen !== "equipo") return null;
    const antes = String((f.sesion as unknown as Record<string, unknown>)[clave] ?? "");
    if (antes === valor.trim()) return null;
    acciones.editarLlamada(
      f.id, { [clave]: valor } as Partial<Sesion>,
      detalle ?? (valor ? `${f.nombre}: ${campo.titulo} → ${valor.length > 60 ? `${valor.slice(0, 60)}…` : valor}.` : `${f.nombre}: se vació ${campo.titulo}.`),
    );
    return { id: f.id, clave, antes, estado: f.sesion.estado, nombre: f.nombre };
  }, []);
  const recordar = (cambios: Cambio[]) => { if (cambios.length) deshacer.current = [...deshacer.current.slice(-49), cambios]; };
  const guardarCampo = useCallback((f: FilaCrm, clave: ClaveCampo, valor: string) => {
    const cambio = escribirCampo(f, clave, valor);
    if (!cambio) return;
    recordar([cambio]);
    retenidaRef.current = f.id;
    setRetenida(f.id);
    const opcion = clave === "estadoLlamada" ? opciones.estadoLlamada.find((o) => o.nombre === valor) : undefined;
    if (opcion?.llamada && f.sesion.estado !== opcion.llamada) {
      toast(opcion.llamada === "hecha" ? "En la Agenda la llamada quedó como hecha." : "En la Agenda la llamada quedó como que no vino.", "info");
    }
  }, [escribirCampo, opciones.estadoLlamada, toast]);
  const onDeshacer = useCallback(() => {
    const ultimos = deshacer.current.pop();
    if (!ultimos?.length) { toast("No hay nada para deshacer.", "info"); return; }
    for (const u of ultimos) {
      acciones.editarLlamada(u.id, { [u.clave]: u.antes, estado: u.estado } as Partial<Sesion>, `${u.nombre}: se deshizo el cambio de ${CAMPO[u.clave].titulo}.`);
    }
    const titulo = CAMPO[ultimos[0].clave].titulo;
    toast(ultimos.length === 1 ? `Deshecho: ${titulo} de ${ultimos[0].nombre}.` : `Deshecho: ${titulo} en ${ultimos.length} agendas.`, "info");
  }, [toast]);

  /* Lo mismo para todas las filas elegidas con la casilla. */
  const aplicarAVarias = useCallback((clave: CampoOpcionesCrm, valor: string, ids: Set<string>) => {
    const campo = CAMPO[clave];
    const cambios: Cambio[] = [];
    for (const f of filasTabla) {
      if (!ids.has(f.id)) continue;
      const c = escribirCampo(f, clave, valor, `${f.nombre}: ${campo.titulo} → ${valor || "vacío"} (a varias juntas).`);
      if (c) cambios.push(c);
    }
    recordar(cambios);
    const n = cambios.length;
    toast(n ? `${campo.titulo}: «${valor}» en ${n} ${n === 1 ? "agenda" : "agendas"}. ⌘Z lo deshace.` : "Ya tenían ese valor.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filasTabla, escribirCampo, toast]);

  const onActiva = useCallback((id: string | null) => {
    if (!retenidaRef.current || retenidaRef.current === id) return;
    retenidaRef.current = null;
    setRetenida(null);
    setReordenar((n) => n + 1);
  }, []);

  /* ---------- Filas elegidas con la casilla ---------- */
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const marcar = useCallback((ids: string[], on: boolean) => {
    setMarcadas((m) => { const n = new Set(m); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  }, []);

  /* ---------- Lo que llega de Calendly en vivo ---------- */
  const [nuevas, setNuevas] = useState<Set<string>>(new Set());
  const [enVivo, setEnVivo] = useState(false);
  const estadoRef = useRef(e);
  estadoRef.current = e;
  useEffect(() => {
    if (!nube) return;
    const db = nube;
    const canal = db.channel(`crm:${Math.random().toString(36).slice(2, 8)}`);
    canal.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "sesiones" },
      async (p: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        if (p.eventType === "DELETE") {
          if (p.old?.id) acciones.recibirDeLaNube("sesiones", [], [String(p.old.id)]);
          return;
        }
        const id = p.new?.id ? String(p.new.id) : "";
        if (!id) return;
        /* La fila se vuelve a pedir en vez de usar la del aviso: en un UPDATE,
           Realtime puede no mandar las columnas grandes que no cambiaron (las
           respuestas del formulario) y la memoria se quedaría sin ellas. */
        if (escrituraPendiente("sesiones", id)) return;
        const { data } = await db.from("sesiones").select("*").eq("id", id).maybeSingle();
        const s = data as Sesion | null;
        if (!s || escrituraPendiente("sesiones", id)) return;
        const nueva = !estadoRef.current.sesiones.some((x) => x.id === s.id);
        acciones.recibirDeLaNube("sesiones", [s]);
        if (!nueva) return;
        /* La persona y su oportunidad las escribió el webhook un instante
           antes: se traen para que su ficha abra completa. */
        for (const [tabla, id] of [["contactos", s.contactoId], ["leads", s.leadId]] as const) {
          if (!id) continue;
          void db.from(tabla).select("*").eq("id", id).then((r) => {
            if (r.data?.length) acciones.recibirDeLaNube(tabla, r.data as { id: string }[]);
          });
        }
        const f = filasCrm({ ...estadoRef.current, sesiones: [s] })[0];
        if (!f) return;
        setNuevas((n) => new Set(n).add(s.id));
        window.setTimeout(() => setNuevas((n) => { const x = new Set(n); x.delete(s.id); return x; }), 8000);
        toast(`Nueva agenda: ${f.nombre}${f.funnel ? ` · ${f.funnel}` : ""}${f.closer ? ` · con ${f.closer}` : ""}.`);
      },
    );
    canal.subscribe((estado) => setEnVivo(estado === "SUBSCRIBED"));
    return () => { void db.removeChannel(canal); };
  }, [toast]);

  /* ---------- Menús ---------- */
  const [menuColumna, setMenuColumna] = useState<{ clave: ClaveCampo; el: HTMLElement } | null>(null);
  /* En una pantalla angosta la barra de vistas tapa la grilla: arranca
     cerrada y se cierra sola al elegir una vista. */
  const [panelAncho, setPanelAncho] = usePreferencia("panel-vistas", true);
  const [panelAngosto, setPanelAngosto] = useState(false);
  const angosto = useAngosto();
  const panelAbierto = angosto ? panelAngosto : panelAncho;
  const setPanelAbierto = (v: boolean) => (angosto ? setPanelAngosto(v) : setPanelAncho(v));
  const [buscando, setBuscando] = useState(false);
  const [pedirCampos, setPedirCampos] = useState<HTMLElement | null>(null);
  const [filtrarPor, setFiltrarPor] = useState<ClaveCampo | null>(null);

  /* ---------- El registro abierto ---------- */
  const registro = registroId ? filasTabla.find((f) => f.id === registroId) ?? filasTodas.find((f) => f.id === registroId) : undefined;
  const posRegistro = registro ? filasVista.findIndex((f) => f.id === registro.id) : -1;
  /* Abierto desde la grilla, cerrarlo es volver atrás (el Atrás del
     navegador y la ✕ hacen lo mismo); si se entró por un link, se saca el
     parámetro y listo. Igual que la ficha. */
  const conPush = useRef(false);
  const abrirRegistro = useCallback((id: string) => { conPush.current = true; escribirUrl({ registro: id }, true); }, [escribirUrl]);
  const cerrarRegistro = useCallback(() => {
    if (conPush.current) { conPush.current = false; router.back(); return; }
    escribirUrl({ registro: null });
  }, [escribirUrl, router]);
  /* De un registro a la ficha de la persona en una sola navegación: cerrar
     y abrir por separado (back y push) se pisan. */
  const verFicha = useCallback((persona: string) => {
    conPush.current = false;
    escribirUrl({ registro: null, ficha: persona, vista: "ventas" });
  }, [escribirUrl]);

  const tabla = tablas.find((t) => t.id === tablaId)!;
  const hayFiltros = v.filtros.some((c) => c.campo !== "lanzamiento");

  return (
    <div className="crm">
      {/* ---------- Las tablas, como las pestañas de Airtable ---------- */}
      <div className="crm-tablas" role="tablist" aria-label="Tablas del CRM">
        {tablas.map((t) => (
          <button
            key={t.id} type="button" role="tab" aria-selected={t.id === tablaId}
            className={`crm-tabla${t.id === tablaId ? " crm-tabla--activa" : ""}`}
            onClick={() => elegirTabla(t.id)}
          >
            <PhoneCall size={14} className="crm-tabla__icono" aria-hidden />
            {t.nombre}
            {t.id === tablaId && <ChevronDown size={14} className="crm-tabla__flecha" aria-hidden />}
          </button>
        ))}
        <span className="crm-tablas__vivo" title={nube ? (enVivo ? "Conectado: las agendas nuevas aparecen solas, sin recargar" : "Conectando con la base…") : "Sin nube: se ven los datos guardados en este navegador"}>
          <span className={`crm-pulso${enVivo ? " crm-pulso--on" : ""}`} aria-hidden />
          {nube ? (enVivo ? "En vivo" : "Conectando…") : "En este navegador"}
        </span>
      </div>

      {/* ---------- La barra de la vista ---------- */}
      <div className="crm-barra">
        <button
          type="button" className="crm-icono" aria-label={panelAbierto ? "Esconder las vistas" : "Mostrar las vistas"}
          title={panelAbierto ? "Esconder las vistas" : "Mostrar las vistas"} aria-pressed={panelAbierto}
          onClick={() => setPanelAbierto(!panelAbierto)}
        >
          <Menu size={18} aria-hidden />
        </button>
        <BarraVista
          vista={base} esPropia={esPropia} cambiada={cambiada}
          filtros={v.filtros} conjuncion={v.conjuncion} orden={v.orden} ocultos={v.ocultos} columnas={orden}
          alto={v.alto} agrupar={v.agrupar} color={v.color}
          filas={filasTabla} opciones={opciones} pintar={pintar}
          onCambiar={cambiarVista}
          onRestablecer={() => guardadas.restablecer(base.id)}
          onRenombrar={(nombre) => guardadas.renombrar(base.id, nombre)}
          onBorrar={() => { guardadas.borrar(base.id); elegirVista("todas"); }}
          onDuplicar={(nombre) => {
            const id = `propia-${Date.now().toString(36)}`;
            guardadas.crear({ ...base, ...v, id, nombre, propia: true, marca: undefined });
            elegirVista(id);
          }}
          buscando={buscando} onBuscando={setBuscando}
          pedirCampos={pedirCampos} onPedirCampos={setPedirCampos}
          filtrarPor={filtrarPor} onFiltrarUsado={() => setFiltrarPor(null)}
        />
      </div>

      {buscando && (
        <div className="crm-buscar">
          <Search size={16} aria-hidden />
          <input
            autoFocus value={busqueda} placeholder="Buscar en esta vista…" aria-label="Buscar en esta vista"
            onChange={(ev) => setBusqueda(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Escape") { setBusqueda(""); setBuscando(false); } }}
          />
          {busqueda && <span className="crm-buscar__cuenta">{filasVista.length} {filasVista.length === 1 ? "registro" : "registros"}</span>}
          <button type="button" className="crm-icono" aria-label="Cerrar la búsqueda" onClick={() => { setBusqueda(""); setBuscando(false); }}>
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      <div className="crm-cuerpo-app">
        {panelAbierto && angosto && <div className="crm-vistas-fondo" onClick={() => setPanelAngosto(false)} aria-hidden />}
        {panelAbierto && (
          <PanelVistas
            secciones={secciones} propias={guardadas.propias} activa={base.id}
            onElegir={elegirVista}
            onCrear={(nombre) => {
              const id = `propia-${Date.now().toString(36)}`;
              guardadas.crear({ ...base, ...v, id, nombre, propia: true, marca: undefined });
              elegirVista(id);
            }}
            tabla={tabla} tablas={tablas} sesiones={e.sesiones}
          />
        )}

        <Grilla
          items={items}
          primario={CAMPO.nombre}
          columnas={columnas}
          anchos={v.anchos}
          alto={ALTOS[v.alto]}
          pintar={pintar}
          opciones={opciones}
          tintes={tintes}
          colorFila={colorFila}
          marcadas={marcadas}
          onMarcar={marcar}
          onAbrir={abrirRegistro}
          onGuardar={guardarCampo}
          onAncho={(clave, px) => cambiarVista({ anchos: { ...v.anchos, [clave]: px } })}
          onEncabezado={(clave, el) => setMenuColumna({ clave, el })}
          onMas={(el) => setPedirCampos(el)}
          onGrupo={(clave) => setPlegados((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; })}
          onError={(m) => toast(m, "info")}
          nuevas={nuevas}
          totalFilas={filasVista.length}
          onActiva={onActiva}
          onDeshacer={onDeshacer}
          reinicio={`${tablaId}:${base.id}`}
          pie={marcadas.size > 0 ? (
            <Masivo
              n={marcadas.size} opciones={opciones}
              onAplicar={(clave, valor) => aplicarAVarias(clave, valor, marcadas)}
              onSoltar={() => setMarcadas(new Set())}
            />
          ) : (
            <span className="crm-anadir" title={`Cada agenda de Calendly aparece acá sola, en segundos.${AGENDAR_A_MANO ? "" : " No se cargan a mano."}`}>
              <span className={`crm-pulso${enVivo || !nube ? " crm-pulso--on" : ""}`} aria-hidden />
              Entran solas
            </span>
          )}
          vacio={(
            <div className="crm-vacio">
              <Sheet size={22} aria-hidden />
              <strong>{busqueda || hayFiltros ? "Ninguna agenda coincide" : "Todavía no hay agendas en esta vista"}</strong>
              <span>
                {busqueda || hayFiltros
                  ? "Probá con otra búsqueda o sacá algún filtro."
                  : "Cuando alguien agende en Calendly va a aparecer acá sola."}
              </span>
              {cambiada && (
                <button type="button" className="crm-boton" onClick={() => guardadas.restablecer(base.id)}>
                  <RefreshCcw size={14} aria-hidden />Restablecer la vista
                </button>
              )}
            </div>
          )}
        />
      </div>

      {menuColumna && (
        <MenuColumna
          clave={menuColumna.clave} ancla={menuColumna.el}
          onCerrar={() => setMenuColumna(null)}
          ajustes={e.ajustes} sesiones={e.sesiones}
          onOrdenar={(desc) => { cambiarVista({ orden: [{ campo: menuColumna.clave, desc }] }); setMenuColumna(null); }}
          onFiltrar={() => { setFiltrarPor(menuColumna.clave); setMenuColumna(null); }}
          onAgrupar={() => { cambiarVista({ agrupar: menuColumna.clave }); setMenuColumna(null); }}
          onOcultar={menuColumna.clave === "nombre" ? undefined : () => { cambiarVista({ ocultos: [...v.ocultos, menuColumna.clave] }); setMenuColumna(null); }}
        />
      )}

      {registro && (
        <Registro
          f={registro} opciones={opciones} pintar={pintar}
          onGuardar={guardarCampo} onCerrar={cerrarRegistro} onFicha={verFicha}
          anterior={posRegistro > 0 ? () => escribirUrl({ registro: filasVista[posRegistro - 1].id }) : undefined}
          siguiente={posRegistro >= 0 && posRegistro < filasVista.length - 1 ? () => escribirUrl({ registro: filasVista[posRegistro + 1].id }) : undefined}
          posicion={posRegistro >= 0 ? `${posRegistro + 1} de ${filasVista.length}` : undefined}
        />
      )}
    </div>
  );
}

/* ¿La pantalla es angosta (la barra de vistas va encima de la grilla)? */
function useAngosto(): boolean {
  const [angosto, setAngosto] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const cambiar = () => setAngosto(mq.matches);
    cambiar();
    mq.addEventListener("change", cambiar);
    return () => mq.removeEventListener("change", cambiar);
  }, []);
  return angosto;
}

/* Con filas elegidas, el botón de abajo cambia: se carga lo mismo en todas
   (el setter marca «1° Mje Enviado» a las del día de una vez). */
function Masivo({ n, opciones, onAplicar, onSoltar }: {
  n: number;
  opciones: Record<CampoOpcionesCrm, OpcionCrm[]>;
  onAplicar: (clave: CampoOpcionesCrm, valor: string) => void;
  onSoltar: () => void;
}) {
  const [abierto, setAbierto] = useState<{ clave: CampoOpcionesCrm; el: HTMLElement } | null>(null);
  const campos: CampoOpcionesCrm[] = ["preCall", "estadoLlamada", "estadoPreCall"];
  return (
    <span className="crm-anadir crm-masivo">
      <strong>{n} {n === 1 ? "elegida" : "elegidas"}</strong>
      {campos.map((c) => (
        <button key={c} type="button" className="crm-masivo__campo" onClick={(ev) => setAbierto({ clave: c, el: ev.currentTarget })}>
          {CAMPO[c].titulo}<ChevronDown size={14} aria-hidden />
        </button>
      ))}
      <button type="button" className="crm-masivo__soltar" aria-label="Soltar las elegidas" title="Soltar las elegidas" onClick={onSoltar}>
        <X size={14} aria-hidden />
      </button>
      {abierto && (
        <SelectorOpciones
          ancla={abierto.el} opciones={opciones[abierto.clave]} valor="" ancho={220}
          onElegir={(v) => { onAplicar(abierto.clave, v); setAbierto(null); }}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </span>
  );
}
