"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, CircleAlert, CircleCheck, Minus, UserPlus } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHead, Empty, Input, Select } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, hayNube, useEstado } from "@/lib/store";
import { emailValido, useTiposCuenta, type Acceso } from "@/lib/acceso";
import {
  correoDe, evaluarClosers, type AccesoSinCloser, type CloserEvaluado, type EstadoDeClosers as Estado,
} from "@/lib/cuenta-closer";
import { destinosDePase } from "@/lib/pasar-llamadas";
import type { MiembroEquipo } from "@/lib/types";
import { usePasarLlamadas } from "./usePasarLlamadas";
import "./closers.css";

/* ==================================================================
   Equipo → Accesos: ¿cada closer va a ver sus llamadas?

   Un closer ve sólo lo suyo, y la app sabe qué es suyo por su correo en
   Equipo y por su nombre en Calendly (lib/cuenta-closer.ts). Si alguno de
   los dos falla, entra y no ve nada, sin ningún aviso. Acá se ve closer por
   closer, y lo que se puede arreglar con un clic se arregla: poner su
   correo, darle acceso, pasarle las llamadas que Calendly trae con otro
   nombre.
   ================================================================== */

/** Lo que dice si los closers van a ver sus llamadas: para la tarjeta y para el aviso de la solapa. */
export function useEstadoDeClosers(lista: Acceso[] | null): Estado {
  const e = useEstado();
  const tipos = useTiposCuenta();
  return useMemo(
    /* Sin base no hay login ni lista de accesos: no se afirma nada de ellos. */
    () => evaluarClosers({ equipo: e.equipo, sesiones: e.sesiones }, hayNube ? lista : null, tipos),
    [e.equipo, e.sesiones, lista, tipos],
  );
}

type Preset = { email: string; nombre: string; rol: string };

