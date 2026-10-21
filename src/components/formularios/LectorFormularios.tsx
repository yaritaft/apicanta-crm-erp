"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Check, Copy, Download, MessageCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useEstadoDelLector } from "@/components/webinars/EstadoLector";
import { useAcceso } from "@/lib/acceso";
import { fecha, num, pct } from "@/lib/format";
import { bajarCsv } from "@/lib/csv";
import { csvParaManyChat } from "@/lib/grupos-whatsapp";
import type { RegistroForm } from "@/lib/registros-webinar";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { useEstado } from "@/lib/store";
import {
  duracionTexto, filtrarPorLector, listaParaCopiar, puedeVerWhatsapp, resumenDeRegistros, unionesDeRegistros, type FiltroDeLector, type ResumenDeRegistros, type UnionDePersona,
} from "@/lib/whatsapp";
import { useGrupoDeWebinar } from "@/lib/whatsapp-cliente";
import "@/components/webinars/whatsapp.css";

/* ==================================================================
   Formularios + el lector de WhatsApp.

   La hoja de Formularios tiene las marcas «Unido» y «No unido» que el equipo
   pone a mano. Si el webinar tiene un grupo de WhatsApp atado, el lector
   (servicios/whatsapp-lector) sabe quién está adentro, y acá se cruza con el
   teléfono de cada registro:

   - cada fila muestra si el lector la ve «En el grupo» o «No está»;
   - arriba, «N de M se unieron» y filtros por eso;
   - «Marcar como unidos» pasa a la marca de la hoja a todos los que el lector
     ve adentro (de a uno se puede deshacer con otro clic);
   - se copian de una vez los teléfonos de los que faltan.

   No cambia ninguna marca por su cuenta: el equipo manda.
   ================================================================== */

export type FiltroLector = FiltroDeLector;
export const FILTROS_LECTOR: FiltroLector[] = ["", "dentro", "fuera", "sin-telefono"];

export interface LectorDeFormularios {
  /** Quien mira ve los Webinars y el webinar elegido es uno de la app. */
  aplica: boolean;
  hayLector: boolean;
  /** El webinar tiene al menos un grupo atado. */
  hayGrupo: boolean;
  /** Para cada registro, lo que dice el lector (sólo con grupo atado). */
  union: (r: RegistroForm) => UnionDePersona | undefined;
  /** Lo mismo, entero: cambia de identidad cuando cambia lo que dice el lector. */
  uniones: Map<string, UnionDePersona>;
  /** Los registros que cumplen el filtro. */
  filtrar: (rs: RegistroForm[], filtro: FiltroLector) => RegistroForm[];
  /** La insignia de una fila, para la celda del grupo. */
  insignia: (r: RegistroForm) => React.ReactNode;
  resumen: ResumenDeRegistros;
  webinar?: { id: string; titulo: string; fecha: string };
  estado: ReturnType<typeof useEstadoDelLector>;
  grupo: ReturnType<typeof useGrupoDeWebinar>;
}

