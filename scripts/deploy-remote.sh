#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="write_nostr"
SERVICE_NAME="write_nostr"
INSTALL_DIR="/var/www/write_nostr"
SERVICE_USER="www-data"
SERVICE_GROUP="www-data"
PORT="3000"
PROXY_MODE="auto"
DOMAIN=""
CADDY_EMAIL=""
SSH_PORT="22"
DRY_RUN=false
SKIP_BUILD=false
SSH_TARGET=""
REMOTE_STAGE_DIR="/tmp/${SERVICE_NAME}-deploy"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_CONTROL_DIR=""
SSH_CONTROL_PATH=""

log() {
	printf '[deploy] %s\n' "$*"
}

warn() {
	printf '[deploy] warning: %s\n' "$*" >&2
}

die() {
	printf '[deploy] error: %s\n' "$*" >&2
	exit 1
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

usage() {
	cat <<'EOF'
Usage:
  scripts/deploy-remote.sh --host user@server [options]

Options:
  --host <user@host>       SSH target for the remote server
  --port <port>            App port on the remote host (default: 3000)
  --install-dir <path>     Remote install path (default: /var/www/write_nostr)
  --service-user <user>    Systemd service user (default: www-data)
  --service-group <group>  Systemd service group (default: www-data)
  --proxy auto|caddy|nginx|none  Reverse proxy mode (default: auto)
  --domain <hostname>      Reverse proxy hostname (required for caddy/nginx)
  --caddy-email <email>    Caddy ACME contact email
  --ssh-port <port>        SSH port (default: 22)
  --skip-build             Skip the local build step
  --dry-run                Print actions without executing them
  -h, --help               Show this help

Environment overrides:
  WRITE_NOSTR_SSH_TARGET, WRITE_NOSTR_PORT, WRITE_NOSTR_INSTALL_DIR,
  WRITE_NOSTR_SERVICE_USER, WRITE_NOSTR_SERVICE_GROUP, WRITE_NOSTR_PROXY,
  WRITE_NOSTR_DOMAIN, WRITE_NOSTR_CADDY_EMAIL, WRITE_NOSTR_SSH_PORT,
  WRITE_NOSTR_DRY_RUN, WRITE_NOSTR_SKIP_BUILD
EOF
}

run_local() {
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] '
		printf '%q ' "$@"
		printf '\n'
		return 0
	fi
	"$@"
}

cleanup() {
	if [[ -n "$SSH_CONTROL_DIR" && -d "$SSH_CONTROL_DIR" ]]; then
		rm -rf "$SSH_CONTROL_DIR"
	fi
}

open_ssh_master() {
	local ssh_cmd=(
		ssh
		-p "$SSH_PORT"
		-o ControlMaster=auto
		-o ControlPersist=10m
		-o ControlPath="$SSH_CONTROL_PATH"
	)
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] %q ' "${ssh_cmd[@]}"
		printf '%q\n' -MNf "$SSH_TARGET"
		return 0
	fi
	"${ssh_cmd[@]}" -MNf "$SSH_TARGET"
}

rsync_ssh_cmd() {
	printf 'ssh -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q' \
		"$SSH_PORT" "$SSH_CONTROL_PATH"
}

build_app() {
	if [[ "$DRY_RUN" == true ]]; then
		log "skipping local build in dry-run mode"
		return 0
	fi
	if [[ "$SKIP_BUILD" == true ]]; then
		log "skipping local build"
		return 0
	fi

	(
		cd "$REPO_ROOT"
		npm ci --legacy-peer-deps
		npm run build
	)
}

sync_app() {
	log "syncing repository to ${SSH_TARGET}:${REMOTE_STAGE_DIR}"
	if [[ "$DRY_RUN" != true ]]; then
		open_ssh_master
	fi
	run_local rsync -az --delete --no-owner --no-group \
		-e "$(rsync_ssh_cmd)" \
		--exclude='.git' \
		--exclude='.claude' \
		--exclude='node_modules' \
		--exclude='.svelte-kit' \
		--exclude='dist' \
		--exclude='coverage' \
		"${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_STAGE_DIR}/"

	if [[ -d "${REPO_ROOT}/dist" ]]; then
		log "syncing build artifacts"
		run_local rsync -az --delete --no-owner --no-group \
			-e "$(rsync_ssh_cmd)" \
			"${REPO_ROOT}/dist/" "${SSH_TARGET}:${REMOTE_STAGE_DIR}/dist/"
	fi
}

