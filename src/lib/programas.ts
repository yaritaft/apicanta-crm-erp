import type { Ajustes, ID } from "./types";

/* ==================================================================
   Los programas: qué compró el alumno, más allá del nombre del producto
   de la venta. De cada programa sale su contrato de PandaDoc y los
   accesos que se le dan al firmar (cursos de Wisboo, grupos de Telegram,
   reuniones de Zoom). Se editan en Ajustes → Integraciones y viven en
   `ajustes.programas`; sin nada guardado, los de siempre (lo que contó
   Manu el 20/10):

   - Hackear AI: el grueso. Es Hackear IT, que hoy se vende como Hackear AI;
     el upgrade de IT a AI lleva el mismo contrato. En Wisboo son dos cursos
     (en Hackear AI va todo lo nuevo de IA) más «Bonos», que lo recibe todo
     el que entra a este programa.
   - Hackear Biz, Principals y Principals Mastermind: aparte. Principals y
     Principals Mastermind usan la misma plantilla (se ajusta en el documento).
   - Downsell: el contrato de acceso al contenido grabado, y en Wisboo los
     cursos de Hackear IT y Hackear AI.

   Un programa puede INCLUIR a otro (Lili, 24/11: «los que renuevan en
   Principals deben tener Hackear IT, Hackear IA, Bonos y Principals, los
   grupos de Hackear IA más el de Principals y las tres salas de Zoom»):
   Principals incluye Hackear AI. Lo que da un programa es lo suyo MÁS lo de
   los que incluye, y eso lo lee todo el que da, muestra o cuenta accesos
   (`programasDe`). LA RAÍZ del 24/11: Principals tenía su propia lista con
   sólo su curso y su grupo; copiar las de Hackear AI se iba a desfasar el
   día que Hackear AI sumara un grupo. Ahora se suma solo.
   ================================================================== */

export interface Programa {
  id: string;
  nombre: string;
  /* Los productos de la venta que son este programa (Mentoría es Hackear AI). */
  productos: ID[];
  /* La plantilla de PandaDoc del contrato (vacía: el programa no lleva contrato). */
  plantillaId: string;
  plantillaNombre: string;
  /* La plantilla del contrato de la reserva (Manu, 21/10): cuando la venta es sólo la reserva, el contrato
     dice el monto que deja a cuenta y al firmarlo no se dan accesos. Vacía: el programa no tiene. */
  plantillaReservaId?: string;
  plantillaReservaNombre?: string;
  /* La plantilla para cuando no se dan sesiones 1 a 1 (Lili, 23/10): la misma sin el punto «Sesiones personalizadas»,
     porque con «No incluye» el alumno las reclamaba. Vacía: sale la de siempre. */
  plantillaSinSesionesId?: string;
  plantillaSinSesionesNombre?: string;
  /* Los productos de Wisboo que se regalan al firmar. */
  wisboo: string[];
  /* Los chats de Telegram (id) a los que se lo invita. */
  telegram: string[];
  /* Las reuniones de Zoom (id) a las que se lo inscribe. */
  zoom: string[];
  /* Los bonos que el closer puede elegir al mandar el contrato. */
  bonos: string[];
  /* Los accesos que se cortan solos: `plataforma:recurso` (`telegram:-100…`, `zoom:849…`, `wisboo:PRO-…`) → meses desde que se dan (o desde
     el inicio del servicio, si arranca después). Lo que no está acá no se corta nunca. Manuel, 12/11: en el Hackear IA MID, al terminar el mes se
     saca sólo la mentoría grupal y se conserva el contenido grabado. */
  vencen?: Record<string, number>;
  /* Los programas cuyos accesos también da este (Principals incluye Hackear AI). En lo que devuelve `programasDe`, ya están sumados a
     `wisboo`/`telegram`/`zoom` y acá quedan TODOS los que incluye, también los de segunda mano. */
  incluye?: string[];
  /* Un programa de extensión (Manuel, 13/11: «subirse» al MID con 2 meses más de mentoría por US$ 1.000): lo que la persona ya tiene con corte no
     se vuelve a dar, se le SUMA el tiempo al corte que tiene; lo que ya perdió se le vuelve a dar por esos meses. No mueve el inicio del alumno. */
  sumaTiempo?: boolean;
  activo: boolean;
}

export type PlataformaDeAcceso = "wisboo" | "telegram" | "zoom";

/** La clave de un acceso dentro de `vencen`. */
export const claveDeCorte = (plataforma: PlataformaDeAcceso, recurso: string): string => `${plataforma}:${recurso}`;

