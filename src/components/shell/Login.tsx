"use client";

import React, { useState } from "react";
import { ArrowRight, Check, KeyRound, Mail } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/ui";
import { entrarConClave, enviarMagicLink } from "@/lib/auth";

/* Dos formas de entrar. La clave es la de siempre y no toca el correo, asi que
   anda aunque el envio de mails de Supabase este limitado o el enlace apunte a
   otro lado. El enlace queda como alternativa para el que no quiere recordar nada. */
type Modo = "clave" | "enlace";

export function Login() {
  const [modo, setModo] = useState<Modo>("clave");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [estado, setEstado] = useState<"pidiendo" | "enviando" | "enviado">("pidiendo");
  const [error, setError] = useState("");

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo); setError(""); setEstado("pidiendo");
  }

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!email.includes("@")) { setError("Ingresá un email con @"); return; }
    if (modo === "clave" && !clave) { setError("Te falta la clave"); return; }

    setError(""); setEstado("enviando");

    /* Con clave no hay pantalla de exito: al validar, la sesion cambia y la
       Puerta deja pasar sola. Solo hay que mostrar el error si lo rechaza. */
    const r = modo === "clave"
      ? await entrarConClave(email, clave)
      : await enviarMagicLink(email);

    if (!r.ok) {
      setEstado("pidiendo");
      setError(r.error ?? "No pudimos entrar. Probá de nuevo.");
      return;
    }
    setEstado(modo === "clave" ? "pidiendo" : "enviado");
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
            <span className="login__ico">{modo === "clave" ? <KeyRound size={24} /> : <Mail size={24} />}</span>
            <h1 className="t-h2" style={{ marginBottom: 8 }}>Entrá a Apicanta</h1>
            <p className="t-body t-muted" style={{ marginBottom: 24 }}>
              {modo === "clave"
                ? "Poné tu correo y tu clave."
                : "Poné tu correo y te mandamos un enlace para entrar. Sin contraseñas."}
            </p>

            <form onSubmit={entrar} className="stack-4" style={{ textAlign: "left" }}>
              <Field label="Tu correo" error={modo === "enlace" ? error : undefined}>
                <Input
                  type="email" value={email} autoFocus autoComplete="email"
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="vos@apicanta.com" error={Boolean(error)}
                  icono={<Mail size={18} />}
                />
              </Field>

              {modo === "clave" && (
                <Field label="Tu clave" error={error}>
                  <Input
                    type="password" value={clave} autoComplete="current-password"
                    onChange={(e) => { setClave(e.target.value); setError(""); }}
                    placeholder="••••••••" error={Boolean(error)}
                    icono={<KeyRound size={18} />}
                  />
                </Field>
              )}

              <Button
                variante="primary" type="submit" lg
                cargando={estado === "enviando"}
                icono={estado === "enviando" ? undefined : <ArrowRight size={18} />}
                style={{ width: "100%" }}
              >
                {estado === "enviando"
                  ? (modo === "clave" ? "Entrando…" : "Enviando…")
                  : (modo === "clave" ? "Entrar" : "Enviarme el enlace")}
              </Button>
            </form>

            <div style={{ marginTop: 16 }}>
              <Button
                variante="ghost" sm
                onClick={() => cambiarModo(modo === "clave" ? "enlace" : "clave")}
              >
                {modo === "clave" ? "Prefiero un enlace por correo" : "Prefiero entrar con mi clave"}
              </Button>
            </div>

            <p className="t-sm t-subtle" style={{ marginTop: 20 }}>
              El acceso está limitado al equipo de Apicanta. Si tu correo no está en la lista,
              no vas a ver nada aunque entres.
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
