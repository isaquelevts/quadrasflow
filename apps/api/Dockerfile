FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @quadrasflow/contracts \
 && npm run build --workspace @quadrasflow/database \
 && npm run build --workspace @quadrasflow/api

FROM node:24-bookworm-slim
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --omit=dev
COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/database/dist packages/database/dist
WORKDIR /workspace/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
