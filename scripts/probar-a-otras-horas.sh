#!/bin/bash
# Corre toda la suite (normal + estrés) «a otras horas», con el reloj de las pruebas movido (pruebas/reloj-falso.mjs).
#
# Para qué: encontrar lo que sólo falla de noche (a las 22 de Argentina ya es mañana en UTC), a fin de mes o de año.
# El negocio corre en hora de Argentina y la app toma el día y el mes de ahí: estos casos TIENEN que dar todo verde.
#
#   scripts/probar-a-otras-horas.sh            # los casos de Argentina
#   scripts/probar-a-otras-horas.sh --otros    # además, otros husos horarios (sólo informa: ver abajo)
#
# Otros husos: los cortes de mes de Finanzas se hacen «en la hora de acá» (lib/periodos.ts), o sea la de la computadora de
# quien mira. Desde otro huso (Tokio, Auckland) algunas pruebas de plata fallan a propósito: es un límite conocido, no un error nuevo.
cd "$(dirname "$0")/.." || exit 1
ARG=(
  "2026-10-16T22:30:00-03:00|America/Argentina/Buenos_Aires"
  "2026-10-16T22:30:00-03:00|UTC"
  "2026-10-31T23:30:00-03:00|America/Argentina/Buenos_Aires"
  "2026-10-31T23:30:00-03:00|UTC"
  "2026-10-17T00:20:00-03:00|America/Argentina/Buenos_Aires"
  "2026-12-31T22:30:00-03:00|America/Argentina/Buenos_Aires"
  "2026-10-18T14:00:00-03:00|Europe/Madrid"
)
OTROS=(
  "2026-10-19T09:00:00-03:00|Asia/Tokyo"
  "2026-03-01T01:00:00-03:00|Pacific/Auckland"
)
corre() {
  local ahora="${1%%|*}" tz="${1##*|}"
  local r; r=$(FAKE_NOW="$ahora" TZ="$tz" node --import ./pruebas/registrar.mjs --import ./pruebas/reloj-falso.mjs --test "pruebas/**/*.test.ts" "pruebas-estres/**/*.test.ts" 2>&1)
  local fallan; fallan=$(echo "$r" | grep -E "^ℹ fail" | awk '{print $3}')
  echo "=== $ahora  TZ=$tz  -> pasan=$(echo "$r" | grep -E '^ℹ pass' | awk '{print $3}') fallan=$fallan"
  echo "$r" | grep -E "^✖" | grep -v "failing tests" | sort -u | cut -c1-160 | head -12
  return $(( ${fallan:-1} > 0 ))
}
malos=0
for e in "${ARG[@]}"; do corre "$e" || malos=$((malos + 1)); done
if [ "$1" = "--otros" ]; then for e in "${OTROS[@]}"; do corre "$e" || true; done; fi
[ "$malos" -eq 0 ] && echo "TODO VERDE en los casos de Argentina" || { echo "FALLARON $malos caso(s) de Argentina"; exit 1; }
