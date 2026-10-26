"use client";

import { esLlamadaDeResell } from "@/lib/resells";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle, Check, Cloud, Eye, HardDrive, Lock, LogOut, Menu, Moon, PanelLeft, PanelLeftClose,
  RefreshCw, Search, Sun, X,
} from "lucide-react";
import { inicioPara, navPara, TODOS_LOS_ITEMS } from "./nav";
import { alarmaCobranza } from "@/lib/finanzas";
import { cuantosFaltan } from "@/lib/gastos-recurrentes";
import { llamadasEnDevolucionSinCargar } from "@/lib/devoluciones";
import { propuestasPendientes } from "@/lib/reembolsos";
import { resumenDePases } from "@/lib/traspasos";
import { useChequeos } from "@/lib/chequeos-finanzas";
import { diasDelEod } from "@/lib/eod-finanzas";
import {
  acciones, alNegarseEscritura, cargarDeLaNube, fijarAcceso, hayNube, reiniciarCarga, tablaSinCrear, useEstado, useSync, useTema,
} from "@/lib/store";
import { claveDe } from "@/lib/chat-equipo";
import { aplazarFoto, fotoAplazadaHoy, fotoDe, mapaDeFotos } from "@/lib/fotos-perfil";
import { useSalir, useSesion } from "@/lib/auth";
import { useUsuarioActual } from "@/lib/usuario";
import { elegirVerComo, useAcceso, useVerComo } from "@/lib/acceso";
import { areaDeRuta, esCuentaDeCloser, nivelDeRuta, nivelEn, queEsTabla } from "@/lib/permisos";
import { diaDeNegocio, enRangoDeDias } from "@/lib/dia-negocio";
import { aContactarHoy, filasDeSeguimiento, hoyDelNegocio } from "@/lib/seguimiento";
import { useRecordarVistas } from "@/lib/recordarVistas";
import { Avatar, Button, Card, Empty, IconButton } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { Paleta } from "./Paleta";
import { Tour } from "./Tour";
import { ID_ACCIONES_TOPBAR } from "./AccionesTopbar";
import { useChatEnVivo } from "@/components/ficha/useChatEnVivo";
import { FotoDePerfil } from "./FotoDePerfil";
import { Campanita } from "@/components/avisos/Campanita";
import { AvisoVersion } from "./AvisoVersion";
import { PedirAccesoPantalla, PedirPermisoParaEditar } from "./PedirAcceso";
import { pedirAcceso } from "@/lib/pedir-acceso";

