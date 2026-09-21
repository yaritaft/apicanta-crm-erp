-- Campos de calificación en `leads` — Apicanta ERP
--
-- Pedido de Yari: "quizá sería importante saber si tiene inglés conversacional
-- o no y cuántos años de experiencia tiene, en esta tablita para filtrarlos".
--
-- Son las dos cosas que decide si alguien puede entrar al programa: sin inglés
-- conversacional no da una entrevista en USA, y los años de experiencia marcan
-- a qué puesto puede apuntar.
--
-- Nombres alineados con `contacts.english_level` y `contacts.years_experience`
-- del backend real (apicanta-software), para no divergir el día que se unifiquen.
--
-- Nullable las dos: un lead recién entrado no tiene esto cargado, y un 0 en
-- experiencia significa "sin experiencia", que no es lo mismo que "no sabemos".

alter table public.leads
  add column if not exists "inglesNivel"      text,
  add column if not exists "aniosExperiencia" integer;

-- El nivel es un conjunto cerrado. Se valida acá y no sólo en la app para que
-- una importación de CSV no meta "avanzado" o "B2" y rompa los filtros.
alter table public.leads drop constraint if exists leads_ingles_nivel_ck;
alter table public.leads add constraint leads_ingles_nivel_ck
  check ("inglesNivel" is null or "inglesNivel" in
    ('ninguno', 'basico', 'intermedio', 'conversacional', 'nativo'));

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('inglesNivel', 'aniosExperiencia');
