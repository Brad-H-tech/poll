# Sales Intelligence — team server (zero npm dependencies)
FROM node:20-alpine
WORKDIR /app
COPY . .
# Data (users, bases, tracking) lives here — mount a volume to persist it
ENV PORT=4173 SHELLY_DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4173/api/health || exit 1
CMD ["node", "server.js"]
