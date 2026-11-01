"use client";

import { PartesDeUnTotal } from "@/components/finanzas/visual/visual";
import "@/components/cs/cs.css";
import React, { useMemo } from "react";
import { CheckCheck, Clock, PhoneCall, PhoneMissed, UserX } from "lucide-react";
import { Badge, Button, Card, Empty } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { CopiarLink } from "@/components/ui/Filtros";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useTablaURL } from "@/lib/useParamsURL";
import {
  aContactarHoy, aplicarCadencia, aplicarContacto, aplicarCorreccion, aplicarDejoDeContestar, aplicarNoContesto,
  configSeguimiento, filasDeSeguimiento, formatoDia, hoyDelNegocio, textoDeAtraso,
  type FilaSeguimiento, type SituacionSeguimiento,
} from "@/lib/seguimiento";
import type { Alumno, ConfigSeguimiento, ID, SeguimientoAlumno } from "@/lib/types";

/* ==================================================================
   Customer Success: «A contactar hoy» (F2-09).

   Sólo a quienes ya les toca el contacto, lo más vencido arriba, con «Lo
   contacté» y «No contestó» a un clic (y «Deshacer» por si fue sin querer).
   La lista general, con todas las columnas de Lili, está en Clientes
   (components/cs/ClientesCs). Los gestos —los de acá y los de las filas de
   Clientes— son los mismos (lib/seguimiento.ts).
   ================================================================== */

/* ---------- los gestos, para las dos vistas ---------- */

/* Lo que un gesto necesita de la fila: el alumno. Las de «A contactar hoy» y las de Clientes lo tienen. */
export type FilaDeGesto = { id: ID; alumno: Alumno };

export function useGestos() {
  const toast = useToast();
  const hoy = hoyDelNegocio();

  /* Una acción que cambia el seguimiento y ofrece deshacerla. */
  function hacer(f: FilaDeGesto, cambio: (s: SeguimientoAlumno, quien: string) => SeguimientoAlumno,
    detalle: (s: SeguimientoAlumno) => string, aviso: (s: SeguimientoAlumno) => string) {
    let despues: SeguimientoAlumno | null = null;
    const antes = acciones.guardarSeguimiento(f.id, (s, quien) => (despues = cambio(s, quien)), (s) => detalle(s));
    if (!antes || !despues) return;
    toast(aviso(despues), "ok", {
      texto: "Deshacer",
      onClick: () => acciones.restaurarSeguimiento(antes, `Se deshizo el último cambio del seguimiento de ${f.alumno.nombre}.`),
    });
  }

  return {
    contacte: (f: FilaDeGesto) => hacer(
      f, (s, q) => aplicarContacto(s, hoy, q),
      (s) => `Se lo contactó. Próximo contacto: ${formatoDia(s.proximoContacto)} (cada ${s.cadenciaDias} días).`,
      (s) => `Listo: contactaste a ${f.alumno.nombre}. Le toca de nuevo el ${formatoDia(s.proximoContacto)}.`,
    ),
    noContesto: (f: FilaDeGesto, cfg: ConfigSeguimiento) => hacer(
      f, (s, q) => aplicarNoContesto(s, hoy, cfg, q),
      (s) => `No contestó (intento ${s.intentosSinRespuesta}). Se vuelve a probar el ${formatoDia(s.proximoContacto)}.`,
      (s) => `${f.alumno.nombre} no contestó. Se vuelve a probar el ${formatoDia(s.proximoContacto)}.`,
    ),
    dejoDeContestar: (f: FilaDeGesto, dejo: boolean) => hacer(
      f, (s, q) => aplicarDejoDeContestar(s, dejo, q),
      () => (dejo ? "Se lo marcó como «dejó de contestar»." : "Se lo sacó de «dejó de contestar»."),
      () => (dejo ? `${f.alumno.nombre} sale de la lista de hoy: dejó de contestar.` : `${f.alumno.nombre} vuelve al seguimiento.`),
    ),
    cadencia: (f: FilaDeGesto, dias: number, cfg: ConfigSeguimiento) => hacer(
      f, (s, q) => aplicarCadencia(s, dias, f.alumno, q, undefined, cfg.contarDesde),
      (s) => `Cadencia: cada ${dias} días. Próximo contacto: ${formatoDia(s.proximoContacto)}.`,
      (s) => `${f.alumno.nombre}: cada ${dias} días. Le toca el ${formatoDia(s.proximoContacto)}.`,
    ),
    correccion: (f: FilaDeGesto, que: "cv" | "linkedin", corregido: boolean) => hacer(
      f, (s, q) => aplicarCorreccion(s, que, corregido, hoy, q),
      () => `${que === "cv" ? "CV" : "LinkedIn"} ${corregido ? "corregido" : "marcado como pendiente"}.`,
      () => `${f.alumno.nombre}: ${que === "cv" ? "CV" : "LinkedIn"} ${corregido ? "corregido" : "pendiente"}.`,
    ),
  };
}

