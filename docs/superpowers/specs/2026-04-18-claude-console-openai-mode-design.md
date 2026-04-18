# Claude Console OpenAI 模式开关设计文档

**日期**: 2026-04-18  
**主题**: Claude Console 账户增加 OpenAI 格式转换开关

## 概述

在 Claude Console 账户中新增一个开关，当开启时进行 Claude ↔ OpenAI 格式双向转换，但继续使用 Claude Console 的 API URL 和 API Key。

## 需求背景

用户希望在不更换 API 端点和凭据的情况下，让 Claude Console 账户能够接受和返回 OpenAI 格式的请求与响应。

## 设计目标

1. **非侵入性**: 保持 Claude Console 账户所有现有功能不变
2. **默认关闭**: 开关默认为关闭状态，不影响现有用户
3. **格式双向转换**: 开启时自动进行 Claude ↔ OpenAI 格式转换
4. **复用现有配置**: 继续使用 Claude Console 的 API URL 和 API Key

## 详细设计

### 1. 数据模型扩展

#### 1.1 Claude Console 账户新增字段

在 `claudeConsoleAccountService.js` 中新增字段：

| 字段名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `useOpenaiMode` | string | `'false'` | 是否启用 OpenAI 模式开关 |

**注意**: 
- 使用字符串类型 `'true'/'false'` 与现有代码库保持一致
- 加密存储：不需要，这是布尔开关字段
- 前端展示：直接展示，无需解密

### 2. 格式转换服务

#### 2.1 现有服务复用

- **请求转换**: 复用 `openaiToClaude.js` 的反向逻辑（Claude → OpenAI）
- **响应转换**: 复用 `openaiToClaude.js` 的现有逻辑（OpenAI → Claude）

#### 2.2 转换流程

```
客户端 (OpenAI 格式)
    ↓
[开关开启?] → 否 → 原生 Claude Console 流程
    ↓ 是
转换: OpenAI 请求 → Claude 格式
    ↓
调用 Claude Console API (使用原有 URL 和 Key)
    ↓
转换: Claude 响应 → OpenAI 格式
    ↓
返回客户端 (OpenAI 格式)
```

### 3. 转发服务修改

#### 3.1 修改 `claudeConsoleRelayService.js`

在 `relayStreamRequestWithUsageCapture` 和 `relayRequest` 方法开头添加开关检查逻辑：

```javascript
async relayRequest(request, apiKeyData, req, res, accountHeaders, accountId) {
  // 获取账户信息，检查开关
  const account = await claudeConsoleAccountService.getAccount(accountId)
  
  // 如果启用了 OpenAI 模式，进行格式转换
  if (account && account.useOpenaiMode === 'true') {
    return this.relayRequestWithOpenaiMode(request, apiKeyData, req, res, accountHeaders, accountId)
  }
  
  // 原有逻辑继续...
}
```

#### 3.2 新增 OpenAI 模式处理方法

新增两个方法：
- `relayRequestWithOpenaiMode()` - 处理非流式请求
- `relayStreamRequestWithOpenaiMode()` - 处理流式请求

### 4. 路由层修改

#### 4.1 路由选择逻辑

在相关路由中（如 `api.js`, `openaiClaudeRoutes.js`），不需要修改路由逻辑，因为：
- 开关在账户层面控制
- 路由层仍然接收 Claude 格式请求
- 格式转换在转发服务内部完成

### 5. 管理后台界面

#### 5.1 Claude Console 账户编辑页

在前端 `web/admin-spa/` 中找到 Claude Console 账户编辑组件，添加：

**开关组件**:
- 标签: "启用 OpenAI 格式模式"
- 类型: Switch 开关
- 默认: 关闭
- 帮助提示: "开启后，此账户将进行 Claude ↔ OpenAI 格式双向转换"

#### 5.2 账户列表展示

在账户列表中可选择性展示该开关状态（如徽章或图标）。

### 6. 数据迁移

#### 6.1 现有账户

现有 Claude Console 账户无需迁移，新字段默认值为 `'false'`。

#### 6.2 Redis 哈希字段自动新增

由于使用 Redis Hash 存储，新字段会在第一次更新账户时自动添加。

## API 行为示例

### 开关关闭时（默认）

```javascript
// 请求: Claude 格式
POST /v1/messages
{
  "model": "claude-3-opus",
  "messages": [{"role": "user", "content": "Hello"}]
}

// 响应: Claude 格式
{
  "content": [{"type": "text", "text": "Hi there!"}],
  "stop_reason": "end_turn"
}
```

### 开关开启时

```javascript
// 请求: OpenAI 格式
POST /v1/chat/completions
{
  "model": "gpt-4",
  "messages": [{"role": "user", "content": "Hello"}]
}

// 内部转换为 Claude 格式调用 API
// 然后转换响应为 OpenAI 格式返回

// 响应: OpenAI 格式
{
  "choices": [{
    "message": {"role": "assistant", "content": "Hi there!"},
    "finish_reason": "stop"
  }]
}
```

## 实现清单

### 后端

- [ ] 在 `claudeConsoleAccountService.js` 中新增 `useOpenaiMode` 字段
- [ ] 在 `claudeConsoleRelayService.js` 中添加开关检查逻辑
- [ ] 新增 `relayRequestWithOpenaiMode()` 方法
- [ ] 新增 `relayStreamRequestWithOpenaiMode()` 方法
- [ ] 复用/扩展 `openaiToClaude.js` 支持双向转换
- [ ] 更新管理后台路由（如需要）

### 前端

- [ ] 在 Claude Console 账户编辑页添加开关组件
- [ ] 更新账户列表展示（可选）

### 测试

- [ ] 测试开关关闭时的原有功能正常
- [ ] 测试开关开启时的格式转换正常
- [ ] 测试流式响应
- [ ] 测试非流式响应

## 风险与注意事项

1. **功能完整性**: 确保格式转换覆盖所有功能（tool use, 多模态等）
2. **性能影响**: 格式转换带来的轻微性能损耗可接受
3. **错误处理**: 转换过程中的错误需要清晰的错误信息
4. **向后兼容**: 确保现有账户不受影响

## 相关文件

- `src/services/account/claudeConsoleAccountService.js`
- `src/services/relay/claudeConsoleRelayService.js`
- `src/services/openaiToClaude.js`
- `src/routes/admin/claudeConsoleAccounts.js`
- `web/admin-spa/src/views/accounts/ClaudeConsoleAccountEdit.vue` (假设路径)
