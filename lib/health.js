/**
 * lib/health.js — Health check HTTP endpoint for Wingman
 *
 * ALWAYS returns 200 OK. Bot readiness is reported in the response body.
 * This prevents Railway/Docker from killing the container during startup
 * or when Discord is temporarily disconnected.
 *
 * Binds to 0.0.0.0 for container compatibility.
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
 * GET /health or GET / → 200 OK always.
 * Body includes bot readiness, uptime, queue stats, and memory usage.
 */
export function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const body = {
        status: 'ok',
        bot_ready: discordReady,
        uptime: Math.round(process.uptime()),
        queue: geminiQueue.stats,
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    log.info('Health check server started', { port: PORT, host: '0.0.0.0' });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn('Health check port in use, skipping', { port: PORT });
    } else {
      log.error('Health check server error', { error: err.message });
    }
  });

  return server;
}
