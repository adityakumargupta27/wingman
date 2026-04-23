FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Bundle app source
COPY . .

# Start PM2
RUN npm install pm2 -g
CMD ["pm2-runtime", "pm2.config.js"]
