/* ==================================================================
   Países: del texto libre al código ISO, con su nombre y su lugar en el mapa.

   «País» es un campo de texto: llega de la planilla de Angelo (la lista de su
   hoja Configuración), del formulario del webinar, de Calendly, de Meta o
   escrito a mano. Para sumar por país hay que decir que «México», «Mexico»,
   «MX» y «mejico» son el mismo. Esto lo hace sin perder la plata:

   - lo que se reconoce va a su país (ISO de 2 letras);
   - lo que está escrito pero no se reconoce va a «otro» (Sin identificar), y
     queda a la vista qué decía, para corregirlo;
   - lo que no tiene nada va a «sin» (Sin país).

   Cada país trae el centroide (latitud y longitud) donde se escribe su nombre en el mapa y se ancla su tooltip
   en el mapa del Dashboard.
   ================================================================== */

/** Lo que no tiene país cargado. */
export const SIN_PAIS = "sin";
/** Lo que tiene algo escrito que no se reconoce como un país. */
export const OTRO_PAIS = "otro";

export interface InfoPais {
  iso: string;
  nombre: string;
  lat: number;
  lon: number;
}

/* [ISO, nombre, latitud, longitud, otros nombres separados con |]. Los otros
   nombres son los que se escriben de verdad: en inglés, abreviados, con el
   gentilicio o con la ortografía de otro lado. Los códigos ISO2 y los nombres
   oficiales se agregan solos. Sin tildes ni mayúsculas: se comparan normalizados. */
type Fila = [iso: string, nombre: string, lat: number, lon: number, otros?: string];

