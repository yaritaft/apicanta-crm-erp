"use client";

import React, { useState } from "react";
import { Link2, Plus, X } from "lucide-react";
import { Badge, Button, Card, CardHead, Input, Select, Switch } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { nombrePasarela } from "@/lib/pasarelas";
import type { Embudo, Procesador, Producto } from "@/lib/types";

/* ==================================================================
   Lo que se elige al cargar una venta, con los nombres de la planilla
   de Angelo: servicios, cuentas recaudadoras, estrategias y proyectos.

   Todo se edita en el lugar y se guarda al salir del campo, como el
   equipo. Nada se borra: lo que ya no se usa se apaga, así las ventas
   viejas siguen diciendo con qué se cobraron o qué compraron.
   ================================================================== */

const TIPOS: { valor: Producto["tipo"]; texto: string }[] = [
  { valor: "principal", texto: "Programa" },
  { valor: "downsell", texto: "Downsell" },
  { valor: "upsell", texto: "Upsell" },
  { valor: "evento", texto: "Evento" },
  { valor: "suscripcion", texto: "Suscripción" },
];

export function CatalogosVenta() {
  return (
    <div className="stack-4">
      <Servicios />
      <Cuentas />
      <Estrategias />
      <div className="grid-2">
        <Proyectos />
        <Referidor />
      </div>
    </div>
  );
}

/* ---------- Servicios / Productos ---------- */

