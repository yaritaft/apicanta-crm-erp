"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, GitMerge, RefreshCw, Search, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHead, Chip, Empty, Input, Select, StatCard } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useAcceso } from "@/lib/acceso";
import { acciones } from "@/lib/store";
import { money, num, relativo } from "@/lib/format";
import { mesDeNegocio } from "@/lib/dia-negocio";
import { moverPeriodo, nombrePeriodo } from "@/lib/periodos";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { herenciaDeFormulario } from "@/lib/cruce-formularios";
import { telefonoLegible } from "@/lib/telefonos";
import { isoDePais, type MetodoCruce, type RegistroForm } from "@/lib/registros-webinar";
import {
  buscarFormularios, descartarFormulario, ErrorConciliacion, unirFormulario, type EstadoDelCruceLeido,
} from "@/lib/conciliacion-nube";
import {
  caminoSugerido, CAMINOS, otroCaminoDe, propuestasPara, textoDeCamino, type CaminoId, type Pendiente, type Propuesta,
} from "@/lib/pendientes-conciliar";
import { usePendientesDelMes, type DatosDePendientes } from "./usePendientes";
import "./conciliacion.css";

/* ==================================================================
   Pendientes de conciliar: las personas que agendaron o compraron en un mes y
   no tienen atado el formulario que llenaron.

   El cruce automático (cada media hora) une solo lo seguro: mismo mail o mismo
   teléfono. Lo que queda acá lo resuelve una persona de tres maneras:
     · Unir con un formulario que se le parece (otro mail, otro nombre…);
     · buscar el formulario a mano, si no apareció solo;
     · marcar que vino por otro camino (Setter, un referido…): no llenó el
       formulario de la landing, y se anota cómo llegó.
   Al unir, la persona toma el anuncio y el webinar del formulario: sus ventas
   se atribuyen a lo que vio. Es la misma pantalla en Finanzas (un paso del mes)
   y en Marketing (su pestaña «Conciliación»).
   ================================================================== */

/** «2026-10-12» → «12/10». El día ya viene en hora de Argentina: no se pasa por Date. */
const diaCorto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

const COMO: Record<string, string> = { mail: "mismo mail", telefono: "mismo teléfono", nombre: "nombre parecido" };
const CANALES = (["webinar", "vsl", "setter", "otro"] as const);

/** El mes con su pantalla armada. `onMes` muestra el selector de mes (Marketing); sin él, el mes lo fija quien la usa (Finanzas). */
export function PendientesDeConciliar({ mes, onMes }: { mes: string; onMes?: (m: string) => void }) {
  const datos = usePendientesDelMes(mes);
  return <PantallaPendientes datos={datos} onMes={onMes} />;
}

