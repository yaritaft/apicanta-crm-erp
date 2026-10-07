"use client";

import React, { useMemo, useState } from "react";
import { KeyRound, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { hayNube, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { emailValido, generarClave, tipoSugerido, useTiposCuenta, type Acceso, type useAccesos } from "@/lib/acceso";
import { resumenDeTipo } from "@/lib/permisos";
import type { RolEquipo, TipoCuenta } from "@/lib/types";
import { fechaLarga } from "@/lib/format";
import type { EstadoDeClosers as EstadoClosers } from "@/lib/cuenta-closer";
import { EstadoDeClosers } from "@/components/closers/EstadoDeClosers";
import { ClaveGenerada } from "./ClaveGenerada";

/* ==================================================================
   Quién entra a la app y con qué tipo de cuenta. Es la misma lista que
   mira la base (usuarios_permitidos): quien no está, entra al login y no
   ve nada. Qué ve cada tipo se arma en «Tipos de cuenta». También están
   los que no son del equipo que cobra (el correo de Apicanta, el de
   pruebas). Arriba, closer por closer, si va a ver sus llamadas (su correo
   en Equipo y su nombre en Calendly tienen que coincidir): si no, entra y
   no ve nada.
   ================================================================== */

type Accesos = ReturnType<typeof useAccesos>;

interface Fila extends Acceso { id: string; miembro?: string }

export function AccesosApp({ accesos, closers, onVerMiembro }: {
  accesos: Accesos; closers: EstadoClosers; onVerMiembro: (id: string) => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const tipos = useTiposCuenta();
  const orden = useMemo(() => new Map(tipos.map((t, i) => [t.id, i] as const)), [tipos]);
  /* «Dar acceso» abierto, con lo que ya se sabe de quien lo recibe. */
  const [nuevo, setNuevo] = useState<{ email: string; nombre: string; rol: string } | null>(null);
  const [clave, setClave] = useState<{ nombre: string; email: string; clave: string } | null>(null);
  const [quitando, setQuitando] = useState<Acceso | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const filas = useMemo<Fila[]>(() => (accesos.lista ?? []).map((a) => ({
    ...a, id: a.email,
    miembro: e.equipo.find((m) => m.email?.trim().toLowerCase() === a.email)?.id,
  })).sort((a, b) => (orden.get(a.rol) ?? 99) - (orden.get(b.rol) ?? 99) || a.email.localeCompare(b.email)), [accesos.lista, e.equipo, orden]);

  if (!hayNube) {
    return (
      <div className="stack-5">
        <EstadoDeClosers resumen={closers} onVerMiembro={onVerMiembro} onDarAcceso={() => {}} />
        <Card>
          <Empty icono={<ShieldCheck size={22} />} titulo="Sin base, sin login" texto="La app corre en este navegador y no pide usuario: no hay accesos que dar." />
        </Card>
      </div>
    );
  }

  const soyYo = (email: string) => Boolean(yo.email && yo.email.toLowerCase() === email);

  const claveNueva = async (a: { email: string; nombre: string; rol: string }) => {
    setTrabajando(a.email);
    const r = await generarClave(a);
    setTrabajando(null);
    if (r.error || !r.clave) { toast(r.error ?? "No se pudo generar la clave.", "err"); return false; }
    await accesos.recargar();
    setClave({ nombre: a.nombre, email: a.email, clave: r.clave });
    return true;
  };

  const columnas: Columna<Fila>[] = [
    {
      clave: "nombre", titulo: "Quién", orden: (f) => f.nombre || f.email,
      celda: (f) => (
        <span className="stack-1">
          <span className="t-strong" style={{ color: "var(--ink)" }}>{f.nombre || "Sin nombre"}{soyYo(f.email) ? " (vos)" : ""}</span>
          <span className="t-sm t-subtle">{f.email}</span>
        </span>
      ),
    },
    {
      clave: "rol", titulo: "Tipo de cuenta", orden: (f) => orden.get(f.rol) ?? 99,
      celda: (f) => (
        <span onClick={(ev) => ev.stopPropagation()} style={{ display: "inline-block", minWidth: 190 }}>
          <Select
            value={f.rol} disabled={soyYo(f.email)} aria-label={`Tipo de cuenta de ${f.email}`}
            opciones={opcionesDeTipo(tipos, f.rol)}
            onChange={async (ev) => {
              const error = await accesos.guardar({ email: f.email, nombre: f.nombre, rol: ev.target.value });
              toast(error ?? "Guardado: el cambio se ve la próxima vez que entre.", error ? "err" : "ok");
            }}
          />
        </span>
      ),
    },
    {
      clave: "miembro", titulo: "En el equipo", orden: (f) => (f.miembro ? 0 : 1),
      celda: (f) => (f.miembro
        ? <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); onVerMiembro(f.miembro!); }}>{e.equipo.find((m) => m.id === f.miembro)?.nombre}</button>
        : <span className="t-subtle">—</span>),
    },
    { clave: "desde", titulo: "Desde", tipo: "secondary", orden: (f) => f.creadoEn, celda: (f) => fechaLarga(f.creadoEn) },
  ];

  return (
    <div className="stack-5">
    <EstadoDeClosers resumen={closers} onVerMiembro={onVerMiembro} onDarAcceso={setNuevo} />
    <Card>
      <CardHead
        titulo="Accesos a la app"
        sub="Quién entra y con qué tipo de cuenta. Qué ve y edita cada tipo se arma en «Tipos de cuenta»; lo controla la base, no sólo la pantalla."
        acciones={<Button variante="primary" icono={<UserPlus size={16} />} onClick={() => setNuevo({ email: "", nombre: "", rol: "equipo" })}>Dar acceso</Button>}
      />
      {accesos.error && <p className="t-sm" style={{ color: "var(--danger)", marginBottom: 12 }}>{accesos.error}</p>}
      {accesos.lista === null ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : (
        <DataTable
          filas={filas} columnas={columnas} alto={560}
          vacio={<Empty icono={<ShieldCheck size={22} />} titulo="Nadie tiene acceso" texto="Dale acceso a alguien del equipo." />}
          acciones={(f) => (
            <>
              <IconButton etiqueta={`Clave nueva para ${f.email}`} disabled={trabajando === f.email} onClick={() => void claveNueva({ email: f.email, nombre: f.nombre, rol: f.rol })}>
                <KeyRound size={16} />
              </IconButton>
              {!soyYo(f.email) && (
                <IconButton etiqueta={`Quitar el acceso de ${f.email}`} onClick={() => setQuitando(f)}><UserX size={16} /></IconButton>
              )}
            </>
          )}
        />
      )}

      {nuevo && (
        <DarAcceso
          tipos={tipos} inicial={nuevo}
          onCerrar={() => setNuevo(null)}
          sugerencias={e.equipo.filter((m) => m.activo && m.email && !(accesos.lista ?? []).some((a) => a.email === m.email!.trim().toLowerCase()))}
          onDar={async (a, conClave) => {
            if (conClave) {
              if (await claveNueva(a)) setNuevo(null);
              return;
            }
            const error = await accesos.guardar(a);
            if (error) { toast(error, "err"); return; }
            setNuevo(null);
            toast(`${a.nombre || a.email} ya puede entrar con «Prefiero un enlace por correo».`);
          }}
        />
      )}
      {clave && <ClaveGenerada {...clave} onCerrar={() => setClave(null)} />}
      <Confirmar
        abierto={Boolean(quitando)} onCerrar={() => setQuitando(null)} confirmarTexto="Quitar el acceso"
        titulo={`Quitar el acceso de ${quitando?.nombre || quitando?.email || ""}`}
        texto="Deja de ver los datos de la app apenas cargue de nuevo. Se le puede volver a dar cuando quieras."
        onConfirmar={async () => {
          if (!quitando) return;
          const error = await accesos.quitar(quitando.email);
          toast(error ?? "Acceso quitado.", error ? "err" : "ok");
        }}
      />
    </Card>
    </div>
  );
}

