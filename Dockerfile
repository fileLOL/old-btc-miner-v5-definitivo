FROM node:20-bookworm

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server-render.js"]
