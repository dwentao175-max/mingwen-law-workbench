#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOML_FILE="$SCRIPT_DIR/wrangler.toml"
TMP_FILES=()

cleanup() {
  for file in "${TMP_FILES[@]:-}"; do
    [[ -n "$file" && -f "$file" ]] && rm -f "$file"
  done
}

on_error() {
  local code="$1"
  local line="$2"
  echo ""
  echo "❌ 部署在第 ${line} 行附近失败（退出码 ${code}）。"
  echo "补救建议："
  echo "1. 先确认网络能访问 Cloudflare。"
  echo "2. 如果刚才浏览器授权失败，请重新运行：bash worker/setup.sh。"
  echo "3. 如果提示 wrangler 或 npm 权限问题，请先安装 Node.js，或把终端错误截图发给技术同事。"
  echo "4. 脚本是幂等的，修复问题后可以直接重跑。"
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

read_secret() {
  local prompt="$1"
  local value=""
  while [[ -z "$value" ]]; do
    printf "%s" "$prompt" >&2
    stty -echo
    IFS= read -r value
    stty echo
    printf "\n" >&2
    [[ -z "$value" ]] && echo "输入不能为空，请重新输入。" >&2
  done
  printf "%s" "$value"
}

read_default() {
  local prompt="$1"
  local default_value="$2"
  local value=""
  printf "%s（默认：%s，直接回车采用默认）：" "$prompt" "$default_value" >&2
  IFS= read -r value
  printf "%s" "${value:-$default_value}"
}

read_optional_secret() {
  local prompt="$1"
  local value=""
  printf "%s（可留空，输入时不显示）：" "$prompt" >&2
  stty -echo
  IFS= read -r value
  stty echo
  printf "\n" >&2
  printf "%s" "$value"
}

make_temp() {
  local file
  file="$(mktemp)"
  TMP_FILES+=("$file")
  chmod 600 "$file"
  printf "%s" "$file"
}

wrangler_cmd() {
  if need_cmd wrangler; then
    wrangler "$@"
  else
    npx wrangler "$@"
  fi
}

current_toml_value() {
  local key="$1"
  sed -n "s/^${key} = \"\\([^\"]*\\)\"/\\1/p" "$TOML_FILE" | head -1
}

write_kv_ids_to_toml() {
  PROD_ID="$1" PREVIEW_ID="$2" TOML_FILE="$TOML_FILE" node <<'NODE'
const fs = require("node:fs");
const file = process.env.TOML_FILE;
let text = fs.readFileSync(file, "utf8");
text = text.replace(/^id = ".*"$/m, `id = "${process.env.PROD_ID}"`);
text = text.replace(/^preview_id = ".*"$/m, `preview_id = "${process.env.PREVIEW_ID}"`);
fs.writeFileSync(file, text);
NODE
}

create_namespace_if_needed() {
  local mode="$1"
  local current_key="$2"
  local current
  current="$(current_toml_value "$current_key")"
  if [[ -n "$current" && "$current" != REPLACE_WITH_* ]]; then
    printf "%s" "$current"
    return
  fi

  local output id list_output namespace_title
  if [[ "$mode" == "preview" ]]; then
    namespace_title="CONFIG_KV_preview"
    if ! output="$(wrangler_cmd kv namespace create CONFIG_KV --preview 2>&1)"; then
      echo "$output" >&2
      echo "创建 preview KV 失败，正在尝试复用已有 namespace：$namespace_title" >&2
      list_output="$(wrangler_cmd kv namespace list 2>&1 || true)"
      id="$(printf "%s\n" "$list_output" | node -e '
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  try {
    const start = input.indexOf("[");
    const end = input.lastIndexOf("]");
    const list = JSON.parse(start >= 0 ? input.slice(start, end + 1) : input);
    const found = list.find(item => item.title === "CONFIG_KV_preview" || item.title === "CONFIG_KV-preview");
    if (found) process.stdout.write(found.id);
  } catch {}
});
')"
      if [[ -n "$id" ]]; then
        printf "%s\n" "$id"
        return
      fi
      echo "没有找到可复用的 preview KV namespace。请确认 Cloudflare 账户已授权，并稍后重跑脚本。" >&2
      exit 1
    fi
  else
    namespace_title="CONFIG_KV"
    if ! output="$(wrangler_cmd kv namespace create CONFIG_KV 2>&1)"; then
      echo "$output" >&2
      echo "创建生产 KV 失败，正在尝试复用已有 namespace：$namespace_title" >&2
      list_output="$(wrangler_cmd kv namespace list 2>&1 || true)"
      id="$(printf "%s\n" "$list_output" | node -e '
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  try {
    const start = input.indexOf("[");
    const end = input.lastIndexOf("]");
    const list = JSON.parse(start >= 0 ? input.slice(start, end + 1) : input);
    const found = list.find(item => item.title === "CONFIG_KV");
    if (found) process.stdout.write(found.id);
  } catch {}
});
')"
      if [[ -n "$id" ]]; then
        printf "%s\n" "$id"
        return
      fi
      echo "没有找到可复用的生产 KV namespace。请确认 Cloudflare 账户已授权，并稍后重跑脚本。" >&2
      exit 1
    fi
  fi
  echo "$output" >&2
  id="$(printf "%s\n" "$output" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -1)"
  if [[ -z "$id" ]]; then
    echo "没有从 Wrangler 输出中识别到 KV id。正在尝试用 namespace 列表查找：$namespace_title" >&2
    list_output="$(wrangler_cmd kv namespace list 2>&1 || true)"
    id="$(printf "%s\n" "$list_output" | TITLE="$namespace_title" node -e '
