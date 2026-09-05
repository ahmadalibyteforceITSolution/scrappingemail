# Use Node.js 20 slim Linux base image
FROM node:20-slim

# Install system dependencies & Chromium for Puppeteer automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcups2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Install npm packages
COPY package*.json ./
RUN npm install --omit=dev

# Copy app files
COPY . .

# Expose ports (3000 for standard, 7860 for Hugging Face Spaces)
EXPOSE 3000
EXPOSE 7860

# Start Express server
CMD ["node", "server.js"]
