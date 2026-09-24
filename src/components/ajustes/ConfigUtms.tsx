"use client";

import React, { useMemo } from "react";
import { Link2, Plus, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, IconButton, Input, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, num } from "@/lib/format";
import { proyectoDeWebinar, webinarDeProyecto } from "@/lib/angelo";
import {
  CAMPOS_UTM, origenDeUtm, sugerenciaPara, textoUtm, utmsDetectadas, ventasParaCompletar,
  type CampoUtm, type Utm,
} from "@/lib/utms";
import type { ReglaUtm } from "@/lib/types";

/* ==================================================================
   Ajustes → UTMs: de qué estrategia, proyecto y webinar es cada UTM.

   El origen de una venta ya no lo elige el closer: sale de los UTMs con
   los que llegó quien compró (ver lib/utms.ts). Acá se arma cada regla
   —la del webinar de hoy es source "Webinar" + medium "23-09"— y se ven
   las UTMs que llegaron y todavía no son de nada, con lo que sugiere la
   app para las de webinar. Las ventas que no tenían origen se completan
   con un botón; lo que alguien eligió a mano no se pisa.
   ================================================================== */

const ETIQUETA: Record<CampoUtm, string> = { source: "utm_source", medium: "utm_medium", campaign: "utm_campaign", content: "utm_content" };

