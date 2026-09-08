// PM2 process definition for the production Node process. Run `npm run build`
// once beforehand — this starts the built output, it does not build it.
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "projman-product",
      cwd: __dirname,
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
