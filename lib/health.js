/**
 * lib/health.js — Health check HTTP endpoint for Wingman
 *
 * Minimal HTTP server for container health probes (Docker, Fly.io, Railway).
 * Reports bot connection status, uptime, and queue stats.
 */

import http from 'http';
import { geminiQueue } from './queue.js';
import log from './logger.js';

const PORT = parseInt(process.env.PORT || '8080');

let discordReady = false;

/**
 * Mark the bot as connected and healthy.
 * Called from index.js once the Discord client is ready.
 */
export function setReady(ready = true) {
  discordReady = ready;
}

/**
 * Start the health check server.
 * GET /health → 200 if bot is connected, 503 otherwise.
 */
export function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const healthy = discordReady;
      const status = healthy ? 200 : 503;
      const body = {
        status: healthy ? 'ok' : 'starting',
        uptime: Math.round(process.uptime()),
        queue: geminiQueue.stats,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString(),
      };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(PORT, () => {
    log.info('Health check server started', { port: PORT });
  });

  server.on('error', (err) => {
    // Port already in use is non-fatal — health checks are optional locally
    if (err.code === 'EADDRINUSE') {
      log.warn('Health check port in use, skipping', { port: PORT });
    } else {
      log.error('Health check server error', { error: err.message });
    }
  });

  return server;
}
