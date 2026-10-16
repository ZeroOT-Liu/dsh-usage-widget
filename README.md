# dsh-usage-widget（用量与余额）

[English](README.en.md) | 中文

<img src="assets/icon.png" width="88" alt="图标：虎鲸尾鳍下方三根上升的用量柱" align="right">

在 DeepSeek Harness 桌面端**侧边栏左下角**（Settings 上方）显示：

- **账号余额** —— 通过官方账号服务 `ctx.deepseekAccount.getBalance` 读取，与「设置 → 账号」同源；充值余额与赠送余额都显示在收起状态的第一行。
- **今日 token 消耗** —— 全部会话合计，含输入（缓存命中／未命中）与输出明细，并单独列出推理 token。
- **今日花费** —— 按模型单价与**高峰／空闲时段**换算，悬停或点击可展开当前会话明细。

默认显示「今日合计」，鼠标悬停或点击展开：余额、今日明细、按模型分组、**当前会话**今日明细、更新时间与刷新按钮。

**不展开也能看到全部余额**：第一行是 `余额 ¥5.83 · 赠送 ¥9.56`，充值余额为主色、赠送余额为弱化色，两个钱包都直接可读。侧边栏收起成 56px 窄栏时缩为一个图标，完整数值（含赠送余额）在悬停提示里。

## 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 余额 | `deepseekAccount.getBalance` | 官方平台接口，插件本身不接触凭证、不直接请求外部 API |
| tokens | 会话日志 `$DSH_HOME/sessions/**/session.*.jsonl.zstd` | 每个计费请求对应一条带 `data.usage` 的 `assistant/message` 事件，是唯一事实来源 |
| 花费 | 本插件配置的价目表 | DSH 自身不含按 token 计价，只有图片定价 |

会话日志是**多帧 Zstandard** 容器（每批追加一帧）。插件按帧边界增量读取：只解压上次之后新增的帧，一个尚未写完的尾帧会被跳过并在下一轮补上，因此不会重复计数，也不会因为日志很大而变慢（本机 15 个会话文件、2 万行首轮扫描约 0.3 秒，之后每次只读增量）。

## 安装

从 GitHub Release 安装（推荐，不需要克隆仓库）：

```bash
dsh plugin --profile desktop add "https://github.com/ZeroOT-Liu/dsh-usage-widget/releases/latest/download/dsh-usage-widget.tgz"
```

或者直接从仓库安装：

```bash
dsh plugin --profile desktop add "github:ZeroOT-Liu/dsh-usage-widget"
```

两种方式都会把 `dsh-usage-widget` 写进 profile 的 `dsh.profile.bundles`（`~/.dsh/profiles/<profile>/package.json`），对该 profile 的全部会话生效并跨重启保留。

装好后**刷新页面（Ctrl+R）**，让浏览器取到新的模块清单。

卸载：

```bash
dsh plugin --profile desktop remove dsh-usage-widget
```

### 本地开发

用 `link:` 指向工作目录，改完代码刷新页面即可生效，不需要重新安装：

```bash
dsh plugin --profile desktop add "link:/绝对路径/dsh-usage-widget"
```

## 配置

配置写在 [cordis.patch.yml](cordis.patch.yml) 的同名行里。价格单位是「元 / 百万 tokens」，填**空闲时段**价格，高峰时段按 `peakMultiplier` 倍计算（默认为 2，与官方价目表一致）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `currency` | `CNY` | 花费显示币种 |
| `refreshSeconds` | `30` | 部件轮询间隔 |
| `balanceRefreshSeconds` | `180` | 余额缓存时长（余额走外部平台，不宜频繁查询） |
| `peakMultiplier` | `2` | 高峰时段单价倍数 |
| `keepDays` | `45` | 日志聚合保留天数 |
| `sessionsDir` | 自动 | 会话目录；默认取 `$DSH_HOME/sessions`，再退回 `~/.dsh/sessions` |
| `models` | DeepSeek 官方价 | 模型 → `{ cacheHit, cacheMiss, output }` |
| `aliases` | 见文件 | 把历史／带日期／`-exp` 的模型名映射到计价键 |
| `allowHosts` | `[]` | 除本机回环地址外，额外允许访问该路由的主机名 |

