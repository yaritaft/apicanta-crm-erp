import React from "react";

/* ==================================================================
   Markdown chico y seguro, para los resúmenes que arma Fathom: títulos,
   listas (con sangría), párrafos, negrita, cursiva, código y links. Se
   arman elementos de React (nada de HTML crudo) y un link sólo se sigue
   si es http o https.
   ================================================================== */

const LINK_SEGURO = /^https?:\/\//i;

/* **negrita**, *cursiva* o _cursiva_, `código` y [texto](url). */
const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)/g;

function enLinea(texto: string, clave: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let desde = 0;
  let i = 0;
  for (const m of texto.matchAll(INLINE)) {
    const pos = m.index ?? 0;
    if (pos > desde) out.push(texto.slice(desde, pos));
    const k = `${clave}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[6]) {
      out.push(LINK_SEGURO.test(m[7])
        ? <a key={k} className="link" href={m[7]} target="_blank" rel="noopener noreferrer">{m[6]}</a>
        : <span key={k}>{m[6]}</span>);
    } else if (m[9]) out.push(<em key={k}>{m[9]}</em>);
    else if (m[11]) out.push(<em key={k}>{m[11]}</em>);
    desde = pos + m[0].length;
  }
  if (desde < texto.length) out.push(texto.slice(desde));
  return out;
}

type Bloque =
  | { tipo: "titulo"; nivel: number; texto: string }
  | { tipo: "item"; nivel: number; texto: string; numero?: string }
  | { tipo: "parrafo"; texto: string };

function bloques(md: string): Bloque[] {
  const out: Bloque[] = [];
  for (const cruda of md.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.replace(/\s+$/, "");
    if (!linea.trim()) continue;
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linea.trim());
    if (titulo) { out.push({ tipo: "titulo", nivel: titulo[1].length, texto: titulo[2] }); continue; }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linea);
    if (item) {
      out.push({ tipo: "item", nivel: Math.min(4, Math.floor(item[1].replace(/\t/g, "  ").length / 2)), texto: item[3], numero: /\d/.test(item[2]) ? item[2] : undefined });
      continue;
    }
    const ultimo = out[out.length - 1];
    if (ultimo?.tipo === "parrafo") ultimo.texto += ` ${linea.trim()}`;
    else out.push({ tipo: "parrafo", texto: linea.trim() });
  }
  return out;
}

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={`md${className ? ` ${className}` : ""}`}>
      {bloques(texto).map((b, i) => {
        const k = `b${i}`;
        if (b.tipo === "titulo") {
          const Tag = (b.nivel <= 2 ? "h4" : "h5") as "h4" | "h5";
          return <Tag key={k} className="md__titulo">{enLinea(b.texto, k)}</Tag>;
        }
        if (b.tipo === "item") {
          return (
            <div key={k} className="md__item" style={{ paddingLeft: 16 + b.nivel * 16 }}>
              <span className="md__vineta" aria-hidden>{b.numero ?? "•"}</span>
              <span>{enLinea(b.texto, k)}</span>
            </div>
          );
        }
        return <p key={k} className="md__parrafo">{enLinea(b.texto, k)}</p>;
      })}
    </div>
  );
}