const FILAS: Fila[] = [
  /* América */
  ["AR", "Argentina", -38.4, -63.6, "arg|argentino|argentinos|argentine|republica argentina"],
  ["BO", "Bolivia", -16.7, -64.7, "bol|boliviano|boliviana|estado plurinacional de bolivia"],
  ["BR", "Brasil", -10.8, -52.9, "bra|brazil|brasileno|brasilena|brasilero|brasilera|brazilian"],
  ["CL", "Chile", -35.7, -71.5, "chl|chileno|chilena|republica de chile"],
  ["CO", "Colombia", 4.6, -74.1, "col|columbia|colombiano|colombiana|republica de colombia"],
  ["CR", "Costa Rica", 9.9, -84.2, "cri|costarricense"],
  ["CU", "Cuba", 21.5, -79.0, "cub|cubano|cubana"],
  ["DO", "República Dominicana", 18.9, -70.2, "dom|rep dominicana|rep dom|dominicana|dominicano|dominican republic"],
  ["EC", "Ecuador", -1.4, -78.4, "ecu|ecuatoriano|ecuatoriana"],
  ["SV", "El Salvador", 13.7, -88.9, "slv|salvador|salvadoreno|salvadorena"],
  ["GT", "Guatemala", 15.6, -90.3, "gtm|guatemalteco|guatemalteca"],
  ["HN", "Honduras", 14.8, -86.6, "hnd|hondureno|hondurena"],
  ["HT", "Haití", 18.9, -72.7, "hti"],
  ["MX", "México", 23.6, -102.5, "mex|mejico|mexicano|mexicana|estados unidos mexicanos|cdmx"],
  ["NI", "Nicaragua", 12.9, -85.0, "nic|nicaraguense"],
  ["PA", "Panamá", 8.5, -80.1, "pan|panameno|panamena"],
  ["PY", "Paraguay", -23.2, -58.4, "pry|paraguayo|paraguaya"],
  ["PE", "Perú", -9.2, -75.0, "per|peruano|peruana"],
  ["PR", "Puerto Rico", 18.2, -66.5, "pri|puertorriqueno|puertorriquena"],
  ["UY", "Uruguay", -32.8, -56.0, "ury|uruguayo|uruguaya"],
  ["VE", "Venezuela", 7.1, -66.2, "ven|venezolano|venezolana"],
  ["US", "Estados Unidos", 39.8, -98.6, "usa|u s a|u s|eeuu|ee uu|e e u u|estados unidos de america|united states|united states of america|estadounidense"],
  ["CA", "Canadá", 56.1, -106.3, "can|canadiense"],
  ["JM", "Jamaica", 18.1, -77.3, "jam"],
  ["TT", "Trinidad y Tobago", 10.4, -61.2, "tto|trinidad|trinidad and tobago"],
  ["BS", "Bahamas", 24.7, -77.9, "bhs"],
  ["BZ", "Belice", 17.2, -88.7, "blz|belize"],
  ["GY", "Guyana", 4.9, -58.9, "guy"],
  ["SR", "Surinam", 4.0, -56.0, "sur|suriname"],
  ["BB", "Barbados", 13.2, -59.5, "brb"],
  ["AW", "Aruba", 12.5, -70.0, "abw"],
  ["CW", "Curazao", 12.2, -69.0, "cuw|curacao"],
  ["KY", "Islas Caimán", 19.3, -81.2, "cym|cayman islands|caiman"],
  ["BM", "Bermudas", 32.3, -64.8, "bmu|bermuda"],
  ["GL", "Groenlandia", 72.0, -40.0, "grl|greenland"],
  ["FK", "Islas Malvinas", -51.8, -59.5, "flk|malvinas|falkland islands|falklands"],

  /* Europa */
  ["ES", "España", 40.2, -3.7, "esp|spain|espanol|espanola|reino de espana"],
  ["PT", "Portugal", 39.6, -8.0, "prt|portugues|portuguesa"],
  ["FR", "Francia", 46.6, 2.5, "fra|france|frances|francesa"],
  ["DE", "Alemania", 51.1, 10.4, "deu|ger|germany|deutschland|aleman|alemana"],
  ["IT", "Italia", 42.8, 12.6, "ita|italy|italiano|italiana"],
  ["GB", "Reino Unido", 54.0, -2.5, "gbr|uk|u k|united kingdom|gran bretana|great britain|britain|inglaterra|england|escocia|scotland|gales|wales|irlanda del norte|northern ireland"],
  ["IE", "Irlanda", 53.2, -8.0, "irl|ireland|eire"],
  ["NL", "Países Bajos", 52.2, 5.3, "nld|holanda|netherlands|the netherlands"],
  ["BE", "Bélgica", 50.6, 4.7, "bel|belgium"],
  ["LU", "Luxemburgo", 49.8, 6.1, "lux|luxembourg"],
  ["CH", "Suiza", 46.8, 8.2, "che|switzerland|schweiz"],
  ["AT", "Austria", 47.6, 14.1, "aut"],
  ["SE", "Suecia", 62.0, 15.0, "swe|sweden|sverige"],
  ["NO", "Noruega", 62.0, 9.5, "nor|norway"],
  ["DK", "Dinamarca", 56.0, 9.5, "dnk|denmark"],
  ["FI", "Finlandia", 64.0, 26.0, "fin|finland"],
  ["IS", "Islandia", 64.9, -18.6, "isl|iceland"],
  ["PL", "Polonia", 52.1, 19.4, "pol|poland"],
  ["CZ", "República Checa", 49.8, 15.5, "cze|chequia|czechia|czech republic"],
  ["SK", "Eslovaquia", 48.7, 19.7, "svk|slovakia"],
  ["HU", "Hungría", 47.2, 19.4, "hun|hungary"],
  ["RO", "Rumania", 45.9, 24.9, "rou|romania"],
  ["BG", "Bulgaria", 42.7, 25.2, "bgr"],
  ["GR", "Grecia", 39.1, 22.9, "grc|greece"],
  ["HR", "Croacia", 45.1, 15.5, "hrv|croatia"],
  ["SI", "Eslovenia", 46.1, 14.8, "svn|slovenia"],
  ["RS", "Serbia", 44.0, 20.8, "srb"],
  ["BA", "Bosnia y Herzegovina", 44.2, 17.8, "bih|bosnia"],
  ["ME", "Montenegro", 42.8, 19.3, "mne"],
  ["MK", "Macedonia del Norte", 41.6, 21.7, "mkd|macedonia"],
  ["AL", "Albania", 41.1, 20.0, "alb"],
  ["XK", "Kosovo", 42.6, 20.9, "kos"],
  ["UA", "Ucrania", 49.0, 31.4, "ukr|ukraine"],
  ["BY", "Bielorrusia", 53.5, 28.0, "blr|belarus"],
  ["MD", "Moldavia", 47.2, 28.5, "mda|moldova"],
  ["LT", "Lituania", 55.3, 23.9, "ltu|lithuania"],
  ["LV", "Letonia", 56.9, 24.9, "lva|latvia"],
  ["EE", "Estonia", 58.7, 25.5, "est"],
  ["RU", "Rusia", 61.5, 98.0, "rus|russia|russian federation|federacion rusa"],
  ["TR", "Turquía", 39.0, 35.2, "tur|turkey|turkiye"],
  ["CY", "Chipre", 35.0, 33.2, "cyp|cyprus"],
  ["MT", "Malta", 35.9, 14.4, "mlt"],
  ["AD", "Andorra", 42.5, 1.6, "and"],
  ["MC", "Mónaco", 43.7, 7.4, "mco|monaco"],
  ["LI", "Liechtenstein", 47.2, 9.5, "lie"],

  /* Asia y Medio Oriente */
  ["IL", "Israel", 31.0, 34.9, "isr"],
  ["PS", "Palestina", 31.9, 35.2, "pse|palestine|cisjordania|franja de gaza"],
  ["LB", "Líbano", 33.9, 35.9, "lbn|lebanon"],
  ["JO", "Jordania", 31.2, 36.8, "jor|jordan"],
  ["SA", "Arabia Saudita", 24.0, 45.0, "sau|saudi arabia|arabia saudi"],
  ["AE", "Emiratos Árabes Unidos", 23.8, 54.3, "are|uae|u a e|emiratos arabes|emiratos|united arab emirates|dubai|abu dabi"],
  ["QA", "Catar", 25.3, 51.2, "qat|qatar"],
  ["KW", "Kuwait", 29.3, 47.5, "kwt"],
  ["OM", "Omán", 21.5, 55.9, "omn|oman"],
  ["BH", "Baréin", 26.0, 50.55, "bhr|bahrein|bahrain"],
  ["IQ", "Irak", 33.0, 43.7, "irq|iraq"],
  ["IR", "Irán", 32.4, 53.7, "irn|iran"],
  ["SY", "Siria", 35.0, 38.5, "syr|syria"],
  ["YE", "Yemen", 15.6, 48.0, "yem"],
  ["AF", "Afganistán", 33.9, 67.7, "afg|afghanistan"],
  ["PK", "Pakistán", 30.4, 69.3, "pak|pakistan"],
  ["IN", "India", 22.0, 79.0, "ind"],
  ["BD", "Bangladés", 23.7, 90.3, "bgd|bangladesh"],
  ["LK", "Sri Lanka", 7.9, 80.7, "lka"],
  ["NP", "Nepal", 28.4, 84.1, "npl"],
  ["BT", "Bután", 27.5, 90.4, "btn|bhutan"],
  ["MV", "Maldivas", 3.2, 73.2, "mdv|islas maldivas|maldives"],
  ["CN", "China", 35.0, 103.0, "chn|republica popular china"],
  ["HK", "Hong Kong", 22.3, 114.2, "hkg"],
  ["TW", "Taiwán", 23.7, 121.0, "twn"],
  ["JP", "Japón", 36.2, 138.3, "jpn|japan"],
  ["KR", "Corea del Sur", 36.5, 127.9, "kor|south korea|korea del sur|corea|republica de corea"],
  ["KP", "Corea del Norte", 40.3, 127.2, "prk|north korea"],
  ["MN", "Mongolia", 46.9, 103.8, "mng"],
  ["KZ", "Kazajistán", 48.0, 67.0, "kaz|kazakhstan|kazajstan"],
  ["UZ", "Uzbekistán", 41.4, 64.6, "uzb|uzbekistan"],
  ["KG", "Kirguistán", 41.2, 74.8, "kgz|kyrgyzstan|kirguizistan"],
  ["TJ", "Tayikistán", 38.9, 71.3, "tjk|tajikistan"],
  ["TM", "Turkmenistán", 39.0, 59.6, "tkm|turkmenistan"],
  ["AZ", "Azerbaiyán", 40.3, 47.7, "aze|azerbaijan"],
  ["AM", "Armenia", 40.1, 45.0, "arm"],
  ["GE", "Georgia", 42.3, 43.4, "geo"],
  ["TH", "Tailandia", 15.9, 101.0, "tha|thailand"],
  ["VN", "Vietnam", 16.2, 107.8, "vnm|viet nam"],
  ["LA", "Laos", 19.9, 102.5, "lao"],
  ["KH", "Camboya", 12.6, 104.9, "khm|cambodia"],
  ["MM", "Myanmar", 21.9, 96.0, "mmr|birmania|burma"],
  ["MY", "Malasia", 4.2, 102.0, "mys|malaysia"],
  ["SG", "Singapur", 1.35, 103.8, "sgp|singapore"],
  ["ID", "Indonesia", -2.5, 118.0, "idn"],
  ["PH", "Filipinas", 12.9, 121.8, "phl|philippines"],
  ["BN", "Brunéi", 4.5, 114.7, "brn|brunei"],
  ["TL", "Timor Oriental", -8.8, 125.7, "tls|timor leste"],

  /* África */
  ["EG", "Egipto", 26.8, 30.8, "egy|egypt"],
  ["MA", "Marruecos", 31.8, -7.1, "mar|morocco"],
  ["DZ", "Argelia", 28.0, 2.6, "dza|algeria"],
  ["TN", "Túnez", 33.9, 9.5, "tun|tunisia"],
  ["LY", "Libia", 26.3, 17.2, "lby|libya"],
  ["SD", "Sudán", 15.6, 30.2, "sdn|sudan"],
  ["SS", "Sudán del Sur", 7.3, 30.0, "ssd|south sudan"],
  ["ET", "Etiopía", 9.1, 40.5, "eth|ethiopia"],
  ["ER", "Eritrea", 15.2, 39.8, "eri"],
  ["DJ", "Yibuti", 11.8, 42.6, "dji|djibouti"],
  ["SO", "Somalia", 5.2, 46.2, "som|somaliland"],
  ["KE", "Kenia", 0.2, 37.9, "ken|kenya"],
  ["TZ", "Tanzania", -6.4, 34.9, "tza"],
  ["UG", "Uganda", 1.4, 32.3, "uga"],
  ["RW", "Ruanda", -1.9, 29.9, "rwa|rwanda"],
  ["BI", "Burundi", -3.4, 29.9, "bdi"],
  ["NG", "Nigeria", 9.1, 8.7, "nga"],
  ["GH", "Ghana", 7.9, -1.0, "gha"],
  ["SN", "Senegal", 14.5, -14.5, "sen"],
  ["ML", "Malí", 17.6, -4.0, "mli|mali"],
  ["MR", "Mauritania", 21.0, -10.9, "mrt"],
  ["NE", "Níger", 17.6, 8.1, "ner|niger"],
  ["TD", "Chad", 15.5, 18.7, "tcd"],
  ["BF", "Burkina Faso", 12.2, -1.6, "bfa"],
  ["CI", "Costa de Marfil", 7.5, -5.5, "civ|ivory coast|cote d ivoire"],
  ["GN", "Guinea", 9.9, -9.7, "gin"],
  ["GW", "Guinea-Bisáu", 12.0, -15.2, "gnb|guinea bissau|guinea bisau"],
  ["GM", "Gambia", 13.4, -15.3, "gmb"],
  ["SL", "Sierra Leona", 8.5, -11.8, "sle|sierra leone"],
  ["LR", "Liberia", 6.4, -9.4, "lbr"],
  ["TG", "Togo", 8.6, 0.8, "tgo"],
  ["BJ", "Benín", 9.3, 2.3, "ben|benin"],
  ["CM", "Camerún", 7.4, 12.4, "cmr|cameroon"],
  ["CF", "República Centroafricana", 6.6, 20.9, "caf|centroafricana"],
  ["GA", "Gabón", -0.8, 11.6, "gab|gabon"],
  ["GQ", "Guinea Ecuatorial", 1.65, 10.27, "gnq|equatorial guinea"],
  ["CG", "Congo", -0.7, 15.2, "cog|republica del congo|congo brazzaville"],
  ["CD", "RD del Congo", -2.9, 23.7, "cod|rd congo|rdc|drc|congo kinshasa|republica democratica del congo|congo republica democratica del"],
  ["AO", "Angola", -11.2, 17.9, "ago"],
  ["ZM", "Zambia", -13.1, 27.8, "zmb"],
  ["ZW", "Zimbabue", -19.0, 29.2, "zwe|zimbabwe"],
  ["MW", "Malaui", -13.3, 34.3, "mwi|malawi"],
  ["MZ", "Mozambique", -18.7, 35.5, "moz"],
  ["NA", "Namibia", -22.6, 17.1, "nam"],
  ["BW", "Botsuana", -22.3, 24.7, "bwa|botswana"],
  ["ZA", "Sudáfrica", -29.0, 25.1, "zaf|south africa"],
  ["LS", "Lesoto", -29.6, 28.2, "lso|lesotho"],
  ["SZ", "Esuatini", -26.5, 31.5, "swz|suazilandia|eswatini|swaziland"],
  ["MG", "Madagascar", -18.8, 46.9, "mdg"],
  ["MU", "Mauricio", -20.3, 57.6, "mus|mauritius"],
  ["CV", "Cabo Verde", 16.0, -24.0, "cpv|cape verde"],
  ["EH", "Sahara Occidental", 24.2, -12.9, "esh|western sahara"],

  /* Oceanía */
  ["AU", "Australia", -25.7, 134.5, "aus"],
  ["NZ", "Nueva Zelanda", -41.5, 172.5, "nzl|new zealand|nueva zelandia"],
  ["PG", "Papúa Nueva Guinea", -6.3, 144.0, "png|papua new guinea"],
  ["FJ", "Fiyi", -17.7, 178.1, "fji|fiji"],
  ["VU", "Vanuatu", -16.0, 167.0, "vut"],
  ["SB", "Islas Salomón", -9.6, 160.2, "slb|solomon islands"],
  ["NC", "Nueva Caledonia", -21.3, 165.5, "ncl|new caledonia"],
];

