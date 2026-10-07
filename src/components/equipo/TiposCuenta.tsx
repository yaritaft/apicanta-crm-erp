"use client";

import React, { useMemo, useState } from "react";
import { Eye, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHead, Field, IconButton, Input, Select, Switch } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, hayNube } from "@/lib/store";
import { elegirVerComo, useTiposCuenta, useVerComo, type useAccesos } from "@/lib/acceso";
import { AREAS, CUSTOMER_SUCCESS, nivelDeAreas, resumenDeTipo, tipoLimpio } from "@/lib/permisos";
import type { AreaId, NivelArea, TipoCuenta } from "@/lib/types";

/* ==================================================================
   Equipo → Tipos de cuenta: qué ve y qué edita cada tipo, área por área,
   y si ve sólo lo suyo (sus llamadas, sus ventas y su gente).

   Lo controla la base (supabase/tipos-cuenta.sql): lo que un tipo no ve
   le llega vacío y lo que no edita no se guarda, también por la API. Un
   cambio se ve la próxima vez que esa persona entra. El de Dueño es fijo
   (todo), y el de «Todo menos honorarios» no se borra.
   ================================================================== */

type Accesos = ReturnType<typeof useAccesos>;

const NIVELES: { valor: "" | NivelArea; texto: string }[] = [
  { valor: "", texto: "—" },
  { valor: "ver", texto: "Ve" },
  { valor: "editar", texto: "Edita" },
];

const textoNivel = (n?: NivelArea) => (n === "editar" ? "edita" : n === "ver" ? "ve" : "no ve");