function Servicios() {
  const e = useEstado();
  const toast = useToast();
  const lista = [...e.productos].sort((a, b) => a.orden - b.orden);
  const cambiar = (p: Producto, cambios: Partial<Producto>, aviso?: string) => {
    acciones.actualizarSilencioso<Producto>("productos", p.id, cambios);
    if (aviso) toast(aviso);
  };
  function agregar() {
    const id = nuevoId("prod");
    acciones.crear<Producto>("productos", {
      id, nombre: "Nuevo servicio", precioLista: 0, tipo: "principal", activo: true,
      orden: Math.max(-1, ...e.productos.map((x) => x.orden)) + 1,
    }, "Nuevo servicio");
    window.setTimeout(() => document.getElementById(`cat-${id}`)?.focus(), 60);
  }
  return (
    <Card>
      <CardHead
        titulo="Servicios / Productos"
        sub="Lo que se vende. El tipo separa las mentorías de los downsells y los eventos en el Dashboard."
        acciones={<Button variante="secondary" icono={<Plus size={16} />} onClick={agregar}>Agregar servicio</Button>}
      />
      <div className="catalogo-lista">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--servicio" aria-hidden>
          <span>Nombre</span><span>Precio de lista</span><span>Tipo</span><span />
        </div>
        {lista.map((p) => (
          <div className="catalogo-fila catalogo-fila--servicio" key={p.id} data-inactivo={!p.activo || undefined}>
            <Input
              id={`cat-${p.id}`} aria-label="Nombre del servicio" defaultValue={p.nombre}
              onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== p.nombre) cambiar(p, { nombre: v }, "Nombre guardado."); }}
            />
            <Input
              aria-label={`Precio de lista de ${p.nombre}`} type="number" min={0} defaultValue={p.precioLista}
              onBlur={(ev) => { const v = Number(ev.target.value); if (Number.isFinite(v) && v >= 0 && v !== p.precioLista) cambiar(p, { precioLista: v }, "Precio guardado."); }}
            />
            <Select aria-label={`Tipo de ${p.nombre}`} value={p.tipo} opciones={TIPOS}
              onChange={(ev) => cambiar(p, { tipo: ev.target.value as Producto["tipo"] }, "Tipo guardado.")} />
            <label className="row" style={{ gap: 8 }}>
              <Switch checked={p.activo} etiqueta={`${p.nombre} activo`} onChange={(v) => cambiar(p, { activo: v })} />
              <span className="t-sm t-muted">Activo</span>
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Cuentas recaudadoras ---------- */

function Cuentas() {
  const e = useEstado();
  const toast = useToast();
  const cambiar = (p: Procesador, cambios: Partial<Procesador>, aviso?: string) => {
    acciones.actualizarSilencioso<Procesador>("procesadores", p.id, cambios);
    if (aviso) toast(aviso);
  };
  function agregar() {
    const id = nuevoId("proc");
    acciones.crear<Procesador>("procesadores", {
      id, nombre: "Nueva cuenta", feeRate: 0, activo: true, automatico: false,
    }, "Nueva cuenta");
    window.setTimeout(() => document.getElementById(`cat-${id}`)?.focus(), 60);
  }
  return (
    <Card>
      <CardHead
        titulo="Cuentas recaudadoras"
        sub="Por dónde entra la plata. La comisión es la que cobra cada una: si el cobro se concilia con la pasarela manda el fee real; si no, se usa esta y se puede corregir a mano en Finanzas."
        acciones={<Button variante="secondary" icono={<Plus size={16} />} onClick={agregar}>Agregar cuenta</Button>}
      />
      <div className="catalogo-lista">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--cuenta" aria-hidden>
          <span>Nombre</span><span>Comisión (%)</span><span>Cómo se prueba</span><span />
        </div>
        {e.procesadores.map((p) => (
          <div className="catalogo-fila catalogo-fila--cuenta" key={p.id} data-inactivo={!p.activo || undefined}>
            <Input
              id={`cat-${p.id}`} aria-label="Nombre de la cuenta" defaultValue={p.nombre}
              onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== p.nombre) cambiar(p, { nombre: v }, "Nombre guardado."); }}
            />
            <Input
              aria-label={`Comisión de ${p.nombre} (%)`} type="number" min={0} max={100} step={0.1}
              defaultValue={Math.round(p.feeRate * 10000) / 100}
              onBlur={(ev) => {
                const v = Number(ev.target.value);
                if (Number.isFinite(v) && v >= 0 && v <= 100 && v / 100 !== p.feeRate) cambiar(p, { feeRate: v / 100 }, "Comisión guardada.");
              }}
            />
            <span>
              {p.proveedor
                ? <Badge variante="success"><Link2 size={13} />Se concilia con {nombrePasarela(p.proveedor)}</Badge>
                : <Badge variante="neutral">Con comprobante</Badge>}
            </span>
            <label className="row" style={{ gap: 8 }}>
              <Switch checked={p.activo} etiqueta={`${p.nombre} activa`} onChange={(v) => cambiar(p, { activo: v })} />
              <span className="t-sm t-muted">Activa</span>
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Estrategias utilizadas ---------- */

function Estrategias() {
  const e = useEstado();
  const toast = useToast();
  const lista = [...e.embudos].sort((a, b) => a.orden - b.orden);
  const cambiar = (x: Embudo, cambios: Partial<Embudo>, aviso?: string) => {
    acciones.actualizarSilencioso<Embudo>("embudos", x.id, cambios);
    if (aviso) toast(aviso);
  };
  function agregar() {
    const id = nuevoId("emb");
    acciones.crear<Embudo>("embudos", {
      id, nombre: "Nueva estrategia", activo: true,
      orden: Math.max(-1, ...e.embudos.map((x) => x.orden)) + 1,
    }, "Nueva estrategia");
    window.setTimeout(() => document.getElementById(`cat-${id}`)?.focus(), 60);
  }
  return (
    <Card>
      <CardHead
        titulo="Estrategias utilizadas"
        sub="De dónde salió cada venta. La que es el embudo de webinar suma los números de la planilla de webinars en el Dashboard."
        acciones={<Button variante="secondary" icono={<Plus size={16} />} onClick={agregar}>Agregar estrategia</Button>}
      />
      <div className="catalogo-lista">
        {lista.map((x) => (
          <div className="catalogo-fila catalogo-fila--estrategia" key={x.id} data-inactivo={!x.activo || undefined}>
            <Input
              id={`cat-${x.id}`} aria-label="Nombre de la estrategia" defaultValue={x.nombre}
              onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== x.nombre) cambiar(x, { nombre: v }, "Nombre guardado."); }}
            />
            <label className="row" style={{ gap: 8 }}>
              <Switch checked={Boolean(x.esWebinar)} etiqueta={`${x.nombre} es el embudo de webinar`}
                onChange={(v) => cambiar(x, { esWebinar: v }, v ? `${x.nombre} es ahora el embudo de webinar.` : undefined)} />
              <span className="t-sm t-muted">Embudo de webinar</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <Switch checked={x.activo} etiqueta={`${x.nombre} activa`} onChange={(v) => cambiar(x, { activo: v })} />
              <span className="t-sm t-muted">Activa</span>
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Proyectos ---------- */

function Proyectos() {
  const e = useEstado();
  const toast = useToast();
  const [nuevo, setNuevo] = useState("");
  const items = e.ajustes.proyectos ?? [];

  function agregar() {
    const t = nuevo.trim();
    if (!t) return;
    if (items.includes(t)) { toast("Ese proyecto ya está en la lista.", "err"); return; }
    acciones.ajustes({ proyectos: [...items, t] }, `Se agregó el proyecto «${t}».`);
    setNuevo("");
    toast(`«${t}» agregado.`);
  }
  function quitar(x: string) {
    acciones.ajustes({ proyectos: items.filter((i) => i !== x) }, `Se quitó el proyecto «${x}».`);
    toast(`«${x}» quitado.`);
  }

  return (
    <Card>
      <CardHead titulo="Proyectos" sub="MENT, DOWN, WEB-13/04/26… Un proyecto WEB-día/mes/año queda atado solo al webinar de ese día." />
      <div className="row-wrap" style={{ marginBottom: 14, minHeight: 32 }}>
        {items.length === 0 && <span className="t-sm t-subtle">La lista está vacía. Agregá el primero abajo.</span>}
        {items.map((x) => (
          <span key={x} className="chip" style={{ cursor: "default" }}>
            {x}
            <button
              type="button" aria-label={`Quitar ${x}`} onClick={() => quitar(x)}
              style={{ background: "none", border: 0, cursor: "pointer", display: "grid", placeItems: "center", padding: 0, marginLeft: 2, color: "var(--ink-subtle)" }}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={(ev) => { ev.preventDefault(); agregar(); }} className="row" style={{ gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} placeholder="WEB-27/10/26" aria-label="Agregar un proyecto" />
        </div>
        <Button variante="secondary" type="submit" icono={<Plus size={16} />} disabled={!nuevo.trim()}>Agregar</Button>
      </form>
    </Card>
  );
}

/* ---------- Comisión del referidor ---------- */

function Referidor() {
  const e = useEstado();
  const toast = useToast();
  const actual = e.ajustes.comisionReferidor ?? 0.1;
  return (
    <Card>
      <CardHead titulo="Comisión del referidor" sub="Lo que cobra quien refiere una venta, sobre lo que entra. La del setter se pone en su fila de Equipo." />
      <div className="row" style={{ gap: 8, maxWidth: 220 }}>
        <Input
          aria-label="Comisión del referidor (%)" type="number" min={0} max={100} step={0.5}
          defaultValue={Math.round(actual * 1000) / 10}
          onBlur={(ev) => {
            const v = Number(ev.target.value);
            if (Number.isFinite(v) && v >= 0 && v <= 100 && v / 100 !== actual) {
              acciones.ajustes({ comisionReferidor: v / 100 }, `La comisión del referidor pasó a ${v}%.`);
              toast("Comisión guardada.");
            }
          }}
        />
        <span className="t-muted">%</span>
      </div>
    </Card>
  );
}