export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const busqueda = useSearchParams();
  const estado = useEstado();
  const [tema, setTema] = useTema();
  const sync = useSync();
  const sesion = useSesion();
  /* Abajo a la izquierda va quien entró, no el responsable del negocio: Dante veía «Yari Taft». */
  const yo = useUsuarioActual();
  const nombreYo = yo.miembro?.nombre ?? (estado.ajustes.responsable || "Apicanta");
  const router = useRouter();
  const toast = useToast();
  /* Qué ve según su tipo de cuenta (lib/acceso, lib/permisos): el menú,
     la pantalla y lo que la cola manda a la base. */
  const { acceso, cargando: cargandoAcceso } = useAcceso();
  const nav = navPara(acceso);
  const inicio = inicioPara(acceso);
  const nivelRuta = nivelDeRuta(acceso, ruta);
  const verComo = useVerComo();
  useEffect(() => { fijarAcceso(acceso); }, [acceso]);
  useEffect(() => {
    let ultimo = 0;
    return alNegarseEscritura((tabla, motivo) => {
      if (Date.now() - ultimo < 4000) return;
      ultimo = Date.now();
      /* Sin salida no sirve: el aviso trae el botón que le pide el permiso a los dueños (26/10: se pedía por WhatsApp). */
      toast(motivo ?? `Tu tipo de cuenta no puede cambiar ${queEsTabla(tabla)}: vuelve a como estaba.`, "err", {
        texto: "Pedir permiso",
        onClick: () => {
          void pedirAcceso({ pantalla: queEsTabla(tabla), ruta: `tabla:${tabla}`, quiere: "editar" }).then((r) =>
            toast(r.ok ? "Listo: les avisé a los dueños. Cuando te lo den, recargá la página." : r.error, r.ok ? "ok" : "err"));
        },
      });
    });
  }, [toast]);
  /* El inicio es el Dashboard; quien no lo ve arranca en su primera pantalla. */
  useEffect(() => {
    if (acceso && nivelRuta === 0 && ruta === "/panel" && inicio !== "/panel") router.replace(inicio);
  }, [acceso, nivelRuta, ruta, inicio, router]);
  /* Cada pantalla vuelve como se dejó: con sus filtros, su orden y su
     período. El menú lleva directo a lo último que se vio en cada una. */
  const hrefRecordado = useRecordarVistas();
  /* El chat del equipo de las fichas llega en vivo y anota lo que le llegó a cada uno (los tildes). */
  useChatEnVivo();

  /* La foto de perfil: quien entra sin foto tiene que ponerla (pedido de Juan Cruz, 20/10); después se cambia tocándola abajo.
     Se pide recién con los datos ya traídos (si no, la pediría a quien ya la tiene) y sólo si la tabla existe. */
  const quienYo = claveDe(sesion.email, yo.nombre);
  const miFoto = useMemo(() => fotoDe(mapaDeFotos(estado.fotosPerfil, estado.equipo), sesion.email, yo.nombre), [estado.fotosPerfil, estado.equipo, sesion.email, yo.nombre]);
  const datosListos = sync.estado === "listo" || sync.estado === "local";
  /* «Cargarla después»: se lee ya montado (localStorage no existe en el servidor) y por persona; hasta leerlo no se muestra el cartel. */
  const [aplazo, setAplazo] = useState<{ quien: string; aplazada: boolean } | null>(null);
  useEffect(() => {
    if (quienYo) setAplazo({ quien: quienYo, aplazada: fotoAplazadaHoy(quienYo, hoyDelNegocio()) });
  }, [quienYo]);
  const faltaFoto = datosListos && Boolean(quienYo) && !miFoto && !tablaSinCrear("fotos_perfil") && aplazo?.quien === quienYo && !aplazo.aplazada;
  const [cambiarFoto, setCambiarFoto] = useState(false);
  /* Las ventas del embudo de webinar se atan solas a su webinar (por los UTMs de quien compró o por la fecha del último vivo): sin
     eso el embudo, el profit y el ROAS de cada webinar quedan en cero (lib/atar-webinars.ts). Sólo las atan quienes pueden
     editar Ventas y sólo atan: crear un webinar de la planilla sigue siendo el botón de la pantalla de Webinars.
     La cuenta tarda unos 300 ms con todos los datos: se hace una vez, un par de segundos después de que cambian las ventas o los
     webinars (no en cada cambio de un contacto o una llamada), y sin trabar lo que la persona esté haciendo. */
  const puedeAtarVentas = datosListos && nivelEn(acceso, "ventas") >= 2 && !esCuentaDeCloser(acceso);
  useEffect(() => {
    if (!puedeAtarVentas) return;
    const t = window.setTimeout(() => { acciones.atarVentasAWebinars({ crearWebinars: false, automatico: true }); }, 2500);
    return () => window.clearTimeout(t);
  }, [puedeAtarVentas, estado.ventas, estado.webinars]);
  /* «Se unieron al grupo» de cada webinar viene del lector de WhatsApp y cambia con cada entrada y salida: mientras la app
     está abierta y a la vista se vuelve a pedir cada dos minutos (y al volver a la pestaña). */
  useEffect(() => {
    if (!datosListos) return;
    const pedir = () => { if (document.visibilityState === "visible") void acciones.refrescarGruposWpp(); };
    const cada = window.setInterval(pedir, 120_000);
    document.addEventListener("visibilitychange", pedir);
    return () => { window.clearInterval(cada); document.removeEventListener("visibilitychange", pedir); };
  }, [datosListos]);
  function fotoDespues() {
    aplazarFoto(quienYo, hoyDelNegocio());
    setAplazo({ quien: quienYo, aplazada: true });
    toast("Listo, te la pido de nuevo mañana. Cuando quieras, tocá tu foto abajo a la izquierda.");
  }

  /* Menu colapsado. Se lee despues del montado a proposito: leer localStorage
     en el primer render rompe la hidratacion, porque el servidor no lo tiene. */
  const [colapsado, setColapsado] = useState(false);
  useEffect(() => {
    try { setColapsado(localStorage.getItem("apicanta:menu") === "colapsado"); } catch { /* modo privado */ }
  }, []);
  function alternarMenu() {
    setColapsado((c) => {
      try { localStorage.setItem("apicanta:menu", c ? "abierto" : "colapsado"); } catch { /* modo privado */ }
      return !c;
    });
  }
  const salir = useSalir();
  const [menu, setMenu] = useState(false);
  const [paleta, setPaleta] = useState(false);

  useEffect(() => {
    /* Si cambia el usuario, los datos se vuelven a pedir con su sesion. */
    reiniciarCarga();
    void cargarDeLaNube();
  }, [sesion.email]);

  /* También con la búsqueda: ir de Alumnos a su pipeline no cambia la ruta, y
     en el teléfono el menú se quedaba abierto tapando la pantalla. */
  useEffect(() => { setMenu(false); }, [ruta, busqueda]);

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaleta(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* La alarma de cobranza: clientes con 7 días o más de atraso, en rojo al
     lado de Finanzas. Se calcula sólo cuando cambian las cuotas, los pagos o
     las ventas, no a cada tecla. */
  const { cuotas, pagos, ventas } = estado;
  const atrasados = useMemo(
    () => alarmaCobranza({ ...estado, cuotas, pagos, ventas }).clientes[7],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cuotas, pagos, ventas],
  );
  /* Las llamadas de hoy, sin las canceladas: el número de «Mis llamadas» (el menú del
     closer). Sólo se cuenta para quien tiene ese item, y sólo cuando cambian las llamadas:
     un dueño tiene miles y el menú se dibuja a cada cambio. */
  const soyCloser = esCuentaDeCloser(acceso);
  const hoy = diaDeNegocio(new Date().toISOString());
  const llamadasDeHoy = useMemo(
    () => (soyCloser ? estado.sesiones.filter((s) => s.estado !== "cancelada" && diaDeNegocio(s.inicia) === hoy && !esLlamadaDeResell(s)).length : 0),
    [soyCloser, estado.sesiones, hoy],
  );

  /* Los gastos fijos que ya le tocaba pagar y nadie aprobó, y los retiros de
     Hotmart a los que les falta cargar la comisión (lote E). Se cuentan sólo
     cuando cambian los gastos, las plantillas o los movimientos entre cuentas. */
  const { gastos, gastosRecurrentes, traspasos } = estado;
  const fijosPorAprobar = useMemo(
    () => cuantosFaltan({ gastos, gastosRecurrentes }, new Date().toISOString()),
    [gastos, gastosRecurrentes],
  );
  /* Sólo los del mes en curso: lo de meses anteriores se resuelve en el cierre de ese mes (Aldana, 17/10). */
  const delMesEnCurso = useMemo(() => ({ desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }), [hoy]);
  const retirosSinComision = useMemo(
    () => resumenDePases((traspasos ?? []).filter((t) => enRangoDeDias(t.fecha, delMesEnCurso))).faltaComision,
    [traspasos, delMesEnCurso],
  );
  /* Las devoluciones que esperan a alguien: llamadas que quedaron en «Devolución» sin la devolución cargada, y
     reembolsos que informó una pasarela y nadie confirmó (Finanzas → Devoluciones). Sólo para quien ve Finanzas. */
  const { sesiones: sesionesDev, devoluciones: devolucionesDev, ventas: ventasDev, ajustes: ajustesDev } = estado;
  const devolucionesPorDecidir = useMemo(
    () => (nivelDeRuta(acceso, "/finanzas") > 0 ? llamadasEnDevolucionSinCargar(estado).length + propuestasPendientes(estado, delMesEnCurso).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acceso, sesionesDev, devolucionesDev, ventasDev, ajustesDev, delMesEnCurso],
  );
  /* Los días laborables en que Finanzas no cerró su End of Day (los últimos 7, desde que se empezó a usar). */
  const { chequeos: chequeosFinanzas, cargando: cargandoChequeos } = useChequeos(nivelDeRuta(acceso, "/finanzas") > 0);
  const diasSinCerrar = useMemo(
    () => (!cargandoChequeos && nivelDeRuta(acceso, "/finanzas") > 0 ? diasDelEod(chequeosFinanzas, Date.now(), 7).filter((d) => d.estado === "sin-cerrar").length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acceso, chequeosFinanzas, cargandoChequeos, hoy],
  );
  const avisosFinanzas = [
    atrasados > 0 ? `${atrasados === 1 ? "Un cliente atrasado" : `${atrasados} clientes atrasados`} hace 7 días o más` : "",
    fijosPorAprobar > 0 ? `${fijosPorAprobar === 1 ? "Un gasto fijo" : `${fijosPorAprobar} gastos fijos`} por aprobar` : "",
    devolucionesPorDecidir > 0 ? `${devolucionesPorDecidir === 1 ? "Una devolución" : `${devolucionesPorDecidir} devoluciones`} por cargar o confirmar` : "",
    retirosSinComision > 0 ? `${retirosSinComision === 1 ? "Un retiro de Hotmart" : `${retirosSinComision} retiros de Hotmart`} sin la comisión cargada` : "",
  ].filter(Boolean);
  const alertas: Record<string, { n: number; titulo: string }> = {
    "/finanzas": { n: atrasados + fijosPorAprobar + devolucionesPorDecidir + retirosSinComision, titulo: avisosFinanzas.join(" · ") },
    "/finanzas/end-of-day": { n: diasSinCerrar, titulo: `${diasSinCerrar === 1 ? "Un día laborable quedó" : `${diasSinCerrar} días laborables quedaron`} sin cerrar` },
  };

  /* Customer Success: a cuántos alumnos les toca hoy el contacto (lib/seguimiento.ts). */
  const { alumnos: alumnosCS, seguimientos: seguimientosCS, contactos: contactosCS, leads: leadsCS } = estado;
  const aContactar = useMemo(
    () => (nivelDeRuta(acceso, "/alumnos") > 0 ? aContactarHoy(filasDeSeguimiento(estado, hoyDelNegocio())).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acceso, alumnosCS, seguimientosCS, contactosCS, leadsCS, estado.ajustes.seguimiento],
  );

  const contadores: Record<string, number> = {
    "/leads": estado.leads.length,
    "/alumnos": estado.alumnos.filter((a) => a.estado === "activo").length,
    "/alumnos?seccion=hoy": aContactar,
    "/agenda": estado.sesiones.filter((s) => s.estado === "agendada" && new Date(s.inicia) >= new Date()).length,
    "/mis-llamadas": llamadasDeHoy,
    "/webinars": estado.webinars.length,
  };

  /* Un item puede ser una vista de otra pantalla (/alumnos?seccion=pipeline).
     Coincide si coincide la ruta y cada parámetro que pide; de los que
     coinciden gana el más específico, así nunca se prenden dos a la vez. */
  const coincide = (href: string) => {
    const [camino, query] = href.split("?");
    if (ruta !== camino && !ruta.startsWith(camino + "/")) return false;
    return !query || [...new URLSearchParams(query)].every(([k, v]) => busqueda.get(k) === v);
  };
  const masEspecifico = (items: typeof TODOS_LOS_ITEMS) => items.filter((i) => coincide(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const item = masEspecifico(nav.flatMap((g) => g.items));
  /* Una pantalla que no está en su menú (el closer abre la Agenda por link) igual lleva su título. */
  const encabezado = item ?? masEspecifico(TODOS_LOS_ITEMS);

  return (
    <div className="app-shell" data-colapsado={colapsado}>
      {menu && (
        <div
          onClick={() => setMenu(false)}
          style={{ position: "fixed", inset: 0, zIndex: 35, background: "var(--overlay)" }}
        />
      )}

      {/* Reserva el ancho en el grid. El menu en si queda fijo encima, que es
          lo que le permite ensancharse en hover sin empujar el contenido. */}
      <div className="hk-sidebar-spacer" aria-hidden="true" />

      <nav className="hk-sidebar" data-abierto={menu} aria-label="Navegación principal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <Link href={inicio} className="hk-sidebar__brand" style={{ padding: "8px 12px" }}>
            <span className="marca-larga">Apicanta</span><span className="marca-corta">A</span><em>.</em>
          </Link>
          <IconButton etiqueta="Cerrar menú" onClick={() => setMenu(false)} className="sidebar-toggle">
            <X size={18} />
          </IconButton>
          <IconButton
            etiqueta={colapsado ? "Expandir el menú" : "Colapsar el menú"}
            onClick={alternarMenu}
            className="menu-colapsar"
          >
            {colapsado ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
        </div>

        <div className="hk-sidebar__nav">
          {nav.map((g) => (
            <div key={g.titulo}>
              <div className="hk-sidebar__group"><span>{g.titulo}</span></div>
              <ul className="hk-nav">
                {g.items.map((i) => {
                  const activo = i.href === item?.href;
                  const Ico = i.icono;
                  return (
                    <li key={i.href}>
                      <Link href={hrefRecordado(i.href)} aria-current={activo ? "page" : undefined} title={i.ayuda}>
                        <Ico />
                        <span>{i.texto}</span>
                        {alertas[i.href]?.n > 0 ? (
                          <span className="hk-nav__count hk-nav__count--alerta" title={alertas[i.href].titulo} aria-label={alertas[i.href].titulo}>
                            {alertas[i.href].n}
                          </span>
                        ) : contadores[i.href] !== undefined && contadores[i.href] > 0 && (
                          <span className="hk-nav__count">{contadores[i.href]}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="hk-sidebar__footer">
          <EstadoDatos estado={sync.estado} error={sync.error} />
          <div className="row-3">
            <button type="button" className="fp-yo" onClick={() => setCambiarFoto(true)} aria-label="Cambiar tu foto de perfil" title="Cambiar tu foto de perfil">
              <Avatar nombre={nombreYo} foto={miFoto} />
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-strong truncate" style={{ fontSize: 14 }}>{nombreYo}</div>
              <div className="t-sm t-subtle truncate">{sesion.email ?? estado.ajustes.negocio}</div>
            </div>
            {!sesion.sinAuth && (
              <IconButton etiqueta="Cerrar sesión" onClick={() => { void salir(); }}>
                <LogOut size={17} />
              </IconButton>
            )}
            <IconButton
              etiqueta={tema === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              onClick={() => setTema(tema === "dark" ? "light" : "dark")}
            >
              {tema === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
          </div>
        </div>
      </nav>

      <div className="app-main">
        <header className="app-topbar">
          <IconButton etiqueta="Abrir menú" onClick={() => setMenu(true)} className="sidebar-toggle">
            <Menu size={20} />
          </IconButton>
          <div className="app-topbar__title">
            <span className="t-strong truncate" style={{ fontSize: 15 }}>{encabezado?.texto ?? "Apicanta"}</span>
            <span className="t-sm t-subtle truncate">{encabezado?.ayuda ?? ""}</span>
          </div>
          <div className="app-topbar__actions">
            {/* Lo que pone cada pantalla (ver AccionesTopbar). */}
            <div id={ID_ACCIONES_TOPBAR} style={{ display: "contents" }} />
            <Button sm variante="secondary" icono={<Search size={16} />} onClick={() => setPaleta(true)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Buscar
                <kbd>⌘K</kbd>
              </span>
            </Button>
            <Campanita />
          </div>
        </header>

        <main className="app-content">
          {verComo && (
            <div className="aviso-tipo" role="status">
              <Eye size={15} aria-hidden />
              <span>Estás viendo la app como <strong>{acceso?.nombre ?? verComo}</strong>: el menú y los permisos de ese tipo. Sólo en la app local; lo suyo lo recorta la base.</span>
              <button type="button" className="link" onClick={() => elegirVerComo(null)}>Volver a Dueño</button>
            </div>
          )}
          {hayNube && cargandoAcceso ? (
            <div className="skeleton" style={{ height: 320 }} aria-busy="true" aria-label="Viendo qué podés ver" />
          ) : !acceso ? (
            <Card>
              <Empty
                icono={<Lock size={22} />} titulo="Tu usuario no tiene acceso"
                texto="Entraste, pero tu correo no está entre los accesos a la app, o no se pudo saber qué podés ver. Pediles a los dueños que te den acceso, o recargá la página."
              />
            </Card>
          ) : nivelRuta === 0 ? (
            <Card>
              <Empty
                icono={<Lock size={22} />} titulo="Esta pantalla no es de tu tipo de cuenta"
                texto={`Con tu tipo de cuenta (${acceso.nombre}) no se ve. Si la necesitás, pedísela a los dueños desde acá.`}
                accion={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                    <PedirAccesoPantalla pedido={{ pantalla: encabezado?.texto ?? "esta pantalla", ruta, quiere: "ver" }} />
                    <Link href={inicio}><Button variante="ghost">Ir a mi inicio</Button></Link>
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              {/* Mi panel es lo de cada uno: el setter (que mira el CRM) suma ahí sus agendas, y eso sí se guarda. */}
              {nivelRuta === 1 && areaDeRuta(ruta) !== "panel" && ruta !== "/mi-panel" && (
                <div className="aviso-tipo" role="note">
                  <Eye size={15} aria-hidden />
                  <span>Con tu tipo de cuenta esta pantalla es para mirar: lo que cambies no se guarda.</span>
                  <PedirPermisoParaEditar pedido={{ pantalla: encabezado?.texto ?? "esta pantalla", ruta }} />
                </div>
              )}
              {children}
            </>
          )}
        </main>
      </div>

      <Paleta abierto={paleta} onCerrar={() => setPaleta(false)} />
      {(faltaFoto || cambiarFoto) && (
        <FotoDePerfil quien={quienYo} nombre={yo.nombre} obligatoria={faltaFoto} actual={miFoto} onCerrar={() => setCambiarFoto(false)} onDespues={fotoDespues} />
      )}
      <Tour />
      {hayNube && <AvisoVersion />}
    </div>
  );
}

/* Dice de un vistazo donde estan los datos y si se guardaron. */
function EstadoDatos({ estado, error }: { estado: ReturnType<typeof useSync>["estado"]; error: string }) {
  const info = {
    local:     { ico: <HardDrive size={13} />, texto: "Guardado en este navegador", color: "var(--ink-subtle)" },
    cargando:  { ico: <RefreshCw size={13} />, texto: "Trayendo tus datos…",        color: "var(--ink-subtle)" },
    guardando: { ico: <RefreshCw size={13} />, texto: "Guardando…",                 color: "var(--brand)" },
    listo:     { ico: <Check size={13} />,     texto: "Todo guardado en la nube",   color: "var(--success)" },
    /* El error real vale mas que la etiqueta: "No se pudo guardar" mentia
       cuando lo que fallaba era el permiso de lectura. */
    error:     { ico: <AlertCircle size={13} />, texto: error || "No se pudo guardar", color: "var(--danger)" },
  }[estado];

  return (
    <div
      className="row"
      style={{ gap: 6, marginBottom: "var(--space-3)", color: info.color, fontSize: 12 }}
      title={error || (hayNube ? "Sincroniza con Supabase" : "Sin base configurada: los datos viven en este navegador")}
    >
      {info.ico}
      <span className="truncate">{info.texto}</span>
      {hayNube && estado !== "error" && <Cloud size={13} style={{ marginLeft: "auto", opacity: 0.6 }} />}
    </div>
  );
}
