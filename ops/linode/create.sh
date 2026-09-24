#!/usr/bin/env bash
# Creates the arena Linode from cloud-init.yaml. Tagged `c4`, so the
# c4-reaper Worker deletes it at its deadline (apps/reaper). Requires a
# configured linode-cli. Usage: ops/linode/create.sh [type] [region]
set -euo pipefail
cd "$(dirname "$0")"
TYPE=${1:-g8-dedicated-128-64}
REGION=${2:-us-southeast}
KEY_FILE=${C4_SSH_PUBKEY:-$HOME/.ssh/id_rsa.pub}
FIREWALL_LABEL=c4-arena-fw

KEY=$(cat "$KEY_FILE")
USERDATA=$(mktemp); trap 'rm -f "$USERDATA"' EXIT
sed "s#C4_SSH_AUTHORIZED_KEY#${KEY}#" cloud-init.yaml > "$USERDATA"

# SSH-only inbound firewall, restricted to this machine's current public IP.
MYIP=$(curl -fsS https://api.ipify.org)
RULES="[{\"action\":\"ACCEPT\",\"protocol\":\"TCP\",\"ports\":\"22\",\"addresses\":{\"ipv4\":[\"${MYIP}/32\"]},\"label\":\"ssh-operator\"}]"
FW=$(linode-cli firewalls list --json | jq -r --arg l "$FIREWALL_LABEL" '.[] | select(.label==$l) | .id' | head -1)
if [ -z "$FW" ]; then
  FW=$(linode-cli firewalls create --label "$FIREWALL_LABEL" --rules.inbound_policy DROP \
    --rules.outbound_policy ACCEPT --rules.inbound "$RULES" --json | jq -r '.[0].id')
else
  linode-cli firewalls rules-update "$FW" --inbound "$RULES" --inbound_policy DROP --outbound_policy ACCEPT >/dev/null
fi

ROOT_PASS=$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)  # unused: SSH is keys-only
linode-cli linodes create --label c4-arena --type "$TYPE" --region "$REGION" \
  --image linode/ubuntu24.04 --root_pass "$ROOT_PASS" --authorized_keys "$KEY" \
  --firewall_id "$FW" --tags c4 --metadata.user_data "$(base64 -w0 "$USERDATA")" \
  --json | jq -r '.[0] | "created id=\(.id) ip=\(.ipv4[0]) type=\(.type) status=\(.status)"'
