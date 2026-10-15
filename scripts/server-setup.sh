#!/usr/bin/env bash
# Usage: server-setup.sh <deploy-user-public-key>
# Prepares a fresh Ubuntu or Oracle Linux VM to run Spolu. Run once as root on the server;
# running it again is safe (every step checks first). <deploy-user-public-key> is an SSH public
# key line ("ssh-ed25519 AAAA... ci") or the path to a .pub file on the server.
#
# What it does:
#   1. installs Docker Engine and the compose plugin, with log rotation defaults
#   2. opens 80/tcp, 443/tcp and 443/udp in the host firewall and keeps them open after reboot
#   3. creates the "deploy" user (in the docker group) that logs in with the given key
#   4. creates /opt/spolu, owned by deploy (deploy.sh puts each environment in /opt/spolu/<env>)
#   5. turns on automatic security updates
#   6. adds a 2G swapfile if the server has no swap (small VMs run out of memory during pulls)
# The cloud provider's network firewall (e.g. an Oracle Cloud security list) is separate:
# open the same ports there by hand.
set -euo pipefail
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

[[ $# -eq 1 && -n "$1" ]] || usage "server-setup.sh <deploy-user-public-key | path-to-.pub-file>   (as root)"
[[ "$(id -u)" -eq 0 ]] || die "run as root (sudo bash $0 ...)"

deploy_user=deploy
if [[ -f "$1" ]]; then
  public_key="$(head -n 1 "$1")"
else
  public_key="$1"
fi
[[ "$public_key" =~ ^(ssh-|ecdsa-|sk-) ]] || die "not an SSH public key: $public_key"

# shellcheck disable=SC1091 # exists only on the server
source /etc/os-release
case "${ID:-}" in
  ubuntu) os=ubuntu ;;
  ol) os=oracle ;;
  *) die "unsupported OS '${ID:-unknown}': only Ubuntu and Oracle Linux are supported" ;;
esac
log "Detected $PRETTY_NAME"

# --- 1. Docker ---------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker and compose plugin already installed"
elif [[ "$os" == ubuntu ]]; then
  log "Installing Docker (Ubuntu)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -yq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Installing Docker (Oracle Linux)"
  # Oracle Linux ships podman, runc and buildah, which conflict with Docker's packages.
  dnf remove -y podman runc buildah || true
  dnf install -y dnf-plugins-core
  # Oracle Linux is RHEL compatible; Docker publishes its packages for RHEL.
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if [[ ! -f /etc/docker/daemon.json ]]; then
  log "Setting Docker log rotation defaults"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  # Restart only if Docker was already running; the next line starts it otherwise.
  systemctl try-restart docker
fi
systemctl enable --now docker

# --- 2. Firewall -------------------------------------------------------------
if [[ "$os" == oracle ]]; then
  if systemctl is-active --quiet firewalld; then
    log "Opening 80/tcp, 443/tcp, 443/udp in firewalld"
    firewall-cmd --permanent --add-service=http --add-service=https --add-port=443/udp >/dev/null
    firewall-cmd --reload >/dev/null
  else
    log "firewalld is not running; no host firewall to open"
  fi
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  log "Opening 80/tcp, 443/tcp, 443/udp in ufw"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
else
  # Oracle Cloud Ubuntu images: ufw is off, but iptables rules end INPUT with a REJECT.
  # Our ACCEPT rules must come before that REJECT, now and in the saved rules file.
  log "Opening 80/tcp, 443/tcp, 443/udp in iptables"
  rules_file=/etc/iptables/rules.v4
  for rule in "tcp 80" "tcp 443" "udp 443"; do
    read -r proto port <<< "$rule"
    spec=(-p "$proto" -m state --state NEW -m "$proto" --dport "$port" -j ACCEPT)
    if ! iptables -C INPUT "${spec[@]}" 2>/dev/null; then
      reject_line="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
      if [[ -n "$reject_line" ]]; then
        iptables -I INPUT "$reject_line" "${spec[@]}"
      else
        iptables -A INPUT "${spec[@]}"
      fi
    fi
    # Same rule in the file netfilter-persistent loads at boot, before its first INPUT REJECT.
    # Edited directly instead of "netfilter-persistent save", which would also save Docker's own rules.
    file_rule="-A INPUT ${spec[*]}"
    if [[ -f "$rules_file" ]] && ! grep -qxF -- "$file_rule" "$rules_file"; then
      if grep -q '^-A INPUT .*-j REJECT' "$rules_file"; then
        awk -v rule="$file_rule" '!done && /^-A INPUT .*-j REJECT/ { print rule; done = 1 } { print }' \
          "$rules_file" > "$rules_file.new"
      else
        awk -v rule="$file_rule" '!done && /^COMMIT/ { print rule; done = 1 } { print }' \
          "$rules_file" > "$rules_file.new"
      fi
      mv "$rules_file.new" "$rules_file"
    fi
  done
  if [[ ! -f "$rules_file" ]]; then
    log "WARNING: $rules_file not found; the iptables rules above are live but will not survive a reboot"
  fi
fi

# --- 3. Deploy user ----------------------------------------------------------
if id "$deploy_user" >/dev/null 2>&1; then
  log "User $deploy_user exists"
else
  log "Creating user $deploy_user"
  useradd --create-home --shell /bin/bash "$deploy_user"
fi
usermod -aG docker "$deploy_user"
deploy_home="$(getent passwd "$deploy_user" | cut -d: -f6)"
install -d -m 700 -o "$deploy_user" -g "$deploy_user" "$deploy_home/.ssh"
authorized_keys="$deploy_home/.ssh/authorized_keys"
touch "$authorized_keys"
if ! grep -qxF -- "$public_key" "$authorized_keys"; then
  log "Adding the public key for $deploy_user"
  printf '%s\n' "$public_key" >> "$authorized_keys"
fi
chown "$deploy_user:$deploy_user" "$authorized_keys"
chmod 600 "$authorized_keys"

# --- 4. App folder -----------------------------------------------------------
install -d -m 750 -o "$deploy_user" -g "$deploy_user" /opt/spolu

# --- 5. Automatic security updates ---------------------------------------------
if [[ "$os" == ubuntu ]]; then
  log "Enabling unattended security upgrades"
  DEBIAN_FRONTEND=noninteractive apt-get install -yq unattended-upgrades
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
else
  log "Enabling dnf-automatic security updates"
  dnf install -y dnf-automatic
  sed -i -e 's/^upgrade_type *=.*/upgrade_type = security/' \
    -e 's/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf
  systemctl enable --now dnf-automatic.timer
fi

# --- 6. Swap -----------------------------------------------------------------
if [[ -n "$(swapon --show --noheadings)" ]]; then
  log "Swap already present"
else
  log "Adding a 2G swapfile"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Done. Next: open 80/tcp, 443/tcp, 443/udp in the cloud firewall, point DNS at this server, then deploy."
