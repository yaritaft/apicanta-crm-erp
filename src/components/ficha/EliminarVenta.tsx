"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { ModalForm } from "@/components/ui/Modal";
import { Field, Textarea } from "@/components/ui/ui";
import { Opcion } from "@/components/ui/Asistente";
import { useToast } from "@/components/ui/Toast";
import { leerContratos } from "@/components/contratos/cliente";
import { acciones } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { MOTIVOS_DE_ELIMINAR_VENTA, motivoCompleto, textoDeMotivo } from "@/lib/motivos";
import { cobradoDeVenta, quienDeLaVenta, ventaParaDejar, ventasIdenticas } from "@/lib/ventas-repetidas";
import type { Contrato } from "@/lib/contratos";
import type { EstadoApp, Venta } from "@/lib/types";

/* ==================================================================
   Eliminar una venta (Aldana, 24/10).

   Cancelar una venta conserva lo cobrado (es plata que existe), así que una venta cargada dos veces y cancelada seguía
   sumando: «Pagó todo US$ 6.000» por una compra de US$ 3.000. Eliminar la saca de verdad, con sus cuotas y sus cobros.
   Sólo Finanzas y los dueños (el closer no borra: supabase/ventas-sin-baja-del-closer). Antes de confirmar dice qué se
   lleva puesto, y no deja si hay una devolución o un contrato que el cliente ya recibió.
   ================================================================== */

