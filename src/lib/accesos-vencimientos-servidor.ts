import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { accesosDe, quitarAccesos } from "./accesos-servidor";
import { diaDeNegocio } from "./dia-negocio";
import { hoyDelNegocio } from "./seguimiento";

/* ==================================================================
   La pasada de los cortes automáticos: un acceso con `venceEn` que ya pasó se saca solo, y NADA MÁS que ese.

   Manuel (12/11): en el Hackear IA MID, cuando la persona termina el mes se le saca la mentoría grupal (los grupos de Telegram y las
   reuniones de Zoom), pero conserva el contenido grabado (Wisboo). Cada programa dice en Ajustes qué accesos se cortan y a los cuántos
   meses (`Programa.vencen`); al darlos queda anotado `accesos_alumno.venceEn`, y esta pasada saca los que ya vencieron con
   quitarAccesos (lo mismo que «Quitar» en la ficha). Es distinto del outboarding (lib/outboarding-servidor.ts), que saca TODO cuando
   termina el programa.

   Customer Success recibe un aviso con lo que se sacó, lo que no se pudo sacar (a mano) y con qué se queda la persona. Lo que falló
   sigue vencido y se vuelve a intentar en la próxima pasada. La corre api/cron/contratos (a las :25).
   ================================================================== */

type Quitar = typeof quitarAccesos;

export interface PasadaDeCortes {
  /* Accesos vencidos que encontró (hasta el tope de cada pasada). */
  vencidos: number;
  /* A quién se le sacó (aunque algo haya fallado). */
  alumnos: { alumnoId: string; quitados: number; fallaron: number }[];
}

/* Pocos por pasada: cada uno llama a Telegram o a Zoom. Los que sobran se sacan en la pasada siguiente (a la hora). */
const TOPE = 150;
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

interface Vencido { id: string; alumnoId: string; plataforma: string; recurso: string; recursoNombre: string | null; programa: string | null; venceEn: string }

export async function pasarCortes(db: SupabaseClient, ahora = new Date(), quitar: Quitar = quitarAccesos): Promise<PasadaDeCortes> {
  const salida: PasadaDeCortes = { vencidos: 0, alumnos: [] };
  const r = await db.from("accesos_alumno").select("id, alumnoId, plataforma, recurso, recursoNombre, programa, venceEn")
    .in("estado", ["dado", "entro"]).not("venceEn", "is", null).lte("venceEn", ahora.toISOString())
    .order("venceEn", { ascending: true }).limit(TOPE);
  if (r.error) throw new Error(`accesos_alumno: ${r.error.message}`);
  const vencidos = (r.data ?? []) as Vencido[];
  salida.vencidos = vencidos.length;

  const porAlumno = new Map<string, Vencido[]>();
  for (const v of vencidos) porAlumno.set(v.alumnoId, [...(porAlumno.get(v.alumnoId) ?? []), v]);

  for (const [alumnoId, lista] of porAlumno) {
    try {
      /* Sólo los vencidos: «ids» limita lo que saca quitarAccesos, que sin eso sacaría todo. */
      const q = await quitar(db, { alumnoId, ids: lista.map((x) => x.id), quien: "Corte automático" });
      salida.alumnos.push({ alumnoId, quitados: q.quitados, fallaron: q.fallaron });
      if (q.quitados + q.fallaron > 0) {
        await avisarDelCorte(db, alumnoId, lista, q.accesos.filter((x) => x.error).map((x) => x.recursoNombre || x.recurso));
      }
    } catch (e) {
      console.error("[cortes]", alumnoId, e instanceof Error ? e.message : String(e));
    }
  }
  return salida;
}

/** «Se le sacó la mentoría grupal»: de qué se habla, qué falta sacar a mano y con qué se queda. Uno por alumno y por día. */
async function avisarDelCorte(db: SupabaseClient, alumnoId: string, vencidos: Vencido[], fallaron: string[]): Promise<void> {
  try {
    const al = await db.from("alumnos").select("id, nombre, leadId").eq("id", alumnoId).maybeSingle();
    const alumno = (al.data ?? { id: alumnoId, nombre: "", leadId: null }) as { id: string; nombre: string | null; leadId: string | null };
    const nombre = alumno.nombre || "un alumno";
    const sacados = vencidos.map((x) => x.recursoNombre || x.recurso).filter((x) => !fallaron.includes(x));
    const programa = vencidos[0]?.programa ?? "";
    const quedan = (await accesosDe(db, alumnoId)).filter((x) => x.estado === "dado" || x.estado === "entro").map((x) => x.recursoNombre || x.recurso);
    const dia = hoyDelNegocio();
    const partes = [
      sacados.length ? `Se cumplió el plazo${programa ? ` del programa «${programa}»` : ""} y se le sacó: ${sacados.join(", ")}.` : "",
      fallaron.length ? `No se pudo sacar: ${fallaron.join(", ")}. Hacelo a mano desde su ficha → Servicio → Accesos.` : "",
      quedan.length ? `Sigue con: ${quedan.join(", ")}.` : "Ya no le queda ningún acceso de la app.",
      `Vencía el ${ddmm(diaDeNegocio(vencidos[0]?.venceEn) || dia)}.`,
    ];
    const r = await db.from("equipo").select("email").eq("activo", true)
      .or("puesto.ilike.%customer success%,puesto.ilike.%servicio%,puesto.ilike.%csm%");
    const filas = ((r.data ?? []) as { email: string | null }[]).filter((x) => x.email?.trim()).map((x) => ({
      id: `av_corte_${alumnoId}_${dia}_${createHash("sha1").update(x.email!.trim().toLowerCase()).digest("hex").slice(0, 10)}`,
      para: x.email!.trim().toLowerCase(), tipo: "outboarding",
      titulo: fallaron.length ? `Corte de ${nombre}: falta sacar algo a mano` : `Le sacamos la mentoría a ${nombre}`,
      cuerpo: partes.filter(Boolean).join(" "), de: "Apicanta", contactoId: alumno.leadId ?? alumno.id, persona: alumno.nombre || null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[cortes] no se pudo avisar", err instanceof Error ? err.message : String(err)); }
}
