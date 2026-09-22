"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, Input, Persona, Tag, type VarianteBadge } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, type DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { useEstado } from "@/lib/store";
import { money, num } from "@/lib/format";
import { personasDeWebinar, type PersonaDeWebinar } from "@/lib/webinar";
import type { EstadoSesion, Webinar } from "@/lib/types";
import { diaCorto, diaYHora } from "./fechas";

/* ==================================================================
   La gente de este webinar: quién se registró, quién agendó, cómo le
   fue en la llamada y quién compró. Nadie se carga acá: entran solos
   con el registro, la agenda de Calendly y las ventas.
   ================================================================== */

const LLAMADA: Record<EstadoSesion, { texto: string; variante: VarianteBadge }> = {
  "agendada": { texto: "Agendada", variante: "accent" },
  "hecha": { texto: "Hecha", variante: "success" },
  "no-show": { texto: "No vino", variante: "danger" },
  "cancelada": { texto: "Cancelada", variante: "neutral" },
};

const INGLES: Record<string, string> = {
  ninguno: "Ninguno", basico: "Básico", intermedio: "Intermedio",
  conversacional: "Conversacional", nativo: "Nativo",
};
const ORDEN_INGLES = ["ninguno", "basico", "intermedio", "conversacional", "nativo"];

const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

const COLUMNAS: DefColumna[] = [
  { clave: "nombre", titulo: "Persona", fija: true },
  { clave: "email", titulo: "Email", grupo: "Datos" },
  { clave: "telefono", titulo: "Teléfono", grupo: "Datos" },
  { clave: "pais", titulo: "País", grupo: "Datos" },
  { clave: "ingles", titulo: "Inglés", grupo: "Datos" },
  { clave: "experiencia", titulo: "Años de experiencia", grupo: "Datos" },
  { clave: "entro", titulo: "Entró", grupo: "Datos", ayuda: "Cuándo apareció: se registró, agendó o compró." },
  { clave: "etapa", titulo: "Etapa", grupo: "Proceso", ayuda: "La etapa de su oportunidad. Pre-lead: se registró pero todavía no agendó." },
  { clave: "llamada", titulo: "Llamada", grupo: "Proceso", ayuda: "La próxima agendada o, si no hay, la última." },
  { clave: "estadoLlamada", titulo: "Estado de la llamada", grupo: "Proceso" },
  { clave: "closer", titulo: "Closer", grupo: "Proceso", ayuda: "Quién atiende la llamada." },
  { clave: "llamadas", titulo: "Llamadas", grupo: "Proceso", ayuda: "Cuántas tuvo, contando reprogramadas y canceladas." },
  { clave: "venta", titulo: "Venta", grupo: "Plata", ayuda: "Lo facturado de sus ventas de este webinar." },
  { clave: "cobrado", titulo: "Cobrado", grupo: "Plata" },
  { clave: "utm", titulo: "UTMs", grupo: "Origen", ayuda: "Los del registro; si no hay, los de la agenda." },
  ...UTMS.map((u) => ({ clave: u, titulo: u, grupo: "Origen" })),
  { clave: "canal", titulo: "Canal", grupo: "Origen", ayuda: "Por dónde entró: webinar, VSL, setter u otro." },
];

const POR_DEFECTO = ["nombre", "pais", "etapa", "llamada", "estadoLlamada", "venta", "utm"];