/* Un control adentro de una fila que se abre con un clic: que usarlo no abra la ficha. */
function Quieto({ children }: { children: React.ReactNode }) {
  return (
    <span className="cs-quieto" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
      {children}
    </span>
  );
}

const SITUACION: Record<SituacionSeguimiento, { texto: string; ayuda: string }> = {
  vencido: { texto: "Vencidos", ayuda: "Ya pasó el día en que les tocaba el contacto" },
  hoy: { texto: "Hoy", ayuda: "Les toca el contacto hoy" },
  "al-dia": { texto: "Al día", ayuda: "Todavía no les toca" },
  "no-contesta": { texto: "Dejaron de contestar", ayuda: "Los marcaste como «dejó de contestar»: no entran en la lista de hoy" },
  reserva: { texto: "Reservas", ayuda: "Sólo pagaron la reserva: el seguimiento arranca cuando paguen lo que falta" },
  fuera: { texto: "Fuera del programa", ayuda: "Pausados, egresados o dados de baja" },
};

/* Cómo se calcula el próximo contacto: lo muestra el ícono de la columna. */
const INFO_PROXIMO = {
  ayuda: "El día en que le toca el próximo contacto. Después de cada «Lo contacté», es hoy más la cadencia del alumno (7, 15 o 20 días). Si «no contestó», se vuelve a probar a los pocos días. Si nunca se lo contactó, se cuenta desde que entró al programa.",
  formula: "Último contacto (o día de ingreso) + cadencia en días",
  ejemplo: "Lo contactaste el 1 de octubre y su cadencia es de 15 días: le toca el 16 de octubre.",
};

function BadgeToca({ f }: { f: FilaSeguimiento }) {
  if (f.situacion === "fuera") return <span className="t-sm t-subtle">—</span>;
  if (f.situacion === "reserva") return <Badge variante="neutral">Reserva · todavía no arrancó</Badge>;
  if (f.situacion === "no-contesta") return <Badge variante="neutral" icono={<UserX size={13} />}>Dejó de contestar</Badge>;
  const variante = f.situacion === "vencido" ? (f.atraso >= 7 ? "danger" : "warning") : f.situacion === "hoy" ? "info" : "success";
  return <Badge variante={variante} icono={<Clock size={13} />}>{textoDeAtraso(f.atraso)}</Badge>;
}

/* ---------- A contactar hoy ---------- */

