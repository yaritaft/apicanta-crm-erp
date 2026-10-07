"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";

/* ==================================================================
   «¿Cómo funciona esta pantalla?» de la Conciliación.

   Angelo (06/10): la Conciliación no se entiende. La pantalla habla en
   la jerga de quien la armó (conciliar, calce, atar, imputar), así que
   arriba va lo que pasa con la plata, en tres pasos, y cada etiqueta que
   aparece en la lista tiene su significado a mano.

   Abierta la primera vez; quien ya la leyó la cierra y queda cerrada
   (en su navegador, sin tocar la base).
   ================================================================== */

const CLAVE = "apicanta-conciliacion-explicacion";

const PASOS: { titulo: string; texto: React.ReactNode }[] = [
  {
    titulo: "Entra el cobro",
    texto: <>Aparece en <strong>Pendientes</strong> con quién pagó, cuánto y la comisión de la pasarela. Llega solo con «Sincronizar», o lo cargás con «Importar» (CSV).</>,
  },
  {
    titulo: "Lo asignás a su cuota",
    texto: <>La app sugiere la cuota. Si coincide exacto, un clic; si no, la buscás por el nombre del cliente. Si es una compra nueva, la cargás como venta desde el mismo cobro.</>,
  },
  {
    titulo: "Queda conciliado",
    texto: <>Ahora sí cuenta como <strong>Cash Collected</strong>, con la comisión real de la pasarela. Si no corresponde a ninguna venta (un reembolso, un pago de otra cosa), lo <strong>ignorás</strong>.</>,
  },
];

const GLOSARIO: { palabra: string; texto: string }[] = [
  { palabra: "Pendiente", texto: "Entró a una pasarela y todavía no se asignó a ninguna cuota. Se ve, pero no cuenta como Cash Collected ni genera comisiones." },
  { palabra: "Conciliado", texto: "Ya está asignado a su cuota: cuenta como Cash Collected y su comisión es la que cobró la pasarela de verdad." },
  { palabra: "Ignorado", texto: "Se marcó como que no corresponde a ninguna venta. No cuenta, y queda guardado por si hay que revisarlo." },
  { palabra: "Coincide exacto", texto: "El monto es el de una cuota de esa misma persona y no hay otra candidata: se puede conciliar de una." },
  { palabra: "Ya cargado", texto: "Alguien ya cargó este pago a mano, o vino de la planilla. Asignarlo otra vez contaría la plata dos veces: «Atar» lo une al pago que ya existe y le pone la comisión real." },
  { palabra: "Comisión estimada", texto: "La pasarela todavía no mandó cuánto cobró de comisión: se usa el porcentaje de la cuenta y se corrige solo cuando llegue." },
  { palabra: "Bruto · Comisión · Neto", texto: "Bruto es lo que pagó el cliente; la comisión, lo que se queda la pasarela; neto, lo que llega a la cuenta." },
];

export function ComoFuncionaConciliacion() {
  const [abierto, setAbierto] = useState(true);
  useEffect(() => {
    try { if (window.localStorage.getItem(CLAVE) === "cerrada") setAbierto(false); } catch { /* sin almacenamiento: queda abierta */ }
  }, []);
  const alternar = () => setAbierto((v) => {
    try { window.localStorage.setItem(CLAVE, v ? "cerrada" : "abierta"); } catch { /* idem */ }
    return !v;
  });

  return (
    <section className="conc-guia" aria-label="Cómo funciona la conciliación">
      <button type="button" className="conc-guia__cabeza" aria-expanded={abierto} onClick={alternar}>
        <Info size={18} aria-hidden />
        <span className="conc-guia__titulo">¿Cómo funciona esta pantalla?</span>
        <span className="conc-guia__accion">{abierto ? "Ocultar" : "Ver la explicación"}</span>
        <ChevronDown size={16} className="conc-guia__chev" aria-hidden />
      </button>
      {abierto && (
        <div className="conc-guia__cuerpo">
          <p className="conc-guia__lead">
            Cuando entra plata a una pasarela (Stripe, Hotmart, Whop, dLocal…), el cobro llega acá <strong>sin saber de qué cuota es</strong>.
            Mientras nadie se lo asigne, esa plata se ve pero <strong>no cuenta como Cash Collected</strong> ni genera comisiones.
            {" "}<strong>Conciliar es decirle a qué cuota corresponde.</strong>
          </p>
          <ol className="conc-pasos">
            {PASOS.map((p, i) => (
              <li key={p.titulo} className="conc-paso">
                <span className="conc-paso__n" aria-hidden>{i + 1}</span>
                <span className="conc-paso__titulo">{p.titulo}</span>
                <span className="conc-paso__texto">{p.texto}</span>
              </li>
            ))}
          </ol>
          <h3 className="conc-guia__sub">Qué significa cada etiqueta</h3>
          <dl className="conc-glosario">
            {GLOSARIO.map((g) => (
              <div key={g.palabra} className="conc-glosario__fila">
                <dt>{g.palabra}</dt>
                <dd>{g.texto}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
