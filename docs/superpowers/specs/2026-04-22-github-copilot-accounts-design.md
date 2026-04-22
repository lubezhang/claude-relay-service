# GitHub Copilot 账户接入设计说明

## 背景

当前仓库已经具备成熟的多平台账户管理能力，后端采用“`admin route + account service + redis 持久化 + 调度器 + relay`”的结构，前端管理台也已经支持多类账户的添加、授权、编辑、测试、启停、分组和 API Key 绑定。

本次需求是在现有“添加账户”能力基础上，新增一个独立平台类型 `github-copilot`：

- 在账户管理中新增 `GitHub Copilot`
- 集成 GitHub Copilot 认证流程
- 支持在 API Key 中独立绑定 Copilot 账户或 Copilot 账户组
- 对外仍通过现有 OpenAI 兼容接口使用

参考项目 `/Users/zhangqh/develop/project/copilot-api` 已经验证了 GitHub Device Flow、GitHub token 换取 Copilot token、Copilot `/models` 和 `/chat/completions` 调用链。本设计吸收其认证与上游访问方式，但保持当前仓库既有模块边界和数据模式，不直接搬运参考项目目录结构。

## 目标

- 在账户管理中新增独立平台 `github-copilot`
- 支持设备码授权，并保留必要的手动导入能力
- 支持账户的新增、列表、编辑、删除、启停、测试、调度开关
- 支持 API Key 绑定单个 Copilot 账户或 Copilot 分组
- 通过现有 OpenAI 兼容入口提供 `chat/completions` 和 `models`
- 在请求明细、账户展示、分组和缓存中明确区分 `github-copilot` 与 `openai`

## 非目标

首版不包含以下内容：

- 不实现 `embeddings`
- 不实现完整 Copilot usage 展示与统计面板
- 不实现企业版、business、enterprise 差异化策略
- 不改造现有 permissions 体系为新的顶级权限类型；首版仍归入 `openai` 权限类别
- 不替换现有 OpenAI 或 Droid 的调用链，只增加 Copilot 分支

## 方案选择

本需求存在三种可选方向：

### 方案 A：伪装为 OpenAI 账户

把 Copilot 账户存入现有 `openai` 账户体系，并直接复用 `openaiAccountService` 和 `unifiedOpenAIScheduler`。

优点：

- 改动最少
- 接入速度最快

缺点：

- 平台语义错误，后台无法准确区分 OpenAI 与 Copilot
- API Key 绑定、请求明细、账户分组、测试与错误恢复都会混杂
- 后续增加 Copilot 专属能力时改造成本更高

### 方案 B：独立平台，复用 OpenAI 兼容入口

新增 `github-copilot` 账户平台，但对外继续走现有 OpenAI 兼容路由，只在账户选择、token 获取、上游转发位置分流到 Copilot 专属逻辑。

优点：

- 平台边界清晰
- 改动量可控
- 保留现有对外接口与客户端兼容性
- 后续易于扩展 Copilot 专属能力

缺点：

- 需要补齐一套 Copilot 账户服务、调度器和 relay

### 方案 C：独立平台，独立外部路由

新增完整的 Copilot 独立外部 API 体系，与 OpenAI 兼容入口并列存在。

优点：

- 边界最清晰

缺点：

- 首版成本高
- 和现有 OpenAI 兼容入口重复建设
- 不符合“尽量复用现有添加账户和调用能力”的目标

### 结论

采用方案 B。

即：`github-copilot` 作为独立平台接入账户管理、分组、API Key 绑定、请求明细和调度体系，但对外继续通过当前 OpenAI 兼容接口暴露 `chat/completions` 与 `models`。

## 总体架构

新增 GitHub Copilot 平台后，整体结构如下：

