"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button, Card } from "@/components/ui/ui";
import { money } from "@/lib/format";
import {
  abribles, armarEstadoResultados, esBloque, TOPE, type FmtMonto, type NodoPyL,
} from "@/lib/estadoResultados";
import type { PyL } from "@/lib/finanzas";
import type { RangoMes } from "@/lib/metricas";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   El estado de resultados, renglón por renglón, y cada renglón se abre
   en lo que lo forma.

   Todo sale de las mismas funciones que calcularPyL: el detalle de
   Ingresos es pagosDelMes y ventasDelMes agrupados por cliente, el de
   comisiones es comisionesDelMes por persona, y así. Por eso los
   subtotales coinciden con el renglón en las dos columnas.

   Los montos van con centavos: comisiones y fees casi nunca son
   redondos, y con el número redondeado la suma del detalle no daba
   igual a la vista aunque diera igual en la cuenta.
   ================================================================== */

export function EstadoResultados({ e, mes, p, hrefGasto, enfoque, onCargarGasto }: {
  e: EstadoApp;
  mes: RangoMes;
  p: PyL;
  /* A dónde lleva un gasto: su ficha en la lista de gastos. */
  hrefGasto: (id: string) => string;
  /* Abre y marca un renglón (el gasto que se acaba de cargar). `marca`
     cambia en cada pedido, así el mismo renglón se puede pedir dos veces. */
  enfoque?: { ruta: string[]; marca: number } | null;
  onCargarGasto?: () => void;
}) {
  const router = useRouter();
  const mon = e.ajustes.monedaBase;
  /* Un −0,00 o un 0,0000001 de la suma en coma flotante se muestra como cero. */
  const M = useCallback<FmtMonto>((n, d = 2) => money(Math.abs(n) < 0.005 ? 0 : n, mon, d), [mon]);

  const items = useMemo(() => armarEstadoResultados(e, mes, p, M, hrefGasto), [e, mes, p, M, hrefGasto]);
  const todos = useMemo(() => abribles(items), [items]);

  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set());
  const [completos, setCompletos] = useState<Set<string>>(() => new Set());
  const [marcado, setMarcado] = useState<string | null>(null);

  const todoAbierto = todos.length > 0 && todos.every((id) => abiertos.has(id));

  const alternar = (id: string, abrir?: boolean) => setAbiertos((prev) => {
    const quiere = abrir ?? !prev.has(id);
    if (quiere === prev.has(id)) return prev;
    const s = new Set(prev);
    if (quiere) s.add(id); else s.delete(id);
    return s;
  });

  /* El gasto recién cargado: se abren sus renglones, se muestra entero el
     de su categoría, y cuando está dibujado se lleva a la vista. */
  useEffect(() => {
    if (!enfoque || enfoque.ruta.length === 0) return;
    const padres = enfoque.ruta.slice(0, -1);
    setAbiertos((prev) => new Set([...prev, ...padres]));
    setCompletos((prev) => new Set([...prev, ...padres]));
    setMarcado(enfoque.ruta[enfoque.ruta.length - 1]);
  }, [enfoque]);

  useEffect(() => {
    if (!marcado) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-renglon="${CSS.escape(marcado)}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    const fin = window.setTimeout(() => setMarcado(null), 2400);
    return () => { window.clearTimeout(t); window.clearTimeout(fin); };
  }, [marcado]);

  /* ---------- Dibujo ---------- */

  const monto = (n: number | null, etiqueta: string, lado: "cc" | "rev", estilo?: NodoPyL["estilo"]) => {
    if (n === null) {
      return <div role="cell" className={`pyl__monto pyl__monto--${lado} pyl__monto--vacio`} data-etiqueta={etiqueta}>—</div>;
    }
    const color = estilo === "neto" ? (n >= 0 ? "var(--success)" : "var(--danger)") : undefined;
    return (
      <div role="cell" className={`pyl__monto pyl__monto--${lado}`} data-etiqueta={etiqueta} style={color ? { color } : undefined}>
        {M(n)}
      </div>
    );
  };

  const nota = (key: string, nivel: number, children: React.ReactNode) => (
    <div role="row" key={key} className="pyl__fila pyl__fila--nota" style={{ ["--nivel" as string]: nivel }}>
      <div role="cell" aria-colspan={3} className="pyl__nota">{children}</div>
    </div>
  );

  function renglon(n: NodoPyL, nivel: number): React.ReactNode {
    const abrible = n.hijos !== undefined;
    const abierto = abrible && abiertos.has(n.id);
    const clases = [
      "pyl__fila",
      nivel > 0 ? "pyl__fila--detalle" : "",
      n.estilo ? `pyl__fila--${n.estilo}` : "",
      abrible ? "pyl__fila--abrible" : n.href ? "pyl__fila--link" : "",
      marcado === n.id ? "pyl__fila--marcada" : "",
    ].filter(Boolean).join(" ");

    const textos = (
      <span className="pyl__textos">
        <span className="pyl__titulo">{n.titulo}</span>
        {n.sub && <span className="pyl__sub">{n.sub}</span>}
      </span>
    );

    /* Toda la fila se puede tocar. El botón de adentro no tiene onClick
       propio: su click (con el mouse o con Enter/Espacio) sube hasta la
       fila, así se alterna una sola vez. */
    const alClick = (ev: React.MouseEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && ev.currentTarget.contains(sel.anchorNode)) return;
      if (abrible) { alternar(n.id); return; }
      if (n.href && !(ev.target as HTMLElement).closest("a")) router.push(n.href);
    };

    const hijos = n.hijos ?? [];
    const verTodos = completos.has(n.id) || hijos.length <= TOPE + 2;
    const visibles = verTodos ? hijos : hijos.slice(0, TOPE);
    const ocultos = verTodos ? [] : hijos.slice(TOPE);
    const suma = (xs: NodoPyL[], k: "cc" | "rev") =>
      xs.some((x) => x[k] !== null) ? xs.reduce((a, x) => a + (x[k] ?? 0), 0) : null;

    return (
      <React.Fragment key={n.id}>
        <div role="row" className={clases} data-renglon={n.id} style={{ ["--nivel" as string]: nivel }} onClick={abrible || n.href ? alClick : undefined}>
          <div role="rowheader" className="pyl__concepto">
            {abrible ? (
              <button
                type="button" className="pyl__linea pyl__toggle" aria-expanded={abierto}
                onKeyDown={(ev) => {
                  if (ev.key === "ArrowRight" && !abierto) { ev.preventDefault(); alternar(n.id, true); }
                  if (ev.key === "ArrowLeft" && abierto) { ev.preventDefault(); alternar(n.id, false); }
                }}
              >
                <ChevronRight size={16} className="pyl__chevron" aria-hidden />
                {textos}
              </button>
            ) : n.href ? (
              <Link href={n.href} className="pyl__linea pyl__link">
                <span className="pyl__hueco" aria-hidden />
                {textos}
              </Link>
            ) : (
              <span className="pyl__linea">
                <span className="pyl__hueco" aria-hidden />
                {textos}
              </span>
            )}
          </div>
          {monto(n.cc, "Cobrado", "cc", n.estilo)}
          {monto(n.rev, "Facturado", "rev", n.estilo)}
        </div>

        {abierto && (
          <>
            {hijos.length === 0 && nota(`${n.id}/vacio`, nivel + 1, (
              <>
                {n.vacio ?? "No hay nada en este período."}
                {onCargarGasto && ["directos", "operativos", "honorarios"].includes(n.id) && (
                  <> <button type="button" className="link" onClick={onCargarGasto}>Cargar un gasto</button></>
                )}
              </>
            ))}
            {visibles.map((h) => renglon(h, nivel + 1))}
            {ocultos.length > 0 && (
              <div
                role="row" className="pyl__fila pyl__fila--detalle pyl__fila--abrible pyl__fila--mas"
                style={{ ["--nivel" as string]: nivel + 1 }}
                onClick={() => {
                  setCompletos((prev) => new Set(prev).add(n.id));
                  /* El botón desaparece: el foco pasa al primer renglón que
                     apareció, para que con el teclado no se pierda el lugar. */
                  const primero = ocultos[0].id;
                  window.requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>(`[data-renglon="${CSS.escape(primero)}"] :is(button, a)`)?.focus();
                  });
                }}
              >
                <div role="rowheader" className="pyl__concepto">
                  <button type="button" className="pyl__linea pyl__toggle">
                    <span className="pyl__hueco" aria-hidden />
                    <span className="pyl__textos"><span className="pyl__titulo">Ver {ocultos.length} más</span></span>
                  </button>
                </div>
                {monto(suma(ocultos, "cc"), "Cobrado", "cc")}
                {monto(suma(ocultos, "rev"), "Facturado", "rev")}
              </div>
            )}
            {n.notas?.map((t, i) => nota(`${n.id}/nota${i}`, nivel + 1, t))}
          </>
        )}
      </React.Fragment>
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div className="pyl-head">
        <div className="pyl-head__texto">
          <h2 className="card-head__title">Estado de resultados — {mes.etiqueta}</h2>
          <p className="card-head__sub">
            Dos columnas porque casi todo se vende en cuotas: una cosa es lo que vendiste y otra la que ya está en la cuenta.
            Tocá un renglón para ver de dónde sale.
          </p>
        </div>
        <Button
          sm variante="ghost"
          icono={todoAbierto ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
          onClick={() => setAbiertos(todoAbierto ? new Set() : new Set(todos))}
        >
          {todoAbierto ? "Contraer todo" : "Expandir todo"}
        </Button>
      </div>

      <div className="pyl" role="table" aria-label={`Estado de resultados — ${mes.etiqueta}`}>
        <div role="rowgroup">
          <div role="row" className="pyl__cabecera">
            <span role="columnheader">Concepto</span>
            <span role="columnheader">Sobre lo cobrado</span>
            <span role="columnheader">Sobre lo facturado</span>
          </div>
        </div>
        <div role="rowgroup">
          {items.map((x) => esBloque(x)
            ? (
              <div role="row" key={x.id} className="pyl__fila pyl__fila--bloque">
                <div role="cell" aria-colspan={3} className="t-label">{x.bloque}</div>
              </div>
            )
            : renglon(x, 0))}
        </div>
      </div>
    </Card>
  );
}
