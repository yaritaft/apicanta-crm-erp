"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Megaphone, RefreshCw } from "lucide-react";
import { Badge, Bar, Button, Card, CardHead } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { useEstado } from "@/lib/store";
import { relativo } from "@/lib/format";
import { BOTON_DEL_ANUNCIO, TEXTO_DEL_ANUNCIO, etiquetaDePersona, sugerirAlumnos, type PersonaTelegram } from "@/lib/telegram-identidades";
import type { ResumenDeIdentificacion } from "@/lib/telegram-identidades-servidor";
import { enCuantosGrupos, finDeTelefono, origen, pedirIdentidades } from "@/components/contratos/telegram-cliente";

/* ==================================================================
   Quién es quién en Telegram, en Ajustes → Contratos y accesos (Manu, 20/11).

   Los alumnos que ya estaban en los grupos antes de la app eran anónimos:
   para sacarlos había que buscarlos a mano por nombre. Ahora el bot los
   reconoce cuando tocan su link, comparten su número, escriben o entran a
   un grupo. Acá se ve cuántos faltan y se resuelve lo que quedó a medias:
   - «Pedir que se identifiquen»: deja en cada grupo un botón que abre el
     bot (Telegram verifica que el número es el de esa cuenta).
   - La bandeja: cuentas que compartieron un número que coincide a medias,
     o que el bot vio y se parecen a un alumno, para confirmar con un toque.
   ================================================================== */

async function leerResumen(): Promise<{ resumen: ResumenDeIdentificacion; bot: string | null }> {
  const r = await fetch("/api/telegram/identidades", { cache: "no-store", headers: await cabeceras() });
  const j = (await r.json().catch(() => ({}))) as { resumen?: ResumenDeIdentificacion; bot?: string | null; error?: string };
  if (!r.ok || !j.resumen) throw new Error(j.error ?? `Error ${r.status}`);
  return { resumen: j.resumen, bot: j.bot ?? null };
}

async function leerGrupos(): Promise<string[]> {
  const r = await fetch("/api/telegram", { cache: "no-store", headers: await cabeceras() });
  const j = (await r.json().catch(() => ({}))) as { grupos?: { titulo: string; chatId: string; botEsAdmin: boolean }[] };
  return r.ok ? (j.grupos ?? []).filter((g) => g.botEsAdmin).map((g) => g.titulo || g.chatId) : [];
}

interface Propuesta { persona: PersonaTelegram; alumnoId: string; alumno: string; parecido: number; motivo: string }