install_remote_service() {
	local remote_script remote_script_file remote_args
	remote_script="$(cat <<'EOF'
set -Eeuo pipefail

INSTALL_DIR="$1"
STAGING_DIR="$2"
SERVICE_NAME="$3"
SERVICE_USER="$4"
SERVICE_GROUP="$5"
PORT="$6"
PROXY_MODE="$7"
DOMAIN="$8"
CADDY_EMAIL="$9"

log() {
	printf '[remote] %s\n' "$*"
}

warn() {
	printf '[remote] warning: %s\n' "$*" >&2
}

die() {
	printf '[remote] error: %s\n' "$*" >&2
	exit 1
}

sudo_run() {
	sudo -n "$@"
}

port_is_listening() {
	ss -H -ltn "sport = :${PORT}" | grep -q .
}

service_is_active() {
	sudo_run systemctl is-active --quiet "${SERVICE_NAME}.service"
}

wait_for_ready() {
	local attempt
	for attempt in $(seq 1 30); do
		if service_is_active && port_is_listening; then
			return 0
		fi
		sleep 1
	done

	sudo_run systemctl status "${SERVICE_NAME}.service" --no-pager -l || true
	sudo_run journalctl -u "${SERVICE_NAME}.service" --no-pager -n 100 || true
	die "service failed to become ready on port ${PORT}"
}

choose_port() {
	local candidate="$PORT"
	while ss -H -ltn "sport = :${candidate}" | grep -q .; do
		candidate=$((candidate + 1))
		if (( candidate > 65535 )); then
			die "no free ports available starting from ${PORT}"
		fi
	done
	if [[ "$candidate" != "$PORT" ]]; then
		warn "port ${PORT} is in use; using ${candidate} instead"
		PORT="$candidate"
	fi
}

verify_build_artifacts() {
	if [[ ! -f "${INSTALL_DIR}/dist/index.html" ]]; then
		die "missing build artifact at ${INSTALL_DIR}/dist/index.html"
	fi
}

managed_marker="# managed by write_nostr"
proxy_mode_resolved="$PROXY_MODE"

command -v python3 >/dev/null 2>&1 || die "python3 is required on the remote server"
command -v systemctl >/dev/null 2>&1 || die "systemctl is required on the remote server"
command -v ss >/dev/null 2>&1 || die "ss is required on the remote server"
command -v curl >/dev/null 2>&1 || die "curl is required on the remote server"
command -v rsync >/dev/null 2>&1 || die "rsync is required on the remote server"

log "refreshing sudo credentials"
sudo -v

if [[ "$proxy_mode_resolved" == "auto" ]]; then
	if command -v caddy >/dev/null 2>&1; then
		proxy_mode_resolved="caddy"
	elif command -v nginx >/dev/null 2>&1; then
		proxy_mode_resolved="nginx"
	else
		proxy_mode_resolved="none"
	fi
fi

if [[ "$proxy_mode_resolved" != "none" && -z "$DOMAIN" ]]; then
	die "a domain is required when reverse proxying"
fi

log "preparing install directory"
sudo_run install -d -m 0755 "$INSTALL_DIR"
sudo_run rsync -a --delete "$STAGING_DIR"/ "$INSTALL_DIR"/
sudo_run chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$INSTALL_DIR"

log "installing systemd service"
tmp_service="/tmp/${SERVICE_NAME}.service"
cat >"$tmp_service" <<SERVICEEOF
[Unit]
Description=${SERVICE_NAME} static web app
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
ExecStart=python3 ${INSTALL_DIR}/scripts/spa-http-server.py ${INSTALL_DIR}/dist --bind 127.0.0.1 --port ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF
sudo_run install -m 0644 "$tmp_service" /etc/systemd/system/${SERVICE_NAME}.service
rm -f "$tmp_service"

configure_caddy() {
	local main_file="/etc/caddy/Caddyfile"
	local snippet_dir="/etc/caddy/conf.d"
	local snippet_file="${snippet_dir}/${SERVICE_NAME}.caddy"
	local tmp_snippet tmp_main
	tmp_snippet="$(mktemp)"

	sudo_run install -d -m 0755 "$snippet_dir"
	cat >"$tmp_snippet" <<SNIP
${managed_marker}
${DOMAIN} {
	${CADDY_EMAIL:+tls ${CADDY_EMAIL}}
	encode zstd gzip
	reverse_proxy localhost:${PORT}
}
SNIP
	sudo_run install -m 0644 "$tmp_snippet" "$snippet_file"
	rm -f "$tmp_snippet"

	if [[ ! -f "$main_file" ]]; then
		tmp_main="$(mktemp)"
		cat >"$tmp_main" <<MAIN
${managed_marker}
import ${snippet_dir}/*.caddy
MAIN
		sudo_run install -m 0644 "$tmp_main" "$main_file"
		rm -f "$tmp_main"
	elif grep -qF "$managed_marker" "$main_file" && ! grep -qE '^[[:space:]]*import[[:space:]].*(/etc/caddy/)?(conf\.d|Caddyfile\.d)/\*\.caddy' "$main_file"; then
		warn "existing Caddyfile is managed, but does not import ${snippet_dir}; add it manually"
	fi

	sudo_run caddy validate --config "$main_file"
	sudo_run systemctl reload caddy 2>/dev/null || sudo_run systemctl restart caddy
}

configure_nginx() {
	local conf_file="/etc/nginx/conf.d/${SERVICE_NAME}.conf"
	local tmp_conf
	tmp_conf="$(mktemp)"
	sudo_run install -d -m 0755 /etc/nginx/conf.d
	cat >"$tmp_conf" <<NGINX
${managed_marker}
server {
	listen 80;
	server_name ${DOMAIN};

	location / {
		proxy_pass http://127.0.0.1:${PORT};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}
NGINX
	sudo_run install -m 0644 "$tmp_conf" "$conf_file"
	rm -f "$tmp_conf"
	sudo_run nginx -t
	sudo_run systemctl reload nginx 2>/dev/null || sudo_run systemctl restart nginx
}

log "starting service"
sudo_run systemctl daemon-reload
sudo_run systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true
sudo_run systemctl enable "${SERVICE_NAME}.service"
sudo_run systemctl start "${SERVICE_NAME}.service"

wait_for_ready
verify_build_artifacts
curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/does-not-exist" >/dev/null

case "$proxy_mode_resolved" in
	none)
		log "reverse proxy disabled"
		;;
	caddy)
		command -v caddy >/dev/null 2>&1 || die "caddy is not installed on the remote server"
		log "configuring caddy"
		configure_caddy
		;;
	nginx)
		command -v nginx >/dev/null 2>&1 || die "nginx is not installed on the remote server"
		log "configuring nginx"
		configure_nginx
		;;
	*)
		die "unknown proxy mode: $proxy_mode_resolved"
		;;
esac

log "deployment complete"
EOF
)"
	remote_script_file="$(mktemp)"
	printf '%s\n' "$remote_script" >"$remote_script_file"

	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] scp -P %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %q %q:%q\n' \
			"$SSH_PORT" "$SSH_CONTROL_PATH" "$remote_script_file" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh"
		printf '[dry-run] ssh -tt -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %s bash %q %q %q %q %q %q %q %q %q %q\n' \
			"$SSH_PORT" "$SSH_CONTROL_PATH" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh" \
			"$INSTALL_DIR" "$REMOTE_STAGE_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL"
		rm -f "$remote_script_file"
		return 0
	fi

	scp -P "$SSH_PORT" \
		-o ControlMaster=auto \
		-o ControlPersist=10m \
		-o ControlPath="$SSH_CONTROL_PATH" \
		"$remote_script_file" "$SSH_TARGET:/tmp/${SERVICE_NAME}-deploy.sh"
	rm -f "$remote_script_file"

	remote_args="$(printf '%q ' "$INSTALL_DIR" "$REMOTE_STAGE_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL")"
	ssh -tt -p "$SSH_PORT" \
		-o ControlMaster=auto \
		-o ControlPersist=10m \
		-o ControlPath="$SSH_CONTROL_PATH" \
		"$SSH_TARGET" "bash /tmp/${SERVICE_NAME}-deploy.sh ${remote_args}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--host)
			SSH_TARGET="${2:-}"
			shift 2
			;;
		--port)
			PORT="${2:-}"
			shift 2
			;;
		--install-dir)
			INSTALL_DIR="${2:-}"
			shift 2
			;;
		--service-user)
			SERVICE_USER="${2:-}"
			shift 2
			;;
		--service-group)
			SERVICE_GROUP="${2:-}"
			shift 2
			;;
		--proxy)
			PROXY_MODE="${2:-}"
			shift 2
			;;
		--domain)
			DOMAIN="${2:-}"
			shift 2
			;;
		--caddy-email)
			CADDY_EMAIL="${2:-}"
			shift 2
			;;
		--ssh-port)
			SSH_PORT="${2:-}"
			shift 2
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown option: $1"
			;;
	esac
done

if [[ -z "$SSH_TARGET" ]]; then
	SSH_TARGET="${WRITE_NOSTR_SSH_TARGET:-}"
fi
if [[ -z "$SSH_TARGET" ]]; then
	usage
	die "missing required option: --host"
fi

if [[ "$PORT" == "3000" && -n "${WRITE_NOSTR_PORT:-}" ]]; then
	PORT="$WRITE_NOSTR_PORT"
fi
if [[ "$INSTALL_DIR" == "/var/www/write_nostr" && -n "${WRITE_NOSTR_INSTALL_DIR:-}" ]]; then
	INSTALL_DIR="$WRITE_NOSTR_INSTALL_DIR"
fi
if [[ "$SERVICE_USER" == "www-data" && -n "${WRITE_NOSTR_SERVICE_USER:-}" ]]; then
	SERVICE_USER="$WRITE_NOSTR_SERVICE_USER"
fi
if [[ "$SERVICE_GROUP" == "www-data" && -n "${WRITE_NOSTR_SERVICE_GROUP:-}" ]]; then
	SERVICE_GROUP="$WRITE_NOSTR_SERVICE_GROUP"
fi
if [[ "$PROXY_MODE" == "auto" && -n "${WRITE_NOSTR_PROXY:-}" ]]; then
	PROXY_MODE="$WRITE_NOSTR_PROXY"
fi
if [[ -z "$DOMAIN" ]]; then
	DOMAIN="${WRITE_NOSTR_DOMAIN:-}"
fi
if [[ -z "$CADDY_EMAIL" ]]; then
	CADDY_EMAIL="${WRITE_NOSTR_CADDY_EMAIL:-}"
fi
if [[ "$SSH_PORT" == "22" && -n "${WRITE_NOSTR_SSH_PORT:-}" ]]; then
	SSH_PORT="$WRITE_NOSTR_SSH_PORT"
fi
if [[ "$DRY_RUN" == false && -n "${WRITE_NOSTR_DRY_RUN:-}" ]]; then
	is_true "$WRITE_NOSTR_DRY_RUN" && DRY_RUN=true || true
fi
if [[ "$SKIP_BUILD" == false && -n "${WRITE_NOSTR_SKIP_BUILD:-}" ]]; then
	is_true "$WRITE_NOSTR_SKIP_BUILD" && SKIP_BUILD=true || true
fi

SSH_CONTROL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/write_nostr-ssh-XXXXXX")"
SSH_CONTROL_PATH="${SSH_CONTROL_DIR}/control"
trap cleanup EXIT

if [[ "$DRY_RUN" == true ]]; then
	log "performing dry-run deployment"
fi

build_app
sync_app
install_remote_service

log "done"
