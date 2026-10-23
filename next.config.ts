import type { NextConfig } from "next";

/* La versión publicada: cambia con cada deploy. La app la compara con la de /api/version y, si hay una nueva, pide
   actualizar (components/shell/AvisoVersion). Se fija al compilar, la misma para el servidor y el navegador. */
const VERSION_APP = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  env: { VERSION_APP },
};

export default nextConfig;
