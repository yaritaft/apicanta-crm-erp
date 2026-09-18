"use client";

import React, { useState } from "react";
import { ArrowRight, Check, Mail } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/ui";
import { enviarMagicLink } from "@/lib/auth";

export function Login() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"pidiendo" | "enviando" | "enviado">("pidiendo");
  const [error, setError] = useState("");

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!email.includes("@")) { setError("Ingresá un email con @"); return; }
    setError(""); setEstado("enviando");
    const r = await enviarMagicLink(email);
    if (r.ok) setEstado("enviado");
    else { setEstado("pidiendo"); setError(r.error ?? "No pudimos enviar el enlace. Probá de nuevo."); }
  }

  return (
    <div className="login">
      <div className="login__caja">
        <div className="login__marca">Apicanta<em>.</em></div>

        {estado === "enviado" ? (
          <>
            <span className="login__ico login__ico--ok"><Check size={26} /></span>
            <h1 className="t-h2" style={{ marginBottom: 8 }}>Revisá tu correo</h1>
            <p className="t-body t-muted" style={{ marginBottom: 24 }}>
              Le mandamos un enlace a <strong style={{ color: "var(--ink)" }}>{email}</strong>.
              Abrilo desde este mismo dispositivo y entrás directo — no hay contraseña que recordar.
            </p>
            <Button variante="secondary" onClick={() => { setEstado("pidiendo"); setEmail(""); }}>
              Usar otro correo
            </Button>
          </>
        ) : (
          <>
            <span className="login__ico"><Mail size={24} /></span>
            <h1 className="t-h2" style={{ marginBottom: 8 }}>Entrá a Apicanta</h1>
            <p className="t-body t-muted" style={{ marginBottom: 24 }}>
              Poné tu correo y te mandamos un enlace para entrar. Sin contraseñas.
            </p>

            <form onSubmit={entrar} className="stack-4" style={{ textAlign: "left" }}>
              <Field label="Tu correo" error={error}>
                <Input
                  type="email" value={email} autoFocus autoComplete="email"
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="vos@apicanta.com" error={Boolean(error)}
                  icono={<Mail size={18} />}
                />
              </Field>
              <Button
                variante="primary" type="submit" lg
                cargando={estado === "enviando"}
                icono={estado === "enviando" ? undefined : <ArrowRight size={18} />}
                style={{ width: "100%" }}
              >
                {estado === "enviando" ? "Enviando…" : "Enviarme el enlace"}
              </Button>
            </form>

            <p className="t-sm t-subtle" style={{ marginTop: 20 }}>
              El acceso está limitado al equipo de Apicanta. Si tu correo no está en la lista,
              el enlace no te va a dejar entrar.
            </p>
          </>
        )}
      </div>

      <p className="login__pie t-sm t-subtle">
        Leads, pipeline, agenda, webinars, alumnos, marketing y finanzas en un solo lugar.
      </p>
    </div>
  );
}
