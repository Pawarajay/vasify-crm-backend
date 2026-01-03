FROM node:22-alpine

WORKDIR /app

RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001

COPY package.json /app

COPY package-lock.json /app

RUN npm install

COPY . /app/

ENV NEXT_TELEMETRY_DISABLED=1

ENV NODE_ENV=production

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 5000

CMD ["npm", "start"]
