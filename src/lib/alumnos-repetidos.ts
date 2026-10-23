import { claveEmail } from "./contactos";
import type { Alumno, EstadoApp, ID } from "./types";

/* ==================================================================
   El mismo alumno dos veces: uno con venta y otro sin (Lili, 23/10).

   Mariano cargó la venta de Saul Rivas Martínez con otro nombre y otro
   mail («Edgar»): la venta creó su alumno y Saul, que Lili tenía cargado
   sin venta, quedó aparte. Como el nombre no coincide nada los une solo
   (supabase/alumnos-sin-duplicar.sql pide dos palabras del nombre), así
   que se muestran juntos para que una persona decida: el mismo teléfono
   (los últimos 8 dígitos) o el mismo mail, uno con venta y el otro sin.
   Unirlos lo hace la base (supabase/unificar-alumnos.sql).
   ================================================================== */

export interface AlumnoRepetido {
  /* El que creó la venta (el closer lo cargó). */
  conVenta: Alumno;
  /* El que ya estaba, sin venta (importado o cargado a mano): es el que queda, con todo lo de Servicio. */
  sinVenta: Alumno;
  por: "telefono" | "email";
}

const ultimos8 = (t: string | null | undefined) => {
  const d = (t ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : "";
};

/* Los que alguien ya dijo que no son el mismo alumno. */
export function noSonElMismoAlumno(a: Pick<Alumno, "extra">): ID[] {
  const l = (a.extra ?? {}).noEsElMismoAlumno;
  return Array.isArray(l) ? l.map(String) : [];
}

/* Se recalcula si cambia cualquiera de las cuatro listas (un teléfono corregido en el seguimiento también cuenta). */
let CACHE: { claves: unknown[]; pares: AlumnoRepetido[] } | null = null;

export function alumnosRepetidos(e: Pick<EstadoApp, "alumnos" | "seguimientos" | "leads" | "contactos">): AlumnoRepetido[] {
  const claves = [e.alumnos, e.seguimientos, e.leads, e.contactos];
  if (CACHE && CACHE.claves.every((c, i) => c === claves[i])) return CACHE.pares;
  const lead = new Map(e.leads.map((l) => [l.id, l] as const));
  const contacto = new Map(e.contactos.map((c) => [c.id, c] as const));
  const seg = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s] as const));
  const telefonoDe = (a: Alumno) => {
    const l = a.leadId ? lead.get(a.leadId) : undefined;
    return ultimos8(seg.get(a.id)?.telefono) || ultimos8(l ? contacto.get(l.contactoId ?? l.id)?.telefono : undefined) || ultimos8(l?.telefono);
  };
  const personaDe = (a: Alumno) => {
    const l = a.leadId ? lead.get(a.leadId) : undefined;
    return l ? l.contactoId ?? l.id : "";
  };
  const sinVenta = e.alumnos.filter((a) => !a.ventaId && a.estado !== "baja");
  const porTel = new Map<string, Alumno[]>();
  const porMail = new Map<string, Alumno[]>();
  for (const a of sinVenta) {
    const t = telefonoDe(a), m = claveEmail(a.email);
    if (t) porTel.set(t, [...(porTel.get(t) ?? []), a]);
    if (m) porMail.set(m, [...(porMail.get(m) ?? []), a]);
  }
  const pares: AlumnoRepetido[] = [];
  for (const conVenta of e.alumnos) {
    if (!conVenta.ventaId) continue;
    const t = telefonoDe(conVenta), m = claveEmail(conVenta.email);
    const candidatos = [
      ...(t ? (porTel.get(t) ?? []).map((a) => ({ a, por: "telefono" as const })) : []),
      ...(m ? (porMail.get(m) ?? []).map((a) => ({ a, por: "email" as const })) : []),
    ];
    const vistos = new Set<ID>();
    for (const { a, por } of candidatos) {
      if (vistos.has(a.id) || a.id === conVenta.id) continue;
      vistos.add(a.id);
      /* La misma persona del CRM ya se une sola (alumnos-sin-duplicar.sql); acá van los que no. */
      if (personaDe(a) && personaDe(a) === personaDe(conVenta)) continue;
      if (noSonElMismoAlumno(a).includes(conVenta.id) || noSonElMismoAlumno(conVenta).includes(a.id)) continue;
      pares.push({ conVenta, sinVenta: a, por });
    }
  }
  CACHE = { claves, pares };
  return pares;
}

export const repetidosDe = (e: Parameters<typeof alumnosRepetidos>[0], alumnoId: ID) =>
  alumnosRepetidos(e).filter((p) => p.conVenta.id === alumnoId || p.sinVenta.id === alumnoId);
