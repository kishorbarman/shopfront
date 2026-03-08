FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system shopfront && adduser --system --ingroup shopfront shopfront

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public

USER shopfront
EXPOSE 3000
CMD ["node", "dist/index.js"]
