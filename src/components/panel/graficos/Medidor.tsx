"use client";

import React from "react";
import { pct } from "@/lib/format";

/* Un medidor de media luna: cuánto del 100% está lleno. Es la forma de mirar
   un número que es una foto de hoy (la tasa de mora) y no una serie. */
export function Medidor({ valor, etiqueta, sub }: { valor: number; etiqueta: string; sub?: string }) {
  const lleno = Math.max(0, Math.min(valor, 100));
  const texto = pct(valor, 1);
  const camino = "M 30 118 A 90 90 0 0 1 210 118";
  return (
    <figure className="gr-medidor">
      <svg
        viewBox="0 0 240 150" role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(lleno * 10) / 10} aria-valuetext={`${texto}${sub ? `, ${sub}` : ""}`}
      >
        <path d={camino} pathLength={100} className="gr-medidor__pista" />
        {lleno > 0 && <path d={camino} pathLength={100} className="gr-medidor__valor" strokeDasharray={`${Math.max(lleno, 0.6)} 100`} />}
        {[0, 25, 50, 75, 100].map((t) => {
          /* Las marcas, por fuera del arco. */
          const a = Math.PI - (t / 100) * Math.PI;
          const x1 = 120 + Math.cos(a) * 99, y1 = 118 - Math.sin(a) * 99;
          const x2 = 120 + Math.cos(a) * 106, y2 = 118 - Math.sin(a) * 106;
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className="gr-medidor__marca" />;
        })}
        <text x="120" y="102" textAnchor="middle" className="gr-medidor__numero">{texto}</text>
        <text x="120" y="122" textAnchor="middle" className="gr-medidor__sub">{etiqueta}</text>
        <text x="30" y="142" textAnchor="middle" className="gr-medidor__eje">0%</text>
        <text x="210" y="142" textAnchor="middle" className="gr-medidor__eje">100%</text>
      </svg>
      {sub && <figcaption className="gr-medidor__pie">{sub}</figcaption>}
    </figure>
  );
}
