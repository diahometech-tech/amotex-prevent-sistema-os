// PM2 — produção (VPS Contex)
// Uso: pm2 start ecosystem.config.js && pm2 save
// Variáveis sensíveis (DATABASE_URL, JWT_SECRET...) ficam no .env do projeto —
// `next start` lê .env/.env.production do cwd automaticamente.
module.exports = {
  apps: [
    {
      name: 'nexusflow',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      // Timestamp em cada linha de log — necessário para filtrar por janela de
      // tempo (ex.: "últimas 24h") ao revisar logs de erro em produção.
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
