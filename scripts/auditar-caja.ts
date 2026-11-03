/* Audita la caja con una copia del estado (el JSON del export de la base): `node --import ./pruebas/registrar.mjs scripts/auditar-caja.ts <estado.json>`.
   Sale con 1 si hay algún error (un arqueo que no concilia). Ver src/lib/auditoria-caja.ts. */
import { readFileSync } from "node:fs";
import { auditarCaja } from "@/lib/auditoria-caja";

const ruta = process.argv[2];
if (!ruta) { console.error("Uso: auditar-caja.ts <estado.json>"); process.exit(2); }
const hallazgos = auditarCaja(JSON.parse(readFileSync(ruta, "utf8")));
if (!hallazgos.length) console.log("✔ La caja no tiene nada para revisar.");
for (const h of hallazgos) {
  console.log(`${h.gravedad === "error" ? "✖" : "⚠"} ${h.titulo}${h.monto !== undefined ? ` (${h.monto})` : ""}\n  ${h.detalle}${h.ids?.length ? `\n  ${h.ids.slice(0, 12).join(", ")}${h.ids.length > 12 ? ` y ${h.ids.length - 12} más` : ""}` : ""}`);
}
process.exit(hallazgos.some((h) => h.gravedad === "error") ? 1 : 0);
