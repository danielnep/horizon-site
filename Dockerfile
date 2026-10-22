FROM node:24-alpine
WORKDIR /srv/horizon
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
COPY . .
RUN npm test
ENV NODE_ENV=production PORT=3000 HORIZON_LEGACY_WORKER_EXPLICIT_OPT_IN=false HORIZON_PY_AGENTS_ENABLED=0 HORIZON_MEMORY_BRIDGE_ENABLED=0
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/central/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
