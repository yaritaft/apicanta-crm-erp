"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Users, Columns3, Wallet, Settings } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/ui";
import { acciones, useEstado } from "@/lib/store";

const PASOS = [
  {
    icono: Compass,
    titulo: "Bienvenido a Apicanta",
    texto: "Acá vive todo Hackear IT: la gente interesada, las sesiones, los webinars, los alumnos, la plata que entra y la que sale. Está cargado con datos de ejemplo para que lo pruebes sin miedo — después lo vaciás en un clic.",
  },
  {
    icono: Users,
    titulo: "Todo empieza por un lead",
    texto: "Un lead es alguien que mostró interés. Lo cargás en Leads, lo vas moviendo por el Pipeline mientras avanza la conversación, y cuando compra lo convertís en alumno con un botón.",
  },
  {
    icono: Columns3,
    titulo: "El Pipeline es un tablero",
    texto: "Arrastrá las tarjetas de una columna a la otra, igual que un pizarrón. Cada columna te muestra cuánta plata hay en esa etapa. No hay que guardar nada: se guarda solo.",
  },
  {
    icono: Wallet,
    titulo: "Los números se calculan solos",
    texto: "Panel, Marketing y Finanzas leen los mismos datos que vos cargás. Si sumás un lead o cobrás una cuota, los gráficos se actualizan al instante. En Metas ponés tus objetivos del mes y ves cuánto falta.",
  },
  {
    icono: Settings,
    titulo: "Todo se puede cambiar",
    texto: "En Ajustes cambiás las etapas del pipeline, las fuentes, las categorías de plata, los planes — y podés agregar campos propios a cualquier ficha. También conectás Meta y Calendly. Nada está fijo.",
  },
];

export function Tour() {
  const e = useEstado();
  const router = useRouter();
  const [paso, setPaso] = useState(0);
  const [montado, setMontado] = useState(false);

  useEffect(() => { setMontado(true); }, []);

  const abierto = montado && !e.ajustes.tourVisto;
  if (!abierto) return null;

  const p = PASOS[paso];
  const Ico = p.icono;
  const ultimo = paso === PASOS.length - 1;

  function cerrar() { acciones.ajustesSilencioso({ tourVisto: true }); }

  return (
    <Modal
      abierto onCerrar={cerrar} titulo=""
      pie={
        <>
          <Button variante="ghost" onClick={cerrar}>Saltear</Button>
          <span className="spacer" />
          <span className="t-sm t-subtle t-num" style={{ marginRight: 8 }}>{paso + 1} de {PASOS.length}</span>
          {paso > 0 && <Button variante="secondary" onClick={() => setPaso((x) => x - 1)}>Atrás</Button>}
          <Button
            variante="primary"
            onClick={() => { if (ultimo) { cerrar(); router.push("/panel"); } else setPaso((x) => x + 1); }}
          >
            {ultimo ? "Empezar" : "Siguiente"}
          </Button>
        </>
      }
    >
      <div style={{ textAlign: "center", padding: "8px 8px 0" }}>
        <span style={{ display: "grid", placeItems: "center", width: 56, height: 56, borderRadius: 999, background: "var(--brand-soft)", color: "var(--brand)", margin: "0 auto 16px" }}>
          <Ico size={26} />
        </span>
        <h2 className="t-h2" style={{ marginBottom: 8 }}>{p.titulo}</h2>
        <p className="t-body t-muted" style={{ maxWidth: "46ch", margin: "0 auto" }}>{p.texto}</p>
        <div className="row" style={{ justifyContent: "center", gap: 6, marginTop: 24 }}>
          {PASOS.map((_, i) => (
            <span key={i} style={{
              width: i === paso ? 20 : 6, height: 6, borderRadius: 999,
              background: i === paso ? "var(--accent)" : "var(--surface-300)",
              transition: "all 200ms ease-out",
            }} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
