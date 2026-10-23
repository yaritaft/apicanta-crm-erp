import { nube } from "@/lib/supabase";
import { acciones, cargarDeLaNube, esperarGuardado, reiniciarCarga } from "@/lib/store";
import { cabeceras } from "@/components/webinars/useYoutube";
import { loDelOtroEnLaApp, noSonDuplicados, planSeparar, planUnificar, type PlanSeparar, type PlanUnificar } from "@/lib/duplicados";
import type { Contacto, EstadoApp, ID } from "@/lib/types";

/* Unificar dos fichas desde el navegador: con nube lo hace el servidor (api/personas/unificar) y acá se deja la app
   igual; sin nube, se hace acá mismo con la misma regla (lib/duplicados.ts). Devuelve qué pasó, para el aviso. */

async function pedir<T>(cuerpo: Record<string, unknown>, ruta = "/api/personas/unificar"): Promise<T> {
  /* Lo que todavía no llegó a la base (un mensaje recién escrito en el chat) tiene que estar antes de moverlo. */
  await esperarGuardado();
  const r = await fetch(ruta, {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j as T;
}

const quienSoyLocal = (e: EstadoApp) => e.ajustes.responsable || "Apicanta";

export async function unificarFichas(e: EstadoApp, principalId: ID, otroId: ID): Promise<{ resumen: string; deshacer: () => Promise<string> }> {
  let plan: PlanUnificar;
  if (nube) {
    plan = (await pedir<{ plan: PlanUnificar }>({ accion: "unificar", principalId, otroId })).plan;
  } else {
    const principal = e.contactos.find((c) => c.id === principalId);
    const otro = e.contactos.find((c) => c.id === otroId);
    if (!principal || !otro) throw new Error("No encuentro una de las dos fichas.");
    plan = planUnificar(principal, otro, loDelOtroEnLaApp(e, otro), quienSoyLocal(e), new Date().toISOString());
  }
  acciones.aplicarUnificacion(plan);
  const unificado = plan.contacto;
  return { resumen: plan.resumen, deshacer: () => separarFichas(unificado, otroId) };
}

/* Deshace una unificación. `principal` es el contacto como quedó al unificar (trae anotado qué se movió). */
export async function separarFichas(principal: Contacto, otroId: ID): Promise<string> {
  let plan: PlanSeparar | null;
  if (nube) {
    plan = (await pedir<{ plan: PlanSeparar }>({ accion: "separar", principalId: principal.id, otroId })).plan;
  } else {
    plan = planSeparar(principal, otroId);
    if (!plan) throw new Error("Esa ficha no estaba unificada con esta.");
  }
  acciones.aplicarSeparacion(plan);
  return plan.resumen;
}

export async function noSonLaMismaPersona(e: EstadoApp, aId: ID, bId: ID): Promise<void> {
  if (nube) {
    const { contactos } = await pedir<{ contactos: Contacto[] }>({ accion: "no-son", principalId: aId, otroId: bId });
    acciones.aplicarContactos(contactos);
    return;
  }
  const marcar = (id: ID, otro: ID): Contacto | null => {
    const c = e.contactos.find((x) => x.id === id);
    return c ? { ...c, extra: { ...(c.extra ?? {}), noEsLaMismaPersona: [...new Set([...noSonDuplicados(c), otro])] } } : null;
  };
  acciones.aplicarContactos([marcar(aId, bId), marcar(bId, aId)].filter((c): c is Contacto => Boolean(c)));
}

/* Servicio corrige el teléfono (o el nombre o el mail) de su alumno: lo escribe el servidor en la persona y en todo lo que
   cuelga de ella, porque la cuenta no edita contactos (api/personas/corregir). Después se refleja en la app. */
export async function corregirPersonaDesdeServicio(contactoId: ID, cambios: { nombre?: string; email?: string; telefono?: string }): Promise<void> {
  await pedir<{ ok: boolean }>({ contactoId, cambios }, "/api/personas/corregir");
  acciones.corregirPersona(contactoId, cambios, { yaEnLaBase: true });
}

/* Une dos alumnos que son la misma persona (lib/alumnos-repetidos.ts): con nube lo hace la base en una transacción
   (api/alumnos/unificar → unificar_alumnos) y después se vuelve a traer todo (cambian alumnos, seguimientos, la persona y
   la venta); sin nube, se hace acá con lo mismo que haría la base. */
export async function unificarAlumnos(e: EstadoApp, quedaId: ID, otroId: ID, corregirPersona: boolean): Promise<string> {
  if (nube) {
    const r = await pedir<{ resumen: string }>({ quedaId, otroId, corregirPersona }, "/api/alumnos/unificar");
    reiniciarCarga();
    await cargarDeLaNube();
    return r.resumen;
  }
  return acciones.unificarAlumnosLocal(quedaId, otroId, corregirPersona);
}
