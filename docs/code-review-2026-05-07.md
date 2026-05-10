# Hermes Agent 代码审查 & 架构演进报告

**日期**: 2026-05-07  
**审查者**: DeepSeek V4 (通过 Hermes CLI)  
**版本**: 当前 HEAD

---

## 审查范围声明

本报告基于 **30 分钟快速审查**，**并非全量代码分析**。

### 已完整审查

| 文件 | 行数 | 覆盖率 |
|------|------|--------|
| `hermes_cli/web_server.py` (FastAPI Web 后端) | 4062 行 | 100% |
| `gateway/platforms/api_server.py` (aiohttp API 服务器) | 3063 行 | 100% |
| `web/vite.config.ts` | 108 行 | 100% |
| `web/package.json` | 52 行 | 100% |
| `web/src/pages/ChatPage.tsx` | 834 行 | 100% |
| `web/src/lib/api.ts` | 784 行 | 100% |
| `tui_gateway/server.py` (开头部分) | ~100/6223 行 | ~2% |
| `gateway/run.py` (开头部分) | ~500/14944 行 | ~3% |

### 未审查的核心模块

| 模块 | 行数 | 备注 |
|------|------|------|
| `run_agent.py` (AIAgent 核心) | ~14K | 核心对话循环未读 |
| `cli.py` (CLI 交互主循环) | ~12K | 命令分发未读 |
| `agent/` (50+ 文件) | ~30K+ | 适配器/压缩/提示构建/内存/... |
| `tools/` (85+ 工具) | ~30K+ | 工具实现未读 |
| `gateway/platforms/*.py` (20+ 平台) | ~20K+ | Telegram/Discord/Slack 等未读 |
| `tests/` (~900 文件) | ~15MB | 测试质量未评估 |
| `plugins/` (插件系统) | ~4MB | 插件框架未读 |
| `cron/` (调度系统) | ~112K | 调度实现未读 |
| `acp_adapter/` (ACP 协议) | ~168K | ACP 未读 |
| `hermes_state.py` | ~112K | 会话状态存储未读 |
| `trajectory_compressor.py` | ~1.5K | 压缩逻辑未读 |
| `frontend pages` (除 ChatPage 外 11 个页面) | ~10K+ | 页面实现未逐行审查 |
| `hermes_cli/` (除 web_server 外所有文件) | ~3.3MB | CLI 子系统未读 |

### 审查方法

1. **架构拓扑扫描** — 目录结构、文件依赖、模块边界
2. **Web 后端全读** — web_server.py + api_server.py + 关键前端文件
3. **Gateway/TUI 抽样** — run.py + server.py 头部 3%
4. **大文件分析** — 识别超 2K 行的文件并确认职责混合情况
5. **依赖分析** — pyproject.toml + package.json + imports

> **所以: 报告中的 P0-P3 问题和架构建议主要来自 Web 后端分析 + 架构拓扑推断。** 核心 agent 逻辑、工具系统、平台适配器、测试质量 — 这些领域需要专门的审查才能给出可靠结论。

---

## 一、现状扫描

### 项目规模

| 维度 | 数据 |
|------|------|
| 总代码量 | ~100万+ 行 (含 tests/ 15MB, website/ 14MB) |
| 核心 Python 文件 | `run_agent.py` 14K 行, `cli.py` 12K 行, `gateway/run.py` 15K 行 |
| Web 后端 (FastAPI) | `hermes_cli/web_server.py` — 4062 行 / 155KB |
| API Server (aiohttp) | `gateway/platforms/api_server.py` — 3063 行 / 133KB |
| TUI Gateway | `tui_gateway/server.py` — 6223 行 / 225KB |
| 前端 | 85 文件, React 19 + Vite 7 + TailwindCSS 4 |
| 工具层 | ~85 个工具文件分散在 `tools/` + `plugins/` |
| 测试 | ~900 测试文件 / ~17K 测试用例 |

### 当前架构拓扑