export function PantallaPendientes({ datos, onMes }: { datos: DatosDePendientes; onMes?: (m: string) => void }) {
  const { mes, carga, resumen, pendientes, marcados, puedeEditar } = datos;
  const [quien, setQuien] = useState<"todos" | "venta" | "agenda">("todos");
  const [canal, setCanal] = useState<string>("");
  const [buscaLista, setBuscaLista] = useState("");
  /* «No es»: a esta persona ese formulario no se le vuelve a proponer (el servidor lo guarda; acá se oculta al instante). */
  const [descartes, setDescartes] = useState<Set<string>>(new Set());
  const hoyMes = mesDeNegocio(Date.now());

  const visibles = useMemo(() => {
    const q = buscaLista.trim().toLowerCase();
    return pendientes.filter((p) => {
      if (quien === "venta" && p.tipo === "agenda") return false;
      if (quien === "agenda" && p.tipo !== "agenda") return false;
      if (canal && p.canal !== canal) return false;
      if (!q) return true;
      return [p.persona.nombre, ...p.persona.emails, p.persona.telefono ?? ""].some((x) => x.toLowerCase().includes(q));
    });
  }, [pendientes, quien, canal, buscaLista]);
  const porCanal = (c: string) => pendientes.filter((p) => p.canal === c).length;

  return (
    <div className="stack-4 pc">
      <div className="pc-barra">
        {onMes ? (
          <div className="pc-mes">
            <Button sm variante="secondary" icono={<ChevronLeft size={15} />} aria-label="Mes anterior" onClick={() => onMes(moverPeriodo(mes, -1))} />
            <span className="pc-mes__nombre">{nombrePeriodo(mes)}</span>
            <Button sm variante="secondary" icono={<ChevronRight size={15} />} aria-label="Mes siguiente" disabled={mes >= hoyMes} onClick={() => onMes(moverPeriodo(mes, 1))} />
          </div>
        ) : <span className="pc-mes__nombre">{nombrePeriodo(mes)}</span>}
        <EstadoDelCruce cruce={datos.cruce} onRecargar={datos.recargar} cargando={carga === "cargando"} />
      </div>

      {carga === "sin-nube" && (
        <Card><Empty icono={<GitMerge size={22} />} titulo="Esto necesita la base en la nube" texto="Los formularios viven en Supabase; en la demo local no hay nada para conciliar." /></Card>
      )}
      {carga === "sin-permiso" && (
        <Card><Empty icono={<GitMerge size={22} />} titulo="Tu tipo de cuenta no ve esto" texto="Lo ven quienes tienen Finanzas, Marketing o Webinars." /></Card>
      )}
      {carga === "error" && (
        <Card><Empty icono={<GitMerge size={22} />} titulo="No pude consultar los formularios" texto={datos.error} accion={<Button variante="secondary" onClick={datos.recargar}>Reintentar</Button>} /></Card>
      )}

      {(carga === "cargando" || carga === "listo") && (
        <>
          <div className="grid-stats">
            <StatCard
              hero etiqueta="Pendientes de conciliar" valor={carga === "listo" ? num(resumen.total) : "…"}
              contexto={`de ${nombrePeriodo(mes)}`}
              info={{
                ayuda: "Personas que agendaron una llamada o compraron en el mes y no tienen atado el formulario que llenaron. El cruce automático une solo lo seguro (mismo mail o mismo teléfono): estas las resuelve una persona.",
                formula: "Personas con llamada (no cancelada) o venta del mes − las que ya tienen un formulario unido − las marcadas «vino por otro camino»",
                periodo: nombrePeriodo(mes),
              }}
            />
            <StatCard
              etiqueta="Con venta" valor={carga === "listo" ? num(resumen.conVenta) : "…"}
              contexto={carga === "listo" ? textoMontos(resumen.montos) : undefined}
              info={{
                ayuda: "Compradores del mes sin formulario atado: su venta todavía no se atribuye a ningún anuncio, así que el costo por venta y el ROAS la dejan afuera. Son las que más urge resolver.",
                formula: "Pendientes con una venta del mes (no cancelada ni excluida de Marketing)",
                periodo: nombrePeriodo(mes),
              }}
            />
            <StatCard
              etiqueta="Sólo agenda" valor={carga === "listo" ? num(resumen.soloAgenda) : "…"} contexto="agendaron, todavía no compraron"
              info={{ ayuda: "Personas con una llamada en el mes y sin formulario atado. Si compran después, la venta quedaría sin origen.", formula: "Pendientes sin ninguna venta del mes", periodo: nombrePeriodo(mes) }}
            />
            <StatCard
              etiqueta="Por otro camino" valor={num(marcados.length)} contexto="marcadas a mano"
              info={{ ayuda: "Personas del mes que no pasaron por el formulario de la landing (Setter, un referido…) y alguien lo anotó. Ya no figuran como pendientes.", formula: "Personas del mes marcadas «vino por otro camino»", periodo: nombrePeriodo(mes) }}
            />
          </div>

          {!puedeEditar && carga === "listo" && (
            <p className="t-sm t-subtle">Tu tipo de cuenta puede mirar esta lista, pero no unir ni marcar.</p>
          )}

          <Card style={{ padding: 0 }}>
            <div className="pc-cabeza">
              <CardHead
                titulo={`Para conciliar (${num(visibles.length)}${visibles.length !== pendientes.length ? ` de ${num(pendientes.length)}` : ""})`}
                sub="Unilos con su formulario o marcá que vinieron por otro camino."
              />
              <div className="pc-filtros">
                <Chip activo={quien === "todos"} onClick={() => setQuien("todos")} count={pendientes.length}>Todos</Chip>
                <Chip activo={quien === "venta"} onClick={() => setQuien("venta")} count={resumen.conVenta}>Con venta</Chip>
                <Chip activo={quien === "agenda"} onClick={() => setQuien("agenda")} count={resumen.soloAgenda}>Sólo agenda</Chip>
                <span className="pc-filtros__sep" aria-hidden />
                {CANALES.filter((c) => porCanal(c) > 0).map((c) => (
                  <Chip key={c} activo={canal === c} onClick={() => setCanal(canal === c ? "" : c)} count={porCanal(c)} title={`Agendó por ${ETIQUETA_CANAL[c]}`}>{ETIQUETA_CANAL[c]}</Chip>
                ))}
                <div className="pc-filtros__busca">
                  <Input icono={<Search size={16} />} value={buscaLista} onChange={(ev) => setBuscaLista(ev.target.value)} placeholder="Buscar por nombre, mail o teléfono" aria-label="Buscar en la lista" />
                </div>
              </div>
            </div>

            {carga === "cargando" ? (
              <p className="pc-vacio t-sm t-subtle">Buscando los formularios que se parecen…</p>
            ) : visibles.length === 0 ? (
              <Empty
                icono={<CheckCircle2 size={22} />}
                titulo={pendientes.length === 0 ? `Todo conciliado en ${nombrePeriodo(mes)}` : "Nadie coincide con ese filtro"}
                texto={pendientes.length === 0
                  ? "Cada persona que agendó o compró este mes tiene su formulario atado o está marcada por otro camino."
                  : "Probá con otro filtro o borrá la búsqueda."}
              />
            ) : (
              <div className="pc-lista">
                {visibles.map((p) => (
                  <FilaPendiente key={p.id} p={p} datos={datos} descartes={descartes}
                    onDescartar={(rid) => setDescartes((d) => new Set(d).add(`${rid}:${p.id}`))} />
                ))}
              </div>
            )}
          </Card>

          {marcados.length > 0 && <Marcados marcados={marcados} puedeEditar={puedeEditar} mes={mes} />}
        </>
      )}
    </div>
  );
}

