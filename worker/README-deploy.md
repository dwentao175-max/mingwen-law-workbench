# 律所工作台 Worker 一键部署说明

这份说明给完全不会命令行的人使用。你只需要做三件事：

1. 浏览器弹出 Cloudflare 授权页时，点一次 **Allow**。
2. 按提示输入两个密码：管理员密码、使用者密码。
3. 按提示粘贴一把 MiniMax API Key；GroupId 可以留空。

其他事情脚本会自动完成。

## 开始前确认

你已经有这些账号：

- Cloudflare 账号，并且已经登录浏览器。
- MiniMax 账号，并且能复制 API Key。

## 一条命令部署

打开 macOS 的「终端」，进入项目目录后运行：

```bash
bash worker/setup.sh
```

如果你是从访达打开项目文件夹，可以在终端输入 `cd `，然后把项目文件夹拖进终端，按回车，再运行上面的命令。

## 过程中会看到什么

### 1. 检查 Node.js 和 Wrangler

预期输出大致是：

```text
==> 检查 Node.js 与 npm
Node: v...
npm: ...

==> 检查/安装 Wrangler
Wrangler: ...
```

如果电脑缺 Node.js，脚本会尝试用 Homebrew 安装；如果没有 Homebrew，会提示你先安装 Node.js LTS。

### 2. Cloudflare 授权

终端会提示：

```text
浏览器即将弹出，请点击 Allow 完成授权。
```

这时浏览器会打开 Cloudflare 页面。请点击 **Allow**。点完后回到终端，脚本会继续。

### 3. 自动创建 KV

预期输出大致是：

```text
==> 创建或复用 Workers KV namespace
已写入 wrangler.toml：CONFIG_KV id=..., preview_id=...
```

你不需要复制 id，脚本会自动写入 `worker/wrangler.toml`。

### 4. 自动生成 Token 密钥

预期输出：

```text
==> 生成并写入 Token 签名密钥
Token secret 已写入 Cloudflare Worker Secret。
```

这个密钥不会显示，也不会写进仓库。

### 5. 输入两个密码和 MiniMax 配置

终端会依次问：

```text
请输入管理员密码：admin =
请输入使用者密码：user =
请粘贴 MiniMax API Key：
请输入 MiniMax GroupId（可留空，输入时不显示）：
请输入 MiniMax base URL（默认：https://api.minimax.io/v1，直接回车采用默认）：
请输入文本模型名（默认：MiniMax-M3，直接回车采用默认）：
请输入视觉模型名（默认：MiniMax-M3，直接回车采用默认）：
```

输入时屏幕不会显示字符，这是正常的。粘贴后按回车即可。

密码会加盐哈希后写入 KV，绝不保存明文。MiniMax API Key 只写入 Cloudflare KV，不写进代码仓库。文本槽和识图槽默认共用同一把 MiniMax Key。

### 6. 自动部署 Worker

预期输出会包含一个网址：

```text
部署完成：https://xxxx.workers.dev
```

这就是后端中转服务地址。

### 7. 自动连接前端

脚本会自动写入项目根目录的 `.env`：

```text
VITE_WORKER_URL="https://xxxx.workers.dev"
```

`.env` 已加入 `.gitignore`，不会提交到 git。

### 8. 自动冒烟测试

预期输出：

```text
冒烟测试通过：错误密码返回 401，正确管理员密码返回 200。
```

这说明：

- 错误密码不能登录。
- 管理员密码可以登录。
- Worker 已经能正常访问 KV 和签发 token。

## 成功结束时

最后会看到类似：

```text
Worker 网址：https://xxxx.workers.dev
前端配置：.../.env 已设置 VITE_WORKER_URL
文本接口：MiniMax / MiniMax-M3 / https://api.minimax.io/v1 / Key=sk-****abcd
识图接口：MiniMax / MiniMax-M3 / https://api.minimax.io/v1 / Key=sk-****abcd
GroupId：未设置
```

下一步：

```bash
npm run dev
```

然后打开终端显示的本地地址，输入使用者密码进入工作台。

## 失败了怎么办

脚本可以重复运行。失败后先看中文提示：

- 如果是浏览器授权失败：重新运行 `bash worker/setup.sh`，浏览器打开后点 Allow。
- 如果是网络问题：换一个网络后重跑。
- 如果是 npm 或 wrangler 权限问题：安装 Node.js LTS 后重跑。
- 如果是 API Key 输错：重跑脚本，重新粘贴正确 Key。

## 登录提示 invalid 怎么办

这通常是部署时密码输入错、复制多了空格，或者浏览器还在用旧密码。不要把密码发到聊天窗口里，直接重置即可。

运行：

```bash
bash worker/reset-passwords.sh
```

脚本只会做三件事：

1. 让你重新输入管理员密码两遍。
2. 让你重新输入使用者密码两遍。
3. 加盐哈希后覆盖 Cloudflare KV 里的 `admin_pw_hash` 和 `user_pw_hash`。

它不会重新部署 Worker，也不会要求你重新粘贴 MiniMax API Key。

脚本会直接覆盖 Cloudflare 远程 KV，线上 Worker 会立刻读取新密码。

重置完成后刷新工作台页面：

- 普通登录页输入新的使用者密码。
- 管理后台入口输入新的管理员密码。

## 自定义域名说明

脚本默认允许这些前端来源访问 Worker：

- `https://*.github.io`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

如果以后 GitHub Pages 使用自定义域名，例如 `https://law.example.com`，请把它追加到 `worker/wrangler.toml` 的 `ALLOWED_ORIGINS`：

```toml
ALLOWED_ORIGINS = "https://*.github.io,http://localhost:5173,http://127.0.0.1:5173,https://law.example.com"
```

然后重新运行：

```bash
bash worker/setup.sh
```