1. 管理台通过新的 `admin/github-copilot-accounts` 接口完成设备码授权与账户 CRUD。
2. 账户数据由 `githubCopilotAccountService` 持久化到 Redis，敏感字段统一加密。
3. API Key 新增独立字段 `githubCopilotAccountId`，支持空值、单账户、`group:<id>` 三种绑定形式。
4. 新增 `githubCopilotScheduler` 负责共享池、单账户、分组三类调度。
5. 在现有 OpenAI 兼容入口中增加 Copilot 分流逻辑；命中 Copilot 账户时改走 `githubCopilotRelayService`。
6. 请求明细、账户名缓存、账户组、管理台列表都将 `github-copilot` 视为独立平台。

## 模块设计

### 1. 后端管理路由

新增文件：

- `src/routes/admin/githubCopilotAccounts.js`

职责：

- 生成设备码授权信息
- 轮询授权结果并交换 token
- 创建、查询、更新、删除 Copilot 账户
- 切换启用状态
- 切换调度状态
- 重置状态
- 测试账户可用性

建议新增的路由如下：

- `GET /admin/github-copilot-accounts`
- `POST /admin/github-copilot-accounts`
- `PUT /admin/github-copilot-accounts/:id`
- `DELETE /admin/github-copilot-accounts/:id`
- `PUT /admin/github-copilot-accounts/:id/toggle-schedulable`
- `POST /admin/github-copilot-accounts/:id/reset-status`
- `POST /admin/github-copilot-accounts/:accountId/test`
- `POST /admin/github-copilot-accounts/generate-auth-url`
- `POST /admin/github-copilot-accounts/exchange-code`

接口风格对齐现有 `droid`、`openai`、`gemini` 平台，不单独创造新的响应协议。

### 2. 账户服务

新增文件：

- `src/services/account/githubCopilotAccountService.js`

职责：

- 管理账户的创建、更新、删除、查询、列表
- 加解密 `githubToken` 与 `copilotToken`
- 调用 GitHub Device Flow 接口
- 使用 GitHub token 获取或刷新 Copilot token
- 查询当前账户的 Copilot models
- 提供账户测试能力
- 统一处理 Copilot 上游请求头和 token 生命周期

建议暴露的核心方法：

- `createAccount(accountData)`
- `updateAccount(accountId, updates)`
- `deleteAccount(accountId)`
- `getAccount(accountId)`
- `getAllAccounts()`
- `isCopilotTokenExpired(account)`
- `refreshCopilotToken(accountId)`
- `getValidCopilotToken(accountId)`
- `fetchModels(accountId, options)`
- `testAccount(accountId)`
- `markRateLimited(accountId, data)`
- `clearRateLimit(accountId)`

### 3. Redis 持久化

需要在 `src/models/redis.js` 中新增 Copilot 账户相关接口，模式对齐现有其他账户：

- `setGithubCopilotAccount(accountId, data)`
- `getGithubCopilotAccount(accountId)`
- `deleteGithubCopilotAccount(accountId)`
- `getAllGithubCopilotAccounts()`

推荐 Redis key 前缀：

- `github_copilot_account:${accountId}`
- `github_copilot_accounts`

OAuth 会话继续复用现有：

- `oauth:${sessionId}`

不单独创建新的 OAuth session 存储体系。

## 认证设计

### 设备码授权流程

首版采用 GitHub Device Flow，对齐参考项目 `copilot-api`，同时复用当前仓库已有的 OAuth session 存储方式。

流程如下：

1. 管理台调用 `POST /admin/github-copilot-accounts/generate-auth-url`
2. 服务端请求 GitHub Device Flow 接口，获取：
   - `device_code`
   - `user_code`
   - `verification_uri`
   - `verification_uri_complete`
   - `expires_in`
   - `interval`
3. 服务端生成 `sessionId`，将上述信息及代理配置写入 `oauth:${sessionId}`
4. 前端展示 `user_code`、授权地址和操作说明
5. 管理员在 GitHub 页面完成授权
6. 前端点击“完成授权”，调用 `POST /admin/github-copilot-accounts/exchange-code`
7. 服务端使用 `device_code` 轮询获取 GitHub token
8. 服务端使用 GitHub token 获取 Copilot token
9. 服务端返回结构化 token 与账户信息，供账户创建使用