```
┌──────────────────────────────────────────────────────────────┐
│                      BROWSER (React SPA)                      │
│  Pages: Chat, Config, Sessions, Analytics, Logs, Cron, ...   │
│  Components: ChatSidebar, ModelPicker, OAuthLogin, ToolCall  │
│  xterm.js PTY terminal on ChatPage                            │
└──────────────────────┬──────────────┬────────────────────────┘
                       │ HTTP/JSON    │ WebSocket
                       ▼              ▼
┌──────────────────────────────────────────────────────────────┐
│               FastAPI Backend (web_server.py)                  │
│  Port 9119 · Session Token Auth · CORS localhost-only        │
│  Endpoints: /api/status, /api/sessions, /api/config,         │
│             /api/env, /api/logs, /api/cron, /api/profiles,   │
│             /api/skills, /api/analytics, /api/model,          │
│             /api/providers/oauth (PKCE+DeviceCode flows),    │
│             /api/dashboard/themes, /api/dashboard/plugins,   │
│             /api/pty (WS→PTY), /api/ws, /api/pub, /api/events│
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────────┐ ┌──────────┐ ┌───────────────────────────┐
│ Gateway(run.py)  │ │ CLI      │ │ ACP Adapter               │
│ Platforms:       │ │ (cli.py) │ │ (VS Code/Zed/JetBrains)   │
│ Telegram/Discord │ │ 12K 行   │ │                           │
│ Slack/WhatsApp.. │ │          │ │                           │
│ API Server       │ │          │ │                           │
│ (aiohttp:8642)   │ │          │ │                           │
└─────────────────┘ └──────────┘ └───────────────────────────┘
```

---

## 二、代码问题与改进建议

### [P0] 安全与架构风险 — 必须修复

#### 1. web_server.py 单文件 4062 行 — 违反单一职责

`web_server.py` 包含七个不同关注点混在一个 155KB 文件中：

