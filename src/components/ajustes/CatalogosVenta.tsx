"use client";

import React, { useState } from "react";
import { Fila as FilaAjuste } from "./Fila";
import { ChevronDown, Landmark, Link2, Plus, Trash2, X } from "lucide-react";
import { Button, Card, CardHead, Field, IconButton, Input, Select, Switch } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { montoDe } from "@/lib/monto";
import { enOtros } from "@/lib/caja";
import { Modal, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { nombrePasarela } from "@/lib/pasarelas";
import { cobrosConOtraTasa } from "@/lib/finanzas";
import { money } from "@/lib/format";
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
      <Proyectos />
      <Referidor />
    </div>
  );
}

/* Lo apagado no se borra (las ventas viejas siguen diciendo qué compraron o por dónde pagaron), así que las listas sólo
   crecen. Antes iban con scroll adentro y cortaban filas a la mitad; ahora se ve lo activo entero y lo apagado, al pedirlo. */
const VerApagadas = (x: { n: number; abierto: boolean; onCambiar: (v: boolean) => void }) => <VerApagados {...x} que="apagadas" />;

function VerApagados({ n, abierto, onCambiar, que }: { n: number; abierto: boolean; onCambiar: (v: boolean) => void; que: string }) {
  if (!n) return null;
  return (
    <button type="button" className="catalogo-apagados" aria-expanded={abierto} onClick={() => onCambiar(!abierto)}>
      <ChevronDown size={14} aria-hidden />
      {abierto ? `Ocultar ${que}` : `Ver ${n === 1 ? `1 ${que.replace(/s$/, "")}` : `${n} ${que}`}`}
    </button>
  );
}

/* ---------- Servicios / Productos ---------- */

