#!/usr/bin/env bash
# Tests for deploy_env in scripts/lib.sh: the env file the server gets.
set -u
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
fail=0
d="$(mktemp -d)"
printf 'A=1\nDOMAIN=old.example.com\nPUBLIC_URL=https://old.example.com\nREDIRECT_DOMAINS=stale.example.com\nTICKETS_API_KEY=old-key-0000000000\nB=2\n' > "$d/in.env"

check() { # name, expected, actual
  if [[ "$2" != "$3" ]]; then echo "FAIL $1"; echo " expected: $2"; echo " actual:   $3"; fail=1; fi
}

out="$(DOMAIN=new.example.com deploy_env "$d/in.env")"
check "domain and public url follow DOMAIN, the rest stays" \
  "$(printf 'A=1\nTICKETS_API_KEY=old-key-0000000000\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com\nREDIRECT_DOMAINS=')" "$out"

out="$(DOMAIN=new.example.com TICKETS_API_KEY=new-key-1111111111 deploy_env "$d/in.env")"
check "a TICKETS_API_KEY replaces the file's" \
  "$(printf 'A=1\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com\nREDIRECT_DOMAINS=\nTICKETS_API_KEY=new-key-1111111111')" "$out"

out="$(DOMAIN=new.example.com TICKETS_API_KEY='' deploy_env "$d/in.env")"
check "an empty TICKETS_API_KEY keeps the file's" \
  "$(printf 'A=1\nTICKETS_API_KEY=old-key-0000000000\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com\nREDIRECT_DOMAINS=')" "$out"

out="$(DOMAIN=new.example.com REDIRECT_DOMAINS='  old.example.com   older.example.com ' deploy_env "$d/in.env")"
check "REDIRECT_DOMAINS replaces the file's, spaces normalized" \
  "$(printf 'A=1\nTICKETS_API_KEY=old-key-0000000000\nB=2\nDOMAIN=new.example.com\nPUBLIC_URL=https://new.example.com\nREDIRECT_DOMAINS=old.example.com older.example.com')" "$out"

out="$(unset REDIRECT_DOMAINS; DOMAIN=new.example.com deploy_env "$d/in.env" | grep '^REDIRECT_DOMAINS=')"
check "an unset REDIRECT_DOMAINS writes an empty one (old domains stop redirecting)" "REDIRECT_DOMAINS=" "$out"

printf 'MAIL_FROM=Spolu by eGrant <noreply@egrant.sk>\nMAIL_FROM_BULK=news@egrant.sk\nX=1\n' > "$d/mail.env"
out="$(DOMAIN=help.example.com MAIL_FROM_NAME='Help by eGrant' deploy_env "$d/mail.env" | grep -E '^MAIL_FROM')"
check "MAIL_FROM_NAME replaces only the display name of both senders" \
  "$(printf 'MAIL_FROM=Help by eGrant <noreply@egrant.sk>\nMAIL_FROM_BULK=Help by eGrant <news@egrant.sk>')" "$out"

out="$(DOMAIN=help.example.com deploy_env "$d/mail.env" | grep -E '^MAIL_FROM=')"
check "without MAIL_FROM_NAME the sender stays" "MAIL_FROM=Spolu by eGrant <noreply@egrant.sk>" "$out"

# deploy_ssh: the host key must be pinned; no trust on first use.
if (unset DEPLOY_KNOWN_HOSTS; DEPLOY_USER=u DEPLOY_HOST=h DEPLOY_SSH_KEY=k deploy_ssh "$d") >/dev/null 2>"$d/ssh.err"; then
  echo "FAIL deploy_ssh without DEPLOY_KNOWN_HOSTS must refuse"; fail=1
fi
grep -q 'DEPLOY_KNOWN_HOSTS is not set' "$d/ssh.err" || { echo "FAIL deploy_ssh refusal names DEPLOY_KNOWN_HOSTS"; fail=1; }
out="$(DEPLOY_KNOWN_HOSTS='h ssh-ed25519 AAAA' DEPLOY_USER=u DEPLOY_HOST=h DEPLOY_SSH_KEY=k bash -c "source '$(cd "$(dirname "$0")/.." && pwd)/lib.sh'; deploy_ssh '$d'; printf '%s ' \"\${ssh_cmd[@]}\"; cat '$d/known_hosts'")"
case "$out" in
  *"StrictHostKeyChecking=yes"*"h ssh-ed25519 AAAA"*) ;;
  *) echo "FAIL deploy_ssh pins the key with StrictHostKeyChecking=yes"; echo " actual: $out"; fail=1 ;;
esac
case "$out" in *accept-new*) echo "FAIL deploy_ssh must never accept new host keys"; fail=1 ;; esac

# The server env template names every eGrant webhook key and signing secret (review V14).
root="$(cd "$(dirname "$0")/../.." && pwd)"
for template in test prod; do
  for var in $(grep -oE '^(TICKETS_API_KEY|EGRANT_[A-Z_]+)=' "$root/.env.example" | tr -d '='); do
    grep -qE "^#? ?$var=" "$root/deploy/$template.env.example" \
      || { echo "FAIL deploy/$template.env.example has no $var line"; fail=1; }
  done
done
# The prod template has every setting of the test one (they differ only in values and comments).
for var in $(grep -oE '^#? ?[A-Z_]+=' "$root/deploy/test.env.example" | sed 's/^# \{0,1\}//'); do
  grep -qE "^#? ?$var" "$root/deploy/prod.env.example" \
    || { echo "FAIL deploy/prod.env.example has no ${var%=} line"; fail=1; }
done

rm -rf "$d"
[[ $fail -eq 0 ]] && echo "deploy-env.test.sh: all passed"
exit $fail