export function PersonasWebinar({ w }: { w: Webinar }) {
  const e = useEstado();
  const [q, setQ] = useState("");
  const cols = useColumnas("webinar-personas", COLUMNAS, POR_DEFECTO);
  const M = (n: number) => money(n, e.ajustes.monedaBase);

  /* Lo último que entró arriba, aunque la columna "Entró" esté apagada. */
  const personas = useMemo(
    () => personasDeWebinar(e, w.id).sort((a, b) => +new Date(b.entro ?? 0) - +new Date(a.entro ?? 0)),
    [e, w.id],
  );
  const etapa = (id?: string) => e.etapas.find((x) => x.id === id);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return personas;
    return personas.filter((p) =>
      [p.nombre, p.email, p.telefono, p.pais, ...Object.values(p.utm ?? {})]
        .some((x) => x?.toLowerCase().includes(t)));
  }, [personas, q]);

  const agendaron = personas.filter((p) => p.llamadas.length > 0).length;
  const compraron = personas.filter((p) => p.facturado > 0).length;

  const DEF: Record<string, Columna<PersonaDeWebinar>> = {
    nombre: {
      clave: "nombre", titulo: "Persona", tipo: "primary", orden: (p) => (p.nombre ?? "").toLowerCase(),
      celda: (p) => p.leadId
        ? (
          <Link href={`/leads?ver=${encodeURIComponent(p.leadId)}`} className="wb-persona" title={`Abrir a ${p.nombre} en Leads`}>
            <Persona nombre={p.nombre || "Sin nombre"} sub={p.email} />
          </Link>
        )
        : <Persona nombre={p.nombre || "Sin nombre"} sub={p.email ?? "Sin oportunidad en Leads"} />,
    },
    email: { clave: "email", titulo: "Email", tipo: "secondary", orden: (p) => p.email ?? "", celda: (p) => p.email || "—" },
    telefono: { clave: "telefono", titulo: "Teléfono", tipo: "secondary", orden: (p) => p.telefono ?? "", celda: (p) => p.telefono || "—" },
    pais: { clave: "pais", titulo: "País", tipo: "secondary", orden: (p) => p.pais ?? "", celda: (p) => p.pais || "—" },
    ingles: {
      clave: "ingles", titulo: "Inglés", orden: (p) => ORDEN_INGLES.indexOf(p.inglesNivel ?? ""),
      celda: (p) => (p.inglesNivel
        ? <Badge variante={p.inglesNivel === "conversacional" || p.inglesNivel === "nativo" ? "success" : "neutral"}>{INGLES[p.inglesNivel]}</Badge>
        : "—"),
    },
    experiencia: {
      clave: "experiencia", titulo: "Años de experiencia", tipo: "num", orden: (p) => p.aniosExperiencia ?? -1,
      celda: (p) => (p.aniosExperiencia == null ? "—" : num(p.aniosExperiencia)),
    },
    entro: { clave: "entro", titulo: "Entró", tipo: "secondary", orden: (p) => (p.entro ? +new Date(p.entro) : 0), celda: (p) => diaCorto(p.entro) },
    etapa: {
      clave: "etapa", titulo: "Etapa", orden: (p) => etapa(p.etapaId)?.orden ?? -1,
      celda: (p) => {
        const et = etapa(p.etapaId);
        if (et) return <Badge variante={et.variante}>{et.nombre}</Badge>;
        return p.leadId ? "—" : <Tag>Pre-lead</Tag>;
      },
    },
    llamada: {
      clave: "llamada", titulo: "Llamada", tipo: "secondary",
      orden: (p) => (p.llamada ? +new Date(p.llamada.inicia) : 0),
      celda: (p) => (p.llamada ? diaYHora(p.llamada.inicia) : "—"),
    },
    estadoLlamada: {
      clave: "estadoLlamada", titulo: "Estado de la llamada", orden: (p) => p.llamada?.estado ?? "",
      celda: (p) => {
        if (!p.llamada) return <span className="t-subtle">Sin llamada</span>;
        const et = LLAMADA[p.llamada.estado] ?? LLAMADA.agendada;
        return <Badge variante={et.variante}>{et.texto}</Badge>;
      },
    },
    closer: { clave: "closer", titulo: "Closer", tipo: "secondary", orden: (p) => p.llamada?.anfitrion ?? "", celda: (p) => p.llamada?.anfitrion || "—" },
    llamadas: { clave: "llamadas", titulo: "Llamadas", tipo: "num", orden: (p) => p.llamadas.length, celda: (p) => num(p.llamadas.length) },
    venta: {
      clave: "venta", titulo: "Venta", tipo: "num", orden: (p) => p.facturado,
      celda: (p) => {
        if (p.facturado > 0) return <span className="t-strong" style={{ color: "var(--ink)" }}>{M(p.facturado)}</span>;
        if (p.ventas.length > 0) return <Badge variante="neutral">Cancelada</Badge>;
        return <span className="t-subtle">—</span>;
      },
    },
    cobrado: { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (p) => p.cobrado, celda: (p) => (p.facturado > 0 ? M(p.cobrado) : "—") },
    utm: {
      clave: "utm", titulo: "UTMs", orden: (p) => Object.values(p.utm ?? {}).join(" "),
      celda: (p) => (p.utm && Object.keys(p.utm).length > 0
        ? (
          <span className="wb-utms">
            {UTMS.filter((u) => p.utm?.[u]).map((u) => <Tag key={u}>{u.replace(/^utm_/, "")}: {p.utm![u]}</Tag>)}
          </span>
        )
        : <span className="t-subtle">—</span>),
    },
    canal: {
      clave: "canal", titulo: "Canal", tipo: "secondary", orden: (p) => p.canal ?? "",
      celda: (p) => (p.canal ? ETIQUETA_CANAL[p.canal] : "—"),
    },
  };
  for (const u of UTMS) {
    DEF[u] = { clave: u, titulo: u, tipo: "secondary", orden: (p) => p.utm?.[u] ?? "", celda: (p) => p.utm?.[u] || "—" };
  }

  const columnas = cols.visibles.map((k) => DEF[k]).filter(Boolean);

  return (
    <Card style={{ padding: 0 }}>
      <div className="wb-personas__cabeza">
        <CardHead
          titulo="Personas de este webinar"
          sub={personas.length === 0
            ? "Entran solas cuando se registran, agendan o compran."
            : `${num(personas.length)} ${personas.length === 1 ? "persona" : "personas"} · ${num(agendaron)} agendaron · ${num(compraron)} compraron`}
        />
        {personas.length > 0 && (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Input
              icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)}
              placeholder="Buscá por nombre, mail, país o UTM…" aria-label="Buscar personas"
            />
            <span className="spacer" />
            <ConfigColumnas
              todas={COLUMNAS} visibles={cols.visibles}
              alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar}
            />
          </div>
        )}
      </div>
      <DataTable
        filas={filtradas}
        columnas={columnas}
        porPagina={25}
        vacio={
          personas.length === 0 ? (
            <Empty
              icono={<Users size={22} />}
              titulo="Todavía no hay nadie de este webinar"
              texto="Entran solas: cuando alguien se registra desde este webinar o agenda una llamada con sus UTMs aparece acá, y también quien compre con este webinar como origen."
            />
          ) : (
            <Empty
              icono={<Search size={22} />}
              titulo="Nadie coincide con la búsqueda"
              texto="Probá con otro nombre, mail o UTM."
              accion={<Button variante="secondary" onClick={() => setQ("")}>Limpiar la búsqueda</Button>}
            />
          )
        }
      />
    </Card>
  );
}
