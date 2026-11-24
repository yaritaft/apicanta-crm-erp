import { PRODUCTOS_WISBOO } from "./accesos-alumnos";
import { explicacionDe } from "./bienvenida-alumno";
import type { PlataformaDeAcceso, Programa } from "./programas";

/* ==================================================================
   Lo que su programa le da y todavía no tiene (Lili, 24/11: «necesito
   ver que tenga todos esos accesos correctamente»). Brando renovó a
   Principals y la solapa Accesos mostraba sólo lo que la app le había
   dado (el curso y el grupo de Principals): lo que le faltaba no se veía
   en ningún lado. Ahora cada curso, grupo y reunión del programa que no
   tiene sale en su bloque, en ámbar, y arriba se dice si tiene todo.

   Cuenta como que lo tiene cualquier fila de la app que no sea un
   «quitado»: lo que se le dio (aunque todavía no haya entrado al grupo)
   o lo que falló (eso ya se ve con su error y su «Reintentar»). Lo que
   alguien le quitó a propósito tampoco se reclama: se ve como «Quitado».
   Todo puro, para probarlo.
   ================================================================== */

export interface AccesoQueFalta { plataforma: PlataformaDeAcceso; recurso: string; nombre: string }

export interface FilaDeAcceso { plataforma: PlataformaDeAcceso; recurso: string; estado: string }

/** Cómo se llama un curso, grupo o reunión: el nombre que se conoce (el título del grupo en Telegram), el del curso en Wisboo, el del
    mail de bienvenida o, si no, su número. */
export function nombreDeAcceso(plataforma: PlataformaDeAcceso, recurso: string, nombres: Record<string, string> = {}): string {
  const conocido = nombres[`${plataforma}:${recurso}`]?.trim();
  if (conocido) return conocido;
  if (plataforma === "wisboo") {
    const curso = PRODUCTOS_WISBOO.find((p) => p.id === recurso)?.nombre;
    if (curso) return curso;
  }
  return explicacionDe(plataforma, recurso)?.nombre ?? recurso;
}

/** Lo que el programa da y el alumno no tiene (en el orden del programa). Sin programa, nada. */
export function accesosQueFaltan(
  programa: Pick<Programa, "wisboo" | "telegram" | "zoom"> | null | undefined,
  tiene: readonly FilaDeAcceso[],
  nombres: Record<string, string> = {},
): AccesoQueFalta[] {
  if (!programa) return [];
  const salida: AccesoQueFalta[] = [];
  for (const plataforma of ["wisboo", "telegram", "zoom"] as const) {
    for (const recurso of programa[plataforma] ?? []) {
      if (tiene.some((x) => x.plataforma === plataforma && x.recurso === recurso)) continue;
      if (salida.some((x) => x.plataforma === plataforma && x.recurso === recurso)) continue;
      salida.push({ plataforma, recurso, nombre: nombreDeAcceso(plataforma, recurso, nombres) });
    }
  }
  return salida;
}

export interface ResumenDelPrograma {
  /* «4 cursos, 6 grupos y 3 reuniones». */
  da: string;
  faltan: number;
  conError: number;
  /* Links de Telegram que todavía no usó. */
  sinEntrar: number;
  tieneTodo: boolean;
}

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El renglón de arriba de la solapa: qué da su programa y si ya tiene todo. */
export function resumenDelPrograma(programa: Pick<Programa, "wisboo" | "telegram" | "zoom">, tiene: readonly FilaDeAcceso[], faltan: readonly AccesoQueFalta[]): ResumenDelPrograma {
  const partes = [
    programa.wisboo.length ? contar(programa.wisboo.length, "curso", "cursos") : "",
    programa.telegram.length ? contar(programa.telegram.length, "grupo", "grupos") : "",
    programa.zoom.length ? contar(programa.zoom.length, "reunión", "reuniones") : "",
  ].filter(Boolean);
  const da = partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
  const delPrograma = (x: FilaDeAcceso) => (programa[x.plataforma] ?? []).includes(x.recurso);
  const conError = tiene.filter((x) => delPrograma(x) && x.estado === "fallo").length;
  const sinEntrar = tiene.filter((x) => delPrograma(x) && x.plataforma === "telegram" && x.estado === "dado").length;
  return { da, faltan: faltan.length, conError, sinEntrar, tieneTodo: faltan.length === 0 && conError === 0 };
}
