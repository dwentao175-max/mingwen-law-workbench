#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_FILES=()

cleanup() {
  for file in "${TMP_FILES[@]:-}"; do
    if [[ -n "$file" && -f "$file" ]]; then
      rm -f "$file" || true
    fi
  done
}

on_error() {
  local code="$1"
  local line="$2"
  echo ""
  echo "❌ 密码重置在第 ${line} 行附近失败（退出码 ${code}）。"
  echo "补救建议："
  echo "1. 确认刚才已经完成 Cloudflare 登录授权。"
  echo "2. 确认网络能访问 Cloudflare。"
  echo "3. 重新运行：bash worker/reset-passwords.sh。"
  echo "4. 如果仍失败，把终端里从“==>”开始的输出发给技术同事。"
  cleanup
  exit "$code"
}

trap 'on_error "$?" "$LINENO"' ERR
trap cleanup EXIT

log() {
  echo ""
  echo "==> $*"
}

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

read_secret_confirm() {
  local label="$1"
  local first second
  while true; do
    first="$(read_secret_once "请输入新的${label}：")"
    if [[ -z "$first" ]]; then
      echo "密码不能为空，请重新输入。" >&2
      continue
    fi

    second="$(read_secret_once "请再输入一次新的${label}：")"
    if [[ "$first" == "$second" ]]; then
      printf "%s" "$first"
      return
    fi
    echo "两次输入不一致，请重新输入。" >&2
  done
}

make_temp() {
  local file
  file="$(mktemp)"
  TMP_FILES+=("$file")
  chmod 600 "$file"
  printf "%s" "$file"
}

kv_put_file() {
  local key="$1"
  local file="$2"
  wrangler_cmd kv key put "$key" --path "$file" --binding CONFIG_KV --preview false --remote >/dev/null
}

json_login_body() {
  ROLE_VALUE="$1" PASSWORD_VALUE="$2" node <<'NODE'
console.log(JSON.stringify({ role: process.env.ROLE_VALUE, password: process.env.PASSWORD_VALUE }));
NODE
}

post_login_code() {
  local body="$1"
  printf "%s" "$body" | curl -sS -o /dev/null -w "%{http_code}" \
    --connect-timeout 10 \
    --max-time 20 \
    -X POST "$WORKER_URL/api/login" \
    -H "Origin: $SMOKE_ORIGIN" \
    -H "Content-Type: application/json" \
    --data-binary @-
}

cd "$SCRIPT_DIR"

log "检查 Node.js 与 Wrangler"
if ! need_cmd node || ! need_cmd npm; then
  echo "未检测到 Node.js/npm。请先安装 Node.js LTS，然后重新运行：bash worker/reset-passwords.sh"
  exit 1
fi
if ! need_cmd wrangler && [[ ! -x "$SCRIPT_DIR/node_modules/.bin/wrangler" ]]; then
  echo "未检测到 Wrangler，正在安装 worker 项目依赖..."
  npm install
fi
echo "Node: $(node -v)"
echo "Wrangler: $(wrangler_cmd --version)"

log "确认 Cloudflare 登录状态"
if ! wrangler_cmd whoami >/dev/null 2>&1; then
  echo "当前没有登录 Cloudflare，浏览器即将弹出，请点击 Allow 完成授权。"
  wrangler_cmd login
fi
wrangler_cmd whoami

log "请输入要重置的新密码（输入时不会显示在屏幕上）"
ADMIN_PASSWORD="$(read_secret_confirm "管理员密码")"
USER_PASSWORD="$(read_secret_confirm "使用者密码")"

log "加盐哈希密码并写入 Cloudflare KV（不保存明文）"
admin_hash_file="$(make_temp)"
user_hash_file="$(make_temp)"
admin_hash="$(printf "%s" "$ADMIN_PASSWORD" | node scripts/hash-password.mjs --stdin)"
user_hash="$(printf "%s" "$USER_PASSWORD" | node scripts/hash-password.mjs --stdin)"
printf "%s" "$admin_hash" > "$admin_hash_file"
printf "%s" "$user_hash" > "$user_hash_file"

kv_put_file admin_pw_hash "$admin_hash_file"
kv_put_file user_pw_hash "$user_hash_file"
echo "管理员密码和使用者密码已重置。"

log "刷新 Token 签名密钥"
node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))' | wrangler_cmd secret put TOKEN_SECRET >/dev/null
echo "Token 签名密钥已刷新。"

WORKER_URL="$(grep '^VITE_WORKER_URL=' "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')"
SMOKE_ORIGIN="http://localhost:5173"

if [[ -n "$WORKER_URL" ]]; then
  log "测试新管理员密码能否登录"
  set +e
  admin_body="$(json_login_body admin "$ADMIN_PASSWORD")"
  admin_code="$(post_login_code "$admin_body" 2>/dev/null)"
  curl_status="$?"
  set -e

  if [[ "$curl_status" == "0" && "$admin_code" == "200" ]]; then
    echo "测试通过：新管理员密码可以登录。"
  else
    echo "已写入新密码，但自动测试暂时没有通过。"
    echo "这通常是网络或 Worker 刚更新后的短暂访问问题。请刷新前端页面后，用新密码手动登录。"
  fi
else
  echo "未找到前端 .env 里的 VITE_WORKER_URL，跳过自动登录测试。"
fi

echo ""
echo "✅ 密码重置完成。"
echo "现在请刷新工作台页面："
echo "- 普通入口：输入新的使用者密码。"
echo "- 管理后台入口：输入新的管理员密码。"
echo "注意：不要把密码粘贴到聊天窗口或代码文件里。"