const textoMontos = (m: Partial<Record<"USD" | "ARS", number>>) => {
  const partes = [m.USD ? money(m.USD, "USD") : "", m.ARS ? money(m.ARS, "ARS") : ""].filter(Boolean);
  return partes.length ? `${partes.join(" + ")} sin origen` : "compraron sin formulario";
};

/* ---------- El estado del cruce automático ---------- */

const UNA_HORA_Y_MEDIA = 90 * 60 * 1000;

function EstadoDelCruce({ cruce, onRecargar, cargando }: { cruce: EstadoDelCruceLeido | null; onRecargar: () => void; cargando: boolean }) {
  let cuerpo: React.ReactNode;
  if (!cruce) {
    cuerpo = <span className="t-sm t-subtle">{cargando ? "Mirando el cruce automático…" : "No pude ver el estado del cruce automático."}</span>;
  } else if (cruce.sinTabla) {
    cuerpo = <><Badge variante="warning">Sin registro</Badge><span className="t-sm t-subtle">El cruce corre cada media hora, pero todavía no deja constancia (falta supabase/cron-estado.sql).</span></>;
  } else if (!cruce.estado) {
    cuerpo = <><Badge variante="neutral">Esperando</Badge><span className="t-sm t-subtle">El cruce automático corre cada media hora; todavía no dejó su primera constancia.</span></>;
  } else {
    const e = cruce.estado;
    const viejo = Date.now() - +new Date(e.ejecutadoEn) > UNA_HORA_Y_MEDIA;
    const r = e.resultado ?? {};
    const unidos = Number(r.unidos ?? 0);
    cuerpo = (
      <>
        {!e.ok ? <Badge variante="danger">Falló</Badge> : viejo ? <Badge variante="warning">Atrasado</Badge> : <Badge variante="success">Al día</Badge>}
        <span className="t-sm">
          Cruce automático: corrió {relativo(e.ejecutadoEn)}
          {e.ok ? <> · unió {num(unidos)}{r.dudosas ? <> · {num(Number(r.dudosas))} dudosos</> : null}</> : <> · {r.error ?? (r.errores ?? [])[0] ?? "con errores"}</>}
        </span>
        {e.ultimaUnionEn && <span className="t-sm t-subtle">Última vez que unió algo: {relativo(e.ultimaUnionEn)}</span>}
        {viejo && e.ok && <span className="t-sm t-subtle">Debería correr cada media hora: avisale a quien mantiene la app.</span>}
      </>
    );
  }
  return (
    <div className="pc-cruce">
      {cuerpo}
      <Button sm variante="ghost" icono={<RefreshCw size={14} />} onClick={onRecargar} aria-label="Actualizar la lista">Actualizar</Button>
    </div>
  );
}

/* ---------- Una persona ---------- */