- 路由定义 (Status, Sessions, Config, Env, Logs, Analytics, Skills, Toolsets, Profiles)
- OAuth 流处理 (PKCE 授权码流 + DeviceCode 设备流 + 后台轮询线程)
- 配置模式生成 (`CONFIG_SCHEMA` 模块级推导 + 手动覆盖)
- 仪表板主题系统 (解析 YAML 主题定义、规范化、注入 CSS)
- 仪表板插件发现 (扫描 plugins/*/dashboard/manifest.json)
- PTY 桥接 (`/api/pty` WebSocket → POSIX PTY 子进程)
- WebSocket 事件广播 (`/api/pub` + `/api/events` 频道广播)

**影响**:
- 任何改动都需要加载整个 155KB 文件
- OAuth 流程和主题系统代码量相当，却共享同一命名空间
- 模块级代码 (`CONFIG_SCHEMA = _build_schema_from_config(DEFAULT_CONFIG)`) 在导入时执行，引入时序依赖
- `sys.path.insert(0, str(PROJECT_ROOT))` 是全局副作用

**建议**: 拆分为模块目录

```
hermes_cli/web/
├── __init__.py
├── server.py              # FastAPI app 定义 + uvicorn 启动 (~200行)
├── app_state.py           # _SESSION_TOKEN, _DASHBOARD_EMBEDDED_CHAT_ENABLED 等全局状态
├── dependencies.py        # FastAPI 依赖注入 (get_db, require_token)
├── middleware/
│   ├── auth.py            # 会话令牌验证中间件
│   ├── host.py            # Host header 验证 (DNS rebinding 防护)
│   └── error_handler.py   # 全局异常处理器
├── routes/
│   ├── __init__.py        # 汇总所有 route 模块
│   ├── status.py          # /api/status
│   ├── sessions.py        # /api/sessions, search, messages, delete
│   ├── config.py          # /api/config, /api/config/raw, /api/config/defaults, /api/config/schema
│   ├── model.py           # /api/model/info, /api/model/options, /api/model/auxiliary, /api/model/set
│   ├── env.py             # /api/env + /api/env/reveal
│   ├── oauth.py           # OAuth 流 (PKCE + DeviceCode + 轮询 + 取消)
│   ├── cron.py            # /api/cron/jobs CRUD + pause/resume/trigger
│   ├── profiles.py        # /api/profiles CRUD + SOUL.md
│   ├── analytics.py       # /api/analytics/usage, /api/analytics/models
│   ├── logs.py            # /api/logs
│   ├── skills.py          # /api/skills, /api/skills/toggle, /api/tools/toolsets
│   ├── plugins.py         # /api/dashboard/plugins, 插件管理
│   ├── themes.py          # /api/dashboard/themes, /api/dashboard/theme
│   ├── gateway.py         # /api/gateway/restart, /api/hermes/update, /api/actions/*/status
│   └── providers.py       # /api/providers/oauth (list/disconnect)
├── websocket/
│   ├── pty.py             # /api/pty — PTY → WebSocket 桥接
│   ├── events.py          # /api/pub + /api/events — 事件广播
│   └── gateway.py         # /api/ws — JSON-RPC sidecar
├── spa.py                 # SPA 挂载 + index.html 令牌注入
└── plugin_loader.py       # _mount_plugin_api_routes 逻辑
```

#### 2. gateway/run.py 15K 行 — 严重膨胀

**问题表现**:
- 模块加载时执行约 300 行的 `config.yaml → env` 桥接代码（包含 30+ try/except）
- `GatewayRunner` 类体量过大，`_dispatch_tool_progress`、`_resolve_runtime_agent_kwargs` 等函数复杂度极高
- 约 20 条 `except Exception: pass` — 错误被静默吞噬
- SSL 证书发现、环境变量桥接、网关生命周期管理、会话路由、工具进度分发 — 全部在一个文件中

**建议重构**:

```
gateway/
├── run.py                  # 入口点，精简 (~200行)
├── config_bridge.py        # config.yaml → env var 桥接 (从 run.py 提取)
├── ssl_discovery.py        # SSL_CERT_FILE 发现 (从 run.py 提取)
├── lifecycle.py            # GatewayRunner 生命周期 + 启动/停止/重启
├── session.py              # 会话路由 + 代理缓存 + 超时管理
├── dispatcher.py           # 工具进度分发 + 事件回调
├── auto_continue.py        # 自动继续逻辑 + 新鲜度检查
└── platform_manager.py     # 平台适配器管理 (启动/停止/健康检查)
```

#### 3. tui_gateway/server.py 6223 行 — 重构候选

包含 JSON-RPC 方法注册、代理生命周期管理、会话管理、权限校验、事件发布 — 全部在同一文件中。

**建议领域拆分**:

```
tui_gateway/
├── entry.py                # 入口点 + 异常钩子
├── server.py               # JSON-RPC 路由 + 方法注册
├── session.py              # 会话生命周期管理
├── transport.py            # Stdio/WS 传输层
├── proxy.py                # 代理同步层
├── render.py               # 渲染同步
└── events.py               # 事件发布
```

#### 4. 缺乏统一错误处理机制

- web_server.py 中每个路由都采用 `try/except + HTTPException` 模式，无全局异常处理器
- `_require_token()` 抛出的 `HTTPException` 和 `500: detail="Internal server error"` 静默模式不一致
- 部分路由返回 `raise HTTPException`，部分返回 `JSONResponse(content=...)`
- 错误日志中 `_log.exception` 和 `pass` 交替出现，可追溯性差

**建议**:

```python
# 全局异常处理器
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    _log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": "server_error"},
    )

# 统一错误响应格式
class ErrorResponse(BaseModel):
    detail: str
    type: str = "error"
    code: str | None = None
