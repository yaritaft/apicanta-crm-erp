"use client";

import React, { useMemo, useState } from "react";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { EnlaceDeReporte } from "./EnlaceDeReporte";
import { ReportesDelCliente } from "./ReportesDelCliente";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { PAISES } from "@/lib/crm-tabla";
import { configSeguimiento, hoyDelNegocio } from "@/lib/seguimiento";
import { diaAInstante } from "@/lib/dia-negocio";
import {
  aNumero, CONTRATOS, DURACION_POR_PROGRAMA, ENTRE, listasCs, OPCIONES_ESTADO_ALUMNO, SESIONES_MENTOR, valorDeLista,
  type FilaCliente,
} from "@/lib/clientes-cs";
import type { Alumno, SeguimientoAlumno } from "@/lib/types";

/* ==================================================================
   La ficha de Customer Success de un cliente: todo lo que Lili lleva, en un
   solo formulario (Alumnos → Clientes, el lápiz del nombre). Lo que ya sabe
   el alumno o su venta se muestra y se corrige acá también; lo que se
   sugiere (el programa, la duración, el egreso) sólo se guarda si se toca.
   ================================================================== */

interface Borrador {
  nombre: string; email: string; telefono: string; pais: string; edad: string; dni: string; domicilio: string;
  numero: string;
  inicio: string; programas: string[]; planDePago: string; duracion: string; egreso: string; mentor: string; stack: string;
  garantia: string; acceso: string; closer: string;
  followUp: string; contactoInicial: string; contactoSemana: string; ultimoContacto: string; cadencia: string; estadoAlumno: Alumno["estado"];
  notas: string;
  repCompleto: boolean; repActivo: boolean; repSemanas: string;
  wpp: boolean; zoom: boolean; wibo: boolean;
  contrato: string; estadoContrato: string;
  cv: boolean; linkedin: boolean; responsableCv: string;
}

const conActual = (lista: readonly string[], actual: string) => (actual && !lista.includes(actual) ? [actual, ...lista] : [...lista]);

