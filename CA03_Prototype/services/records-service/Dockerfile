FROM node:20-alpine
WORKDIR /app
COPY services/records-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/records-service/src ./src
EXPOSE 4003
CMD ["node", "src/index.js"]
