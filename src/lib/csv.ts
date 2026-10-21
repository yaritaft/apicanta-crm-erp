/* ==================================================================
   CSV, para bajar lo que se ve en una tabla.

   Con comillas dobles en cada campo y «""» para una comilla, como lo esperan
   Excel y las herramientas que importan (ManyChat). El archivo lleva la marca
   de orden de bytes (BOM) para que Excel lea bien las tildes y los emojis.
   ================================================================== */

const campo = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** El texto del CSV: una cabecera y una fila por registro. Un valor que empieza con = + - @ se deja como texto (no se ejecuta como fórmula en Excel). */
export function csvDe(cabecera: readonly string[], filas: readonly (readonly unknown[])[]): string {
  const seguro = (v: unknown) => {
    const t = String(v ?? "");
    return /^[=+\-@]/.test(t) && !/^\+\d[\d\s]*$/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t) ? `'${t}` : t;
  };
  return [cabecera.map(campo).join(","), ...filas.map((f) => f.map((v) => campo(seguro(v))).join(","))].join("\r\n");
}

/** Baja el CSV como archivo (sólo en el navegador). */
export function bajarCsv(nombre: string, texto: string): void {
  const blob = new Blob(["﻿", texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.endsWith(".csv") ? nombre : `${nombre}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
