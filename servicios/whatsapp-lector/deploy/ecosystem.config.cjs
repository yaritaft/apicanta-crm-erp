/* pm2: dejar el lector andando y que arranque solo con el servidor.

     pm2 start deploy/ecosystem.config.cjs
     pm2 save
     pm2 startup        (copiá y pegá el comando que imprime)

   Los datos (APP_URL, el token…) los lee el propio servicio del archivo .env de esta carpeta. */
module.exports = {
  apps: [
    {
      name: 'apicanta-whatsapp-lector',
      script: 'src/index.js',
      cwd: `${__dirname}/..`,
      /* UNA sola copia: dos con la misma sesión de WhatsApp se pelean y se cierran entre sí. */
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      /* Si se cae, vuelve a levantar esperando cada vez más (2 s, 4 s, 8 s…). */
      exp_backoff_restart_delay: 2000,
      max_memory_restart: '500M',
      time: true,
      env: { NODE_ENV: 'production', TZ: 'America/Argentina/Buenos_Aires' },
    },
  ],
};
