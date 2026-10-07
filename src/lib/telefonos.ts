import { normalizarPais, OTRO_PAIS, SIN_PAIS } from "./paises";

/* ==================================================================
   Teléfonos: de lo que escribió una persona, o de lo que dice un grupo
   de WhatsApp, a una clave con la que se pueden comparar.

   El mismo celular se escribe de diez maneras: «+54 9 11 5555-1234»,
   «011 15 5555-1234», «54 11 5555 1234», «1155551234»… y WhatsApp lo
   conoce de una sola: código de país + número, sin signos
   («5491155551234»). Para saber si alguien entró a un grupo hay que
   llevar las dos puntas a la misma forma. Esa forma es la CLAVE.

   Dos cosas distintas, a propósito:

   - `claveInternacional` es para lo que ya trae el código de país (los
     miembros de un grupo, o un texto escrito con «+»): da UNA clave.
   - `clavesDeTelefono` es para lo que escribe una persona, que muchas
     veces no trae el país: da las CLAVES POSIBLES, la más probable
     primero. Para saber si está en un grupo alcanza con que una de
     ellas esté. Una clave inventada de más no puede dar un «unida»
     falso: haría falta que otra persona tenga justo ese número en el
     mismo grupo.

   Las dos rarezas que hay que conocer:
   - Argentina: los celulares llevan un 9 después del 54 (54 9 11…); el
     0 del código de área y el 15 de «celular» se escriben adentro del
     país y no van. Sin el 9 se agrega, con el 0 o el 15 se sacan.
   - México: durante años los celulares llevaron un 1 después del 52
     (521…). Hoy no: se saca.

   Sin dependencias de React ni del servidor: lo usan la pantalla, las
   rutas de /api y las pruebas.
   ================================================================== */

const soloDigitos = (s: string) => s.replace(/\D/g, "");

interface Regla {
  iso: string;
  /** Código de país, sin el +. */
  cc: string;
  /** Largos posibles del número nacional (sin el 0 de marcar adentro del país). */
  largos: number[];
  /** Cómo empieza un celular. Sirve para no inventar candidatos de países
      que nadie nombró cuando el número no trae el código. */
  movil?: RegExp;
  /** Lo que se marca adelante, adentro del país. */
  troncal?: string;
}

/* El orden es el de los candidatos cuando no se sabe de qué país es: el
   negocio es argentino, y después los países de donde vienen los alumnos. */
const REGLAS: Regla[] = [
  { iso: "AR", cc: "54", largos: [10] },
  { iso: "MX", cc: "52", largos: [10] },
  { iso: "CO", cc: "57", largos: [10], movil: /^3/ },
  { iso: "CL", cc: "56", largos: [9], movil: /^9/ },
  { iso: "PE", cc: "51", largos: [9], movil: /^9/ },
  { iso: "UY", cc: "598", largos: [8], movil: /^9/, troncal: "0" },
  { iso: "PY", cc: "595", largos: [9], movil: /^9/, troncal: "0" },
  { iso: "BO", cc: "591", largos: [8], movil: /^[67]/ },
  { iso: "EC", cc: "593", largos: [9], movil: /^9/, troncal: "0" },
  { iso: "VE", cc: "58", largos: [10], movil: /^4/, troncal: "0" },
  { iso: "ES", cc: "34", largos: [9], movil: /^[67]/ },
  { iso: "BR", cc: "55", largos: [11, 10], movil: /^\d{2}9\d{8}$/, troncal: "0" },
  { iso: "US", cc: "1", largos: [10], movil: /^[2-9]/ },
  { iso: "CR", cc: "506", largos: [8], movil: /^[5-8]/ },
  { iso: "PA", cc: "507", largos: [8], movil: /^6/ },
  { iso: "GT", cc: "502", largos: [8], movil: /^[3-5]/ },
  { iso: "SV", cc: "503", largos: [8], movil: /^[67]/ },
  { iso: "HN", cc: "504", largos: [8], movil: /^[389]/ },
  { iso: "NI", cc: "505", largos: [8], movil: /^[578]/ },
  { iso: "PT", cc: "351", largos: [9], movil: /^9/ },
];

/* Países que comparten el +1 (Estados Unidos, Canadá, Puerto Rico, República
   Dominicana…): todos usan la regla de Estados Unidos. */
const NANP = new Set(["US", "CA", "PR", "DO", "JM", "BS", "BB", "TT"]);

