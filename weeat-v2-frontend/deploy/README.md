# Hackathon live service

`hackathon.weeat.site` uses the existing `weeat-caddy` route to `127.0.0.1:31031`.
The app container runs `deploy/watch.mjs`. It watches `src/`, `server/`, `public/`,
the build config and `.env.local`. After a one-second quiet period it builds to a
temporary directory, publishes the result, and restarts the Node server. A failed
build keeps the last published app running. No manual `npm run build` is needed.

The container uses host networking so Node can bind only to loopback on 31031.
It runs as UID/GID 1000 and reads `.env.local` from the mounted workspace. Keep
the `.env.local` file out of Git. The Caddyfile lives in the existing Caddy
container; this service does not own or change it.

Google sign-in needs `https://hackathon.weeat.site/api/auth/google/callback`
listed as an authorized redirect URI for the configured Google OAuth client.

Start after freeing port 31031:

```sh
cd weeat-v2-frontend
docker compose -f deploy/compose.yaml up -d
docker compose -f deploy/compose.yaml ps
curl -fsS http://127.0.0.1:31031/api/health
curl -fsS https://hackathon.weeat.site/api/health
```

Inspect builds with `docker compose -f deploy/compose.yaml logs -f app`.
Stop with `docker compose -f deploy/compose.yaml down`; the last `dist/` build
stays in the workspace. Caddy must be reloaded separately if its route changes.
