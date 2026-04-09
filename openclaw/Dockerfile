FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

# Copy deps terlebih dulu (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright browsers (Chromium only, hemat image size)
RUN npx playwright install chromium --with-deps

COPY . .

ENV PORT=8080
ENV NODE_ENV=production

# Non-root user (security best practice Cloud Run)
RUN groupadd -r openclaw && useradd -r -g openclaw openclaw
RUN chown -R openclaw:openclaw /app
USER openclaw

EXPOSE 8080
CMD ["node", "server.js"]
