module.exports = {
  apps: [
    {
      name: "wingman",
      script: "./index.js",
      watch: false,
      
      // ── Memory & Restart ──────────────────────────────────────────
      max_memory_restart: "450M",
      autorestart: true,
      restart_delay: 5000,       // 5s between restart attempts
      max_restarts: 50,          // Max restarts in min_uptime window
      min_uptime: "30s",         // Process must run 30s to be "stable"
      
      // ── Crash Protection ──────────────────────────────────────────
      exp_backoff_restart_delay: 1000, // Exponential backoff on repeated crashes
      kill_timeout: 8000,              // Wait 8s for graceful shutdown
      
      // ── Logging ───────────────────────────────────────────────────
      error_file: "./data/wingman-pm2-error.log",
      out_file: "./data/wingman-pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      
      // ── Environment ───────────────────────────────────────────────
      env: {
        NODE_ENV: "production",
        HEADLESS: "true",
      }
    }
  ]
};
