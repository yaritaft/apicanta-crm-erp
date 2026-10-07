/* ==================================================================
   Teléfonos: el mismo número escrito de mil formas.

   Yari (02/10): «primero trato de machearlos por mail; si no, por teléfono,
   que por teléfono también es porque viste que con código de área, sin
   código de área, con el más, sin el más… pero todo eso es inteligente».

   El mismo celular argentino aparece como +54 9 11 5123-4567, 54911 5123 4567,
   011 15 5123-4567, 11 5123 4567, (11) 15-5123-4567 o 5123-4567. Acá se lleva
   a una CLAVE: código de país + número nacional sin el 0 de marcado, sin el 15
   y sin el 9 de los celulares argentinos. Dos números con la misma clave son
   la misma línea. Si no se sabe el país (sin «+» y sin dato), no hay clave
   completa y la comparación queda en «parcial».

   Lógica pura: sin React ni base, para el navegador y el servidor.
   ================================================================== */

/* País → código de llamada y largos del número nacional (sin el 0 de marcado
   ni el 15). Sólo los que se ven en la gente que se anota. */
interface PaisTel { iso: string; cc: string; largos: number[] }
const PAISES_TEL: PaisTel[] = [
  { iso: "AR", cc: "54", largos: [10, 11] },
  { iso: "MX", cc: "52", largos: [10, 11, 12] },
  { iso: "CO", cc: "57", largos: [10] },
  { iso: "CL", cc: "56", largos: [9] },
  { iso: "PE", cc: "51", largos: [9] },
  { iso: "UY", cc: "598", largos: [8, 9] },
  { iso: "PY", cc: "595", largos: [9] },
  { iso: "BO", cc: "591", largos: [8] },
  { iso: "EC", cc: "593", largos: [9] },
  { iso: "VE", cc: "58", largos: [10] },
  { iso: "CR", cc: "506", largos: [8] },
  { iso: "PA", cc: "507", largos: [8] },
  { iso: "GT", cc: "502", largos: [8] },
  { iso: "SV", cc: "503", largos: [8] },
  { iso: "HN", cc: "504", largos: [8] },
  { iso: "NI", cc: "505", largos: [8] },
  { iso: "BR", cc: "55", largos: [10, 11] },
  { iso: "ES", cc: "34", largos: [9] },
  { iso: "IT", cc: "39", largos: [9, 10] },
  { iso: "FR", cc: "33", largos: [9] },
  { iso: "DE", cc: "49", largos: [10, 11] },
  { iso: "GB", cc: "44", largos: [10] },
  /* Estados Unidos, Canadá y el Caribe de plan norteamericano (República
     Dominicana, Puerto Rico): +1 y diez dígitos. */
  { iso: "US", cc: "1", largos: [10] },
];

/* De más largo a más corto: «598» antes que «59» y «1». */
const POR_PREFIJO = [...PAISES_TEL].sort((a, b) => b.cc.length - a.cc.length);
const POR_ISO = new Map(PAISES_TEL.map((p) => [p.iso, p]));

/** El código de llamada de un país por su ISO de 2 letras («AR» → «54»). */
export const codigoDePais = (iso?: string | null): string | undefined => (iso ? POR_ISO.get(iso.toUpperCase())?.cc : undefined);

export interface TelefonoNormalizado {
  /** Todos los dígitos tal cual vinieron (sin «+» ni «00» de adelante). */
  digitos: string;
  /** Código de país, si se pudo saber («54»). */
  cc?: string;
  /** El número nacional canónico: sin 0 de marcado, sin 15 y sin el 9 argentino. */
  nacional: string;
  /** La clave para comparar: `cc + nacional`. Sólo si se sabe el país. */
  clave?: string;
  /** Los últimos 8 dígitos: lo que queda «sin código de área». */
  local: string;
  /** El número con país, «+5491151234567»: para mostrar y para WhatsApp. */
  e164?: string;
  /** Si el largo es el de un teléfono (7 a 15 dígitos). */
  valido: boolean;
}

/* Quita el 0 de marcado y el 15 de los celulares argentinos:
   0 11 15 5123 4567 → 11 5123 4567. */
function nacionalArgentino(n: string): string {
  let x = n.replace(/^0+/, "");
  /* Con el 9 de los celulares internacionales (54 9 …): 11 dígitos → 10. */
  if (x.length === 11 && x.startsWith("9")) return x.slice(1);
  /* Con el 15 de adelante del abonado: el código de área tiene 2, 3 o 4
     dígitos y el total, 10. Se prueba con el más corto que calce («11» sólo
     si empieza con 11). */
  if (x.length === 12) {
    for (const a of x.startsWith("11") ? [2] : [3, 4, 2]) {
      if (x.slice(a, a + 2) === "15") return x.slice(0, a) + x.slice(a + 2);
    }
  }
  /* Sin el código de área pero con el 15 de adelante (15 5123 4567): lo que queda. */
  if (x.length === 10 && x.startsWith("15")) return x.slice(2);
  return x;
}

/* México: el 1 de los celulares de antes (+52 1 …) y el 044/045 de marcado. */
function nacionalMexicano(n: string): string {
  let x = n.replace(/^0+/, "");
  if (/^4[45]/.test(x) && x.length === 12) x = x.slice(2);
  if (x.length === 11 && x.startsWith("1")) return x.slice(1);
  return x;
}

