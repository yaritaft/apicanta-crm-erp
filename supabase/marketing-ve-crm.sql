-- ==================================================================
-- Marketing (Agustín, el growth partner) ve el CRM (Agustín, 26/10: «me
-- darías acceso al CRM?»). Para mirar: cada llamada con su estado y lo de la
-- persona, para cruzar la calidad de los leads con lo que pasa en las
-- llamadas. No las edita: eso sigue siendo del CRM de los closers y del
-- director. Si un dueño ya le cambió el CRM al tipo desde Equipo → Tipos de
-- cuenta, no se toca. Se puede volver a correr.
-- ==================================================================

update public.tipos_cuenta
   set areas = areas || '{"crm":"ver"}'::jsonb,
       descripcion = 'Webinars y Marketing; ve los leads y el CRM. En el Dashboard, adquisición y el webinar.',
       "actualizadoEn" = now()
 where id = 'marketing'
   and not (areas ? 'crm');
