# 项目流程与脚本结构说明

本文档说明从进入到退出整条链路的流程，以及事件配置、连接管理、子游戏脚本分工。

---

## 1. 事件配置（GameEvents）

业务事件名统一放在 `assets/script/config/GameEvents.ts`，与框架的 `NexusEvents` 合并为 `GameEvents`，便于一处引用。

- **框架事件**：如 `NET_CONNECTED`、`NET_DISCONNECTED`、`BUNDLE_ENTER` 等（来自 NexusEvents）。
- **业务事件**：如 `GAME_JOIN_SUCCESS`、`GAME_JOIN_FAIL`、`RECONNECT_NEED_JOIN` 等。

使用方式：`import { GameEvents } from '../config/GameEvents'`，用 `GameEvents.XXX` 做监听与派发。

---

## 2. 连接与重连（ReconnectManager）

`assets/script/net/ReconnectManager.ts` 挂在**常驻节点**下，负责：

- 监听 `NET_DISCONNECTED`：显示「重连中」提示（如 `Nexus.ui.showLoading('网络异常，正在重连...')`）。
- 监听 `NET_CONNECTED`：若当前在子游戏 Bundle，则发出 `RECONNECT_NEED_JOIN`，由当前子游戏自行发本游戏的 join/rejoin。
- 监听 `GAME_JOIN_SUCCESS` / `GAME_JOIN_FAIL`：在重连状态下关闭重连 UI。

各子游戏的 join 协议和 proto 各自实现；重连时子游戏内监听 `RECONNECT_NEED_JOIN` 后发送自己的进房/重入协议，并在收到结果后派发 `GAME_JOIN_SUCCESS` 或 `GAME_JOIN_FAIL`。

---

## 3. 完整流程（进入 → Loading → 游玩 → 退出）

```
启动
  GameLauncher → Nexus.init / setRoot / Nexus.start → 解析 entryBundle

进入某 Bundle
  Nexus.bundle.enter(bundleName)
    → 显示该 Bundle 的 Loading（如 slotGameLoading）
    → 加载主场景到内存（不立刻 runScene）
    → enter() 的 Promise 挂起

Loading 阶段
  对应 XxxLoading 脚本（如 SlotGameLoading）
    → 建连 / 预加载 / 发 joinGame 等
    → 完成后调用 Nexus.bundle.hideLoading()

进场景
  hideLoading() 内
    → director.runScene(主场景)
    → 调用场景根节点上 BaseEntry 的 onEnter(params)
    → 关闭 Loading 面板

游玩
  主场景内 Entry、Session、View 等
    → 收发协议、更新 Model、刷新 UI、处理重连进房等

退出
  业务调用 Nexus.bundle.enter('lobby') 等
    → 当前场景 BaseEntry.onExit()
    → 进入目标 Bundle 的 Loading → 重复上述流程
```

---

## 4. 子游戏脚本结构建议

每个 Bundle（含大厅）建议至少具备：

| 脚本 | 位置 | 职责 |
|------|------|------|
| **XxxEntry** | 主场景根节点 | 继承 `BaseEntry`，`onEnter`/`onExit` 做本 Bundle 初始化与清理 |
| **XxxLoading** | `script/loading/` | 本 Bundle 的 Loading 面板逻辑，结束时调 `Nexus.bundle.hideLoading()` |
| **XxxSession**（可选） | `script/` 或 `script/session/` | 进房/重连时发本游戏 join，听 `RECONNECT_NEED_JOIN` |

如需更细拆分，可增加 `model/`、`view/`、`net/` 等目录。

---

## 5. View、Model、网络 数据流

- **网络层**：收包后解析，更新本游戏 Model（若有），并派发业务事件（如 `GAME_JOIN_SUCCESS`）。
- **Model**：当前游戏状态的唯一来源，只被网络结果或 Session 更新。
- **View**：响应用户操作（触发请求）、监听业务事件或 Model 变化，只做「取数 → 更新 UI」。
- **Session**：编排进房/重连与玩法请求，调用 `Nexus.net.send`，不直接改 View。

约定：用户操作 → View 触发 → Session 发请求；收包 → 更新 Model + 派发事件 → View 监听并刷新。
