"use client";

import React, { useState } from "react";
import { Landmark, Link2, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardHead, Field, IconButton, Input, Select, Switch } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { nombrePasarela } from "@/lib/pasarelas";
import { bancoDeCbu, limpiarCbu, validarCbu } from "@/lib/cbu";
import type { CuentaBancaria, Embudo, Moneda, Procesador, Producto } from "@/lib/types";

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
      {/* Nada se borra (lo viejo se apaga), así que estas listas sólo crecen:
          con scroll adentro y los títulos de las columnas pegados arriba. */}
      <div className="catalogo-lista lista-scroll">
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

const MONEDAS: { valor: Moneda; texto: string }[] = [
  { valor: "USD", texto: "USD" },
  { valor: "ARS", texto: "ARS" },
];

function Cuentas() {
  const e = useEstado();
  const toast = useToast();
  /* La cuenta a la que se le están editando las cuentas bancarias. */
  const [bancarias, setBancarias] = useState<string | null>(null);
  const enEdicion = bancarias ? e.procesadores.find((p) => p.id === bancarias) : undefined;
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
        sub="Por dónde entra la plata. La comisión es la que cobra cada una: si el cobro se concilia con la pasarela manda el fee real; si no, se usa esta y se puede corregir a mano en Finanzas. Las que reciben pesos piden el tipo de cambio del cobro, y sus cuentas bancarias salen en el reporte para la Financiera."
        acciones={<Button variante="secondary" icono={<Plus size={16} />} onClick={agregar}>Agregar cuenta</Button>}
      />
      {/* Con scroll, como los servicios: las cuentas apagadas quedan. */}
      <div className="catalogo-lista lista-scroll">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--cuenta" aria-hidden>
          <span>Nombre</span><span>Comisión (%)</span><span>Moneda</span><span>Cómo se prueba</span><span>Cuentas bancarias</span><span />
        </div>
        {e.procesadores.map((p) => {
          const n = p.cuentasBancarias?.length ?? 0;
          return (
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
              <Select
                aria-label={`Moneda en la que recibe ${p.nombre}`} value={p.moneda ?? "USD"} opciones={MONEDAS}
                onChange={(ev) => cambiar(p, { moneda: ev.target.value as Moneda }, `${p.nombre} recibe ${ev.target.value === "ARS" ? "pesos" : "dólares"}.`)}
              />
              <span>
                {p.proveedor
                  ? <Badge variante="success"><Link2 size={13} />Se concilia con {nombrePasarela(p.proveedor)}</Badge>
                  : <Badge variante="neutral">Con comprobante</Badge>}
              </span>
              <Button
                sm variante={n ? "secondary" : "ghost"} icono={<Landmark size={15} />}
                aria-label={`Cuentas bancarias de ${p.nombre}`} title={`Cuentas bancarias de ${p.nombre}`}
                onClick={() => setBancarias(p.id)}
              >
                {n ? `${n} ${n === 1 ? "cuenta" : "cuentas"}` : "Agregar"}
              </Button>
              <label className="row" style={{ gap: 8 }}>
                <Switch checked={p.activo} etiqueta={`${p.nombre} activa`} onChange={(v) => cambiar(p, { activo: v })} />
                <span className="t-sm t-muted">Activa</span>
              </label>
            </div>
          );
        })}
      </div>
      {enEdicion && <CuentasBancarias key={enEdicion.id} p={enEdicion} onCerrar={() => setBancarias(null)} />}
    </Card>
  );
}

/* ---------- Cuentas bancarias de una cuenta recaudadora ----------
   Las cuentas a las que transfiere el cliente (las de la Financiera):
   son la tabla de la derecha del reporte. Se editan en borrador y se
   guardan juntas; una fila que quedó vacía se descarta. */

const CUENTA_VACIA: CuentaBancaria = { titular: "", banco: "", numero: "", alias: "", cbu: "", cuit: "" };
const vacia = (c: CuentaBancaria) => !Object.values(c).some((v) => v.trim());
/* Lo guardado viene de un jsonb: un campo puede faltar o venir en null. */
const aBorrador = (c: Partial<CuentaBancaria>): CuentaBancaria => ({
  titular: c.titular ?? "", banco: c.banco ?? "", numero: c.numero ?? "", alias: c.alias ?? "", cbu: c.cbu ?? "", cuit: c.cuit ?? "",
});

/* Lo que se dice abajo del CBU mientras se escribe: el banco en cuanto
   se reconoce, cuántos números van y, completo, si está bien. */
function estadoCbu(texto: string, mostrarFaltante: boolean): { error?: string; ayuda?: string } {
  const d = limpiarCbu(texto);
  if (!d) return { ayuda: "22 números: el banco sale solo." };
  const banco = bancoDeCbu(d);
  if (!/^\d+$/.test(d) || d.length > 22) return { error: "Un CBU/CVU son 22 números, sin letras." };
  if (d.length < 22) {
    const cuenta = `${d.length} de 22 números`;
    return mostrarFaltante ? { error: `Está incompleto: ${cuenta}.` } : { ayuda: banco ? `${banco} · ${cuenta}` : cuenta };
  }
  if (!validarCbu(d)) return { error: "No es un CBU/CVU válido: revisá los números." };
  return { ayuda: banco ? `Es de ${banco}.` : "Es válido. El banco no se reconoce: escribilo." };
}

