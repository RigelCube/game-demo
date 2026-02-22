FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.ts ./
EXPOSE 3001
CMD ["bun", "run", "index.ts"]
