FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Playwright 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
    libasound2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpango-1.0-0 libcairo2 libcups2 libdbus-1-3 libatspi2.0-0 \
    libwayland-client0 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

# 安装 Playwright Chromium 浏览器
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000
VOLUME ["/data"]

CMD ["npm", "start"]
