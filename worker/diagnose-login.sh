#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

wrangler_cmd() {
  if need_cmd wrangler; then
    wrangler "$@"
  else
    npx wrangler "$@"
  fi
}

read_secret_once() {
  local prompt="$1"
  local value=""
  printf "%s" "$prompt" >&2
  stty -echo
  IFS= read -r value
  stty echo
  printf "\n" >&2
  printf "%s" "$value"
}

json_login_body() {
  ROLE_VALUE="$1" PASSWORD_VALUE="$2" node <<'NODE'
console.log(JSON.stringify({ role: process.env.ROLE_VALUE, password: process.env.PASSWORD_VALUE }));
NODE
}

post_login_code() {
  local role="$1"
  local password="$2"
  json_login_body "$role" "$password" | curl -sS -o /tmp/law-login-response.json -w "%{http_code}" \
    --connect-timeout 10 \
    --max-time 20 \
    -X POST "$WORKER_URL/api/login" \
    -H "Origin: http://localhost:5173" \
    -H "Content-Type: application/json" \
    --data-binary @-
}

cd "$SCRIPT_DIR"

echo "==> 诊断登录问题（不会显示或保存密码）"
if ! wrangler_cmd whoami >/dev/null 2>&1; then
  echo "当前没有登录 Cloudflare，请先运行 bash worker/setup.sh 或 bash worker/reset-passwords.sh 完成授权。"
  exit 1
fi

WORKER_URL="$(grep '^VITE_WORKER_URL=' "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
if [[ -z "$WORKER_URL" ]]; then
  echo "没有找到 .env 里的 VITE_WORKER_URL。"
  exit 1
fi
echo "Worker URL: $WORKER_URL"

ADMIN_PASSWORD="$(read_secret_once "请输入你刚才设置的管理员密码：")"
USER_PASSWORD="$(read_secret_once "请输入你刚才设置的使用者密码：")"

echo ""
echo "==> 检查 Cloudflare 远程 KV 中的密码哈希是否匹配"
admin_hash="$(wrangler_cmd kv key get admin_pw_hash --binding CONFIG_KV --preview false --remote 2>/dev/null || true)"
user_hash="$(wrangler_cmd kv key get user_pw_hash --binding CONFIG_KV --preview false --remote 2>/dev/null || true)"

admin_match="$(printf "%s" "$ADMIN_PASSWORD" | node scripts/verify-password.mjs "$admin_hash")"
user_match="$(printf "%s" "$USER_PASSWORD" | node scripts/verify-password.mjs "$user_hash")"

echo "管理员密码匹配 KV：$admin_match"
echo "使用者密码匹配 KV：$user_match"

echo ""
echo "==> 检查线上 Worker 登录接口"
admin_code=""
admin_status=0
admin_body=""
user_code=""
user_status=0
user_body=""
set +e
if admin_code="$(post_login_code admin "$ADMIN_PASSWORD")"; then
  admin_status=0
else
  admin_status="$?"
fi
admin_body="$(cat /tmp/law-login-response.json 2>/dev/null || true)"
if user_code="$(post_login_code user "$USER_PASSWORD")"; then
  user_status=0
else
  user_status="$?"
fi
user_body="$(cat /tmp/law-login-response.json 2>/dev/null || true)"
set -e

echo "管理员登录 HTTP：${admin_code:-curl失败}（curl 状态：${admin_status}）"
echo "使用者登录 HTTP：${user_code:-curl失败}（curl 状态：${user_status}）"

if [[ "$admin_code" != "200" ]]; then
  echo "管理员登录返回：$admin_body"
fi
if [[ "$user_code" != "200" ]]; then
  echo "使用者登录返回：$user_body"
fi

echo ""
echo "==> 结论"
if [[ "$admin_match" == "yes" && "$user_match" == "yes" && "$admin_code" == "200" && "$user_code" == "200" ]]; then
  echo "后端密码和登录接口都是好的。若网页仍 invalid，多半是浏览器打开了旧前端或旧 Worker 地址。"
elif [[ "$admin_match" != "yes" || "$user_match" != "yes" ]]; then
  echo "KV 里的密码和你输入的不一致。请重新运行：bash worker/reset-passwords.sh"
else
  echo "KV 密码匹配，但线上 Worker 登录失败。需要检查 Worker 是否绑定了同一个 KV namespace 或是否刚部署未生效。"
fi
