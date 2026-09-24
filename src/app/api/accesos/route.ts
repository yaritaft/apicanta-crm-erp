import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { nubeServidor } from "@/lib/servidor";

/* ==================================================================
   Dar acceso con clave: un dueño pide una clave nueva para alguien y se
   la pasa. Crea el usuario de Supabase si no existe (ya confirmado, sin
   mail de por medio) o le cambia la clave si ya existía, y lo deja en
   `usuarios_permitidos` con su nivel.

   Crear usuarios pide la clave de servicio, que saltea RLS: por eso vive
   acá y no en el navegador. Antes de usarla se le pregunta a la base si
   quien pide es dueño, con su propia sesión y la misma es_dueno() de las
   políticas. La clave nueva vuelve una sola vez en la respuesta y no se
   guarda ni se escribe en ningún log.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Doce letras y números sin los que se confunden (0/O, 1/l/I), en tres
   grupos: se dicta o se copia sin errores y alcanza de sobra. */
function claveNueva(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const azar = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(azar, (n) => letras[n % letras.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

async function esDueno(peticion: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return false;
  const db = createClient(url, anonima, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const r = await db.rpc("es_dueno");
  return !r.error && r.data === true;
}

/* El id del usuario de Supabase con ese correo. La API de administración
   no busca por correo: se recorre de a páginas (son pocas personas). */
async function idDeUsuario(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) return null;
    const u = r.data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u.id;
    if (r.data.users.length < 200) return null;
  }
  return null;
}

export async function POST(peticion: Request) {
  if (!(await esDueno(peticion))) {
    return NextResponse.json({ error: "Sólo un dueño puede dar accesos." }, { status: 403 });
  }
  const admin = nubeServidor();
  if (!admin) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor: sin eso no se pueden crear claves." }, { status: 503 });
  }

  const cuerpo = (await peticion.json().catch(() => ({}))) as { email?: string; nombre?: string; rol?: string };
  const email = String(cuerpo.email ?? "").trim().toLowerCase();
  const nombre = String(cuerpo.nombre ?? "").trim();
  const rol = cuerpo.rol === "dueno" ? "dueno" : "equipo";
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: "Ese correo no parece válido." }, { status: 400 });
  }

  /* Primero la lista: sin estar en ella, la clave no serviría de nada. */
  const lista = await admin.from("usuarios_permitidos").upsert({ email, nombre, rol }, { onConflict: "email" });
  if (lista.error) {
    const m = /al menos un due/i.test(lista.error.message) ? "Tiene que quedar al menos un dueño con acceso." : lista.error.message;
    return NextResponse.json({ error: m }, { status: 400 });
  }

  const clave = claveNueva();
  const creado = await admin.auth.admin.createUser({
    email, password: clave, email_confirm: true, user_metadata: nombre ? { nombre } : undefined,
  });
  if (creado.error) {
    const yaExiste = creado.error.code === "email_exists" || /already|registered|exists/i.test(creado.error.message);
    if (!yaExiste) return NextResponse.json({ error: creado.error.message }, { status: 500 });
    const id = await idDeUsuario(admin, email);
    if (!id) return NextResponse.json({ error: "El usuario existe pero no lo pude encontrar para cambiarle la clave." }, { status: 500 });
    const cambio = await admin.auth.admin.updateUserById(id, { password: clave, email_confirm: true });
    if (cambio.error) return NextResponse.json({ error: cambio.error.message }, { status: 500 });
  }

  return NextResponse.json({ email, clave }, { headers: { "Cache-Control": "no-store" } });
}
