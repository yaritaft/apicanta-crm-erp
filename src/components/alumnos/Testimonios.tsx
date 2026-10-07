"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Quote, Trash2 } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, Field, IconButton, Input, Select, Textarea, type VarianteBadge } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { CopiarLink } from "@/components/ui/Filtros";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { paginaDeURL, useBusquedaURL, useParamsURL } from "@/lib/useParamsURL";
import {
  cuentaDeTestimonios, ESTADOS_TESTIMONIO, formatoDia, hoyDelNegocio, TEXTO_TESTIMONIO, testimoniosConAlumno,
} from "@/lib/seguimiento";
import type { Alumno, EstadoTestimonio, Testimonio } from "@/lib/types";

/* ==================================================================
   Testimonios (F2-09): a qué alumno se le pidió, cuál ya grabó y cuál está
   publicado, con su link y su fecha. Hasta ahora vivía en el Airtable de
   Customer Success (pestaña «Testimonios»). Un alumno puede tener más de uno.
   ================================================================== */

export const TONO_TESTIMONIO: Record<EstadoTestimonio, VarianteBadge> = {
  pedido: "warning", grabado: "info", publicado: "success",
};

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* Lo que se está mirando vive en la URL (lib/useParamsURL): estado y búsqueda. */
const VISTA = { testimonio: "todos", pag: "1" };

