# Sumar una columna que el equipo elige de una lista (CRM)

Ejemplo real: «Estado follow-up» (Daniel, setter, 06/11/2026). Son pocos pasos porque todas las
pantallas (grilla, tabla, Ajustes, vistas guardadas, orden, colores, edición masiva) recorren
`CAMPOS_DE_OPCIONES` en `src/lib/crm.ts` en vez de nombrar los campos a mano.

1. `src/lib/types.ts`: el campo en `Sesion` y su nombre en `CampoOpcionesCrm`.
2. `src/lib/crm.ts`: sus opciones en `OPCIONES_POR_DEFECTO` (el compilador lo exige), su título en
   `TITULO_DE_OPCIONES`, su entrada en `CAMPOS` (grilla) y en `FilaCrm`/`armarFila`.
3. `src/lib/crm-tabla.ts` (tabla de `/crm`): `FilaTabla`, `ClaveColumna`, `COLUMNAS`, `CAMPO_DE_OPCIONES`,
   `EDITOR`, `escrituraDe`, `VISIBLES_POR_DEFECTO` y `COLUMNAS_SUMADAS` (para que quien ya guardó sus columnas la reciba).
4. `src/lib/store.ts`: el campo en `CambiosLlamada`.
5. `supabase/<nombre>.sql`: `alter table public.sesiones add column if not exists "<campo>" text;`.
   **Correrlo ANTES de publicar**: sin la columna, el store saca el campo en silencio al guardar y no se guarda nunca.
6. `pruebas-estres/store/columnas-sql.test.ts`: el campo en `NUEVOS_DE_HOY` y una prueba como `pruebas/follow-up.test.ts`.

`pruebas/follow-up.test.ts` falla si alguna pantalla vuelve a escribir la lista de campos a mano.

Ojo: **Ajustes → Campos propios → Sesiones** crea campos que se guardan en `sesion.extra`, pero hoy sólo se ven en
el formulario y la ficha de la Agenda, no en el CRM. Hasta que se conecten, una columna nueva del CRM se pide por código.
