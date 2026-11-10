"use client";

import React, { useMemo, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { hayNube, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { emailValido, generarClave, tipoSugerido, useTiposCuenta, type Acceso, type useAccesos } from "@/lib/acceso";
import { AREAS, extraQueSuma, nivelDeAreas, resumenDeExtra, resumenDeTipo } from "@/lib/permisos";
import type { AreaId, AreasDeTipo, NivelArea, RolEquipo, TipoCuenta } from "@/lib/types";
import { fechaLarga } from "@/lib/format";
import type { EstadoDeClosers as EstadoClosers } from "@/lib/cuenta-closer";
import { EstadoDeClosers } from "@/components/closers/EstadoDeClosers";
import { ClaveGenerada } from "./ClaveGenerada";

/* ==================================================================
   Quién entra a la app y con qué tipo de cuenta. Es la misma lista que
   mira la base (usuarios_permitidos): quien no está, entra al login y no
   ve nada. Qué ve cada tipo se arma en «Tipos de cuenta», y a una persona
   se le puede sumar algo sin cambiarle el tipo («Permisos de más»: Manuel,
   10/11, quiso darle Finanzas a Santiago y cambiarle el tipo le sacaba lo
   de director). También están
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
  /* «Permisos de más» abierto: el correo de quién. */
  const [sumando, setSumando] = useState<string | null>(null);
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
      clave: "extra", titulo: "Permisos de más", orden: (f) => -Object.keys(extraQueSuma(tipos.find((t) => t.id === f.rol), f.areasExtra)).length,
      celda: (f) => {
        if (f.rol === "dueno") return <span className="t-sm t-subtle">Ya ve todo</span>;
        const suma = extraQueSuma(tipos.find((t) => t.id === f.rol), f.areasExtra);
        const hay = Object.keys(suma).length > 0;
        return (
          <span className="row-wrap" style={{ gap: 6 }} onClick={(ev) => ev.stopPropagation()}>
            {(Object.entries(suma) as [AreaId, NivelArea][]).map(([area, n]) => (
              <Badge key={area} variante={n === "editar" ? "success" : "info"}>{n === "editar" ? "Edita" : "Ve"} {AREAS.find((a) => a.id === area)?.nombre ?? area}</Badge>
            ))}
            <button type="button" className="chip" aria-label={`Permisos de más de ${f.nombre || f.email}`} onClick={() => setSumando(f.email)}>
              {hay ? "Cambiar" : <><Plus size={13} aria-hidden /> Sumar</>}
            </button>
          </span>
        );
      },
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
          sub="Quién entra y con qué tipo de cuenta. Para darle algo más a una sola persona, sin cambiarle el tipo, usá «Permisos de más». Lo controla la base, no sólo la pantalla."
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
        {sumando && (() => {
          const f = filas.find((x) => x.email === sumando);
          if (!f) return null;
          return (
            <PermisosDeMas
              quien={f.nombre || f.email} tipo={tipos.find((t) => t.id === f.rol)} inicial={f.areasExtra}
              onCerrar={() => setSumando(null)}
              onGuardar={async (extra) => {
                const error = await accesos.guardarExtra(f.email, extra);
                if (error) { toast(error, "err"); return; }
                setSumando(null);
                const resumen = resumenDeExtra(extra);
                toast(resumen
                  ? `${f.nombre || f.email}: sigue con su tipo y además ${resumen.charAt(0).toLowerCase()}${resumen.slice(1)}. Lo ve cuando recargue la app.`
                  : `${f.nombre || f.email}: queda sólo con lo de su tipo.`);
              }}
            />
          );
        })()}
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

/* Lo que una persona tiene de más sobre su tipo, área por área. Sólo suma: lo que el tipo ya da no se baja desde acá
   (para eso está el tipo). El casillero se pinta con lo que termina pudiendo. */
function PermisosDeMas({ quien, tipo, inicial, onCerrar, onGuardar }: {
  quien: string; tipo: TipoCuenta | undefined; inicial: AreasDeTipo;
  onCerrar: () => void; onGuardar: (extra: AreasDeTipo) => Promise<void>;
}) {
  const [extra, setExtra] = useState<AreasDeTipo>(() => extraQueSuma(tipo, inicial));
  const [guardando, setGuardando] = useState(false);
  const cambio = JSON.stringify(extra) !== JSON.stringify(extraQueSuma(tipo, inicial));
  const TEXTO = ["No ve", "Ve", "Edita"] as const;

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={`Permisos de más de ${quien}`} guardarTexto={guardando ? "Guardando…" : "Guardar"}
      sub={`Sigue siendo «${tipo?.nombre ?? "su tipo"}» y no pierde nada de eso: acá sólo se le suma.`}
      puedeGuardar={cambio && !guardando}
      onGuardar={() => { setGuardando(true); void onGuardar(extra).finally(() => setGuardando(false)); }}
    >
      <table className="planilla permisos-mas" aria-label={`Permisos de más de ${quien}`}>
        <thead>
          <tr><th scope="col">Área</th><th scope="col">Por su tipo</th><th scope="col">Para {quien.split(" ")[0]}</th></tr>
        </thead>
        <tbody>
          {AREAS.map((a) => {
            const base = nivelDeAreas(tipo?.areas, a.id);
            const de = extra[a.id];
            const queda = Math.max(base, de === "editar" ? 2 : de === "ver" ? 1 : 0);
            const clase = queda === 2 ? "editar" : queda === 1 ? "ver" : "no";
            const opciones = [
              { valor: "", texto: `Lo de su tipo (${TEXTO[base].toLowerCase()})` },
              ...(base < 1 ? [{ valor: "ver", texto: "Ve" }] : []),
              ...(base < 2 ? [{ valor: "editar", texto: "Edita" }] : []),
            ];
            return (
              <tr key={a.id}>
                <th scope="row">
                  <span className="stack-1"><span className="t-strong">{a.nombre}</span><span className="t-sm t-subtle">{a.pantallas}</span></span>
                </th>
                <td className="t-sm">{TEXTO[base]}</td>
                <td className={`tipos-tabla__celda tipos-tabla__celda--${clase}`}>
                  {base === 2 ? <span className="t-sm">Ya lo edita</span> : (
                    <Select
                      value={de ?? ""} aria-label={`${quien}: ${a.nombre}`} opciones={opciones}
                      onChange={(ev) => setExtra((x) => {
                        const y = { ...x };
                        if (ev.target.value === "ver" || ev.target.value === "editar") y[a.id] = ev.target.value; else delete y[a.id];
                        return y;
                      })}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tipo?.soloLoSuyo && (
        <p className="t-sm t-subtle" style={{ marginTop: 12 }}>Su tipo ve sólo lo suyo: en ventas, cobros y llamadas eso no cambia.</p>
      )}
    </ModalForm>
  );
}
