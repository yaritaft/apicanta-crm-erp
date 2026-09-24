"use client";

import React, { useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserX } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Badge, Button, Empty, Field, IconButton, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, hayNube, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { emailValido, generarClave, NIVELES, type NivelAcceso, type useAccesos } from "@/lib/acceso";
import { categoriasDisponibles, infoGrupo } from "@/lib/gastos";
import {
  TIPOS_CONCEPTO, categoriaPorDefecto, describirConcepto, idEsquema, nombrePeriodo, plata,
} from "@/lib/honorarios";
import type { ConceptoPago, EsquemaPago, MiembroEquipo, RolEquipo } from "@/lib/types";
import { AsistenteConcepto } from "./AsistenteConcepto";
import { ClaveGenerada } from "./ClaveGenerada";

/* ==================================================================
   La ficha de alguien del equipo: quién es, qué cobra y con qué entra a
   la app. Los datos se guardan al salir de cada campo, como en Ajustes;
   lo que cobra, con el asistente de cada concepto.
   ================================================================== */

export const ROLES: { valor: RolEquipo; texto: string }[] = [
  { valor: "otro", texto: "No vende" },
  { valor: "closer", texto: "Closer" },
  { valor: "setter", texto: "Setter" },
  { valor: "director", texto: "Director comercial" },
  { valor: "growth", texto: "Growth partner" },
  { valor: "socio", texto: "Socio" },
  { valor: "ceo", texto: "CEO" },
];

export const textoRol = (r: RolEquipo) => ROLES.find((x) => x.valor === r)?.texto ?? r;

type Accesos = ReturnType<typeof useAccesos>;

