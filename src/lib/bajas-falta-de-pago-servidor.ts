import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { quitarAccesos } from "./accesos-servidor";
import { CLAVE_OUTBOARDING_FP, outboardingHecho, pideLaBaja, type OutboardingHecho } from "./bajas-falta-de-pago";
import { mailsDeServicio } from "./outboarding-servidor";
import { hoyDelNegocio } from "./seguimiento";
import type { Cuota, Venta } from "./types";

/* ==================================================================
   El outboarding automático de la baja por falta de pago (la regla: lib/bajas-falta-de-pago.ts; Liliana, 23/11).

   Cada hora (api/cron/contratos, a las :25): a quien un closer le pidió la baja y tiene accesos que dio la app (los cursos de
   Wisboo, los grupos de Telegram y las reuniones de Zoom), se los saca (quitarAccesos, lo mismo que «Quitar todo» en la ficha)
   y Customer Success recibe un aviso con lo que se sacó y lo que queda a mano. Un alumno de antes de la app no tiene nada de eso
   anotado: no se toca, y el aviso que le llegó a Lili al marcarse (la base) ya le dijo que lo haga a mano.

   Se hace una vez por cuota (queda en venta.extra): si Servicio le vuelve a dar accesos, la pasada no se los vuelve a sacar.
   El Follow Up no se toca: lo pasa Lili a Outboarding cuando lo revisa, y recién ahí sale de su lista.
   ================================================================== */

type Quitar = typeof quitarAccesos;

export interface PasadaBajas {
  /* Ventas con un pedido de baja vigente. */
  pedidos: number;
  /* A los que se les sacó algo (aunque algo haya fallado). */
  hechos: { alumnoId: string; ventaId: string; quitados: number; fallaron: number }[];
}

const PLATAFORMAS = [["wisboo", "Wisboo"], ["telegram", "Telegram"], ["zoom", "Zoom"]] as const;
const nombreDe = (p: string) => PLATAFORMAS.find(([id]) => id === p)?.[1] ?? p;
const unirConY = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const VIGENTES = ["pendiente", "dado", "entro"];

type CuotaFila = Pick<Cuota, "id" | "ventaId" | "numero" | "esReserva" | "monto" | "vence" | "seguimientoCobro">;
type VentaFila = Pick<Venta, "id" | "estado" | "contactoId" | "contactoNombre" | "extra">;
interface AlumnoFila { id: string; nombre: string | null; ventaId: string | null; leadId: string | null; estado: string | null }

