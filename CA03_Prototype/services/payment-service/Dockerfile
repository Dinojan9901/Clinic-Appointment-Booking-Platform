FROM node:20-alpine
WORKDIR /app
COPY services/payment-service/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY common ./common
COPY services/payment-service/src ./src
EXPOSE 4005
CMD ["node", "src/index.js"]
