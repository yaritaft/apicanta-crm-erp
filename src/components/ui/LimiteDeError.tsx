"use client";

import React from "react";
import { PantallaDeError } from "@/components/ui/PantallaDeError";

/* Un error adentro de una parte de la pantalla (la herramienta de un paso de Finanzas) no tira abajo la pantalla entera: esa
   parte dice que no se pudo mostrar, con el detalle, y el resto sigue andando. Se vuelve a intentar con otra clave de `reinicia`. */
export class LimiteDeError extends React.Component<
  { nombre: string; reinicia?: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[${this.props.nombre}]`, error);
  }

  componentDidUpdate(previas: { reinicia?: string }) {
    if (this.state.error && previas.reinicia !== this.props.reinicia) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <PantallaDeError compacta titulo={`No se pudo mostrar ${this.props.nombre}`} error={this.state.error} onReintentar={() => this.setState({ error: null })} />;
  }
}