let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => {
  try {
    const start = input.indexOf("[");
    const end = input.lastIndexOf("]");
    const list = JSON.parse(start >= 0 ? input.slice(start, end + 1) : input);
    const title = process.env.TITLE;
    const found = list.find(item => item.title === title);
    if (found) process.stdout.write(found.id);
  } catch {}
});
')"
  fi
  if [[ -z "$id" ]]; then
    echo "仍然没有识别到 KV id。请把上方 Wrangler 输出发给技术同事。" >&2
    exit 1
  fi
  printf "%s\n" "$id"
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

post_login_code_with_retry() {
  local body="$1"
  local label="$2"
  local code status err_file
  err_file="$(make_temp)"
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    : > "$err_file"
    set +e
    code="$(printf "%s" "$body" | curl -sS -o /dev/null -w "%{http_code}" \
      --connect-timeout 10 \
      --max-time 20 \
      -X POST "$WORKER_URL/api/login" \
      -H "Origin: $SMOKE_ORIGIN" \
      -H "Content-Type: application/json" \
      --data-binary @- 2>"$err_file")"
    status="$?"
    set -e
    if [[ "$status" == "0" && "$code" != "000" ]]; then
      printf "%s" "$code"
      return 0
    fi
    echo "第 ${attempt}/12 次${label}测试暂时无法访问 Worker，等待 10 秒后重试..." >&2
    if [[ -s "$err_file" ]]; then
      sed 's/^/  curl: /' "$err_file" >&2
    fi
    sleep 10
  done
  printf "curl-failed"
  return 0
}

mask_key() {
  local value="$1"
  local len=${#value}
  if (( len <= 8 )); then
    printf "****"
  else
    printf "%s****%s" "${value:0:4}" "${value: -4}"
  fi
}

cd "$SCRIPT_DIR"

log "检查 Node.js 与 npm"
if ! need_cmd node || ! need_cmd npm; then
  if need_cmd brew; then
    echo "未检测到 Node.js，正在用 Homebrew 安装 node..."
    brew install node
  else
    echo "未检测到 Node.js，也未检测到 Homebrew。"
    echo "请先安装 Node.js LTS：https://nodejs.org/zh-cn，然后重新运行 bash worker/setup.sh"
    exit 1
  fi
fi
echo "Node: $(node -v)"
echo "npm: $(npm -v)"

log "检查/安装 Wrangler"
if ! need_cmd wrangler; then
  echo "未检测到全局 wrangler，正在执行 npm i -g wrangler..."
  if ! npm i -g wrangler; then
    echo "全局安装失败，将改用本项目本地 wrangler。"
  fi
fi
if [[ ! -d "$SCRIPT_DIR/node_modules/wrangler" ]]; then
  echo "安装 Worker 子项目依赖..."
  npm install
fi
echo "Wrangler: $(wrangler_cmd --version)"

log "Cloudflare 授权"
echo "浏览器即将弹出，请点击 Allow 完成授权。授权成功后回到终端，脚本会自动继续。"
wrangler_cmd login

log "创建或复用 Workers KV namespace"
PROD_ID="$(create_namespace_if_needed production id | tail -1)"
PREVIEW_ID="$(create_namespace_if_needed preview preview_id | tail -1)"
write_kv_ids_to_toml "$PROD_ID" "$PREVIEW_ID"
echo "已写入 wrangler.toml：CONFIG_KV id=${PROD_ID}, preview_id=${PREVIEW_ID}"

log "生成并写入 Token 签名密钥"
TOKEN_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))')"
printf "%s" "$TOKEN_SECRET" | wrangler_cmd secret put TOKEN_SECRET >/dev/null
echo "Token secret 已写入 Cloudflare Worker Secret。"

