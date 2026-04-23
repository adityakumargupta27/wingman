module.exports = {
  apps: [
    {
      name: "wingman",
      script: "./index.js",
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