### 手动导入能力

首版保留最小手动导入能力，用于非交互或已有凭证的场景。

支持以下两类输入：

- GitHub token
- 可选的 Copilot token

处理规则：

- 若只提供 GitHub token，则服务端在创建账户时尝试换取 Copilot token
- 若同时提供 GitHub token 和 Copilot token，则按统一结构落库
- 若只提供 Copilot token，不支持创建账户，因为后续无法自动刷新

### OAuth session 数据

写入 `oauth:${sessionId}` 的字段建议如下：

- `platform: 'github-copilot'`
- `deviceCode`
- `userCode`
- `verificationUri`
- `verificationUriComplete`
- `interval`
- `proxy`
- `createdAt`
- `expiresAt`

### 认证错误处理

`exchange-code` 接口需要区分以下状态：

- `authorization_pending`
- `slow_down`
- `expired_token`
- `access_denied`
- 其他未知错误

其中：

- `authorization_pending` 与 `slow_down` 返回 `success: false, pending: true`
- `expired_token` 删除 OAuth session，并提示重新生成设备码
- 其他错误保留原始 message，用于前端展示

## 账户数据模型

首版保留必要字段，避免引入过多与业务无关的配置。

建议账户结构如下：

```js
{
  id,
  name,
  platform: 'github-copilot',
  accountType, // shared / dedicated / group
  isActive,
  schedulable,
  status,
  lastError,

  githubToken, // encrypted
  copilotToken, // encrypted
  copilotTokenExpiresAt,

  githubUserId,
  githubLogin,
  githubEmail,
  githubName,
  copilotPlan,

  proxy,
  supportedModels,
  lastModelsSyncAt,
  lastUsedAt,
  createdAt,
  updatedAt
}
```

约束如下：

- `platform` 固定为 `github-copilot`
- `githubToken` 与 `copilotToken` 必须加密存储
- `supportedModels` 允许为空，首次测试或首次请求时填充
- `status` 兼容现有平台的状态语义，如 `active`、`error`、`unauthorized`

## API Key 与账户组设计

### API Key 绑定

在 API Key 数据结构中新增字段：

- `githubCopilotAccountId`

行为与现有平台一致：

- 空值：共享池
- 普通账户 ID：单账户绑定
- `group:<id>`：绑定 Copilot 分组

需要同步修改：

- `src/services/apiKeyService.js`
- `src/routes/admin/apiKeys.js`
- `src/services/accountNameCacheService.js`
- API Key 创建、编辑、批量编辑前端组件
- API Key 列表与详情页中的绑定展示

### 账户组

在账户组系统中新增平台支持：

- `github-copilot`

需要修改：

- `src/services/accountGroupService.js` 的平台白名单
- 分组成员读取逻辑
- 账户组页面的平台可选项
- 删除账户时的分组引用检查

## 权限设计

当前系统的 permissions 顶级分类为：

- `claude`
- `gemini`
- `openai`
- `droid`

首版不新增 `github-copilot` 顶级权限，而是归入 `openai` 类别。

原因：

- Copilot 对外提供 OpenAI 兼容请求能力
- 可显著降低首版对权限系统、前端权限配置与校验逻辑的改动范围
- 不影响账户层面和请求明细层面对 `github-copilot` 的独立展示

这意味着：

- 请求权限校验仍通过 `openai` 权限
- 账户绑定、调度、明细、列表展示中仍使用真实类型 `github-copilot`

## 调度设计

新增文件：

- `src/services/scheduler/githubCopilotScheduler.js`

不把 Copilot 直接并入 `unifiedOpenAIScheduler`，避免把 OpenAI 与 Copilot 的平台行为耦合在同一个调度器内。

职责如下：