log "请输入密码和 MiniMax 配置（敏感内容不会显示在屏幕上）"
ADMIN_PW="$(read_secret "请输入管理员密码：admin = ")"
USER_PW="$(read_secret "请输入使用者密码：user = ")"
MINIMAX_KEY="$(read_secret "请粘贴 MiniMax API Key：")"
MINIMAX_GROUP_ID="$(read_optional_secret "请输入 MiniMax GroupId")"
MINIMAX_BASE_URL="$(read_default "请输入 MiniMax base URL" "https://api.minimax.io/v1")"
MINIMAX_TEXT_MODEL="$(read_default "请输入文本模型名" "MiniMax-M3")"
MINIMAX_VISION_MODEL="$(read_default "请输入视觉模型名" "MiniMax-M3")"

log "加盐哈希密码并写入 KV（不保存明文）"
ADMIN_HASH="$(printf "%s" "$ADMIN_PW" | node scripts/hash-password.mjs --stdin)"
USER_HASH="$(printf "%s" "$USER_PW" | node scripts/hash-password.mjs --stdin)"
admin_hash_file="$(make_temp)"
user_hash_file="$(make_temp)"
printf "%s" "$ADMIN_HASH" > "$admin_hash_file"
printf "%s" "$USER_HASH" > "$user_hash_file"
kv_put_file admin_pw_hash "$admin_hash_file"
kv_put_file user_pw_hash "$user_hash_file"
echo "管理员密码哈希、使用者密码哈希已写入 KV。"

log "写入默认 API 配置到 KV"
text_api_file="$(make_temp)"
vision_api_file="$(make_temp)"
MINIMAX_KEY="$MINIMAX_KEY" MINIMAX_GROUP_ID="$MINIMAX_GROUP_ID" MINIMAX_BASE_URL="$MINIMAX_BASE_URL" MINIMAX_TEXT_MODEL="$MINIMAX_TEXT_MODEL" node > "$text_api_file" <<'NODE'
console.log(JSON.stringify({
  provider: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL,
  model: process.env.MINIMAX_TEXT_MODEL,
  apiKey: process.env.MINIMAX_KEY,
  groupId: process.env.MINIMAX_GROUP_ID || undefined
}));
NODE
MINIMAX_KEY="$MINIMAX_KEY" MINIMAX_GROUP_ID="$MINIMAX_GROUP_ID" MINIMAX_BASE_URL="$MINIMAX_BASE_URL" MINIMAX_VISION_MODEL="$MINIMAX_VISION_MODEL" node > "$vision_api_file" <<'NODE'
console.log(JSON.stringify({
  provider: "minimax",
  baseURL: process.env.MINIMAX_BASE_URL,
  model: process.env.MINIMAX_VISION_MODEL,
  apiKey: process.env.MINIMAX_KEY,
  groupId: process.env.MINIMAX_GROUP_ID || undefined
}));
NODE
kv_put_file text_api "$text_api_file"
kv_put_file vision_api "$vision_api_file"
echo "MiniMax 文本接口、MiniMax 识图接口已写入 KV。"

