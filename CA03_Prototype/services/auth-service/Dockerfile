FROM node:20-alpine
WORKDIR /app
COPY services/auth-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/auth-service/src ./src
EXPOSE 4001
CMD ["node", "src/index.js"]