export function IdentificarTelegram() {
  const e = useEstado();
  const toast = useToast();
  const [datos, setDatos] = useState<{ resumen: ResumenDeIdentificacion; bot: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sueltas, setSueltas] = useState<PersonaTelegram[] | null>(null);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [anunciar, setAnunciar] = useState(false);
  const [elegida, setElegida] = useState<Propuesta | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const leer = useCallback(async () => {
    try { setDatos(await leerResumen()); setError(null); } catch (err) { setError(err instanceof Error ? err.message : "No se pudo leer."); }
    setSueltas(await origen.cuentasSueltas());
    setGrupos(await leerGrupos().catch(() => []));
  }, []);
  useEffect(() => { void leer(); }, [leer]);

  /* Primero lo que compartió un número que coincide a medias (con sus alumnos posibles), después lo que se parece por nombre. Se calcula sólo para
     las más recientes: comparar cada cuenta con los ~900 alumnos no hace falta para mostrar 25 filas. */
  const propuestas = useMemo<Propuesta[]>(() => {
    const nombres = new Map(e.alumnos.map((a) => [a.id, a.nombre]));
    const salida: Propuesta[] = [];
    for (const p of (sueltas ?? []).slice(0, 150)) {
      const porNumero = (p.posibles ?? []).filter((x) => nombres.has(x.alumnoId));
      if (porNumero.length) {
        for (const x of porNumero.slice(0, 3)) salida.push({ persona: p, alumnoId: x.alumnoId, alumno: nombres.get(x.alumnoId)!, parecido: 1, motivo: x.motivo === "varios" ? "su número está en más de una ficha" : "su número termina igual" });
        continue;
      }
      const mejores = sugerirAlumnos({ nombre: p.nombre, usuario: p.usuario }, e.alumnos, 2).filter((x) => x.parecido >= 0.7);
      for (const m of mejores) salida.push({ persona: p, alumnoId: m.alumno.id, alumno: m.alumno.nombre, parecido: m.parecido, motivo: "el nombre se parece" });
    }
    return salida.sort((a, b) => b.parecido - a.parecido).slice(0, 25);
  }, [sueltas, e.alumnos]);

  async function hacer(clave: string, cuerpo: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) {
    setTrabajando(clave);
    try { toast(ok(await pedirIdentidades(cuerpo))); } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
  }

  const r = datos?.resumen;
  const pct = r && r.conAcceso > 0 ? Math.round((r.identificados / r.conAcceso) * 100) : 0;

  return (
    <Card>
      <CardHead titulo="Quién es quién en Telegram"
        sub="Para sacar a un alumno de los grupos hay que saber cuál es su cuenta, y muchos se ponen otro nombre. El bot la reconoce sola cuando entra con su link, escribe en un grupo o comparte su número con el bot."
        acciones={(
          <span className="row-wrap" style={{ gap: 6 }}>
            <Button sm variante="ghost" icono={<RefreshCw size={14} />} onClick={() => void leer()}>Actualizar</Button>
            <Button sm variante="secondary" icono={<Megaphone size={14} />} onClick={() => setAnunciar(true)} disabled={!datos?.bot}>Pedir que se identifiquen</Button>
          </span>
        )} />
      <div className="stack-2">
        {error ? <p className="t-sm" style={{ color: "var(--danger)" }}>{error}</p> : !r ? <div className="skeleton" style={{ height: 56 }} /> : (
          <>
            <div className="stack-1">
              <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="t-sm"><strong className="tabular">{r.identificados}</strong> de <strong className="tabular">{r.conAcceso}</strong> alumnos activos con acceso a Telegram ya están identificados</span>
                <span className="t-sm t-subtle tabular">{pct}%</span>
              </div>
              <Bar valor={pct} tono="success" />
              <p className="t-sm t-subtle">
                {r.conAcceso - r.identificados > 0
                  ? `Faltan ${r.conAcceso - r.identificados}. «Pedir que se identifiquen» deja en cada grupo un botón que abre el bot: con compartir su número alcanza.`
                  : "Están todos: a cualquiera de ellos se lo puede sacar de los grupos desde su ficha."}
              </p>
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <Badge variante="neutral">{r.sueltas} {r.sueltas === 1 ? "cuenta vista sin atar" : "cuentas vistas sin atar"}</Badge>
              {r.porRevisar > 0 && <Badge variante="warning">{r.porRevisar} por revisar</Badge>}
            </div>
          </>
        )}

        {propuestas.length > 0 && (
          <div className="stack-1">
            <button type="button" className="row-wrap" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}
              style={{ gap: 6, background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit", alignItems: "center" }}>
              {abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="t-label">Para confirmar ({propuestas.length})</span>
            </button>
            {abierta && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {propuestas.map((x) => (
                  <li key={`${x.persona.id}:${x.alumnoId}`} className="row-wrap" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="t-sm" style={{ display: "block", fontWeight: 500 }}>{etiquetaDePersona(x.persona)} <span className="t-subtle">→</span> {x.alumno}</span>
                      <span className="t-sm t-subtle" style={{ display: "block" }}>
                        {[x.motivo, enCuantosGrupos(x.persona), finDeTelefono(x.persona) ? `número ${finDeTelefono(x.persona)}` : "", `visto ${relativo(x.persona.ultimoVisto)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Button sm variante="secondary" onClick={() => setElegida(x)}>Es su cuenta</Button>
                    <Button sm variante="ghost" cargando={trabajando === `equipo:${x.persona.id}`}
                      onClick={() => void hacer(`equipo:${x.persona.id}`, { accion: "equipo", personaId: x.persona.id }, () => "Listo: esa cuenta es del equipo y no se vuelve a proponer.")}>Es del equipo</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Confirmar abierto={anunciar} onCerrar={() => setAnunciar(false)} variante="primary" confirmarTexto="Mandar a los grupos"
        titulo="¿Pedir que se identifiquen en los grupos?"
        texto={`El bot escribe en ${grupos.length ? `estos ${grupos.length} grupos (${grupos.join(", ")})` : "cada grupo donde es administrador"}: «${TEXTO_DEL_ANUNCIO}» con un botón «${BOTON_DEL_ANUNCIO}» que abre el bot. Lo ven todos los alumnos y no se puede borrar desde acá: se lo borra a mano en cada grupo.`}
        onConfirmar={() => {
          setAnunciar(false);
          void hacer("anunciar", { accion: "anunciar" }, (j) => {
            const dichos = Array.isArray(j.enviados) ? j.enviados.length : 0;
            const falla = Array.isArray(j.fallaron) ? j.fallaron.length : 0;
            return `Mensaje enviado en ${dichos} ${dichos === 1 ? "grupo" : "grupos"}${falla ? `; falló en ${falla} (¿el bot sigue siendo administrador?)` : ""}.`;
          });
        }} />
      <Confirmar abierto={elegida !== null} onCerrar={() => setElegida(null)} variante="primary" confirmarTexto="Sí, es su cuenta"
        titulo="¿Es la cuenta de este alumno?"
        texto={elegida ? `${etiquetaDePersona(elegida.persona)} quedaría atada a ${elegida.alumno}. Desde ahí «Quitar» y el outboarding la sacan de los grupos donde esté. Si te equivocás, se puede desvincular desde su ficha.` : ""}
        onConfirmar={() => {
          const x = elegida; setElegida(null);
          if (x) void hacer(`atar:${x.persona.id}`, { accion: "atar", personaId: x.persona.id, alumnoId: x.alumnoId }, (j) => {
            const n = Array.isArray(j.grupos) ? j.grupos.length : 0;
            return `Listo: ${x.alumno} quedó identificado${n ? ` (lo encontré en ${n} ${n === 1 ? "grupo" : "grupos"})` : ""}.`;
          });
        }} />
    </Card>
  );
}
