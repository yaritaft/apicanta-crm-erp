import { personaDe } from "./persona";
import type { EstadoApp, ID } from "./types";

/* ==================================================================
   «Busqué a un alumno en el CRM y no me aparece nada» (Dante, 21/10).

   El CRM sólo lista llamadas. Pedro Salgado tenía una venta (un upgrade) pero
   ninguna llamada en el período: la búsqueda quedaba en 0 sin decir que la
   persona existe. Esto busca a quien coincide con lo escrito entre las
   personas, las ventas y los alumnos (lo que la cuenta ve) y dice qué tiene
   cada uno, para ofrecer abrir su ficha.
   ================================================================== */

export interface PersonaHallada { id: ID; nombre: string; detalle: string }

const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function personasQueCoinciden(e: Pick<EstadoApp, "contactos" | "leads" | "ventas" | "alumnos" | "sesiones" | "pagos" | "cuotas" | "resells">, texto: string, max = 4): PersonaHallada[] {
  const t = normal(texto);
  if (t.length < 3) return [];
  const ids: ID[] = [];
  for (const v of e.ventas) if (normal(v.contactoNombre ?? "").includes(t)) ids.push(v.contactoId ?? v.id);
  for (const a of e.alumnos) if (normal(a.nombre).includes(t) || normal(a.email).includes(t)) ids.push(a.id);
  for (const l of e.leads) if (normal(l.nombre).includes(t) || normal(l.email).includes(t)) ids.push(l.id);
  for (const c of e.contactos) if (normal(c.nombre).includes(t) || normal(c.email ?? "").includes(t)) ids.push(c.id);

  const vistas = new Set<ID>();
  const out: PersonaHallada[] = [];
  for (const id of ids) {
    const p = personaDe(e as EstadoApp, id);
    if (!p || vistas.has(p.clave)) continue;
    vistas.add(p.clave);
    const partes = [
      p.ventas.length ? `${p.ventas.length} ${p.ventas.length === 1 ? "venta" : "ventas"}` : "",
      p.alumnos.length ? "alumno" : "",
      p.sesiones.length ? `${p.sesiones.length} ${p.sesiones.length === 1 ? "llamada" : "llamadas"}` : "sin llamadas",
    ].filter(Boolean);
    out.push({ id: p.clave, nombre: p.nombre, detalle: partes.join(" · ") });
    if (out.length >= max) break;
  }
  return out;
}
