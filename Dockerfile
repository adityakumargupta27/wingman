FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# System-level hardening
ENV NODE_ENV=production
ENV HEADLESS=true
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /usr/src/app

# Install PM2 globally first (cached layer)
RUN npm install pm2 -g

# Install app dependencies (cached unless package*.json changes)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Install Playwright browsers (Chromium only — saves ~400MB)
RUN npx playwright install chromium --with-deps

# Copy app source
COPY . .

# Create data directory for persistent DB + logs
RUN mkdir -p /usr/src/app/data

# Health check for container orchestrators
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

# Start with PM2 runtime (auto-restart, log management)
CMD ["pm2-runtime", "pm2.config.cjs"]
