"use client";

import React from "react";
import { iniciales } from "@/lib/format";

/* ---------------- Button ---------------- */

type Variante = "primary" | "brand" | "secondary" | "ghost" | "danger";

export function Button({
  variante = "secondary", sm, lg, icono, children, cargando, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante; sm?: boolean; lg?: boolean; icono?: React.ReactNode; cargando?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cargando}
      className={`hk-btn hk-btn--${variante}${sm ? " hk-btn--sm" : ""}${lg ? " hk-btn--lg" : ""}${props.className ? ` ${props.className}` : ""}`}
    >
      {cargando ? <Spinner /> : icono}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={{ animation: "spin 700ms linear infinite" }}>
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </svg>
  );
}

export function IconButton({
  etiqueta, children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { etiqueta: string }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      {...props}
      className={`hk-btn hk-btn--ghost hk-btn--sm${props.className ? ` ${props.className}` : ""}`}
      style={{ padding: 0, width: 32, ...props.style }}
    >
      {children}
    </button>
  );
}

/* ---------------- Badge ---------------- */

export type VarianteBadge = "neutral" | "brand" | "accent" | "success" | "danger" | "warning" | "info";

export function Badge({ variante = "neutral", icono, children }: {
  variante?: VarianteBadge; icono?: React.ReactNode; children: React.ReactNode;
}) {
  return <span className={`hk-badge hk-badge--${variante}`}>{icono}{children}</span>;
}

/* ---------------- Card ---------------- */

export function Card({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`hk-card${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function CardHead({ titulo, sub, acciones }: { titulo: string; sub?: string; acciones?: React.ReactNode }) {
  return (
    <div className="card-head">
      <div style={{ minWidth: 0 }}>
        <h2 className="card-head__title">{titulo}</h2>
        {sub && <p className="card-head__sub">{sub}</p>}
      </div>
      {acciones && <div className="spacer" style={{ display: "flex", gap: 8 }}>{acciones}</div>}
    </div>
  );
}

/* ---------------- StatCard ---------------- */

export function StatCard({ etiqueta, valor, delta, direccion = "neutral", contexto, hero, ayuda }: {
  etiqueta: string; valor: string; delta?: string;
  direccion?: "up" | "down" | "accent" | "neutral";
  contexto?: string; hero?: boolean; ayuda?: string;
}) {
  return (
    <div className={`hk-card hk-stat${hero ? " hk-stat--hero" : ""}`} title={ayuda}>
      <span className="hk-stat__label">{etiqueta}</span>
      <span className="hk-stat__value">{valor}</span>
      <span className="hk-stat__meta">
        {delta && <span className={`hk-stat__delta${direccion !== "neutral" ? ` hk-stat__delta--${direccion}` : ""}`}>{delta}</span>}
        {contexto && <span>{contexto}</span>}
      </span>
    </div>
  );
}

/* ---------------- Campos de formulario ---------------- */

export function Field({ label, ayuda, error, children, span2 }: {
  label: string; ayuda?: string; error?: string; children: React.ReactNode; span2?: boolean;
}) {
  return (
    <div className={`hk-field${span2 ? " span-2" : ""}`}>
      <label className="hk-label">{label}</label>
      {children}
      {(error || ayuda) && <span className={`hk-help${error ? " hk-help--error" : ""}`}>{error || ayuda}</span>}
    </div>
  );
}

export function Input({ icono, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icono?: React.ReactNode; error?: boolean }) {
  return (
    <div className={`hk-input${error ? " hk-input--error" : ""}`}>
      {icono}
      <input {...props} />
    </div>
  );
}

export function Textarea({ rows = 3, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="hk-input hk-input--area">
      <textarea rows={rows} {...props} />
    </div>
  );
}

export function Select({ opciones, placeholder, error, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & {
  opciones: readonly (string | { valor: string; texto: string })[]; placeholder?: string; error?: boolean;
}) {
  return (
    <div className={`hk-input hk-input--select${error ? " hk-input--error" : ""}`}>
      <select {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {opciones.map((o) => {
          const v = typeof o === "string" ? o : o.valor;
          const t = typeof o === "string" ? o : o.texto;
          return <option key={v} value={v}>{t}</option>;
        })}
      </select>
    </div>
  );
}

export function Switch({ checked, onChange, etiqueta }: { checked: boolean; onChange: (v: boolean) => void; etiqueta: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={etiqueta}
      className="switch" onClick={() => onChange(!checked)}
    />
  );
}

/* ---------------- Chip filtro ---------------- */

export function Chip({ activo, onClick, children, count }: {
  activo: boolean; onClick: () => void; children: React.ReactNode; count?: number;
}) {
  return (
    <button type="button" className="chip" aria-pressed={activo} onClick={onClick}>
      {children}
      {count !== undefined && <span className="chip__count">{count}</span>}
    </button>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs<T extends string>({ valor, onChange, opciones }: {
  valor: T; onChange: (v: T) => void; opciones: readonly { valor: T; texto: string }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {opciones.map((o) => (
        <button
          key={o.valor} role="tab" type="button"
          aria-selected={valor === o.valor}
          className="tab"
          onClick={() => onChange(o.valor)}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Avatar / Persona ---------------- */

export function Avatar({ nombre, size = 32 }: { nombre: string; size?: number }) {
  return (
    <span className="hk-avatar" style={{ width: size, height: size, fontSize: size < 30 ? 11 : 12 }}>
      {iniciales(nombre)}
    </span>
  );
}

export function Persona({ nombre, sub, size }: { nombre: string; sub?: string; size?: number }) {
  return (
    <span className="hk-person">
      <Avatar nombre={nombre} size={size} />
      <span style={{ minWidth: 0 }}>
        <span className="hk-person__name" style={{ display: "block" }}>{nombre}</span>
        {sub && <span className="hk-person__sub" style={{ display: "block" }}>{sub}</span>}
      </span>
    </span>
  );
}

/* ---------------- Empty state ---------------- */

export function Empty({ icono, titulo, texto, accion }: {
  icono: React.ReactNode; titulo: string; texto: string; accion?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__ico">{icono}</span>
      <span className="empty__title">{titulo}</span>
      <p className="empty__text">{texto}</p>
      {accion && <div style={{ marginTop: 4 }}>{accion}</div>}
    </div>
  );
}

/* ---------------- Barra de progreso ---------------- */

export function Bar({ valor, tono = "brand" }: { valor: number; tono?: "brand" | "accent" | "success" | "danger" }) {
  const v = Math.max(0, Math.min(100, valor));
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar__fill${tono !== "brand" ? ` bar__fill--${tono}` : ""}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ---------------- Ayuda contextual ---------------- */

export function Ayuda({ titulo, children, icono }: { titulo: string; children: React.ReactNode; icono: React.ReactNode }) {
  return (
    <div className="help-card">
      {icono}
      <div>
        <div className="help-card__title">{titulo}</div>
        <div className="help-card__text">{children}</div>
      </div>
    </div>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="tag">{children}</span>;
}
