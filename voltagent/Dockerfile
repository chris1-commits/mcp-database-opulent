FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src/ src/
EXPOSE 3141
CMD ["npx", "tsx", "src/index.ts"]
