"use client";

import React, { useMemo, useState } from "react";
import { GitMerge, Info, UserCheck } from "lucide-react";
import { Badge, Button, Card, CardHead, Empty, StatCard, Ayuda } from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { diaYHora } from "@/components/webinars/fechas";
import { useAcceso } from "@/lib/acceso";
import { nivelEn } from "@/lib/permisos";
import { acciones, useEstado } from "@/lib/store";
import { num } from "@/lib/format";
import { cruzarRegistros, herenciaDeFormulario, personasDeAgenda, type Candidato } from "@/lib/cruce-formularios";
import { filtrarRegistros, isoDePais, type RegistroForm } from "@/lib/registros-webinar";
import { cambiarRegistro, useRegistrosNube } from "@/lib/registros-nube";
import { telefonoLegible } from "@/lib/telefonos";

/* ==================================================================
   El cruce formulario ↔ agenda de Calendly.

   La misma persona completa el formulario con un mail y agenda con otro.
   Acá se ve a quién de la agenda se parece cada registro (primero por mail,
   después por teléfono, después por nombre): las coincidencias firmes se
   unen con un clic para todas, y las dudosas se muestran para decidir
   «Unir» o «No es». Al unir, la persona de la agenda toma el anuncio y los
   UTMs del formulario, para que sus ventas se atribuyan al anuncio.
   ================================================================== */

const COMO: Record<Candidato["metodo"], string> = { mail: "por mail", telefono: "por teléfono", nombre: "por nombre" };

export function CruceFormularios({ webinar, nombreDelWebinar }: { webinar: string; nombreDelWebinar: string }) {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const puedeEditar = nivelEn(acceso, "webinars") === 2;
  const datos = useRegistrosNube();
  const [ocupado, setOcupado] = useState(false);

  const registros = useMemo(() => filtrarRegistros(datos.registros, { webinar, marca: "", q: "" }), [datos.registros, webinar]);
  const personas = useMemo(() => personasDeAgenda(e.contactos, e.sesiones).filter((p) => p.contactoId), [e.contactos, e.sesiones]);
  const sinUnir = useMemo(() => registros.filter((r) => !r.contactoId), [registros]);
  const cruces = useMemo(() => cruzarRegistros(sinUnir, personas), [sinUnir, personas]);
  const seguras = cruces.filter((c) => c.segura);
  const dudosos = cruces.filter((c) => !c.segura && c.dudosas.length > 0);
  const unidos = registros.length - sinUnir.length;

  async function unir(r: RegistroForm, c: Candidato, manual: boolean): Promise<boolean> {
    const contactoId = c.persona.contactoId;
    if (!contactoId) return false;
    const res = await cambiarRegistro(r.id, { contactoId, cruce: manual && c.metodo === "nombre" ? "manual" : c.metodo, cruceEn: new Date().toISOString() });
    if (!res.ok) { toast(res.error ?? "No se pudo unir.", "err"); return false; }
    /* La agenda toma lo que le faltaba del formulario (anuncio, UTMs de la pauta, teléfono). */
    const contacto = e.contactos.find((x) => x.id === contactoId);
    const herencia = contacto ? herenciaDeFormulario(contacto, r) : null;
    if (contacto && herencia) {
      acciones.heredarDeFormulario(contactoId, herencia,
        `${contacto.nombre}: tomó del formulario del webinar ${r.fechaWebinar ? r.fechaWebinar.split("-").reverse().join("/") : ""} (${r.email}) lo que le faltaba.`);
    }
    return true;
  }

  async function unirSeguras() {
    setOcupado(true);
    let hechas = 0;
    for (const c of seguras) if (c.segura && await unir(c.registro, c.segura, false)) hechas++;
    setOcupado(false);
    toast(`Se unieron ${num(hechas)} formularios con su agenda.`);
  }

  async function noEs(r: RegistroForm, c: Candidato) {
    const res = await cambiarRegistro(r.id, { descartados: [...r.descartados, c.persona.contactoId ?? c.persona.id] });
    if (!res.ok) toast(res.error ?? "No se pudo guardar.", "err");
  }

  return (
    <div className="stack-3">
      <div className="grid-stats">
        <StatCard
          etiqueta="Formularios" valor={num(registros.length)} contexto={nombreDelWebinar || "todos los webinars"}
          info={{ ayuda: "Los registros que se están cruzando con la agenda.", formula: "Registros del webinar elegido" }}
        />
        <StatCard
          etiqueta="Ya unidos con su agenda" valor={num(unidos)} contexto={registros.length ? `${num(Math.round((unidos / registros.length) * 100))}% de los formularios` : undefined}
          info={{ ayuda: "Los formularios que ya se unieron con una persona que agendó una llamada en Calendly (por mail, por teléfono o por decisión del equipo).", formula: "Formularios con una persona de la agenda ÷ formularios" }}
        />
        <StatCard
          etiqueta="Para unir con un clic" valor={num(seguras.length)} contexto="mismo mail o mismo teléfono"
          info={{ ayuda: "Formularios que coinciden con alguien de la agenda por mail, por teléfono (con o sin +54, 9, 0 y 15) o por teléfono sin código de área más el mismo nombre.", formula: "Mail igual, o teléfono igual, o últimos 8 dígitos del teléfono + mismo nombre" }}
        />
        <StatCard
          etiqueta="Para revisar" valor={num(dudosos.length)} contexto="no se unen solos"
          info={{ ayuda: "Coincidencias flojas: sólo los últimos 8 dígitos del teléfono (sin código de área, puede ser de otra zona) o sólo el nombre (puede ser un homónimo). Las decide una persona.", formula: "Teléfono parcial, o nombre igual de dos o más palabras" }}
        />
      </div>

      {datos.estado === "sin-tabla" ? (
        <Card><Empty icono={<GitMerge size={22} />} titulo="La tabla de registros todavía no está creada" texto="Corré supabase/registros-webinar.sql en Supabase." /></Card>
      ) : registros.length === 0 ? (
        <Card><Empty icono={<GitMerge size={22} />} titulo="No hay formularios para cruzar" texto="Elegí un webinar con registros, o importá las hojas del Excel desde «Registros»." /></Card>
      ) : (
        <>
          <Card style={{ padding: 0 }}>
            <div className="wb-personas__cabeza">
              <CardHead
                titulo={`Coincidencias firmes (${num(seguras.length)})`}
                sub="El formulario y la agenda son de la misma persona: mismo mail o mismo teléfono."
                acciones={puedeEditar && seguras.length > 0 ? <Button variante="brand" icono={<UserCheck size={16} />} cargando={ocupado} onClick={() => void unirSeguras()}>Unir las {num(seguras.length)}</Button> : undefined}
              />
            </div>
            {seguras.length === 0 ? (
              <Empty icono={<UserCheck size={22} />} titulo="Nada pendiente" texto="No hay formularios con una coincidencia firme que todavía no esté unida." />
            ) : (
              <div className="fm-cruce-lista">
                {seguras.slice(0, 100).map((c) => <FilaCruce key={c.registro.id} r={c.registro} c={c.segura!} />)}
                {seguras.length > 100 && <p className="t-sm t-subtle" style={{ padding: "var(--space-3) var(--space-4)" }}>Se muestran las primeras 100: «Unir las {num(seguras.length)}» une todas.</p>}
              </div>
            )}
          </Card>

          <Card style={{ padding: 0 }}>
            <div className="wb-personas__cabeza">
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <CardHead titulo={`Para revisar (${num(dudosos.length)})`} sub="¿Es la misma persona? Con otro mail y otro nombre no se puede saber sola." />
                <InfoMetrica
                  titulo="Cómo se arma la lista de dudosos"
                  ayuda="Se muestran los formularios que no tienen coincidencia firme pero se parecen a alguien de la agenda: por los últimos 8 dígitos del teléfono o por el nombre."
                  formula="Primero mail, después teléfono, después nombre. Lo que se descartó con «No es» no se vuelve a proponer."
                />
              </div>
            </div>
            {dudosos.length === 0 ? (
              <Empty icono={<Info size={22} />} titulo="Nadie para revisar" texto="No hay formularios dudosos con este webinar." />
            ) : (
              <div className="fm-cruce-lista">
                {dudosos.slice(0, 100).map((x) => x.dudosas.slice(0, 3).map((c) => (
                  <FilaCruce key={`${x.registro.id}:${c.persona.id}`} r={x.registro} c={c} dudosa
                    puedeEditar={puedeEditar} onUnir={() => void unir(x.registro, c, true)} onNoEs={() => void noEs(x.registro, c)} />
                )))}
              </div>
            )}
          </Card>

          <Ayuda titulo="Qué pasa al unir" icono={<Info size={18} />}>
            El formulario queda atado a la persona de la agenda y ella toma lo que le faltaba: el teléfono, el país, el anuncio y los UTMs de la
            pauta (los de la agenda quedan guardados aparte). Así, si compra, la venta se atribuye al anuncio que vio. Por ahora no se fusionan
            los dos contactos cuando tienen mails distintos: quedan separados, pero atados por este vínculo.
          </Ayuda>
        </>
      )}
    </div>
  );
}

