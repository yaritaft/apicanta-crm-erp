"use client";

import React, { useState } from "react";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { esDelCloser } from "@/lib/eod";
import { esDeTestimonio, faltaDeLaLlamada, DIAS_PARA_CERRAR_RESELL, type FilaResell } from "@/lib/clientes-cs";
import { fechaLarga } from "@/lib/format";
import type { EstadoApp, MiembroEquipo } from "@/lib/types";
import { CerrarLlamada } from "./CerrarLlamada";

/* ==================================================================
   «Llamadas para cerrar» en Mi panel (Lili, 24/10): las de resell y las de
   testimonio que ya pasaron y no dicen cómo salieron. Quedan acá hasta que
   se cargan (lib/mi-panel.ts, llamadasParaCerrar): las ve quien la tomó,
   las de Yari también Manu, y el director comercial todas.
   ================================================================== */

const DIA = 86_400_000;

export function LlamadasParaCerrar({ e, miembro, llamadas, viendoOtro }: {
  e: EstadoApp; miembro: MiembroEquipo; llamadas: FilaResell[]; viendoOtro: boolean;
}) {
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const [cerrando, setCerrando] = useState<FilaResell | null>(null);
  if (llamadas.length === 0) return null;
  const puede = !viendoOtro && puedeEditar(acceso, "resells");
  const ahora = Date.now();
  return (
    <section className="mp-card mp-llamadas" aria-label="Llamadas para cerrar">
      <div className="mp-cap-fila"><span className="mp-cap"><PhoneCall size={14} aria-hidden /> Llamadas para cerrar</span><span className="mp-cuenta">{llamadas.length}</span></div>
      <span className="mp-nota" style={{ marginTop: 2 }}>Resells y testimonios que ya pasaron: quedan acá hasta que cargues cómo salieron. A los {DIAS_PARA_CERRAR_RESELL} días, en rojo.</span>
      <ul className="mp-llamadas__lista">
        {llamadas.map((f) => {
          const r = f.resell;
          const vieja = ahora - Date.parse(r.fechaHora) >= DIAS_PARA_CERRAR_RESELL * DIA;
          const ajena = !esDelCloser({ anfitrion: r.closer }, miembro.nombre, e.equipo);
          const falta = faltaDeLaLlamada(r);
          return (
            <li key={f.id} className={`mp-llamada${vieja ? " mp-llamada--roja" : ""}`}>
              <div className="mp-llamada__quien">
                {f.alumno
                  ? <button type="button" className="link t-strong" onClick={() => abrirFicha(f.alumno!.id, "servicio", { hoja: "testimonio" })}>{f.alumno.nombre}</button>
                  : <span className="t-strong">{r.nombre || "Sin nombre"}</span>}
                <span className={`hs-chip${esDeTestimonio(r) ? " hs-chip--ok" : ""}`}>{esDeTestimonio(r) ? "Testimonio" : "Resell"}</span>
                <span className="t-sm t-subtle">{fechaLarga(r.fechaHora)}{ajena && r.closer ? ` · con ${r.closer}` : ""}</span>
              </div>
              <span className="t-sm mp-llamada__falta">Falta: {falta.join(", ")}.</span>
              {puede && <Button sm variante={vieja ? "primary" : "secondary"} onClick={() => setCerrando(f)}>Cerrar</Button>}
            </li>
          );
        })}
      </ul>
      {cerrando && <CerrarLlamada fila={cerrando} onCerrar={() => setCerrando(null)} onListo={() => setCerrando(null)} />}
    </section>
  );
}
