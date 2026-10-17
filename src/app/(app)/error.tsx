"use client";

import { useEffect } from "react";
import { PantallaDeError } from "@/components/ui/PantallaDeError";
import { CLAVE_RECARGA, esErrorDeCarga, puedeRecargarSola } from "@/lib/error-de-carga";

/* Si una pantalla se rompe, se cae ella y no la app: el menú de la izquierda sigue andando. Una versión vieja abierta
   (un archivo que ya no está) se recarga sola, una vez; cualquier otra falla muestra el detalle. */
export default function ErrorDeLaApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
    if (!esErrorDeCarga(error)) return;
    try {
      if (!puedeRecargarSola(window.sessionStorage.getItem(CLAVE_RECARGA), Date.now())) return;
      window.sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
    } catch { /* sin almacenamiento: se muestra el error y listo */ return; }
    window.location.reload();
  }, [error]);

  return <PantallaDeError titulo="Esta pantalla no se pudo abrir" error={error} onReintentar={reset} />;
}
