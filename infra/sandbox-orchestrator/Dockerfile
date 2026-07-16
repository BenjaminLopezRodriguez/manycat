FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=8080
ENV WORKSPACE_ROOT=/workspaces
ENV DOCKER_SOCKET=/var/run/docker.sock

EXPOSE 8080

CMD ["node", "src/index.js"]
