"use client";

import React from "react";
import { Chip, Field, Input, Select } from "@/components/ui/ui";
import type { DatosContrato } from "@/lib/contratos";
import type { Programa } from "@/lib/programas";

/* ==================================================================
   Los datos del contrato, como los carga el closer en la llamada (Manu y
   Juan Cruz, 20/10): los del alumno, la modalidad de pago, las sesiones
   1 a 1 y los bonos. Todo eso va a la plantilla del programa.
   Lo usan el paso «Contrato» de la carga de la venta y los botones
   «Mandar» y «Corregir» de la tarjeta del contrato.
   ================================================================== */

const SESIONES = [
  { valor: "", texto: "Sin definir" },
  { valor: "0", texto: "Sin sesiones 1 a 1" },
  { valor: "1", texto: "1 sesión 1 a 1" },
  { valor: "2", texto: "2 sesiones 1 a 1" },
  { valor: "3", texto: "3 sesiones 1 a 1" },
];

export function DatosDelContrato({ datos, onCambio, programas, programaId, onPrograma, bloquearPrograma }: {
  datos: DatosContrato;
  onCambio: (cambios: Partial<DatosContrato>) => void;
  programas: Programa[];
  programaId: string;
  onPrograma: (id: string) => void;
  /* Al corregir un contrato ya mandado, el programa (la plantilla) no cambia. */
  bloquearPrograma?: boolean;
}) {
  const programa = programas.find((p) => p.id === programaId);
  const conPlantilla = programas.filter((p) => p.activo && p.plantillaId);
  const bonos = Array.from(new Set([...(programa?.bonos ?? []), ...datos.bonos]));
  const alternarBono = (b: string) => onCambio({ bonos: datos.bonos.includes(b) ? datos.bonos.filter((x) => x !== b) : [...datos.bonos, b] });

  return (
    <div className="form-grid">
      <Field label="Programa" ayuda={programa?.plantillaNombre ? `Plantilla: ${programa.plantillaNombre}` : "Sale de la plantilla de PandaDoc de ese programa."} span2>
        <Select
          value={programaId} onChange={(ev) => onPrograma(ev.target.value)} disabled={bloquearPrograma}
          placeholder="Elegí el programa"
          opciones={conPlantilla.map((p) => ({ valor: p.id, texto: p.nombre }))}
        />
      </Field>
      <Field label="Nombre completo" ayuda="Como va en el contrato." span2>
        <Input value={datos.nombre} onChange={(ev) => onCambio({ nombre: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="Mail" ayuda="Adonde le llega el contrato para firmar.">
        <Input type="email" value={datos.email} onChange={(ev) => onCambio({ email: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="Teléfono">
        <Input value={datos.telefono} onChange={(ev) => onCambio({ telefono: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="Documento" ayuda="DNI, pasaporte o el que tenga.">
        <Input value={datos.documento} onChange={(ev) => onCambio({ documento: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="País">
        <Input value={datos.pais} onChange={(ev) => onCambio({ pais: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="Domicilio" span2>
        <Input value={datos.domicilio} onChange={(ev) => onCambio({ domicilio: ev.target.value })} autoComplete="off" />
      </Field>
      <Field label="Modalidad de pago" ayuda="Sale del plan de cuotas; se puede escribir distinto." span2>
        <Input value={datos.modalidad} onChange={(ev) => onCambio({ modalidad: ev.target.value })} placeholder="Tres pagos de 1.000 USD" />
      </Field>
      <Field label="Sesiones 1 a 1 con el mentor">
        <Select
          value={datos.sesiones === null ? "" : String(datos.sesiones)}
          onChange={(ev) => onCambio({ sesiones: ev.target.value === "" ? null : Number(ev.target.value) })}
          opciones={SESIONES}
        />
      </Field>
      <Field label="Fecha del contrato">
        <Input type="date" value={datos.fecha} onChange={(ev) => onCambio({ fecha: ev.target.value })} />
      </Field>
      <Field label="Bonos" ayuda={bonos.length ? "Tocá los que van en el contrato." : "Este programa todavía no tiene bonos cargados (Ajustes → Integraciones → Programas)."} span2>
        {bonos.length > 0 && (
          <div className="row-wrap" style={{ gap: 6 }}>
            {bonos.map((b) => <Chip key={b} activo={datos.bonos.includes(b)} onClick={() => alternarBono(b)}>{b}</Chip>)}
          </div>
        )}
      </Field>
    </div>
  );
}
