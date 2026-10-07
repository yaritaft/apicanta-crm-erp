"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Info } from "lucide-react";
import { Modal } from "./Modal";

/* ==================================================================
   El ícono de información de una métrica.

   Angelo (06/10): «cuando hay métricas, siempre me gusta que tengan el ícono
   de información para explicar cómo se calcula, porque uno se confía y puede
   haber error… inclusive un botón de ver cómo se calcula».

   Al pasar el mouse (o con el foco) muestra qué es y cómo se calcula, en una
   frase. Con un clic abre la explicación entera: la cuenta escrita, los
   números del período que se está mirando y, si hace falta, un ejemplo.
   ================================================================== */

export interface ComponenteMetrica {
  concepto: string;
  /* Ya formateado: «US$ 180.000», «12,5%». */
  valor: string;
  /* Cómo entra en la cuenta. «=» es el resultado: va destacado. */
  signo?: "+" | "−" | "×" | "÷" | "=";
  /* Aclaración corta: «12 cobros». */
  nota?: string;
}

/* Una cuenta con más de una columna (el estado de resultados: sobre lo
   cobrado y sobre lo facturado) lleva una sección por cada una. */
export interface SeccionComponentes { titulo: string; filas: ComponenteMetrica[] }

export interface PropsInfoMetrica {
  /* El nombre de la métrica. */
  titulo: string;
  /* Qué es y cómo se calcula, en castellano. */
  ayuda: string;
  /* La cuenta, escrita: «Cash collected − procesadores − comisiones». */
  formula?: string;
  /* Con los números del período que se mira. Se piden recién al abrir. */
  componentes?: () => ComponenteMetrica[] | SeccionComponentes[] | null;
  /* El período de esos números: «este mes», «del 01/09 al 30/09». */
  periodo?: string;
  ejemplo?: string;
  /* Dónde ver los registros que forman el número. */
  href?: string;
  className?: string;
}

export function InfoMetrica({ titulo, ayuda, formula, componentes, periodo, ejemplo, href, className }: PropsInfoMetrica) {
  const boton = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  /* Los números se piden al abrir y quedan fijos mientras la ventana está
     abierta: no se recalculan en cada dibujo. */
  const [abierto, setAbierto] = useState<SeccionComponentes[] | null>(null);

  const mostrar = () => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    /* Centrado debajo del ícono, sin salirse de la pantalla. */
    const x = Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150);
    setTip({ x, y: r.bottom + 8 });
  };
  const abrir = () => {
    const pedidos = componentes?.() ?? null;
    setAbierto(!pedidos || pedidos.length === 0 ? []
      : "filas" in pedidos[0] ? (pedidos as SeccionComponentes[]) : [{ titulo: "Con tus números", filas: pedidos as ComponenteMetrica[] }]);
  };

  return (
    <>
      <button
        ref={boton} type="button" className={`info-metrica${className ? ` ${className}` : ""}`}
        aria-label={`Cómo se calcula «${titulo}»`} aria-haspopup="dialog"
        onMouseEnter={mostrar} onMouseLeave={() => setTip(null)} onFocus={mostrar} onBlur={() => setTip(null)}
        onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setTip(null); abrir(); }}
      >
        <Info size={13} aria-hidden />
      </button>
      {tip && createPortal(
        <div className="info-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <span>{ayuda}</span>
          <span className="info-tip__pie">Clic para ver cómo se calcula</span>
        </div>,
        document.body,
      )}
      {abierto && (
        <Modal abierto onCerrar={() => setAbierto(null)} titulo={titulo} sub={periodo ? `Con los números de ${periodo}` : "Cómo se calcula"}>
          <div className="info-cuerpo">
            <p className="info-ayuda">{ayuda}</p>
            {formula && (
              <section className="info-bloque">
                <h4 className="info-titulo">Cómo se calcula</h4>
                <pre className="info-formula">{formula}</pre>
              </section>
            )}
            {abierto.map((sec) => (
              <section key={sec.titulo} className="info-bloque">
                <h4 className="info-titulo">{sec.titulo}</h4>
                <dl className="info-componentes">
                  {sec.filas.map((x, i) => (
                    <div key={i} className={`info-fila${x.signo === "=" ? " info-fila--total" : ""}`}>
                      <dt>
                        <span className="info-signo" aria-hidden>{x.signo}</span>
                        <span className="info-concepto">
                          {x.concepto}
                          {x.nota && <span className="t-sm t-subtle"> · {x.nota}</span>}
                        </span>
                      </dt>
                      <dd className="t-num">{x.valor}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            {ejemplo && (
              <section className="info-bloque">
                <h4 className="info-titulo">Ejemplo</h4>
                <p className="info-ejemplo">{ejemplo}</p>
              </section>
            )}
            {href && (
              <Link href={href} className="link t-sm" onClick={() => setAbierto(null)}>Ver el detalle</Link>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