export function FichaClienteCs({ fila, onCerrar }: { fila: FilaCliente; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const hoy = hoyDelNegocio();
  const cfg = configSeguimiento(e.ajustes.seguimiento);
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const s = fila.seg;
  const conReportes = fila.reporte.origen === "reportes";
  const [tocoProgramas, setTocoProgramas] = useState(false);
  const [b, setB] = useState<Borrador>(() => ({
    nombre: fila.nombre, email: fila.email, telefono: fila.telefono, pais: fila.pais,
    edad: s.edad === null ? "" : String(s.edad), dni: s.dni, domicilio: s.domicilio,
    numero: s.numero === null ? "" : String(s.numero),
    inicio: fila.inicio, programas: fila.programas, planDePago: s.planDePago, duracion: s.duracionMeses === null ? "" : String(s.duracionMeses),
    egreso: s.fechaEgreso ?? "", mentor: s.sesionesMentor === null ? "" : String(s.sesionesMentor), stack: s.stack,
    garantia: s.garantia, acceso: s.acceso, closer: s.closerNombre,
    followUp: s.followUp, contactoInicial: s.contactoInicial ?? "", contactoSemana: s.contactoSemana ?? "", ultimoContacto: s.ultimoContacto ?? "",
    cadencia: String(s.cadenciaDias), estadoAlumno: fila.alumno.estado, notas: s.notas,
    repCompleto: s.reporteManual?.completo ?? false, repActivo: s.reporteManual?.activo ?? true, repSemanas: String(s.reporteManual?.semanasSin ?? 0),
    wpp: s.accesoWhatsapp, zoom: s.accesoZoom, wibo: s.accesoWibo,
    contrato: s.contratoFirmado, estadoContrato: s.estadoContrato,
    cv: s.cvCorregido, linkedin: s.linkedinCorregido, responsableCv: s.responsableCv,
  }));
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => ({ ...x, [k]: v }));
  const [tocoReporte, setTocoReporte] = useState(false);

  /* Validaciones: cada una dice qué corregir. */
  const num = (txt: string, [min, max]: readonly [number, number]): { ok: boolean; n: number | null } => {
    if (!txt.trim()) return { ok: true, n: null };
    const n = aNumero(txt);
    return n !== null && Number.isInteger(n) && n >= min && n <= max ? { ok: true, n } : { ok: false, n: null };
  };
  const edad = num(b.edad, ENTRE.edad), duracion = num(b.duracion, ENTRE.duracion), mentor = num(b.mentor, [0, 3]);
  const numero = num(b.numero, [1, 999999]), semanas = num(b.repSemanas, [0, 520]);
  const mailOk = !b.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email.trim());
  const errores = {
    edad: edad.ok ? undefined : `Un número entre ${ENTRE.edad[0]} y ${ENTRE.edad[1]}.`,
    duracion: duracion.ok ? undefined : `Meses, entre ${ENTRE.duracion[0]} y ${ENTRE.duracion[1]}.`,
    mentor: mentor.ok ? undefined : "De 0 a 3 sesiones.",
    numero: numero.ok ? undefined : "Un número entero desde 1.",
    semanas: semanas.ok ? undefined : "Un número de semanas.",
    email: mailOk ? undefined : "Ese mail no parece válido.",
    nombre: b.nombre.trim() ? undefined : "Poné al menos el nombre.",
  };
  const puedeGuardar = !Object.values(errores).some(Boolean);

  const duracionSugerida = fila.duracionSugerida ? fila.duracion : null;
  const closers = e.equipo.filter((m) => m.rol === "closer" && m.activo).map((m) => m.nombre);

  function guardar() {
    const cuando = new Date().toISOString();
    const cadencia = Number(b.cadencia);
    const nombre = b.nombre.trim();
    const cambiosSeg: Partial<SeguimientoAlumno> = {
      ...(numero.n !== null ? { numero: numero.n } : {}), edad: edad.n, dni: b.dni.trim(), domicilio: b.domicilio.trim(),
      stack: valorDeLista(b.stack, listas.stacks), planDePago: b.planDePago.trim(), duracionMeses: duracion.n,
      fechaEgreso: b.egreso || null, sesionesMentor: mentor.n, garantia: valorDeLista(b.garantia, listas.garantias),
      acceso: valorDeLista(b.acceso, listas.accesos), followUp: valorDeLista(b.followUp, listas.followUps),
      contactoInicial: b.contactoInicial || null, contactoSemana: b.contactoSemana || null,
      notas: b.notas, accesoWhatsapp: b.wpp, accesoZoom: b.zoom, accesoWibo: b.wibo,
      contratoFirmado: valorDeLista(b.contrato, CONTRATOS), estadoContrato: valorDeLista(b.estadoContrato, listas.estadosContrato),
      cvCorregido: b.cv, linkedinCorregido: b.linkedin, responsableCv: b.responsableCv.trim(),
      ...(fila.closerDeVenta ? {} : { closerNombre: b.closer.trim() }),
      /* Sin contacto en la app, el teléfono es de la ficha. */
      ...(fila.contacto ? {} : { telefono: b.telefono.trim() }),
      /* Lo que se sugería (el programa) sólo se guarda si se tocó. */
      ...(tocoProgramas || fila.seg.programas.length ? { programas: b.programas } : {}),
      ...(tocoReporte && !conReportes ? { reporteManual: { completo: b.repCompleto, activo: b.repActivo, semanasSin: semanas.n ?? 0, en: hoy } } : {}),
    };
    /* El último contacto y la cadencia recalculan el próximo, igual que desde la lista de seguimiento. */
    const cambioContacto = (b.ultimoContacto || null) !== s.ultimoContacto;
    const cambioCadencia = Number.isFinite(cadencia) && cadencia !== s.cadenciaDias;
    acciones.guardarSeguimiento(
      fila.id,
      (previo, quien) => {
        const siguiente: SeguimientoAlumno = { ...previo, ...cambiosSeg, actualizadoEn: cuando, actualizadoPor: quien };
        if (cambioCadencia) siguiente.cadenciaDias = Math.max(1, Math.min(365, Math.round(cadencia)));
        if (cambioContacto) {
          siguiente.ultimoContacto = b.ultimoContacto || null;
          siguiente.proximoContacto = null;
          siguiente.intentosSinRespuesta = 0;
          siguiente.ultimoIntento = null;
        } else if (cambioCadencia) {
          siguiente.proximoContacto = null;
        }
        siguiente.cvCorregidoEn = b.cv ? (previo.cvCorregido ? previo.cvCorregidoEn : hoy) : null;
        siguiente.linkedinCorregidoEn = b.linkedin ? (previo.linkedinCorregido ? previo.linkedinCorregidoEn : hoy) : null;
        return siguiente;
      },
      () => "Se actualizó la ficha de Customer Success.",
    );

    /* Lo del alumno y de la persona: se corrige en todos lados. */
    const antes = fila.alumno;
    const cambiosAlumno: Partial<Alumno> = {};
    if (nombre !== antes.nombre) cambiosAlumno.nombre = nombre;
    if (b.email.trim() !== antes.email) cambiosAlumno.email = b.email.trim();
    if ((b.pais.trim() || undefined) !== ((antes.pais ?? "").trim() || undefined) && b.pais.trim() !== fila.pais) cambiosAlumno.pais = b.pais.trim() || undefined;
    if (b.inicio && b.inicio !== fila.inicio) cambiosAlumno.inicio = diaAInstante(b.inicio);
    if (b.estadoAlumno !== antes.estado) cambiosAlumno.estado = b.estadoAlumno;
    if (Object.keys(cambiosAlumno).length) acciones.actualizar<Alumno>("alumnos", fila.id, cambiosAlumno, nombre, "Se actualizó el alumno desde la ficha de Customer Success.");
    const persona = {
      nombre: cambiosAlumno.nombre, email: cambiosAlumno.email,
      telefono: fila.contacto && b.telefono.trim() !== fila.telefono ? b.telefono.trim() : undefined,
    };
    if (persona.nombre || persona.email || persona.telefono) acciones.corregirPersona(fila.contacto?.id ?? antes.leadId ?? fila.id, persona);
    toast(`Ficha de ${nombre} guardada.`);
    onCerrar();
  }

  const toggleProg = (p: string, on: boolean) => {
    setTocoProgramas(true);
    set("programas", on ? [...new Set([...b.programas, p])] : b.programas.filter((x) => x !== p));
  };
  const programas = [...listas.programas, ...b.programas.filter((p) => !listas.programas.includes(p))];
  const sugerenciaDuracion = duracionSugerida ?? (b.programas[0] ? DURACION_POR_PROGRAMA[b.programas[0]] : undefined);

  return (
    <ModalForm abierto onCerrar={onCerrar} titulo={`Customer Success · ${fila.nombre}`} ancho puedeGuardar={puedeGuardar} onGuardar={guardar}
      sub="Todo lo que Customer Success lleva de este cliente. Lo que está en gris itálica es una sugerencia: se guarda sólo si lo escribís.">
      <div className="cs-ficha">
        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Datos personales</h3>
          <div className="form-grid">
            <Field label="Nombre y apellido" error={errores.nombre} span2><Input value={b.nombre} onChange={(ev) => set("nombre", ev.target.value)} error={Boolean(errores.nombre)} /></Field>
            <Field label="Mail" error={errores.email}><Input type="email" value={b.email} onChange={(ev) => set("email", ev.target.value)} error={Boolean(errores.email)} /></Field>
            <Field label="Teléfono"><Input value={b.telefono} onChange={(ev) => set("telefono", ev.target.value)} /></Field>
            <Field label="País">
              <Input value={b.pais} onChange={(ev) => set("pais", ev.target.value)} list="cs-paises" />
              <datalist id="cs-paises">{PAISES.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Edad" error={errores.edad} ayuda={fila.edadSugerida && fila.edad ? `Contestó ${fila.edad} al agendar.` : undefined}>
              <Input type="number" min={ENTRE.edad[0]} max={ENTRE.edad[1]} value={b.edad} placeholder={fila.edadSugerida && fila.edad ? String(fila.edad) : ""} onChange={(ev) => set("edad", ev.target.value)} error={Boolean(errores.edad)} />
            </Field>
            <Field label="DNI"><Input value={b.dni} onChange={(ev) => set("dni", ev.target.value)} /></Field>
            <Field label="Domicilio" span2><Input value={b.domicilio} onChange={(ev) => set("domicilio", ev.target.value)} /></Field>
            <Field label="N.º de alumno" error={errores.numero}><Input type="number" min={1} value={b.numero} onChange={(ev) => set("numero", ev.target.value)} error={Boolean(errores.numero)} /></Field>
          </div>
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Programa</h3>
          <Field label="Programa" ayuda="Puede estar en más de uno.">
            <div className="cs-programas" role="group" aria-label="Programa">
              {programas.map((p) => (
                <label key={p}>
                  <input type="checkbox" checked={b.programas.includes(p)} onChange={(ev) => toggleProg(p, ev.target.checked)} />
                  <span className={fila.programasSugeridos && !tocoProgramas && b.programas.includes(p) ? "cs-sugerido" : undefined}>{p}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="form-grid">
            <Field label="Fecha de inicio"><Input type="date" value={b.inicio} onChange={(ev) => set("inicio", ev.target.value)} /></Field>
            <Field label="Plan de pago" ayuda={fila.planSugerido ? `Según sus cuotas: ${fila.plan}.` : "Lo acordado con el closer."}>
              <Input value={b.planDePago} onChange={(ev) => set("planDePago", ev.target.value)} placeholder={fila.planSugerido ? fila.plan : "Pago único, 3 cuotas…"} />
            </Field>
            <Field label="Duración (meses)" error={errores.duracion}>
              <Input type="number" min={1} value={b.duracion} onChange={(ev) => set("duracion", ev.target.value)} placeholder={sugerenciaDuracion ? String(sugerenciaDuracion) : ""} error={Boolean(errores.duracion)} />
            </Field>
            <Field label="Fecha de egreso" ayuda={fila.egreso && !s.fechaEgreso ? `Calculada: ${fila.egreso}.` : undefined}>
              <Input type="date" value={b.egreso} onChange={(ev) => set("egreso", ev.target.value)} />
            </Field>
            <Field label="Sesión con el mentor" error={errores.mentor}>
              <Select value={b.mentor} aria-label="Sesiones con el mentor" placeholder="Sin definir" opciones={SESIONES_MENTOR.map((n) => ({ valor: String(n), texto: `${n} ${n === 1 ? "sesión" : "sesiones"}` }))} onChange={(ev) => set("mentor", ev.target.value)} />
            </Field>
            <Field label="Stack">
              <Select value={b.stack} aria-label="Stack" placeholder="Sin definir" opciones={conActual(listas.stacks, b.stack)} onChange={(ev) => set("stack", ev.target.value)} />
            </Field>
            <Field label="Acceso">
              <Select value={b.acceso} aria-label="Acceso" placeholder="Sin definir" opciones={conActual(listas.accesos, b.acceso)} onChange={(ev) => set("acceso", ev.target.value)} />
            </Field>
            <Field label="Garantía" ayuda="Depende del tipo de contrato.">
              <Input value={b.garantia} onChange={(ev) => set("garantia", ev.target.value)} list="cs-garantias" />
              <datalist id="cs-garantias">{listas.garantias.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
            <Field label="Closer" ayuda={fila.closerDeVenta ? "Sale de su venta: se cambia desde la venta." : "Quién lo cerró."}>
              <Input value={fila.closerDeVenta ? fila.closer : b.closer} disabled={fila.closerDeVenta} onChange={(ev) => set("closer", ev.target.value)} list="cs-closers" />
              <datalist id="cs-closers">{closers.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Estado del alumno">
              <Select value={b.estadoAlumno} aria-label="Estado del alumno" opciones={OPCIONES_ESTADO_ALUMNO.map((o) => ({ valor: o.valor, texto: o.texto }))} onChange={(ev) => set("estadoAlumno", ev.target.value as Alumno["estado"])} />
            </Field>
          </div>
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Seguimiento</h3>
          <div className="form-grid">
            <Field label="Follow-up">
              <Select value={b.followUp} aria-label="Follow-up" placeholder="Sin definir" opciones={conActual(listas.followUps, b.followUp)} onChange={(ev) => set("followUp", ev.target.value)} />
            </Field>
            <Field label="Cadencia de contacto">
              <Select value={b.cadencia} aria-label="Cadencia" opciones={[...new Set([...cfg.cadencias, s.cadenciaDias])].sort((x, y) => x - y).map((d) => ({ valor: String(d), texto: `Cada ${d} días` }))} onChange={(ev) => set("cadencia", ev.target.value)} />
            </Field>
            <Field label="Contacto inicial"><Input type="date" value={b.contactoInicial} onChange={(ev) => set("contactoInicial", ev.target.value)} /></Field>
            <Field label="Contacto semana"><Input type="date" value={b.contactoSemana} onChange={(ev) => set("contactoSemana", ev.target.value)} /></Field>
            <Field label="Último contacto" ayuda="Al cambiarlo, el próximo toca según la cadencia."><Input type="date" value={b.ultimoContacto} onChange={(ev) => set("ultimoContacto", ev.target.value)} /></Field>
            <Field label="Comentarios" span2><Textarea rows={3} value={b.notas} onChange={(ev) => set("notas", ev.target.value)} placeholder="Notas internas de seguimiento…" /></Field>
          </div>
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Reporte semanal</h3>
          {conReportes ? (
            <p className="t-sm t-muted" style={{ margin: 0 }}>
              Sale de sus reportes semanales: {fila.reporte.estado.toLowerCase()}{fila.reporte.semanasSin ? ` (${fila.reporte.semanasSin} ${fila.reporte.semanasSin === 1 ? "semana" : "semanas"} sin reportar)` : ""}. No se marca a mano.
            </p>
          ) : (
            <>
              <p className="t-sm t-muted" style={{ margin: 0 }}>Todavía no tiene reportes cargados: mientras tanto se puede marcar a mano.</p>
              <div className="form-grid">
                <Field label="Completó el de esta semana"><Switch checked={b.repCompleto} etiqueta="Completó el reporte de esta semana" onChange={(v) => { setTocoReporte(true); set("repCompleto", v); }} /></Field>
                <Field label="Sigue activo"><Switch checked={b.repActivo} etiqueta="Sigue activo en los reportes" onChange={(v) => { setTocoReporte(true); set("repActivo", v); }} /></Field>
                <Field label="Semanas sin completarlo" error={errores.semanas}><Input type="number" min={0} value={b.repSemanas} onChange={(ev) => { setTocoReporte(true); set("repSemanas", ev.target.value); }} error={Boolean(errores.semanas)} /></Field>
              </div>
            </>
          )}
          <EnlaceDeReporte alumnoId={fila.alumno.id} email={b.email} />
          <ReportesDelCliente alumnoId={fila.alumno.id} />
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Accesos</h3>
          <div className="form-grid">
            <Field label="WhatsApp"><Switch checked={b.wpp} etiqueta="Tiene acceso a WhatsApp" onChange={(v) => set("wpp", v)} /></Field>
            <Field label="Zoom"><Switch checked={b.zoom} etiqueta="Tiene acceso a Zoom" onChange={(v) => set("zoom", v)} /></Field>
            <Field label="Wibo"><Switch checked={b.wibo} etiqueta="Tiene acceso a Wibo" onChange={(v) => set("wibo", v)} /></Field>
          </div>
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">Contrato</h3>
          <div className="form-grid">
            <Field label="Contrato firmado">
              <Select value={b.contrato} aria-label="Contrato firmado" placeholder="Sin definir" opciones={conActual(CONTRATOS, b.contrato)} onChange={(ev) => set("contrato", ev.target.value)} />
            </Field>
            <Field label="Estado del contrato">
              <Select value={b.estadoContrato} aria-label="Estado del contrato" placeholder="Sin definir" opciones={conActual(listas.estadosContrato, b.estadoContrato)} onChange={(ev) => set("estadoContrato", ev.target.value)} />
            </Field>
          </div>
        </section>

        <section className="cs-ficha__seccion">
          <h3 className="cs-ficha__titulo">CV y LinkedIn</h3>
          <div className="form-grid">
            <Field label="CV corregido"><Switch checked={b.cv} etiqueta="CV corregido" onChange={(v) => set("cv", v)} /></Field>
            <Field label="LinkedIn corregido"><Switch checked={b.linkedin} etiqueta="LinkedIn corregido" onChange={(v) => set("linkedin", v)} /></Field>
            <Field label="Responsable" ayuda="Quién corrige su CV y su LinkedIn.">
              <Input value={b.responsableCv} onChange={(ev) => set("responsableCv", ev.target.value)} list="cs-responsables" />
              <datalist id="cs-responsables">{e.equipo.map((m) => <option key={m.id} value={m.nombre} />)}</datalist>
            </Field>
          </div>
        </section>
      </div>
    </ModalForm>
  );
}
