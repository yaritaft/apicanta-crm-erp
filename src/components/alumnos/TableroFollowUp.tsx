"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button, Card, Empty, Input } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { PartesDeUnTotal, Segmentado } from "@/components/finanzas/visual/visual";
import { ETAPAS_DEL_ALUMNO, type EtapaAlumnoId, type FilaCartera } from "@/lib/panel-servicio";
import { formatoDia } from "@/lib/seguimiento";
import { num } from "@/lib/format";
import "@/components/mi-panel/panel-servicio.css";

/* ==================================================================
   El pipeline de verdad: cada alumno en la etapa que dice su Follow Up, el dato que
   Lili ya lleva al día. Se lee, no se arrastra: para cambiar a alguien de etapa se
   cambia su Follow Up en la ficha. Arriba de todo, cuánta gente hay en cada una;
   adentro, primero a quien más se le pasó el contacto.
   ================================================================== */

const POR_COLUMNA = 25;
const POR_TANDA = 60;
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const urgencia = (a: FilaCartera, b: FilaCartera) => (b.proximo ? b.atraso : -1e6) - (a.proximo ? a.atraso : -1e6) || b.inicio.localeCompare(a.inicio);

function Tarjeta({ f, hoy, onAbrir }: { f: FilaCartera; hoy: string; onAbrir: (id: string) => void }) {
  const vencido = f.proximo && f.atraso > 0;
  return (
    <button type="button" className="tf-card" onClick={() => onAbrir(f.id)} aria-label={`Ver la ficha de ${f.nombre}`} title={f.programa || undefined}>
      <span className="tf-card__nombre">{f.nombre}</span>
      <span className="tf-card__linea">
        <span className={`ps-follow ps-follow--${f.etapa}`}>{f.followUp || "Sin follow up"}</span>
        {vencido && <span className="tf-card__atraso t-num">{f.atraso === 1 ? "Venció ayer" : `Venció hace ${f.atraso} d`}</span>}
      </span>
      <span className="tf-card__pie truncate t-num">
        {f.ultimoContacto ? `Contacto ${formatoDia(f.ultimoContacto, hoy)}` : "Sin contacto"}
      </span>
    </button>
  );
}

