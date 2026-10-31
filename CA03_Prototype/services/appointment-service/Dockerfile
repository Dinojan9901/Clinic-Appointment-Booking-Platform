FROM node:20-alpine
WORKDIR /app
COPY services/appointment-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/appointment-service/src ./src
EXPOSE 4002
CMD ["node", "src/index.js"]