高峰时段（**北京时间**，周一至周五 9:00–12:00、14:00–18:00）价格翻倍，其余时段（含周末）半价。中国法定节假日不在规则内，节假日按高峰计价。

未配置单价的模型仍会统计 token，但不计入花费，并在展开面板中标注 `未配置单价，未计入花费`。

## 安全

汇总路由 `/api/dsh-usage-widget/summary` 是精确路由，会**优先于** API 网关的 `/api` 前缀匹配，因此不会继承网关的浏览器会话校验。为弥补这一点，路由自行执行与网关相同的信任判定：只接受回环 `Host`（`127.x.x.x`、`localhost`、`::1` 及 `allowHosts` 中的主机），拒绝跨站 `Origin`／`sec-fetch-site`，其余一律 403。请求方法限 `GET`／`HEAD`。

## 文件

| 文件 | 职责 |
|---|---|
| [index.js](index.js) | 宿主半边：注册汇总路由、信任校验 |
| [lib/service.js](lib/service.js) | 组装汇总响应、余额缓存与降级 |
| [lib/usage-index.js](lib/usage-index.js) | 会话日志增量聚合，按本地日与模型分桶 |
| [lib/session-log.js](lib/session-log.js) | 多帧 Zstandard 帧扫描与解压 |
| [lib/pricing.js](lib/pricing.js) | 价目表、别名解析、高峰判定与计价 |
| [lib/config.js](lib/config.js) | 行配置归一化（不依赖 schemastery） |
| [client.js](client.js) | 客户端半边：`sidebar.footer.action` 部件 |
| [icon.svg](icon.svg) | 插件图标（虎鲸尾鳍 + 上升柱）；[assets/icon.png](assets/icon.png) 是供 README 使用的位图版本 |

插件是**零依赖**的：只使用 Node 内置模块与相对导入。profile 安装的插件无法解析 DSH 自带的 `@deepseek-ai/*` 包，因此宿主不 `import` 它们（也不导出 Cordis `Config` schema），客户端不 `require` 任何 Harness Client 包，样式只引用 `--dsw-alias-*` 主题 token。

## 测试

```bash
node test/run-tests.mjs      # 帧解码、计价、增量聚合（与真实日志全量解码交叉验证）
node test/client-smoke.mjs   # 在 Node 中按真实握手加载并渲染客户端部件
```

## 已知限制

- 花费是**按价目表推算**的参考值，不是账单；官方账单以平台用量页为准。价格变动需自行更新配置。
- 「今日」按宿主本机时区划分；跨时区使用请以本机日历日为准。
- 会话日志写入是分批落的，因此部件显示可能比实际对话落后一个批次（通常几秒），点「刷新」可立即重读。

## 环境要求

- DeepSeek Harness 桌面版（`desktop` profile，验证于 `0.2.0-rc.2`）。装在 `web` profile 也可以，只要该 profile 组合了官方账号插件（`@deepseek-ai/dsh-deepseek-account-platform`）；没有它时部件仍显示用量，余额位置显示「账号服务不可用」。
- 部件还会读取该 profile 的会话服务（`sessions`、`uiSession`）来判定当前会话，标准组合都自带这两项。
- 会话日志为 Zstandard 多帧格式，需要宿主自带 Node ≥ 22.15（DSH 运行时为 Node 24，无需额外处理）。
- 未登录 DeepSeek 账号时余额显示「未登录」，用量与花费照常统计。

## 常见问题

**安装时报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `fetch failed`** —— 本机装了 TLS 拦截代理（企业网络、杀毒软件、抓包工具），而 Node 默认只用内置根证书。让 Node 改用系统证书库即可：

```bash
NODE_OPTIONS="--use-system-ca" dsh plugin --profile desktop add "https://github.com/ZeroOT-Liu/dsh-usage-widget/releases/latest/download/dsh-usage-widget.tgz"
```

**余额位置显示「账号服务不可用」** —— 该 profile 没有组合官方账号插件；用量与花费照常工作。

**花费与实际账单对不上** —— 价格是配置里的推算值，官方调价后需要更新 `cordis.patch.yml` 中的 `models`。

## License

[MIT](LICENSE)
