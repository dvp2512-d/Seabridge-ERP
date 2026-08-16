# Production Dockerfile for Web
FROM node:18-alpine AS builder

WORKDIR /app

# Copy manifests first so dependency installation is cached
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/

RUN npm install

# Copy source
COPY apps/web ./apps/web

# Vite inlines VITE_* variables at build time, so it must be supplied here
# rather than as a runtime container environment variable. Empty means the
# bundle uses the relative "/api" path proxied by nginx below.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/apps/web
RUN npm run build

# ---------- Runtime image ----------
FROM nginx:alpine

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
