/* ==================================================================
   Un comprobante que viene como link, para verlo sin salir de la app.

   La planilla de siempre guardaba el comprobante como un link (casi siempre
   de Drive). Aldana (17/10): «lo tengo que abrir en otra pestaña». Acá se
   decide cómo mostrarlo adentro:
   - Drive (archivo, open?id=, uc?id=): el visor de Drive en un marco
     (/preview). Se ve si quien mira tiene acceso al archivo en Google;
   - una imagen suelta (.png, .jpg, .webp, .gif): se muestra la imagen;
   - un PDF suelto (.pdf): en un marco;
   - cualquier otro link: sólo el botón para abrirlo.
   Nunca se embebe un link que no sea https.
   ================================================================== */

export type VistaPreviaDeLink =
  | { tipo: "marco"; src: string; origen: "drive" | "pdf" }
  | { tipo: "imagen"; src: string }
  | { tipo: "enlace" };

const ID_DRIVE = /^[A-Za-z0-9_-]{10,}$/;

/** El id de un archivo de Drive en cualquiera de sus formas de link. */
export function idDeDrive(url: URL): string | null {
  if (url.hostname !== "drive.google.com") return null;
  const enRuta = /\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(url.pathname)?.[1];
  const id = enRuta ?? ((url.pathname === "/open" || url.pathname === "/uc") ? url.searchParams.get("id") : null);
  return id && ID_DRIVE.test(id) ? id : null;
}

export function vistaPreviaDeLink(link: string | undefined | null): VistaPreviaDeLink {
  if (!link) return { tipo: "enlace" };
  let url: URL;
  try { url = new URL(link.trim()); } catch { return { tipo: "enlace" }; }
  if (url.protocol !== "https:") return { tipo: "enlace" };

  const id = idDeDrive(url);
  if (id) return { tipo: "marco", origen: "drive", src: `https://drive.google.com/file/d/${id}/preview` };

  const ruta = url.pathname.toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/.test(ruta)) return { tipo: "imagen", src: url.toString() };
  if (ruta.endsWith(".pdf")) return { tipo: "marco", origen: "pdf", src: url.toString() };
  return { tipo: "enlace" };
}