/* Las opciones del tipo: los que hay, y el que tiene si ya no existe. */
function opcionesDeTipo(tipos: TipoCuenta[], actual?: string) {
  const xs = tipos.map((t) => ({ valor: t.id, texto: t.nombre }));
  return actual && !tipos.some((t) => t.id === actual) ? [...xs, { valor: actual, texto: actual }] : xs;
}

function DarAcceso({ tipos, inicial, sugerencias, onCerrar, onDar }: {
  tipos: TipoCuenta[];
  /* Lo que ya se sabe de quien lo recibe (desde «¿van a ver sus llamadas?»). */
  inicial: { email: string; nombre: string; rol: string };
  sugerencias: { id: string; nombre: string; email?: string; rol?: RolEquipo }[];
  onCerrar: () => void;
  onDar: (a: { email: string; nombre: string; rol: string }, conClave: boolean) => void;
}) {
  const [email, setEmail] = useState(inicial.email);
  const [nombre, setNombre] = useState(inicial.nombre);
  const [rol, setRol] = useState<string>(inicial.rol);
  const tipo = tipos.find((t) => t.id === rol);
  const [conClave, setConClave] = useState(true);
  const correo = email.trim().toLowerCase();
  const error = correo && !emailValido(correo) ? "Ese correo no parece válido." : undefined;

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo="Dar acceso" guardarTexto={conClave ? "Dar acceso y generar clave" : "Dar acceso"}
      puedeGuardar={Boolean(correo) && !error}
      sub="Entra con su correo. Con clave, se la mandás vos; sin clave, entra con un enlace que le llega al correo."
      onGuardar={() => onDar({ email: correo, nombre: nombre.trim(), rol }, conClave)}
    >
      {sugerencias.length > 0 && (
        <div className="stack-2" style={{ marginBottom: "var(--space-3)" }}>
          <span className="t-label">Del equipo, sin acceso</span>
          <div className="row-wrap">
            {sugerencias.map((m) => (
              <button key={m.id} type="button" className="chip" aria-pressed={correo === m.email} onClick={() => { setEmail(m.email ?? ""); setNombre(m.nombre); setRol(tipoSugerido(m.rol)); }}>
                {m.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="form-grid">
        <Field label="Correo" error={error}>
          <Input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="nombre@apicanta.com" autoFocus error={Boolean(error)} />
        </Field>
        <Field label="Nombre">
          <Input value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Manuel Pérez" />
        </Field>
        <Field label="Tipo de cuenta" ayuda={tipo ? `${tipo.descripcion || resumenDeTipo(tipo)}` : undefined}>
          <Select value={rol} opciones={opcionesDeTipo(tipos)} onChange={(ev) => setRol(ev.target.value)} />
        </Field>
        <Field label="Cómo entra">
          <Select
            value={conClave ? "clave" : "enlace"}
            opciones={[{ valor: "clave", texto: "Con correo y clave" }, { valor: "enlace", texto: "Con un enlace por correo" }]}
            onChange={(ev) => setConClave(ev.target.value === "clave")}
          />
        </Field>
      </div>
      {rol === "dueno" && (
        <p className="t-sm" style={{ color: "var(--warning)", marginTop: 12 }}>
          Un dueño ve lo que cobra cada uno y puede dar y quitar accesos, incluido el tuyo.
        </p>
      )}
    </ModalForm>
  );
}