/** Cruza los registros del webinar elegido (su día, aaaa-mm-dd) con el grupo de WhatsApp atado a ese webinar. */
export function useLectorDeFormularios(dia: string, registros: readonly RegistroForm[]): LectorDeFormularios {
  const e = useEstado();
  const { acceso } = useAcceso();
  const ve = puedeVerWhatsapp(acceso);
  const webinar = useMemo(
    () => (dia && dia !== "todos" && dia !== "sin" ? e.webinars.find((w) => diaArgentina(w.fecha) === dia) : undefined),
    [e.webinars, dia],
  );
  const estado = useEstadoDelLector(ve);
  const grupo = useGrupoDeWebinar(ve && webinar ? webinar.id : null);
  const datos = grupo.datos;
  const hayGrupo = Boolean(ve && webinar && datos && datos.tablas && datos.grupos.length > 0);

  const uniones = useMemo(
    () => (hayGrupo && datos ? unionesDeRegistros(registros, datos.dentro, datos.salieron) : new Map<string, UnionDePersona>()),
    [hayGrupo, datos, registros],
  );
  const resumen = useMemo(() => resumenDeRegistros(registros, uniones), [registros, uniones]);
  const union = (r: RegistroForm) => uniones.get(r.id);
  const filtrar = (rs: RegistroForm[], filtro: FiltroLector) => (hayGrupo ? filtrarPorLector(rs, filtro, uniones) : rs);

  const insignia = (r: RegistroForm): React.ReactNode => {
    const u = uniones.get(r.id);
    if (!u || u.estado === "sin-telefono") return null;
    if (u.estado === "unida") {
      return (
        <span className="wa-lector-insignia" title="El lector de WhatsApp ve este teléfono adentro del grupo.">
          <Badge variante="success" icono={<Check size={12} aria-hidden />}>En el grupo</Badge>
        </span>
      );
    }
    const yaMarcado = r.grupo === "unido";
    return (
      <span
        className="wa-lector-insignia"
        title={yaMarcado
          ? "El equipo lo marcó unido, pero el lector no lo ve en el grupo: puede haber salido o haber entrado con otro número."
          : u.salio ? `El lector no lo ve en el grupo: salió el ${fecha(u.salio)}.` : "El lector no ve este teléfono en el grupo."}
      >
        <Badge variante="warning">{u.salio ? "Salió" : "No está"}</Badge>
      </span>
    );
  };

  return {
    aplica: ve && Boolean(webinar), hayLector: estado.hayLector, hayGrupo, union, uniones, filtrar, insignia, resumen,
    webinar: webinar ? { id: webinar.id, titulo: webinar.titulo, fecha: webinar.fecha } : undefined,
    estado, grupo,
  };
}

/* ---------- El panel de WhatsApp, arriba de la tabla ---------- */

/** El estado de la conexión en una frase que se entienda, y si hay que avisar que lo de abajo puede estar atrasado. */
function textoDeConexion(e: ReturnType<typeof useEstadoDelLector>["estado"]): { pastilla: string; aviso: string | null } {
  if (e.tipo === "conectado") return { pastilla: "Conectado", aviso: null };
  if (e.tipo === "caido" || e.tipo === "sin-senal") {
    const hace = e.minutos !== null ? duracionTexto(e.minutos) : "un rato";
    return {
      pastilla: `Sin conexión hace ${hace}`,
      aviso: e.tipo === "caido"
        ? `No llegan datos de WhatsApp desde hace ${hace}: lo que ves puede estar desactualizado. Se corrige solo cuando vuelva la conexión.`
        : `Falta alguna actualización de WhatsApp (hace ${hace}). Puede ser un corte corto: si sigue, te avisamos.`,
    };
  }
  return { pastilla: e.titulo, aviso: e.detalle };
}

