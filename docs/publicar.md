# Publicar a producción sin pisar a nadie

El proyecto de Vercel `apicanta-erp` **no está conectado a git**: un `git push` no publica. Se publica con
`vercel deploy --prod`, que sube **la carpeta tal cual está**. Con varias sesiones trabajando a la vez (cada una en su copia),
publicar desde una copia vieja, o con cosas sin commitear, deja producción sin lo que otro ya había publicado, y no avisa.

**Pasó el 19/10/2026:** un deploy de las 11:35, hecho desde una copia basada en un commit viejo, dejó producción sin tres
commits que ya estaban publicados (Deshacer en reembolsos, el link de Drive del importador y los reembolsos «sin
identificar»). Se descubrió comparando los archivos de producción con `origin/main` uno por uno. Eso es lo que automatiza
`scripts/verificar-deploy.mjs`.

## La regla

1. **Se publica una copia limpia de `origin/main`**, nunca la carpeta compartida (suele estar atrasada o con trabajo de otros).
2. Primero se **pushea a `main`**, después se publica esa misma copia: lo publicado y lo que dice `main` son lo mismo.
3. Se corre la guardia **antes** y **después**.

## Paso a paso

```bash
# 1. una copia limpia de lo que está en main (o la tuya, si ya está igual a origin/main y pusheada)
git fetch origin
git worktree add --detach <carpeta> origin/main
cp -cR node_modules <carpeta>/node_modules          # en APFS es instantáneo
mkdir -p <carpeta>/.vercel && cp .vercel/project.json <carpeta>/.vercel/

# 2. la guardia, antes
node scripts/verificar-deploy.mjs antes --dir <carpeta>

# 3. publicar (un solo comando, sin cd ni pipes: así lo reconoce la regla de permisos `Bash(vercel deploy *)`)
vercel deploy --prod --yes --cwd <carpeta>

# 4. la guardia, después (con algún texto que sólo exista en la versión nueva)
node scripts/verificar-deploy.mjs despues --dir <carpeta> --texto "Todos los links del webinar"
```

También hay atajos: `npm run deploy:antes -- --dir <carpeta>`, `npm run deploy:despues -- --dir <carpeta> --texto "…"` y
`npm run deploy:comparar` (sólo mira).

## Qué hace cada comando

**`antes`** frena (código de salida 1) si:

- la carpeta no es exactamente `origin/main`: le faltan commits (copia vieja), tiene commits sin pushear o ambas cosas;
- tiene archivos modificados o nuevos sin commitear (la CLI los subiría tal cual);
- producción tiene algún archivo que `origin/main` no tiene o con un contenido que no está en su historia (trabajo sin
  commitear o de una rama sin mergear): publicar lo **borraría**.

Si producción sólo tiene versiones **más viejas** de archivos de `origin/main`, no frena: avisa con ⚠ y lista los commits
que producción todavía no tiene, que es lo que este deploy va a agregar.

**`despues`** espera a que `apicanta-erp.vercel.app` sirva el deploy de producción más nuevo y esté listo (la CLI a veces dice
«no pude confirmar» con el deploy ya listo), y comprueba que:

- el commit del deploy es el de la carpeta que publicaste (si no, otra sesión publicó después, o el deploy no salió);
- los archivos de producción son idénticos a ese commit;
- cada `--texto` aparece en los bundles públicos de la ruta `--ruta` (por defecto `/ajustes`). Las pantallas piden
  login, pero los archivos estáticos no. Un botón de otra pantalla está en el bundle de **esa** pantalla: pasá su ruta.

**`comparar`** sólo informa: producción contra `origin/main` (`--ref` para otro commit, `--deploy dpl_…` para mirar un deploy
viejo, por ejemplo para investigar un incidente).

Códigos de salida: `0` bien · `1` hay que frenar · `2` no se pudo verificar (sin red, sin sesión de Vercel, etc.).

## Cómo leer el informe

| Mensaje | Qué significa |
| --- | --- |
| `✔ producción es idéntica a origin/main` | no hay nada pendiente |
| `⚠ N archivo(s) son más viejos` + lista de commits | producción está atrasada: publicar `origin/main` la pone al día |
| `✖ … NO están en origin/main y se perderían` | hay trabajo publicado que no está en `main`: commitealo y pusheálo (o decidí soltarlo) **antes** |
| `· N archivo(s) que .gitignore ignora subieron igual` | `next-env.d.ts`, `tsconfig.tsbuildinfo`… los genera un `tsc` o un `next build` local y la CLI los sube aunque estén en `.gitignore`. No se pierde nada: no frena |
| `⚠ el commit publicado NO es parte de la historia de origin/main` | alguien publicó un commit que no se pusheó, o que se rebaseó después |
| `✖ le faltan commits de origin/main` | tu copia está vieja: `git fetch` y partí de `origin/main` |

## Lo que no mira

Sólo compara el **código subido**. No ve las variables de entorno de Vercel ni el SQL corrido en Supabase: eso sigue
siendo a mano (el SQL de cada lote se corre aparte y se anota en la memoria del proyecto).

## Cómo funciona (por si hay que tocarlo)

- Vercel guarda de cada deploy hecho con la CLI el árbol de archivos con el **sha1 del contenido crudo** de cada uno
  (`GET /v6/deployments/{id}/files`; no es el hash de blob de git). Se compara con el sha1 del contenido de cada archivo de
  `origin/main` (`git cat-file --batch`). Se ignoran los `.gitignore`, `node_modules` y lo que genera el build.
- Para cada archivo distinto se busca esa versión en la historia de `origin/main` (más vieja) y después en las demás ramas
  (trabajo sin mergear); si no está en ninguna, es trabajo sin commitear.
- Los pedidos a Vercel los hace `vercel api` con la sesión de la CLI: el script no lee ni guarda ningún token. Hay que estar en la
  cuenta que ve el equipo `apicanta` (`vercel whoami` → `juancruzrusso`).
- El código está en `scripts/deploy/` (`arbol.mjs` y `informe.mjs` son la lógica; `git.mjs` y `vercel.mjs`, la entrada y salida) y
  las pruebas, en `pruebas/verificar-deploy.test.ts` (repos de git temporales: no tocan la red).
