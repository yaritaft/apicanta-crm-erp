"use client";

import React from "react";
import type { CampoPersonalizado, EntidadNombre } from "@/lib/types";
import { Field, Input, Select, Switch, Textarea } from "./ui";

/* Renderiza los campos que el usuario agregó desde Ajustes. */
export function CamposExtra({ campos, entidad, valores, onChange }: {
  campos: CampoPersonalizado[];
  entidad: EntidadNombre;
  valores: Record<string, unknown>;
  onChange: (clave: string, valor: unknown) => void;
}) {
  const propios = campos.filter((c) => c.entidad === entidad);
  if (propios.length === 0) return null;

  return (
    <>
      {propios.map((c) => {
        const v = valores[c.clave];
        return (
          <Field key={c.id} label={c.nombre} ayuda={c.ayuda} span2={c.tipo === "texto-largo"}>
            {c.tipo === "texto-largo" ? (
              <Textarea value={String(v ?? "")} onChange={(e) => onChange(c.clave, e.target.value)} />
            ) : c.tipo === "seleccion" ? (
              <Select
                opciones={c.opciones ?? []} placeholder="Elegí una opción"
                value={String(v ?? "")} onChange={(e) => onChange(c.clave, e.target.value)}
              />
            ) : c.tipo === "booleano" ? (
              <div style={{ height: 40, display: "flex", alignItems: "center" }}>
                <Switch checked={Boolean(v)} onChange={(x) => onChange(c.clave, x)} etiqueta={c.nombre} />
              </div>
            ) : (
              <Input
                type={c.tipo === "numero" || c.tipo === "moneda" ? "number"
                  : c.tipo === "fecha" ? "date"
                  : c.tipo === "email" ? "email"
                  : c.tipo === "telefono" ? "tel"
                  : c.tipo === "url" ? "url" : "text"}
                value={String(v ?? "")}
                onChange={(e) => onChange(c.clave, c.tipo === "numero" || c.tipo === "moneda" ? Number(e.target.value) : e.target.value)}
                required={c.requerido}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}

/* Muestra los campos extra en el panel de detalle. */
export function DatosExtra({ campos, entidad, valores }: {
  campos: CampoPersonalizado[]; entidad: EntidadNombre; valores: Record<string, unknown>;
}) {
  const propios = campos.filter((c) => c.entidad === entidad);
  if (propios.length === 0) return null;
  return (
    <>
      {propios.map((c) => {
        const v = valores[c.clave];
        const texto = c.tipo === "booleano" ? (v ? "Sí" : "No") : v === undefined || v === "" ? "—" : String(v);
        return (
          <React.Fragment key={c.id}>
            <dt>{c.nombre}</dt>
            <dd>{texto}</dd>
          </React.Fragment>
        );
      })}
    </>
  );
}
