FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ARG OCI_SOURCE=https://github.com/your-github-username/job-application-copilot
LABEL org.opencontainers.image.source=$OCI_SOURCE
LABEL org.opencontainers.image.description="Private ApplyPilot job application copilot"
LABEL org.opencontainers.image.licenses="UNLICENSED"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["npm", "run", "start"]
