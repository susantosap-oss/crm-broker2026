FROM node:20-slim

# Install ffmpeg (video compression) + ca-certificates (Baileys TLS)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core fontconfig ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (layer cache)
COPY backend/package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy source
COPY backend/ ./
COPY frontend/ ../frontend/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