function FilaPendiente({ p, datos, descartes, onDescartar }: { p: Pendiente; datos: DatosDePendientes; descartes: Set<string>; onDescartar: (registroId: string) => void }) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const [ocupado, setOcupado] = useState("");
  const [modo, setModo] = useState<"" | "buscar" | "camino">("");
  const iso = isoDePais(p.persona.pais);

  const propuestas = useMemo(
    () => propuestasPara(p, datos.registros).filter((x) => !descartes.has(`${x.registro.id}:${p.id}`)),
    [p, datos.registros, descartes],
  );

  async function unir(r: RegistroForm, cruce: MetodoCruce) {
    const contacto = p.contacto;
    if (!contacto || !datos.puedeEditar) return;
    setOcupado(r.id);
    try {
      const unido = await unirFormulario(r.id, contacto.id, cruce);
      /* La persona toma lo que le faltaba del formulario: el anuncio, el webinar, el teléfono y los UTMs de la pauta. */
      const herencia = herenciaDeFormulario(contacto, unido);
      if (herencia) {
        acciones.heredarDeFormulario(contacto.id, herencia,
          `${contacto.nombre}: tomó del formulario del webinar ${unido.fechaWebinar ? unido.fechaWebinar.split("-").reverse().join("/") : ""} (${unido.email}) lo que le faltaba.`);
      }
      datos.uniDo(contacto.id, r.id);
      toast(herencia?.origenAdId ? `Atado. ${contacto.nombre} ahora cuenta para el anuncio que vio.` : `Atado. ${contacto.nombre} ya tiene su formulario.`);
    } catch (x) {
      toast(x instanceof ErrorConciliacion ? x.message : "No se pudo unir.", "err");
      if (x instanceof ErrorConciliacion && /ya se unió/.test(x.message)) datos.quitarRegistro(r.id);
    } finally { setOcupado(""); }
  }

  async function noEs(r: RegistroForm) {
    setOcupado(r.id);
    try {
      await descartarFormulario(r.id, p.contacto?.id ?? p.id);
      onDescartar(r.id);
    } catch (x) {
      toast(x instanceof ErrorConciliacion ? x.message : "No se pudo guardar.", "err");
    } finally { setOcupado(""); }
  }

  function marcar(camino: CaminoId, nota: string) {
    if (!p.contacto) return;
    const ok = acciones.marcarOtroCamino(
      p.contacto.id,
      { camino, nota: nota.trim() || undefined, por: acceso?.nombre, en: new Date().toISOString() },
      `${p.contacto.nombre}: marcado como que vino por otro camino (${textoDeCamino(camino)})${nota.trim() ? `: ${nota.trim()}` : ""}.`,
    );
    if (!ok) { toast("Tu tipo de cuenta no puede cambiar la ficha de esta persona.", "err"); return; }
    toast(`${p.contacto.nombre}: vino por ${textoDeCamino(camino).toLowerCase()}. Ya no figura como pendiente.`);
  }

  /* Quien agendó por Setter o por VSL casi seguro nunca llenó el formulario de la landing: un clic y listo. */
  const sugerido = caminoSugerido(p.canal);
  const ventas = p.eventos.filter((x) => x.tipo === "venta");
  const llamadas = p.eventos.filter((x) => x.tipo === "agenda");
  return (
    <div className="pc-fila">
      <div className="pc-persona">
        <button type="button" className="pc-nombre" onClick={() => abrirFicha(p.contacto?.id ?? p.id, ventas.length ? "ventas" : "llamadas")} title="Abrir la ficha">
          {p.persona.nombre || p.persona.emails[0] || "Sin nombre"}
        </button>
        <span className="t-sm t-subtle pc-dato">{p.persona.emails.join(" · ") || "Sin mail"}</span>
        <span className="t-sm t-subtle pc-dato">{p.persona.telefono ? telefonoLegible(p.persona.telefono, iso) : "Sin teléfono"}</span>
        <div className="pc-eventos">
          {ventas.map((v) => (
            <Badge key={v.id} variante="success">Compró {v.monto && v.moneda ? money(v.monto, v.moneda) : ""} · {diaCorto(v.dia)}</Badge>
          ))}
          {llamadas.map((l) => (
            <Badge key={l.id} variante="neutral">Llamada{l.canal ? ` ${ETIQUETA_CANAL[l.canal]}` : ""} · {diaCorto(l.dia)}</Badge>
          ))}
        </div>
      </div>

      <div className="pc-propuestas">
        {p.sinFicha ? (
          <p className="t-sm t-subtle">No tiene ficha de contacto: no hay a quién atar el formulario. Abrila para completarla.</p>
        ) : propuestas.length === 0 ? (
          <p className="t-sm t-subtle">Sin formularios parecidos{sugerido ? ` · agendó por ${ETIQUETA_CANAL[p.canal!]}` : ""}.</p>
        ) : (
          propuestas.slice(0, 4).map((x) => (
            <Propuesta key={x.registro.id} x={x} puedeEditar={datos.puedeEditar} ocupado={ocupado === x.registro.id}
              onUnir={() => void unir(x.registro, x.candidato.metodo)} onNoEs={() => void noEs(x.registro)} />
          ))
        )}
        {propuestas.length > 4 && <span className="t-sm t-subtle">y {propuestas.length - 4} más: usá «Buscar a mano».</span>}
      </div>

      {datos.puedeEditar && !p.sinFicha && (
        <div className="pc-acciones">
          {sugerido && <Button sm variante="brand" onClick={() => marcar(sugerido, "")}>Vino por {ETIQUETA_CANAL[p.canal!]}</Button>}
          <Button sm variante={modo === "buscar" ? "brand" : "secondary"} icono={<Search size={14} />} onClick={() => setModo(modo === "buscar" ? "" : "buscar")}>Buscar a mano</Button>
          <Button sm variante={modo === "camino" ? "brand" : "secondary"} onClick={() => setModo(modo === "camino" ? "" : "camino")}>Vino por otro camino</Button>
        </div>
      )}

      {modo === "buscar" && <BuscarAMano p={p} ocupado={ocupado} onUnir={(r) => void unir(r, "manual")} />}
      {modo === "camino" && <OtroCamino p={p} onMarcar={marcar} onCerrar={() => setModo("")} />}
    </div>
  );
}