log "部署 Cloudflare Worker"
deploy_output_file="$(make_temp)"
trap - ERR
set +e
deploy_output="$(wrangler_cmd deploy 2>&1)"
deploy_status="$?"
set -e
trap 'on_error "$?" "$LINENO"' ERR
printf "%s\n" "$deploy_output" | tee "$deploy_output_file"
if [[ "$deploy_status" != "0" ]]; then
  onboarding_url="$(grep -Eo 'https://dash\.cloudflare\.com/[^[:space:]]+/workers/onboarding' "$deploy_output_file" | tail -1 || true)"
  if grep -q "register a workers.dev subdomain" "$deploy_output_file" || [[ -n "$onboarding_url" ]]; then
    echo ""
    echo "Cloudflare 账号还没有注册 workers.dev 子域名。"
    echo "接下来会进入 Wrangler 原生交互。"
    echo "看到 “Would you like to register a workers.dev subdomain now?” 时，请输入 y 后按回车。"
    echo "如果让你填写子域名，请输入一个英文小写名字，例如：calvin-law-workbench"
    printf "准备好后按回车继续："
    IFS= read -r _
    : > "$deploy_output_file"
    wrangler_cmd deploy
    echo "子域名注册完成，正在重新部署并捕获 Worker 网址..."
    wrangler_cmd deploy 2>&1 | tee "$deploy_output_file"
  else
    echo "Worker 部署失败。请查看上方 Wrangler 输出。"
    exit "$deploy_status"
  fi
fi
WORKER_URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$deploy_output_file" | tail -1 || true)"
if [[ -z "$WORKER_URL" ]]; then
  echo "没有从部署输出中识别到 workers.dev 网址。请查看上方 Wrangler 输出。"
  exit 1
fi
echo "部署完成：$WORKER_URL"

log "自动写入前端 .env"
cat > "$ROOT_DIR/.env" <<EOF
VITE_WORKER_URL="$WORKER_URL"
EOF
echo "已写入 $ROOT_DIR/.env（不含任何 API Key，且已加入 .gitignore）。"

log "冒烟测试登录接口"
SMOKE_ORIGIN="https://setup-smoke.github.io"
wrong_body="$(json_login_body admin "__definitely_wrong_password__")"
wrong_code="$(post_login_code_with_retry "$wrong_body" "错误密码")"
if [[ "$wrong_code" != "401" ]]; then
  echo "⚠️ 错误密码测试预期 401，实际 $wrong_code。"
  echo "如果刚注册 workers.dev 子域名，这通常是 Cloudflare TLS 证书还在生效中。"
  echo "部署本身已完成，稍后可重新运行脚本或直接打开前端测试登录。"
  SMOKE_WARNING=1
else
  SMOKE_WARNING=0
fi

if [[ "${SMOKE_WARNING:-0}" != "1" ]]; then
  right_body="$(json_login_body admin "$ADMIN_PW")"
  right_code="$(post_login_code_with_retry "$right_body" "正确管理员密码")"
  if [[ "$right_code" != "200" ]]; then
    echo "⚠️ 正确管理员密码测试预期 200，实际 $right_code。"
    echo "请确认刚才输入的管理员密码；如果刚注册 workers.dev 子域名，也可能是 TLS 证书仍在生效中。"
    SMOKE_WARNING=1
  fi
fi
if [[ "${SMOKE_WARNING:-0}" == "1" ]]; then
  echo "⚠️ 冒烟测试未完成，但 Worker 已部署、KV 已写入、前端 .env 已连接。"
else
  echo "冒烟测试通过：错误密码返回 401，正确管理员密码返回 200。"
fi

log "完成"
echo "Worker 网址：$WORKER_URL"
echo "前端配置：$ROOT_DIR/.env 已设置 VITE_WORKER_URL"
echo "KV namespace：CONFIG_KV=${PROD_ID}"
echo "文本接口：MiniMax / ${MINIMAX_TEXT_MODEL} / ${MINIMAX_BASE_URL} / Key=$(mask_key "$MINIMAX_KEY")"
echo "识图接口：MiniMax / ${MINIMAX_VISION_MODEL} / ${MINIMAX_BASE_URL} / Key=$(mask_key "$MINIMAX_KEY")"
echo "GroupId：${MINIMAX_GROUP_ID:-未设置}"
echo ""
echo "下一步："
echo "1. 本地运行前端时，回到项目根目录执行 npm run dev。"
echo "2. 部署 GitHub Pages 时，把 VITE_WORKER_URL 设置为：$WORKER_URL"
echo "3. 如果使用自定义域名，请在 worker/wrangler.toml 的 ALLOWED_ORIGINS 中加入该域名后重跑本脚本。"