export function Testimonios() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const puede = puedeEditar(acceso, "testimonios");
  const [v, setV] = useParamsURL(VISTA);
  const [q, setQ] = useBusquedaURL("tq", ["pag"]);
  const filtro: EstadoTestimonio | "todos" = ESTADOS_TESTIMONIO.includes(v.testimonio as EstadoTestimonio) ? (v.testimonio as EstadoTestimonio) : "todos";
  const [form, setForm] = useState<{ t?: Testimonio; alumnoId?: string } | null>(null);
  const [borrar, setBorrar] = useState<Testimonio | null>(null);

  const todos = useMemo(() => testimoniosConAlumno(e), [e]);
  const cuenta = useMemo(() => cuentaDeTestimonios(e.testimonios ?? []), [e.testimonios]);
  const filas = useMemo(() => {
    const t = normal(q.trim());
    return todos.filter(({ testimonio, alumno }) =>
      (filtro === "todos" || testimonio.estado === filtro)
      && (!t || [alumno?.nombre, alumno?.email, testimonio.notas, testimonio.link].some((x) => x && normal(x).includes(t))));
  }, [todos, filtro, q]);

  type Fila = (typeof todos)[number] & { id: string };
  const columnas: Columna<Fila>[] = [
    {
      clave: "alumno", titulo: "Alumno", tipo: "primary", orden: (f) => f.alumno?.nombre ?? "",
      celda: (f) => (
        <button type="button" className="t-strong" style={{ all: "unset", cursor: "pointer" }} onClick={() => f.alumno && abrirFicha(f.alumno.id, "servicio")}>
          {f.alumno?.nombre ?? "Alumno borrado"}
        </button>
      ),
    },
    {
      clave: "estado", titulo: "Estado", orden: (f) => ESTADOS_TESTIMONIO.indexOf(f.testimonio.estado),
      celda: (f) => <Badge variante={TONO_TESTIMONIO[f.testimonio.estado]}>{TEXTO_TESTIMONIO[f.testimonio.estado]}</Badge>,
    },
    {
      clave: "fecha", titulo: "Fecha", orden: (f) => f.testimonio.fecha ?? "",
      celda: (f) => <span className="t-num">{formatoDia(f.testimonio.fecha)}</span>,
    },
    {
      clave: "link", titulo: "Link",
      celda: (f) => f.testimonio.link
        ? <a href={f.testimonio.link} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>Abrir<ExternalLink size={13} aria-hidden /></a>
        : <span className="t-subtle">—</span>,
    },
    { clave: "notas", titulo: "Notas", tipo: "secondary", celda: (f) => f.testimonio.notas || <span className="t-subtle">—</span> },
  ];

  const filasConId: Fila[] = filas.map((f) => ({ ...f, id: f.testimonio.id }));
  const hayFiltros = filtro !== "todos" || q.trim() !== "";

  return (
    <div className="stack-4">
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <div className="toolbar">
            <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscá por alumno o nota…" aria-label="Buscar testimonios" />
            <Chip activo={filtro === "todos"} onClick={() => setV({ testimonio: "todos", pag: null })} count={e.testimonios?.length ?? 0}>Todos</Chip>
            {ESTADOS_TESTIMONIO.map((k) => (
              <Chip
                key={k} activo={filtro === k} onClick={() => setV({ testimonio: k, pag: null })} count={cuenta[k]}
                title={k === "pedido" ? "Se lo pedimos y todavía no lo grabó" : k === "grabado" ? "Ya lo grabó y falta publicarlo" : "Ya está publicado"}
              >
                {TEXTO_TESTIMONIO[k]}
              </Chip>
            ))}
            <InfoMetrica
              titulo="Testimonios por estado"
              ayuda="Cuenta cada testimonio cargado según su estado: pedido (se lo pedimos), grabado (ya lo grabó) o publicado."
              formula="Cantidad de testimonios con ese estado. Un alumno puede tener más de uno."
            />
            <span className="spacer" />
            <CopiarLink />
            {puede && <Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm({})}>Nuevo testimonio</Button>}
          </div>
        </div>
        <DataTable
          filas={filasConId} columnas={columnas} alto={560} porPagina={50}
          pagina={paginaDeURL(v.pag) - 1} onPagina={(p) => setV({ pag: String(p + 1) })}
          acciones={puede ? (f) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm({ t: f.testimonio })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Borrar" onClick={() => setBorrar(f.testimonio)}><Trash2 size={15} /></IconButton>
            </>
          ) : undefined}
          vacio={(
            <Empty
              icono={<Quote size={22} />}
              titulo={hayFiltros ? "Ningún testimonio coincide" : "Todavía no hay testimonios"}
              texto={hayFiltros ? "Probá con otro estado o sacá la búsqueda." : "Cargá a quién se le pidió un testimonio, y pasalo a «grabado» y «publicado» a medida que avanza."}
              accion={!hayFiltros && puede ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm({})}>Cargar el primero</Button> : undefined}
            />
          )}
        />
      </Card>

      {form && <FormTestimonio testimonio={form.t} alumnoId={form.alumnoId} onCerrar={() => setForm(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar este testimonio?" texto="Se borra el registro del testimonio (no el video ni el posteo). El alumno sigue donde estaba."
        onConfirmar={() => { if (borrar) { acciones.borrarTestimonio(borrar.id); toast("Testimonio borrado."); } }}
      />
    </div>
  );
}

/* El formulario de un testimonio: nuevo (con el alumno ya elegido o a elegir) o uno existente. */
export function FormTestimonio({ testimonio, alumnoId, onCerrar }: {
  testimonio?: Testimonio; alumnoId?: string; onCerrar: () => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const [alumno, setAlumno] = useState(testimonio?.alumnoId ?? alumnoId ?? "");
  const [estado, setEstado] = useState<EstadoTestimonio>(testimonio?.estado ?? "pedido");
  const [link, setLink] = useState(testimonio?.link ?? "");
  const [fecha, setFecha] = useState(testimonio?.fecha ?? hoyDelNegocio());
  const [notas, setNotas] = useState(testimonio?.notas ?? "");
  const alumnos = useMemo(
    () => [...e.alumnos].sort((a: Alumno, b: Alumno) => a.nombre.localeCompare(b.nombre, "es")),
    [e.alumnos],
  );
  const linkValido = !link.trim() || /^https?:\/\/\S+$/i.test(link.trim());

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={testimonio ? "Editar el testimonio" : "Nuevo testimonio"}
      sub="Un alumno puede tener más de uno. Pasalo de «pedido» a «grabado» y «publicado» a medida que avanza."
      puedeGuardar={Boolean(alumno) && linkValido}
      onGuardar={() => {
        const t: Testimonio = {
          id: testimonio?.id ?? nuevoId("tes"), alumnoId: alumno, estado,
          link: link.trim(), fecha: fecha || null, notas: notas.trim(),
          creadoEn: testimonio?.creadoEn ?? new Date().toISOString(),
        };
        acciones.guardarTestimonio(t);
        toast(testimonio ? "Testimonio actualizado." : "Testimonio cargado.");
        onCerrar();
      }}
    >
      <div className="form-grid">
        <Field label="Alumno" span2>
          <Select
            value={alumno} aria-label="Alumno" placeholder="Elegí un alumno"
            opciones={alumnos.map((a) => ({ valor: a.id, texto: `${a.nombre}${a.email ? ` · ${a.email}` : ""}` }))}
            onChange={(ev) => setAlumno(ev.target.value)} disabled={Boolean(testimonio)}
          />
        </Field>
        <Field label="Estado">
          <Select
            value={estado} aria-label="Estado"
            opciones={ESTADOS_TESTIMONIO.map((k) => ({ valor: k, texto: TEXTO_TESTIMONIO[k] }))}
            onChange={(ev) => setEstado(ev.target.value as EstadoTestimonio)}
          />
        </Field>
        <Field label="Fecha" ayuda="El día en que se pidió, grabó o publicó.">
          <Input type="date" value={fecha ?? ""} onChange={(ev) => setFecha(ev.target.value)} />
        </Field>
        <Field label="Link" ayuda="El video, el posteo o la carpeta." error={linkValido ? undefined : "Tiene que empezar con http:// o https://"} span2>
          <Input value={link} onChange={(ev) => setLink(ev.target.value)} placeholder="https://…" error={!linkValido} />
        </Field>
        <Field label="Notas" span2>
          <Textarea rows={3} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Qué dijo, qué falta, a quién se lo pidió…" />
        </Field>
      </div>
    </ModalForm>
  );
}