export function BarraDelLector({ lector, registros, visibles, filtro, onFiltro, puedeEditar, onMarcarUnidos, onCopiar }: {
  lector: LectorDeFormularios;
  /** Todos los registros del webinar. */
  registros: RegistroForm[];
  /** Los que se ven con los filtros puestos. */
  visibles: RegistroForm[];
  filtro: FiltroLector;
  onFiltro: (f: FiltroLector) => void;
  puedeEditar: boolean;
  onMarcarUnidos: (ids: string[]) => void | Promise<void>;
  onCopiar: (texto: string, aviso: string) => void;
}) {
  const toast = useToast();
  if (!lector.aplica || !lector.hayLector || lector.grupo.sinAcceso) return null;

  const { resumen: r, webinar } = lector;
  const estado = lector.estado.estado;
  const grupos = lector.grupo.datos?.grupos ?? [];

  /* El webinar todavía no tiene su grupo: se dice dónde atarlo, en una línea. */
  if (!lector.hayGrupo) {
    if (!lector.grupo.datos) return null;
    return (
      <p className="t-sm t-subtle wa-panel-linea">
        <MessageCircle size={14} aria-hidden /> Este webinar todavía no tiene un grupo de WhatsApp atado.{" "}
        {webinar && (puedeEditar
          ? <Link href={`/webinars/${encodeURIComponent(webinar.id)}`} className="link">Atarlo en la ficha del webinar</Link>
          : "Lo ata quien edita los Webinars: avisale a un dueño.")}
      </p>
    );
  }

  const faltan = visibles.filter((x) => lector.union(x)?.estado === "no-unida" && lector.union(x)?.numero);
  const porMarcar = registros.filter((x) => lector.union(x)?.estado === "unida" && x.grupo !== "unido");
  const marcadosAMano = registros.filter((x) => x.grupo === "unido").length;
  const nombreDe = (x: RegistroForm) => x.nombre || x.email;
  const filas = (xs: RegistroForm[]) => xs.map((x) => {
    const u = lector.union(x)!;
    return { nombre: nombreDe(x), numero: u.numero, completo: u.completo };
  });
  const conexion = textoDeConexion(estado);
  const alternar = (f: FiltroLector) => onFiltro(filtro === f ? "" : f);
  const pctDentro = r.conTelefono > 0 ? (r.dentro / r.conTelefono) * 100 : 0;

  function bajarParaManyChat() {
    const { texto, sinTelefono } = csvParaManyChat(faltan);
    bajarCsv(`manychat-no-entraron-${webinar?.fecha ? diaArgentina(webinar.fecha) : "webinar"}`, texto);
    toast(`Se bajó el CSV con ${num(faltan.length)} ${faltan.length === 1 ? "contacto" : "contactos"} que todavía no entraron al grupo${sinTelefono ? ` (${num(sinTelefono)} sin teléfono que se entienda)` : ""}.`);
  }

  return (
    <Card className="wa-panel">
      <div className="wa-panel__cabeza">
        <div className="wa-panel__titulo">
          <span className="wa-panel__icono" aria-hidden><MessageCircle size={18} /></span>
          <div className="wa-panel__textos">
            <h3 className="wa-panel__h">
              Grupo de WhatsApp
              <InfoMetrica
                titulo="Quién entró al grupo"
                ayuda="Un número de WhatsApp conectado a la app (el «lector») mira los grupos de este webinar y compara quién está adentro con los teléfonos de las personas que se anotaron. Sirve para ver quién ya entró y a quién todavía hay que escribirle. No marca nada por su cuenta: la columna «Grupo de WhatsApp» de la tabla la marca el equipo, y desde acá se pueden marcar de una vez los que ya entraron."
                formula={"Anotados con teléfono que están en el grupo\n÷ Anotados con teléfono"}
                componentes={() => [
                  { concepto: "Se anotaron", valor: num(r.total) },
                  { concepto: "Sin teléfono", valor: num(r.sinTelefono), signo: "−", nota: "no se pueden revisar" },
                  { concepto: "Con teléfono", valor: num(r.conTelefono), signo: "=" },
                  { concepto: "Ya están en el grupo", valor: num(r.dentro) },
                  { concepto: "Porcentaje", valor: r.conTelefono > 0 ? pct(pctDentro, 1) : "—", signo: "=" },
                ]}
                ejemplo="Los teléfonos se comparan sin importar cómo los escribió cada uno: «011 15 5555-1234» y «+54 9 11 5555-1234» son el mismo. Quien entró con otro número, o lo tiene oculto, aparece como que todavía no entró."
              />
            </h3>
            <p className="wa-panel__grupos">{grupos.map((g) => `${g.nombre || "Grupo"} (${num(g.miembros)})`).join(" · ")}</p>
          </div>
        </div>
        <span className={`wa-panel__conexion wa-panel__conexion--${estado.tono}`}>
          <span className="wa-panel__punto" aria-hidden />{conexion.pastilla}
        </span>
      </div>

      {conexion.aviso && <p className="wa-panel__aviso" role="status">{conexion.aviso}</p>}

      {/* Los números son los filtros: un clic en uno deja en la tabla sólo a esas personas, otro clic lo saca. */}
      <div className="wa-panel__cifras" role="group" aria-label="Según WhatsApp">
        <button type="button" className="wa-cifra wa-cifra--ok" aria-pressed={filtro === "dentro"} onClick={() => alternar("dentro")} title="Ver sólo a los que están en el grupo">
          <span className="wa-cifra__num">{num(r.dentro)}</span>
          <span className="wa-cifra__txt">ya están en el grupo</span>
          <span className="wa-cifra__sub">{r.conTelefono > 0 ? `${pct(pctDentro, 0)} de los ${num(r.conTelefono)} que dejaron teléfono` : "nadie dejó teléfono"}</span>
        </button>
        <button type="button" className="wa-cifra wa-cifra--falta" aria-pressed={filtro === "fuera"} onClick={() => alternar("fuera")} title="Ver sólo a los que todavía no entraron">
          <span className="wa-cifra__num">{num(r.fuera)}</span>
          <span className="wa-cifra__txt">todavía no entraron</span>
          <span className="wa-cifra__sub">a ellos hay que escribirles</span>
        </button>
        <button type="button" className="wa-cifra" aria-pressed={filtro === "sin-telefono"} onClick={() => alternar("sin-telefono")} title="Ver sólo a los que no dejaron un teléfono que se entienda">
          <span className="wa-cifra__num">{num(r.sinTelefono)}</span>
          <span className="wa-cifra__txt">sin teléfono</span>
          <span className="wa-cifra__sub">no se puede saber si entraron</span>
        </button>
        <div className="wa-cifra wa-cifra--fija" title="La columna «Grupo de WhatsApp» de la tabla: la marca el equipo a mano.">
          <span className="wa-cifra__num">{num(marcadosAMano)}</span>
          <span className="wa-cifra__txt">marcados «Unido» a mano</span>
          <span className="wa-cifra__sub">por el equipo, en la tabla</span>
        </div>
      </div>
      <div className="wa-panel__progreso" role="img" aria-label={`${pct(pctDentro, 0)} ya están en el grupo`}><span style={{ width: `${Math.min(100, pctDentro)}%` }} /></div>

      <div className="wa-panel__acciones">
        <div className="wa-panel__grupo-acciones">
          <span className="wa-panel__rotulo">Los {num(faltan.length)} que se ven y todavía no entraron</span>
          <div className="wa-panel__botones">
            <Button
              sm variante="brand" icono={<Download size={14} />} disabled={faltan.length === 0} onClick={bajarParaManyChat}
              title="Baja un CSV con nombre, teléfono y mail, listo para importar en ManyChat y mandarles una difusión desde ahí"
            >
              CSV para ManyChat
            </Button>
            <Button
              sm variante="secondary" icono={<Copy size={14} />} disabled={faltan.length === 0}
              onClick={() => onCopiar(listaParaCopiar(filas(faltan), false), `Copiaste ${num(faltan.length)} ${faltan.length === 1 ? "teléfono" : "teléfonos"}, uno por renglón.`)}
              title="Los teléfonos, uno por renglón"
            >
              Copiar teléfonos
            </Button>
            <Button
              sm variante="ghost" disabled={faltan.length === 0}
              onClick={() => onCopiar(listaParaCopiar(filas(faltan), true), `Copiaste ${num(faltan.length)} con su nombre: pegalas en una planilla.`)}
              title="Nombre y teléfono separados por tabulación, para pegar en una planilla"
            >
              Copiar con nombres
            </Button>
          </div>
        </div>
        {puedeEditar && (
          <div className="wa-panel__grupo-acciones wa-panel__grupo-acciones--der">
            <span className="wa-panel__rotulo">En la tabla</span>
            <Button
              sm variante="secondary" icono={<Check size={14} />} disabled={porMarcar.length === 0}
              onClick={() => void onMarcarUnidos(porMarcar.map((x) => x.id))}
              title="Pone «Unido» en la columna «Grupo de WhatsApp» a los que WhatsApp ve adentro y todavía no lo tenían"
            >
              Marcar {num(porMarcar.length)} como «Unido»
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
