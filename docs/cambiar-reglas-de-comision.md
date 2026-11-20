# Cambiar una regla de comisión sin perder la historia

> Yari (20/11/2026): «Si cada vez que yo te digo "las comisiones ahora se
> calculan así", vos borrás lo que tenemos y ponés otra cosa, después, cuando
> analicemos la información hacia el pasado, no va a andar bien. Que en cada
> momento de la facturación te calcule las cosas como se calculaban en ese
> momento.»

## La regla

**Una regla que ya valió no se pisa: se le pone fin y arranca una versión nueva.**

- La de antes queda con `hasta` = el día anterior al cambio.
- La nueva arranca con `desde` = el día del cambio y lleva `versionDe` = el id
  de la primera versión de esa regla.
- Sacar una regla tampoco la borra: se le pone `hasta`.
- Pisar (cambiar en el lugar) sólo cuando la regla **estaba mal cargada**
  («Siempre fue así»): cambia también los meses de antes que no estén cerrados.

El motor de la liquidación ya mide cada versión sólo en sus días, y Finanzas,
los webinars y las devoluciones calculan cada cobro con el % que valía ese día
(`equipo.comisionHistorial`). Lo que se liquidó en un mes cerrado no cambia
nunca: queda la foto del cierre.

## Desde la app

Equipo → ficha de la persona → editar o sacar una regla, o Equipo → Comisiones
(tocar una celda): siempre pregunta **«¿Desde cuándo vale?»**. Debajo de cada
regla se ve «Cómo era antes», y en la solapa Reglas, «Cambios de reglas».

## Por SQL (sesiones de Claude, arreglos a mano)

1. No hagas `update honorarios set conceptos = …` cambiando un `tasa`, una base
   o un filtro en el lugar. Armá la versión nueva con
   `conVersiones(previos, nuevos, { tipo: "desde", dia }, nuevoId)` de
   `src/lib/versiones-regla.ts` (correlo con
   `node --import ./pruebas/registrar.mjs tu-script.ts`) y escribí ese
   resultado.
2. Escribí también `equipo."comisionHistorial"` con
   `historialParaFinanzas(miembro, esquema)` (`src/lib/honorarios.ts`). Si te
   lo olvidás, la app lo realinea sola la próxima vez que un dueño o quien
   liquida abre Equipo (`acciones.alinearHistoriasDeFinanzas`), pero hasta
   entonces Finanzas usa el % de hoy.
3. Aunque te equivoques, no se pierde nada: el disparador
   `honorarios_guarda_version` guarda cada versión anterior en
   `honorarios_versiones` (nadie la puede editar ni borrar por la API). Para
   recuperar una:

   ```sql
   select "guardadaEn", "guardadaPor", motivo, conceptos
   from honorarios_versiones where "miembroId" = 'eq_…' order by "guardadaEn" desc;
   ```

Ver también `supabase/reglas-con-historia.sql` y
`pruebas/reglas-con-historia.test.ts`.
