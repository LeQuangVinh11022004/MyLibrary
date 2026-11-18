FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_FILE_HASH_REGISTRY_ADDRESS
ARG VITE_REDIS_API_ENABLED=false
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_FILE_HASH_REGISTRY_ADDRESS=$VITE_FILE_HASH_REGISTRY_ADDRESS
ENV VITE_REDIS_API_ENABLED=$VITE_REDIS_API_ENABLED
RUN npm run build

FROM node:22-alpine AS api

WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY server ./server
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
