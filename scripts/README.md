# write_nostr Deployment Scripts

This directory contains scripts for deploying `write_nostr` to a remote server.

## `deploy-remote.sh`

Builds the app locally, syncs the repo and build output to a remote server, installs a systemd service, and optionally configures a reverse proxy.

Requirements:

- Local: `npm`, `rsync`
- Remote: `python3`, `systemctl`, `ss`, `curl`, `rsync`, `sudo`

Usage:

```bash
scripts/deploy-remote.sh --host user@server [options]
```

Common options:

- `--host <user@host>` - SSH target for the remote server
- `--port <port>` - App port on the remote host
- `--install-dir <path>` - Remote install path
- `--service-user <user>` - Systemd service user
- `--service-group <group>` - Systemd service group
- `--proxy auto|caddy|nginx|none` - Reverse proxy mode
- `--domain <hostname>` - Reverse proxy hostname
- `--caddy-email <email>` - Caddy ACME contact email
- `--skip-build` - Skip the local build step
- `--dry-run` - Print actions without executing them

Examples:

```bash
scripts/deploy-remote.sh --host deploy@example.com --domain write.example.com
```

```bash
scripts/deploy-remote.sh --host deploy@example.com --proxy none
```

```bash
scripts/deploy-remote.sh --host deploy@example.com --domain write.example.com --dry-run
```

Environment overrides:

- `WRITE_NOSTR_SSH_TARGET`
- `WRITE_NOSTR_PORT`
- `WRITE_NOSTR_INSTALL_DIR`
- `WRITE_NOSTR_SERVICE_USER`
- `WRITE_NOSTR_SERVICE_GROUP`
- `WRITE_NOSTR_PROXY`
- `WRITE_NOSTR_DOMAIN`
- `WRITE_NOSTR_CADDY_EMAIL`
- `WRITE_NOSTR_SSH_PORT`
- `WRITE_NOSTR_DRY_RUN`
- `WRITE_NOSTR_SKIP_BUILD`

## `spa-http-server.py`

Tiny static server used by the remote systemd unit.

It serves the built `build/` directory and falls back to `index.html` for SPA routes.