```

---

### [P1] 性能与设计问题 — 尽快修复

#### 5. 前端 bundle 膨胀风险

`package.json` 依赖分析:

| 依赖 | 大小 (min+gzip) | 用途 | 建议 |
|------|-----------------|------|------|
| @react-three/fiber + three.js | ~150KB | 3D 渲染 | 仅用于特定插件，应移到 `optionalDependencies` |
| @observablehq/plot | ~500KB | 图表 | 仅在 AnalyticsPage 使用，应 `React.lazy()` |
| gsap | ~30KB | 动画 | 仅用于特定主题效果，应动态 import |
| leva | ~20KB | 调试 UI | 仅用于 3D 场景调试，应动态 import |

**建议**:
- 将 3D/Audio 依赖移到 `optionalDependencies`
- AnalyticsPage 使用 `React.lazy(() => import('@observablehq/plot'))`
- 运行 `vite analyze` 并设置 bundle 大小预算

#### 6. 配置 schema 模块级执行

```python
# web_server.py 中模块级别代码
CONFIG_SCHEMA = _build_schema_from_config(DEFAULT_CONFIG)
```

在导入 `web_server.py` 的任何模块时都会执行完整的 schema 推导。`DEFAULT_CONFIG` 改变时可能引入副作用。

**建议**: 延迟初始化或使用 `@lru_cache`

```python
@lru_cache(maxsize=1)
def build_config_schema():
    return _build_schema_from_config(DEFAULT_CONFIG)
```

#### 7. 契约重复：两套 CORS 中间件

| 组件 | 框架 | CORS 实现 |
|------|------|-----------|
| web_server.py | FastAPI | `CORSMiddleware(allow_origin_regex=...)` |
| api_server.py | aiohttp | 自定义 `cors_middleware` + `_cors_headers_for_origin()` |

两套实现各自维护 CORS 策略，逻辑不一致 (web 允许 `*` 的方法+headers，api_server 限制为 GET/POST/DELETE/OPTIONS)。

**建议**: 提取共享 CORS 策略为公共模块

#### 8. SessionDB 重复创建+关闭

每个会话路由都重复 `SessionDB()` + `db.close()`:

```python
@app.get("/api/sessions")
async def get_sessions(...):
    db = SessionDB()
    try:
        ...
    finally:
        db.close()

@app.get("/api/sessions/search")
async def search_sessions(...):
    db = SessionDB()
    try:
        ...
    finally:
        db.close()
```

**建议**: 使用 FastAPI 依赖注入

```python
async def get_db():
    db = SessionDB()
    try:
        yield db
    finally:
        db.close()

@app.get("/api/sessions")
async def get_sessions(limit=20, offset=0, db: SessionDB = Depends(get_db)):
    ...
