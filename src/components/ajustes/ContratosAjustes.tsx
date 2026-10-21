"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plug, Plus, RefreshCw, RotateCcw, Unplug, X } from "lucide-react";
import { Badge, Button, Chip, Field, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { fecha, relativo } from "@/lib/format";
import { PROGRAMAS_POR_DEFECTO, programasDe, type Programa } from "@/lib/programas";
import { nombreDeReunion, PRODUCTOS_WISBOO } from "@/lib/accesos-alumnos";
import type { ConfigContratos } from "@/lib/types";
import type { Pruebas } from "./AccesosAlumnosIntegracion";

/* ==================================================================
   La configuración de los contratos y los accesos (Ajustes → Integraciones,
   dentro de «Accesos de alumnos»). Sólo la cambian los dueños.
   - Contratos desde la venta: apagado / prueba (sólo dueños, sandbox) / encendido.
   - El aviso de PandaDoc (producción y prueba): «Conectar» crea la suscripción.
   - El bot de Telegram: conectarlo y los grupos donde está.
   - Los programas: productos de la venta, plantilla, cursos de Wisboo, grupos,
     reuniones y bonos. Arranca con lo que contó Manu el 20/10.
   ================================================================== */

async function pedir(ruta: string, metodo: "GET" | "POST" = "GET", cuerpo?: object) {
  const r = await fetch(ruta, {
    method: metodo, cache: "no-store",
    headers: { ...(await cabeceras()), ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw Object.assign(new Error(String(j.error ?? `Error ${r.status}`)), { status: r.status, cuerpo: j });
  return j;
}

const ESTADOS: { valor: ConfigContratos["estado"]; texto: string; sub: string }[] = [
  { valor: "apagado", texto: "Apagado", sub: "No aparece el paso del contrato ni los accesos: como hasta ahora." },
  { valor: "prueba", texto: "Prueba", sub: "Sólo los dueños lo ven, y cada contrato sale con la clave sandbox (sólo a mails @apicanta.com, con marca de agua). Los accesos se dan sólo con contratos de prueba." },
  { valor: "duenos", texto: "Sólo dueños", sub: "Contratos de verdad: clave de producción, a cualquier mail, y al firmar se dan los accesos solos. Pero los mandan sólo los dueños: el piloto antes de dárselo al equipo." },
  { valor: "encendido", texto: "Encendido", sub: "Todo el equipo: el closer lo manda al cargar la venta, con la clave de producción, y al firmar se dan los accesos solos." },
];

interface Grupo { chatId: string; titulo: string; botEsAdmin: boolean; puedeInvitar: boolean; puedeExpulsar: boolean; vistoEn: string }

export function ContratosAjustes({ pruebas }: { pruebas: Pruebas | null }) {
  const e = useEstado();
  const { esDueno } = useAcceso();
  const config: ConfigContratos = e.ajustes.contratos ?? { estado: "apagado" };
  if (!esDueno) return null;
  return (
    <div className="stack-4" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8 }}>
      <EstadoContratos config={config} />
      <AvisoPandadoc />
      <BotTelegram />
      <Programas pruebas={pruebas} />
    </div>
  );
}

function Seccion({ titulo, sub, children, acciones: extra }: { titulo: string; sub?: string; children: React.ReactNode; acciones?: React.ReactNode }) {
  return (
    <section className="stack-2">
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="t-body" style={{ margin: 0, fontWeight: 500 }}>{titulo}</h3>
          {sub && <p className="t-sm t-subtle" style={{ margin: 0 }}>{sub}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

/* ---------- Apagado / prueba / encendido ---------- */

function EstadoContratos({ config }: { config: ConfigContratos }) {
  const toast = useToast();
  const [asunto, setAsunto] = useState(config.asunto ?? "");
  const [mensaje, setMensaje] = useState(config.mensaje ?? "");
  const elegido = ESTADOS.find((x) => x.valor === config.estado) ?? ESTADOS[0];
  return (
    <Seccion titulo="Contratos desde la venta" sub="El closer manda el contrato de PandaDoc al cargar la venta, y queda atado a la venta, la llamada y el servicio.">
      <div className="row-wrap" style={{ gap: 6 }} role="radiogroup" aria-label="Estado de los contratos">
        {ESTADOS.map((x) => (
          <Chip key={x.valor} activo={config.estado === x.valor}
            onClick={() => { acciones.ajustes({ contratos: { ...config, estado: x.valor } }, `Contratos desde la venta: ${x.texto.toLowerCase()}.`); toast(`Contratos: ${x.texto.toLowerCase()}.`); }}>
            {x.texto}
          </Chip>
        ))}
      </div>
      <p className="t-sm t-muted">{elegido.sub}</p>
      <div className="form-grid">
        <Field label="Asunto del mail" ayuda="{programa} y {nombre} se reemplazan." span2>
          <Input value={asunto} placeholder="Tu contrato de {programa} para firmar" onChange={(ev) => setAsunto(ev.target.value)}
            onBlur={() => { if (asunto !== (config.asunto ?? "")) acciones.ajustesSilencioso({ contratos: { ...config, asunto } }); }} />
        </Field>
        <Field label="Mensaje del mail" span2>
          <Textarea rows={2} value={mensaje} placeholder="Hola {nombre}, te mandamos el contrato de {programa} para que lo firmes…" onChange={(ev) => setMensaje(ev.target.value)}
            onBlur={() => { if (mensaje !== (config.mensaje ?? "")) acciones.ajustesSilencioso({ contratos: { ...config, mensaje } }); }} />
        </Field>
      </div>
    </Seccion>
  );
}

/* ---------- El aviso de PandaDoc ---------- */

interface ModoAviso { modo: "produccion" | "prueba"; clave: boolean; conectado: boolean; conectadoEn: string | null; conectadoPor: string }

function AvisoPandadoc() {
  const toast = useToast();
  const [modos, setModos] = useState<ModoAviso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const leer = useCallback(async () => {
    try { setModos(((await pedir("/api/pandadoc")).modos ?? []) as ModoAviso[]); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo."); }
  }, []);
  useEffect(() => { void leer(); }, [leer]);
  async function hacer(modo: string, accion: "conectar" | "desconectar") {
    setTrabajando(`${modo}:${accion}`);
    try { await pedir("/api/pandadoc", "POST", { accion, modo }); toast(accion === "conectar" ? "Aviso de PandaDoc conectado." : "Aviso desconectado."); }
    catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
  }
  return (
    <Seccion titulo="Aviso de firma de PandaDoc" sub="Con esto, cuando el alumno abre o firma el contrato, la app se entera sola. Además, cada hora se revisan los pendientes por si un aviso se pierde.">
      {error ? <p className="t-sm" style={{ color: "var(--danger)" }}>{error}</p> : !modos ? <div className="skeleton" style={{ height: 40 }} /> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack-1">
          {modos.map((m) => (
            <li key={m.modo} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="t-sm">
                {m.modo === "produccion" ? "Producción" : "Prueba (sandbox)"}
                <span className="t-subtle">{m.conectado ? ` · conectado ${m.conectadoEn ? relativo(m.conectadoEn) : ""}${m.conectadoPor ? ` por ${m.conectadoPor}` : ""}` : !m.clave ? " · falta la clave en este entorno" : ""}</span>
              </span>
              {m.conectado ? (
                <span className="row-wrap" style={{ gap: 6 }}>
                  <Badge variante="success">Conectado</Badge>
                  <Button sm variante="ghost" icono={<Unplug size={14} />} cargando={trabajando === `${m.modo}:desconectar`} onClick={() => void hacer(m.modo, "desconectar")}>Desconectar</Button>
                </span>
              ) : (
                <Button sm variante="secondary" icono={<Plug size={14} />} disabled={!m.clave} cargando={trabajando === `${m.modo}:conectar`} onClick={() => void hacer(m.modo, "conectar")}>Conectar</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

/* ---------- El bot de Telegram ---------- */

function BotTelegram() {
  const toast = useToast();
  const [estado, setEstado] = useState<{ token: boolean; bot?: string | null; webhook?: { uso: string; host: string | null }; grupos: Grupo[] } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [forzar, setForzar] = useState<string | null>(null);
  const leer = useCallback(async () => {
    try { setEstado((await pedir("/api/telegram")) as never); }
    catch (err) { toast(err instanceof Error ? err.message : "No se pudo leer el bot.", "err"); }
  }, [toast]);
  useEffect(() => { void leer(); }, [leer]);
  async function hacer(accion: string, extra: object = {}) {
    setTrabajando(accion);
    try { await pedir("/api/telegram", "POST", { accion, ...extra }); toast(accion === "conectar" ? "Bot conectado a Apicanta." : accion === "revisar" ? "Permisos revisados." : "Bot desconectado."); }
    catch (err) {
      const otra = (err as { cuerpo?: { otra?: string } }).cuerpo?.otra;
      if (accion === "conectar" && (err as { status?: number }).status === 409) setForzar(otra ?? "otra herramienta");
      else toast(err instanceof Error ? err.message : "No se pudo.", "err");
    }
    setTrabajando(null);
    await leer();
  }
  const conectado = estado?.webhook?.uso === "nuestro";
  return (
    <Seccion titulo="Bot de Telegram"
      sub="Agregalo como administrador en cada grupo de alumnos, con permiso para invitar y para expulsar, y escribí /vincular en el grupo: aparece acá para elegirlo en el programa."
      acciones={estado?.token && (
        <span className="row-wrap" style={{ gap: 6 }}>
          {conectado
            ? <Button sm variante="ghost" icono={<Unplug size={14} />} cargando={trabajando === "desconectar"} onClick={() => void hacer("desconectar")}>Desconectar</Button>
            : <Button sm variante="secondary" icono={<Plug size={14} />} cargando={trabajando === "conectar"} onClick={() => void hacer("conectar")}>Conectar el bot</Button>}
          {(estado.grupos?.length ?? 0) > 0 && <Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={trabajando === "revisar"} onClick={() => void hacer("revisar")}>Revisar permisos</Button>}
        </span>
      )}>
      {!estado ? <div className="skeleton" style={{ height: 40 }} /> : !estado.token ? (
        <p className="t-sm t-subtle">Falta TELEGRAM_BOT_TOKEN en Vercel.</p>
      ) : (
        <>
          <p className="t-sm t-muted">
            @{estado.bot}{" · "}
            {conectado ? "conectado a Apicanta" : estado.webhook?.uso === "otra" ? `lo usa otra herramienta (${estado.webhook.host ?? "otra dirección"})` : "sin conectar"}
          </p>
          {estado.grupos.length === 0 ? (
            <p className="t-sm t-subtle">Todavía no hay grupos: conectá el bot y escribí /vincular en cada grupo de alumnos.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack-1">
              {estado.grupos.map((g) => (
                <li key={g.chatId} className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="t-sm">{g.titulo || g.chatId}</span>
                  {g.botEsAdmin && g.puedeInvitar && g.puedeExpulsar
                    ? <Badge variante="success">Listo</Badge>
                    : <Badge variante="warning">{!g.botEsAdmin ? "El bot no es admin" : !g.puedeInvitar ? "No puede invitar" : "No puede expulsar"}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Confirmar abierto={forzar !== null} onCerrar={() => setForzar(null)} confirmarTexto="Conectar igual"
        titulo="¿Conectar el bot igual?"
        texto={`El bot ya lo usa ${forzar}. Telegram deja una sola conexión por bot: si lo conectás a Apicanta, esa herramienta deja de recibir mensajes. Si sigue en uso, conviene crear un bot nuevo sólo para Apicanta.`}
        onConfirmar={() => void hacer("conectar", { forzar: true })} />
    </Seccion>
  );
}

/* ---------- Los programas ---------- */

function Programas({ pruebas }: { pruebas: Pruebas | null }) {
  const e = useEstado();
  const toast = useToast();
  const guardados = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const [lista, setLista] = useState<Programa[]>(guardados);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  useEffect(() => { setLista(guardados); }, [guardados]);
  useEffect(() => { void pedir("/api/telegram").then((j) => setGrupos((j.grupos ?? []) as Grupo[])).catch(() => setGrupos([])); }, []);
  const cambiado = JSON.stringify(lista) !== JSON.stringify(guardados);

  const plantillas = pruebas?.pandadoc.plantillas ?? [];
  const cursos = useMemo(() => {
    const vistos = [...(pruebas?.wisboo.programas ?? []).map((p) => ({ id: p.id, nombre: p.nombre })), ...(pruebas?.wisboo.otros ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))];
    return vistos.length ? vistos : PRODUCTOS_WISBOO;
  }, [pruebas]);
  const reuniones = pruebas?.zoom.reuniones ?? [];
  const productos = e.productos.filter((p) => p.activo);

  const cambiar = (id: string, c: Partial<Programa>) => setLista((xs) => xs.map((p) => (p.id === id ? { ...p, ...c } : p)));
  const alternar = (id: string, campo: "productos" | "wisboo" | "telegram" | "zoom", valor: string) =>
    setLista((xs) => xs.map((p) => (p.id !== id ? p : { ...p, [campo]: p[campo].includes(valor) ? p[campo].filter((x) => x !== valor) : [...p[campo], valor] })));

  return (
    <Seccion titulo="Programas" sub="Qué productos de la venta son cada programa, con qué plantilla sale su contrato y qué accesos se dan al firmar."
      acciones={(
        <span className="row-wrap" style={{ gap: 6 }}>
          <Button sm variante="ghost" icono={<Plus size={14} />} onClick={() => {
            const id = `programa-${Date.now().toString(36)}`;
            setLista((xs) => [...xs, { id, nombre: "Programa nuevo", productos: [], plantillaId: "", plantillaNombre: "", wisboo: [], telegram: [], zoom: [], bonos: [], activo: true }]);
            setAbierto(id);
          }}>Agregar</Button>
          {cambiado && <Button sm variante="ghost" icono={<RotateCcw size={14} />} onClick={() => setLista(guardados)}>Descartar</Button>}
          <Button sm variante="primary" disabled={!cambiado} onClick={() => { acciones.ajustes({ programas: lista }, "Se actualizaron los programas."); toast("Programas guardados."); }}>Guardar</Button>
        </span>
      )}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lista.map((p, k) => {
          const ab = abierto === p.id;
          const resumen = [
            p.plantillaNombre || "sin contrato",
            `${p.wisboo.length} ${p.wisboo.length === 1 ? "curso" : "cursos"}`,
            `${p.telegram.length} ${p.telegram.length === 1 ? "grupo" : "grupos"}`,
            p.zoom.length ? `${p.zoom.length} ${p.zoom.length === 1 ? "reunión" : "reuniones"}` : "",
          ].filter(Boolean).join(" · ");
          return (
            <li key={p.id} style={{ borderTop: k ? "1px solid var(--border)" : undefined, padding: "8px 0" }}>
              <button type="button" className="row-wrap" aria-expanded={ab} onClick={() => setAbierto(ab ? null : p.id)}
                style={{ gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", width: "100%", textAlign: "left", color: "inherit" }}>
                {ab ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="t-body" style={{ fontWeight: 500 }}>{p.nombre}</span>
                {!p.activo && <Badge variante="neutral">Inactivo</Badge>}
                <span className="t-sm t-subtle" style={{ marginLeft: "auto" }}>{resumen}</span>
              </button>
              {ab && (
                <div className="stack-3" style={{ padding: "10px 0 4px 22px" }}>
                  <div className="form-grid">
                    <Field label="Nombre"><Input value={p.nombre} onChange={(ev) => cambiar(p.id, { nombre: ev.target.value })} /></Field>
                    <Field label="Activo">
                      <div className="row-wrap" style={{ gap: 8 }}>
                        <Switch checked={p.activo} onChange={(v) => cambiar(p.id, { activo: v })} etiqueta="Programa activo" />
                        <span className="t-sm t-muted">{p.activo ? "Se ofrece al mandar contratos" : "No se ofrece"}</span>
                      </div>
                    </Field>
                    <Field label="Plantilla de PandaDoc" span2 ayuda={plantillas.length ? undefined : "La lista sale de PandaDoc en la app publicada."}>
                      <Select value={p.plantillaId} placeholder="Sin contrato"
                        onChange={(ev) => cambiar(p.id, { plantillaId: ev.target.value, plantillaNombre: plantillas.find((t) => t.id === ev.target.value)?.nombre ?? p.plantillaNombre })}
                        opciones={[{ valor: "", texto: "Sin contrato" }, ...plantillas.map((t) => ({ valor: t.id, texto: t.nombre })),
                          ...(p.plantillaId && !plantillas.some((t) => t.id === p.plantillaId) ? [{ valor: p.plantillaId, texto: p.plantillaNombre || p.plantillaId }] : [])]} />
                    </Field>
                    <Field label="Contrato de reserva" span2 ayuda="Sale cuando la venta es «Sólo la reserva»: lleva el monto en [Venta.Modalidad] y al firmarlo no se dan accesos.">
                      <Select value={p.plantillaReservaId ?? ""} placeholder="Sin contrato de reserva"
                        onChange={(ev) => cambiar(p.id, { plantillaReservaId: ev.target.value, plantillaReservaNombre: plantillas.find((t) => t.id === ev.target.value)?.nombre ?? "" })}
                        opciones={[{ valor: "", texto: "Sin contrato de reserva" }, ...plantillas.map((t) => ({ valor: t.id, texto: t.nombre })),
                          ...(p.plantillaReservaId && !plantillas.some((t) => t.id === p.plantillaReservaId) ? [{ valor: p.plantillaReservaId, texto: p.plantillaReservaNombre || p.plantillaReservaId }] : [])]} />
                    </Field>
                  </div>
                  <Opciones titulo="Productos de la venta que son este programa" valores={p.productos} onAlternar={(v) => alternar(p.id, "productos", v)}
                    opciones={productos.map((x) => ({ id: x.id, nombre: x.nombre }))} />
                  <Opciones titulo="Cursos de Wisboo que se regalan" valores={p.wisboo} onAlternar={(v) => alternar(p.id, "wisboo", v)} opciones={cursos} />
                  <Opciones titulo="Grupos de Telegram" valores={p.telegram} onAlternar={(v) => alternar(p.id, "telegram", v)}
                    opciones={grupos.map((g) => ({ id: g.chatId, nombre: g.titulo || g.chatId }))} vacio="Todavía no hay grupos vinculados (ver «Bot de Telegram»)." />
                  <Opciones titulo="Reuniones de Zoom" valores={p.zoom} onAlternar={(v) => alternar(p.id, "zoom", v)}
                    opciones={reuniones.map((m) => ({ id: m.id, nombre: nombreDeReunion(m, reuniones) }))} vacio="Cuando se conecte Zoom aparecen sus reuniones." />
                  {p.zoom.some((id) => reuniones.find((m) => m.id === id)?.inscripcion === false) && (
                    <p className="t-sm" style={{ color: "var(--warning)" }}>Hay una reunión sin inscripción: en Zoom activale «Registro» (y que no sea recurrente sin horario fijo), si no, no se puede anotar a nadie.</p>
                  )}
                  <Bonos bonos={p.bonos} onCambio={(bonos) => cambiar(p.id, { bonos })} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {JSON.stringify(guardados) === JSON.stringify(PROGRAMAS_POR_DEFECTO) && (
        <p className="t-sm t-subtle">Son los de siempre (lo que contó Manu el {fecha("2026-10-20")}). Al guardar quedan como propios.</p>
      )}
    </Seccion>
  );
}

function Opciones({ titulo, opciones, valores, onAlternar, vacio }: {
  titulo: string; opciones: { id: string; nombre: string }[]; valores: string[]; onAlternar: (v: string) => void; vacio?: string;
}) {
  /* Lo elegido que ya no está en la lista (un grupo del que sacaron al bot) se sigue viendo para poder sacarlo. */
  const todas = [...opciones, ...valores.filter((v) => !opciones.some((o) => o.id === v)).map((v) => ({ id: v, nombre: v }))];
  return (
    <div className="stack-1">
      <span className="hk-label">{titulo}</span>
      {todas.length === 0 ? <span className="t-sm t-subtle">{vacio ?? "No hay opciones."}</span> : (
        <div className="row-wrap" style={{ gap: 6 }}>
          {todas.map((o) => <Chip key={o.id} activo={valores.includes(o.id)} onClick={() => onAlternar(o.id)}>{o.nombre}</Chip>)}
        </div>
      )}
    </div>
  );
}

function Bonos({ bonos, onCambio }: { bonos: string[]; onCambio: (b: string[]) => void }) {
  const [nuevo, setNuevo] = useState("");
  const sumar = () => { const t = nuevo.trim(); if (t && !bonos.includes(t)) onCambio([...bonos, t]); setNuevo(""); };
  return (
    <div className="stack-1">
      <span className="hk-label">Bonos que el closer puede elegir</span>
      <div className="row-wrap" style={{ gap: 6 }}>
        {bonos.map((b) => (
          <span key={b} className="chip" aria-pressed="true" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {b}
            <button type="button" aria-label={`Sacar ${b}`} onClick={() => onCambio(bonos.filter((x) => x !== b))}
              style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", display: "inline-flex" }}><X size={12} /></button>
          </span>
        ))}
        <span style={{ width: 220 }}>
          <Input value={nuevo} placeholder="Agregar un bono" onChange={(ev) => setNuevo(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); sumar(); } }} onBlur={sumar} />
        </span>
      </div>
    </div>
  );
}
