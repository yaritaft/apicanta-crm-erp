"use client";

import { useRouter } from "next/navigation";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { esCuentaDeCloser } from "@/lib/permisos";

/* Cargar venta: entrada propia del closer. Abre el asistente de venta de
   siempre (el closer queda elegido solo, por su correo en Equipo); al
   guardar o salir, vuelve a «Mis llamadas» (quien no es closer, a Ventas). */
export default function CargarVenta() {
  const router = useRouter();
  const toast = useToast();
  const { acceso } = useAcceso();
  const volver = esCuentaDeCloser(acceso) ? "/mis-llamadas" : "/ventas";
  return (
    <AsistenteVenta
      onCerrar={() => router.push(volver)}
      onListo={(_id, nombre) => { toast(`Venta de ${nombre} cargada: ya es cliente.`); router.push(volver); }}
    />
  );
}
