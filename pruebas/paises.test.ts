import test from "node:test";
import assert from "node:assert/strict";
import { infoPais, nombreDePais, normalizarPais, OTRO_PAIS, SIN_PAIS, TODOS_LOS_PAISES } from "@/lib/paises";
import { PAISES as PAISES_PLANILLA } from "@/lib/angelo";
import { PAISES as PAISES_CRM } from "@/lib/crm-tabla";
import { MAPA_ALTO, MAPA_ANCHO, MAPA_PAISES, proyectar } from "@/lib/mapa-mundo";

/* Un país es el mismo escrito como se escriba: sin esto, «México» y «Mexico»
   serían dos barras en el gráfico y la plata de uno desaparecería del otro. */

test("el mismo país escrito de muchas formas es el mismo", () => {
  const igual = (codigo: string, ...textos: string[]) => {
    for (const t of textos) assert.equal(normalizarPais(t), codigo, `«${t}» debería ser ${codigo}`);
  };
  igual("MX", "México", "Mexico", "MEXICO", "mexico", "MX", "mx", "Mx.", "Mejico", "Méjico", "mexicana", "México 🇲🇽", "🇲🇽", "Ciudad de México", "CDMX, Mexico");
  igual("US", "Estados Unidos", "estados unidos", "USA", "U.S.A.", "US", "EE.UU.", "EEUU", "EE. UU.", "E.E.U.U.", "United States", "United States of America", "Estados Unidos de América", "Miami, FL USA", "Nueva York, Estados Unidos");
  igual("DO", "República Dominicana", "Republica Dominicana", "Rep. Dominicana", "Rep Dominicana", "Dominican Republic", "DO", "Santo Domingo, Rep. Dominicana");
  igual("AR", "Argentina", "argentina", "ARG", "AR", "Buenos Aires, Argentina", "Rosario Santa Fe Argentina", "argentino", "Argentina (Córdoba)");
  igual("ES", "España", "Espana", "ESPAÑA", "Spain", "ES", "Madrid - España");
  igual("GB", "Reino Unido", "UK", "U.K.", "Gran Bretaña", "Inglaterra", "England", "Gales", "United Kingdom", "Londres, UK");
  igual("CO", "Colombia", "COLOMBIA", "Columbia", "co", "colombiana", "Bogotá, Colombia");
  igual("BR", "Brasil", "Brazil", "BR", "São Paulo, Brasil");
  igual("NL", "Países Bajos", "Holanda", "Netherlands", "Paises Bajos");
  igual("PE", "Perú", "Peru", "PERU", "PE", "peruano");
  igual("CL", "Chile", "CHILE", "Santiago de Chile");
  igual("CD", "Congo (República Democrática del)", "RD Congo");
  igual("MV", "Islas Maldivas", "Maldivas");
});

test("lo que no tiene nada va a «Sin país», y lo que no se entiende, a «Sin identificar»", () => {
  for (const t of [undefined, null, "", "   ", "-", "—", "N/A", "n/a", "null", "sin dato", "Sin país", "Desconocido"]) {
    assert.equal(normalizarPais(t), SIN_PAIS, `«${t}» no tiene país`);
  }
  for (const t of ["Latinoamérica", "Remoto", "xyzzy", "Internacional", "Atlantis"]) {
    assert.equal(normalizarPais(t), OTRO_PAIS, `«${t}» se escribió pero no es un país`);
  }
  /* Una sigla suelta dentro de un texto no es un país: «no sé» no es Suecia ni Noruega. */
  assert.equal(normalizarPais("no sé"), OTRO_PAIS);
  assert.equal(normalizarPais("es de acá"), OTRO_PAIS);
  assert.equal(nombreDePais(SIN_PAIS), "Sin país");
  assert.equal(nombreDePais(OTRO_PAIS), "Sin identificar");
  assert.equal(nombreDePais("MX"), "México");
});

test("todos los países de la planilla de Angelo y del CRM se reconocen", () => {
  /* Si falta uno, su plata caería en «Sin identificar». */
  const sin = [...PAISES_PLANILLA, ...PAISES_CRM].filter((p) => !infoPais(normalizarPais(p)));
  assert.deepEqual(sin, [], `sin reconocer: ${sin.join(", ")}`);
});

