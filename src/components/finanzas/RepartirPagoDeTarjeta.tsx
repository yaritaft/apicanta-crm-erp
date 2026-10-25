"use client";

import React, { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { ModalForm } from "@/components/ui/Modal";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId } from "@/lib/store";
import { categoriasDisponibles, escribirMonto, leerMonto, sugerirCategoria } from "@/lib/gastos";
import { fechaLarga, money } from "@/lib/format";
import { CATEGORIA_SIN_REVISAR, faltaRepartir, leerCompras, problemaDelReparto, sumaDeCompras, type CompraDeTarjeta } from "@/lib/reparto-tarjeta";
import type { EstadoApp, Gasto } from "@/lib/types";
import "./reparto-tarjeta.css";

/* ==================================================================
   Repartir el pago de la tarjeta en sus compras (Aldana, 24/10).

   El banco sólo avisa el pago diario de la tarjeta de crédito; las compras no las muestra. Acá se dice qué fue cada una y de qué categoría es —la
   mayoría, honorarios del CEO— y tienen que sumar exacto lo que se pagó. Se pueden escribir una por una o pegar el detalle de la tarjeta del banco.
   ================================================================== */

interface Linea { id: string; concepto: string; montoTxt: string; categoria: string; tocada?: boolean }
const nueva = (extra: Partial<Linea> = {}): Linea => ({ id: nuevoId("lin"), concepto: "", montoTxt: "", categoria: "", ...extra });

export function RepartirPagoDeTarjeta({ e, gasto, onCerrar, onListo }: { e: EstadoApp; gasto: Gasto; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const base = e.ajustes.monedaBase;
  const M = (n: number) => money(n, base, 2);
  const [lineas, setLineas] = useState<Linea[]>([nueva()]);
  const [pegado, setPegado] = useState("");
  const [avisoPegado, setAvisoPegado] = useState("");
  const categorias = useMemo(() => categoriasDisponibles(e).filter((c) => c.grupo !== "retiro").map((c) => ({ valor: c.categoria, texto: c.categoria })), [e]);

  const compras: CompraDeTarjeta[] = lineas.map((l) => ({ concepto: l.concepto, monto: l.montoTxt.trim() ? leerMonto(l.montoTxt) : 0, categoria: l.categoria }));
  const total = gasto.monto;
  const falta = faltaRepartir(total, compras);
  const problema = problemaDelReparto(total, compras);
  const cambiar = (id: string, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios } : l)));

  function armarDeLoPegado() {
    const leidas = leerCompras(pegado, e);
    if (leidas.length === 0) { setAvisoPegado("No encontré compras en lo que pegaste: cada línea tiene que traer el nombre y el monto."); return; }
    const nuevas = leidas.map((c) => nueva({ concepto: c.concepto, montoTxt: escribirMonto(c.monto), categoria: c.categoria }));
    setLineas((ls) => [...ls.filter((l) => l.concepto.trim() || l.montoTxt.trim()), ...nuevas]);
    setPegado("");
    setAvisoPegado(`Armé ${leidas.length === 1 ? "1 compra" : `${leidas.length} compras`}: revisá la categoría de cada una.`);
  }

  function repartir() {
    if (problema) return;
    const r = acciones.repartirPagoDeTarjeta(gasto.id, compras);
    if (!r.ok) { toast(r.error, "err"); return; }
    toast(`Pago repartido en ${r.ids.length === 1 ? "1 compra" : `${r.ids.length} compras`}.`);
    onListo();
  }

  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={repartir} guardarTexto="Repartir el pago" puedeGuardar={!problema}
      titulo="Repartir el pago de la tarjeta" sub={`${M(total)} · pagado el ${fechaLarga(gasto.fechaPago ?? gasto.fecha)}`}
    >
      <p className="t-sm t-subtle" style={{ margin: 0 }}>
        El banco sólo avisa lo que se pagó de la tarjeta, no cada compra. Decí qué fue cada una y de qué categoría es: tienen que sumar justo {M(total)}.
        El día, la cuenta y la referencia del banco quedan igual, así que la caja no cambia: cambia dónde cae cada compra en el estado de resultados.
      </p>

      <div className="reparto" role="group" aria-label="Compras de la tarjeta">
        <div className="reparto__fila reparto__fila--cabeza" aria-hidden><span>Qué fue</span><span>Monto</span><span>Categoría</span><span /></div>
        {lineas.map((l, i) => (
          <div className="reparto__fila" key={l.id}>
            <Input
              aria-label={`Qué fue la compra ${i + 1}`} placeholder="Zoom, honorarios de Yari…" value={l.concepto} autoFocus={i === lineas.length - 1 && !l.concepto && lineas.length > 1}
              onChange={(ev) => {
                /* Mientras nadie eligió la categoría a mano, la app propone la que corresponde a lo que se escribe. */
                const concepto = ev.target.value;
                const sugerida = l.tocada ? undefined : sugerirCategoria(concepto, e)?.categoria;
                cambiar(l.id, { concepto, ...(sugerida ? { categoria: sugerida } : {}) });
              }}
            />
            <InputMonto aria-label={`Monto de la compra ${i + 1}`} placeholder="0" value={l.montoTxt} onChange={(ev) => cambiar(l.id, { montoTxt: ev.target.value })} />
            <Select
              aria-label={`Categoría de la compra ${i + 1}`} placeholder="Elegí la categoría" opciones={categorias} value={l.categoria}
              error={l.categoria === CATEGORIA_SIN_REVISAR}
              onChange={(ev) => cambiar(l.id, { categoria: ev.target.value, tocada: true })}
            />
            <IconButton etiqueta={`Quitar la compra ${i + 1}`} onClick={() => setLineas((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [nueva()]))}><X size={15} /></IconButton>
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Button sm variante="secondary" icono={<Plus size={14} />} onClick={() => setLineas((ls) => [...ls, nueva(falta > 0.009 ? { montoTxt: escribirMonto(falta) } : {})])}>
            Agregar compra{falta > 0.009 ? ` por lo que falta (${M(falta)})` : ""}
          </Button>
        </div>
      </div>

      <details className="reparto__pegar">
        <summary>Pegar el detalle de la tarjeta</summary>
        <Field label="Una compra por línea, o las filas del CSV de la tarjeta (Mercury → tarjeta → exportar)">
          <Textarea
            rows={4} value={pegado} onChange={(ev) => { setPegado(ev.target.value); setAvisoPegado(""); }} aria-label="Detalle pegado de la tarjeta"
            placeholder={"Zoom 15,99\nHonorarios Yari 2.000\nMeta Ads 196,63"}
          />
        </Field>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <Button sm variante="secondary" disabled={!pegado.trim()} onClick={armarDeLoPegado}>Armar las compras</Button>
          {avisoPegado && <span className="t-sm t-subtle" role="status">{avisoPegado}</span>}
        </div>
      </details>

      <div className="reparto__total" data-estado={!problema ? "da" : falta < -0.009 ? "sobra" : "falta"} role="status">
        <span>Repartido <strong className="t-num">{M(sumaDeCompras(compras))}</strong> de <strong className="t-num">{M(total)}</strong></span>
        {!problema
          ? <span className="reparto__ok"><Check size={15} aria-hidden /> Da justo</span>
          : <span className="t-sm">{problema}</span>}
      </div>
    </ModalForm>
  );
}
