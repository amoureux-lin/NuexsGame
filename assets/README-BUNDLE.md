# Nexus 多 Bundle 与启动配置说明

## 1. 目录结构

```
assets/
├── script/
│   └── GameLauncher.ts     # 首场景启动脚本，注册框架并进入 lobby
├── common/                 # 公共 Bundle（字体、公共音效等）
├── lobby/                  # 大厅 Bundle
│   ├── Main.scene          # 大厅入口场景（框架约定名称）
│   └── script/
│       └── LobbyEntry.ts   # 大厅入口逻辑，继承 BaseEntry
├── games/
│   └── slotGame/           # 子游戏 Bundle（示例）
└── lunch.scene             # 游戏首场景（仅负责跑 GameLauncher）
```

## 2. 在 Cocos Creator 中配置 Bundle

1. 打开 **项目 → 项目设置 → Bundle 管理器**。
2. 添加以下 Bundle（名称与 `GameLauncher` 里 `NexusConfig.bundles` 一致）：
   - **common** → 目录选择 `assets/common`，可勾选「预加载」。
   - **lobby** → 目录选择 `assets/lobby`。
   - **slotGame** → 目录选择 `assets/games/slotGame`。

## 3. 启动流程

1. **构建设置**：将 `lunch.scene` 设为首场景（放在构建列表第一位）。
2. **lunch 场景**：
   - 在 **Canvas** 节点上添加组件 **GameLauncher**（可先去掉 LunchComponent）。
   - 将 **Canvas** 节点拖到 GameLauncher 的 **Canvas Root** 属性（作为 UI 根节点）。
3. **lobby/Main 场景**：
   - 在**场景根节点**上添加组件 **LobbyEntry**，这样进入大厅 Bundle 时框架会调用 `onEnter`。

## 4. 纯子游戏模式（无大厅）

若不需要大厅，在 `GameLauncher.ts` 中改为：

```ts
entryBundle: 'slotGame',
enableLobby: false,
// bundles 里保留 common 与 slotGame 即可
```

首屏将直接进入子游戏 Bundle。

## 5. 更多说明

- **完整流程与脚本结构**（进入 → Loading → 游玩 → 退出、事件配置、连接重连、View-Model-网络）：见 [README-FLOW.md](./README-FLOW.md)。
