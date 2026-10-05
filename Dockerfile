FROM node:20-bookworm

RUN apt-get update && apt-get install -y gnupg2 lsb-release software-properties-common && \
    apt-add-repository -y "deb http://ppa.launchpad.net/bitcoin/bitcoin/ubuntu noble main" && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys C70EF1F0305A1ADB9986DBD8D46F45428842CE5E 2>/dev/null || true && \
    apt-get update && apt-get install -y bitcoin-cli && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

ENV BITCOIN_CLI=bitcoin-cli
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server.js"]