function FilaCruce({ r, c, dudosa, puedeEditar, onUnir, onNoEs }: {
  r: RegistroForm; c: Candidato; dudosa?: boolean; puedeEditar?: boolean; onUnir?: () => void; onNoEs?: () => void;
}) {
  const iso = isoDePais(r.pais);
  return (
    <div className="fm-cruce">
      <div className="fm-cruce__lado">
        <span className="t-label">Formulario</span>
        <span className="t-strong">{r.nombre || r.email}</span>
        <span className="t-sm t-subtle">{r.email}</span>
        <span className="t-sm t-subtle">{r.telefono ? telefonoLegible(r.telefono, iso) : "Sin teléfono"} · {diaYHora(r.registradoEn)}</span>
      </div>
      <div className="fm-cruce__medio">
        <Badge variante={dudosa ? "warning" : "success"}>{dudosa ? "Dudosa" : "Firme"} · {COMO[c.metodo]}</Badge>
        <span className="t-sm t-subtle">{c.motivo}</span>
      </div>
      <div className="fm-cruce__lado">
        <span className="t-label">Agenda</span>
        <span className="t-strong">{c.persona.nombre || c.persona.emails[0]}</span>
        <span className="t-sm t-subtle">{c.persona.emails.join(" · ")}</span>
        <span className="t-sm t-subtle">{c.persona.telefono ? telefonoLegible(c.persona.telefono, isoDePais(c.persona.pais)) : "Sin teléfono"} · llamada {diaYHora(c.persona.inicia)}</span>
      </div>
      {dudosa && puedeEditar && (
        <div className="fm-cruce__acciones">
          <Button sm variante="brand" onClick={onUnir}>Unir</Button>
          <Button sm variante="secondary" onClick={onNoEs}>No es</Button>
        </div>
      )}
    </div>
  );
}
