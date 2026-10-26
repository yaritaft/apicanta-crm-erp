"use client";

import React, { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";

/* ==================================================================
   «El alumno cambió cómo paga: ¿qué botón uso?». Mariano (26/10): «este
   alumno ingresó con 2 cuotas de US$ 1.500, hoy abonó US$ 1.000 y los otros 500
   los pagará en 7 días: ¿cómo lo reflejo en el sistema?». La respuesta existía
   repartida en cinco botones y nadie sabía cuál era; esta lista junta cada caso
   con el botón exacto. Cada pregunta nace de algo que alguien no supo hacer
   de verdad: se suman las que vayan apareciendo.
   ================================================================== */

interface Pregunta { clave: string; pregunta: string; respuesta: React.ReactNode }

export function preguntasDeCuotas(): Pregunta[] {
  return [
    {
      clave: "pago-parcial-resto-despues", pregunta: "Pagó una parte hoy y el resto lo paga en unos días",
      respuesta: <>En la ficha de la venta, en esa cuota: <strong>Registrar pago</strong> → poné lo que pagó hoy y la cuenta → en el paso <strong>«Lo que falta»</strong> dejá <strong>«Lo paga después: el resto queda en esta cuota»</strong> y elegí cuándo (En 7 días, En 15 días, A fin de mes o una fecha). La cuota pasa a vencer ese día y muestra «Faltan US$ …». Cuando llegue el resto, volvés a tocar <strong>Registrar pago</strong> en la misma cuota y queda cobrada. Las otras cuotas no se tocan.</>,
    },
    {
      clave: "pago-parcial-resto-no", pregunta: "Pagó un poco menos y lo que falta no se va a cobrar (redondeo, descuento, lo que le descontó la pasarela)",
      respuesta: <>Al registrar el pago, en «Lo que falta» elegí <strong>«No se cobra: la cuota queda saldada»</strong> y escribí el motivo. Si la cuota ya estaba cobrada en parte, usá el botón <strong>Dar por saldada</strong>. La cuota queda pagada en lo cobrado y el valor de la venta baja lo mismo. Hace falta el permiso de editar cuotas.</>,
    },
    {
      clave: "pago-parcial-repartir", pregunta: "Pagó menos y quiere sumar lo que falta a las cuotas que siguen",
      respuesta: <>En «Lo que falta» elegí <strong>«Repartirlo en las cuotas que siguen»</strong> (en partes iguales) o <strong>«Sumarlo a la próxima cuota»</strong>. Si no hay más cuotas, <strong>«Pasarlo a una cuota nueva»</strong> crea una un mes después. La cuota actual queda pagada en lo que entró y el total de la venta no cambia. Antes de guardar se ve cómo quedan las cuotas.</>,
    },
    {
      clave: "dos-cuentas", pregunta: "Pagó la misma cuota mitad por una cuenta y mitad por otra",
      respuesta: <>En el primer paso tocá <strong>«Agregar otra cuenta recaudadora»</strong>: son dos cobros sobre la misma cuota, cada uno con su comprobante o su pago de la pasarela.</>,
    },
    {
      clave: "pago-adelantado", pregunta: "Pagó dos cuotas juntas, o adelantó la que sigue",
      respuesta: <>Cada cuota lleva su propio pago: registrá el de la primera y después el de la siguiente. Si es un solo pago de la pasarela, se concilia en las dos y se va descontando lo que ya usaste.</>,
    },
    {
      clave: "mas-tiempo", pregunta: "Todavía no pagó pero pidió más tiempo",
      respuesta: <>En la cuota tocá <strong>Cambiar fecha</strong>, elegí el día nuevo y, si querés, el motivo. Queda anotado en la cuota y en la actividad, y deja de figurar como vencida hasta ese día.</>,
    },
    {
      clave: "pago-mal", pregunta: "Cargué un pago con el monto, la cuenta o la fecha equivocados",
      respuesta: <>En el cobro, tocá <strong>Corregir</strong>: se cambia todo (cuenta, monto, fecha, comprobante) o se usa <strong>Eliminar este pago</strong>. Se puede mientras Finanzas no lo haya chequeado y el mes no esté liquidado; después, pedíselo a Finanzas por el chat de la ficha.</>,
    },
    {
      clave: "plan-mal", pregunta: "El plan quedó mal cargado: una cuota con otro monto o una cuota que sobra",
      respuesta: <>En la cuota: <strong>Corregir monto</strong> (con el motivo; el valor de la venta se ajusta solo) o <strong>Quitar cuota</strong> si no tiene cobros. Para cambiar a otro plan completo, corregí cuota por cuota hasta que sumen el precio acordado.</>,
    },
    {
      clave: "no-paga-mas", pregunta: "No va a pagar más",
      respuesta: <>En la cuota tocá <strong>Incobrable</strong> y escribí por qué: sale de lo pendiente y de la mora. Si después paga, <strong>Volver a cobrar</strong> la reactiva. Si se arrepintió de la compra, usá <strong>Marcar reembolsada</strong> o <strong>Cargar una devolución</strong> al final de la venta.</>,
    },
    {
      clave: "sin-boton", pregunta: "No me aparece alguno de esos botones",
      respuesta: <>Registrar pago lo ve quien carga cobros. <strong>Cambiar fecha, Incobrable, Dar por saldada, Corregir monto y Quitar cuota</strong> sólo aparecen con el permiso de editar cuotas; si no están, escribí en el chat de la ficha qué hay que hacer y lo resuelve Finanzas.</>,
    },
  ];
}

export function AyudaDeCuotas() {
  const [abierta, setAbierta] = useState(false);
  const [cual, setCual] = useState<string | null>("pago-parcial-resto-despues");
  const preguntas = preguntasDeCuotas();
  return (
    <>
      <Button sm variante="ghost" icono={<CircleHelp size={15} />} onClick={() => setAbierta(true)} title="Qué hacer cuando el alumno cambia cómo paga">¿Cambió cómo paga?</Button>
      <Modal abierto={abierta} onCerrar={() => setAbierta(false)} titulo="El alumno cambió cómo paga" sub="Cada caso con el botón que corresponde, en la ficha de la venta." ancho>
        <div className="stack-2">
          {preguntas.map((p) => (
            <div key={p.clave} className="ayuda-fin">
              <button type="button" className="ayuda-fin__pregunta" aria-expanded={cual === p.clave} onClick={() => setCual(cual === p.clave ? null : p.clave)}>
                {p.pregunta}
              </button>
              {cual === p.clave && (
                <div className="ayuda-fin__respuesta">
                  <p className="t-sm">{p.respuesta}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