/** Los meses que dura ese acceso en este programa, o null si no se corta. */
export function mesesDeCorte(programa: Pick<Programa, "vencen">, plataforma: PlataformaDeAcceso, recurso: string): number | null {
  const n = programa.vencen?.[claveDeCorte(plataforma, recurso)];
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Los cortes leídos de la base: sólo plataformas conocidas y meses enteros de 1 a 36 (lo demás se descarta). */
export function cortesNormales(v: unknown): Record<string, number> {
  const salida: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return salida;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (/^(wisboo|telegram|zoom):.+$/.test(k) && typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 36) salida[k] = n;
  }
  return salida;
}

/** `desde` más N meses calendario (el 31 de enero más un mes es el 28 o 29 de febrero, no el 3 de marzo). */
export function sumarMeses(desde: string | Date, meses: number): string {
  const d = new Date(desde);
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const ultimo = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return r.toISOString();
}

/* Los tres downsells (Manuel, 12/11): el de siempre (US$ 497, sólo el contenido grabado), el Plus+ (US$ 997: contenido, bolsa de trabajo y corrección
   de CV y LinkedIn) y el Hackear IA MID (US$ 1.497: contenido y un mes de mentoría grupal). Para la ficha («Acceso: Downsell») y la bienvenida
   son lo mismo: no son el programa completo. */
export const PROGRAMAS_DE_EXTENSION: readonly string[] = ["hackear-ia-mid-extension"];
export const esProgramaDeExtension = (id: string | null | undefined): boolean => Boolean(id) && PROGRAMAS_DE_EXTENSION.includes(id!);
export const PROGRAMAS_DOWNSELL: readonly string[] = ["downsell", "downsell-plus", "hackear-ia-mid", ...PROGRAMAS_DE_EXTENSION];
export const esProgramaDownsell = (id: string | null | undefined): boolean => Boolean(id) && PROGRAMAS_DOWNSELL.includes(id!);

export const WISBOO = {
  hackearIt: "PRO-019fd69d87b070648850ba3e5e53e",
  hackearAi: "PRO-019fd69d7de5799e85772a1c877c7",
  bonos: "PRO-019fd69d6bfd7aec822705c2bb262",
  hackearBiz: "PRO-019fd69d6d247f1c8679e67e18295",
  principals: "PRO-06a7f78e32707000962516acdb15d48d",
  principalsMastermind: "PRO-019fd69d6d677c3085afe8fb8092d",
} as const;

const PLANTILLA_PRINCIPALS = { plantillaId: "LA84NtSudaTUWc3TC8nvxK", plantillaNombre: "Contrato Programa Principals (MASTERMIND)" };

