# Nexus Framework & Game Layer 问题追踪

> 创建日期：2026-04-03
> 最后更新：2026-04-03

状态说明：`[ ]` 未修复 | `[x]` 已修复 | `[-]` 不修复/暂缓

---

## 一、严重 Bug

### 1.1 WS 并发连接无保护
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/WsServiceImpl.ts`
- **描述**：多次调用 `connectWs()` 会创建多个 WebSocket 实例，缺少连接中保护
- **影响**：内存泄漏、包发到错误连接
- **修复方案**：添加 `_connectingPromise` 标记，重复调用返回已有 Promise；连接前先关闭旧连接

### 1.2 WS 服务端错误未传播
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/net/WsDelegate.ts:128`
- **描述**：`return new Error(...)` 被注释掉，服务端错误码只弹窗不拒绝 Promise，业务逻辑无法感知失败
- **影响**：请求 Promise 以"成功"状态 resolve，业务逻辑继续执行导致状态不一致
- **修复方案**：取消注释 `return new Error(...)`

### 1.3 isLocal() 硬编码 true
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/net/ConnectManager.ts`
- **描述**：永远走本地测试 token 流程，生产环境无法正常获取 token
- **修复方案**：改为 `Nexus.config?.debug ?? false`

### 1.4 show/hide 动画期间的竞态问题
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/UIServiceImpl.ts`
- **描述**：show 动画期间 hide 被 `animating` 挡住直接 return，面板无法关闭；hide 动画期间 show 同理
- **影响**：弹窗关不掉或打不开
- **修复方案**：改为状态机 `animState: 'idle' | 'showing' | 'hiding'`，支持 `pendingShow` / `pendingHide` 队列

---

## 二、缺失的错误处理

### 2.1 TongitsController wsRequest 无 try/catch
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/games/tongits/script/game/TongitsController.ts`
- **描述**：所有 wsRequest 调用无错误处理，网络超时或失败后 UI 无反馈
- **修复方案**：提取 `safeRequest()` 统一 try/catch

### 2.2 joinRoom 无错误处理
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/games/tongits/script/TongitsEntry.ts`
- **描述**：joinRoom 失败后仍播放音乐，无用户提示
- **修复方案**：try/catch 包裹，失败时向上抛出错误

### 2.3 requestConfig 失败无重试
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/net/ConnectManager.ts`
- **描述**：配置请求失败只 console.log，无重试和用户提示
- **修复方案**：添加最多 3 次重试 + 2s 延迟

### 2.4 Bundle 切换失败无恢复
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/BundleServiceImpl.ts`
- **描述**：`loadAndAttachEntryPrefab()` 未 try/catch，失败后框架无 Bundle 可用
- **修复方案**：try/catch + 回退状态 + notifyBundleExit

### 2.5 HTTP post 不支持自定义 timeout
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/HttpServiceImpl.ts` + `contracts.ts`
- **描述**：`get()` 支持 options.timeout，`post()` 不支持，API 不一致
- **修复方案**：post 签名添加 options 参数

---

## 三、竞态 & 异步问题

### 3.1 SlotGame spin 无防连点
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/games/slotGame/script/game/SlotGameController.ts`
- **描述**：快速双击 spin 会发两次请求
- **修复方案**：添加 `_spinning` 标记

### 3.2 BaseLoading 网络连接 Promise 竞态
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/base/BaseLoading.ts`
- **描述**：NET_CONNECTED 事件可能在监听注册前已触发，导致 Promise 永远挂起
- **修复方案**：`waitNetConnected()` 创建 Promise 后再次检查连接状态

### 3.3 BaseLoading Promise 初始化逻辑错误
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/base/BaseLoading.ts:289`
- **描述**：`_netConnectedPromise` 赋值逻辑有误，三元表达式结果不正确
- **修复方案**：重写为正确的 `new Promise` + resolver 模式

---

## 四、内存泄漏风险

### 4.1 maskPrefab 缓存永不释放
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/UIServiceImpl.ts`
- **描述**：`_maskPrefab` 加载后缓存，`onDestroy()` 未释放资源
- **修复方案**：`onDestroy` 中调用 `decRef()` 释放

### 4.2 AudioClip 从不释放
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/AudioServiceImpl.ts`
- **描述**：播放过的 AudioClip 全部留在内存，无清理
- **修复方案**：添加 `_clipCache` + `addRef/decRef`，`onBundleExit` 释放该 Bundle 的 clip，`onDestroy` 释放全部

