"use client";

import React from "react";

export function PageHead({ titulo, sub, acciones }: { titulo: string; sub: string; acciones?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        <h1 className="t-h1">{titulo}</h1>
        <p className="page-head__sub">{sub}</p>
      </div>
      {acciones && <div className="page-head__actions">{acciones}</div>}
    </div>
  );
}