export const PROGRAMAS_POR_DEFECTO: Programa[] = [
  {
    id: "hackear-ai", nombre: "Hackear AI",
    /* «Upgrade a mentoría» (desde el Plus+, US$ 1.500) es el mismo programa completo: se le da lo que le falta y se le levanta el corte. */
    productos: ["prod_mentoria", "prod_hackear_ai", "prod_hackear_it", "prod_resell", "prod_upgrade_ai", "prod_upgrade_mentoria"],
    plantillaId: "u8ZTSsZ8U3urHmUGjyUYmT", plantillaNombre: "Contrato de Mentoría - Hackear AI",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    id: "hackear-biz", nombre: "Hackear Biz", productos: ["prod_biz"],
    plantillaId: "Zyro4uuQWjEToKqvup737e", plantillaNombre: "Contrato Programa Hackear Biz",
    wisboo: [WISBOO.hackearBiz], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    /* Lo de Hackear AI (cursos, grupos y las tres salas) más lo suyo: casi todos llegan renovando desde Hackear AI (Lili, 24/11). */
    id: "principals", nombre: "Principals", productos: ["prod_principals"], ...PLANTILLA_PRINCIPALS,
    wisboo: [WISBOO.principals], telegram: [], zoom: [], bonos: [], incluye: ["hackear-ai"], activo: true,
  },
  {
    id: "principals-mastermind", nombre: "Principals Mastermind", productos: [], ...PLANTILLA_PRINCIPALS,
    wisboo: [WISBOO.principalsMastermind], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    id: "downsell", nombre: "Downsell", productos: ["prod_downsell"],
    /* La «- XXXXX» es la que usa Lili y la que Manu dejó con las variables (21/10); la otra está vieja. */
    plantillaId: "7uUS5z4i2f3FAPXwuNHkUC", plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    /* Contenido + bolsa de trabajo (el grupo de Telegram se elige en Ajustes) + corrección de CV y LinkedIn, que la hace el equipo a mano. */
    id: "downsell-plus", nombre: "Downsell Plus+", productos: ["prod_downsell_plus"],
    plantillaId: "7uUS5z4i2f3FAPXwuNHkUC", plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    /* Contenido grabado + un mes de mentoría grupal: los grupos y las reuniones se eligen en Ajustes y se cortan al mes (`vencen`). */
    id: "hackear-ia-mid", nombre: "Hackear IA MID", productos: ["prod_hackear_ia_mid"],
    plantillaId: "7uUS5z4i2f3FAPXwuNHkUC", plantillaNombre: "Contrato de acceso al contenido grabado - XXXXX",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [], zoom: [], bonos: [], vencen: {}, activo: true,
  },
  {
    /* Dos meses más de mentoría grupal para quien tiene el MID (US$ 1.000 pagando de una): sin cursos, y los grupos y reuniones se eligen en Ajustes. */
    id: "hackear-ia-mid-extension", nombre: "Hackear IA MID · extensión", productos: ["prod_extension_mid"],
    plantillaId: "", plantillaNombre: "", wisboo: [], telegram: [], zoom: [], bonos: [], vencen: {}, sumaTiempo: true, activo: true,
  },
];

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** Un programa leído de la base, sin confiar en que traiga todo. */
export function programaNormal(v: unknown): Programa | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const nombre = typeof o.nombre === "string" ? o.nombre.trim() : "";
  if (!id || !nombre) return null;
  return {
    id, nombre,
    productos: lista(o.productos),
    plantillaId: typeof o.plantillaId === "string" ? o.plantillaId : "",
    plantillaNombre: typeof o.plantillaNombre === "string" ? o.plantillaNombre : "",
    plantillaReservaId: typeof o.plantillaReservaId === "string" ? o.plantillaReservaId : "",
    plantillaReservaNombre: typeof o.plantillaReservaNombre === "string" ? o.plantillaReservaNombre : "",
    plantillaSinSesionesId: typeof o.plantillaSinSesionesId === "string" ? o.plantillaSinSesionesId : "",
    plantillaSinSesionesNombre: typeof o.plantillaSinSesionesNombre === "string" ? o.plantillaSinSesionesNombre : "",
    wisboo: lista(o.wisboo), telegram: lista(o.telegram), zoom: lista(o.zoom), bonos: lista(o.bonos),
    vencen: cortesNormales(o.vencen),
    ...(lista(o.incluye).filter((x) => x !== id).length ? { incluye: [...new Set(lista(o.incluye).filter((x) => x !== id))] } : {}),
    sumaTiempo: o.sumaTiempo === true,
    activo: o.activo !== false,
  };
}

/** Los programas tal como se guardan (cada uno con SU lista y los que incluye, sin sumar): los guardados en Ajustes o, sin nada
    guardado, los de siempre. Sólo para editarlos (Ajustes → Programas); para dar, mostrar o contar accesos, `programasDe`. */
export function programasPropios(ajustes: Pick<Ajustes, "programas"> | null | undefined): Programa[] {
  const guardados = Array.isArray(ajustes?.programas)
    ? ajustes!.programas!.map(programaNormal).filter((p): p is Programa => p !== null)
    : [];
  return guardados.length ? guardados : PROGRAMAS_POR_DEFECTO;
}

/** Los programas con lo que da cada uno de verdad: lo suyo más lo de los que incluye (y lo que incluyen esos), sin repetir y sin dar
    vueltas si alguien arma un círculo. Lo que se corta solo (`vencen`) manda lo de cada programa: lo que da el que incluye sin corte no
    hereda el corte del incluido. Se suma aunque el incluido esté inactivo (inactivo = no se ofrece al mandar contratos, nada más). */
export function conLoQueIncluye(propios: Programa[]): Programa[] {
  const porId = new Map(propios.map((p) => [p.id, p]));
  const incluidos = (p: Programa): Programa[] => {
    const vistos = new Set<string>([p.id]);
    const salida: Programa[] = [];
    const pendientes = [...(p.incluye ?? [])];
    while (pendientes.length) {
      const id = pendientes.shift()!;
      const x = porId.get(id);
      if (vistos.has(id) || !x) continue;
      vistos.add(id);
      salida.push(x);
      pendientes.push(...(x.incluye ?? []));
    }
    return salida;
  };
  return propios.map((p) => {
    const otros = incluidos(p);
    if (!otros.length) return p;
    const sumar = (campo: "wisboo" | "telegram" | "zoom") => [...new Set([...p[campo], ...otros.flatMap((x) => x[campo])])];
    const vencen: Record<string, number> = {};
    for (const x of [...otros].reverse()) {
      for (const [k, n] of Object.entries(x.vencen ?? {})) {
        const [pl, ...rec] = k.split(":");
        if (!(p[pl as PlataformaDeAcceso] ?? []).includes(rec.join(":"))) vencen[k] = n;
      }
    }
    Object.assign(vencen, p.vencen ?? {});
    return {
      ...p, wisboo: sumar("wisboo"), telegram: sumar("telegram"), zoom: sumar("zoom"),
      ...(Object.keys(vencen).length || p.vencen ? { vencen } : {}),
      incluye: otros.map((x) => x.id),
    };
  });
}

