# 律所工作台 · 法规对比

纯静态 Web 应用，第一期只实现「法规对比」算法版：上传征求意见稿与正式稿，浏览器内解析文本，按「第 X 条」切分，做条文级对齐与字词级差异标色。

## 功能范围

- 支持 `.docx` 和带文字层的 `.pdf`。
- `.docx` 使用 `mammoth` 提取纯文本；`.pdf` 使用 `pdfjs-dist` 提取文字层。
- PDF 可见字符过少时判定为扫描件或无文字层 PDF，并提示后续版本支持 OCR。
- 按行首 `第X条` 切分条文，识别 `第X章` 作为后续条文的章节。
- 切分预览支持编辑条号、编辑正文、新增、删除、合并相邻条文、在光标处拆分条文。
- 使用 Needleman-Wunsch 全局序列对齐，能处理重新编号后的相近条文。
- 使用 `diff-match-patch` 做字词级 diff。
- 对比结果支持新增/删除/修改总览、只看有改动、手动拆成一删一增、手动合并相邻删增为配对。
- 提供浏览器打印样式，可打印或存为 PDF。

不包含：OCR、AI 兜底对齐、后端、登录、Excel 导出。

## 本地运行

```bash
npm install
npm run dev
```

打开终端输出的本地地址。

## 测试与构建

```bash
npm test
npm run build
```

核心算法测试位于 `src/lib/*.test.ts`，覆盖条文切分、相似度和全局对齐。

## GitHub Pages 部署

项目已配置 `.github/workflows/pages.yml`。推送到 `main` 后会自动：

1. 安装依赖
2. 运行测试
3. 构建 Vite 静态文件
4. 发布 `dist` 到 GitHub Pages

`vite.config.ts` 会在 GitHub Actions 中读取 `GITHUB_REPOSITORY`，自动把 `base` 设置为仓库名路径；本地构建使用相对路径 `./`。

## 第二期：Cloudflare Worker AI 底座

后端子项目在 `worker/`，负责登录鉴权、CORS 来源校验、Workers KV 配置读取、API Key 注入和 provider 中转。前端只保存短时效 HMAC token，不接触 provider API Key。

### Worker 本地准备

```bash
cd worker
npm install
```

创建 KV：

```bash
npx wrangler kv namespace create CONFIG_KV
npx wrangler kv namespace create CONFIG_KV --preview
```

把返回的 `id` 和 `preview_id` 写入 `worker/wrangler.toml`。

设置 token secret：

```bash
npx wrangler secret put TOKEN_SECRET
```

生成初始密码哈希：

```bash
npm run hash-password -- "你的管理员密码"
npm run hash-password -- "你的使用者密码"
```

写入 KV：

```bash
npx wrangler kv key put admin_pw_hash "上一步生成的管理员哈希" --binding CONFIG_KV
npx wrangler kv key put user_pw_hash "上一步生成的使用者哈希" --binding CONFIG_KV
```

写入初始 API 配置：

```bash
npx wrangler kv key put text_api '{"provider":"minimax","baseURL":"https://api.minimax.io/v1","model":"MiniMax-M3","apiKey":"sk-...","groupId":""}' --binding CONFIG_KV
npx wrangler kv key put vision_api '{"provider":"minimax","baseURL":"https://api.minimax.io/v1","model":"MiniMax-M3","apiKey":"sk-...","groupId":""}' --binding CONFIG_KV
npx wrangler kv key put balance_threshold "20" --binding CONFIG_KV
```

`ALLOWED_ORIGINS` 在 `worker/wrangler.toml` 中配置为 GitHub Pages 域名白名单，多个域名用英文逗号分隔。

部署 Worker：

```bash
npm run deploy
```

前端构建时设置 Worker 地址：

```bash
VITE_WORKER_URL="https://你的-worker.你的账号.workers.dev" npm run build
```

GitHub Pages workflow 可在仓库 Variables 中配置 `VITE_WORKER_URL` 后注入构建环境。

### Worker 验证

```bash
npm run typecheck --prefix worker
npm test
```

已覆盖：密码哈希、token 签名/过期/篡改、配置打码、Origin 白名单、未登录拒绝、错误密码拒绝、管理员修改使用者密码后旧密码失效。

### Provider 说明

- 文本槽和识图槽默认都使用 MiniMax，默认 `baseURL=https://api.minimax.io/v1`，模型为 `MiniMax-M3`，两槽可共用同一把 MiniMax Key。
- MiniMax 文本与识图/OCR 使用官方 OpenAI-compatible `POST /v1/chat/completions`。MiniMax-M3 支持 `image_url` content parts，前端扫描件 PDF 会按页渲染为图片，经 `/api/vision` 中转识别。
- MiniMax 官方公开文档未提供标准 HTTP 余额查询接口；Worker 对该 provider 返回 `amount: null`，后台应提示到 MiniMax 控制台查看余额，不暴露 Key，不臆造接口。

## 第三期：法规解读

新增「法规解读」模式：

- 单文件上传，复用原有 docx/PDF 解析、扫描件 OCR、条文切分和可编辑预览。
- 用户确认切分后，前端按条文分批调用 Worker `/api/text`，默认由 MiniMax 文本模型抽取结构化义务。
- 默认模板为「通用版」，字段包括：义务主体、义务内容、触发条件、时间要求、违反后果、风险提示。
- 支持内置「数据合规版」「网安版」模板，也支持自定义字段和另存为模板。
- 模板通过 Worker `/api/templates` 存 Workers KV，登录用户可读写，全所共享。
- 检查表单元格编辑为纯本地操作，不调用 AI。
- 新增字段时，`manual` 只加空列；`ai` 只对这一个新字段按义务原文定向补抽，不重抽整表。
- 合规简报默认由结构化数据本地排版生成；只有点击「AI 润色成简报」时才调用一次 `/api/text`。
- 结果页包含检查表、简报、时间线、章节折叠、条文原文侧栏和打印样式。

抽取相关测试位于 `src/lib/interpretation.test.ts`，覆盖 prompt 拼装、JSON 容错解析、定向补抽 prompt 和时间线排序。Worker 路由测试覆盖模板 KV 读写。
