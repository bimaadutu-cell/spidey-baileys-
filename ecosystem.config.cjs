// PM2 process file for the SPACEPRS WhatsApp worker (persistent host only).
// Usage: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "spaceprs-whatsapp",
      script: "server/workers/whatsapp-bot.mjs",
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        APP_URL: process.env.APP_URL ?? "http://localhost:3000",
        INTERNAL_TOKEN: process.env.INTERNAL_TOKEN ?? "",
        WHATSAPP_BOT_PHONE: process.env.WHATSAPP_BOT_PHONE ?? "",
        WHATSAPP_DELIVERY_TARGET: process.env.WHATSAPP_DELIVERY_TARGET ?? "6283115955196",
        GLOBAL_CHAT_SOURCE_JID: process.env.GLOBAL_CHAT_SOURCE_JID ?? "",
        SESSION_DIR: process.env.SESSION_DIR ?? "/var/lib/spaceprs/session",
      },
    },
  ],
};
