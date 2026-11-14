# Auth-MPA - Credential-OAuth-Session

- `pnpm i`
- Fill in `.env`
- `pnpm run db:reset`
- `pnpm run dev`

## Cloudflare Tunnel

For local development, you can use this setting to host your store.

- Fill in the `.env` file with your Cloudflare Tunnel credentials
- Start the container
  - `docker compose --env-file ./.env -f docker-compose-tunnel.yml up -d`
- Remove the container
  - `docker compose --env-file ./.env -f docker-compose-tunnel.yml down`