export function ContactarHoy() {
  const e = useEstado();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const gestos = useGestos();
  const puede = puedeEditar(acceso, "seguimiento_alumnos");
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const filas = useMemo(() => filasDeSeguimiento(e, hoy), [e, hoy]);
  const lista = useMemo(() => aContactarHoy(filas), [filas]);
  const vencidos = lista.filter((f) => f.situacion === "vencido").length;
  const tabla = useTablaURL("hoy", null, ["alumno", "toca", "ultimo"]);

  const columnas: Columna<FilaSeguimiento>[] = [
    {
      clave: "alumno", titulo: "Alumno", tipo: "primary", orden: (f) => f.alumno.nombre,
      celda: (f) => (
        <span className="stack-1">
          <span className="t-strong">{f.alumno.nombre}</span>
          <span className="t-sm t-subtle">{[f.pais, f.tecnologias].filter(Boolean).join(" · ") || f.alumno.email || "Sin datos de la persona"}</span>
        </span>
      ),
    },
    {
      clave: "toca", titulo: "Le tocaba", orden: (f) => -f.atraso, info: INFO_PROXIMO,
      celda: (f) => (
        <span className="row" style={{ gap: 8 }}>
          <BadgeToca f={f} />
          <span className="t-sm t-subtle t-num">{formatoDia(f.proximoContacto)}</span>
        </span>
      ),
    },
    {
      clave: "ultimo", titulo: "Último contacto", orden: (f) => f.ultimoContacto ?? "",
      celda: (f) => (
        <span className="t-num" title={`Se lo contacta cada ${f.cadenciaDias} días`}>
          {f.ultimoContacto ? formatoDia(f.ultimoContacto) : "Nunca"}
        </span>
      ),
    },
    {
      clave: "intentos", titulo: "Sin respuesta",
      celda: (f) => f.intentosSinRespuesta === 0
        ? <span className="t-subtle">—</span>
        : <Badge variante={f.sugerirDejoDeContestar ? "danger" : "warning"}>{f.intentosSinRespuesta} {f.intentosSinRespuesta === 1 ? "intento" : "intentos"}</Badge>,
      info: {
        ayuda: "Cuántas veces seguidas intentaste contactarlo y no contestó. Se pone en cero cuando lo contactás. Con el máximo de intentos (se ajusta) se sugiere marcarlo como «dejó de contestar».",
        formula: `Intentos sin respuesta desde el último contacto logrado (se sugiere con ${cfg.intentosHastaDejar})`,
      },
    },
  ];

  return (
    <div className="stack-4">
      {lista.length === 0 ? (
        <div className="fz-todo-bien"><CheckCheck size={16} aria-hidden />Hoy no hay a quién contactar: todos están al día con su cadencia.</div>
      ) : (
      <section className="fz-hero fz-hero--bajo cs-resumen" aria-label="A quién contactar hoy">
        <div>
          <span className="fz-hero__etiqueta">
            Para contactar
              <InfoMetrica
                className="info-inline"
                titulo="A quién contactar hoy"
                ayuda="Los alumnos activos a los que ya les toca el contacto de seguimiento, según su cadencia. Los que dejaron de contestar no aparecen. Lo más vencido va arriba."
                formula="Alumnos activos cuyo próximo contacto es hoy o ya pasó"
                componentes={() => [
                  { concepto: "Vencidos", valor: String(vencidos), signo: "+", nota: "ya pasó su día" },
                  { concepto: "Les toca hoy", valor: String(lista.length - vencidos), signo: "+" },
                  { concepto: "Para contactar", valor: String(lista.length), signo: "=" },
                ]}
              />
          </span>
          <div className="cs-resumen__cifra">
            <span className="fz-semana__valor">{lista.length}</span>
            {(vencidos === 0 || vencidos === lista.length) && <span className="fz-hero__sub">{vencidos === 0 ? (lista.length === 1 ? "le toca hoy" : "les toca hoy") : (lista.length === 1 ? "vencido" : "vencidos")}</span>}
          </div>
        </div>
        <div className="fz-hero__der cs-resumen__fila">
          {/* La barra sólo si hay dos cosas para comparar. */}
          {vencidos > 0 && vencidos < lista.length ? (
            <PartesDeUnTotal
              etiqueta="Para contactar"
              partes={[
                { id: "vencidos", nombre: "Vencidos", valor: vencidos, texto: String(vencidos), tono: "alerta" as const },
                { id: "hoy", nombre: "Les toca hoy", valor: lista.length - vencidos, texto: String(lista.length - vencidos) },
              ]}
            />
          ) : <span style={{ flex: 1 }} />}
          <CopiarLink variante="ghost" />
        </div>
      </section>
      )}

      {lista.length > 0 && <Card className="cs-tabla cs-t" style={{ padding: 0, overflow: "hidden" }}>
        <DataTable
          filas={lista} columnas={columnas} alto={640} porPagina={50}
          orden={tabla.orden} onOrden={tabla.onOrden} pagina={tabla.pagina} onPagina={tabla.onPagina}
          onFila={(f) => abrirFicha(f.id, "servicio", { hoja: "seguimiento" })} etiquetaFila={(f) => `Ver la ficha de ${f.alumno.nombre}`}
          acciones={puede ? (f) => (
            <span className="row" style={{ gap: 6 }}>
              {/* Una sola acción fuerte por pantalla: el que sigue en la lista. */}
              <Button sm variante={f.id === lista[0]?.id ? "primary" : "secondary"} icono={<PhoneCall size={14} />} onClick={() => gestos.contacte(f)} title="Lo contacté hoy: el próximo toca según su cadencia">
                Lo contacté
              </Button>
              <Button sm variante="ghost" icono={<PhoneMissed size={14} />} onClick={() => gestos.noContesto(f, cfg)} title="Lo intenté y no contestó: se vuelve a probar en unos días">
                No contestó
              </Button>
              {f.sugerirDejoDeContestar && (
                <Button sm variante="ghost" icono={<UserX size={14} />} onClick={() => gestos.dejoDeContestar(f, true)} title={`Ya van ${f.intentosSinRespuesta} intentos sin respuesta`}>
                  Dejó de contestar
                </Button>
              )}
            </span>
          ) : undefined}
          vacio={<Empty icono={<CheckCheck size={22} />} titulo="Al día" texto="Hoy no hay alumnos para contactar." />}
        />
      </Card>}
    </div>
  );
}