function CuentasBancarias({ p, onCerrar }: { p: Procesador; onCerrar: () => void }) {
  const toast = useToast();
  const [lista, setLista] = useState<CuentaBancaria[]>(() =>
    p.cuentasBancarias?.length ? p.cuentasBancarias.map(aBorrador) : [{ ...CUENTA_VACIA }]);
  /* Los errores de lo incompleto aparecen recién al querer guardar. */
  const [intento, setIntento] = useState(false);

  const cambiar = (i: number, campo: keyof CuentaBancaria, valor: string) =>
    setLista((xs) => xs.map((c, k) => (k === i ? { ...c, [campo]: valor } : c)));

  const problemas = lista.map((c) => (vacia(c) ? {} : {
    titular: c.titular.trim() ? undefined : "Falta el nombre del titular.",
    cbu: estadoCbu(c.cbu, true).error,
  }));

  function guardar() {
    setIntento(true);
    if (problemas.some((x) => x.titular || x.cbu)) return;
    const limpias = lista.filter((c) => !vacia(c)).map((c) => ({
      titular: c.titular.trim(),
      banco: c.banco.trim() || bancoDeCbu(c.cbu),
      numero: c.numero.trim(),
      alias: c.alias.trim(),
      cbu: limpiarCbu(c.cbu),
      cuit: c.cuit.trim(),
    }));
    acciones.actualizarSilencioso<Procesador>("procesadores", p.id, { cuentasBancarias: limpias });
    toast(limpias.length ? `Cuentas bancarias de ${p.nombre} guardadas.` : `${p.nombre} quedó sin cuentas bancarias.`);
    onCerrar();
  }

  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={guardar}
      titulo={`Cuentas bancarias de ${p.nombre}`}
      sub="Las cuentas a las que transfiere el cliente. Salen en la tabla de la derecha del reporte para la Financiera."
    >
      <div className="cuentas-bancarias">
        {lista.map((c, i) => {
          const cbu = estadoCbu(c.cbu, intento);
          return (
            <div className="cuenta-bancaria" key={i}>
              <div className="cuenta-bancaria__cabeza">
                <span className="hk-label">Cuenta {i + 1}</span>
                <IconButton etiqueta={`Sacar la cuenta ${i + 1}`} onClick={() => setLista((xs) => xs.filter((_, k) => k !== i))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <div className="cuenta-bancaria__campos">
                <Field label="Titular" error={intento ? problemas[i].titular : undefined}>
                  <Input value={c.titular} onChange={(ev) => cambiar(i, "titular", ev.target.value)} placeholder="Nombre o razón social" />
                </Field>
                <Field label="CUIT">
                  <Input value={c.cuit} onChange={(ev) => cambiar(i, "cuit", ev.target.value)} placeholder="30-12345678-9" inputMode="numeric" />
                </Field>
                <Field label="CBU/CVU" error={cbu.error} ayuda={cbu.ayuda}>
                  <Input
                    value={c.cbu} onChange={(ev) => cambiar(i, "cbu", ev.target.value)} error={Boolean(cbu.error)}
                    placeholder="0000000000000000000000" inputMode="numeric" className="cuenta-bancaria__cbu"
                  />
                </Field>
                <Field label="Banco" ayuda={c.banco.trim() || !bancoDeCbu(c.cbu) ? undefined : "Si lo dejás vacío va el del CBU."}>
                  <Input value={c.banco} onChange={(ev) => cambiar(i, "banco", ev.target.value)} placeholder={bancoDeCbu(c.cbu) || "Banco"} />
                </Field>
                <Field label="Alias">
                  <Input value={c.alias} onChange={(ev) => cambiar(i, "alias", ev.target.value)} placeholder="nombre.alias.banco" />
                </Field>
                <Field label="N° de cuenta">
                  <Input value={c.numero} onChange={(ev) => cambiar(i, "numero", ev.target.value)} placeholder="Como figura en el banco" />
                </Field>
              </div>
            </div>
          );
        })}
        {lista.length === 0 && <p className="t-sm t-subtle">Sin cuentas bancarias: en el reporte, la tabla de la derecha sale sólo con los títulos.</p>}
        <div>
          <Button variante="secondary" icono={<Plus size={16} />} onClick={() => setLista((xs) => [...xs, { ...CUENTA_VACIA }])}>
            Agregar cuenta bancaria
          </Button>
        </div>
      </div>
    </ModalForm>
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
      {/* Con scroll, como los servicios: las estrategias apagadas quedan. */}
      <div className="catalogo-lista lista-scroll">
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
      {/* Uno por webinar, y la importación suma los de la planilla: con scroll. */}
      <div className="row-wrap lista-scroll" style={{ marginBottom: 14, minHeight: 32 }}>
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
      <CardHead titulo="Comisión del referidor" sub="Lo que cobra quien refiere una venta, sobre lo que entra post pasarelas. La del setter se pone en Equipo y honorarios." />
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
