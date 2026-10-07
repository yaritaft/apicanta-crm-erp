"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Check, Copy, MessageCircle } from "lucide-react";
import { Badge, Button, Card, Chip } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { EstadoLectorBadge, useEstadoDelLector } from "@/components/webinars/EstadoLector";
import { useAcceso } from "@/lib/acceso";
import { fecha, num, pct } from "@/lib/format";
import type { RegistroForm } from "@/lib/registros-webinar";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { useEstado } from "@/lib/store";
import {
  filtrarPorLector, listaParaCopiar, puedeVerWhatsapp, resumenDeRegistros, unionesDeRegistros, type FiltroDeLector, type ResumenDeRegistros, type UnionDePersona,
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

/* ---------- La barra de arriba de la tabla ---------- */

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
  if (!lector.aplica || !lector.hayLector || lector.grupo.sinAcceso) return null;

  const { resumen: r, estado, webinar } = lector;
  const grupos = lector.grupo.datos?.grupos ?? [];

  /* El webinar todavía no tiene su grupo: se dice dónde atarlo. */
  if (!lector.hayGrupo) {
    if (!lector.grupo.datos) return null;
    return (
      <Card className="wa-formularios">
        <div className="wa-formularios__titulo">
          <MessageCircle size={16} aria-hidden />
          <span>Lector de WhatsApp</span>
          <EstadoLectorBadge estado={estado.estado} />
        </div>
        <p className="t-sm t-muted">
          Este webinar todavía no tiene un grupo de WhatsApp atado. Cuando lo tenga, acá se ve quién de los que se anotaron está en el grupo, sin marcarlo a mano.{" "}
          {webinar && (puedeEditar
            ? <Link href={`/webinars/${encodeURIComponent(webinar.id)}`} className="link">Atarlo en la ficha del webinar</Link>
            : "Lo ata quien edita los Webinars: avisale a un dueño.")}
        </p>
      </Card>
    );
  }

  const faltan = visibles.filter((x) => lector.union(x)?.estado === "no-unida" && lector.union(x)?.numero);
  const porMarcar = registros.filter((x) => lector.union(x)?.estado === "unida" && x.grupo !== "unido");
  const nombreDe = (x: RegistroForm) => x.nombre || x.email;
  const filas = (xs: RegistroForm[]) => xs.map((x) => {
    const u = lector.union(x)!;
    return { nombre: nombreDe(x), numero: u.numero, completo: u.completo };
  });

  return (
    <Card className="wa-formularios">
      <div className="wa-formularios__titulo">
        <MessageCircle size={16} aria-hidden />
        <span>Lector de WhatsApp</span>
        <EstadoLectorBadge estado={estado.estado} />
        <span className="wa-formularios__grupos">
          {grupos.map((g) => `${g.nombre || "Grupo"} (${num(g.miembros)})`).join(" · ")}
        </span>
      </div>

      <div className="wa-formularios__resumen">
        <span className="wa-formularios__numero">
          {num(r.dentro)} de {num(r.conTelefono)}
          <InfoMetrica
            titulo="Se unieron al grupo"
            ayuda="De las personas que se anotaron y dejaron un teléfono, cuántas están hoy en el grupo de WhatsApp, según el lector."
            formula={"Registros con teléfono que el lector ve en el grupo\n÷ Registros con teléfono"}
            componentes={() => [
              { concepto: "Registrados", valor: num(r.total) },
              { concepto: "Sin teléfono", valor: num(r.sinTelefono), signo: "−", nota: "no se pueden revisar" },
              { concepto: "Con teléfono", valor: num(r.conTelefono), signo: "=" },
              { concepto: "Están en el grupo", valor: num(r.dentro) },
              { concepto: "Se unieron", valor: r.conTelefono > 0 ? pct((r.dentro / r.conTelefono) * 100, 1) : "—", signo: "=" },
            ]}
            ejemplo="Los teléfonos se comparan sin importar cómo los escribió cada uno: «011 15 5555-1234» y «+54 9 11 5555-1234» son el mismo. Quien entró con otro número, o tiene el suyo oculto en WhatsApp, figura como que no está."
          />
        </span>
        <span className="wa-formularios__resto">
          se unieron{r.conTelefono > 0 ? ` (${pct((r.dentro / r.conTelefono) * 100, 0)})` : ""} · <strong>{num(r.fuera)}</strong> todavía no están
          · <strong>{num(r.sinTelefono)}</strong> sin teléfono
        </span>
      </div>

      <div className="wa-barra">
        <div className="wa-barra__filtros" role="group" aria-label="Según el lector de WhatsApp">
          <Chip activo={filtro === ""} onClick={() => onFiltro("")} count={r.total}>Todos</Chip>
          <Chip activo={filtro === "dentro"} onClick={() => onFiltro(filtro === "dentro" ? "" : "dentro")} count={r.dentro} title="El lector los ve adentro del grupo">En el grupo</Chip>
          <Chip activo={filtro === "fuera"} onClick={() => onFiltro(filtro === "fuera" ? "" : "fuera")} count={r.fuera} title="Dejaron un teléfono y el lector no los ve en el grupo">No están</Chip>
          <Chip activo={filtro === "sin-telefono"} onClick={() => onFiltro(filtro === "sin-telefono" ? "" : "sin-telefono")} count={r.sinTelefono} title="No dejaron un teléfono, o dejaron algo que no se entiende como un número">Sin teléfono</Chip>
        </div>
        <div className="wa-barra__copiar">
          {puedeEditar && (
            <Button
              sm variante="secondary" icono={<Check size={14} />} disabled={porMarcar.length === 0}
              onClick={() => void onMarcarUnidos(porMarcar.map((x) => x.id))}
              title="Pone «Unido» en la hoja a los que el lector ve adentro del grupo y todavía no lo tenían"
            >
              Marcar {num(porMarcar.length)} como {porMarcar.length === 1 ? "unido" : "unidos"}
            </Button>
          )}
          <Button
            sm variante="secondary" icono={<Copy size={14} />} disabled={faltan.length === 0}
            onClick={() => onCopiar(listaParaCopiar(filas(faltan), false), `Copiaste ${num(faltan.length)} ${faltan.length === 1 ? "teléfono" : "teléfonos"}, uno por renglón.`)}
            title="Los teléfonos de los que se ven en la tabla y no están en el grupo, uno por renglón"
          >
            Copiar {num(faltan.length)} que no {faltan.length === 1 ? "está" : "están"}
          </Button>
          <Button
            sm variante="ghost" disabled={faltan.length === 0}
            onClick={() => onCopiar(listaParaCopiar(filas(faltan), true), `Copiaste ${num(faltan.length)} con su nombre: pegalas en una planilla.`)}
            title="Nombre y teléfono separados por tabulación, para pegar en una planilla"
          >
            Con nombres
          </Button>
        </div>
      </div>
    </Card>
  );
}
