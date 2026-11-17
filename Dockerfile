# easel: one compiled Bun binary (client embedded) on a slim Debian.
# Built by .github/workflows/deploy.yml after `gates` is green on main, pushed to
# ghcr.io/lagz0ne/easel (:<sha> and :latest), run by Dokploy at https://easel.vibea.dev.
FROM docker.io/oven/bun:1.4.4-debian AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# build: client, server binary, and its checks (no test code in dist).
RUN bun run build

# Debian, not distroless: frames are drawn by Chromium later, which comes from apt.
FROM docker.io/library/debian:trixie-slim
RUN useradd --system --uid 10001 --create-home easel
WORKDIR /app
COPY --from=build /app/dist/server /app/server
USER easel
# GET /api/version answers these: the deploy job waits for the commit it shipped. BUILD is the
# count of commits on main up to it, so a later build has a larger number (SPEC-ops.md). It has
# no default: an image built without it refuses to start.
ARG GIT_SHA=dev
ARG BUILD
ENV NODE_ENV=production PORT=3000 GIT_SHA=$GIT_SHA BUILD=$BUILD
EXPOSE 3000
# One binary: `easel serve` runs the server; any other command is the CLI (SPEC-cli.md).
CMD ["/app/server", "serve"]
