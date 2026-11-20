"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Search, UserCheck } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui/ui";
import { Confirmar, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { relativo } from "@/lib/format";
import {
  VINCULO_TEXTO, etiquetaDePersona, sugerirCuentas, type PersonaTelegram,
} from "@/lib/telegram-identidades";
import { FilaServicio } from "@/components/ficha/FilaServicio";
import { coincideBusqueda, enCuantosGrupos, finDeTelefono, origen, pedirIdentidades } from "./telegram-cliente";

/* ==================================================================
   Quién es quién en Telegram, en la ficha del alumno → Accesos → Telegram
   (Manu, 20/11: «alumnos viejos que tenemos que expulsar, pero en Telegram
   cuesta identificarlos»).

   Si el bot ya sabe cuál es su cuenta, se ve (y «Quitar» la saca de los
   grupos). Si no, hay dos caminos:
   - «Pedirle que se identifique»: copia el mensaje con su link personal del
     bot; con un toque la persona queda reconocida.
   - «Buscar en los grupos»: las cuentas que el bot vio en los grupos y no
     sabe de quién son, ordenadas por parecido con su nombre, para atarla.
   ================================================================== */

export function IdentidadTelegram({ alumno, conAccesoVigente, acciona, onCambio }: {
  alumno: { id: string; nombre: string };
  /* Tiene accesos de Telegram vigentes en la app: sin identificar es un problema (no se lo va a poder sacar solo). */
  conAccesoVigente: boolean;
  acciona: boolean;
  onCambio: () => void;
}) {
  const toast = useToast();
  const [cuentas, setCuentas] = useState<PersonaTelegram[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [desatar, setDesatar] = useState<PersonaTelegram | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const leer = useCallback(async () => { setCuentas(await origen.cuentasDelAlumno(alumno.id)); }, [alumno.id]);
  useEffect(() => { void leer(); }, [leer]);

  async function copiarMensaje() {
    setTrabajando("enlace");
    try {
      const j = await pedirIdentidades({ accion: "enlace", alumnoId: alumno.id });
      const texto = String(j.mensaje ?? "");
      try { await navigator.clipboard.writeText(texto); toast("Copié el mensaje con su link: pegáselo por WhatsApp."); }
      catch { window.prompt("Copiá el mensaje:", texto); }
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo armar el link.", "err"); }
    setTrabajando(null);
  }

  async function sacarVinculo(p: PersonaTelegram) {
    setTrabajando("desatar");
    try {
      await pedirIdentidades({ accion: "desatar", personaId: p.id });
      toast("Listo: esa cuenta ya no figura como suya.");
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
    onCambio();
  }

  if (cuentas === null) return <div className="skeleton" style={{ height: 44, borderRadius: 12 }} />;

  return (
    <>
      {cuentas.length > 0 ? cuentas.map((p) => (
        <FilaServicio key={p.id} icono={<UserCheck size={15} />} rotulo="Cuenta de Telegram"
          detalle={[etiquetaDePersona(p), p.vinculo ? VINCULO_TEXTO[p.vinculo] : "", enCuantosGrupos(p)].filter(Boolean).join(" · ")}>
          <Badge variante="success">Identificado</Badge>
          {acciona && <Button sm variante="ghost" onClick={() => setDesatar(p)}>Desvincular</Button>}
        </FilaServicio>
      )) : (
        <FilaServicio icono={<UserCheck size={15} />} rotulo="Cuenta de Telegram"
          detalle={conAccesoVigente
            ? "No sabemos quién es en Telegram: si hay que sacarlo de los grupos, la app no lo va a poder hacer sola."
            : "Todavía no sabemos quién es en Telegram."}>
          <Badge variante={conAccesoVigente ? "warning" : "neutral"}>Sin identificar</Badge>
          {acciona && (
            <>
              <Button sm variante="ghost" icono={<Copy size={14} />} cargando={trabajando === "enlace"} onClick={() => void copiarMensaje()}>Pedirle que se identifique</Button>
              <Button sm variante="secondary" icono={<Search size={14} />} onClick={() => setBuscando(true)}>Buscar en los grupos</Button>
            </>
          )}
        </FilaServicio>
      )}

      {buscando && <BuscarEnLosGrupos alumno={alumno} onCerrar={() => setBuscando(false)} onAtada={() => { setBuscando(false); void leer(); onCambio(); }} />}
      <Confirmar abierto={desatar !== null} onCerrar={() => setDesatar(null)} confirmarTexto={trabajando === "desatar" ? "Desvinculando…" : "Desvincular"}
        titulo="¿Desvincular esta cuenta?"
        texto={`${desatar ? etiquetaDePersona(desatar) : "Esa cuenta"} deja de figurar como de ${alumno.nombre}. Los grupos que se anotaron al atarla se borran de sus accesos, y «Quitar» ya no la va a sacar de ahí. Usalo si la atamos a la persona equivocada.`}
        onConfirmar={() => { const p = desatar; setDesatar(null); if (p) void sacarVinculo(p); }} />
    </>
  );
}

/* ---------- Buscar en los grupos ---------- */

function BuscarEnLosGrupos({ alumno, onCerrar, onAtada }: { alumno: { id: string; nombre: string }; onCerrar: () => void; onAtada: () => void }) {
  const toast = useToast();
  const [sueltas, setSueltas] = useState<PersonaTelegram[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [elegida, setElegida] = useState<PersonaTelegram | null>(null);
  const [atando, setAtando] = useState(false);
  useEffect(() => { void origen.cuentasSueltas().then(setSueltas); }, []);

  /* Primero las que compartieron un número parecido al suyo, después las que se llaman parecido. */
  const sugeridas = useMemo(() => {
    const todas = sueltas ?? [];
    const porNumero = todas.filter((p) => p.posibles?.some((x) => x.alumnoId === alumno.id));
    const ids = new Set(porNumero.map((p) => p.id));
    return [...porNumero, ...sugerirCuentas(alumno.nombre, todas.filter((p) => !ids.has(p.id))).map((x) => x.persona)];
  }, [sueltas, alumno]);
  const idsSugeridas = useMemo(() => new Set(sugeridas.map((p) => p.id)), [sugeridas]);
  const aparte = useMemo(() => (sueltas ?? []).filter((p) => !idsSugeridas.has(p.id) && coincideBusqueda(p, busqueda)), [sueltas, idsSugeridas, busqueda]);

  async function atar(p: PersonaTelegram) {
    setAtando(true);
    try {
      const j = await pedirIdentidades({ accion: "atar", alumnoId: alumno.id, personaId: p.id });
      const n = Array.isArray(j.grupos) ? j.grupos.length : 0;
      toast(n ? `Listo: la cuenta quedó atada. La encontré en ${n} ${n === 1 ? "grupo" : "grupos"}.` : "Listo: la cuenta quedó atada (no la encontré en ningún grupo todavía).");
      onAtada();
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setAtando(false);
  }

  const fila = (p: PersonaTelegram, motivo?: string) => (
    <li key={p.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="t-sm" style={{ display: "block", fontWeight: 500 }}>{etiquetaDePersona(p)}</span>
        <span className="t-sm t-subtle" style={{ display: "block" }}>
          {[motivo, enCuantosGrupos(p), finDeTelefono(p) ? `número ${finDeTelefono(p)}` : "", `visto ${relativo(p.ultimoVisto)}`].filter(Boolean).join(" · ")}
        </span>
      </span>
      <Button sm variante="secondary" onClick={() => setElegida(p)}>Es esta cuenta</Button>
    </li>
  );

  return (
    <>
      <Modal abierto onCerrar={onCerrar} titulo={`Buscar la cuenta de ${alumno.nombre}`}
        sub="Son las cuentas de Telegram que el bot vio en los grupos y todavía no sabe de quién son. Si el alumno nunca escribió ni entró con un link, no aparece: pedile que se identifique.">
        {sueltas === null ? <div className="skeleton" style={{ height: 120 }} /> : (
          <div className="stack-2">
            {sugeridas.length > 0 && (
              <section className="stack-1">
                <span className="t-label">Se parecen a este alumno</span>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {sugeridas.map((p) => fila(p, p.posibles?.some((x) => x.alumnoId === alumno.id) ? "compartió un número parecido" : "el nombre se parece"))}
                </ul>
              </section>
            )}
            <section className="stack-1">
              <span className="t-label">{sugeridas.length > 0 ? "Buscar en las demás" : "Buscar"}</span>
              <Input value={busqueda} onChange={(ev) => setBusqueda(ev.target.value)} placeholder="Nombre, @usuario o final del número" icono={<Search size={14} />} />
              {aparte.length === 0 ? (
                <p className="t-sm t-subtle">{busqueda ? "Ninguna cuenta coincide." : sueltas.length === 0 ? "El bot todavía no vio ninguna cuenta sin identificar." : "No quedan más cuentas."}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 280, overflowY: "auto" }}>{aparte.slice(0, 40).map((p) => fila(p))}</ul>
              )}
              {aparte.length > 40 && <p className="t-sm t-subtle">Hay {aparte.length - 40} más: escribí parte del nombre para acotar.</p>}
            </section>
          </div>
        )}
      </Modal>
      <Confirmar abierto={elegida !== null} onCerrar={() => setElegida(null)} variante="primary" confirmarTexto={atando ? "Atando…" : "Sí, es su cuenta"}
        titulo="¿Es la cuenta de este alumno?"
        texto={`${elegida ? etiquetaDePersona(elegida) : ""} quedaría atada a ${alumno.nombre}. Desde ahí «Quitar» y el outboarding la sacan de los grupos donde esté. Si te equivocás, se puede desvincular.`}
        onConfirmar={() => { const p = elegida; setElegida(null); if (p) void atar(p); }} />
    </>
  );
}