function Propuesta({ x, puedeEditar, ocupado, onUnir, onNoEs }: { x: Propuesta; puedeEditar: boolean; ocupado: boolean; onUnir: () => void; onNoEs: () => void }) {
  const r = x.registro;
  return (
    <div className="pc-prop">
      <div className="pc-prop__datos">
        <span className="t-strong">{r.nombre || r.email}</span>
        <span className="t-sm t-subtle">{r.email}{r.telefono ? ` · ${telefonoLegible(r.telefono, isoDePais(r.pais))}` : ""}</span>
        <span className="t-sm t-subtle">{r.fechaWebinar ? `Webinar del ${r.fechaWebinar.split("-").reverse().join("/")}` : "Sin webinar"}{r.adId ? " · con anuncio" : ""}</span>
      </div>
      <div className="pc-prop__cual">
        <Badge variante={x.candidato.segura ? "success" : "warning"}>{x.candidato.segura ? "Firme" : "Dudosa"} · {COMO[x.candidato.metodo] ?? x.candidato.metodo}</Badge>
        <span className="t-sm t-subtle">{x.candidato.motivo}</span>
      </div>
      {puedeEditar && (
        <div className="pc-prop__botones">
          <Button sm variante="brand" cargando={ocupado} onClick={onUnir}>Unir</Button>
          <Button sm variante="secondary" disabled={ocupado} onClick={onNoEs}>No es</Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Buscar el formulario a mano ---------- */

function BuscarAMano({ p, ocupado, onUnir }: { p: Pendiente; ocupado: string; onUnir: (r: RegistroForm) => void }) {
  const [q, setQ] = useState(p.persona.nombre);
  const [resultados, setResultados] = useState<RegistroForm[] | null>(null);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 3) { setResultados(null); setError(""); return; }
    let vigente = true;
    setBuscando(true);
    const t = window.setTimeout(() => {
      buscarFormularios(texto)
        .then((r) => { if (vigente) { setResultados(r); setError(""); } })
        .catch((x) => { if (vigente) setError(x instanceof ErrorConciliacion ? x.message : "No pude buscar."); })
        .finally(() => { if (vigente) setBuscando(false); });
    }, 350);
    return () => { vigente = false; window.clearTimeout(t); };
  }, [q]);

  return (
    <div className="pc-extra">
      <div className="pc-extra__fila">
        <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus
          placeholder="Nombre, mail o teléfono con el que llenó el formulario" aria-label="Buscar el formulario" />
        {buscando && <span className="t-sm t-subtle">Buscando…</span>}
      </div>
      {error && <p className="t-sm" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {resultados && resultados.length === 0 && !buscando && <p className="t-sm t-subtle">No encontré ningún formulario con eso. Probá con el mail o con otra parte del nombre.</p>}
      {resultados && resultados.length > 0 && (
        <div className="pc-extra__lista">
          {resultados.map((r) => (
            <div key={r.id} className="pc-prop">
              <div className="pc-prop__datos">
                <span className="t-strong">{r.nombre || r.email}</span>
                <span className="t-sm t-subtle">{r.email}{r.telefono ? ` · ${telefonoLegible(r.telefono, isoDePais(r.pais))}` : ""}</span>
                <span className="t-sm t-subtle">{r.fechaWebinar ? `Webinar del ${r.fechaWebinar.split("-").reverse().join("/")}` : "Sin webinar"}</span>
              </div>
              <div className="pc-prop__botones">
                {r.contactoId
                  ? <Badge variante="neutral">{r.contactoId === p.contacto?.id ? "Ya es de esta persona" : "Ya unido a otra persona"}</Badge>
                  : <Button sm variante="brand" cargando={ocupado === r.id} onClick={() => onUnir(r)}>Unir con {p.persona.nombre.split(" ")[0] || "ella"}</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Marcar que vino por otro camino ---------- */

function OtroCamino({ p, onMarcar, onCerrar }: { p: Pendiente; onMarcar: (c: CaminoId, nota: string) => void; onCerrar: () => void }) {
  /* Sin canal que lo sugiera no se elige solo: marcar «Setter» por error le mentiría al origen de esa persona. */
  const [camino, setCamino] = useState<CaminoId | "">(caminoSugerido(p.canal) ?? "");
  const [nota, setNota] = useState("");
  return (
    <div className="pc-extra">
      <p className="t-sm t-subtle">
        {p.canal === "setter" ? "Agendó por Setter: casi seguro nunca llenó el formulario de la landing. " : ""}
        Si no pasó por el formulario, anotá cómo llegó y sale de la lista.
      </p>
      <div className="pc-extra__fila">
        <div style={{ width: 260 }}>
          <Select value={camino} onChange={(ev) => setCamino(ev.target.value as CaminoId | "")} placeholder="¿Cómo llegó?" opciones={CAMINOS.map((c) => ({ valor: c.id, texto: c.texto }))} aria-label="Cómo llegó" />
        </div>
        <Input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Nota (opcional)" aria-label="Nota" maxLength={160} />
        <Button sm variante="brand" disabled={!camino} onClick={() => camino && onMarcar(camino, nota)}>Marcar</Button>
        <Button sm variante="ghost" onClick={onCerrar}>Cancelar</Button>
      </div>
    </div>
  );
}

/* ---------- Los ya marcados ---------- */

function Marcados({ marcados, puedeEditar, mes }: { marcados: Pendiente[]; puedeEditar: boolean; mes: string }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  return (
    <Card style={{ padding: 0 }}>
      <button type="button" className="pc-marcados__cabeza" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <span className="t-strong">Marcadas por otro camino en {nombrePeriodo(mes)} ({num(marcados.length)})</span>
        <span className="t-sm t-subtle">{abierto ? "Ocultar" : "Ver"}</span>
      </button>
      {abierto && (
        <div className="pc-lista">
          {marcados.map((p) => {
            const o = otroCaminoDe(p.contacto);
            return (
              <div key={p.id} className="pc-marcado">
                <div className="pc-persona">
                  <span className="t-strong">{p.persona.nombre || p.persona.emails[0]}</span>
                  <span className="t-sm t-subtle">
                    {o ? textoDeCamino(o.camino) : ""}{o?.nota ? ` · ${o.nota}` : ""}{o?.por ? ` · ${o.por}` : ""}{o?.en ? ` · ${relativo(o.en)}` : ""}
                  </span>
                </div>
                {puedeEditar && p.contacto && (
                  <Button sm variante="secondary" icono={<Undo2 size={14} />} onClick={() => {
                    const ok = acciones.marcarOtroCamino(p.contacto!.id, null, `${p.contacto!.nombre}: se deshizo «vino por otro camino».`);
                    toast(ok ? `${p.contacto!.nombre} vuelve a la lista de pendientes.` : "No se pudo deshacer.", ok ? undefined : "err");
                  }}>Deshacer</Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
