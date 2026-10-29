"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Badge, Select } from "@/components/ui/ui";
import { Telefono } from "@/components/ui/Telefono";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { acciones } from "@/lib/store";
import { fecha, money } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { haceCuanto } from "@/lib/hace-cuanto";
import {
  cuotasQuePagaronVencidas, ESTADOS_SEGUIMIENTO, textoDeSeguimiento, tonoDeSeguimiento, vencidasConSeguimiento, type FilaDeCobranza,
} from "@/lib/cobranza-seguimiento";
import type { EstadoApp, EstadoSeguimientoCobro, MiembroEquipo } from "@/lib/types";

/* ==================================================================
   «Cuotas vencidas» en Mi panel (Aldana, 28/10): los closers ven las cuotas
   atrasadas de sus clientes con el teléfono a mano y marcan cómo va el
   cobro (contactado, no responde, pido la baja por falta de pago). Finanzas
   lo ve en su tabla. Cuando el cliente paga, la cuota queda un día más como
   «Pagó» y después sale de la lista.
   ================================================================== */

const POR_DEFECTO = 8;
const OPCIONES = [{ valor: "", texto: "Sin marcar" }, ...ESTADOS_SEGUIMIENTO.map((x) => ({ valor: x.id as string, texto: x.texto }))];
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function CuotasVencidas({ e, miembro, viendoOtro, ahora }: { e: EstadoApp; miembro: MiembroEquipo; viendoOtro: boolean; ahora: number }) {
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const [todas, setTodas] = useState(false);
  const vencidas = useMemo(() => vencidasConSeguimiento(e, miembro.id, ahora), [e, miembro.id, ahora]);
  const pagaron = useMemo(() => cuotasQuePagaronVencidas(e, miembro.id, ahora), [e, miembro.id, ahora]);
  if (vencidas.length === 0 && pagaron.length === 0) return null;

  const puede = !viendoOtro && puedeEditar(acceso, "cuotas");
  const debe = vencidas.reduce((a, f) => a + f.vencida.saldo, 0);
  const sinMarcar = vencidas.filter((f) => !f.cuota.seguimientoCobro).length;
  const visibles = todas ? vencidas : vencidas.slice(0, POR_DEFECTO);
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";

  return (
    <section className="mp-card mp-cobranza" aria-label="Cuotas vencidas">
      <div className="mp-cap-fila">
        <span className="mp-cap"><AlertTriangle size={14} aria-hidden /> Cuotas vencidas</span>
        <span className="mp-cuenta">{vencidas.length}</span>
      </div>
      <span className="mp-nota" style={{ marginTop: 2 }}>
        {vencidas.length > 0
          ? `${viendoOtro ? "Deben" : "Te deben"} ${money(debe, "USD", 0)}${sinMarcar > 0 ? ` · ${sinMarcar} sin marcar cómo va el cobro` : " · todas con seguimiento"}. `
          : ""}
        Marcá cómo va cada una: lo ve Finanzas. Cuando pagan, quedan un día como «Pagó».
      </span>

      <ul className="mp-cobranza__lista">
        {pagaron.map((f) => (
          <li key={`p|${f.cuota.id}`} className="mp-cobranza__fila mp-cobranza__fila--pago">
            <div className="mp-cobranza__quien">
              <Check size={15} aria-hidden style={{ color: "var(--success)" }} />
              <button type="button" className="link t-strong" onClick={() => abrirFicha(f.venta.id, "ventas", { venta: f.venta.id })}>{f.venta.contactoNombre}</button>
              <Badge variante="success">Pagó</Badge>
              <span className="t-sm t-subtle">
                {f.cuota.esReserva ? "Reserva" : `Cuota ${f.cuota.numero}`} · {productoDe(f.venta.productoId)} · el {diaMes(diaDeNegocio(f.cobradoEn))}, con {f.diasTarde} {f.diasTarde === 1 ? "día" : "días"} de atraso
              </span>
              {f.cuota.seguimientoCobro && <span className="t-sm t-subtle">· antes: {textoDeSeguimiento(f.cuota.seguimientoCobro.estado).toLowerCase()}</span>}
            </div>
          </li>
        ))}
        {visibles.map((f) => <FilaVencida key={f.cuota.id} f={f} puede={puede} producto={productoDe(f.venta.productoId)} ahora={ahora} />)}
      </ul>
      {vencidas.length > POR_DEFECTO && (
        <button type="button" className="link t-sm" onClick={() => setTodas((x) => !x)}>
          {todas ? "Ver menos" : `Ver las ${vencidas.length} cuotas vencidas`}
        </button>
      )}
    </section>
  );
}

function FilaVencida({ f, puede, producto, ahora }: { f: FilaDeCobranza; puede: boolean; producto: string; ahora: number }) {
  const abrirFicha = useAbrirFicha();
  const seg = f.cuota.seguimientoCobro;
  const v = f.vencida;
  return (
    <li className={`mp-cobranza__fila${v.diasAtraso >= 15 ? " mp-cobranza__fila--roja" : ""}`}>
      <div className="mp-cobranza__quien">
        <button type="button" className="link t-strong" onClick={() => abrirFicha(f.venta.id, "ventas", { venta: f.venta.id })}>{f.venta.contactoNombre}</button>
        <span className="t-sm t-subtle">{f.cuota.esReserva ? "Reserva" : `Cuota ${f.cuota.numero}`} · {producto} · vencía el {fecha(f.cuota.vence!)}</span>
        <Badge variante={v.diasAtraso >= 15 ? "danger" : v.diasAtraso >= 7 ? "warning" : "accent"}>{v.diasAtraso} {v.diasAtraso === 1 ? "día" : "días"}</Badge>
        <span className="mp-cobranza__monto t-num t-strong">{money(v.saldo, "USD", 0)}</span>
      </div>
      <div className="mp-cobranza__acciones">
        <Telefono valor={f.telefono} pais={f.pais} vacio="Sin teléfono cargado" />
        {puede ? (
          <>
            <div className="mp-cobranza__estado">
              <Select
                aria-label={`Cómo va el cobro de ${f.venta.contactoNombre}`}
                value={seg?.estado ?? ""} opciones={OPCIONES}
                onChange={(ev) => acciones.seguirCobro(f.cuota.id, (ev.target.value || null) as EstadoSeguimientoCobro | null, seg?.nota)}
              />
            </div>
            {seg && (
              <input
                key={`${f.cuota.id}|${seg.en}`} className="mp-cobranza__nota" defaultValue={seg.nota ?? ""} maxLength={160}
                placeholder="Nota (opcional): qué dijo, cuándo paga…" aria-label="Nota sobre el cobro"
                onBlur={(ev) => { if (ev.target.value.trim() !== (seg.nota ?? "")) acciones.seguirCobro(f.cuota.id, seg.estado, ev.target.value); }}
              />
            )}
          </>
        ) : seg ? <Badge variante={tonoDeSeguimiento(seg.estado) === "danger" ? "danger" : tonoDeSeguimiento(seg.estado) === "warning" ? "warning" : "info"}>{textoDeSeguimiento(seg.estado)}</Badge> : <span className="t-sm t-subtle">Sin marcar</span>}
      </div>
      {seg && <span className="t-sm t-subtle mp-cobranza__marca">Marcado por {seg.por} {haceCuanto(Math.max(0, ahora - Date.parse(seg.en)) / 3_600_000)}{seg.nota && !puede ? ` · ${seg.nota}` : ""}</span>}
    </li>
  );
}
