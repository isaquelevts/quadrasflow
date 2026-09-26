FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @quadrasflow/web

FROM nginx:1.29-alpine
ARG API_UPSTREAM=api
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s/__API_UPSTREAM__/${API_UPSTREAM}/g" /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