```

---

### [P2] 前端问题 — 推荐修复

#### 9. ChatPage.tsx 834 行 — 单组件过于复杂

该组件混合了以下关注点:
- xterm.js 终端初始化 + WebGL/DOM 渲染器选择
- WebSocket → PTY 生命周期 (connect/disconnect/reconnect)
- 剪贴板处理 (OSC 52 + Ctrl/Cmd+C/V + copy 按钮)
- 鼠标 SGR 事件去重 (cell-level motion dedup)
- 响应式字体大小 (7px ~ 14px 根据容器宽度)
- 移动端侧面板 portal (createPortal)
- 页面 header 按钮注册
- 隐藏/显示时的终端 refit

**建议**: 提取为 hooks

```
web/src/hooks/
├── useTerminal.ts          # xterm 初始化 + 配置 + 销毁
├── usePtyWebSocket.ts     # WS 连接 + PTY 桥接 + 重连
├── useClipboard.ts        # 剪贴板集成 (OSC 52 + 快捷键)
├── useResponsiveTerminal.ts # 响应式字体 + fit
└── useMobilePanel.ts      # 移动端侧面板
```

#### 10. 前端 API 层无类型生成

`api.ts` 中手动定义了 70+ 接口类型 — 后端改 schema 时前端静默断裂。接口如 `SessionInfo`、`AnalyticsResponse`、`ModelInfoResponse` 等与 Python 端不自动同步。

**建议**:
- 后端添加 OpenAPI 生成 (FastAPI 原生支持 `/openapi.json`)
- 使用 `openapi-typescript` 自动生成前端类型
- 或在 `pyproject.toml` 中添加类型导出脚本

#### 11. 前端测试覆盖率缺口

- `web/` 无 `tests/` 目录
- `web/package.json` 无 `test` 脚本
- 后端测试 `tests/hermes_cli/test_web_dashboard.py` 仅覆盖少数路由

**建议**:
- 添加 `vitest` + `@testing-library/react`
- 核心组件覆盖: `App.tsx`、`ChatPage.tsx`、`ConfigPage.tsx`
- CI 中添加 `npm test` 步骤

---

### [P3] 小问题 — 可选改进

#### 12. api_server.py 中内容处理逻辑重复

`_normalize_chat_content()` 和 `_normalize_multimodal_content()` 都有扁平化 content 数组的逻辑，但实现不同。前者是通用的 text flatten，后者处理 image_url 等内容类型。

**建议**: 统一到一个函数，用 mode 参数区分。

#### 13. 魔术 URL/端口硬编码

```python
_ANTHROPIC_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
DEFAULT_PORT = 8642
```

仪表板主题名称同时在 Python (web_server.py) 和前端 (presets.ts) 中硬编码。

**建议**: 将 URL/端口移到 config.yaml；主题名称定义在共享 schema 中。

#### 14. `_truncate_token` 安全设计

```python
return f"…{s[-visible:]}"  # 最后6个字符
```

安全考量正确。建议补充文档说明为什么只显示最后6个字符（防 shoulder surfing + 验证用）。

---

## 三、架构演进方向

### 方向 1：微内核架构 (Plugin-First)

**目标**: 将当前 monolith 解耦为基于插件的运行时。

当前耦合情况:
- `run_agent.py` 直接 `import cli.py` 中的函数
- `cli.py` 导入 `run_agent.py` 中的 `AIAgent`
- `gateway/run.py` 直接调用 `run_agent.AIAgent`
- `tui_gateway` 通过 JSON-RPC 但最终也调用 `run_agent.AIAgent`

**建议架构**:

```
hermes_core/
├── kernel/
│   ├── runtime.py          # 插件加载/卸载/生命周期
│   ├── message_bus.py      # 内部事件总线 (pub/sub)
│   └── extension.py        # 扩展点定义 (SPI 接口)
├── schema/
│   ├── api_contract.py     # API 响应类型 (Pydantic models)
│   ├── config_types.py     # 配置类型定义
│   └── event_types.py      # 内部事件枚举
└── spi/
    ├── platform_adapter.py # 消息平台适配器 SPI
    ├── memory_provider.py  # 内存提供商 SPI
    ├── tool_provider.py    # 工具 SPI
    └── ui_adapter.py       # UI 适配器 SPI (CLI/TUI/Web)
