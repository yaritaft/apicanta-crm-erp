"use client";

/* El último recurso: una falla en la base de la app (antes de que dibuje el menú). Es una página entera, sin los estilos de la app. */
export default function ErrorGlobal({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="es-AR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#120a24", color: "#f4f0ff", display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>La app no se pudo abrir</h1>
          <p style={{ opacity: 0.8, lineHeight: 1.5 }}>
            Recargá la página. Si sigue igual, mandá este código para que se arregle{error.digest ? `: ${error.digest}` : ""}.
          </p>
          <button
            type="button" onClick={() => window.location.reload()}
            style={{ marginTop: 12, padding: "10px 18px", borderRadius: 10, border: 0, background: "#ff7a1a", color: "#1a0d00", fontWeight: 600, cursor: "pointer" }}
          >
            Recargar la página
          </button>
        </div>
      </body>
    </html>
  );
}
