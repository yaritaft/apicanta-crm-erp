-- El mail de bienvenida del alumno al firmar el contrato (Lili, 22/10; lib/bienvenida-alumno.ts): su roadmap según el
-- perfil, el paso a paso, el formulario de los lunes y el WhatsApp de soporte. Sale una sola vez por contrato: estas dos
-- columnas lo marcan (cuándo salió y su id en Resend). Aditivo: no toca datos.
alter table public.contratos add column if not exists "bienvenidaMailEn" timestamptz;
alter table public.contratos add column if not exists "bienvenidaMailId" text;

-- Los links de los roadmaps por perfil y los WhatsApp de soporte (Lili y Aldana): en Ajustes y no en el código, porque
-- el repositorio es público. Forma: { "roadmaps": { "Full Stack": "https://…", … }, "soporte": { "nombre", "whatsapp" },
-- "auditoriaCv": { "nombre", "whatsapp" } }. Los valores se cargan aparte (no van en este archivo).
alter table public.ajustes add column if not exists bienvenida jsonb;
