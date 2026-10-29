FROM node:20-alpine
WORKDIR /app
COPY services/notification-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/notification-service/src ./src
EXPOSE 4004
CMD ["node", "src/index.js"]
