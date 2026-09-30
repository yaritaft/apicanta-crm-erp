"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckSquare, ExternalLink, Search, Square, Video } from "lucide-react";
import { Input } from "@/components/ui/ui";
import { Markdown } from "@/components/ui/Markdown";
import { duracion, type Grabacion } from "@/lib/fathom";
import { hayNube, nube } from "@/lib/supabase";

/* ==================================================================
   La grabación de Fathom de una llamada, en la ficha: el link, el
   resumen, los accionables y la transcripción (con buscador). Llegan
   solos por el webhook de Fathom (lib/fathom-servidor).

   No se cargan con el resto de los datos al abrir la app (las
   transcripciones pesan): se piden cuando se abre la ficha, de la tabla
   `grabaciones`, con la sesión de quien mira (el closer ve sólo las de
   sus llamadas). En la app local, sin base, se pueden probar poniendo
   grabaciones de ejemplo en localStorage «apicanta:fathom-prueba».
   ================================================================== */

export function useGrabaciones(sesionIds: string[]): { porSesion: Map<string, Grabacion[]>; cargando: boolean } {
  const clave = [...sesionIds].sort().join(",");
  const [estado, setEstado] = useState<{ clave: string; porSesion: Map<string, Grabacion[]> }>({ clave: "", porSesion: new Map() });

  useEffect(() => {
    const ids = clave ? clave.split(",") : [];
    if (ids.length === 0) return;
    let vivo = true;
    const listas = (xs: Grabacion[]) => {
      const m = new Map<string, Grabacion[]>();
      for (const g of xs) {
        if (!g.sesionId || !ids.includes(g.sesionId)) continue;
        m.set(g.sesionId, [...(m.get(g.sesionId) ?? []), g]);
      }
      for (const xs2 of m.values()) xs2.sort((a, b) => (b.grabadaDesde ?? "").localeCompare(a.grabadaDesde ?? ""));
      return m;
    };
    (async () => {
      if (!hayNube || !nube) {
        let prueba: Grabacion[] = [];
        try { prueba = JSON.parse(localStorage.getItem("apicanta:fathom-prueba") ?? "[]") as Grabacion[]; } catch { /* nada */ }
        if (vivo) setEstado({ clave, porSesion: listas(prueba) });
        return;
      }
      const r = await nube.from("grabaciones").select("*").in("sesionId", ids);
      /* Sin la tabla (supabase/fathom.sql sin correr) o sin permiso: sin grabaciones. */
      if (vivo) setEstado({ clave, porSesion: listas(r.error ? [] : ((r.data ?? []) as Grabacion[])) });
    })();
    return () => { vivo = false; };
  }, [clave]);

  return { porSesion: estado.clave === clave ? estado.porSesion : new Map(), cargando: Boolean(clave) && estado.clave !== clave };
}

export function GrabacionFathom({ g }: { g: Grabacion }) {
  const [todo, setTodo] = useState(false);
  const [trans, setTrans] = useState(false);
  const [busca, setBusca] = useState("");
  const largo = (g.resumen?.length ?? 0) > 600;
  const dura = duracion(g);
  const frases = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const xs = g.transcripcion ?? [];
    return q ? xs.filter((f) => f.texto.toLowerCase().includes(q) || f.quien.toLowerCase().includes(q)) : xs;
  }, [g.transcripcion, busca]);

  return (
    <section className="fathom" aria-label="Grabación de Fathom">
      <header className="fathom__cabeza">
        <span className="fathom__marca"><Video size={14} aria-hidden />Fathom</span>
        <span className="t-sm t-subtle">{[dura, g.grabadoPorNombre ? `grabó ${g.grabadoPorNombre}` : ""].filter(Boolean).join(" · ")}</span>
        <span className="spacer" />
        {g.shareUrl && (
          <a className="link t-sm" href={g.shareUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Ver la grabación</a>
        )}
      </header>

      {g.resumen ? (
        <>
          <div className={`fathom__resumen${largo && !todo ? " fathom__resumen--corto" : ""}`}>
            <Markdown texto={g.resumen} />
          </div>
          {largo && (
            <button type="button" className="link t-sm" onClick={() => setTodo((v) => !v)}>
              {todo ? "Ver menos" : "Ver todo el resumen"}
            </button>
          )}
        </>
      ) : (
        <p className="t-sm t-subtle">Fathom todavía no mandó el resumen.</p>
      )}

      {g.accionables.length > 0 && (
        <div className="stack-1">
          <span className="t-label">Accionables</span>
          <ul className="fathom__acc">
            {g.accionables.map((a, i) => (
              <li key={i}>
                {a.hecho ? <CheckSquare size={14} aria-label="Hecho" /> : <Square size={14} aria-label="Pendiente" />}
                <span>{a.texto}{a.quien ? <span className="t-subtle"> · {a.quien}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(g.transcripcion?.length ?? 0) > 0 && (
        <div className="stack-2">
          <button type="button" className="link t-sm" aria-expanded={trans} onClick={() => setTrans((v) => !v)}>
            {trans ? "Ocultar la transcripción" : `Ver la transcripción (${g.transcripcion!.length} frases)`}
          </button>
          {trans && (
            <>
              <div style={{ maxWidth: 320 }}>
                <Input icono={<Search size={14} />} value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar en la transcripción" aria-label="Buscar en la transcripción" />
              </div>
              <ol className="fathom__trans">
                {frases.map((f, i) => (
                  <li key={i}>
                    <span className="t-num t-subtle fathom__t">{f.t}</span>
                    <span><strong>{f.quien || "—"}</strong> {f.texto}</span>
                  </li>
                ))}
                {frases.length === 0 && <li className="t-subtle">Nada con «{busca}».</li>}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
