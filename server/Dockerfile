# Контекст сборки: корень репозитория, потому что server/src/core/prompts.js
# импортирует shared/constants.js по относительному пути.
#   docker build -f server/Dockerfile -t jobfitcopilot-server .
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DB_PATH=/data/jobfit.db

WORKDIR /app

# Устанавливаем зависимости — кэшируется, пока package*.json не меняются.
COPY server/package*.json ./
RUN npm ci --production && npm cache clean --force

# Общий модуль, от которого зависит сервер.
COPY shared/constants.js ./shared/constants.js

# Исходники сервера и статика панели.
# ВАЖНО: контекст сборки — корень репозитория, поэтому пути указаны относительно него.
# shared/constants.js импортируется из src/core/prompts.js по относительному пути.
COPY shared ./shared
COPY server/src ./src
COPY server/public ./public

# Тесты включаем в образ для диагностики в production (не запускаются по умолчанию).
COPY server/test ./test

# Непривилегированный пользователь.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/healthz',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "src/index.js"]