- 根据 API Key 的 `githubCopilotAccountId` 选择账户
- 支持共享池、单账户、分组三种选择方式
- 过滤不可用账户：
  - `isActive !== true`
  - `schedulable !== true`
  - `status === 'error'`
  - `status === 'unauthorized'`
  - rate limited
  - temporary unavailable
- 支持按优先级和最近使用时间进行排序
- 返回统一结果：

```js
{
  accountId,
  accountType: 'github-copilot'
}
```

### 调度策略

1. 若 API Key 显式绑定单账户，则优先使用该账户；不可用时直接报错，不降级到共享池。
2. 若 API Key 绑定分组，则从分组内筛选可用账户并按优先级选择。
3. 若 API Key 未绑定账户，则从 Copilot 共享池中选择可用账户。
4. 若指定了请求模型，则优先过滤不支持该模型的账户。

## 对外请求设计

### 路由复用策略

首版继续复用现有 OpenAI 兼容入口，不新增独立的外部 Copilot API 前缀。

涉及接口：

- `POST /v1/chat/completions`
- `GET /v1/models`

在入口层增加 Copilot 分流：

- 如果请求命中的是 `github-copilot` 账户，则交给 Copilot relay
- 否则继续原有 OpenAI 路径

这样客户端无需改造，只需绑定正确的 Copilot 账户即可使用。

### Relay 设计

新增文件：

- `src/services/relay/githubCopilotRelayService.js`

职责：

- 获取有效的 Copilot token
- 组装 Copilot 上游请求头
- 将当前 OpenAI 兼容请求转发到 Copilot 上游
- 处理流式与非流式响应
- 统一转换错误、usage、model、header 等信息

建议最小能力：

- `relayChatCompletions(req, res, context)`
- `relayModels(req, res, context)`

其中 `context` 至少包含：

- `account`
- `apiKey`
- `requestedModel`
- `sessionId`

### 上游接口

首版使用参考项目已验证的 Copilot 相关接口：

- GitHub 获取 Copilot token
- Copilot `/models`
- Copilot `/chat/completions`

不在首版接入 `/embeddings`。

## 模型设计

### 模型来源

模型列表采用“动态拉取 + 轻量回退”的策略：

1. 优先调用 Copilot `/models`
2. 成功后缓存到账户 `supportedModels`
3. 若上游短暂失败，则回退到最近缓存
4. 若还没有缓存，则回退到一组最小默认模型集合

默认模型集仅用于首版兜底，避免账户在上游短时波动时完全不可用。

### 模型校验

调度和转发时：

- 若账户配置了 `supportedModels` 且请求模型不在其中，直接返回模型不可用错误
- 若账户没有模型缓存，则允许先发请求，由上游真实返回为准

## 错误与状态设计

### 账户状态

Copilot 账户首版使用以下主要状态：

- `active`
- `unauthorized`
- `error`
- `rateLimited`

### 错误分类

需要统一处理以下错误类型：

- GitHub token 失效：标记 `unauthorized`
- Copilot token 刷新失败：标记 `unauthorized` 或 `error`
- 上游限流：标记 `rateLimited`
- 上游 5xx / 网络故障：进入 temporary unavailable 体系
- 模型不支持：直接返回请求错误，不污染账户状态

### Token 生命周期

- `githubToken` 视为长期凭证
- `copilotToken` 视为短期凭证
- 每次请求前检查 `copilotTokenExpiresAt`
- 若快过期或已过期，则使用 `githubToken` 刷新
- 刷新失败时才把账户标为异常，而不是在 token 过期瞬间直接不可用

## 前端设计

### 账户管理视图

需要修改：

- `web/admin-spa/src/views/AccountsView.vue`
- `web/admin-spa/src/stores/accounts.js`
- `web/admin-spa/src/utils/http_apis.js`

目标：

- 新增 GitHub Copilot 平台展示
- 支持加载 Copilot 账户列表
- 支持编辑、删除、测试、重置状态、切换调度状态

### 添加账户表单

需要修改：

