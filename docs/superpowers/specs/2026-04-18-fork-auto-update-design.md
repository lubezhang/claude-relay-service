# Fork 版本自动更新设计

## 背景
当前项目的 `scripts/manage.sh` 在安装与更新路径中硬编码了上游仓库地址 `https://github.com/Wei-Shaw/claude-relay-service.git`。这会导致：
- 即便用户使用的是 fork 仓库，`crs update` 仍从上游拉取
- fork 仓库无法形成独立发布与更新闭环

目标是在 `lubezhang/claude-relay-service` 上实现完整自动更新闭环：
1. 客户端更新脚本从 fork 拉取代码和前端构建产物
2. fork 仓库自己完成版本递增、打 tag、发布 release、维护 web-dist

## 目标与非目标

### 目标
- 将 `manage.sh` 内所有上游硬编码仓库 URL 统一切换到 fork URL：`https://github.com/lubezhang/claude-relay-service.git`
- 在 fork 仓库新增独立 CI 发布流水线：保留版本递增、tag、release、旧 tag 清理、前端构建与 `web-dist` 推送
- 不改变现有 `crs update` 用户交互与操作步骤

### 非目标
- 不实现动态仓库地址解析（不读取 `origin` 或 `install.conf`）
- 不改造 Docker 发布策略（本次不增加或调整镜像发布）
- 不重构管理脚本整体架构

## 方案选择

选型：**硬编码 fork URL + 新增 fork-release-pipeline**

原因：
- 用户明确要求全量替换为 fork URL
- 与现有代码风格一致，改动集中、可预测
- 快速建立 fork 仓库可用的自动更新链路

## 详细设计

### 1) 脚本更新源切换（manage.sh）

文件：`scripts/manage.sh`

把所有出现的：
- `https://github.com/Wei-Shaw/claude-relay-service.git`

替换为：
- `https://github.com/lubezhang/claude-relay-service.git`

覆盖函数与位置：
- `install_service()`：主仓库克隆 URL
- `install_service()`：下载 `web-dist` 分支时的 clone URL
- `update_service()`：下载 `web-dist` 分支时的 clone URL（含重试逻辑内）
- `switch_branch()`：下载 `web-dist` 或 `web-dist-<branch>` 时的 clone URL

预期效果：
- 新安装与更新全部指向 fork 仓库
- 前端预构建产物也从 fork 的 `web-dist` 获取

### 2) 新增 fork 发布流水线

新增文件：`.github/workflows/fork-release-pipeline.yml`

触发条件：
- `push` 到 `main`
- `workflow_dispatch`

保留能力（与现有自动发布一致）：
- 变更检测（跳过无效变更）
- 版本递增（patch）
- 更新 `VERSION` 文件并提交（含 `[skip ci]`）
- 前端构建并推送到 `web-dist`
- 生成 changelog（`git-cliff`）
- 创建并推送 tag
- 创建 GitHub Release
- 清理旧 tag/release（保留最近 50 个）

移除能力：
- Docker 镜像构建/推送
- Telegram 通知

设计说明：
- 保留核心发布链路，确保 fork 具备独立版本治理能力
- 去除与当前诉求无关的外部发布与通知，降低配置门槛

## 数据流与触发机制

### A. 代码发布路径（fork 仓库）
1. 开发者向 `main` 提交
2. `fork-release-pipeline.yml` 触发
3. 检测有效变更
4. 生成新版本并同步 `VERSION`
5. 构建前端并推送 `web-dist`
6. 创建 tag + release
7. 清理历史 tag/release

### B. 客户端更新路径（已部署实例）
1. 用户执行 `crs update`
2. `manage.sh` 执行 `git fetch origin main && git reset --hard origin/main`
3. 更新依赖（`npm install`）
4. 从 fork 仓库 `web-dist` 拉取前端构建产物
5. 自动重启服务并输出更新摘要

## 错误处理

沿用现有实现，不新增复杂分支：
- web-dist 下载失败时保留重试（3 次）与 fallback（本地构建）
- 更新前本地变更检测 + stash 备份 + 分支备份
- 网络异常时中止并保留错误提示

## 测试与验收

### 脚本层验证
- 搜索确认 `manage.sh` 中不再存在 `Wei-Shaw/claude-relay-service`
- 本地演练：安装、更新、切换分支，确认 clone URL 均为 `lubezhang/claude-relay-service`

### CI 层验证
- 手动触发 `fork-release-pipeline.yml`
- 验证产物：
  - `VERSION` 递增提交
  - 新 tag 创建成功
  - GitHub Release 创建成功
  - `web-dist` 分支更新成功
  - 超过 50 个 tag 时能自动清理最旧版本

### 回归点
- `crs install / update / switch-branch` 菜单流程不变
- 已有 update-pricing 与其他 workflow 不受影响

## 风险与缓解

- 风险：fork 仓库 Actions 权限不足导致 push/tag/release 失败
  - 缓解：仓库设置开启 `Read and write permissions`
- 风险：fork 未创建 `web-dist` 时首次更新前端失败
  - 缓解：先手动触发一次 fork 发布流水线生成 `web-dist`
- 风险：硬编码 URL 降低复用性
  - 缓解：符合当前明确需求，后续若要通用化再做配置化改造

## 实施范围

仅涉及两个文件：
- `scripts/manage.sh`
- `.github/workflows/fork-release-pipeline.yml`

不修改业务转发逻辑、鉴权逻辑与数据模型。