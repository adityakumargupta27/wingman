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
import { setRefreshToken } from './gmail.js';

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
  const server = http.createServer(async (req, res) => {
    // Parse URL with fallback host
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (reqUrl.pathname === '/health' || reqUrl.pathname === '/') {
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
    } else if (reqUrl.pathname === '/callback') {
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Error</h1><p>Missing authorization code.</p>');
        return;
      }

      if (state) {
        try {
          await setRefreshToken(state, code);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <div style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1 style="color: #22c55e;">✅ Authentication Successful</h1>
              <p>Gmail sync authorized for user <strong>${state}</strong>.</p>
              <p>You can now return to Discord or Telegram and run the sync command.</p>
            </div>
          `);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Authentication Failed</h1><p>${err.message}</p>`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family: sans-serif; padding: 40px; text-align: center; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 50px;">
            <h1 style="color: #3b82f6;">🔑 Authorization Code</h1>
            <p>Please copy the code below and paste it back into your bot command:</p>
            <textarea readonly style="width: 100%; height: 80px; padding: 10px; font-family: monospace; font-size: 14px; border: 1px solid #cbd5e1; border-radius: 6px; resize: none; background: #f8fafc;" onclick="this.select()">${code}</textarea>
            <p style="color: #64748b; font-size: 12px; margin-top: 15px;">Click the box to select all text, then copy.</p>
          </div>
        `);
      }
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
