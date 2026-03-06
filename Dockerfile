FROM node:20-slim

WORKDIR /app

# Copy package.json dan install dependencies
COPY backend/package.json ./
RUN npm install --omit=dev

# Copy backend source
COPY backend/ ./

# Copy frontend static files (dibutuhkan server.js via ../frontend)
COPY frontend/ ../frontend/

# Port Cloud Run
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
