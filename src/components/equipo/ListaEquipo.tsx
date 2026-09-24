"use client";

import React, { useMemo, useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { Badge, Button, Card, CardHead, Chip, Empty, Field, Input, Persona, Select } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, hayNube, nuevoId, useEstado } from "@/lib/store";
import { emailValido, type useAccesos } from "@/lib/acceso";
import { resumenEsquema } from "@/lib/honorarios";
import type { MiembroEquipo, RolEquipo } from "@/lib/types";
import { ROLES, textoRol } from "./FichaMiembro";

/* ==================================================================
   El equipo: quién es, qué hace, qué cobra en una línea y si entra a la
   app. Cada fila abre su ficha, donde se cambia todo.
   ================================================================== */

type Accesos = ReturnType<typeof useAccesos>;

interface Fila extends MiembroEquipo { cobra: string; aDefinir: boolean; acceso: "dueno" | "equipo" | null }

export function ListaEquipo({ accesos, onVer }: { accesos: Accesos; onVer: (id: string) => void }) {
  const e = useEstado();
  const toast = useToast();
  const [todos, setTodos] = useState(false);
  const [nueva, setNueva] = useState(false);

  const filas = useMemo<Fila[]>(() => {
    const porEmail = new Map((accesos.lista ?? []).map((a) => [a.email, a.rol] as const));
    return e.equipo
      .filter((m) => todos || m.activo)
      .map((m) => {
        const esq = e.honorarios.find((h) => h.miembroId === m.id);
        return {
          ...m,
          cobra: resumenEsquema(esq),
          aDefinir: Boolean(esq?.pendiente?.trim()),
          acceso: m.email ? porEmail.get(m.email.trim().toLowerCase()) ?? null : null,
        };
      })
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es"));
  }, [e.equipo, e.honorarios, accesos.lista, todos]);

  const inactivos = e.equipo.filter((m) => !m.activo).length;

  const columnas: Columna<Fila>[] = [
    {
      clave: "nombre", titulo: "Persona", orden: (f) => f.nombre,
      celda: (f) => <Persona nombre={f.nombre} sub={f.puesto || "Sin puesto"} />,
    },
    { clave: "rol", titulo: "En ventas", orden: (f) => textoRol(f.rol), celda: (f) => (f.rol === "otro" ? <span className="t-subtle">—</span> : textoRol(f.rol)) },
    {
      clave: "cobra", titulo: "Qué cobra", orden: (f) => f.cobra,
      celda: (f) => (
        <span className="row" style={{ gap: 8 }}>
          <span className={f.cobra === "Sin cargar" ? "t-subtle" : undefined}>{f.cobra}</span>
          {f.aDefinir && <Badge variante="warning">A definir</Badge>}
        </span>
      ),
    },
    {
      clave: "acceso", titulo: "Acceso a la app",
      orden: (f) => (f.acceso === "dueno" ? 0 : f.acceso ? 1 : 2),
      celda: (f) => !hayNube
        ? <span className="t-subtle">—</span>
        : f.acceso === "dueno" ? <Badge variante="brand">Dueño</Badge>
          : f.acceso ? <Badge variante="success">Tiene acceso</Badge>
            : <span className="t-subtle">{f.email ? "Sin acceso" : "Sin correo"}</span>,
    },
    {
      clave: "activo", titulo: "", celda: (f) => (f.activo ? null : <Badge variante="neutral">Ya no está</Badge>),
    },
  ];

  return (
    <Card>
      <CardHead
        titulo="El equipo y lo que cobra"
        sub="Tocá a alguien para cargar su sueldo, sus variables y sobre qué se miden, o para darle acceso a la app."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setNueva(true)}>Agregar persona</Button>}
      />
      {/* La lista sólo crece (los que se van quedan apagados): scroll propio, como las demás. */}
      <DataTable
        filas={filas} columnas={columnas} onFila={(f) => onVer(f.id)} etiquetaFila={(f) => `Abrir a ${f.nombre}`} alto={560}
        vacio={<Empty icono={<UserRound size={22} />} titulo="Todavía no hay nadie" texto="Agregá a las personas del equipo para cargar lo que cobra cada una." />}
      />
      {inactivos > 0 && (
        <div className="row" style={{ marginTop: "var(--space-3)" }}>
          <Chip activo={todos} onClick={() => setTodos((v) => !v)} count={inactivos}>
            {todos ? "Ocultar los que ya no están" : "Ver también los que ya no están"}
          </Chip>
        </div>
      )}
      {nueva && (
        <NuevaPersona
          onCerrar={() => setNueva(false)}
          onCrear={(m) => {
            acciones.guardarMiembro(m);
            setNueva(false);
            toast(`${m.nombre} está en el equipo. Ahora cargá lo que cobra.`);
            onVer(m.id);
          }}
          emailsUsados={new Set(e.equipo.map((x) => x.email?.trim().toLowerCase()).filter(Boolean) as string[])}
        />
      )}
    </Card>
  );
}

function NuevaPersona({ onCerrar, onCrear, emailsUsados }: {
  onCerrar: () => void; onCrear: (m: MiembroEquipo) => void; emailsUsados: Set<string>;
}) {
  const [nombre, setNombre] = useState("");
  const [puesto, setPuesto] = useState("");
  const [rol, setRol] = useState<RolEquipo>("otro");
  const [email, setEmail] = useState("");
  const correo = email.trim().toLowerCase();
  const error = correo && !emailValido(correo) ? "Ese correo no parece válido."
    : correo && emailsUsados.has(correo) ? "Ese correo ya es de otra persona del equipo." : undefined;
  const listo = nombre.trim().length >= 2 && !error;

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo="Agregar persona" guardarTexto="Agregar" puedeGuardar={listo}
      sub="Después, en su ficha, se carga lo que cobra y se le da acceso a la app."
      onGuardar={() => onCrear({
        id: nuevoId("eq"), nombre: nombre.trim(), puesto: puesto.trim() || undefined, rol,
        comisionRate: 0, activo: true, sinComision: false, desde: new Date().toISOString(),
        ...(correo ? { email: correo } : {}),
      })}
    >
      <div className="form-grid">
        <Field label="Nombre y apellido">
          <Input value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Manuel Pérez" autoFocus />
        </Field>
        <Field label="Puesto">
          <Input value={puesto} onChange={(ev) => setPuesto(ev.target.value)} placeholder="COO, Editor, Closer" />
        </Field>
        <Field label="Rol en las ventas" ayuda="Si vende, aparece en la lista al cargar una venta.">
          <Select value={rol} opciones={ROLES} onChange={(ev) => setRol(ev.target.value as RolEquipo)} />
        </Field>
        <Field label="Correo (opcional)" error={error} ayuda={error ? undefined : "El que va a usar para entrar a la app."}>
          <Input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="nombre@apicanta.com" error={Boolean(error)} />
        </Field>
      </div>
    </ModalForm>
  );
}
