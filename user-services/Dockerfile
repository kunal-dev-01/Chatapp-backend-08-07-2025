# user-service/Dockerfile
FROM node:20-alpine AS base

WORKDIR /app

RUN apk add --no-cache dumb-init curl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S userservice -u 1001

COPY package*.json ./

FROM base AS deps
RUN npm ci --only=production && npm cache clean --force

FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS production
COPY --from=deps --chown=userservice:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=userservice:nodejs /app/dist ./dist
COPY --from=build --chown=userservice:nodejs /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=5001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

USER userservice
EXPOSE 5001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]