function reglaDe(iso: string | undefined): Regla | undefined {
  if (!iso) return undefined;
  return REGLAS.find((r) => r.iso === iso) ?? (NANP.has(iso) ? REGLAS.find((r) => r.iso === "US") : undefined);
}

/* ---------- Argentina ---------- */

/** El número nacional argentino (código de área + abonado, 10 dígitos) desde
    cómo lo escribe la gente: con el 0 del área, con el 15 de celular, con el 9
    del formato internacional. `conAreaPorDefecto`: si el país es seguro, un
    número sin código de área («15 5555-1234» o «5555-1234») es de Buenos Aires. */
function nacionalAR(d: string, conAreaPorDefecto: boolean): string | null {
  let x = d;
  if (x.startsWith("0")) x = x.slice(1);
  /* El 9 de los celulares en formato internacional (54 9 …). */
  if (x.length === 11 && x.startsWith("9")) x = x.slice(1);
  /* Un código de área es 11 o empieza con 2 o con 3: «15…» o «5…» no es un área. */
  const conArea = (n: string) => /^(11|2|3)/.test(n);
  if (x.length === 10) {
    if (conArea(x)) return x;
    return conAreaPorDefecto && x.startsWith("15") ? `11${x.slice(2)}` : null;
  }
  if (x.length === 8) return conAreaPorDefecto ? `11${x}` : null;
  if (x.length === 12) {
    /* Área + 15 + abonado: el 15 está después del área (2 dígitos en Buenos
       Aires; 3 o 4 en el resto del país). */
    for (const a of x.startsWith("11") ? [2] : [3, 4]) {
      if (x.slice(a, a + 2) !== "15") continue;
      const sin = x.slice(0, a) + x.slice(a + 2);
      if (sin.length === 10 && conArea(sin)) return sin;
    }
  }
  return null;
}

/* ---------- México ---------- */

/** El número nacional mexicano (10 dígitos), sin el 01 / 044 / 045 que se
    marcaba antes de la larga distancia y de los celulares. */
function nacionalMX(d: string): string | null {
  let x = d;
  if (x.length === 12 && x.startsWith("01")) x = x.slice(2);
  else if (x.length === 13 && /^04[45]/.test(x)) x = x.slice(3);
  return x.length === 10 ? x : null;
}

/* ---------- Lo que no tiene nada de raro ---------- */

function nacionalGenerico(d: string, r: Regla, seguro: boolean): string | null {
  let x = d;
  if (r.troncal && x.startsWith(r.troncal) && r.largos.includes(x.length - r.troncal.length)) x = x.slice(r.troncal.length);
  if (!r.largos.includes(x.length)) return null;
  /* Si no se sabe de qué país es, sólo lo que parece un celular de ese país. */
  if (!seguro && r.movil && !r.movil.test(x)) return null;
  return x;
}

/** Las claves de un número NACIONAL (sin código de país) para esa regla. Brasil
    puede ser con o sin el 9 de después del área: WhatsApp tiene las dos. */
function claves(d: string, r: Regla, seguro: boolean): string[] {
  const nsn = r.iso === "AR" ? nacionalAR(d, seguro)
    : r.iso === "MX" ? nacionalMX(d)
    : nacionalGenerico(d, r, seguro);
  if (!nsn) return [];
  if (r.iso === "AR") return [`549${nsn}`];
  if (r.iso === "BR" && nsn.length === 11 && nsn[2] === "9") return [`${r.cc}${nsn}`, `${r.cc}${nsn.slice(0, 2)}${nsn.slice(3)}`];
  return [`${r.cc}${nsn}`];
}

/** Lo mismo, si el número ya empieza con el código de ese país (pero sin el +). */
function conCodigo(d: string, r: Regla, seguro: boolean): string[] {
  if (!d.startsWith(r.cc)) return [];
  const resto = d.slice(r.cc.length);
  if (r.iso === "MX" && resto.length === 11 && resto.startsWith("1")) return [`52${resto.slice(1)}`];
  return claves(resto, r, seguro);
}

/* ---------- Lo público ---------- */

/** La clave de un número que ya trae el código de país (el +54…, o los
    dígitos de un WhatsApp): país + número, sin signos. `null` si no es un
    teléfono (muy corto, muy largo, o el id interno «@lid» de WhatsApp). */