export async function pasarBajasPorFaltaDePago(db: SupabaseClient, ahora = new Date(), quitar: Quitar = quitarAccesos): Promise<PasadaBajas> {
  const salida: PasadaBajas = { pedidos: 0, hechos: [] };
  const c = await db.from("cuotas").select('id, "ventaId", numero, "esReserva", monto, vence, "seguimientoCobro"').eq("seguimientoCobro->>estado", "baja");
  if (c.error) throw new Error(`cuotas: ${c.error.message}`);
  const marcadas = (c.data ?? []) as CuotaFila[];
  if (!marcadas.length) return salida;

  const p = await db.from("pagos").select('"cuotaId", monto').in("cuotaId", marcadas.map((x) => x.id));
  if (p.error) throw new Error(`pagos: ${p.error.message}`);
  const pagado = new Map<string, number>();
  for (const x of (p.data ?? []) as { cuotaId: string; monto: number }[]) pagado.set(x.cuotaId, (pagado.get(x.cuotaId) ?? 0) + (Number(x.monto) || 0));

  const ventaIds = [...new Set(marcadas.map((x) => x.ventaId))];
  const v = await db.from("ventas").select('id, estado, "contactoId", "contactoNombre", extra').in("id", ventaIds);
  if (v.error) throw new Error(`ventas: ${v.error.message}`);
  const ventas = new Map(((v.data ?? []) as VentaFila[]).map((x) => [x.id, { ...x, extra: x.extra ?? {} }] as const));

  /* Las cuotas que piden la baja, por venta; sin las que ya se hicieron. */
  const porVenta = new Map<string, CuotaFila[]>();
  for (const q of marcadas) {
    const venta = ventas.get(q.ventaId);
    if (!pideLaBaja(q, venta, pagado.get(q.id) ?? 0)) continue;
    porVenta.set(q.ventaId, [...(porVenta.get(q.ventaId) ?? []), q]);
  }
  salida.pedidos = porVenta.size;
  const pendientes = [...porVenta].filter(([ventaId, cuotas]) => cuotas.some((q) => !outboardingHecho(ventas.get(ventaId), [q.id])));
  if (!pendientes.length) return salida;

  /* El alumno de cada venta: el que la tiene enlazada o el que salió del mismo lead (como lib/alumnos.ts → alumnoDeVenta). */
  const ids = pendientes.map(([id]) => id);
  const leads = [...new Set(pendientes.map(([id]) => ventas.get(id)?.contactoId).filter((x): x is string => Boolean(x)))];
  const porVentaId = await db.from("alumnos").select('id, nombre, "ventaId", "leadId", estado').in("ventaId", ids);
  const porLead = leads.length ? await db.from("alumnos").select('id, nombre, "ventaId", "leadId", estado').in("leadId", leads) : { data: [], error: null };
  if (porVentaId.error || porLead.error) throw new Error(`alumnos: ${(porVentaId.error ?? porLead.error)!.message}`);
  const alumnos = [...((porVentaId.data ?? []) as AlumnoFila[]), ...((porLead.data ?? []) as AlumnoFila[])];
  const alumnoDe = (venta: VentaFila) => alumnos.find((a) => a.ventaId === venta.id) ?? (venta.contactoId ? alumnos.find((a) => a.leadId === venta.contactoId) : undefined);

  const conAlumno = pendientes.map(([ventaId, cuotas]) => ({ venta: ventas.get(ventaId)!, cuotas, alumno: alumnoDe(ventas.get(ventaId)!) }))
    .filter((x): x is typeof x & { alumno: AlumnoFila } => Boolean(x.alumno) && x.alumno!.estado !== "baja");
  if (!conAlumno.length) return salida;
  const acc = await db.from("accesos_alumno").select('"alumnoId"').in("alumnoId", conAlumno.map((x) => x.alumno.id)).in("estado", VIGENTES);
  if (acc.error) throw new Error(`accesos_alumno: ${acc.error.message}`);
  const conAccesos = new Set(((acc.data ?? []) as { alumnoId: string }[]).map((x) => x.alumnoId));

  const dia = hoyDelNegocio(ahora);
  for (const { venta, cuotas, alumno } of conAlumno) {
    /* Un alumno de antes de la app: no hay nada que sacar solo. El aviso de la base ya le dijo a Lili que es a mano. */
    if (!conAccesos.has(alumno.id)) continue;
    const pidio = cuotas.map((q) => q.seguimientoCobro?.por).find(Boolean) || "El closer";
    try {
      const r = await quitar(db, { alumnoId: alumno.id, quien: `Baja por falta de pago (la pidió ${pidio})` });
      const deLaApp = new Set(r.accesos.map((x) => x.plataforma));
      const hecho: OutboardingHecho = {
        dia, en: ahora.toISOString(), pidio,
        quitados: [...new Set(r.accesos.filter((x) => !x.error && x.estado === "quitado").map((x) => nombreDe(x.plataforma)))],
        aMano: PLATAFORMAS.filter(([id]) => !deLaApp.has(id)).map(([, nombre]) => nombre),
        fallaron: r.accesos.filter((x) => x.error).map((x) => x.recursoNombre || x.recurso),
      };
      await anotarEnLaVenta(db, venta.id, cuotas.map((q) => q.id), hecho);
      salida.hechos.push({ alumnoId: alumno.id, ventaId: venta.id, quitados: r.quitados, fallaron: r.fallaron });
      const nombre = alumno.nombre || venta.contactoNombre || "el alumno";
      const detalle = `Baja por falta de pago (la pidió ${pidio}): se ${r.quitados === 1 ? "sacó 1 acceso" : `sacaron ${r.quitados} accesos`} de la app`
        + `${hecho.quitados.length ? ` (${unirConY(hecho.quitados)})` : ""}.`;
      await db.from("actividad").insert({
        id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, accion: "actualizo", actor: "Outboarding automático",
        entidad: "transaccion", entidadId: venta.id, titulo: nombre, fecha: ahora.toISOString(), detalle,
      });
      await avisar(db, { alumno, venta, nombre, hecho, quitados: r.quitados });
    } catch (e) {
      console.error("[bajas por falta de pago]", alumno.id, e instanceof Error ? e.message : String(e));
    }
  }
  return salida;
}

