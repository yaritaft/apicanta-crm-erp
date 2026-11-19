-- ==================================================================
-- «No se graba, porque no se concretó» (Lili, 19/11): un testimonio puede quedar en «Llamada agendada» y la llamada no hacerse nunca
-- (el alumno no se presentó, se cayó el proyecto): no es que no quiera, y no queda nada para agendar ni para pedirle. La app tiene ahora
-- ese Follow-up de testimonio (lib/clientes-cs.ts, FOLLOW_UP_NO_SE_CONCRETO) y un botón para eliminar el testimonio desde la ficha.
--
-- Qué cambia en la base. testimonio_pendiente_a_resell («si hay un testimonio con fecha de grabación y sin link, la llamada de resell
-- queda marcada como caso de éxito para que el closer diga qué pasó») ya dejaba afuera a «No quiere grabar» y a «Llamada agendada»;
-- ahora también al nuevo: si se marcó que no se concretó, no tiene sentido volver a marcar la llamada. Lo demás no se toca:
-- resell_agenda_a_testimonio sólo reescribe testimonios en ('', 'Pendiente de agendar', 'No agendada', 'Llamada agendada'), así que
-- una llamada nueva no pisa lo que Lili marcó.
--
-- Se reemplaza la condición en el cuerpo VIVO de la función. Se puede volver a correr.
-- ==================================================================

do $$
declare
  v_def text;
  v_viejo constant text := $q$in ('No quiere grabar', 'Llamada agendada')$q$;
  v_nuevo constant text := $q$in ('No quiere grabar', 'Llamada agendada', 'No se graba, porque no se concretó')$q$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'testimonio_pendiente_a_resell';
  if v_def is null then raise exception 'Falta la función testimonio_pendiente_a_resell'; end if;
  if position('No se graba, porque no se concretó' in v_def) > 0 then return; end if; -- ya aplicado
  if position(v_viejo in v_def) = 0 then raise exception 'La función cambió: no encuentro la condición para reemplazarla'; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

select pg_get_functiondef(p.oid) like '%No se graba, porque no se concretó%' as aplicado
from pg_proc p where p.proname = 'testimonio_pendiente_a_resell';
