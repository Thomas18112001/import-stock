module.exports = {
  apps: [
    {
      name: "wear-moi-stock-sync",
      cwd: __dirname,
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
    },
  ],
};
