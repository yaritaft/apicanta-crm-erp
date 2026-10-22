"use client";

import React from "react";
import { Chip, Field, Input, Select } from "@/components/ui/ui";
import type { DatosContrato } from "@/lib/contratos";
import { plantillaDelContrato, type Programa } from "@/lib/programas";
import { modeloDeBienvenida, PERFILES } from "@/lib/bienvenida-alumno";

/* ==================================================================
   Los datos del contrato, como los carga el closer en la llamada (Manu y
   Juan Cruz, 20/10): los del alumno, la modalidad de pago, las sesiones
   1 a 1 y los bonos. Todo eso va a la plantilla del programa.
   Lo usan el paso «Contrato» de la carga de la venta y los botones
   «Mandar» y «Corregir» de la tarjeta del contrato.
   ================================================================== */

const SESIONES = [
  { valor: "", texto: "Sin definir" },
  { valor: "0", texto: "No incluye sesiones 1 a 1" },
  { valor: "1", texto: "1 sesión 1 a 1 (primeros 3 meses)" },
  { valor: "2", texto: "2 sesiones 1 a 1 (primeros 3 meses)" },
  { valor: "3", texto: "3 sesiones 1 a 1 (primeros 3 meses)" },
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
  /* El contrato de la reserva sale de la plantilla de reserva del programa y sólo lleva el monto (Manu, 21/10). */
  const reserva = Boolean(datos.reserva);
  const plantilla = plantillaDelContrato(programa, reserva);
  const conPlantilla = programas.filter((p) => p.activo && plantillaDelContrato(p, reserva).id);
  const bonos = Array.from(new Set([...(programa?.bonos ?? []), ...datos.bonos]));
  const alternarBono = (b: string) => onCambio({ bonos: datos.bonos.includes(b) ? datos.bonos.filter((x) => x !== b) : [...datos.bonos, b] });

  return (
    <div className="form-grid">
      <Field label="Programa" span2
        ayuda={plantilla.nombre ? `Plantilla: ${plantilla.nombre}` : reserva ? "Sale del contrato de reserva de ese programa." : "Sale de la plantilla de PandaDoc de ese programa."}>
        <Select
          value={programaId} onChange={(ev) => onPrograma(ev.target.value)} disabled={bloquearPrograma}
          placeholder="Elegí el programa"
          opciones={conPlantilla.map((p) => ({ valor: p.id, texto: p.nombre }))}
        />
      </Field>
      {/* Lili, 22/10: con el perfil le llega al alumno el roadmap que le corresponde (lib/bienvenida-alumno.ts). */}
      {modeloDeBienvenida({ reserva, programa: programaId }) && (
        <Field label="Perfil del alumno" span2
          ayuda="Con esto le llega su roadmap al firmar. Full Stack incluye Frontend y Backend.">
          <Select value={datos.perfil ?? ""} placeholder="Elegí el perfil" aria-label="Perfil del alumno"
            onChange={(ev) => onCambio({ perfil: ev.target.value || undefined })}
            opciones={PERFILES.map((p) => ({ valor: p, texto: p }))} />
        </Field>
      )}
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
      {reserva ? (
        <Field label="Monto de la reserva" ayuda="Va así en el contrato: «El Cliente paga una reserva de 300 USD…». No lleva plan de cuotas." span2>
          <Input value={datos.modalidad} onChange={(ev) => onCambio({ modalidad: ev.target.value })} placeholder="300 USD" />
        </Field>
      ) : (
        <Field label="Modalidad de pago" ayuda="Sale del plan de cuotas; se puede escribir distinto." span2>
          <Input value={datos.modalidad} onChange={(ev) => onCambio({ modalidad: ev.target.value })} placeholder="Tres pagos de 1.000 USD" />
        </Field>
      )}
      {/* La reserva no lleva sesiones, inicio ni bonos: eso va en el contrato del programa. */}
      {!reserva && <>
      <Field label="Sesiones 1 a 1 con el mentor" ayuda="Sólo si se las diste para cerrar la venta. En el contrato dice que valen los primeros 3 meses del programa.">
        <Select
          value={datos.sesiones === null ? "" : String(datos.sesiones)}
          onChange={(ev) => onCambio({ sesiones: ev.target.value === "" ? null : Number(ev.target.value) })}
          opciones={SESIONES}
        />
      </Field>
      <Field label="Inicio del servicio" ayuda="Si quiere arrancar más adelante (por ejemplo, en una semana), poné ese día.">
        <Input type="date" value={datos.inicio || datos.fecha} onChange={(ev) => onCambio({ inicio: ev.target.value })} />
      </Field>
      {/* Hoy el único «bono» que da el closer son las sesiones 1 a 1 (Manu, 20/10). Si un programa tiene bonos
          cargados en Ajustes, aparecen acá para elegirlos. */}
      {bonos.length > 0 && (
        <Field label="Bonos" ayuda="Tocá los que van en el contrato." span2>
          <div className="row-wrap" style={{ gap: 6 }}>
            {bonos.map((b) => <Chip key={b} activo={datos.bonos.includes(b)} onClick={() => alternarBono(b)}>{b}</Chip>)}
          </div>
        </Field>
      )}
      </>}
    </div>
  );
}