### 4.3 WS requestId 无上限递增
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/WsServiceImpl.ts`
- **描述**：`_nextRequestId` 无限递增，极端情况下精度丢失
- **修复方案**：循环计数 `(this._nextRequestId % 0x7FFFFFFF) + 1`

### 4.4 EventService 无监听器数量警告
- **状态**：`[x]` (2026-04-03)
- **位置**：`extensions/nexus-framework/assets/impl/EventServiceImpl.ts`
- **描述**：忘记 off 会累积大量回调，无上限警告
- **修复方案**：debug 模式下当单事件监听器 >100 时打印警告

---

## 五、框架缺失功能

### 5.1 UI prefab 预加载
- **状态**：`[ ]`
- **优先级**：高
- **描述**：当前每个面板首次 show 才加载 prefab，应支持 `preloadPanels(names[])` 批量预热
- **位置**：`UIServiceImpl` / `IUIService`

### 5.2 HTTP/WS 请求重试
- **状态**：`[x]` (2026-04-03)
- **优先级**：高
- **描述**：弱网环境请求失败率高，应支持配置重试次数和退避策略
- **位置**：`HttpServiceImpl` / `WsServiceImpl` / `contracts.ts`
- **实现**：HTTP 通过 `HttpOptions.retry` + `retryDelay` 配置；WS 通过 `WsConfig.requestRetry` + `requestRetryDelay` 配置。均采用指数退避，仅对网络错误/超时重试，业务错误不重试

### 5.3 请求取消支持
- **状态**：`[ ]`
- **优先级**：高
- **描述**：页面关闭后请求仍在执行，HTTP 应支持 AbortController，WS 应支持取消 pending
- **位置**：`HttpServiceImpl` / `WsServiceImpl`

### 5.4 Bundle 循环依赖检测
- **状态**：`[ ]`
- **优先级**：中
- **描述**：A enter B，B enter A 会无限递归
- **位置**：`BundleServiceImpl`

### 5.5 Asset 引用计数
- **状态**：`[ ]`
- **优先级**：中
- **描述**：多个 Bundle 共用同一资源，一方释放后另一方会崩
- **位置**：`AssetServiceImpl`

### 5.6 事件类型安全
- **状态**：`[ ]`
- **优先级**：中
- **描述**：`on<T>` 和 `emit<T>` 的泛型不强制一致，可以 emit 错误类型不报错
- **位置**：`EventServiceImpl` / `contracts.ts`

### 5.7 日志系统分级
- **状态**：`[ ]`
- **优先级**：中
- **描述**：框架内大量 `console.log`，应统一走 logger 并支持按级别关闭
- **位置**：`utils/logger.ts` 需完善

### 5.8 ECS System 优先级
- **状态**：`[ ]`
- **优先级**：低
- **描述**：当前按注册顺序执行，无法声明依赖关系或优先级
- **位置**：`patterns/ecs/World.ts`

### 5.9 Observable 自动清理
- **状态**：`[ ]`
- **优先级**：低
- **描述**：忘记 `dispose()` 会泄漏 observer 回调
- **位置**：`patterns/mvvm/Observable.ts`

---

## 六、生产就绪问题

### 6.1 debug 模式硬编码
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/GameLauncher.ts`
- **描述**：`debug: true` 硬编码，生产环境也会输出调试日志
- **修复方案**：根据 `sys.isBrowser` + `location.hostname` 自动判断

### 6.2 服务器地址硬编码
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/script/net/ConnectManager.ts`
- **描述**：`setBaseUrl("https://gwm.herondev.xin")` 硬编码开发环境地址
- **修复方案**：根据 debug 配置选择 DEBUG/PROD 地址常量

### 6.3 SlotGame 纯 Mock 实现
- **状态**：`[-]` 暂缓（需接入真实服务端）
- **位置**：`assets/games/slotGame/script/`
- **描述**：余额、spin 结果、房间加入全部是假数据
- **修复方案**：接入真实服务端接口

### 6.4 TongitsEntry 音乐路径拼写错误
- **状态**：`[x]` (2026-04-03)
- **位置**：`assets/games/tongits/script/TongitsEntry.ts`
- **描述**：`Tongtis_bg` 已修正为 `Tongits_bg`