function canonico(pais: PaisTel | undefined, n: string): string {
  if (pais?.iso === "AR") return nacionalArgentino(n);
  if (pais?.iso === "MX") return nacionalMexicano(n);
  if (!pais) {
    /* Sin país: la gente que se anota es casi toda argentina, así que si con
       las reglas argentinas queda un número de 10 dígitos, es ése. */
    const ar = nacionalArgentino(n);
    if (ar.length === 10) return ar;
  }
  return n.replace(/^0+/, "");
}

/** Lleva un teléfono escrito de cualquier forma a su clave. `pais` es el ISO
 *  del país de la persona (para los números sin código de país): sin eso, y
 *  sin «+» ni «00» de adelante, se intenta reconocer por el prefijo. */
export function normalizarTelefono(crudo: string | null | undefined, pais?: string | null): TelefonoNormalizado {
  const texto = (crudo ?? "").trim();
  const conMas = /^(\+|00)/.test(texto);
  const digitos = texto.replace(/\D/g, "").replace(/^00/, "");
  const vacio: TelefonoNormalizado = { digitos, nacional: digitos, local: digitos.slice(-8), valido: false };
  if (digitos.length < 7 || digitos.length > 15) return vacio;

  /* 1. Con «+» o «00»: el prefijo manda. */
  let elegido: PaisTel | undefined;
  let resto = digitos;
  if (conMas) {
    elegido = POR_PREFIJO.find((p) => digitos.startsWith(p.cc));
    if (elegido) resto = digitos.slice(elegido.cc.length);
  } else {
    /* 2. Sin «+»: el país de la persona, si el número no trae ya su prefijo. */
    const dado = pais ? POR_ISO.get(pais.toUpperCase()) : undefined;
    const trae = dado && digitos.startsWith(dado.cc) && (digitos.length > 11 || (dado.largos.includes(digitos.length - dado.cc.length) && !dado.largos.includes(digitos.length))) ? dado : undefined;
    if (dado) {
      elegido = dado;
      if (trae) resto = digitos.slice(dado.cc.length);
    } else {
      /* 3. Ni «+» ni país: se reconoce el prefijo sólo si el largo lo confirma
         (un 54 y diez dígitos es un argentino; un número de 10 dígitos que
         empieza con 54 no). */
      const p = POR_PREFIJO.find((x) => digitos.startsWith(x.cc) && x.largos.includes(digitos.length - x.cc.length)
        && digitos.length > 10 && !(x.cc === "1" && digitos.length !== 11));
      if (p) { elegido = p; resto = digitos.slice(p.cc.length); }
    }
  }

  const nacional = canonico(elegido, resto);
  /* Un número con el largo equivocado (por ejemplo sin el código de área) no
     tiene clave completa: sólo se puede comparar por sus últimos dígitos. */
  const clave = elegido && elegido.largos.includes(nacional.length) ? `${elegido.cc}${nacional}` : undefined;
  return {
    digitos, cc: clave ? elegido?.cc : undefined, nacional, clave, local: nacional.slice(-8), e164: clave ? `+${clave}` : undefined, valido: true,
  };
}

/** La clave de un teléfono, o undefined si no se sabe el país o no es un teléfono. */
export const claveTelefono = (crudo: string | null | undefined, pais?: string | null): string | undefined =>
  normalizarTelefono(crudo, pais).clave;

export type CoincideTelefono = "igual" | "parcial" | "no";

/** ¿Es el mismo teléfono? «igual»: la misma línea (aunque uno venga con «+54 9»
 *  y el otro sin país). «parcial»: sólo coinciden los últimos 8 dígitos, que
 *  es lo que queda sin código de área: puede ser otra persona. */
export function compararTelefonos(a: string | null | undefined, b: string | null | undefined, paisA?: string | null, paisB?: string | null): CoincideTelefono {
  const x = normalizarTelefono(a, paisA);
  const y = normalizarTelefono(b, paisB);
  if (!x.valido || !y.valido) return "no";
  if (x.clave && y.clave) return x.clave === y.clave ? "igual" : "no";
  /* Uno sin país: se compara el número nacional, que ya viene sin 0, 15 ni 9. */
  if (x.nacional === y.nacional && x.nacional.length >= 9) return "igual";
  if (x.local === y.local && x.local.length === 8) return "parcial";
  return "no";
}

/** Los dígitos para el link de WhatsApp (wa.me/…). Los celulares argentinos
 *  llevan el 9 después del 54; el resto, el número con país. Sin país conocido,
 *  los dígitos tal cual. */
export function digitosWhatsapp(crudo: string | null | undefined, pais?: string | null): string {
  const n = normalizarTelefono(crudo, pais);
  if (!n.valido) return "";
  if (!n.clave) return n.digitos.replace(/^0+/, "");
  return n.cc === "54" ? `549${n.nacional}` : n.clave;
}

/** «+54 9 11 5123 4567» para leer: el país, y el resto en grupos. */
export function telefonoLegible(crudo: string | null | undefined, pais?: string | null): string {
  const n = normalizarTelefono(crudo, pais);
  if (!n.valido) return (crudo ?? "").trim();
  if (!n.cc) return (crudo ?? "").trim();
  /* En Argentina, el área: 11 (2 dígitos) o 3 dígitos. El resto, en dos. */
  const area = n.cc === "54" && n.nacional.length === 10 ? n.nacional.slice(0, n.nacional.startsWith("11") ? 2 : 3) : "";
  const resto = n.nacional.slice(area.length).replace(/(\d+)(\d{4})$/, "$1 $2");
  return `+${n.cc}${n.cc === "54" ? " 9" : ""} ${area ? `${area} ` : ""}${resto}`;
}
