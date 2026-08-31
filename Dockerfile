# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy monorepo configurations and every workspace package required by the API.
COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/deadlock-build-domain/package.json ./packages/deadlock-build-domain/
COPY apps/api/package.json ./apps/api/

RUN yarn install --frozen-lockfile --ignore-engines

COPY packages/shared ./packages/shared
COPY packages/deadlock-build-domain ./packages/deadlock-build-domain
COPY apps/api ./apps/api

RUN yarn workspace @deadlock-live-probe/shared build
RUN yarn workspace @deadlock-live-probe/build-domain build
RUN yarn workspace @deadlock-live-probe/api build

# Stage 2: Production runtime
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json /app/yarn.lock ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/deadlock-build-domain/package.json ./packages/deadlock-build-domain/
COPY --from=builder /app/packages/deadlock-build-domain/dist ./packages/deadlock-build-domain/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

RUN yarn install --production --frozen-lockfile --ignore-engines

WORKDIR /app/apps/api
EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/src/main.js"]
