module.exports = {
  apps: [
    {
      name: "import-stock-boutique",
      cwd: "/var/www/import-stock-wearmoi",
      script: "npm",
      args: "run start:prod",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