/** Los programas de la empresa, cada uno con todo lo que da (lo suyo y lo de los que incluye). */
export function programasDe(ajustes: Pick<Ajustes, "programas"> | null | undefined): Programa[] {
  return conLoQueIncluye(programasPropios(ajustes));
}

/** ¿El programa incluye a `otro` (o es ese)? Con lo que devuelve `programasDe`, también de segunda mano. */
export function incluyeAlPrograma(p: Pick<Programa, "id" | "incluye"> | null | undefined, otro: string): boolean {
  return Boolean(p) && (p!.id === otro || (p!.incluye ?? []).includes(otro));
}

/** El programa de un producto de la venta (el primero activo que lo tenga), o null. */
export function programaDeProducto(programas: Programa[], productoId: ID | undefined | null): Programa | null {
  if (!productoId) return null;
  return programas.find((p) => p.activo && p.productos.includes(productoId)) ?? null;
}

/** Los programas guardados con el grupo de Telegram `viejo` cambiado por `nuevo` (cuando un grupo pasa a
    supergrupo cambia de id), o null si ninguno lo tenía y no hay nada que guardar. */
export function cambiarGrupoEnProgramas(programas: unknown, viejo: string, nuevo: string): unknown[] | null {
  if (!Array.isArray(programas)) return null;
  let cambio = false;
  const nuevos = programas.map((p) => {
    const tg = p && typeof p === "object" ? (p as { telegram?: unknown }).telegram : undefined;
    if (!Array.isArray(tg) || !tg.includes(viejo)) return p;
    cambio = true;
    return { ...(p as object), telegram: [...new Set(tg.map((t) => (t === viejo ? nuevo : t)))] };
  });
  return cambio ? nuevos : null;
}

/** La plantilla con la que sale el contrato: la del programa; si es el de la reserva, la de la reserva; y si no se dan
    sesiones 1 a 1 y el programa tiene la plantilla sin ese punto, esa. */
export function plantillaDelContrato(programa: Programa | null | undefined, reserva: boolean | undefined, sesiones?: number | null): { id: string; nombre: string } {
  if (!programa) return { id: "", nombre: "" };
  if (reserva) return { id: programa.plantillaReservaId ?? "", nombre: programa.plantillaReservaNombre ?? "" };
  if (sesiones === 0 && programa.plantillaSinSesionesId) return { id: programa.plantillaSinSesionesId, nombre: programa.plantillaSinSesionesNombre ?? "" };
  return { id: programa.plantillaId, nombre: programa.plantillaNombre };
}

/** De qué programa es la plantilla de un documento mandado a mano desde PandaDoc, y cuál de sus plantillas es. */
export function programaDePlantilla(programas: Programa[], plantillaId: string | null | undefined): { programa: Programa; tipo: "programa" | "sinSesiones" | "reserva" } | null {
  if (!plantillaId) return null;
  const de = (tipo: "programa" | "sinSesiones" | "reserva", campo: "plantillaId" | "plantillaSinSesionesId" | "plantillaReservaId") => {
    const programa = programas.find((p) => p[campo] && p[campo] === plantillaId);
    return programa ? { programa, tipo } : null;
  };
  return de("programa", "plantillaId") ?? de("sinSesiones", "plantillaSinSesionesId") ?? de("reserva", "plantillaReservaId");
}

/** Corregir un contrato no cambia su plantilla (el documento ya está armado): pasar de 0 sesiones a tener (o al revés)
    en un programa con plantilla sin sesiones necesitaría otra, así que se pide anular y mandar uno nuevo. */
export function cambiaLaPlantilla(programa: Programa | null | undefined, reserva: boolean | undefined, antes: number | null | undefined, despues: number | null | undefined): boolean {
  if (!programa?.plantillaSinSesionesId || reserva) return false;
  return (antes === 0) !== (despues === 0);
}

export function programaPorId(programas: Programa[], id: string | null | undefined): Programa | null {
  return id ? programas.find((p) => p.id === id) ?? null : null;
}