/* Lo hecho queda en la venta, una entrada por cuota. Se relee la venta justo antes: otro proceso pudo tocar su `extra`. */
async function anotarEnLaVenta(db: SupabaseClient, ventaId: string, cuotaIds: string[], hecho: OutboardingHecho): Promise<void> {
  const r = await db.from("ventas").select("extra").eq("id", ventaId).maybeSingle();
  const extra = ((r.data as { extra?: Record<string, unknown> } | null)?.extra ?? {}) as Record<string, unknown>;
  const antes = (extra[CLAVE_OUTBOARDING_FP] ?? {}) as Record<string, OutboardingHecho>;
  const nuevo = { ...antes, ...Object.fromEntries(cuotaIds.map((id) => [id, hecho])) };
  const up = await db.from("ventas").update({ extra: { ...extra, [CLAVE_OUTBOARDING_FP]: nuevo } }).eq("id", ventaId);
  if (up.error) throw new Error(`no se anotó en la venta: ${up.error.message}`);
}

/* A Customer Success: uno por venta y por persona (no se repite si la pasada vuelve a correr). */
async function avisar(db: SupabaseClient, a: { alumno: AlumnoFila; venta: VentaFila; nombre: string; hecho: OutboardingHecho; quitados: number }): Promise<void> {
  try {
    const { hecho } = a;
    const falta = [...hecho.aMano];
    const partes = [
      `${hecho.pidio} pidió la baja por falta de pago: le sacamos ${a.quitados === 1 ? "1 acceso" : `${a.quitados} accesos`} de la app${hecho.quitados.length ? ` (${unirConY(hecho.quitados)})` : ""}.`,
      falta.length ? `${unirConY(falta)} ${falta.length === 1 ? "no figura" : "no figuran"} en la app: si los tiene de antes, sacáselos a mano.` : "",
      hecho.fallaron.length ? `No se pudo sacar: ${hecho.fallaron.join(", ")}. Hacelo a mano desde su ficha → Servicio → Accesos.` : "",
      "Revisalo y pasalo a Outboarding: hasta entonces queda en tu panel, en «Bajas por falta de pago».",
    ];
    const pendiente = falta.length > 0 || hecho.fallaron.length > 0;
    const filas = (await mailsDeServicio(db)).map((para) => ({
      id: `av_bajafp_hecho_${a.venta.id}_${createHash("sha1").update(para).digest("hex").slice(0, 10)}`,
      para, tipo: "outboarding",
      titulo: pendiente ? `Baja de ${a.nombre}: falta sacar algo a mano` : `Le sacamos los accesos a ${a.nombre}`,
      cuerpo: partes.filter(Boolean).join(" "), de: "Apicanta", contactoId: a.alumno.leadId ?? a.alumno.id, persona: a.nombre || null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[bajas por falta de pago] no se pudo avisar", err instanceof Error ? err.message : String(err)); }
}
