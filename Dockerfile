FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
# sem etapa de build: roda com tsx, como em desenvolvimento (as variáveis vêm do docker-compose)
CMD ["node", "--import", "tsx", "src/index.ts"]