export const TODOS_LOS_PAISES: InfoPais[] = FILAS.map(([iso, nombre, lat, lon]) => ({ iso, nombre, lat, lon }));
const PORISO = new Map(TODOS_LOS_PAISES.map((p) => [p.iso, p]));

/** El país de un código ISO de 2 letras (o undefined). */
export function infoPais(iso: string): InfoPais | undefined {
  return PORISO.get(iso);
}

/** Cómo se llama en pantalla lo que devuelve normalizarPais. */
export function nombreDePais(clave: string): string {
  if (clave === SIN_PAIS) return "Sin país";
  if (clave === OTRO_PAIS) return "Sin identificar";
  return PORISO.get(clave)?.nombre ?? clave;
}

/* ---------- Normalizar ---------- */

const sinMarcas = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/* Minúsculas, sin tildes y con todo lo que no es letra ni número hecho espacio:
   «EE.UU.», «Rep. Dominicana» y «México!» quedan «ee uu», «rep dominicana» y «mexico». */
const claveDe = (s: string) => sinMarcas(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

interface Indices {
  /* Nombres y otros nombres: se buscan también dentro de un texto más largo
     («Buenos Aires, Argentina»). */
  nombres: Map<string, string>;
  /* Códigos y siglas de 2 o 3 letras: sólo si el texto, o una parte entera de
     él, es eso. Una «se» suelta en «no sé» no es Suecia. */
  codigos: Map<string, string>;
}

let INDICES: Indices | null = null;

/* Siglas que no se confunden con una palabra: valen aun dentro de un texto
   («Miami, FL USA»). */
const SIGLAS_SEGURAS = new Set(["usa", "u s a", "uae", "u a e", "uk", "u k", "ee uu", "e e u u", "eeuu"]);

function indices(): Indices {
  if (INDICES) return INDICES;
  const nombres = new Map<string, string>();
  const codigos = new Map<string, string>();
  const poner = (m: Map<string, string>, texto: string, iso: string) => {
    const k = claveDe(texto);
    if (!k) return;
    if (!m.has(k)) m.set(k, iso);
    /* Sin espacios también: «eeuu» y «e e u u» son lo mismo. */
    const junta = k.replace(/ /g, "");
    if (junta !== k && !m.has(junta)) m.set(junta, iso);
  };
  for (const [iso, nombre, , , otros] of FILAS) {
    poner(nombres, nombre, iso);
    codigos.set(iso.toLowerCase(), iso);
    for (const o of otros ? otros.split("|") : []) {
      /* De 3 letras o menos, o letras sueltas: un código o una sigla, no un nombre. */
      const sigla = !SIGLAS_SEGURAS.has(o) && (o.length <= 3 || /^([a-z] )+[a-z]$/.test(o));
      poner(sigla ? codigos : nombres, o, iso);
    }
  }
  INDICES = { nombres, codigos };
  return INDICES;
}

/* Lo que se escribe cuando no hay país. */
const VACIOS = new Set(["", "n a", "na", "null", "undefined", "none", "ninguno", "ninguna", "sin dato", "sin datos", "sin pais", "no especificado", "desconocido", "unknown"]);

/* La bandera de un emoji (dos letras regionales) → su código ISO. */
const BANDERA = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
const deBandera = (texto: string): string | null => {
  const m = texto.match(BANDERA);
  if (!m) return null;
  return [...m[0]].map((c) => String.fromCharCode((c.codePointAt(0) ?? 0) - 0x1f1e6 + 65)).join("");
};

/** El país de un texto libre: su código ISO de 2 letras, `OTRO_PAIS` si hay
 *  algo escrito que no se reconoce, `SIN_PAIS` si no hay nada. Entiende
 *  español e inglés, con o sin tildes, códigos («MX», «USA»), siglas
 *  («EE.UU.») y un país escrito junto a una ciudad («Rosario, Argentina»). */
export function normalizarPais(texto: string | null | undefined): string {
  const crudo = (texto ?? "").trim();
  if (!crudo) return SIN_PAIS;
  const bandera = deBandera(crudo);
  if (bandera && PORISO.has(bandera)) return bandera;

  const k = claveDe(crudo);
  if (VACIOS.has(k)) return SIN_PAIS;
  const { nombres, codigos } = indices();

  /* El texto entero. */
  const entero = nombres.get(k) ?? codigos.get(k) ?? nombres.get(k.replace(/ /g, "")) ?? codigos.get(k.replace(/ /g, ""));
  if (entero) return entero;

  /* Con una ciudad o algo más: lo que va después de cada coma, barra o guion
     (el país va casi siempre al final)… */
  const partes = crudo.split(/[,;/|()·\-–—]+/).map(claveDe).filter(Boolean);
  if (partes.length > 1) {
    for (const p of [...partes].reverse()) {
      const hit = nombres.get(p) ?? codigos.get(p) ?? nombres.get(p.replace(/ /g, ""));
      if (hit) return hit;
    }
  }
  /* …o las palabras sueltas, de a hasta cuatro, empezando por el final. */
  const palabras = k.split(" ");
  for (let n = Math.min(4, palabras.length); n >= 1; n--) {
    for (let i = palabras.length - n; i >= 0; i--) {
      const hit = nombres.get(palabras.slice(i, i + n).join(" "));
      if (hit) return hit;
    }
  }
  return k ? OTRO_PAIS : SIN_PAIS;
}