- `web/admin-spa/src/components/accounts/AccountForm.vue`
- `web/admin-spa/src/components/accounts/OAuthFlow.vue`

目标：

- 在“添加账户”中新增 `GitHub Copilot` 平台选项
- 在认证步骤中增加设备码流程分支
- 展示：
  - `user_code`
  - `verification_uri`
  - `verification_uri_complete`
  - `完成授权` 按钮
- 保留必要的名称、代理、账户类型配置

### API Key 绑定界面

需要修改：

- `web/admin-spa/src/components/apikeys/CreateApiKeyModal.vue`
- `web/admin-spa/src/components/apikeys/EditApiKeyModal.vue`
- `web/admin-spa/src/components/apikeys/BatchEditApiKeyModal.vue`
- `web/admin-spa/src/views/ApiKeysView.vue`

目标：

- 支持选择 `githubCopilotAccountId`
- 支持共享池、单账户、分组三种绑定方式
- 在列表中展示 Copilot 专属绑定信息

## 请求明细与展示设计

请求明细、账户名缓存和后台展示必须把 Copilot 识别为独立平台。

需要修改：

- `src/services/requestDetailService.js`
- `src/services/accountNameCacheService.js`
- 相关请求明细页面展示逻辑

要求：

- `accountType` 记录为 `github-copilot`
- 展示名称使用“GitHub Copilot”
- 搜索绑定账户时能命中 Copilot 账户和 Copilot 分组

## 兼容性要求

### 与现有 OpenAI 路由兼容

- 不破坏现有 OpenAI 与 OpenAI Responses 账户的调度逻辑
- Copilot 分流只在明确命中 Copilot 账户时生效

### 与现有 API Key 兼容

- 原有 API Key 数据保持不变
- 新字段 `githubCopilotAccountId` 默认为空字符串

### 与现有前端兼容

- 保持现有多平台账户 UI 结构
- 新平台遵循相同的交互模式，不增加额外学习成本

## 测试设计

首版至少补齐以下测试：

### 后端测试

- 设备码授权接口：
  - `generate-auth-url` 返回正确 session 数据
  - `exchange-code` 正确处理 pending、expired、success
- 账户服务：
  - 创建账户时加密敏感字段
  - 获取账户时正确脱敏
  - token 过期时触发刷新
- 调度器：
  - 单账户绑定
  - 分组绑定
  - 共享池选择
  - 跳过不可用账户
- 路由分流：
  - API Key 绑定 Copilot 账户时正确走 Copilot relay
  - 未绑定 Copilot 时不影响原有 OpenAI 路由

### 前端验证

至少完成手工验证：

- 添加 Copilot 账户
- 完成设备码授权
- 账户列表正确显示
- API Key 绑定 Copilot 账户
- 绑定后的请求实际走 Copilot 账户

## 风险与控制

### 风险 1：Copilot token 生命周期短且上游不稳定

控制：

- 请求前自动刷新
- 失败时区分 unauthorized 与 temporary unavailable
- 缓存最近模型列表，避免模型接口短暂异常导致整个平台不可用

### 风险 2：与 OpenAI 路由耦合过深

控制：

- 调度器和 relay 独立
- 只在路由入口增加小范围分流逻辑

### 风险 3：前端与 API Key 绑定点位较多

控制：

- 复用现有“每平台一个绑定字段”的模式
- 不引入跨平台统一绑定抽象，避免首版改动过大

## 实施边界

首版交付完成的判定标准如下：

- 管理台能新增 `GitHub Copilot` 账户
- 能通过设备码完成授权并保存账户
- API Key 能绑定 Copilot 账户或 Copilot 分组
- 绑定后的 API Key 能通过现有 OpenAI 兼容接口访问 Copilot 的 `chat/completions`
- `models` 可用
- 请求明细和后台展示中能明确看到 `github-copilot`

未包含的能力保留到后续迭代：

- `embeddings`
- 使用量图表与面板
- 企业版差异配置
- 更细粒度权限分类