export function TiposCuenta({ accesos }: { accesos: Accesos }) {
  const tipos = useTiposCuenta();
  const toast = useToast();
  const verComo = useVerComo();
  const [editando, setEditando] = useState<TipoCuenta | "nuevo" | null>(null);
  const [borrando, setBorrando] = useState<TipoCuenta | null>(null);

  /* Cuántas personas tiene cada tipo: uno con gente no se borra (la base
     tampoco lo deja: cada acceso apunta a su tipo). */
  const personas = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of accesos.lista ?? []) m.set(a.rol, (m.get(a.rol) ?? 0) + 1);
    return m;
  }, [accesos.lista]);

  function cambiarArea(t: TipoCuenta, area: AreaId, nivel: "" | NivelArea) {
    const areas = { ...t.areas };
    if (nivel) areas[area] = nivel; else delete areas[area];
    const nombreArea = AREAS.find((a) => a.id === area)?.nombre ?? area;
    /* Clientes acompaña a Ventas: no se le puede dar menos de lo que tiene Ventas. */
    if (area === "clientes" && nivelDeAreas(areas, "clientes") > (nivel === "editar" ? 2 : nivel === "ver" ? 1 : 0)) {
      toast(`${t.nombre} ve Clientes porque ve Ventas. Para sacárselo, cambiá Ventas.`, "err");
      if (t.areas.clientes) acciones.guardarTipoCuenta(tipoLimpio({ ...t, areas }), `${t.nombre}: Clientes quedó como Ventas.`);
      return;
    }
    acciones.guardarTipoCuenta(tipoLimpio({ ...t, areas }), `${t.nombre}: ${nombreArea} pasó de «${textoNivel(t.areas[area])}» a «${textoNivel(nivel || undefined)}».`);
    toast(`${t.nombre}: ${nombreArea}, ${textoNivel(nivel || undefined)}. Se ve la próxima vez que entren.`);
  }

  return (
    <Card>
      <CardHead
        titulo="Tipos de cuenta"
        sub="Qué ve y qué edita cada tipo, área por área. Lo controla la base: lo que no ve le llega vacío y lo que no edita no se guarda. Se aplica la próxima vez que esa persona entra."
        acciones={(
          <>
            {/* Un clic para el tipo de Lili y las chicas (F2-06): ve Alumnos y Clientes, y sólo eso. */}
            {!tipos.some((t) => t.id === CUSTOMER_SUCCESS.id) && (
              <Button
                variante="secondary" icono={<Plus size={16} />}
                title="Ve Alumnos (seguimiento, CV y LinkedIn, testimonios) y Clientes, y nada más"
                onClick={() => {
                  acciones.guardarTipoCuenta({ ...CUSTOMER_SUCCESS, orden: Math.max(0, ...tipos.map((t) => t.orden)) + 1 }, `Se creó el tipo de cuenta «${CUSTOMER_SUCCESS.nombre}».`);
                  toast(`Listo: «${CUSTOMER_SUCCESS.nombre}» ya se puede elegir al dar acceso.`);
                }}
              >
                Crear «Customer Success»
              </Button>
            )}
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setEditando("nuevo")}>Agregar un tipo</Button>
          </>
        )}
      />

      {!hayNube && (
        <div className="row-wrap tipos-vercomo">
          <Eye size={15} aria-hidden />
          <span className="t-sm">Probar en esta app local:</span>
          <div style={{ width: 230 }}>
            <Select
              value={verComo ?? "dueno"} aria-label="Ver la app como"
              opciones={tipos.map((t) => ({ valor: t.id, texto: t.id === "dueno" ? "Dueño (como siempre)" : `Ver como ${t.nombre}` }))}
              onChange={(ev) => elegirVerComo(ev.target.value === "dueno" ? null : ev.target.value)}
            />
          </div>
        </div>
      )}

      <div className="planilla-caja tipos-caja">
        <table className="planilla tipos-tabla" aria-label="Qué ve y qué edita cada tipo de cuenta">
          <thead>
            <tr>
              <th scope="col" className="planilla__fija">Tipo</th>
              {AREAS.map((a) => (
                <th key={a.id} scope="col" title={a.pantallas}>{a.nombre}</th>
              ))}
              <th scope="col" title="Llamadas, ventas y personas: sólo las suyas">Sólo lo suyo</th>
              <th scope="col" className="tipos-tabla__num">Personas</th>
              <th scope="col" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {tipos.map((t) => {
              const fijo = t.id === "dueno";
              const n = personas.get(t.id) ?? 0;
              return (
                <tr key={t.id}>
                  <th scope="row" className="planilla__fija">
                    <span className="tipos-tabla__tipo">
                      <span className="t-strong">{fijo && <Lock size={13} aria-label="Fijo" />} {t.nombre}</span>
                      <span className="t-sm t-subtle">{resumenDeTipo(t)}</span>
                    </span>
                  </th>
                  {AREAS.map((a) => {
                    /* Clientes sigue a Ventas: se muestra lo que de verdad puede. */
                    const nivel = fijo ? "editar" : (["", "ver", "editar"] as const)[nivelDeAreas(t.areas, a.id)];
                    return (
                      <td key={a.id} className={`tipos-tabla__celda tipos-tabla__celda--${nivel || "no"}`}>
                        {fijo ? (
                          <span className="t-sm">Edita</span>
                        ) : (
                          <Select
                            value={nivel} aria-label={`${t.nombre}: ${a.nombre}`}
                            opciones={NIVELES.map((x) => ({ valor: x.valor, texto: x.texto }))}
                            onChange={(ev) => cambiarArea(t, a.id, ev.target.value as "" | NivelArea)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="tipos-tabla__celda">
                    {fijo ? <span className="t-sm t-subtle">—</span> : (
                      <Switch
                        checked={t.soloLoSuyo} etiqueta={`${t.nombre}: sólo lo suyo`}
                        onChange={(v) => {
                          acciones.guardarTipoCuenta(tipoLimpio({ ...t, soloLoSuyo: v }), `${t.nombre}: ${v ? "ahora ve sólo lo suyo" : "ya no ve sólo lo suyo"}.`);
                          toast(v ? `${t.nombre}: sólo sus llamadas, sus ventas y su gente.` : `${t.nombre}: ve lo de todos en sus áreas.`);
                        }}
                      />
                    )}
                  </td>
                  <td className="tipos-tabla__num t-num">{accesos.lista === null ? "…" : n}</td>
                  <td>
                    {!fijo && (
                      <span className="row" style={{ gap: 2 }}>
                        <IconButton etiqueta={`Editar ${t.nombre}`} onClick={() => setEditando(t)}><Pencil size={15} /></IconButton>
                        {t.id !== "equipo" && (
                          <IconButton
                            etiqueta={n > 0 ? `${t.nombre} lo usan ${n} ${n === 1 ? "persona" : "personas"}: cambiales el tipo antes de borrarlo` : `Borrar ${t.nombre}`}
                            disabled={n > 0 || accesos.lista === null} onClick={() => setBorrando(t)}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editando && (
        <EditarTipo
          tipo={editando === "nuevo" ? null : editando} tipos={tipos}
          onCerrar={() => setEditando(null)}
          onGuardar={(t, nuevo) => {
            acciones.guardarTipoCuenta(tipoLimpio(t), nuevo ? `Se creó el tipo de cuenta «${t.nombre}».` : `Se editó el tipo de cuenta «${t.nombre}».`);
            toast(nuevo ? `Listo: «${t.nombre}» ya se puede elegir al dar acceso.` : "Guardado.");
            setEditando(null);
          }}
        />
      )}
      <Confirmar
        abierto={Boolean(borrando)} onCerrar={() => setBorrando(null)} confirmarTexto="Borrar el tipo"
        titulo={`¿Borrar el tipo «${borrando?.nombre ?? ""}»?`}
        texto="Nadie lo tiene asignado. Se puede volver a crear cuando quieras."
        onConfirmar={() => {
          if (!borrando) return;
          acciones.borrarTipoCuenta(borrando.id, `Se borró el tipo de cuenta «${borrando.nombre}».`);
          toast("Tipo borrado.");
        }}
      />
    </Card>
  );
}

/* Nombre, descripción y, al crearlo, de qué tipo parte. */
function EditarTipo({ tipo, tipos, onCerrar, onGuardar }: {
  tipo: TipoCuenta | null; tipos: TipoCuenta[];
  onCerrar: () => void; onGuardar: (t: TipoCuenta, nuevo: boolean) => void;
}) {
  const [nombre, setNombre] = useState(tipo?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(tipo?.descripcion ?? "");
  const [base, setBase] = useState("equipo");
  const repetido = tipos.some((t) => t.id !== tipo?.id && t.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={tipo ? `Editar «${tipo.nombre}»` : "Agregar un tipo de cuenta"}
      sub={tipo ? "Qué ve cada área se cambia en la tabla." : "Arranca con lo mismo que el tipo que elijas; después se ajusta en la tabla, área por área."}
      puedeGuardar={Boolean(nombre.trim()) && !repetido}
      onGuardar={() => {
        if (tipo) { onGuardar({ ...tipo, nombre, descripcion }, false); return; }
        const desde = tipos.find((t) => t.id === base);
        const slug = nombre.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "tipo";
        let id = slug;
        for (let i = 2; tipos.some((t) => t.id === id); i++) id = `${slug}_${i}`;
        onGuardar({
          id, nombre, descripcion,
          areas: desde && desde.id !== "dueno" ? { ...desde.areas } : {},
          soloLoSuyo: desde?.soloLoSuyo ?? false,
          orden: Math.max(0, ...tipos.map((t) => t.orden)) + 1,
        }, true);
      }}
    >
      <div className="form-grid">
        <Field label="Nombre" error={repetido ? "Ya hay un tipo con ese nombre." : undefined}>
          <Input value={nombre} onChange={(ev) => setNombre(ev.target.value)} placeholder="Servicio" autoFocus error={repetido} />
        </Field>
        {!tipo && (
          <Field label="Arranca como" ayuda="Copia lo que ve y edita ese tipo.">
            <Select
              value={base} aria-label="Arranca como"
              opciones={tipos.filter((t) => t.id !== "dueno").map((t) => ({ valor: t.id, texto: t.nombre }))}
              onChange={(ev) => setBase(ev.target.value)}
            />
          </Field>
        )}
        <Field label="Para quién es" span2>
          <Input value={descripcion} onChange={(ev) => setDescripcion(ev.target.value)} placeholder="Customer success: alumnos, reportes y el servicio." />
        </Field>
      </div>
    </ModalForm>
  );
}
