FROM node:20-bookworm

# Dependencies for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --build-from-source
COPY . .

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server-render.js"]
