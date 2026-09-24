"use client";

import React, { useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Input, Select, Switch } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import type { MiembroEquipo, RolEquipo } from "@/lib/types";

/* ==================================================================
   El equipo: quién es closer, director, setter, growth o socio, cuánto
   comisiona y con qué email entra a la app.

   El email es lo que hace que la app sepa quién está usándola: el closer
   que carga una venta aparece elegido solo, y a Yari (CEO) sólo le
   aparece Yari como closer. Sin email, la app no lo reconoce y muestra a
   todos.
   ================================================================== */

const ROLES: { valor: RolEquipo; texto: string }[] = [
  { valor: "closer", texto: "Closer" },
  { valor: "director", texto: "Director comercial" },
  { valor: "setter", texto: "Setter" },
  { valor: "growth", texto: "Growth partner" },
  { valor: "socio", texto: "Socio" },
  { valor: "ceo", texto: "CEO" },
];

const emailValido = (s: string) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function Equipo() {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const [nuevo, setNuevo] = useState(false);

  function cambiar(m: MiembroEquipo, cambios: Partial<MiembroEquipo>, aviso?: string) {
    acciones.actualizarSilencioso<MiembroEquipo>("equipo", m.id, cambios);
    if (aviso) toast(aviso);
  }

  function agregar() {
    const id = nuevoId("eq");
    acciones.crear<MiembroEquipo>("equipo", {
      id, nombre: "Nueva persona", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false,
      desde: new Date().toISOString(),
    }, "Nueva persona");
    setNuevo(true);
    window.setTimeout(() => document.getElementById(`eq-nombre-${id}`)?.focus(), 60);
  }

  const ordenados = [...e.equipo].sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre));

  return (
    <Card>
      <CardHead
        titulo="Equipo"
        sub="Con el email con el que cada uno entra, la app sabe quién es: al cargar una venta aparece como closer solo."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={agregar}>Agregar persona</Button>}
      />
      {yo.email && !e.equipo.some((m) => m.email?.trim().toLowerCase() === yo.email!.toLowerCase()) && (
        <div className="help-card" style={{ marginBottom: "var(--space-4)" }}>
          <UserRound size={18} />
          <div>
            <div className="help-card__title">Todavía no te reconoce</div>
            <div className="help-card__text">
              Entraste como <strong>{yo.email}</strong>. Ponelo en tu fila y la app te va a elegir sola como closer.
            </div>
          </div>
        </div>
      )}
      {ordenados.length === 0 ? (
        <Empty icono={<UserRound size={22} />} titulo="Todavía no hay nadie" texto="Agregá a las personas del equipo para asignar ventas y calcular comisiones." />
      ) : (
        /* Los que se van quedan apagados al final: la lista sólo crece, con scroll. */
        <div className="equipo-lista lista-scroll">
          {ordenados.map((m) => {
            const soyYo = Boolean(yo.email && m.email?.trim().toLowerCase() === yo.email.toLowerCase());
            return (
              <div className="equipo-fila" key={m.id} data-inactivo={!m.activo || undefined}>
                <div className="equipo-fila__nombre">
                  <Input
                    id={`eq-nombre-${m.id}`} aria-label="Nombre" defaultValue={m.nombre}
                    onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== m.nombre) cambiar(m, { nombre: v }, "Nombre guardado."); }}
                  />
                  {soyYo && <Badge variante="brand">Vos</Badge>}
                </div>
                <Select aria-label="Rol" value={m.rol} onChange={(ev) => cambiar(m, { rol: ev.target.value as RolEquipo })} opciones={ROLES} />
                <Input
                  aria-label="Comisión (%)" type="number" min={0} max={100} step={0.5}
                  defaultValue={Math.round(m.comisionRate * 1000) / 10}
                  onBlur={(ev) => {
                    const v = Number(ev.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 100 && v / 100 !== m.comisionRate) cambiar(m, { comisionRate: v / 100 }, "Comisión guardada.");
                  }}
                />
                <Input
                  aria-label="Email con el que entra" type="email" placeholder="Email con el que entra"
                  defaultValue={m.email ?? ""}
                  onBlur={(ev) => {
                    const v = ev.target.value.trim().toLowerCase();
                    if (!emailValido(v)) { toast("Ese email no parece válido.", "err"); return; }
                    if (v === (m.email ?? "")) return;
                    const repetido = e.equipo.find((x) => x.id !== m.id && x.email?.trim().toLowerCase() === v);
                    if (v && repetido) { toast(`Ese email ya es de ${repetido.nombre}.`, "err"); return; }
                    /* Vacío y no undefined: undefined no viaja en el JSON y la base
                       se quedaría con el email viejo. */
                    cambiar(m, { email: v }, v ? "Email guardado." : "Email borrado.");
                  }}
                />
                <div className="equipo-fila__switches">
                  <label className="row" style={{ gap: 8 }}>
                    <Switch checked={m.activo} etiqueta={`${m.nombre} activo`} onChange={(v) => cambiar(m, { activo: v })} />
                    <span className="t-sm t-muted">Activo</span>
                  </label>
                  <label className="row" style={{ gap: 8 }} title="Si cierra una venta, no comisiona nadie (se usa para Yari)">
                    <Switch checked={m.sinComision} etiqueta={`Con ${m.nombre} no comisiona nadie`} onChange={(v) => cambiar(m, { sinComision: v })} />
                    <span className="t-sm t-muted">Sin comisión</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {nuevo && <p className="t-sm t-subtle" style={{ marginTop: "var(--space-3)" }}>Los cambios se guardan al salir de cada campo.</p>}
    </Card>
  );
}
