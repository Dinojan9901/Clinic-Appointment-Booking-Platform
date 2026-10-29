FROM node:20-alpine
WORKDIR /app
COPY services/admin-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/admin-service/src ./src
EXPOSE 4006
CMD ["node", "src/index.js"]
