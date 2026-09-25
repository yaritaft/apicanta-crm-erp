import { redirect } from "next/navigation";

/* El tablero de leads se reemplazó por el CRM (Booking Calls, como el
   Airtable de ventas). Los links viejos y los favoritos llevan ahí. La
   etapa de cada lead se sigue cambiando desde su ficha. */
export default function Pipeline() {
  redirect("/crm");
}