export function FichaMiembro({ miembroId, accesos, onCerrar }: {
  miembroId: string; accesos: Accesos; onCerrar: () => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const m = e.equipo.find((x) => x.id === miembroId);
  const esq = e.honorarios.find((h) => h.miembroId === miembroId);

  const [editando, setEditando] = useState<ConceptoPago | "nuevo" | null>(null);
  const [borrando, setBorrando] = useState<ConceptoPago | null>(null);

  const categorias = useMemo(
    () => categoriasDisponibles(e).filter((c) => c.grupo !== "dueno" || c.categoria === esq?.categoriaGasto),
    [e, esq?.categoriaGasto],
  );

  if (!m) {
    return (
      <Drawer abierto onCerrar={onCerrar} titulo="No está en el equipo">
        <Empty icono={<UserX size={22} />} titulo="No encontré a esta persona" texto="Puede que la hayan borrado. Volvé a la lista del equipo." />
      </Drawer>
    );
  }

  const esquema: EsquemaPago = esq ?? {
    id: idEsquema(m.id), miembroId: m.id, conceptos: [], categoriaGasto: categoriaPorDefecto(m), actualizadoEn: "",
  };
  const guardarEsquema = (cambios: Partial<EsquemaPago>, aviso?: string) => {
    acciones.guardarEsquema({ ...esquema, ...cambios }, yo.nombre);
    if (aviso) toast(aviso);
  };
  const cambiar = (cambios: Partial<MiembroEquipo>, aviso?: string) => {
    acciones.guardarMiembro({ ...m, ...cambios });
    if (aviso) toast(aviso);
  };

  const historial = e.liquidaciones
    .filter((l) => l.estado === "cerrada" && l.resultado)
    .map((l) => ({ l, p: l.resultado!.personas.find((x) => x.miembroId === m.id) }))
    .filter((x): x is { l: typeof x.l; p: NonNullable<typeof x.p> } => Boolean(x.p))
    .sort((a, b) => b.l.periodo.localeCompare(a.l.periodo))
    .slice(0, 6);

  return (
    <Drawer abierto onCerrar={onCerrar} titulo={m.nombre} sub={[m.puesto, textoRol(m.rol), m.activo ? "" : "ya no está"].filter(Boolean).join(" · ")}>
      <div className="stack-6">
        {/* ---------- Quién es ---------- */}
        <section className="stack-3">
          <h3 className="t-label">Quién es</h3>
          <div className="form-grid">
            <Field label="Nombre">
              <Input
                key={`n-${m.nombre}`} defaultValue={m.nombre} aria-label="Nombre"
                onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== m.nombre) cambiar({ nombre: v }, "Nombre guardado."); }}
              />
            </Field>
            <Field label="Puesto" ayuda="Como se dice en el equipo: COO, Trafficker, Editor.">
              <Input
                key={`p-${m.puesto ?? ""}`} defaultValue={m.puesto ?? ""} aria-label="Puesto" placeholder="COO"
                onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== (m.puesto ?? "")) cambiar({ puesto: v }, "Puesto guardado."); }}
              />
            </Field>
            <Field label="Rol en las ventas" ayuda="Dice en qué lista aparece al cargar una venta: vendedor, setter o director.">
              <Select value={m.rol} opciones={ROLES} aria-label="Rol en las ventas" onChange={(ev) => cambiar({ rol: ev.target.value as RolEquipo }, "Rol guardado.")} />
            </Field>
            <Field label="Correo con el que entra" ayuda="Con esto la app sabe quién es y se le puede dar acceso.">
              <Input
                key={`e-${m.email ?? ""}`} type="email" defaultValue={m.email ?? ""} aria-label="Correo" placeholder="nombre@apicanta.com"
                onBlur={(ev) => {
                  const v = ev.target.value.trim().toLowerCase();
                  if (v === (m.email ?? "")) return;
                  if (v && !emailValido(v)) { toast("Ese correo no parece válido.", "err"); return; }
                  const otro = e.equipo.find((x) => x.id !== m.id && x.email?.trim().toLowerCase() === v);
                  if (v && otro) { toast(`Ese correo ya es de ${otro.nombre}.`, "err"); return; }
                  /* Vacío y no undefined: undefined no viaja y la base se quedaría con el viejo. */
                  cambiar({ email: v }, v ? "Correo guardado." : "Correo borrado.");
                }}
              />
            </Field>
          </div>
          <div className="row-wrap" style={{ gap: "var(--space-5)" }}>
            <label className="row" style={{ gap: 10 }}>
              <Switch checked={m.activo} onChange={(v) => cambiar({ activo: v }, v ? "Vuelve a estar en el equipo." : "Ya no está: no se liquida ni aparece al cargar ventas.")} etiqueta={`${m.nombre} está en el equipo`} />
              <span className="t-sm">Está en el equipo</span>
            </label>
            {(m.rol === "closer" || m.rol === "ceo") && (
              <label className="row" style={{ gap: 10 }} title="Si cierra una venta, no comisiona nadie: ni closer, ni director, ni setter.">
                <Switch checked={m.sinComision} onChange={(v) => cambiar({ sinComision: v })} etiqueta={`Con ${m.nombre} no comisiona nadie`} />
                <span className="t-sm">Sus ventas no comisionan</span>
              </label>
            )}
          </div>
        </section>

        {/* ---------- Qué cobra ---------- */}
        <section className="stack-3">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 className="t-label">Qué cobra</h3>
            <Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setEditando("nuevo")}>Agregar</Button>
          </div>
          {esquema.conceptos.length === 0 ? (
            <p className="t-sm t-subtle">
              Todavía nada. Un sueldo, un bono, una comisión, un monto por tramo o una tarifa por pieza: se agrega de a uno.
            </p>
          ) : (
            <ul className="con-lista">
              {esquema.conceptos.map((c) => (
                <li key={c.id} className="con-item">
                  <button type="button" className="con-item__texto" onClick={() => setEditando(c)}>
                    <span className="con-item__nombre">
                      {c.nombre}
                      <span className="tag">{TIPOS_CONCEPTO.find((t) => t.tipo === c.tipo)?.nombre}</span>
                    </span>
                    <span className="con-item__frase">{describirConcepto(c, e)}</span>
                    {c.notas && <span className="con-item__nota">{c.notas}</span>}
                  </button>
                  <IconButton etiqueta={`Editar ${c.nombre}`} onClick={() => setEditando(c)}><Pencil size={15} /></IconButton>
                  <IconButton etiqueta={`Sacar ${c.nombre}`} onClick={() => setBorrando(c)}><Trash2 size={15} /></IconButton>
                </li>
              ))}
            </ul>
          )}

          <Field label="Lo que falta definir (opcional)" ayuda="Sale como aviso en la liquidación hasta que lo borres.">
            <Textarea
              key={`pd-${esquema.pendiente ?? ""}`} rows={2} defaultValue={esquema.pendiente ?? ""}
              placeholder="Arreglo a confirmar con Yari"
              onBlur={(ev) => {
                const v = ev.target.value.trim();
                if (v !== (esquema.pendiente ?? "")) guardarEsquema({ pendiente: v || (null as unknown as undefined) }, v ? "Anotado." : "Listo: ya no queda nada a definir.");
              }}
            />
          </Field>
          <Field
            label="En Finanzas entra como"
            ayuda="La categoría del gasto al cerrar la liquidación. Las comisiones de closer y de director y el reparto del profit no: Finanzas ya las calcula."
          >
            <Select
              value={esquema.categoriaGasto} aria-label="Categoría en Finanzas"
              opciones={categorias.map((c) => ({ valor: c.categoria, texto: `${c.categoria} · ${infoGrupo(c.grupo).corto}` }))}
              onChange={(ev) => guardarEsquema({ categoriaGasto: ev.target.value }, "Categoría guardada.")}
            />
          </Field>
        </section>

        {/* ---------- Acceso a la app ---------- */}
        <section className="stack-3">
          <h3 className="t-label">Acceso a la app</h3>
          <AccesoMiembro m={m} accesos={accesos} yoEmail={yo.email} />
        </section>

        {/* ---------- Lo que se le liquidó ---------- */}
        {historial.length > 0 && (
          <section className="stack-3">
            <h3 className="t-label">Lo que se le liquidó</h3>
            <dl className="dl dl--compacta">
              {historial.map(({ l, p }) => (
                <React.Fragment key={l.id}>
                  <dt className="t-num">{nombrePeriodo(l.periodo)}</dt>
                  <dd className="t-num">
                    {plata(p.total, e.ajustes.monedaBase)}
                    <span className="t-subtle"> · {l.pagos[m.id] ? "pagado" : "por pagar"}</span>
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        )}
      </div>

      {editando && (
        <AsistenteConcepto
          miembro={m} concepto={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
          onListo={(c) => {
            const existe = esquema.conceptos.some((x) => x.id === c.id);
            guardarEsquema(
              { conceptos: existe ? esquema.conceptos.map((x) => (x.id === c.id ? c : x)) : [...esquema.conceptos, c] },
              existe ? `${c.nombre}: guardado.` : `${c.nombre}: agregado a lo que cobra ${m.nombre.split(" ")[0]}.`,
            );
            setEditando(null);
          }}
        />
      )}
      <Confirmar
        abierto={Boolean(borrando)} onCerrar={() => setBorrando(null)} confirmarTexto="Sacar"
        titulo={`Sacar «${borrando?.nombre ?? ""}»`}
        texto="Deja de calcularse en las liquidaciones abiertas. Las que ya se cerraron no cambian."
        onConfirmar={() => {
          if (!borrando) return;
          guardarEsquema({ conceptos: esquema.conceptos.filter((x) => x.id !== borrando.id) }, `${borrando.nombre}: sacado.`);
        }}
      />
    </Drawer>
  );
}

/* ---------- Acceso ---------- */

function AccesoMiembro({ m, accesos, yoEmail }: { m: MiembroEquipo; accesos: Accesos; yoEmail: string | null }) {
  const toast = useToast();
  const [nivel, setNivel] = useState<NivelAcceso>("equipo");
  const [trabajando, setTrabajando] = useState(false);
  const [clave, setClave] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);

  if (!hayNube) {
    return <p className="t-sm t-subtle">La app corre en este navegador, sin login: no hay accesos que dar.</p>;
  }
  const email = m.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return <p className="t-sm t-subtle">Para darle acceso, poné arriba el correo con el que va a entrar.</p>;
  }
  if (accesos.lista === null) return <div className="skeleton" style={{ height: 40 }} />;

  const acceso = accesos.lista.find((a) => a.email === email);
  const soyYo = Boolean(yoEmail && yoEmail.toLowerCase() === email);

  const conClave = async (rol: NivelAcceso) => {
    setTrabajando(true);
    const r = await generarClave({ email, nombre: m.nombre, rol });
    setTrabajando(false);
    if (r.error || !r.clave) { toast(r.error ?? "No se pudo generar la clave.", "err"); return; }
    await accesos.recargar();
    setClave(r.clave);
  };

  return (
    <>
      {acceso ? (
        <div className="stack-3">
          <div className="row-wrap">
            <Badge variante={acceso.rol === "dueno" ? "brand" : "success"} icono={<ShieldCheck size={12} />}>
              {acceso.rol === "dueno" ? "Dueño" : "Tiene acceso"}
            </Badge>
            <span className="t-sm t-subtle">Entra con {email}{soyYo ? " (sos vos)" : ""}.</span>
          </div>
          <div className="form-grid">
            <Field label="Qué ve" ayuda={NIVELES.find((n) => n.valor === acceso.rol)?.sub}>
              <Select
                value={acceso.rol} disabled={soyYo} aria-label="Qué ve"
                opciones={NIVELES.map((n) => ({ valor: n.valor, texto: n.texto }))}
                onChange={async (ev) => {
                  const error = await accesos.guardar({ email, nombre: acceso.nombre || m.nombre, rol: ev.target.value as NivelAcceso });
                  toast(error ?? "Guardado: el cambio se ve la próxima vez que entre.", error ? "err" : "ok");
                }}
              />
            </Field>
          </div>
          <div className="row-wrap">
            <Button sm variante="secondary" icono={<KeyRound size={15} />} cargando={trabajando} onClick={() => conClave(acceso.rol)}>
              Generar una clave nueva
            </Button>
            {!soyYo && <Button sm variante="ghost" icono={<UserX size={15} />} onClick={() => setQuitando(true)}>Quitar el acceso</Button>}
          </div>
        </div>
      ) : (
        <div className="stack-3">
          <p className="t-sm t-muted">No tiene acceso. Al dárselo se genera una clave para mandarle; entra con {email}.</p>
          <div className="form-grid">
            <Field label="Qué va a ver" ayuda={NIVELES.find((n) => n.valor === nivel)?.sub}>
              <Select value={nivel} aria-label="Qué va a ver" opciones={NIVELES.map((n) => ({ valor: n.valor, texto: n.texto }))} onChange={(ev) => setNivel(ev.target.value as NivelAcceso)} />
            </Field>
          </div>
          <div className="row-wrap">
            <Button sm variante="secondary" icono={<KeyRound size={15} />} cargando={trabajando} onClick={() => conClave(nivel)}>
              Dar acceso y generar clave
            </Button>
            <button
              type="button" className="link t-sm"
              onClick={async () => {
                const error = await accesos.guardar({ email, nombre: m.nombre, rol: nivel });
                toast(error ?? "Listo: entra con «Prefiero un enlace por correo».", error ? "err" : "ok");
              }}
            >
              Sin clave: que entre con un enlace por correo
            </button>
          </div>
        </div>
      )}

      {clave && <ClaveGenerada nombre={m.nombre} email={email} clave={clave} onCerrar={() => setClave(null)} />}
      <Confirmar
        abierto={quitando} onCerrar={() => setQuitando(false)} confirmarTexto="Quitar el acceso"
        titulo={`Quitar el acceso de ${m.nombre}`}
        texto="Deja de ver los datos de la app apenas cargue de nuevo. Se le puede volver a dar cuando quieras."
        onConfirmar={async () => {
          const error = await accesos.quitar(email);
          toast(error ?? `${m.nombre} ya no tiene acceso.`, error ? "err" : "ok");
        }}
      />
    </>
  );
}