const diaAR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const diaMes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function ConfigUtms() {
  const e = useEstado();
  const toast = useToast();
  const reglas = e.ajustes.reglasUtm ?? [];

  const detectadas = useMemo(() => utmsDetectadas(e), [e]);
  const sinAsignar = detectadas.filter((d) => !d.regla);
  const aCompletar = useMemo(() => ventasParaCompletar(e), [e]);
  /* Cuántas ventas toman su origen de cada regla. */
  const ventasPorRegla = useMemo(() => {
    const n = new Map<string, number>();
    for (const v of e.ventas) {
      const o = origenDeUtm(e, v.contactoId, v.fecha);
      if (o) n.set(o.regla.id, (n.get(o.regla.id) ?? 0) + 1);
    }
    return n;
  }, [e]);
  const personasPorRegla = useMemo(() => {
    const n = new Map<string, number>();
    for (const d of detectadas) if (d.regla) n.set(d.regla.id, (n.get(d.regla.id) ?? 0) + d.personas);
    return n;
  }, [detectadas]);

  const webinars = useMemo(() => [...e.webinars].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.webinars]);
  const proyectos = useMemo(() => {
    const lista = e.ajustes.proyectos ?? [];
    const deWebinars = webinars.slice(0, 20).map((w) => proyectoDeWebinar(w.fecha)).filter((x) => !lista.includes(x));
    return [...deWebinars, ...lista];
  }, [e.ajustes.proyectos, webinars]);
  const estrategias = e.embudos.filter((x) => x.activo).sort((a, b) => a.orden - b.orden);

  /* El webinar de hoy, o el próximo: el que necesita su UTM ya. */
  const hoy = diaAR(new Date().toISOString());
  const proximo = [...webinars].reverse().find((w) => diaAR(w.fecha) >= hoy);
  const utmProximo: Utm | undefined = proximo ? { source: "Webinar", medium: diaMes(proximo.fecha) } : undefined;
  const yaTieneProximo = utmProximo ? reglas.some((r) => (r.source ?? "").toLowerCase() === "webinar" && r.medium === utmProximo.medium) : true;

  function guardar(nuevas: ReglaUtm[], aviso?: string) {
    if (aviso) acciones.ajustes({ reglasUtm: nuevas }, aviso);
    else acciones.ajustesSilencioso({ reglasUtm: nuevas });
  }
  function cambiar(r: ReglaUtm, cambios: Partial<ReglaUtm>, aviso?: string) {
    guardar(reglas.map((x) => (x.id === r.id ? { ...x, ...cambios } : x)));
    if (aviso) toast(aviso);
  }
  function crear(utm: Utm, asignar?: Partial<ReglaUtm>) {
    const r: ReglaUtm = { id: nuevoId("utm"), ...utm, ...asignar, creadoEn: new Date().toISOString() };
    guardar([r, ...reglas], `Se agregó la UTM «${textoUtm(utm)}».`);
    toast(asignar?.webinarId || asignar?.embudoId ? `UTM «${textoUtm(utm)}» asignada.` : "UTM agregada: elegí de qué es.");
    window.setTimeout(() => document.getElementById(`utm-${r.id}-source`)?.focus(), 60);
  }
  function borrar(r: ReglaUtm) {
    guardar(reglas.filter((x) => x.id !== r.id), `Se borró la UTM «${textoUtm(r)}».`);
    toast("UTM borrada. Las ventas que ya tomaron su origen no cambian.");
  }
  function completar() {
    const n = acciones.completarOrigenes(aCompletar.map((x) => ({ id: x.venta.id, cambios: x.cambios })));
    toast(`Se completó el origen de ${num(n)} ${n === 1 ? "venta" : "ventas"}.`);
  }

  /* Elegir el proyecto trae su webinar, y elegir el webinar trae su
     proyecto, si todavía no estaban. */
  function elegirProyecto(r: ReglaUtm, proyecto: string) {
    const w = r.webinarId ? undefined : webinarDeProyecto(proyecto, e.webinars);
    cambiar(r, { proyecto: proyecto || undefined, ...(w ? { webinarId: w.id } : {}) }, "Proyecto guardado.");
  }
  function elegirWebinar(r: ReglaUtm, webinarId: string) {
    const w = e.webinars.find((x) => x.id === webinarId);
    cambiar(r, { webinarId: webinarId || undefined, ...(w && !r.proyecto ? { proyecto: proyectoDeWebinar(w.fecha) } : {}) }, "Webinar guardado.");
  }

  return (
    <div className="stack-4">
      <Card>
        <CardHead
          titulo="De qué es cada UTM"
          sub="La venta toma la estrategia, el proyecto y el webinar de la UTM con la que llegó quien compró. Una regla pide sólo lo que completes: source «Webinar» + medium «23-09» es el webinar del 23/09, venga del anuncio que venga."
        />
        {/* Los botones abajo del título y no al lado: con el texto largo, al
            lado lo dejaban en una columna de una palabra. */}
        <div className="row-wrap" style={{ marginBottom: "var(--space-3)" }}>
          {!yaTieneProximo && utmProximo && proximo && (
            <Button variante="primary" icono={<Wand2 size={16} />}
              onClick={() => crear(utmProximo, sugerenciaPara(e, utmProximo, proximo.fecha))}>
              UTM del webinar del {fechaLarga(proximo.fecha).split(" ").slice(0, 2).join(" ")}
            </Button>
          )}
          <Button variante="secondary" icono={<Plus size={16} />} onClick={() => crear({})}>Agregar UTM</Button>
        </div>
        {reglas.length === 0 ? (
          <Empty icono={<Link2 size={22} />} titulo="Todavía no hay UTMs asignadas"
            texto="Agregá la del webinar o asigná abajo las que ya llegaron." />
        ) : (
          <div className="catalogo-lista">
            {reglas.map((r) => (
              <div className="utm-regla" key={r.id}>
                <div className="utm-regla__utm">
                  {CAMPOS_UTM.map((c) => (
                    <Input
                      key={c} id={`utm-${r.id}-${c}`} aria-label={ETIQUETA[c]} placeholder={ETIQUETA[c]} defaultValue={r[c] ?? ""}
                      onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (r[c] ?? "")) cambiar(r, { [c]: v || undefined }, "UTM guardada."); }}
                    />
                  ))}
                  <IconButton etiqueta={`Borrar la UTM ${textoUtm(r)}`} onClick={() => borrar(r)}><Trash2 size={15} /></IconButton>
                </div>
                <div className="utm-regla__destino">
                  <Select aria-label="Estrategia utilizada" value={r.embudoId ?? ""} placeholder="Estrategia"
                    onChange={(ev) => cambiar(r, { embudoId: ev.target.value || undefined }, "Estrategia guardada.")}
                    opciones={estrategias.map((x) => ({ valor: x.id, texto: x.nombre }))} />
                  <Select aria-label="Proyecto" value={r.proyecto ?? ""} placeholder="Proyecto"
                    onChange={(ev) => elegirProyecto(r, ev.target.value)} opciones={proyectos} />
                  <Select aria-label="Webinar" value={r.webinarId ?? ""} placeholder="Webinar"
                    onChange={(ev) => elegirWebinar(r, ev.target.value)}
                    opciones={webinars.slice(0, 30).map((w) => ({ valor: w.id, texto: `${fechaLarga(w.fecha)} — ${w.titulo}` }))} />
                  <span className="t-sm t-subtle utm-regla__cuenta">
                    {num(personasPorRegla.get(r.id) ?? 0)} personas · {num(ventasPorRegla.get(r.id) ?? 0)} ventas
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {aCompletar.length > 0 && (
        <Card>
          <CardHead
            titulo={`${num(aCompletar.length)} ${aCompletar.length === 1 ? "venta no tiene" : "ventas no tienen"} el origen completo`}
            sub="Quien compró llegó con una UTM que ya tiene regla. Se completa sólo lo que falta (estrategia, proyecto o webinar); lo que alguien eligió a mano queda."
            acciones={<Button variante="primary" onClick={completar}>Completar el origen</Button>}
          />
        </Card>
      )}

      <Card>
        <CardHead
          titulo="UTMs que llegaron sin asignar"
          sub="Los links con los que llegó gente (de sus agendas de Calendly y de su primer contacto) y que todavía no son de nada. Las de webinar traen la sugerencia armada."
        />
        {sinAsignar.length === 0 ? (
          <p className="t-sm t-subtle">Todas las UTMs que llegaron ya tienen de qué son.</p>
        ) : (
          <div className="catalogo-lista">
            {sinAsignar.map((d) => {
              const w = d.sugerida?.webinarId ? e.webinars.find((x) => x.id === d.sugerida!.webinarId) : undefined;
              return (
                <div className="utm-detectada" key={CAMPOS_UTM.map((c) => `${c}=${d.utm[c] ?? ""}`).join("&")}>
                  <span className="utm-detectada__utm">
                    {CAMPOS_UTM.filter((c) => d.utm[c]).map((c) => (
                      <Badge key={c} variante="neutral">{ETIQUETA[c].replace("utm_", "")}: {d.utm[c]}</Badge>
                    ))}
                  </span>
                  <span className="t-sm t-subtle t-num">{num(d.personas)} {d.personas === 1 ? "persona" : "personas"} · última {fechaLarga(d.ultima)}</span>
                  {d.sugerida && w ? (
                    <Button sm variante="secondary" icono={<Wand2 size={14} />} onClick={() => crear(d.utm, d.sugerida)}>
                      Asignar a {d.sugerida.proyecto}
                    </Button>
                  ) : (
                    <Button sm variante="ghost" icono={<Plus size={14} />} onClick={() => crear(d.utm)}>Crear regla</Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
