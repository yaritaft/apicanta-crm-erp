"use client";

import React, { useMemo, useState } from "react";
import { GripVertical, Info, Plus } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, Empty, Persona, Select, StatCard } from "@/components/ui/ui";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money, pct, relativo } from "@/lib/format";
import { tasaConversion, valorPipeline } from "@/lib/metricas";
import type { Lead } from "@/lib/types";

export default function Pipeline() {
  const e = useEstado();
  const toast = useToast();
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [fuente, setFuente] = useState("todas");

  const etapas = useMemo(() => [...e.etapas].sort((a, b) => a.orden - b.orden), [e.etapas]);
  const pipe = valorPipeline(e);

  const leads = useMemo(
    () => (fuente === "todas" ? e.leads : e.leads.filter((l) => l.fuente === fuente)),
    [e.leads, fuente],
  );

  const porEtapa = useMemo(() => {
    const m: Record<string, Lead[]> = {};
    for (const et of etapas) m[et.id] = [];
    for (const l of leads) (m[l.etapaId] ??= []).push(l);
    for (const k of Object.keys(m)) m[k].sort((a, b) => +new Date(b.actualizadoEn) - +new Date(a.actualizadoEn));
    return m;
  }, [leads, etapas]);

  function soltar(etapaId: string) {
    if (!arrastrando) return;
    const lead = e.leads.find((l) => l.id === arrastrando);
    const et = etapas.find((x) => x.id === etapaId);
    if (lead && et && lead.etapaId !== etapaId) {
      acciones.moverLead(arrastrando, etapaId);
      toast(`${lead.nombre} → ${et.nombre}`);
    }
    setArrastrando(null);
    setSobre(null);
  }

  /* Mover con teclado: accesible sin mouse. */
  function moverConTeclado(lead: Lead, dir: -1 | 1) {
    const i = etapas.findIndex((x) => x.id === lead.etapaId);
    const destino = etapas[i + dir];
    if (!destino) return;
    acciones.moverLead(lead.id, destino.id);
    toast(`${lead.nombre} → ${destino.nombre}`);
  }

  const leadVisto = e.leads.find((l) => l.id === ver) ?? null;
  const etapaDe = (id: string) => e.etapas.find((x) => x.id === id);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Pipeline"
        sub="Arrastrá una tarjeta de una columna a otra para mover el lead. Se guarda solo."
        acciones={
          <>
            <div style={{ width: 190 }}>
              <Select
                value={fuente} onChange={(ev) => setFuente(ev.target.value)} aria-label="Filtrar por fuente"
                opciones={[{ valor: "todas", texto: "Todas las fuentes" }, ...e.ajustes.fuentes.map((f) => ({ valor: f, texto: f }))]}
              />
            </div>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => { window.location.href = "/leads?nuevo=1"; }}>Nuevo lead</Button>
          </>
        }
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Pipeline abierto" valor={money(pipe.bruto, e.ajustes.monedaBase)} contexto={`${leads.filter((l) => { const x = etapaDe(l.etapaId); return x && !x.esGanada && !x.esPerdida; }).length} leads en juego`} />
        <StatCard etiqueta="Ponderado" valor={money(pipe.ponderado, e.ajustes.monedaBase)} contexto="según probabilidad de cada etapa" />
        <StatCard etiqueta="Tasa de cierre" valor={pct(tasaConversion(e))} contexto="de los leads ya definidos" />
        <StatCard etiqueta="Ticket promedio" valor={money(leads.length ? leads.reduce((a, l) => a + l.monto, 0) / leads.length : 0, e.ajustes.monedaBase)} contexto="por lead" />
      </div>

      {e.leads.length === 0 ? (
        <Card>
          <Empty
            icono={<GripVertical size={22} />}
            titulo="El tablero está vacío"
            texto="Cargá tu primer lead y va a aparecer en la primera columna, listo para que lo muevas."
            accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => { window.location.href = "/leads?nuevo=1"; }}>Cargar un lead</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="hk-pipeline">
            {etapas.map((et) => {
              const items = porEtapa[et.id] ?? [];
              const suma = items.reduce((a, l) => a + l.monto, 0);
              return (
                <div
                  key={et.id}
                  className={`hk-column${sobre === et.id ? " hk-column--drop" : ""}`}
                  onDragOver={(ev) => { ev.preventDefault(); setSobre(et.id); }}
                  onDragLeave={() => setSobre((s) => (s === et.id ? null : s))}
                  onDrop={() => soltar(et.id)}
                >
                  <div className="hk-column__head">
                    <span className="hk-column__title">{et.nombre}</span>
                    <span className="hk-column__count">{items.length}</span>
                    <span className="hk-column__sum">{money(suma, e.ajustes.monedaBase)}</span>
                  </div>

                  <div className="hk-column__body">
                    {items.length === 0 ? (
                      <p className="column-empty">Sin leads en esta etapa</p>
                    ) : (
                      items.map((l) => (
                        <article
                          key={l.id}
                          className={`hk-deal${arrastrando === l.id ? " hk-deal--dragging" : ""}`}
                          draggable
                          tabIndex={0}
                          role="button"
                          aria-label={`${l.nombre}, ${et.nombre}. Usá las flechas para moverlo de etapa, Enter para abrirlo.`}
                          onDragStart={() => setArrastrando(l.id)}
                          onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                          onClick={() => setVer(l.id)}
                          onKeyDown={(ev) => {
                            if (ev.key === "ArrowRight") { ev.preventDefault(); moverConTeclado(l, 1); }
                            else if (ev.key === "ArrowLeft") { ev.preventDefault(); moverConTeclado(l, -1); }
                            else if (ev.key === "Enter") { ev.preventDefault(); setVer(l.id); }
                          }}
                        >
                          <span className="hk-deal__name truncate">{l.nombre}</span>
                          <span className="hk-deal__row">
                            <span className="truncate">{l.fuente || "Sin fuente"}</span>
                            <span className="hk-deal__amount">{money(l.monto, l.moneda)}</span>
                          </span>
                          <span className="hk-deal__row">
                            <span className="truncate">{l.pais || "—"}</span>
                            <span>{relativo(l.actualizadoEn)}</span>
                          </span>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {leadVisto && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={leadVisto.nombre}
          cabecera={
            <div className="stack-2">
              <Persona nombre={leadVisto.nombre} sub={leadVisto.email} size={40} />
              <div className="row-wrap">
                {(() => { const et = etapaDe(leadVisto.etapaId); return et ? <Badge variante={et.variante}>{et.nombre}</Badge> : null; })()}
                <Badge variante="neutral">{leadVisto.fuente || "Sin fuente"}</Badge>
              </div>
            </div>
          }
          pie={<Button variante="primary" onClick={() => { window.location.href = `/leads?ver=${leadVisto.id}`; }}>Abrir ficha completa</Button>}
        >
          <div className="stack-5">
            <dl className="dl">
              <Dato label="Valor">{money(leadVisto.monto, leadVisto.moneda)}</Dato>
              <Dato label="País">{leadVisto.pais || "—"}</Dato>
              <Dato label="Email">{leadVisto.email || "—"}</Dato>
              <Dato label="Teléfono">{leadVisto.telefono || "—"}</Dato>
              <Dato label="Campaña">{leadVisto.campania || "—"}</Dato>
              <Dato label="Entró">{fechaLarga(leadVisto.creadoEn)}</Dato>
            </dl>
            <div>
              <div className="t-label" style={{ marginBottom: 10 }}>Mover a</div>
              <div className="row-wrap">
                {etapas.filter((x) => x.id !== leadVisto.etapaId).map((et) => (
                  <Button key={et.id} sm variante="secondary" onClick={() => { acciones.moverLead(leadVisto.id, et.id); toast(`${leadVisto.nombre} → ${et.nombre}`); }}>
                    {et.nombre}
                  </Button>
                ))}
              </div>
            </div>
            {leadVisto.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{leadVisto.notas}</p>
              </div>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
