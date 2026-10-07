/* Genera src/lib/mapa-mundo.ts: los países del mundo como paths SVG, de
   Natural Earth 110m (dominio público) vía el paquete npm «world-atlas».

   No es una dependencia de la app: sólo hace falta para regenerar el archivo.
   Se baja a una carpeta temporal, FUERA del repo:

     mkdir /tmp/mapa-tmp && cd /tmp/mapa-tmp && npm init -y
     npm i world-atlas topojson-client i18n-iso-countries
     cd <repo> && MAPA_TMP=/tmp/mapa-tmp node scripts/generar-mapa-mundo.mjs

   Proyección Equal Earth (equivalente en área: Groenlandia no se ve más
   grande que África), recortada entre 84°N y 58°S (sin Antártida). La misma
   función `proyectar` que se escribe en el archivo ubica las burbujas, así
   que cada país y su burbuja salen del mismo cálculo. */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tmp = process.env.MAPA_TMP;
if (!tmp) { console.error("Falta MAPA_TMP: la carpeta donde están world-atlas, topojson-client e i18n-iso-countries."); process.exit(1); }
const req = createRequire(resolve(tmp, "x.js"));
const { feature } = req("topojson-client");
const iso = req("i18n-iso-countries");
const topo = req("world-atlas/countries-110m.json");

const ANCHO = 1000;
const LAT_MAX = 84, LAT_MIN = -58;

