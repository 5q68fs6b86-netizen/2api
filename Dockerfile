FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV AUTO_FILL_ON_STARTUP=true

# Playwright 和 Turnstile solver 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 python3-pip python3-tk python3-dev xvfb xauth \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
    libasound2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpango-1.0-0 libcairo2 libcups2 libdbus-1-3 libatspi2.0-0 \
    libwayland-client0 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/requirements-turnstile.txt ./requirements-turnstile.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-turnstile.txt

COPY package*.json ./
RUN npm ci

# 安装 Playwright Chromium 浏览器
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000
VOLUME ["/data"]

CMD ["npm", "start"]