export function claveInternacional(texto: string | null | undefined): string | null {
  let t = String(texto ?? "").trim();
  if (!t) return null;
  if (t.includes("@")) {
    /* El id interno de un grupo de WhatsApp no es un teléfono. */
    if (/@lid\b/i.test(t) || /@g\.us\b/i.test(t)) return null;
    t = t.split("@")[0].split(":")[0];
  }
  let d = soloDigitos(t);
  if (/^\s*00/.test(t)) d = d.replace(/^00/, "");
  return internacional(d);
}

function internacional(d: string): string | null {
  if (d.length < 8 || d.length > 15 || d.startsWith("0")) return null;
  if (d.startsWith("54")) {
    const nsn = nacionalAR(d.slice(2), false);
    return nsn ? `549${nsn}` : null;
  }
  if (d.startsWith("52")) {
    const resto = d.slice(2);
    if (resto.length === 11 && resto.startsWith("1")) return `52${resto.slice(1)}`;
    return resto.length === 10 ? d : null;
  }
  return d;
}

function isoDe(pais: string | null | undefined): string | undefined {
  if (!pais) return undefined;
  const iso = normalizarPais(pais);
  return iso === SIN_PAIS || iso === OTRO_PAIS ? undefined : iso;
}

/** Las claves posibles de un teléfono escrito por una persona, la más
    probable primero. `pais` es el país de la persona (texto libre: «Argentina»,
    «MX»…) y ayuda cuando el número no trae el código. Vacío si no se entiende
    como un teléfono. Si trae dos números («11 5555-1234 / 11 4444-3333»), las
    claves de los dos. */
export function clavesDeTelefono(crudo: string | null | undefined, pais?: string | null): string[] {
  const texto = String(crudo ?? "").trim();
  if (!texto) return [];
  const salida: string[] = [];
  for (const parte of texto.split(/[\n/;,|]|\s+y\s+|\s+o\s+/i).map((s) => s.trim()).filter(Boolean)) {
    for (const c of clavesDeUno(parte, pais)) if (!salida.includes(c)) salida.push(c);
  }
  return salida;
}

function clavesDeUno(texto: string, pais: string | null | undefined): string[] {
  let t = texto;
  if (t.includes("@")) {
    if (/@lid\b/i.test(t) || /@g\.us\b/i.test(t)) return [];
    t = t.split("@")[0].split(":")[0];
  }
  let d = soloDigitos(t);
  if (d.length < 7) return [];
  const conMas = /^\s*\+/.test(t) || /^\s*00\d/.test(t);
  if (/^\s*00\d/.test(t)) d = d.replace(/^00/, "");
  if (d.length > 15) return [];

  /* Con el + (o el 00) es internacional: el país no se discute. */
  if (conMas) {
    const c = internacional(d);
    return c ? [c] : [];
  }

  const iso = isoDe(pais);
  const propia = reglaDe(iso);
  const reglas = propia ? [propia, ...REGLAS.filter((r) => r !== propia)] : REGLAS;
  const salida: string[] = [];
  for (const r of reglas) {
    const seguro = r === propia;
    for (const c of [...claves(d, r, seguro), ...conCodigo(d, r, seguro)]) if (!salida.includes(c)) salida.push(c);
  }
  return salida;
}

/** ¿Trae el país? (escrito con el + o el 00, o los dígitos de un WhatsApp). Si
    no, la clave es una apuesta. */
export function traePais(crudo: string | null | undefined): boolean {
  const t = String(crudo ?? "").trim();
  return /^\+/.test(t) || /^00\d/.test(t) || /@s\.whatsapp\.net$/i.test(t);
}

/** Los dígitos tal cual se escribieron. */
export function digitosDe(crudo: string | null | undefined): string {
  return soloDigitos(String(crudo ?? "")).replace(/^00/, "");
}

/** Los dígitos con los que abrir un chat de WhatsApp (wa.me/…) o copiar el
    número. Si el número trae el país o se sabe de qué país es la persona, la
    clave; si no, lo que se escribió: abrir un chat con un número armado a
    ciegas puede llevar a otra persona, y uno sin país sólo dice que no existe. */
export function numeroParaWhatsapp(crudo: string | null | undefined, pais?: string | null): string {
  if (traePais(crudo)) return claveInternacional(crudo) ?? digitosDe(crudo);
  if (isoDe(pais)) return clavesDeTelefono(crudo, pais)[0] ?? digitosDe(crudo);
  return digitosDe(crudo);
}
