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

## Un % que sube según el % de cierre (resell)

Desde el 26/11 una comisión de closer puede no ser un % fijo: «con menos de 25% de cierre 5%, entre 25% y 30% 10%, con más de 30% 12%».
No hace falta programar nada para cambiarla:

- **Dónde:** Equipo y honorarios → la persona → su comisión (la del servicio, por ejemplo «Comisión · Resell Mentoría») → paso
  «Porcentaje» → «El % sube según su % de cierre de resell del mes». El % que se escribe arriba es el de base; cada escalón dice
  «desde tanto de cierre, cobra tanto» («Con más de» para que recién valga al pasarlo).
- **Tiene historia como cualquier regla:** al guardar pregunta «¿desde cuándo?» y lo de antes queda como estaba.
- **Cómo se cuenta el % de cierre** (`src/lib/escala-cierre.ts`, `cierreDeResells`): personas que le compraron ese mes viniendo de una
  llamada de resell ÷ sus llamadas de resell de ese mes que se hicieron (sin canceladas, sin «No se presentó», sin las reagendadas).
  Una venta «viene de resell» si está atada a la llamada, si esa persona tuvo una llamada de resell con ese closer en los 60 días
  anteriores, o si es de un servicio que lleva la escala.
- **El % que alcanza vale para todo lo que cobra ese mes de ese servicio.** Sin llamadas en el mes, el de base.
- **Una sola cuenta para todos:** la liquidación, Finanzas (comisiones venta por venta, estado de resultados, resultado de cada
  webinar), las devoluciones y Mi panel del closer llaman a `cierreDeResells` y `tasaDeEscala`. En `equipo."comisionHistorial"` cada
  tramo lleva `escalas` (servicio → escala) y `servicios[id]` es el % de base. Si hay que tocarla por SQL, escribir las dos cosas
  (lo que cobra la persona y la historia del equipo) con lo que devuelven `conVersiones` e `historialParaFinanzas`, no a mano.
- **Se ve** en «Cómo se calculó» de cada renglón (la escala, el cierre, quién compró y qué llamadas contaron), en el cuadro de
  comisiones («5% a 12% · según cierre») y en Mi panel del closer («Tu comisión de resell»).
