import test from "node:test";
import assert from "node:assert/strict";
import { aNumero, importarCSV, leerCSV } from "@/lib/pasarelas";
import { adivinarMapeo, emailValido, instanteDe, leerFecha } from "@/lib/registros-webinar";
import { fechasEnTexto, sugerirWebinar, validarCuerpoGrupo } from "@/lib/whatsapp";
import { normalizarTelefono } from "@/lib/telefonos";
import { clavesDeTelefono } from "@/lib/telefonos-wpp";
import { normalizarPais } from "@/lib/paises";
import { aniosDeTexto, canalDeEvento, nivelDeIngles } from "@/lib/calendly";
import { esDeMeta } from "@/lib/meta-creativo";
import { leerUtm, slugUtm } from "@/lib/utm-estandar";
import { nombreSeguro } from "@/lib/meta-descarga";
import { normalizarEmail, normalizarNombre } from "@/lib/capi-datos";
import { leerReunion } from "@/lib/fathom";
import { clasificarMercury } from "@/lib/mercury";
import { cuentaDeContraparte } from "@/lib/traspasos";

/* ==================================================================
   ESTRÉS · strings gigantes (100 mil caracteres) en todos los parsers
   puros del frente «la entrada de datos de afuera»: ninguno tira ni
   tarda más de un segundo (sin expresiones regulares que exploten).
   ================================================================== */

const N = 100_000;
const PATRONES: Record<string, string> = {
  letras: "a".repeat(N), puntos: "a.".repeat(N / 2), espacios: " ".repeat(N), digitos: "1".repeat(N), guiones: "-".repeat(N), mezcla: "1/2-3.".repeat(N / 6),
  arrobas: "a@".repeat(N / 2), comillas: '"'.repeat(N), comas: ",".repeat(N), tildes: "é".repeat(N), de: "de de de ".repeat(N / 9), meses: "enero ".repeat(N / 6),
  barras: "/".repeat(N), url: `https://${"a.".repeat(N / 2)}x`, mailLargo: `a@${"b.".repeat(N / 2)}`, nulos: "\u0000".repeat(N), emojis: "😀".repeat(N / 2),
};

const FUNCIONES: Record<string, (s: string) => unknown> = {
  leerCSV, importarCSV: (s) => importarCSV(`id,Fecha,Monto,Estado\n${s},2026-01-01,100,paid`, "stripe", undefined), aNumero,
  leerFecha: (s) => leerFecha(s), instanteDe: (s) => instanteDe(s), adivinarMapeo: (s) => adivinarMapeo([s, s]), emailValido, fechasEnTexto,
  sugerirWebinar: (s) => sugerirWebinar(s, [{ id: "w", titulo: "Webinar de Python largo", fecha: "2026-10-14T22:00:00Z" }]),
  validarCuerpoGrupo: (s) => validarCuerpoGrupo({ grupo: { id: "120363025246125486@g.us", nombre: s }, evento: "foto", participantes: [s] }),
  normalizarTelefono: (s) => normalizarTelefono(s), clavesDeTelefono: (s) => clavesDeTelefono(s), normalizarPais, nivelDeIngles, aniosDeTexto, canalDeEvento, esDeMeta,
  leerUtm: (s) => leerUtm({ utm_campaign: s, utm_source: s }), slugUtm, nombreSeguro, normalizarNombre, normalizarEmail,
  leerReunion: (s) => leerReunion({ title: s, recording_id: s }),
  clasificarMercury: (s) => clasificarMercury({ counterpartyName: s, externalMemo: s, bankDescription: s, status: "sent", amount: 1 }),
  cuentaDeContraparte,
};

test("ningún parser puro tira ni tarda más de un segundo con 100 mil caracteres de letras, puntos, comillas, comas, arrobas, barras, meses, nulos o emojis", () => {
  const lentos: string[] = [];
  for (const [nombre, f] of Object.entries(FUNCIONES)) {
    for (const [forma, texto] of Object.entries(PATRONES)) {
      const t0 = performance.now();
      try { f(texto); } catch (e) { assert.fail(`${nombre}(${forma}) tiró: ${e instanceof Error ? e.message : e}`); }
      const ms = performance.now() - t0;
      if (ms > 1000) lentos.push(`${nombre}(${forma}): ${Math.round(ms)} ms`);
    }
  }
  assert.deepEqual(lentos, []);
});
