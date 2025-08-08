# ---- Base Image ----
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S user-service -u 1001

# Copy only package files for dependency layer
COPY package*.json ./

# ---- Dependency Installation ----
FROM base AS deps

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# ---- Build Application ----
FROM base AS build

COPY package*.json ./
RUN npm ci

# Copy rest of the app and build
COPY . .
RUN npm run build

# ---- Production Image ----
FROM base AS production

# Copy production dependencies
COPY --from=deps --chown=user-service:nodejs /app/node_modules ./node_modules

# Copy built code and package files
COPY --from=build --chown=user-service:nodejs /app/dist ./dist
COPY --from=build --chown=user-service:nodejs /app/package*.json ./

# Set environment
ENV NODE_ENV=production
ENV PORT=5001

# Health check (adjust `/health` endpoint if needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider --timeout=2 --tries=1 http://localhost:5001/health || exit 1

# Switch to non-root user
USER user-service

# Expose the service port
EXPOSE 5001

# Start the server using dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

# Metadata
LABEL maintainer="Kunal Singh <kunaltrad555.email@example.com>"
LABEL description="User Service for Chat Application"
LABEL version="1.0.0"
