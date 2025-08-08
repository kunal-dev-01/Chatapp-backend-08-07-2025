# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gateway -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
FROM base AS deps
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM base AS production

# Copy node_modules from deps stage
COPY --from=deps --chown=gateway:nodejs /app/node_modules ./node_modules

# Copy built application from build stage
COPY --from=build --chown=gateway:nodejs /app/dist ./dist
COPY --from=build --chown=gateway:nodejs /app/package*.json ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider --timeout=2 --tries=1 http://localhost:3000/health || exit 1

# Switch to non-root user
USER gateway

# Expose port
EXPOSE 3000

# Start application with dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

# Labels for better maintainability
LABEL maintainer="Kunal Singh <kunaltrad555.email@example.com>"
LABEL description="Advanced API Gateway for Chat Application"
LABEL version="1.0.0"