/* ---- Equal Earth (Šavrič, Patterson y Jenny, 2018) ---- */
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function equalEarth(lonDeg, latDeg) {
  const l = (lonDeg * Math.PI) / 180, p = (latDeg * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  return [
    (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
    t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
  ];
}
const xMax = equalEarth(180, 0)[0];
const yTop = equalEarth(0, LAT_MAX)[1], yBottom = equalEarth(0, LAT_MIN)[1];
const ESCALA = ANCHO / (2 * xMax);
const ALTO = Math.round((yTop - yBottom) * ESCALA);
const proyectar = (lon, lat) => {
  const [x, y] = equalEarth(lon, lat);
  return [(x + xMax) * ESCALA, (yTop - y) * ESCALA];
};

/* Los tres que Natural Earth separa y no tienen código numérico. */
const EXTRA = { "N. Cyprus": "CY", Somaliland: "SO", Kosovo: "XK" };
const SIN_MAPA = new Set(["AQ", "TF"]);

/* Un anillo que cruza el antimeridiano (Rusia y Fiyi) salta de 180° a -180° y,
   en un plano, dibujaría una raya de lado a lado. Se desenrolla (las longitudes
   siguen de largo) y se parte en dos, una de cada lado. */
function recortarX(anillo, dentro, corte) {
  const salida = [];
  for (let i = 0; i < anillo.length; i++) {
    const a = anillo[i], b = anillo[(i + 1) % anillo.length];
    const da = dentro(a[0]), db = dentro(b[0]);
    if (da) salida.push(a);
    if (da !== db) {
      const t = (corte - a[0]) / (b[0] - a[0]);
      salida.push([corte, a[1] + t * (b[1] - a[1])]);
    }
  }
  return salida;
}
function partirEnAntimeridiano(anillo) {
  let cruza = false;
  for (let i = 1; i < anillo.length; i++) if (Math.abs(anillo[i][0] - anillo[i - 1][0]) > 180) cruza = true;
  if (!cruza) return [anillo];
  const seguido = [];
  let desfase = 0;
  anillo.forEach(([lon, lat], i) => {
    if (i > 0) {
      const d = lon - anillo[i - 1][0];
      if (d > 180) desfase -= 360; else if (d < -180) desfase += 360;
    }
    seguido.push([lon + desfase, lat]);
  });
  const este = recortarX(seguido, (x) => x <= 180, 180);
  const oeste = recortarX(seguido.map(([x, y]) => [x - 360, y]), (x) => x >= -180, -180);
  return [este, oeste].filter((r) => r.length >= 3);
}

const fc = feature(topo, topo.objects.countries);
const porPais = new Map();
for (const f of fc.features) {
  const a2 = (f.id ? iso.numericToAlpha2(f.id) : undefined) ?? EXTRA[f.properties.name];
  if (!a2 || SIN_MAPA.has(a2)) continue;
  const poligonos = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const lista = porPais.get(a2) ?? [];
  for (const poly of poligonos) for (const anillo of poly) lista.push(...partirEnAntimeridiano(anillo));
  porPais.set(a2, lista);
}

/* Un anillo a un path relativo, en décimas de punto: sin arrastrar el
   redondeo, y sin repetir puntos que quedaron iguales. */
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const dec = (n) => { const s = (n / 10).toFixed(1); return s.endsWith(".0") ? s.slice(0, -2) : s; };

function anilloAPath(pts) {
  const q = pts.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
  const limpio = q.filter((p, i) => i === 0 || p[0] !== q[i - 1][0] || p[1] !== q[i - 1][1]);
  if (limpio.length > 1 && limpio[0][0] === limpio[limpio.length - 1][0] && limpio[0][1] === limpio[limpio.length - 1][1]) limpio.pop();
  if (limpio.length < 3) return "";
  let d = `M${dec(limpio[0][0])},${dec(limpio[0][1])}l`;
  const partes = [];
  for (let i = 1; i < limpio.length; i++) partes.push(`${dec(limpio[i][0] - limpio[i - 1][0])},${dec(limpio[i][1] - limpio[i - 1][1])}`);
  return `${d}${partes.join(" ")}z`;
}

const paths = {};
for (const [a2, anillos] of [...porPais.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const proy = anillos
    .map((r) => r.filter(([, lat]) => true).map(([lon, lat]) => proyectar(lon, Math.max(LAT_MIN, Math.min(LAT_MAX, lat)))))
    .map((pts) => ({ pts, a: area(pts) }));
  const mayor = Math.max(...proy.map((x) => x.a));
  /* Las islas de menos de un punto cuadrado no se ven: afuera, salvo la más grande de cada país. */
  const sirven = proy.filter((x) => x.a >= 1 || x.a === mayor);
  if (mayor < 0.05 && !sirven.length) continue;
  const d = sirven.map((x) => anilloAPath(x.pts)).filter(Boolean).join("");
  if (d) paths[a2] = d;
}

const total = Object.values(paths).reduce((a, s) => a + s.length, 0);
const f6 = (n) => Number(n.toPrecision(10));

const salida = `/* GENERADO por scripts/generar-mapa-mundo.mjs — no se edita a mano.

   Los países del mundo como paths SVG (Natural Earth 110m, dominio público,
   vía el paquete npm «world-atlas»), indexados por código ISO de 2 letras.
   Proyección Equal Earth, recortada entre 84°N y 58°S, a ${ANCHO} × ${ALTO}.
   Para regenerarlo: ver el encabezado del script.

   \`proyectar(lat, lon)\` es la misma proyección: ubica las burbujas del mapa
   en el mismo plano que los países. */

export const MAPA_ANCHO = ${ANCHO};
export const MAPA_ALTO = ${ALTO};

const A1 = ${A1}, A2 = ${A2}, A3 = ${A3}, A4 = ${A4}, M = Math.sqrt(3) / 2;
const X_MAX = ${f6(xMax)};
const Y_ARRIBA = ${f6(yTop)};
const ESCALA = ${f6(ESCALA)};

/** Latitud y longitud (grados) → un punto del plano del mapa. */
export function proyectar(lat: number, lon: number): [number, number] {
  const l = (lon * Math.PI) / 180, p = (Math.max(-${-LAT_MIN}, Math.min(${LAT_MAX}, lat)) * Math.PI) / 180;
  const t = Math.asin(M * Math.sin(p)), t2 = t * t, t6 = t2 * t2 * t2;
  const x = (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [(x + X_MAX) * ESCALA, (Y_ARRIBA - y) * ESCALA];
}

/** Cada país: su contorno, por ISO2. Kosovo es «XK». */
export const MAPA_PAISES: Record<string, string> = {
${Object.entries(paths).map(([k, d]) => `  ${k}: ${JSON.stringify(d)},`).join("\n")}
};
`;

const destino = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "mapa-mundo.ts");
writeFileSync(destino, salida);
console.log(`${Object.keys(paths).length} países, ${total} caracteres de path, ${ANCHO}×${ALTO} → ${destino}`);
