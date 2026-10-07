"use client";

import React from "react";
import { Link2 } from "lucide-react";
import { Badge } from "@/components/ui/ui";
import type { CobrosDeVenta } from "@/lib/control-cobros";

/* ==================================================================
   Las celdas «Comprobante» y «Conciliado» de la tabla del CRM: lo que
   dicen los cobros de la venta de esa llamada, de un vistazo. Un clic
   abre la ficha de la venta, donde está cada cobro con su comprobante
   (y donde el director o finanzas lo chequean). La cuenta es la de
   Ventas → Cobros (lib/control-cobros.ts).
   ================================================================== */

const nada = <span className="t-subtle">—</span>;

function Abrir({ onAbrir, titulo, children }: { onAbrir?: () => void; titulo: string; children: React.ReactNode }) {
  /* Quien no puede abrir la venta (su ficha no tiene la solapa de ventas) ve la pastilla sin botón. */
  if (!onAbrir) return <span title={titulo}>{children}</span>;
  return (
    <button type="button" className="crm-t__cobros" onClick={onAbrir} title={titulo}>
      {children}
    </button>
  );
}

export function CeldaCobros({ clave, cobros, onAbrir }: {
  clave: "comprobante" | "conciliado"; cobros: CobrosDeVenta | null; onAbrir?: () => void;
}) {
  /* Sin venta no hay cobros que mirar. */
  if (!cobros) return nada;
  if (cobros.total === 0) {
    return <span className="t-subtle" title="La venta todavía no tiene ningún cobro cargado.">Sin cobros</span>;
  }
  const n = cobros.total;
  const varios = n > 1;

  if (clave === "comprobante") {
    if (cobros.sinComprobante > 0) {
      return (
        <Abrir onAbrir={onAbrir} titulo={`${cobros.sinComprobante} de ${n} ${varios ? "cobros" : "cobro"} sin comprobante: abrir la venta para subirlo.`}>
          <Badge variante="warning">{varios ? `Falta ${cobros.sinComprobante} de ${n}` : "Falta"}</Badge>
        </Abrir>
      );
    }
    const porPasarela = cobros.conciliados;
    return (
      <Abrir
        onAbrir={onAbrir}
        titulo={`${varios ? "Todos los cobros tienen" : "El cobro tiene"} su prueba${porPasarela ? ` (${porPasarela} con el pago de la pasarela)` : ""}: abrir la venta.`}
      >
        <Badge variante="success">{varios ? `Todos · ${n}` : "Sí"}</Badge>
      </Abrir>
    );
  }

  if (cobros.sinConciliar > 0) {
    return (
      <Abrir
        onAbrir={onAbrir}
        titulo={`${cobros.sinConciliar} de ${n} ${varios ? "cobros son" : "cobro es"} de una cuenta con pasarela y todavía no se ató a su pago: se concilia en Conciliación.`}
      >
        <Badge variante="warning">{varios ? `Sin conciliar ${cobros.sinConciliar} de ${n}` : "Sin conciliar"}</Badge>
      </Abrir>
    );
  }
  if (cobros.conciliados > 0) {
    const resto = cobros.aMano;
    return (
      <Abrir
        onAbrir={onAbrir}
        titulo={resto ? `${cobros.conciliados} atados al pago de la pasarela; ${resto} a mano (la cuenta no tiene pasarela, se prueban con el comprobante).` : "Atado al pago de la pasarela."}
      >
        <Badge variante="success" icono={<Link2 size={13} />}>{resto ? `Sí · ${cobros.conciliados} de ${n}` : "Sí"}</Badge>
      </Abrir>
    );
  }
  return (
    <Abrir onAbrir={onAbrir} titulo="La cuenta no tiene pasarela (la Financiera, efectivo): se prueba con el comprobante.">
      <Badge variante="neutral">A mano</Badge>
    </Abrir>
  );
}
