FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV MONSTER_TIMER_DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
