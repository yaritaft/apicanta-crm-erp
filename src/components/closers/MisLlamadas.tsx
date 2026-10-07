"use client";

import React from "react";
import Link from "next/link";
import { ClipboardCheck, PhoneCall, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useEstado, useSync } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { avisoDeCuenta, resumenDelDia } from "@/lib/cuenta-closer";
import { esDelCloser } from "@/lib/eod";
import type { FilaTabla } from "@/lib/crm-tabla";
import "./closers.css";

/* ==================================================================
   «Mis llamadas»: lo primero que ve un closer. Dice cuántas llamadas tiene
   hoy y cuántas faltan cargar, y lleva a «Cerrar el día». Y si entra y no
   ve nada porque su cuenta no está bien armada (su correo no está en
   Equipo, o Calendly no tiene llamadas a su nombre), lo dice con todas las
   letras en vez de dejar la pantalla vacía.
   ================================================================== */

const pl = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

export function AvisoMisLlamadas({ filas, hoy }: {
  /* Todas las llamadas que ve (las de un closer ya vienen recortadas por la base). */
  filas: FilaTabla[];
  hoy: string;
}) {
  const e = useEstado();
  const sync = useSync();
  const yo = useUsuarioActual();
  const { acceso } = useAcceso();
  const soloLoSuyo = Boolean(acceso?.soloLoSuyo);

  /* Un closer ve sólo lo suyo; quien ve todo y atiende llamadas, las que le tocan. */
  const mias = soloLoSuyo ? filas : yo.miembro ? filas.filter((f) => esDelCloser(f.sesion, yo.miembro!.nombre, e.equipo)) : filas;
  const dia = resumenDelDia(mias, hoy);

  const aviso = avisoDeCuenta({
    soloLoSuyo, email: yo.email, miembro: yo.miembro, llamadasVisibles: e.sesiones.length,
    cargado: sync.estado === "listo" || sync.estado === "guardando",
  });

  if (aviso) {
    return (
      <div className="mis-ll mis-ll--atencion" role="alert">
        <TriangleAlert size={20} aria-hidden className="mis-ll__ico" />
        <div className="mis-ll__texto">
          <span className="mis-ll__titulo">
            {aviso.tipo === "sin-miembro" ? "No encontramos tu usuario en Equipo" : "Todavía no hay llamadas a tu nombre"}
          </span>
          <span className="mis-ll__sub">
            {aviso.tipo === "sin-miembro"
              ? `Entraste con ${aviso.email}, pero ese correo no está cargado en tu ficha de Equipo: por eso no ves tus llamadas. Pedile a un dueño que lo cargue (Equipo → Accesos).`
              : `Si ya te agendaron en Calendly y no aparecen, avisale a Santi o a un dueño: en Calendly tenés que figurar como «${aviso.nombre}», igual que en Equipo.`}
          </span>
        </div>
      </div>
    );
  }

  const pendientes = dia.sinCargarHoy + dia.sinCargarAntes;
  return (
    <div className="mis-ll">
      <PhoneCall size={20} aria-hidden className="mis-ll__ico" />
      <div className="mis-ll__texto">
        <span className="mis-ll__titulo">
          {dia.hoy === 0 ? "Hoy no tenés llamadas" : `Hoy tenés ${pl(dia.hoy, "llamada", "llamadas")}`}
        </span>
        <span className="mis-ll__sub">
          {pendientes === 0
            ? dia.hoy === 0 ? "Cuando te agenden una, aparece acá." : "Todo al día: cada llamada que ya pasó tiene cómo terminó."
            : [
              dia.sinCargarHoy > 0 && `${pl(dia.sinCargarHoy, "ya pasó", "ya pasaron")} y falta cargar cómo ${dia.sinCargarHoy === 1 ? "terminó" : "terminaron"}`,
              dia.sinCargarAntes > 0 && `${pl(dia.sinCargarAntes, "llamada", "llamadas")} de días anteriores sin cargar`,
            ].filter(Boolean).join(" · ")}
        </span>
      </div>
      <Link href="/cerrar-el-dia" className="mis-ll__accion">
        <Button variante="primary" icono={<ClipboardCheck size={16} />}>Cerrar el día</Button>
      </Link>
    </div>
  );
}
