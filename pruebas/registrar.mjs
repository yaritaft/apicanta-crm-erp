/* Deja correr el código de src/ con el corredor de pruebas de node
   (npm test): resuelve el alias «@/» y las importaciones sin extensión, y
   pasa los .ts por el compilador de TypeScript (node no acepta
   propiedades en el constructor). */
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as rutaDe } from "node:path";
import ts from "typescript";

const raiz = rutaDe(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(especificador, contexto, siguiente) {
    /* Las rutas de /api importan «next/server» sin la extensión: el empaquetador
       de Next lo entiende y el ESM de node no. */
    if (especificador === "next/server") return siguiente("next/server.js", contexto);
    let ruta = null;
    if (especificador.startsWith("@/")) ruta = rutaDe(raiz, "src", especificador.slice(2));
    else if ((especificador.startsWith("./") || especificador.startsWith("../")) && contexto.parentURL?.startsWith("file:")) {
      ruta = rutaDe(dirname(fileURLToPath(contexto.parentURL)), especificador);
    }
    if (ruta) {
      if (/\.(ts|tsx)$/.test(ruta) && existsSync(ruta)) return { url: pathToFileURL(ruta).href, shortCircuit: true };
      if (!/\.(m?js|json)$/.test(ruta)) {
        for (const e of EXTENSIONES) if (existsSync(ruta + e)) return { url: pathToFileURL(ruta + e).href, shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
  load(url, contexto, siguiente) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const ruta = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(ruta, "utf8"), {
        fileName: ruta,
        compilerOptions: {
          module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true, isolatedModules: true,
        },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return siguiente(url, contexto);
  },
});
