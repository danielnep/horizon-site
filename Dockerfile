FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HORIZON_PY_AGENTS_ENABLED=0 HORIZON_MEMORY_BRIDGE_ENABLED=0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
