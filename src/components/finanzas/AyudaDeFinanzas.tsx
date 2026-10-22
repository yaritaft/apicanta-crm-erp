"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { diaDeNegocio } from "@/lib/dia-negocio";

/* ==================================================================
   «¿Dónde está…?»: las preguntas que más se repiten en Finanzas, con la
   respuesta corta y el lugar donde se resuelve. Aldana (22/10): «¿podemos agregar
   un botón de ayuda así matamos a preguntas al bot y no a vos?».

   Cada pregunta nace de algo que alguien no encontró de verdad: se suman las
   que vayan apareciendo.
   ================================================================== */

interface Pregunta { clave: string; pregunta: string; respuesta: React.ReactNode; ir?: { href: string; texto: string } }

export function preguntasDeFinanzas(hoy: string): Pregunta[] {
  return [
    {
      clave: "ingresos-del-dia", pregunta: "¿Dónde veo lo que entró hoy o ayer?",
      respuesta: <>En <strong>Transacciones</strong>: elegí «Hoy», «Ayer» o un día. Muestra todo lo que entró —cuotas y ventas nuevas, por pasarela o por la financiera—, también lo que todavía no tiene su venta cargada.</>,
      ir: { href: `/finanzas/transacciones?dia=${hoy}&tipo=entradas`, texto: "Ver lo que entró hoy" },
    },
    {
      clave: "espera-closer", pregunta: "Entró un cobro y el closer todavía no cargó la venta, ¿qué hago?",
      respuesta: <>No se pierde: queda en <strong>Conciliación</strong> como pendiente. Tocá «Pedir la venta a un closer» y le aparece en su panel (rojo a las 48 horas). En Transacciones figura como «Esperando la venta de…» hasta que la cargue; cuando lo hace, se concilia y queda como cobrado.</>,
      ir: { href: "/conciliacion", texto: "Ir a Conciliación" },
    },
    {
      clave: "cashback", pregunta: "¿Cómo registro el cashback de Mercury?",
      respuesta: <>En <strong>Transacciones</strong> → «Cargar gasto o ingreso» → «Ingreso · volvió plata». Escribí «cashback»: la categoría se elige sola. En «A qué cuenta volvió» poné Mercury.</>,
      ir: { href: "/finanzas/transacciones", texto: "Ir a Transacciones" },
    },
    {
      clave: "pase-mal", pregunta: "Marqué un depósito como movimiento entre cuentas y no era, ¿cómo lo saco?",
      respuesta: <>En <strong>Caja</strong> → «Movimientos entre cuentas»: tocá la X de esa fila («No es un movimiento entre cuentas»), o abrilo y elegí «No: es un cobro de un cliente». El depósito sigue en Conciliación para atarlo a su cuota. Guardar una nota ya no lo confirma.</>,
      ir: { href: "/finanzas/caja", texto: "Ir a la Caja" },
    },
    {
      clave: "rechazo", pregunta: "Rechacé un cobro y el closer no lo corrige, ¿qué pasa?",
      respuesta: <>El cobro rechazado le aparece al closer en <strong>Mi panel → Para vos</strong>, con tu motivo y hace cuánto lo rechazaste. En el paso «Validar los cobros» ves en el panel de qué closer está y desde cuándo.</>,
    },
    {
      clave: "comision-estimada", pregunta: "¿Cómo sé si la comisión de un cobro es la real o una estimada?",
      respuesta: <>En <strong>Conciliación</strong>, un cobro con la comisión en cero usa el porcentaje de la cuenta (estimada) y se corrige solo cuando la pasarela la informa. Si Whop no la informa, la sincronización avisa por qué.</>,
      ir: { href: "/conciliacion", texto: "Ir a Conciliación" },
    },
  ];
}

export function AyudaDeFinanzas() {
  const [abierta, setAbierta] = useState(false);
  const [cual, setCual] = useState<string | null>(null);
  const preguntas = preguntasDeFinanzas(diaDeNegocio(new Date().toISOString()));
  return (
    <>
      <Button sm variante="ghost" icono={<CircleHelp size={15} />} onClick={() => setAbierta(true)} title="Respuestas a lo que más se pregunta en Finanzas">Ayuda</Button>
      <Modal abierto={abierta} onCerrar={() => setAbierta(false)} titulo="Ayuda de Finanzas" sub="Lo que más se pregunta, con el lugar donde se resuelve." ancho>
        <div className="stack-2">
          {preguntas.map((p) => (
            <div key={p.clave} className="ayuda-fin">
              <button type="button" className="ayuda-fin__pregunta" aria-expanded={cual === p.clave} onClick={() => setCual(cual === p.clave ? null : p.clave)}>
                {p.pregunta}
              </button>
              {cual === p.clave && (
                <div className="ayuda-fin__respuesta">
                  <p className="t-sm">{p.respuesta}</p>
                  {p.ir && <Link className="link t-sm" href={p.ir.href} onClick={() => setAbierta(false)}>{p.ir.texto}</Link>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
