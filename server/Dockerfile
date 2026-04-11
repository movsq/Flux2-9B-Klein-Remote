FROM node:20-slim

WORKDIR /app

# gosu is needed by the entrypoint to drop from root to the node user after
# fixing volume ownership (prevents SQLITE_READONLY on pre-existing volumes).
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN echo "=== package.json ===" && cat package.json \
    && echo "=== installing ===" \
    && npm install --omit=dev \
    && echo "=== node_modules/@node-rs ===" \
    && ls -la node_modules/@node-rs/ 2>/dev/null || true \
    && echo "=== grep argon ===" \
    && ls node_modules/ | grep -i argon || true \
    && test -d node_modules/@node-rs/argon2 \
    || (echo "ERROR: @node-rs/argon2 not installed" && exit 1)

COPY src/ ./src/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000

# Note: no USER instruction here intentionally. The container starts as root
# so the entrypoint can fix volume ownership (chown /app/data), then uses gosu
# to permanently drop privileges to the non-root "node" user before exec-ing
# the application. The runtime process is always non-root.
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "src/index.js"]