export function TableroFollowUp({ cartera, hoy, q, setQ, base, setBase, etapa, setEtapa, onAbrir, cambio, botones }: {
  cartera: FilaCartera[]; hoy: string;
  q: string; setQ: (t: string) => void;
  /* «En servicio» deja afuera a los que ya cerraron (outboarding, caso de éxito) o se les terminó el contrato. */
  base: "servicio" | "todos"; setBase: (b: "servicio" | "todos") => void;
  etapa?: EtapaAlumnoId; setEtapa: (x: EtapaAlumnoId | null) => void;
  onAbrir: (id: string) => void;
  cambio: React.ReactNode; botones: React.ReactNode;
}) {
  const [cuantos, setCuantos] = useState(POR_TANDA);
  const deLaBase = useMemo(() => (base === "servicio" ? cartera.filter((f) => f.enServicio) : cartera), [cartera, base]);
  const filas = useMemo(() => {
    const t = sinTildes(q.trim());
    return t ? deLaBase.filter((f) => [f.nombre, f.email, f.programa, f.followUp].some((x) => sinTildes(x).includes(t))) : deLaBase;
  }, [deLaBase, q]);
  const columnas = useMemo(() => ETAPAS_DEL_ALUMNO
    .map((x) => ({ ...x, filas: filas.filter((f) => f.etapa === x.id).sort(urgencia) }))
    .filter((c) => c.filas.length > 0), [filas]);
  const elegida = etapa ? columnas.find((c) => c.id === etapa) : undefined;

  return (
    <div className="stack-4">
      <section className="fz-hero fz-hero--bajo cs-resumen" aria-label="Alumnos por etapa">
        <div>
          <span className="fz-hero__etiqueta">
            {base === "servicio" ? "En servicio" : "Todos los alumnos"}
            <InfoMetrica titulo="Por etapa" ayuda="La etapa sale del Follow Up de cada alumno. Tocá una para ver sólo esa." />
          </span>
          <div className="cs-resumen__cifra">
            <span className="fz-semana__valor">{num(filas.length)}</span>
            {base === "servicio" && <span className="fz-hero__sub">de {num(cartera.length)} en total</span>}
          </div>
        </div>
        <div className="fz-hero__der">
          <PartesDeUnTotal
            etiqueta="Alumnos por etapa" activo={elegida?.id}
            partes={columnas.map((c) => ({
              id: c.id, nombre: c.label, valor: c.filas.length, texto: num(c.filas.length), ayuda: c.ayuda,
              tono: c.riesgo ? "alerta" as const : c.id === "exito" ? "bien" as const : c.id === "outboarding" || c.id === "sin" ? "apagado" as const : undefined,
            }))}
            onElegir={(id) => { setCuantos(POR_TANDA); setEtapa(elegida?.id === id ? null : (id as EtapaAlumnoId)); }}
          />
        </div>
      </section>

      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Input icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar alumno" aria-label="Buscar alumnos" />
        <Segmentado etiqueta="Qué alumnos ver" valor={base} onCambiar={(v) => setBase(v as "servicio" | "todos")} opciones={[{ valor: "servicio", texto: "En servicio" }, { valor: "todos", texto: "Todos" }]} />
        <span className="toolbar__fin">{cambio}{botones}</span>
      </div>

      {filas.length === 0 ? (
        <Card><Empty icono={<Search size={22} />} titulo="Ningún alumno coincide" texto="Probá con otro texto." accion={q ? <Button variante="secondary" onClick={() => setQ("")}>Limpiar la búsqueda</Button> : undefined} /></Card>
      ) : elegida ? (
        <section aria-label={elegida.label} className="stack-3">
          <div className="tf-cabeza">
            <h2 className="tf-cabeza__titulo">{elegida.label}</h2>
            <span className="t-sm t-subtle">{elegida.ayuda}</span>
            <Button sm variante="ghost" onClick={() => setEtapa(null)}>Ver todas las etapas</Button>
          </div>
          <div className="tf-grilla">
            {elegida.filas.slice(0, cuantos).map((f) => <Tarjeta key={f.id} f={f} hoy={hoy} onAbrir={onAbrir} />)}
          </div>
          {elegida.filas.length > cuantos && (
            <Button variante="secondary" onClick={() => setCuantos((n) => n + POR_TANDA)}>Ver más ({num(elegida.filas.length - cuantos)})</Button>
          )}
        </section>
      ) : (
        <div className="tf-tablero">
          {columnas.map((c) => (
            <section key={c.id} className="tf-col" aria-label={`${c.label}: ${c.filas.length}`}>
              <div className="tf-col__cabeza" title={c.ayuda}>
                <h2 className="tf-col__titulo">{c.label}</h2>
                <span className="tf-col__n t-num">{num(c.filas.length)}</span>
              </div>
              <div className="tf-col__cuerpo">
                {c.filas.slice(0, POR_COLUMNA).map((f) => <Tarjeta key={f.id} f={f} hoy={hoy} onAbrir={onAbrir} />)}
                {c.filas.length > POR_COLUMNA && (
                  <button type="button" className="tf-col__mas" onClick={() => setEtapa(c.id)}>Ver los {num(c.filas.length)}</button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* Elegir entre el tablero que se lee solo y el de las etapas a mano. */
export function CambioDeTablero({ valor, onCambiar }: { valor: "follow" | "mano"; onCambiar: (v: "follow" | "mano") => void }) {
  return (
    <Segmentado
      etiqueta="Qué tablero ver" valor={valor} onCambiar={(v) => onCambiar(v as "follow" | "mano")}
      opciones={[{ valor: "follow", texto: "Por Follow Up" }, { valor: "mano", texto: "Etapas a mano" }]}
    />
  );
}
