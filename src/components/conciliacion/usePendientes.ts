"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import {
  ErrorConciliacion, hayNube, pedirCandidatos, pedirEstadoDelCruce, pedirUnidos, type EstadoDelCruceLeido,
} from "@/lib/conciliacion-nube";
import {
  contactosDelMes, marcadosDelMes, pendientesDelMes, resumirPendientes, type DatosPendientes, type Pendiente, type ResumenPendientes,
} from "@/lib/pendientes-conciliar";
import type { RegistroForm } from "@/lib/registros-webinar";

/* ==================================================================
   Los pendientes de conciliar de un mes, listos para mostrar: arma las
   personas con lo que la app ya tiene cargado (agenda, ventas, contactos),
   le pregunta al servidor cuáles ya tienen un formulario unido y, de las que
   no, trae los formularios que se parecen. Lo que se resuelve a mano
   (unir, descartar, marcar) se saca de la lista al instante, sin volver a
   pedir todo. Lo usan Finanzas (un paso del mes) y Marketing (su pestaña).
   ================================================================== */

export type EstadoCarga = "cargando" | "listo" | "error" | "sin-nube" | "sin-permiso";

export interface DatosDePendientes {
  mes: string;
  carga: EstadoCarga;
  error: string;
  puedeEditar: boolean;
  pendientes: Pendiente[];
  marcados: Pendiente[];
  resumen: ResumenPendientes;
  /** Los formularios sin unir que se parecen a alguien de la lista. */
  registros: RegistroForm[];
  cruce: EstadoDelCruceLeido | null;
  /** Vuelve a preguntarle todo al servidor (después de que el proceso automático unió algo, por ejemplo). */
  recargar: () => void;
  /** Saca a una persona de la lista porque se le unió un formulario. */
  uniDo: (contactoId: string, registroId: string) => void;
  /** Saca un formulario de las propuestas (se unió a otra persona o se descartó). */
  quitarRegistro: (registroId: string) => void;
}

const VACIO: ResumenPendientes = { total: 0, conVenta: 0, soloAgenda: 0, montos: {} };

export function usePendientesDelMes(mes: string, activo = true): DatosDePendientes {
  const e = useEstado();
  const { acceso } = useAcceso();
  const nivel = Math.max(nivelEn(acceso, "finanzas"), nivelEn(acceso, "marketing"), nivelEn(acceso, "webinars"));
  const datos: DatosPendientes = useMemo(
    () => ({ contactos: e.contactos, sesiones: e.sesiones, leads: e.leads, ventas: e.ventas }),
    [e.contactos, e.sesiones, e.leads, e.ventas],
  );

  /* Quiénes del mes ya tienen un formulario unido: se le pregunta al servidor, una vez por mes (y al recargar). */
  const idsDelMes = useMemo(() => contactosDelMes(datos, mes), [datos, mes]);
  const claveIds = idsDelMes.join("|");
  const [leido, setLeido] = useState<{ mes: string; unidos: Set<string> } | null>(null);
  /* Al cambiar de mes se espera lo suyo; si sólo cambian los datos de la app, se sigue mostrando lo que hay mientras se vuelve a preguntar. */
  const unidos = leido?.mes === mes ? leido.unidos : null;
  const [registros, setRegistros] = useState<RegistroForm[]>([]);
  const [cruce, setCruce] = useState<EstadoDelCruceLeido | null>(null);
  const [error, setError] = useState("");
  const [vuelta, setVuelta] = useState(0);
  const pedido = useRef(0);

  const sinNube = !hayNube;
  const sinPermiso = nivel < 1;
  useEffect(() => {
    if (!activo || sinNube || sinPermiso) return;
    const mio = ++pedido.current;
    setError("");
    (async () => {
      try {
        const [u, c] = await Promise.all([pedirUnidos(idsDelMes), pedirEstadoDelCruce().catch(() => null)]);
        if (mio !== pedido.current) return;
        const r = await pedirCandidatos(pendientesDelMes(datos, mes, u));
        if (mio !== pedido.current) return;
        setRegistros(r);
        setCruce(c);
        setLeido({ mes, unidos: u });
      } catch (x) {
        if (mio !== pedido.current) return;
        setError(x instanceof ErrorConciliacion ? x.message : "No pude consultar los formularios.");
      }
    })();
    // Los datos de la app cambian seguido (cada edición): se vuelve a pedir sólo si cambia el mes, las personas del mes o se pide recargar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, sinNube, sinPermiso, mes, claveIds, vuelta]);

  const pendientes = useMemo(() => (unidos ? pendientesDelMes(datos, mes, unidos) : []), [datos, mes, unidos]);
  const marcados = useMemo(() => marcadosDelMes(datos, mes), [datos, mes]);
  const resumen = useMemo(() => (unidos ? resumirPendientes(pendientes) : VACIO), [pendientes, unidos]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);
  const uniDo = useCallback((contactoId: string, registroId: string) => {
    setLeido((l) => (l ? { ...l, unidos: new Set([...l.unidos, contactoId]) } : l));
    setRegistros((rs) => rs.filter((r) => r.id !== registroId));
  }, []);
  const quitarRegistro = useCallback((registroId: string) => setRegistros((rs) => rs.filter((r) => r.id !== registroId)), []);

  const carga: EstadoCarga = sinNube ? "sin-nube" : sinPermiso ? "sin-permiso" : error ? "error" : unidos ? "listo" : "cargando";
  return { mes, carga, error, puedeEditar: nivel >= 2, pendientes, marcados, resumen, registros, cruce, recargar, uniDo, quitarRegistro };
}
