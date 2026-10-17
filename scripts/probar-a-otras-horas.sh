#!/bin/bash
# Corre toda la suite (normal + estrés) «a otras horas» y desde otros husos, con el reloj de las pruebas movido (pruebas/reloj-falso.mjs).
#
# El software corre en la hora de la empresa (Argentina, UTC-3 todo el año; lib/hora-argentina.ts): el «hoy», los cortes de mes de
# Finanzas y cada hora que se muestra son de allá, mire quien mire y desde donde mire. Por eso TODO tiene que dar verde en TODOS estos
# casos: a las 22 de acá (ya es mañana en UTC), a fin de mes y de año, y con la computadora en Tokio, Auckland, Los Ángeles (con horario
# de verano), la India (media hora corrida) o Terranova.
#
#   scripts/probar-a-otras-horas.sh
cd "$(dirname "$0")/.." || exit 1
CASOS=(
  "2026-10-16T22:30:00-03:00|America/Argentina/Buenos_Aires"
  "2026-10-16T22:30:00-03:00|UTC"
  "2026-10-31T23:30:00-03:00|America/Argentina/Buenos_Aires"
  "2026-10-31T23:30:00-03:00|Asia/Tokyo"
  "2026-10-31T23:30:00-03:00|Pacific/Auckland"
  "2026-10-17T00:20:00-03:00|America/Argentina/Buenos_Aires"
  "2026-12-31T22:30:00-03:00|America/Los_Angeles"
  "2026-12-31T22:30:00-03:00|Pacific/Kiritimati"
  "2026-10-19T09:00:00-03:00|Asia/Kolkata"
  "2026-11-01T01:30:00-03:00|America/St_Johns"
  "2026-11-01T03:30:00-03:00|America/New_York"
  "2026-10-18T14:00:00-03:00|Europe/Madrid"
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
for e in "${CASOS[@]}"; do corre "$e" || malos=$((malos + 1)); done
[ "$malos" -eq 0 ] && echo "TODO VERDE en los ${#CASOS[@]} casos" || { echo "FALLARON $malos de ${#CASOS[@]} casos"; exit 1; }