test("cada país tiene su lugar en el mapa y los códigos no se repiten", () => {
  const vistos = new Set<string>();
  for (const p of TODOS_LOS_PAISES) {
    assert.ok(!vistos.has(p.iso), `${p.iso} repetido`);
    vistos.add(p.iso);
    assert.ok(p.lat >= -60 && p.lat <= 85 && p.lon >= -180 && p.lon <= 180, `${p.iso}: ${p.lat}, ${p.lon} fuera del mapa`);
    const [x, y] = proyectar(p.lat, p.lon);
    assert.ok(x >= 0 && x <= MAPA_ANCHO && y >= 0 && y <= MAPA_ALTO, `${p.iso} cae fuera del plano (${x.toFixed(0)}, ${y.toFixed(0)})`);
  }
  /* Los que se dibujan en el mapa son países que la tabla conoce (Antártida no). */
  const sinNombre = Object.keys(MAPA_PAISES).filter((iso) => !infoPais(iso));
  assert.deepEqual(sinNombre, [], `en el mapa pero sin nombre: ${sinNombre.join(", ")}`);
});

test("el mapa pesa poco y ubica bien lo conocido", () => {
  const peso = Object.values(MAPA_PAISES).reduce((a, d) => a + d.length, 0);
  assert.ok(peso < 150_000, `los paths pesan ${peso} caracteres`);
  assert.ok(Object.keys(MAPA_PAISES).length >= 170);
  for (const iso of ["AR", "MX", "US", "ES", "CO", "BR", "CL", "PE", "UY", "EC"]) assert.ok(MAPA_PAISES[iso], `falta ${iso}`);
  /* El ecuador y el meridiano de Greenwich van al medio del mapa; el norte, arriba. */
  const [cx] = proyectar(0, 0);
  assert.ok(Math.abs(cx - MAPA_ANCHO / 2) < 1, `x del meridiano 0: ${cx}`);
  assert.ok(proyectar(60, 0)[1] < proyectar(0, 0)[1] && proyectar(0, 0)[1] < proyectar(-40, 0)[1]);
  /* Buenos Aires queda más al oeste y al sur que Madrid. */
  const ba = proyectar(-34.6, -58.4), mad = proyectar(40.4, -3.7);
  assert.ok(ba[0] < mad[0] && ba[1] > mad[1]);
});

test("ningún país se dibuja con una raya de lado a lado del mapa (Rusia y Fiyi cruzan el antimeridiano)", () => {
  /* Un contorno que salta de 180° a -180° dejaría un segmento larguísimo en el plano. */
  for (const [iso, d] of Object.entries(MAPA_PAISES)) {
    for (const sub of d.split("M").filter(Boolean)) {
      const [inicio, resto] = sub.split("l");
      assert.ok(/^-?[\d.]+,-?[\d.]+$/.test(inicio), `${iso}: arranque raro «${inicio}»`);
      for (const par of (resto ?? "").replace(/z$/, "").trim().split(" ")) {
        const [dx, dy] = par.split(",").map(Number);
        assert.ok(Math.abs(dx) < 250 && Math.abs(dy) < 150, `${iso}: un tramo de ${dx}, ${dy} cruza el mapa`);
      }
    }
  }
  /* Y todo lo dibujado cae dentro del plano. */
  for (const [iso, d] of Object.entries(MAPA_PAISES)) {
    for (const sub of d.split("M").filter(Boolean)) {
      const [inicio, resto] = sub.split("l");
      let [x, y] = inicio.split(",").map(Number);
      for (const par of (resto ?? "").replace(/z$/, "").trim().split(" ")) {
        const [dx, dy] = par.split(",").map(Number);
        x += dx; y += dy;
        assert.ok(x >= -1 && x <= MAPA_ANCHO + 1 && y >= -1 && y <= MAPA_ALTO + 1, `${iso}: un punto cae afuera (${x.toFixed(1)}, ${y.toFixed(1)})`);
      }
    }
  }
});
