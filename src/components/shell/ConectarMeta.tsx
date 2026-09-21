"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Check, Plug, RefreshCw, Unplug } from "lucide-react";
import { Badge, Button, Card, CardHead, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import type { CampaniaMeta } from "@/lib/meta";
import { num } from "@/lib/format";
import type { Campania } from "@/lib/types";

interface Cuenta { id: string; nombre: string; moneda: string; estado: number }

const AVISOS: Record<string, string> = {
  ok: "Meta quedó conectado.",
  "ya-conectado": "Meta ya está conectado con el token del negocio.",
  cancelado: "Cancelaste la conexión con Meta.",
  "sin-configurar": "Faltan las claves de la app de Meta en el proyecto.",
  "state-invalido": "La conexión no se pudo verificar. Probá de nuevo.",
  "error-token": "Meta no aceptó el código. Probá de nuevo.",
  error: "Algo falló al conectar con Meta.",
};

export function ConectarMeta({ rango }: { rango?: { desde: string; hasta: string } } = {}) {
  const e = useEstado();
  const toast = useToast();
  const params = useSearchParams();

  const [estado, setEstado] = useState<"mirando" | "sin-configurar" | "desconectado" | "conectado">("mirando");
  const [limite, setLimite] = useState(false);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [porSistema, setPorSistema] = useState(false);
  const [cuentaId, setCuentaId] = useState("");
  const [trayendoTodo, setTrayendoTodo] = useState(false);

  const mirar = useCallback(async () => {
    try {
      const r = await fetch("/api/meta/cuentas", { cache: "no-store" });
      const j = await r.json();
      setLimite(j.motivo === "limite");
      if (j.conectado) {
        setCuentas(j.cuentas ?? []);
        setCuentaId((c) => c || j.cuentas?.[0]?.id || "");
        setPorSistema(Boolean(j.porSistema));
        setEstado("conectado");
      } else if (j.motivo === "limite") {
        /* Meta nos frenó un rato: la conexión está bien, sólo hay que esperar. */
        setPorSistema(Boolean(j.porSistema));
        setEstado("conectado");
      } else {
        setEstado(j.motivo === "sin-configurar" ? "sin-configurar" : "desconectado");
      }
    } catch { setEstado("desconectado"); }
  }, []);

  useEffect(() => { void mirar(); }, [mirar]);

  /* El callback vuelve con ?meta=… para contar cómo salió */
  useEffect(() => {
    const m = params.get("meta");
    if (!m) return;
    toast(AVISOS[m] ?? "Volviste de Meta.", m === "ok" ? "ok" : "err");
    window.history.replaceState({}, "", window.location.pathname);
    void mirar();
  }, [params, toast, mirar]);

  /* Trae la jerarquia entera y los insights POR DIA del rango.

     Es el reemplazo de `sincronizar`, que guarda una fila por campania con un
     solo numero de inversion — y por eso el filtro de fechas no puede recortar
     el gasto. Conviven hasta que Marketing lea de las tablas nuevas. */
  async function traerTodo() {
    if (!cuentaId || !rango) return;
    setTrayendoTodo(true);
    try {
      const r = await fetch("/api/meta/jerarquia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuentaId, desde: rango.desde, hasta: rango.hasta }),
      });
      const j = await r.json();
      if (!r.ok) {
        const esLimite = /too many calls|rate limit/i.test(j.error ?? "");
        toast(esLimite
          ? "Meta nos frenó por exceso de consultas. Esperá unos minutos y probá de nuevo."
          : (j.error ?? "No se pudo traer nada de Meta."), "err");
        return;
      }
      const n = acciones.importarMeta({
        campaigns: j.campaigns ?? [], adsets: j.adsets ?? [],
        ads: j.ads ?? [], insights: j.insights ?? [], cuentaId,
      });
      toast(`${n.campaigns} campañas, ${n.ads} anuncios y ${n.dias} días de datos.`);
    } catch {
      toast("No se pudo hablar con Meta.", "err");
    } finally {
      setTrayendoTodo(false);
    }
  }

  async function desconectar() {
    await fetch("/api/meta/cuentas", { method: "DELETE" });
    setEstado("desconectado"); setCuentas([]);
    toast("Meta desconectado.");
  }

  if (estado === "mirando") return null;

  return (
    <Card>
      <CardHead
        titulo="Meta Ads"
        sub="Traé campañas, conjuntos, anuncios y el gasto día por día, sin copiar nada a mano."
        acciones={
          <Badge variante={estado === "conectado" ? "success" : estado === "sin-configurar" ? "warning" : "neutral"}
            icono={estado === "conectado" ? <Check size={13} /> : estado === "sin-configurar" ? <AlertCircle size={13} /> : <Plug size={13} />}>
            {estado === "conectado" ? "Conectado" : estado === "sin-configurar" ? "Falta configurar" : "Sin conectar"}
          </Badge>
        }
      />

      {estado === "sin-configurar" && (
        <p className="t-body t-muted">
          Falta cargar <code>META_SYSTEM_TOKEN</code> en las variables del proyecto: un token de usuario
          del sistema generado en el Business Manager. Es de una sola vez y no vence.
        </p>
      )}

      {estado === "desconectado" && (
        <div className="stack-3">
          <p className="t-body t-muted">
            Entrá con tu cuenta de Facebook y elegí la cuenta publicitaria. Pedimos permiso sólo de
            lectura: Apicanta puede ver tus campañas, nunca tocarlas ni gastar.
          </p>
          <div>
            <a href="/api/meta/login">
              <Button variante="brand" icono={<Plug size={16} />}>Conectar con Meta</Button>
            </a>
          </div>
        </div>
      )}

      {estado === "conectado" && (
        <div className="stack-3">
          <div className="row-wrap">
            <div style={{ minWidth: 260, flex: 1 }}>
              <Select value={cuentaId} onChange={(ev) => setCuentaId(ev.target.value)} aria-label="Cuenta publicitaria"
                opciones={cuentas.map((c) => ({ valor: c.id, texto: `${c.nombre} · ${c.moneda}` }))} />
            </div>
            {rango && (
              <Button variante="primary" cargando={trayendoTodo} icono={<RefreshCw size={16} />} onClick={() => void traerTodo()}>
                {trayendoTodo ? "Trayendo…" : "Traer anuncios y días"}
              </Button>
            )}
            {!porSistema && (
              <Button variante="ghost" icono={<Unplug size={16} />} onClick={() => void desconectar()}>Desconectar</Button>
            )}
          </div>
          <p className="t-sm t-subtle">
            {num(cuentas.length)} cuentas disponibles. Trae los últimos 3 meses; las campañas que ya
            existen se actualizan en vez de duplicarse.
            {porSistema && " La conexión es con el token del negocio: no vence y no hay que volver a entrar."}
          </p>
          {limite && (
            <p className="t-sm" style={{ color: "var(--warning)" }}>
              Meta está limitando las consultas en este momento. La conexión está bien;
              esperá unos minutos antes de volver a traer campañas.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
