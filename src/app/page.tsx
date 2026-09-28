import { redirect } from "next/navigation";

/* El inicio lleva al Dashboard, con lo que traiga la URL. El enlace del
   correo vuelve acá con ?code=…, y la app lo cambia por la sesión recién al
   cargar (supabase.ts, flujo PKCE): si el redirect tirara la query, la
   persona volvía al login sin haber entrado. */
export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  }
  const s = q.toString();
  redirect(s ? `/panel?${s}` : "/panel");
}
