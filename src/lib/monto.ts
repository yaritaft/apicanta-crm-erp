/* ==================================================================
   Plata en un campo de texto, con los puntos de miles a medida que se
   escribe («1.234.567,50»).

   Hay dos mitades:
   - leerMonto / escribirMonto: del texto al número y al revés. Aceptan
     lo que escribe alguien de acá y lo que llega de otro teclado.
   - escribirEnCampo / textoDeMonto: lo que se ve en el campo mientras se
     escribe. Usan la convención de acá: el punto separa los miles y la
     coma, los decimales.
   ================================================================== */

/* Un monto como lo escribe alguien de acá: "145.000", "1.500,50", "1500,5"
   o "1500.5". Un input numérico del navegador lee "145.000" como 145, y en
   pesos eso es un error de mil veces. Con un solo punto y tres cifras
   detrás, el punto es de miles; si no, es la coma decimal de otro teclado. */
export function leerMonto(texto: string): number {
  const t = texto.trim().replace(/\s|US\$|\$/gi, "");
  if (!t) return NaN;
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  let limpio: string;
  if (coma >= 0 && punto >= 0) {
    /* Los dos: el que va último es el decimal. */
    limpio = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (coma >= 0) {
    limpio = (t.match(/,/g) ?? []).length > 1 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (punto >= 0) {
    const partes = t.split(".");
    const miles = partes.length > 2 || (partes[0].length > 0 && partes[1].length === 3);
    limpio = miles ? t.replace(/\./g, "") : t;
  } else {
    limpio = t;
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : NaN;
}

/* El camino inverso, para precargar un monto al editar: coma decimal y sin
   separador de miles, así leerMonto lo vuelve a leer igual. */
export function escribirMonto(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: 4, useGrouping: false }) : "";
}

/* ---------------- Lo que se ve en el campo ---------------- */

export interface OpcionesMonto {
  /** Cuántos decimales deja escribir: 2 para plata, 4 para un tipo de
   *  cambio, 0 para enteros. */
  decimales?: number;
  /** Deja empezar con «-». */
  negativos?: boolean;
}

/** Cómo llegó el cambio al campo. */
export interface OrigenDelCambio {
  /** El texto que había antes del cambio. */
  anterior?: string;
  /** Lo que se tecleó, si fue una sola tecla. */
  tecla?: string | null;
  /** Se pegó o se arrastró un texto de afuera. */
  pegado?: boolean;
}

const agrupar = (digitos: string) => digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const esDigito = (c: string) => c >= "0" && c <= "9";
const cuantas = (s: string, c: string) => s.split(c).length - 1;

/* Dónde está el separador decimal en `s` (-1 si no hay).
   - Teclear «,» o «.»: es el decimal, si todavía no había uno. Todo punto
     que ya estaba lo puso el propio campo para separar miles.
   - Teclear cifras o borrar: sólo la coma es decimal. Los puntos son los de
     los miles que puso el campo.
   - Pegar un texto de afuera: el último separador es el decimal ("1.234,56"
     y "1,234.56"), y un punto solo es decimal salvo que lo sigan tres cifras. */
function dondeEstaElDecimal(s: string, cursor: number, decimales: number, origen: OrigenDelCambio): number {
  if (decimales <= 0) return -1;
  const { anterior = "", tecla, pegado } = origen;
  const comas: number[] = [];
  const puntos: number[] = [];
  for (let i = 0; i < s.length; i++) { if (s[i] === ",") comas.push(i); else if (s[i] === ".") puntos.push(i); }

  if ((tecla === "," || tecla === ".") && cursor >= 1 && (s[cursor - 1] === "," || s[cursor - 1] === ".")) {
    /* Ya había una coma: la nueva tecla no suma otra. */
    if (anterior.includes(",")) {
      const viejas = comas.filter((i) => i !== cursor - 1);
      return viejas.length ? viejas[viejas.length - 1] : -1;
    }
    return cursor - 1;
  }

  if (pegado) {
    if (comas.length && puntos.length) return Math.max(comas[comas.length - 1], puntos[puntos.length - 1]);
    if (comas.length === 1) return comas[0];
    if (puntos.length === 1) {
      const detras = s.slice(puntos[0] + 1).replace(/\D/g, "").length;
      return detras === 3 ? -1 : puntos[0];
    }
    return -1;
  }

  return comas.length ? comas[comas.length - 1] : -1;
}

/** Lo que pasa cuando alguien escribe, borra o pega en el campo: el texto
 *  ya con sus puntos de miles y dónde queda el cursor. `crudo` es lo que
 *  tiene el input después del cambio y `cursor`, dónde quedó. */
export function escribirEnCampo(
  crudo: string, cursor: number, opciones: OpcionesMonto & OrigenDelCambio = {},
): { texto: string; cursor: number } {
  const decimales = opciones.decimales ?? 2;
  const negativos = opciones.negativos ?? false;
  const marcador = dondeEstaElDecimal(crudo, cursor, decimales, opciones);
  const negativo = negativos && /^\s*-/.test(crudo);

  let enteros = "";
  let decs = "";
  let pasado = false;
  for (let i = 0; i < crudo.length; i++) {
    if (i === marcador) { pasado = true; continue; }
    const c = crudo[i];
    if (esDigito(c)) { if (pasado) decs += c; else enteros += c; }
  }
  const ent = enteros.replace(/^0+(?=\d)/, "");
  const dec = decs.slice(0, decimales);
  const hayDecimal = marcador >= 0;

  let texto = negativo ? "-" : "";
  if (ent !== "") texto += agrupar(ent); else if (hayDecimal) texto += "0";
  if (hayDecimal) texto += "," + dec;

  /* El cursor: la misma cantidad de cifras antes que antes. */
  let enterosAntes = 0;
  let decimalesAntes = 0;
  let paso = false;
  for (let i = 0; i < Math.min(cursor, crudo.length); i++) {
    if (i === marcador) { paso = true; continue; }
    if (esDigito(crudo[i])) { if (paso) decimalesAntes++; else enterosAntes++; }
  }
  const iComa = texto.indexOf(",");
  let pos: number;
  if (hayDecimal && marcador < cursor && iComa >= 0) {
    pos = iComa + 1 + Math.min(decimalesAntes, dec.length);
  } else {
    const fin = iComa >= 0 ? iComa : texto.length;
    const objetivo = Math.min(enterosAntes, ent.length);
    pos = negativo ? 1 : 0;
    let vistos = 0;
    while (pos < fin && vistos < objetivo) { if (texto[pos] !== ".") vistos++; pos++; }
  }
  return { texto, cursor: pos };
}

/** Un monto que viene de afuera (un número, o un texto como "1234,5" o
 *  "1.234,5") como se ve en el campo: "1.234,5". Vacío si no es un monto. */
export function textoDeMonto(v: number | string | null | undefined, opciones: OpcionesMonto = {}): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    const [ent, dec = ""] = Math.abs(v).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 6 }).split(".");
    return (v < 0 ? "-" : "") + agrupar(ent) + (dec ? "," + dec : "");
  }
  if (!v.trim()) return "";
  /* Es un texto de acá o de afuera: se deja como dice, sólo con sus puntos. */
  return escribirEnCampo(v, v.length, { negativos: true, ...opciones, pegado: true, decimales: Math.max(opciones.decimales ?? 0, 8) }).texto;
}

/** ¿Es el mismo monto? «1234,5» y «1.234,5» sí. Vacío y 0 también: hay
 *  campos que guardan 0 cuando están vacíos y no tienen que pisarse. */
export function mismoMonto(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  const n = (x: number | string | null | undefined) => {
    if (x === null || x === undefined) return 0;
    const v = typeof x === "number" ? x : leerMonto(x);
    return Number.isFinite(v) ? v : 0;
  };
  return n(a) === n(b);
}

/** El monto de un campo como número: vacío o ilegible es 0. Para los campos
 *  que guardan un número y no tienen «sin dato». */
export function montoDe(texto: string): number {
  const n = leerMonto(texto);
  return Number.isFinite(n) ? n : 0;
}
