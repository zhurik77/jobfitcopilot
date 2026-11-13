# Контекст сборки: корень репозитория, потому что prompts.js импортирует shared/constants.js.
#   docker build -f server/Dockerfile -t jobfitcopilot-server .
FROM node:24-alpine

ENV NODE_ENV=production \
    DB_PATH=/data/jobfit.db \
    PORT=8765 \
    HOST=0.0.0.0

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/src ./src
COPY server/public ./public
# Путь совпадает с ../../../shared/constants.js относительно server/src/core/prompts.js.
COPY shared/constants.js /app/shared/constants.js

# Каталог данных отдаём непривилегированному пользователю, иначе том будет root-овым.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8765/healthz || exit 1

CMD ["node", "src/index.js"]