```

**解耦收益**:
| 组件 | 当前 | 目标 |
|------|------|------|
| AIAgent 创建 | 3 处不同参数构造 | SPI 工厂 |
| 工具注册 | 隐式 import 时注册 | 声明式 manifest |
| 平台适配 | 继承 BasePlatformAdapter | 注册 + 路由 |
| 配置读取 | 3 种不同方式 | 统一 ConfigProvider |

### 方向 2：API 统一 + OpenAPI 规范

当前有 **3 个 HTTP 服务器** 同时运行:

| 服务器 | 框架 | 端口 | 用途 |
|--------|------|------|------|
| Dashboard | FastAPI | 9119 | 配置/会话/日志/OAuth/主题 |
| API Server | aiohttp | 8642 | OpenAI Chat/Responses/Runs |
| Gateway Health | aiohttp | 8642 同端口 | 健康检查 |

**问题**:
- 两套框架 (FastAPI + aiohttp) 维护两套中间件/错误处理/认证
- OpenAI API 和 Dashboard API 互不知晓
- 前端需要处理两个不同 origin (或代理)

**建议演进**:

```
Phase 1: FastAPI 作为统一网关
┌─────────────────────────────────────────────┐
│              FastAPI (9119)                   │
│  Routes: /api/* → Dashboard handlers         │
│  Routes: /v1/* → Proxy to aiohttp (8642)     │
│  Routes: /api/pty, /api/ws → WebSocket       │
└────────────┬────────────────────┬────────────┘
             │                    │
             ▼                    ▼
     Dashboard handlers       API Server (aiohttp)

Phase 2: 单一 FastAPI
┌─────────────────────────────────────────────┐
│              FastAPI (single port)            │
│  Routes: /api/* → native handlers            │
│  Routes: /v1/* → native handlers             │
│  Routes: /api/pty, /api/ws → WebSocket       │
│  OpenAPI spec auto-generated                 │
└─────────────────────────────────────────────┘
```

### 方向 3：WebSocket + SSE 统一传输层

当前 **5 种实时传输** 通道:

| 端点 | 方向 | 协议 | 用途 |
|------|------|------|------|
| `/api/pty` | 双向 | WS | PTY 终端字节流 |
| `/api/ws` | 双向 | WS | JSON-RPC 元数据 |
| `/api/pub` | 单向→サーバー | WS | PTY 事件发布 |
| `/api/events` | 单向→客户端 | WS | 事件订阅 |
| `/v1/chat/completions?stream=true` | 单向→客户端 | SSE | 流式响应 |

**建议统一**:

```python
# 单一 SSE 端点
GET /api/stream?session_id=<id>&events=tool,delta,session

# 事件类型:
event: message.delta
data: {"type": "delta", "content": "Hello..."}

event: tool.start
data: {"type": "tool", "name": "terminal", "status": "running"}

event: session.ended
data: {"type": "session", "id": "...", "status": "ended"}
```

### 方向 4：配置架构现代化

当前配置系统实现:
```
Config.yaml (完整文件读写)
   ├── Schema 从 DEFAULT_CONFIG 递归推导 (模块级执行在导入时)
   ├── 前端将整个 config dict 发送回 PUT /api/config
   └── save_config() 将完整 dict 写回 YAML
```

问题:
- 保存时重写整个文件（并发写冲突风险）
- 配置 schema 和配置数据分离（schema 需要手动 _SCHEMA_OVERRIDES 字典）
- 无验证层 — YAML 格式错误导致整个配置丢失

**建议演进**:

```
Phase 1: 分片配置
~/.hermes/config.d/
├── 00-general.yaml
├── 01-agent.yaml
├── 02-terminal.yaml
├── 10-providers.yaml
└── 99-user.yaml

Phase 2: Pydantic 验证
class HermesConfig(BaseModel):
    model: ProviderModel
    terminal: TerminalConfig
    agent: AgentConfig
    # ... 所有字段类型化

Phase 3: 部分更新 + 版本化
PATCH /api/config/model
{"provider": "openrouter", "model": "anthropic/claude-sonnet-4"}

# 配置快照
~/.hermes/config-snapshots/
├── 2026-05-01T10:00:00.yaml
├── 2026-05-07T01:00:00.yaml  (当前)
└── rollback 命令
```

### 方向 5：工具层现代化

当前工具系统:
- ~85 个 Python 文件在 `tools/`
- 隐式注册: 导入 `tools/*.py` → 调用 `registry.register()`
- 工具发现通过 `tools/registry.py` 的 `register()` 装饰器

**建议**:

```yaml
# tools/manifest.yaml
tools:
  - name: terminal
    description: Execute shell commands
    category: execution
    safety_level: dangerous  # ask/yolo/deny
    timeout: 300
    backends: [local, docker, ssh, modal]
    dependencies: [pexpect, docker]

  - name: web_search
    description: Search the web
    category: data
    safety_level: safe
    timeout: 30
    rate_limit: 10/min
```

**收益**:
- 工具分类+分级 → 更好的 UI 展示
- 声明式依赖 → 按需安装
- 运行时沙箱化 (WebAssembly/Deno) 选项

---

## 四、行动计划

### 短期 (1-3 个月)

| 优先级 | 任务 | 预计工量 | 影响 |
|--------|------|----------|------|
| **P0** | 拆分 web_server.py 为模块目录 | 3-5 天 | 降低维护成本 40% |
| **P0** | web/ 添加 Vitest + React Testing Library | 2-3 天 | 防止前端回归 |
| **P1** | 懒加载 @observablehq/plot + three.js | 1 天 | Bundle 缩小 ~600KB |
| **P1** | 拆分 ChatPage.tsx 为专用 hooks | 2 天 | 可测试性 + 可维护性 |
| **P1** | 添加 FastAPI 全局异常处理器 | 0.5 天 | 一致错误响应 |
| **P2** | 统一 CORS 策略到共享模块 | 1 天 | 消除配置漂移 |
| **P2** | 配置 schema 延迟初始化 | 0.5 天 | 启动速度 |
| **P3** | api_server.py 内容处理函数合并 | 1 天 | 消除重复逻辑 |

### 中期 (3-6 个月)

| 方向 | 描述 | 预计工量 | 预期收益 |
|------|------|----------|----------|
| 微内核 Phase 1 | 提取 `hermes_core` 共享类型 + SPI 接口 | 2-3 周 | 可扩展性基础 |
| API 统一 | FastAPI 统一网关 + OpenAPI 生成 | 1-2 周 | 生态兼容 + 类型安全 |
| 配置 v2 | 分片配置 + Pydantic 验证 + 部分更新 | 1-2 周 | 可靠性 + 用户体验 |
| 工具现代化 | 声明式 manifest + 分级控制 | 1 周 | 安全性 + 可用性 |
| gateway/run.py 拆分 | 提取 config_bridge + lifecycle + dispatcher | 1 周 | 可维护性 |

### 长期 (6-12 个月)

| 方向 | 描述 | 预期收益 |
|------|------|----------|
| 微内核 Phase 2 | 运行时动态加载工具/平台插件 | 零停服扩展 |
| 统一传输层 | SSE 替代 5 种 WS 通道 | 减少 ~60% 连接数 |
| WebAssembly 沙箱 | 工具在 WASM 沙箱中运行 | 安全性隔离 |
| CLI→TUI 统一 | 单一 UI 适配器 (TUI 替代 prompt_toolkit) | 统一代码基 |

---

## 五、设计模式快照

### 优良模式 (值得保留)

1. **Session Token 认证**: web_server.py 使用 ephemeral per-start token 注入 SPA HTML，避免公开的 token 发放端点
2. **Host header 验证**: DNS rebinding 防护 (GHSA-ppp5-vxwm-4cf7)
3. **OAuth PKCE 全流程**: 浏览器端 + server-side 验证器 — 安全实践
4. **PTY 桥接架构**: xterm.js ↔ WebSocket ↔ POSIX PTY 的三层架构清晰
5. **事件广播模式**: publisher↔channel↔subscriber 的 WS 事件广播设计

### 反模式 (需要改进)

1. **巨型文件**: web_server.py 4062 行, gateway/run.py 15K 行, tui_gateway/server.py 6223 行
2. **模块级副作用**: `sys.path.insert`、`CONFIG_SCHEMA = ...`、`os.environ["_HERMES_GATEWAY"] = "1"`
3. **except Exception: pass**: 全代码库约 50+ 处
4. **重复 SessionDB 创建**: 每个路由独立创建+关闭
5. **隐式工具注册**: import 时注册，难以追踪工具依赖
6. **前端无类型同步**: 手动 api.ts 接口定义

---

*报告结束*