function Servicios() {
  const e = useEstado();
  const toast = useToast();
  const [verApagados, setVerApagados] = useState(false);
  const todos = [...e.productos].sort((a, b) => a.orden - b.orden);
  const apagados = todos.filter((p) => !p.activo).length;
  const lista = verApagados ? todos : todos.filter((p) => p.activo);
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
        titulo="Servicios"
        sub="Lo que se vende. El tipo separa las mentorías de los downsells y los eventos en el Dashboard."
        acciones={<Button sm variante="secondary" icono={<Plus size={15} />} onClick={agregar}>Agregar servicio</Button>}
      />
      <div className="catalogo-lista">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--servicio" aria-hidden>
          <span>Nombre</span><span>Precio de lista</span><span>Tipo</span><span>Activo</span>
        </div>
        {lista.map((p) => (
          <div className="catalogo-fila catalogo-fila--servicio" key={p.id} data-inactivo={!p.activo || undefined}>
            <Input
              id={`cat-${p.id}`} aria-label="Nombre del servicio" defaultValue={p.nombre}
              onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== p.nombre) cambiar(p, { nombre: v }, "Nombre guardado."); }}
            />
            <InputMonto
              aria-label={`Precio de lista de ${p.nombre}`} defaultValue={p.precioLista}
              onBlur={(ev) => { const v = montoDe(ev.target.value); if (Number.isFinite(v) && v >= 0 && v !== p.precioLista) cambiar(p, { precioLista: v }, "Precio guardado."); }}
            />
            <Select aria-label={`Tipo de ${p.nombre}`} value={p.tipo} opciones={TIPOS}
              onChange={(ev) => cambiar(p, { tipo: ev.target.value as Producto["tipo"] }, "Tipo guardado.")} />
            <Switch checked={p.activo} etiqueta={`${p.nombre} activo`} onChange={(v) => cambiar(p, { activo: v })} />
          </div>
        ))}
      </div>
      <VerApagados n={apagados} abierto={verApagados} onCambiar={setVerApagados} que="apagados" />
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
  /* La cuenta a la que se le acaba de cambiar la comisión y tiene cobros
     cargados con la tasa vieja: se pregunta si pasan a la nueva. */
  const [recalcular, setRecalcular] = useState<{ id: string; nombre: string; tasa: number; n: number; antes: number; despues: number } | null>(null);
  const [verApagadas, setVerApagadas] = useState(false);
  /* La retención (Hotmart) es rara: se ve sólo en las cuentas que retienen o en la que se abrió. */
  const [abierta, setAbierta] = useState<string | null>(null);
  const apagadas = e.procesadores.filter((p) => !p.activo).length;
  const lista = verApagadas ? e.procesadores : e.procesadores.filter((p) => p.activo);
  const cambiar = (p: Procesador, cambios: Partial<Procesador>, aviso?: string) => {
    acciones.actualizarSilencioso<Procesador>("procesadores", p.id, cambios);
    if (aviso) toast(aviso);
  };
  function cambiarTasa(p: Procesador, tasa: number) {
    const viejos = cobrosConOtraTasa(e, p.id, tasa);
    cambiar(p, { feeRate: tasa }, viejos.length ? undefined : "Comisión guardada.");
    if (viejos.length) {
      setRecalcular({
        id: p.id, nombre: p.nombre, tasa, n: viejos.length,
        antes: viejos.reduce((a, x) => a + x.feeMonto, 0),
        despues: viejos.reduce((a, x) => a + Math.round(x.monto * tasa * 100) / 100, 0),
      });
    }
  }
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
        sub="Por dónde entra la plata y cuánto cobra cada una. Si el cobro se concilia con la pasarela, manda la comisión real; si no, esta."
        acciones={<Button sm variante="secondary" icono={<Plus size={15} />} onClick={agregar}>Agregar cuenta</Button>}
      />
      <div className="catalogo-lista">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--cuenta" aria-hidden>
          <span>Nombre</span><span>Comisión</span><span>Moneda</span><span>Se concilia con</span><span title="Las cuentas a las que transfiere el cliente: salen en el reporte para la Financiera">Bancos</span>
          <span title="Se ofrece al cargar una venta">Activa</span><span title="Va al final del arqueo, plegada, con las que no se usan seguido">Otros</span><span />
        </div>
        {lista.map((p) => {
          const n = p.cuentasBancarias?.length ?? 0;
          const retiene = (p.diasDeRetencion ?? 0) > 0;
          const verRetencion = retiene || abierta === p.id;
          return (
            <div className="catalogo-fila catalogo-fila--cuenta" key={p.id} data-inactivo={!p.activo || undefined}>
              <Input
                id={`cat-${p.id}`} aria-label="Nombre de la cuenta" defaultValue={p.nombre}
                onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== p.nombre) cambiar(p, { nombre: v }, "Nombre guardado."); }}
              />
              <span className="catalogo-pct">
                <Input
                  aria-label={`Comisión de ${p.nombre} (%)`} type="number" min={0} max={100} step={0.1}
                  defaultValue={Math.round(p.feeRate * 10000) / 100}
                  onBlur={(ev) => {
                    const v = Number(ev.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 100 && v / 100 !== p.feeRate) cambiarTasa(p, v / 100);
                  }}
                />
                <span aria-hidden>%</span>
              </span>
              <Select
                aria-label={`Moneda en la que recibe ${p.nombre}`} value={p.moneda ?? "USD"} opciones={MONEDAS}
                onChange={(ev) => cambiar(p, { moneda: ev.target.value as Moneda }, `${p.nombre} recibe ${ev.target.value === "ARS" ? "pesos" : "dólares"}.`)}
              />
              <span className="catalogo-concilia" data-auto={p.proveedor ? true : undefined} title={p.proveedor ? `Los cobros se concilian solos con ${nombrePasarela(p.proveedor)}` : "Se prueba con el comprobante"}>
                {p.proveedor ? <><Link2 size={13} aria-hidden />{nombrePasarela(p.proveedor).replace(/\s*\(.*\)$/, "")}</> : "Comprobante"}
              </span>
              {n ? (
                <Button sm variante="secondary" icono={<Landmark size={15} />} aria-label={`Cuentas bancarias de ${p.nombre}`} title={`Cuentas bancarias de ${p.nombre}`} onClick={() => setBancarias(p.id)}>
                  {n}
                </Button>
              ) : (
                <IconButton etiqueta={`Agregar las cuentas bancarias de ${p.nombre}`} onClick={() => setBancarias(p.id)}><Plus size={15} /></IconButton>
              )}
              <Switch checked={p.activo} etiqueta={`${p.nombre} activa`} onChange={(v) => cambiar(p, { activo: v })} />
              <Switch
                checked={enOtros(p)} etiqueta={`${p.nombre} va en «Otros» del arqueo`}
                onChange={(v) => cambiar(p, { cajaOtros: v }, v ? `${p.nombre} va en «Otros» del arqueo.` : `${p.nombre} va con las cuentas de siempre en el arqueo.`)}
              />
              <IconButton
                etiqueta={verRetencion ? `Ocultar la retención de ${p.nombre}` : `Retención de ${p.nombre}`} aria-expanded={verRetencion}
                className="catalogo-mas" onClick={() => setAbierta(abierta === p.id ? null : p.id)} disabled={retiene}
              >
                <ChevronDown size={15} />
              </IconButton>
              {/* Cuentas que retienen lo cobrado unos días (Hotmart, 28/10): el cobro cuenta en la caja y en las comisiones el día que se acredita. */}
              {verRetencion && <div className="catalogo-retencion">
                <span className="t-sm t-muted">Retiene lo cobrado</span>
                <div style={{ width: 84 }}>
                  <Input
                    aria-label={`Días que ${p.nombre} retiene lo cobrado antes de acreditarlo`} type="number" min={0} max={90} step={1}
                    defaultValue={p.diasDeRetencion ?? 0}
                    onBlur={(ev) => {
                      const v = Math.max(0, Math.min(90, Math.floor(Number(ev.target.value) || 0)));
                      if (v !== (p.diasDeRetencion ?? 0)) cambiar(p, { diasDeRetencion: v }, v ? `${p.nombre} acredita ${v} días después del pago.` : `${p.nombre} acredita al instante.`);
                    }}
                  />
                </div>
                <span className="t-sm t-muted">días, para los pagos desde</span>
                <div style={{ width: 160 }}>
                  <Input
                    aria-label={`Desde qué día de pago ${p.nombre} retiene lo cobrado`} type="date" value={p.retencionDesde ?? ""}
                    onChange={(ev) => cambiar(p, { retencionDesde: (ev.target.value || null) as unknown as string | undefined }, "Fecha guardada.")}
                  />
                </div>
                <span className="t-sm t-subtle">Mientras no se acredita, el cobro no cuenta en la caja ni en las comisiones.</span>
              </div>}
            </div>
          );
        })}
      </div>
      <VerApagadas n={apagadas} abierto={verApagadas} onCambiar={setVerApagadas} />
      {enEdicion && <CuentasBancarias key={enEdicion.id} p={enEdicion} onCerrar={() => setBancarias(null)} />}
      {recalcular && (
        <Modal
          abierto onCerrar={() => setRecalcular(null)}
          titulo={`¿Recalculo los cobros de ${recalcular.nombre}?`}
          pie={
            <>
              <Button variante="ghost" onClick={() => { setRecalcular(null); toast("Comisión guardada: vale para los cobros nuevos."); }}>
                Sólo los cobros nuevos
              </Button>
              <span className="spacer" />
              <Button variante="primary" onClick={() => {
                const n = acciones.aplicarTasaDeCuenta(recalcular.id);
                setRecalcular(null);
                toast(n ? `Comisión guardada y ${n === 1 ? "un cobro recalculado" : `${n} cobros recalculados`}.` : "Comisión guardada.");
              }}>
                Recalcular {recalcular.n === 1 ? "el cobro" : `${recalcular.n} cobros`}
              </Button>
            </>
          }
        >
          <p className="t-body t-muted">
            {recalcular.n === 1 ? "Hay un cobro" : `Hay ${recalcular.n} cobros`} de {recalcular.nombre} cargados con la tasa de la
            cuenta. Con {(recalcular.tasa * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}% su comisión pasa de{" "}
            <strong className="t-num">{money(recalcular.antes, e.ajustes.monedaBase, 2)}</strong> a{" "}
            <strong className="t-num">{money(recalcular.despues, e.ajustes.monedaBase, 2)}</strong>, y con ella el cash post
            pasarelas sobre el que comisiona el equipo. Los conciliados con la pasarela, los corregidos a mano en Finanzas y
            las liquidaciones ya cerradas no cambian.
          </p>
        </Modal>
      )}
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
  const [verApagadas, setVerApagadas] = useState(false);
  const todas = [...e.embudos].sort((a, b) => a.orden - b.orden);
  const apagadas = todas.filter((x) => !x.activo).length;
  const lista = verApagadas ? todas : todas.filter((x) => x.activo);
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
        titulo="Estrategias"
        sub="De dónde salió cada venta. La del embudo de webinar suma los números de los webinars en el Dashboard."
        acciones={<Button sm variante="secondary" icono={<Plus size={15} />} onClick={agregar}>Agregar estrategia</Button>}
      />
      <div className="catalogo-lista">
        <div className="catalogo-fila catalogo-fila--cabeza catalogo-fila--estrategia" aria-hidden>
          <span>Nombre</span><span>Embudo de webinar</span><span>Activa</span>
        </div>
        {lista.map((x) => (
          <div className="catalogo-fila catalogo-fila--estrategia" key={x.id} data-inactivo={!x.activo || undefined}>
            <Input
              id={`cat-${x.id}`} aria-label="Nombre de la estrategia" defaultValue={x.nombre}
              onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== x.nombre) cambiar(x, { nombre: v }, "Nombre guardado."); }}
            />
            <Switch checked={Boolean(x.esWebinar)} etiqueta={`${x.nombre} es el embudo de webinar`}
              onChange={(v) => cambiar(x, { esWebinar: v }, v ? `${x.nombre} es ahora el embudo de webinar.` : undefined)} />
            <Switch checked={x.activo} etiqueta={`${x.nombre} activa`} onChange={(v) => cambiar(x, { activo: v })} />
          </div>
        ))}
      </div>
      <VerApagadas n={apagadas} abierto={verApagadas} onCambiar={setVerApagadas} />
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
      <CardHead titulo={`Proyectos · ${items.length}`} sub="MENT, DOWN, WEB-13/04/26… Un proyecto WEB-día/mes/año queda atado solo al webinar de ese día." />
      <div className="aj-chips">
        {items.map((x) => (
          <span key={x} className="chip aj-chip">
            {x}
            <button type="button" className="aj-chip__quitar" aria-label={`Quitar ${x}`} onClick={() => quitar(x)}><X size={13} /></button>
          </span>
        ))}
        <form onSubmit={(ev) => { ev.preventDefault(); agregar(); }} className="aj-chip-nuevo">
          <Plus size={13} aria-hidden />
          <input value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} placeholder="WEB-27/10/26" aria-label="Agregar un proyecto" />
        </form>
      </div>
    </Card>
  );
}

/* ---------- Comisión del referidor ---------- */

function Referidor() {
  const e = useEstado();
  const toast = useToast();
  const actual = e.ajustes.comisionReferidor ?? 0.1;
  return (
    <Card style={{ padding: 0 }}>
      <FilaAjuste titulo="Comisión del referidor" sub="Sobre lo que entra post pasarelas. La del setter va en Equipo y honorarios.">
        <span className="catalogo-pct catalogo-pct--ancho">
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
          <span aria-hidden>%</span>
        </span>
      </FilaAjuste>
    </Card>
  );
}
