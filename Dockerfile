FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
VOLUME ["/data"]

CMD ["npm", "start"]
