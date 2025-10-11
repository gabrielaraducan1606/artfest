module.exports = {
  apps: [
    {
      name: "artfest-api",
      script: "backend/server.js",
      instances: "max",
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
        PORT: 8080
        // celelalte ENV vin din /etc/environment sau din service manager
      }
    }
  ]
}
