# HD-Search API — multi-stage build. Compiles TS → JS, ships a slim runtime image.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY mcp ./mcp
COPY db ./db
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# only production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
COPY src/priorities.csv ./src/priorities.csv
COPY --from=build /app/dist/src/ai/llm-providers.json ./dist/src/ai/llm-providers.json
# non-root. /secrets is a shared volume (with the web app) where auto-generated
# crypto secrets (encryption/internal/session) are persisted — no secrets in env.
RUN useradd -r -u 10001 hdsearch \
  && mkdir -p /secrets && chown hdsearch:hdsearch /secrets \
  && chown -R hdsearch /app
USER hdsearch
EXPOSE 8791 8792
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HDSEARCH_API_PORT||8791)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
