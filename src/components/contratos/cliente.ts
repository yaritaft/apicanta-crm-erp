import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { modalidadDeCuotas, type Contrato, type DatosContrato, type EventoContrato } from "@/lib/contratos";
import { alumnoDeVenta, personaDeVenta } from "@/lib/alumnos";
import { programaDeProducto, programasDe, type Programa } from "@/lib/programas";
import type { ConfigContratos, Cuota, EstadoApp, Venta } from "@/lib/types";
import { diaDeNegocio } from "@/lib/dia-negocio";

/* ==================================================================
   Los contratos desde el navegador: se LEEN directo de la base (las
   políticas de supabase/contratos-y-accesos.sql recortan lo que cada uno
   ve: el closer, sólo lo suyo) y se CAMBIAN pidiéndole al servidor
   (/api/contratos), que es el único que habla con PandaDoc.
   ================================================================== */

export interface ContratosLeidos { contratos: Contrato[]; eventos: EventoContrato[]; faltaTabla?: boolean; error?: string }

export async function leerContratos(f: { ventaId?: string; leadId?: string; alumnoId?: string }): Promise<ContratosLeidos> {
  if (!nube) return { contratos: [], eventos: [] };
  const filtros = [
    f.ventaId && `ventaId.eq.${f.ventaId}`, f.leadId && `leadId.eq.${f.leadId}`, f.alumnoId && `alumnoId.eq.${f.alumnoId}`,
  ].filter(Boolean).join(",");
  if (!filtros) return { contratos: [], eventos: [] };
  const r = await nube.from("contratos").select("*").or(filtros).order("creadoEn", { ascending: false });
  if (r.error) {
    const falta = /contratos|PGRST205|42P01/.test(`${r.error.code} ${r.error.message}`);
    return { contratos: [], eventos: [], faltaTabla: falta, error: falta ? undefined : r.error.message };
  }
  const contratos = (r.data ?? []) as Contrato[];
  if (!contratos.length) return { contratos, eventos: [] };
  const ev = await nube.from("contrato_eventos").select("*").in("contratoId", contratos.map((c) => c.id)).order("cuando", { ascending: true });
  return { contratos, eventos: (ev.data ?? []) as EventoContrato[] };
}

export async function pedirContrato(cuerpo: Record<string, unknown>): Promise<Contrato> {
  const r = await fetch("/api/contratos", {
    method: "POST", cache: "no-store",
    headers: { ...(await cabeceras()), "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as { contrato?: Contrato; error?: string };
  if (!r.ok && !j.contrato) throw new Error(j.error ?? `Error ${r.status}`);
  if (j.contrato?.estado === "error") throw new Error(j.contrato.error ?? "El contrato no salió.");
  return j.contrato!;
}

export async function abrirPdf(id: string): Promise<void> {
  const r = await fetch(`/api/contratos/pdf?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: await cabeceras() });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? "No se pudo abrir el PDF.");
  window.open(j.url, "_blank", "noopener");
}

/** ¿Esta cuenta ve los contratos? Apagados, nadie; en prueba o sólo dueños, los dueños; encendidos, todos. */
export function contratosPrendidos(config: ConfigContratos | undefined, esDueno: boolean): boolean {
  const estado = config?.estado ?? "apagado";
  return estado === "encendido" || ((estado === "prueba" || estado === "duenos") && esDueno);
}

/** Los datos para arrancar el contrato de una venta: la persona, su ficha de servicio y el plan de cuotas. */
export function datosDeVenta(e: EstadoApp, venta: Pick<Venta, "id" | "contactoId" | "contactoNombre" | "productoId" | "moneda"> & Partial<Venta>, cuotas?: Pick<Cuota, "monto" | "esReserva">[]): {
  datos: DatosContrato; programa: Programa | null;
} {
  const persona = personaDeVenta(e, venta as Venta);
  const lead = venta.contactoId ? e.leads.find((l) => l.id === venta.contactoId) : undefined;
  const contacto = venta.contactoId ? e.contactos.find((c) => c.id === venta.contactoId) : undefined;
  const alumno = venta.id ? alumnoDeVenta(e, venta as Venta) : undefined;
  const seg = alumno ? (e.seguimientos ?? []).find((s) => s.alumnoId === alumno.id) : undefined;
  const plan = cuotas ?? e.cuotas.filter((c) => c.ventaId === venta.id && c.estado !== "cancelada").sort((a, b) => a.numero - b.numero);
  return {
    programa: programaDeProducto(programasDe(e.ajustes), venta.productoId),
    datos: {
      nombre: persona.nombre,
      email: persona.email,
      telefono: (contacto as { telefono?: string } | undefined)?.telefono || lead?.telefono || seg?.telefono || "",
      documento: seg?.dni ?? "",
      domicilio: seg?.domicilio ?? "",
      pais: persona.pais,
      modalidad: modalidadDeCuotas(plan, venta.moneda || "USD"),
      sesiones: seg?.sesionesMentor ?? 0,
      bonos: [],
      fecha: diaDeNegocio(new Date().toISOString()),
    },
  };
}
