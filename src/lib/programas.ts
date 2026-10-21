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
  /* Los productos de Wisboo que se regalan al firmar. */
  wisboo: string[];
  /* Los chats de Telegram (id) a los que se lo invita. */
  telegram: string[];
  /* Las reuniones de Zoom (id) a las que se lo inscribe. */
  zoom: string[];
  /* Los bonos que el closer puede elegir al mandar el contrato. */
  bonos: string[];
  activo: boolean;
}

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
    productos: ["prod_mentoria", "prod_hackear_ai", "prod_hackear_it", "prod_resell", "prod_upgrade_ai"],
    plantillaId: "u8ZTSsZ8U3urHmUGjyUYmT", plantillaNombre: "Contrato de Mentoría - Hackear AI",
    wisboo: [WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    id: "hackear-biz", nombre: "Hackear Biz", productos: ["prod_biz"],
    plantillaId: "Zyro4uuQWjEToKqvup737e", plantillaNombre: "Contrato Programa Hackear Biz",
    wisboo: [WISBOO.hackearBiz], telegram: [], zoom: [], bonos: [], activo: true,
  },
  {
    id: "principals", nombre: "Principals", productos: ["prod_principals"], ...PLANTILLA_PRINCIPALS,
    wisboo: [WISBOO.principals], telegram: [], zoom: [], bonos: [], activo: true,
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
    wisboo: lista(o.wisboo), telegram: lista(o.telegram), zoom: lista(o.zoom), bonos: lista(o.bonos),
    activo: o.activo !== false,
  };
}

/** Los programas de la empresa: los guardados en Ajustes o, sin nada guardado, los de siempre. */
export function programasDe(ajustes: Pick<Ajustes, "programas"> | null | undefined): Programa[] {
  const guardados = Array.isArray(ajustes?.programas)
    ? ajustes!.programas!.map(programaNormal).filter((p): p is Programa => p !== null)
    : [];
  return guardados.length ? guardados : PROGRAMAS_POR_DEFECTO;
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

/** La plantilla con la que sale el contrato: la del programa o, si es el de la reserva, la de la reserva. */
export function plantillaDelContrato(programa: Programa | null | undefined, reserva: boolean | undefined): { id: string; nombre: string } {
  if (!programa) return { id: "", nombre: "" };
  return reserva
    ? { id: programa.plantillaReservaId ?? "", nombre: programa.plantillaReservaNombre ?? "" }
    : { id: programa.plantillaId, nombre: programa.plantillaNombre };
}

export function programaPorId(programas: Programa[], id: string | null | undefined): Programa | null {
  return id ? programas.find((p) => p.id === id) ?? null : null;
}
