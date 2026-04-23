FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Run the deploy script to register slash commands
RUN node deploy-commands.js || true

# Start PM2
RUN npm install pm2 -g
CMD ["pm2-runtime", "pm2.config.js"]
