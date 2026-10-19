/* ==================================================================
   La guardia de publicación: lo que se le pregunta a Vercel.

   Usa `vercel api`, que hace los pedidos con la sesión de la CLI: el script
   no lee ni guarda ningún token. Hace falta estar en la cuenta que ve el
   equipo `apicanta` (`vercel whoami` → juancruzrusso).
   ================================================================== */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DOMINIO = "apicanta-erp.vercel.app";

/* El proyecto al que apunta la carpeta (.vercel/project.json, que `vercel link` o la copia limpia dejan). */
export function proyectoDe(dir) {
  try {
    const { projectId, orgId } = JSON.parse(readFileSync(join(dir, ".vercel", "project.json"), "utf8"));
    if (projectId && orgId) return { projectId, orgId };
  } catch { /* abajo */ }
  throw new Error(`No encuentro ${join(dir, ".vercel", "project.json")}: sin él, el deploy iría a otro proyecto o preguntaría cuál. Copiá el de la carpeta compartida.`);
}

export function api(ruta) {
  let salida;
  try {
    salida = execFileSync("vercel", ["api", ruta, "--raw", "--non-interactive"], {
      encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const detalle = (e && e.stderr ? String(e.stderr) : String(e)).trim().split("\n").slice(-2).join(" ");
    throw new Error(`vercel api ${ruta.split("?")[0]}: ${detalle || "falló"}. ¿Estás logueado en la cuenta correcta? (vercel whoami)`);
  }
  const inicio = Math.min(...["{", "["].map((c) => { const i = salida.indexOf(c); return i < 0 ? Infinity : i; }));
  return JSON.parse(salida.slice(inicio));
}

const resumen = (d) => ({
  id: d.id, url: d.url, estado: d.readyState, target: d.target, creado: d.createdAt,
  commit: d.meta && d.meta.gitCommitSha, mensaje: d.meta && d.meta.gitCommitMessage,
});

/** El deployment que sirve un dominio (el de producción por defecto). */
export const deployDelDominio = (dominio, teamId) => resumen(api(`/v13/deployments/${dominio}?teamId=${teamId}`));

/** El deployment de producción más nuevo del proyecto (puede estar todavía construyéndose). */
export function ultimoDeProduccion(projectId, teamId) {
  const p = api(`/v9/projects/${projectId}?teamId=${teamId}`);
  const t = p.targets && p.targets.production;
  return t ? { id: t.id, estado: t.readyState } : null;
}

/** El árbol de archivos de un deployment, como lo devuelve la API. */
export const arbolDelDeploy = (id, teamId) => api(`/v6/deployments/${id}/files?teamId=${teamId}`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que el dominio sirva el deployment de producción más nuevo y esté listo.
 * (La CLI a veces dice «no pude confirmar» con el deploy ya READY.)
 */
export async function esperarProduccionLista({ projectId, teamId, dominio = DOMINIO, maximoMs = 8 * 60_000, aviso = () => {} }) {
  const inicio = Date.now();
  for (;;) {
    const servido = deployDelDominio(dominio, teamId);
    const ultimo = ultimoDeProduccion(projectId, teamId);
    if (servido.estado === "ERROR" || servido.estado === "CANCELED" || (ultimo && (ultimo.estado === "ERROR" || ultimo.estado === "CANCELED"))) {
      return { ok: false, motivo: `el deploy terminó en ${ultimo && ultimo.estado !== "READY" ? ultimo.estado : servido.estado}`, servido };
    }
    if (servido.estado === "READY" && (!ultimo || ultimo.id === servido.id)) return { ok: true, servido };
    if (Date.now() - inicio > maximoMs) return { ok: false, motivo: "pasaron 8 minutos y producción no quedó lista", servido };
    aviso(`esperando… sirve ${servido.id} (${servido.estado})${ultimo && ultimo.id !== servido.id ? `, el más nuevo es ${ultimo.id} (${ultimo.estado})` : ""}`);
    await esperar(5000);
  }
}

/**
 * Busca textos en los bundles públicos de una ruta del dominio (los estáticos no piden login):
 * baja el HTML, saca los .js y .css que carga y busca cada texto tal cual.
 */
export async function buscarEnBundles({ dominio = DOMINIO, ruta = "/ajustes", textos }) {
  const html = await (await fetch(`https://${dominio}${ruta}`, { redirect: "follow" })).text();
  const archivos = [...new Set([...html.matchAll(/_next\/static\/[^"'\\\s]+\.(?:js|css)/g)].map((m) => m[0]))];
  const hallado = new Map(textos.map((t) => [t, null]));
  for (let i = 0; i < archivos.length; i += 8) {
    await Promise.all(archivos.slice(i, i + 8).map(async (a) => {
      const cuerpo = await (await fetch(`https://${dominio}/${a}`)).text().catch(() => "");
      for (const t of textos) if (!hallado.get(t) && cuerpo.includes(t)) hallado.set(t, a);
    }));
  }
  return { archivos: archivos.length, hallado };
}
