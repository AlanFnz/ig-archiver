FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOST=0.0.0.0

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/server.js"]