export function EliminarVenta({ e, venta, onCerrar }: { e: EstadoApp; venta: Venta; onCerrar: () => void }) {
  const toast = useToast();
  const [elegida, setElegida] = useState("");
  const [detalle, setDetalle] = useState("");
  /* Los contratos no viven en el estado de la app: se leen de la base. null = todavía leyendo. */
  const [contratos, setContratos] = useState<Contrato[] | null>(null);

  useEffect(() => {
    let vivo = true;
    leerContratos({ ventaId: venta.id })
      .then((r) => { if (vivo) setContratos(r.contratos); })
      .catch(() => { if (vivo) setContratos([]); });
    return () => { vivo = false; };
  }, [venta.id]);

  const M = (n: number) => money(n, venta.moneda, Number.isInteger(n) ? 0 : 2);
  const producto = e.productos.find((x) => x.id === venta.productoId)?.nombre ?? "la venta";
  const cuotas = e.cuotas.filter((c) => c.ventaId === venta.id);
  const idsCuotas = new Set(cuotas.map((c) => c.id));
  const pagos = e.pagos.filter((p) => idsCuotas.has(p.cuotaId));
  const conciliados = pagos.filter((p) => p.movimientoId);
  const cobrado = cobradoDeVenta(e, venta.id);
  const alumno = e.alumnos.find((a) => a.ventaId === venta.id);

  /* La otra venta que es la misma compra: si se elimina por repetida, el cobro de la pasarela pasa a ella. */
  const iguales = ventasIdenticas(
    e, { quien: quienDeLaVenta(e, venta), productoId: venta.productoId, precioAcordado: venta.precioAcordado, fecha: venta.fecha },
    { ignorar: venta.id },
  );
  const otra = iguales.length ? ventaParaDejar(e, iguales) : undefined;

  const devoluciones = (e.devoluciones ?? []).filter((d) => d.ventaId === venta.id && d.estado !== "ignorada");
  const contratosVivos = (contratos ?? []).filter((c) => ["enviado", "visto", "firmado"].includes(c.estado));
  const bloqueos = [
    ...(devoluciones.length ? [`Tiene ${devoluciones.length === 1 ? "una devolución cargada" : `${devoluciones.length} devoluciones cargadas`}: si la plata se devolvió, marcala como reembolsada en vez de eliminarla.`] : []),
    ...(contratosVivos.length ? [`Tiene un contrato ${contratosVivos[0].estado === "firmado" ? "firmado" : "mandado al cliente"}: anulalo primero, o dejá la venta cancelada.`] : []),
  ];

  const opcion = MOTIVOS_DE_ELIMINAR_VENTA.find((o) => o.id === elegida);
  const completo = motivoCompleto(opcion, detalle);
  const reatarA = elegida === "repetida" ? otra : undefined;

  /* Lo que pasa, dicho antes de confirmar. */
  const efectos: string[] = [
    `Se borra la venta de ${venta.contactoNombre} (${producto}, ${M(venta.precioAcordado)}) con ${cuotas.length === 1 ? "su cuota" : `sus ${cuotas.length} cuotas`}.`,
    pagos.length === 0
      ? "No tiene cobros cargados."
      : `${pagos.length === 1 ? "Se borra su cobro" : `Se borran sus ${pagos.length} cobros`} (${M(cobrado)}): esa plata deja de contar como cobrada.`,
  ];
  if (conciliados.length) {
    efectos.push(reatarA
      ? `${conciliados.length === 1 ? "El pago de la pasarela" : "Los pagos de la pasarela"} no se pierde${conciliados.length === 1 ? "" : "n"}: se pasa${conciliados.length === 1 ? "" : "n"} a la venta del ${fechaLarga(reatarA.fecha)}, que ya tiene ese cobro.`
      : `${conciliados.length === 1 ? "El pago de la pasarela vuelve" : "Los pagos de la pasarela vuelven"} a Conciliación, para atarlos a la venta que corresponda.`);
  }
  if (alumno) {
    efectos.push(reatarA ? `El servicio de ${alumno.nombre} sigue con la otra venta.` : `El servicio de ${alumno.nombre} pasa a baja.`);
  }
  if (cobrado > 0.01 && elegida && elegida !== "repetida") {
    efectos.push("Si el cliente sí pagó y la plata se devolvió, no la elimines: cargá la devolución.");
  }
  efectos.push("Queda anotado en Actividad con el motivo y se guarda una copia. No se puede reactivar: si dudás, usá «Cancelar venta».");

  const eliminar = () => {
    if (!opcion || !completo || bloqueos.length) return;
    const r = acciones.eliminarVenta(venta.id, textoDeMotivo(opcion, detalle), { reatarA: reatarA?.id });
    if (!r.ok) { toast(r.error, "err"); return; }
    toast(r.reatados ? "Venta eliminada. El cobro de la pasarela quedó en la otra venta." : "Venta eliminada.");
    onCerrar();
  };

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={`¿Eliminar la venta de ${venta.contactoNombre}?`}
      sub={`${producto} · ${M(venta.precioAcordado)} · ${fechaLarga(venta.fecha)}`}
      guardarTexto="Eliminar la venta" puedeGuardar={completo && contratos !== null && bloqueos.length === 0} onGuardar={eliminar}
    >
      {bloqueos.length > 0 && (
        <div className="aviso-duplicado" role="alert">
          {bloqueos.map((b) => (
            <div className="aviso-duplicado__fila" key={b}>
              <AlertTriangle size={16} aria-hidden />
              <span className="aviso-duplicado__texto">{b}</span>
            </div>
          ))}
        </div>
      )}

      <div className="opciones opciones--lista" role="group" aria-label="Motivo">
        {MOTIVOS_DE_ELIMINAR_VENTA.map((o) => (
          <Opcion
            key={o.id} nombre={o.texto} activo={elegida === o.id} onClick={() => setElegida(o.id)}
            sub={o.id === "repetida" && otra ? `Es la misma compra que la venta del ${fechaLarga(otra.fecha)}: queda esa.` : o.ayuda}
          />
        ))}
      </div>
      {opcion?.pideDetalle && (
        <Field label={opcion.pideDetalle === "obligatorio" ? "Contá el motivo" : "Algo más (opcional)"}>
          <Textarea
            rows={2} value={detalle} onChange={(ev) => setDetalle(ev.target.value)} aria-label="Detalle del motivo"
            placeholder={opcion.pideDetalle === "obligatorio" ? "Por ejemplo: la cargó Dante pero el cliente se arrepintió" : "Por ejemplo: la cargaron Valentín y Finanzas"}
          />
        </Field>
      )}

      <div className="devol-efecto" role="note">
        <Info size={16} aria-hidden />
        <div>
          <div className="t-strong">Qué pasa al eliminarla</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, listStyle: "disc", display: "grid", gap: 2 }}>
            {efectos.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      </div>
    </ModalForm>
  );
}
