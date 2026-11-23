FROM docker.io/oven/bun:1.4.4-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM scratch AS bin
COPY --from=build /app/dist/server /server

FROM docker.io/library/debian:trixie-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /etc/chromium/policies/managed \
  && printf '{"WebRtcIPHandling":"disable_non_proxied_udp"}\n' \
    > /etc/chromium/policies/managed/easel.json
RUN useradd --system --uid 10001 --create-home easel
WORKDIR /app
USER easel
ENV NODE_ENV=production PORT=3000 EASEL_CHROMIUM=/usr/bin/chromium
EXPOSE 3000
CMD ["/app/server", "serve"]

FROM runtime
COPY --from=bin /server /app/server
ARG GIT_SHA=dev
ARG BUILD
ENV GIT_SHA=$GIT_SHA BUILD=$BUILD