export function EstadoDeClosers({ resumen, onVerMiembro, onDarAcceso }: {
  resumen: Estado;
  onVerMiembro: (id: string) => void;
  /* Abre «Dar acceso» con lo que ya se sabe del closer. */
  onDarAcceso: (preset: Preset) => void;
}) {
  const tipos = useTiposCuenta();
  const tipoCloser = tipos.find((t) => t.id === "closer") ?? tipos.find((t) => t.soloLoSuyo && t.id !== "dueno");
  const { closers, accesosSinMiembro, anfitrionesSinDueno, sinVer } = resumen;
  const sueltos = anfitrionesSinDueno.filter((a) => a.candidatos.length === 0);

  if (closers.length === 0 && accesosSinMiembro.length === 0) {
    return (
      <Card>
        <CardHead titulo="Closers: ¿van a ver sus llamadas?" />
        <Empty icono={<UserPlus size={22} />} titulo="Todavía no hay closers en el equipo"
          texto="Cargalos en «Equipo y lo que cobra» con el rol «Closer»: acá se ve si cada uno va a ver sus llamadas." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        titulo="Closers: ¿van a ver sus llamadas?"
        sub="Cada closer ve sólo lo suyo, y la app sabe qué es suyo por su correo en Equipo y por su nombre en Calendly. Si uno de los dos no coincide, entra y no ve nada. Acá se ve closer por closer."
      />
      <div className={`closers-resumen ${sinVer > 0 ? "closers-resumen--mal" : "closers-resumen--ok"}`} role="status">
        {sinVer > 0 ? <CircleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
        <span>
          {sinVer > 0
            ? `${sinVer === 1 ? "1 closer no va" : `${sinVer} closers no van`} a ver nada. Se arregla abajo.`
            : `Todos los closers van a ver sus llamadas${hayNube ? "" : " (sin base no se puede mirar quién tiene acceso: se comprueba el correo y Calendly)"}.`}
        </span>
      </div>
      <div className="closers-lista">
        {closers.map((c) => (
          <FilaDeCloser key={c.miembro.id} c={c} tipoCloser={tipoCloser?.id ?? "closer"} onVerMiembro={onVerMiembro} onDarAcceso={onDarAcceso} />
        ))}
        {accesosSinMiembro.map((x) => <AccesoSinFicha key={x.acceso.email} x={x} tipoNombre={tipos.find((t) => t.id === x.acceso.rol)?.nombre ?? x.acceso.rol} />)}
      </div>
      {sueltos.length > 0 && (
        <p className="t-sm t-subtle closers-nota">
          Llamadas de anfitriones de Calendly que no son de nadie del equipo:{" "}
          {sueltos.map((a) => `«${a.nombre}» (${a.llamadas})`).join(", ")}. Sólo las ven los dueños. Si es alguien del equipo, que en Calendly figure con su nombre de Equipo.
        </p>
      )}
    </Card>
  );
}

/* ---------- Un closer ---------- */

function Marca({ estado, children }: { estado: "ok" | "mal" | "nd"; children: React.ReactNode }) {
  const Ico = estado === "ok" ? CircleCheck : estado === "mal" ? CircleAlert : Minus;
  return <span className={`closers-check closers-check--${estado}`}><Ico size={15} aria-hidden />{children}</span>;
}

function FilaDeCloser({ c, tipoCloser, onVerMiembro, onDarAcceso }: {
  c: CloserEvaluado; tipoCloser: string; onVerMiembro: (id: string) => void; onDarAcceso: (p: Preset) => void;
}) {
  const e = useEstado();
  const tipos = useTiposCuenta();
  const toast = useToast();
  const pasar = usePasarLlamadas();
  const m = c.miembro;
  const [correo, setCorreo] = useState("");

  const guardarCorreo = (email: string) => {
    const v = email.trim().toLowerCase();
    if (!emailValido(v)) { toast("Ese correo no parece válido.", "err"); return; }
    const otro = e.equipo.find((x) => x.id !== m.id && correoDe(x) === v);
    if (otro) { toast(`Ese correo ya es de ${otro.nombre}.`, "err"); return; }
    acciones.guardarMiembro({ ...m, email: v });
    setCorreo("");
    toast(`Correo de ${m.nombre} guardado: ahora la app sabe quién es.`);
  };

  /* Las llamadas con el nombre con el que Calendly lo trae, pasadas a él. */
  const pasarLlamadasDe = (nombre: string) => {
    const destino = destinosDePase(e).find((d) => d.miembro.id === m.id);
    if (!destino) return;
    pasar(e.sesiones.filter((s) => s.anfitrion?.trim() === nombre), destino);
  };

  const sinCorreo = c.problemas.find((p) => p.tipo === "sin-correo");
  const sinAcceso = c.problemas.some((p) => p.tipo === "sin-acceso");
  const sinAnfitrion = c.problemas.find((p) => p.tipo === "sin-anfitrion");
  const llamadas = c.anfitriones.reduce((n, a) => n + a.llamadas, 0);

  return (
    <div className="closers-fila" data-estado={c.estado}>
      <div className="closers-fila__quien">
        <Avatar nombre={m.nombre} size={34} />
        <span style={{ minWidth: 0 }}>
          <button type="button" className="link t-strong" onClick={() => onVerMiembro(m.id)} title="Abrir su ficha">{m.nombre}</button>
          <span className="t-sm t-subtle" style={{ display: "block" }}>{m.puesto || "Closer"}</span>
        </span>
        {c.estado === "no-ve" && <Badge variante="warning">No ve nada</Badge>}
        {c.estado === "ok" && <Badge variante="success">Todo en orden</Badge>}
        {c.estado === "sin-acceso" && <Badge variante="neutral">Sin acceso</Badge>}
      </div>

      <div className="closers-fila__checks">
        <Marca estado={c.correo ? "ok" : "mal"}>{c.correo ? <>Correo en Equipo: <span className="t-num">{c.correo}</span></> : "Falta su correo en Equipo"}</Marca>
        {c.acceso === undefined
          ? <Marca estado="nd">Acceso a la app: no se sabe</Marca>
          : <Marca estado={c.acceso ? "ok" : "mal"}>{c.acceso ? `Acceso: ${tipos.find((t) => t.id === c.acceso!.rol)?.nombre ?? c.acceso.rol}` : c.correo ? "Todavía sin acceso" : "Sin acceso"}</Marca>}
        {c.veTodo ? (
          <Marca estado="nd">Ve todas las llamadas: no depende de su nombre en Calendly</Marca>
        ) : (
          <Marca estado={c.anfitriones.length > 0 ? "ok" : "mal"}>
            {c.anfitriones.length > 0
              ? <>En Calendly: {c.anfitriones.slice(0, 2).map((a) => `«${a.nombre}»`).join(" y ")} · {llamadas} {llamadas === 1 ? "llamada" : "llamadas"}</>
              : "Calendly no tiene llamadas a su nombre"}
          </Marca>
        )}
      </div>

      {(sinCorreo || sinAcceso || sinAnfitrion) && (
        <div className="closers-fila__arreglo">
          {sinCorreo && sinCorreo.tipo === "sin-correo" && (
            <div className="closers-arreglo">
              <p>
                Sin su correo en Equipo, la app no sabe quién es: aunque entre, no va a ver nada.
                {sinCorreo.sugerido && <> Hay un acceso de closer, <strong>{sinCorreo.sugerido.email}</strong>{sinCorreo.sugerido.nombre ? ` («${sinCorreo.sugerido.nombre}»)` : ""}, que parece ser suyo.</>}
              </p>
              <div className="closers-arreglo__acciones">
                {sinCorreo.sugerido && (
                  <Button sm variante="secondary" onClick={() => guardarCorreo(sinCorreo.sugerido!.email)}>
                    Poner {sinCorreo.sugerido.email} en su ficha
                  </Button>
                )}
                <form className="closers-correo" onSubmit={(ev) => { ev.preventDefault(); guardarCorreo(correo); }}>
                  <Input
                    type="email" value={correo} onChange={(ev) => setCorreo(ev.target.value)} aria-label={`Correo de ${m.nombre}`}
                    placeholder={sinCorreo.sugerido ? "o escribí otro correo" : "El correo con el que va a entrar"}
                  />
                  <Button sm variante="secondary" type="submit" disabled={!correo.trim()}>Guardar correo</Button>
                </form>
              </div>
            </div>
          )}

          {sinAcceso && (
            <div className="closers-arreglo">
              <p>Tiene su correo en Equipo, pero todavía no tiene acceso a la app: no puede entrar.</p>
              <div className="closers-arreglo__acciones">
                <Button sm variante="secondary" icono={<UserPlus size={15} />} onClick={() => onDarAcceso({ email: c.correo, nombre: m.nombre, rol: tipoCloser })}>
                  Darle acceso de closer
                </Button>
              </div>
            </div>
          )}

          {sinAnfitrion && sinAnfitrion.tipo === "sin-anfitrion" && (
            <div className="closers-arreglo">
              {sinAnfitrion.candidatos.length > 0 ? (
                <>
                  <p>
                    En Calendly sus llamadas figuran con otro nombre ({sinAnfitrion.candidatos.map((a) => `«${a.nombre}»`).join(", ")}) y la app no las reconoce como suyas:
                    no ve ninguna. Pasarle esas llamadas arregla las que ya hay; para las que vengan, que en Calendly figure como «{m.nombre}» (lo cambia quien maneja Calendly).
                  </p>
                  <div className="closers-arreglo__acciones">
                    {sinAnfitrion.candidatos.map((a) => (
                      <Button key={a.nombre} sm variante="secondary" icono={<ArrowRightLeft size={15} />} onClick={() => pasarLlamadasDe(a.nombre)}>
                        Pasarle las {a.llamadas} de «{a.nombre}»
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <p>
                  Calendly no tiene ninguna llamada a nombre de {m.nombre}. Si ya le agendaron, en Calendly tiene que figurar con el mismo nombre que en
                  Equipo («{m.nombre}»): alcanza con que empiece igual. Si todavía no le agendaron nada, se arregla solo con la primera llamada.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Un acceso de closer que no está en Equipo ---------- */

function AccesoSinFicha({ x, tipoNombre }: { x: AccesoSinCloser; tipoNombre: string }) {
  const toast = useToast();
  const [quien, setQuien] = useState(x.candidatos[0]?.id ?? "");
  const m: MiembroEquipo | undefined = x.candidatos.find((c) => c.id === quien);
  const ponerCorreo = () => {
    if (!m) return;
    acciones.guardarMiembro({ ...m, email: x.acceso.email.trim().toLowerCase() });
    toast(`Listo: ${x.acceso.email} es el correo de ${m.nombre}.`);
  };
  return (
    <div className="closers-fila" data-estado="no-ve">
      <div className="closers-fila__quien">
        <Avatar nombre={x.acceso.nombre || x.acceso.email} size={34} />
        <span style={{ minWidth: 0 }}>
          <span className="t-strong" style={{ color: "var(--ink)" }}>{x.acceso.nombre || x.acceso.email}</span>
          <span className="t-sm t-subtle" style={{ display: "block" }}>{x.acceso.email} · entra como {tipoNombre}</span>
        </span>
        <Badge variante="warning">No ve nada</Badge>
      </div>
      <div className="closers-fila__checks">
        <Marca estado="mal">Su correo no está en Equipo: la app no sabe quién es</Marca>
      </div>
      <div className="closers-fila__arreglo">
        <div className="closers-arreglo">
          {x.candidatos.length > 0 ? (
            <>
              <p>Entra con este correo, pero ningún closer del equipo lo tiene cargado. ¿Quién es?</p>
              <div className="closers-arreglo__acciones">
                <span style={{ minWidth: 200 }}>
                  <Select
                    aria-label={`De quién es ${x.acceso.email}`} value={quien} onChange={(ev) => setQuien(ev.target.value)}
                    opciones={x.candidatos.map((c) => ({ valor: c.id, texto: c.nombre }))}
                  />
                </span>
                <Button sm variante="secondary" disabled={!m} onClick={ponerCorreo}>Es {m ? m.nombre.split(" ")[0] : "él o ella"}: poner su correo</Button>
              </div>
            </>
          ) : (
            <p>
              Entra con este correo, pero no hay ningún closer sin correo en Equipo al que corresponda. Agregalo en «Equipo y lo que cobra» (con el rol «Closer») y poné este correo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
