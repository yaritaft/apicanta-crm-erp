/* Líneas de teléfono al azar con su forma canónica y varias formas de escribirlas (Argentina, México,
   Colombia, España, Chile, Perú, Uruguay, Estados Unidos y Brasil). Las usan las pruebas de teléfonos y
   la de WhatsApp. No es una prueba (no termina en .test.ts). */
import type { Azar } from "./azar";

export interface Linea {
  iso: string; pais: string; cc: string; nacional: string;
  /** Formas con «+» o «00»: el país se discute poco. */
  conMas: string[];
  /** Formas con el código pero sin «+» (como las deja un Excel que se comió el signo). */
  conCodigo: string[];
  /** Formas nacionales (sin el código): hace falta saber el país. */
  locales: string[];
}

const grupos = (n: string, partes: number[]) => { let i = 0; return partes.map((k) => { const x = n.slice(i, i + k); i += k; return x; }).filter(Boolean).join(" "); };

export type Gen = (az: Azar) => Linea;

const AREAS_AR = ["11", "351", "341", "261", "223", "221", "379", "2901", "3564", "2966", "387", "381"];
export const argentina: Gen = (az) => {
  const area = az.pick(AREAS_AR);
  const sub = az.digitos(10 - area.length, String(az.int(2, 9)));
  const n = area + sub;
  const g = sub.length > 4 ? `${sub.slice(0, sub.length - 4)}-${sub.slice(-4)}` : sub;
  return {
    iso: "AR", pais: "Argentina", cc: "54", nacional: n,
    conMas: [`+54 9 ${area} ${g}`, `+549${n}`, `+54 ${area} ${g}`, `0054 9 ${area} ${g}`, `+54 9 (${area}) ${g}`],
    conCodigo: [`549${n}`, `54 9 ${area} ${sub}`, `54${n}`],
    locales: [`0${area} 15 ${g}`, `${area} 15 ${g}`, `(0${area}) 15-${g}`, `${area} ${g}`, n, `0${area}${sub}`, `9${n}`, `${area}-${sub}`],
  };
};
export const mexico: Gen = (az) => {
  const n = az.digitos(10, String(az.int(2, 9)));
  return {
    iso: "MX", pais: "México", cc: "52", nacional: n,
    conMas: [`+52 ${grupos(n, [2, 4, 4])}`, `+52 1 ${grupos(n, [2, 4, 4])}`, `+52${n}`, `+521${n}`, `0052${n}`],
    conCodigo: [`52${n}`, `521${n}`],
    locales: [n, `01 ${n}`, grupos(n, [2, 4, 4]), `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`],
  };
};
export const colombia: Gen = (az) => {
  const n = az.digitos(10, "3");
  return {
    iso: "CO", pais: "Colombia", cc: "57", nacional: n,
    conMas: [`+57${n}`, `+57 ${grupos(n, [3, 3, 4])}`, `0057${n}`, `+57-${n}`, `+57 (${n.slice(0, 3)}) ${n.slice(3)}`],
    conCodigo: [`57${n}`, `57 ${grupos(n, [3, 3, 4])}`],
    locales: [n, grupos(n, [3, 3, 4]), `(${n.slice(0, 3)}) ${n.slice(3)}`],
  };
};
export const espana: Gen = (az) => {
  const n = az.digitos(9, String(az.int(6, 7)));
  return {
    iso: "ES", pais: "España", cc: "34", nacional: n,
    conMas: [`+34${n}`, `+34 ${grupos(n, [3, 3, 3])}`, `0034${n}`],
    conCodigo: [`34${n}`, `34 ${grupos(n, [3, 3, 3])}`],
    locales: [n, grupos(n, [3, 3, 3]), `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5, 7)}-${n.slice(7)}`],
  };
};
export const chile: Gen = (az) => {
  const n = az.digitos(9, "9");
  return { iso: "CL", pais: "Chile", cc: "56", nacional: n, conMas: [`+56${n}`, `+56 ${grupos(n, [1, 4, 4])}`], conCodigo: [`56${n}`], locales: [n, grupos(n, [1, 4, 4])] };
};
export const peru: Gen = (az) => {
  const n = az.digitos(9, "9");
  return { iso: "PE", pais: "Perú", cc: "51", nacional: n, conMas: [`+51${n}`, `+51 ${grupos(n, [3, 3, 3])}`], conCodigo: [`51${n}`], locales: [n, grupos(n, [3, 3, 3])] };
};
export const uruguay: Gen = (az) => {
  const n = az.digitos(8, "9");
  return { iso: "UY", pais: "Uruguay", cc: "598", nacional: n, conMas: [`+598${n}`, `+598 ${grupos(n, [2, 3, 3])}`], conCodigo: [`598${n}`], locales: [n, `0${n}`, grupos(n, [2, 3, 3])] };
};
export const usa: Gen = (az) => {
  const n = az.digitos(10, String(az.int(2, 9)));
  return {
    iso: "US", pais: "Estados Unidos", cc: "1", nacional: n,
    conMas: [`+1${n}`, `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`, `+1 ${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`],
    conCodigo: [`1${n}`, `1 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`],
    locales: [n, `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`, `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`],
  };
};
export const brasil: Gen = (az) => {
  const n = "11" + az.digitos(9, "9");
  return { iso: "BR", pais: "Brasil", cc: "55", nacional: n, conMas: [`+55${n}`, `+55 ${n.slice(0, 2)} ${n.slice(2, 7)}-${n.slice(7)}`], conCodigo: [`55${n}`], locales: [n, `0${n}`, `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`] };
};

export const GENERADORES: Gen[] = [argentina, mexico, colombia, espana, chile, peru, uruguay, usa, brasil];

/* La clave canónica de la agenda (telefonos.ts: «54» + 10 dígitos) y la del lector de WhatsApp (telefonos-wpp.ts: «549» + 10). */
export const claveAgenda = (l: Linea) => `${l.cc}${l.nacional}`;
export const claveLector = (l: Linea) => (l.iso === "AR" ? `549${l.nacional}` : `${l.cc}${l.nacional}`);

