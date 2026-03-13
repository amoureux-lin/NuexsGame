# Nexus Framework

> CocosCreator 3.8 全能游戏框架 · Extension 驱动 · 多 Bundle 架构

---

## 目录

1. [框架概览](#1-框架概览)
2. [核心设计理念](#2-核心设计理念)
3. [目录结构](#3-目录结构)
4. [代码架构四层模型](#4-代码架构四层模型)
5. [服务模块详解](#5-服务模块详解)
6. [多 Bundle 架构](#6-多-bundle-架构)
7. [子游戏开发模式](#7-子游戏开发模式)
8. [Extension 工作机制](#8-extension-工作机制)
9. [快速开始](#9-快速开始)
10. [API 速查](#10-api-速查)

---

## 1. 框架概览

### 1.1 是什么

**Nexus** 是一个基于 CocosCreator 3.8 的全能游戏开发框架，以 **Editor Extension** 的形式交付。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **Extension 驱动** | 框架母本在 Extension 内，一键同步到项目 |
| **统一入口** | 全局只有 `Nexus` 一个对象，链式调用无负担 |
| **多 Bundle** | 支持大厅 + 多子游戏，也支持纯子游戏独立运行 |
| **多开发模式** | 子游戏可按需选择 MVC / MVVM / ECS / Component |
| **Service 化** | 所有功能模块均为可替换的 Service，接口与实现分离 |
| **生命周期托管** | ServiceRegistry 统一管理启动/销毁顺序 |
| **TypeScript 优先** | 完整类型推导，IDE 自动补全 |

### 1.3 支持的运行模式

```
模式一：大厅 + 多子游戏
  └── lobby (Bundle)
       ├── slotGame (Bundle) ← MVC
       ├── rpgGame  (Bundle) ← ECS
       └── cardGame (Bundle) ← MVVM

模式二：纯子游戏（无大厅）
  └── slotGame (Bundle) ← 直接启动
```

---

## 2. 核心设计理念

### 2.1 Service Locator + Facade 模式

Nexus 采用 **Service Locator + Facade** 组合模式，而非纯单例：

```
❌ 纯单例：UIManager.getInstance().show(...)   —— 冗长，无统一入口
❌ IoC/DI：@inject('ui') private ui           —— 过重，游戏场景不适合
✅ Nexus  ：Nexus.ui.show(...)                 —— 简洁，类型安全
```

### 2.2 设计原则

- **单一入口**：游戏代码只接触 `Nexus`，不直接 `import` 任何 Manager
- **接口隔离**：每个服务对外暴露 `abstract class` 接口，内部实现可替换
- **顺序启动**：`ServiceRegistry` 按注册顺序 boot，逆序 destroy，自动处理依赖
- **Bundle 感知**：Bundle 切换时，所有 Service 收到 `onBundleEnter/Exit` 通知

### 2.3 为什么用 `abstract class` 而不是 `interface`

TypeScript `interface` 编译后完全消失，无法作为 `Map` 的 key。  
`abstract class` 既能作为类型约束（编译期），又能作为运行时 key，一举两得。

```typescript
// ✅ abstract class 可以做 Map key
ServiceRegistry.get(IUIService)   // IUIService 是 abstract class

// ❌ interface 编译后消失，无法做 key
ServiceRegistry.get(IUIService)   // 报错
```

---

## 3. 目录结构

### 3.1 Extension 目录

```
nexus-extension/
├── package.json                  # 插件声明（菜单、面板、Hook）
├── src/
│   ├── main.ts                   # 主进程入口
│   │
│   ├── assets/                # ⭐ 框架母本（唯一权威来源）
│   │   ├── core/
│   │   │   ├── Nexus.ts          # 全局门面入口
│   │   │   ├── NexusConfig.ts    # 配置类型定义
│   │   │   ├── ServiceBase.ts    # 服务基类
│   │   │   └── ServiceRegistry.ts# 服务注册表
│   │   ├── services/             # 服务接口层
│   │   │   ├── IUIService.ts
│   │   │   ├── IBundleService.ts
│   │   │   ├── IEventService.ts
│   │   │   ├── INetService.ts
│   │   │   ├── IAudioService.ts
│   │   │   ├── IStorageService.ts
│   │   │   ├── II18nService.ts
│   │   │   └── IAssetService.ts
│   │   ├── impl/                 # 服务实现层
│   │   │   ├── UIServiceImpl.ts
│   │   │   ├── BundleServiceImpl.ts
│   │   │   ├── EventServiceImpl.ts
│   │   │   └── ...
│   │   ├── patterns/             # 子游戏开发模式
│   │   │   ├── mvc/
│   │   │   │   ├── Model.ts
│   │   │   │   ├── View.ts
│   │   │   │   └── Controller.ts
│   │   │   ├── mvvm/
│   │   │   │   ├── Observable.ts
│   │   │   │   └── ViewModel.ts
│   │   │   └── ecs/
│   │   │       ├── ECSComponent.ts
│   │   │       ├── ECSSystem.ts
│   │   │       ├── Entity.ts
│   │   │       └── World.ts
│   │   ├── bootstrap.ts          # 服务注册入口
│   │   └── index.ts              # 统一导出
```

### 3.2 项目目录（同步后）

```
your-game/
├── assets/
│   ├── nexus/                    # ⭐ 自动同步，勿手动修改，加入 .gitignore
│   │   ├── core/
│   │   ├── services/
│   │   ├── impl/
│   │   ├── patterns/
│   │   ├── bootstrap.ts
│   │   └── index.ts
│   │
│   ├── common/                   # 公共 Bundle
│   ├── lobby/                    # 大厅 Bundle
│   └── games/
│       ├── slotGame/             # 子游戏 Bundle（MVC）
│       ├── rpgGame/              # 子游戏 Bundle（ECS）
│       └── cardGame/             # 子游戏 Bundle（MVVM）
│
├── .gitignore
└── .nexus-lock.json              # 框架版本锁文件（自动生成）
```

**.gitignore 配置：**

```gitignore
# Nexus Framework（由 Extension 自动同步，不进入版本控制）
assets/nexus/

# 框架锁文件（可选择提交，用于 CI 验证版本）
# .nexus-lock.json
```

---

## 4. 代码架构四层模型

```
┌─────────────────────────────────────────────┐
│           ① 门面层  Nexus.ts                │  ← 游戏代码唯一接触点
│   Nexus.ui  Nexus.event  Nexus.bundle ...   │
└──────────────────┬──────────────────────────┘
                   │ static getter（实时查找）
┌──────────────────▼──────────────────────────┐
│         ② 接口层  IXxxService.ts            │  ← abstract class 定义契约
│   IUIService  IBundleService  INetService   │
└──────────────────┬──────────────────────────┘
                   │ 实现
┌──────────────────▼──────────────────────────┐
│         ③ 实现层  XxxServiceImpl.ts         │  ← 真正的业务逻辑
│   UIServiceImpl  BundleServiceImpl  ...     │
└──────────────────┬──────────────────────────┘
                   │ 注册 / 生命周期
┌──────────────────▼──────────────────────────┐
│         ④ 注册表  ServiceRegistry.ts        │  ← boot 顺序 / destroy 逆序
│   register()  get()  bootAll()  destroyAll()│
└─────────────────────────────────────────────┘
```

### 4.1 Nexus.ts（门面层）

```typescript
export class Nexus {

    // ── 初始化（整个游戏只调用一次）──────────────────
    static async init(config: NexusConfig): Promise<void> {
        await ServiceRegistry.bootAll(config);
    }

    static async start(): Promise<void> {
        const entry = Nexus.resolveEntryBundle();  // 显式 entryBundle > enableLobby ? lobby : URL game_id 对应 subgame
        await Nexus.bundle.enter(entry);
    }

    static async destroy(): Promise<void> {
        await ServiceRegistry.destroyAll();
    }

    // ── 服务访问器（static getter = 实时查找，类型安全）
    static get ui()      : IUIService      { return ServiceRegistry.get(IUIService);      }
    static get bundle()  : IBundleService  { return ServiceRegistry.get(IBundleService);  }
    static get event()   : IEventService   { return ServiceRegistry.get(IEventService);   }
    static get net()     : INetService     { return ServiceRegistry.get(INetService);     }
    static get audio()   : IAudioService   { return ServiceRegistry.get(IAudioService);   }
    static get storage() : IStorageService { return ServiceRegistry.get(IStorageService); }
    static get i18n()    : II18nService    { return ServiceRegistry.get(II18nService);    }
    static get asset()   : IAssetService   { return ServiceRegistry.get(IAssetService);   }

    // ── 最高频操作直接挂在 Nexus 上（快捷方式）────────
    static on<T>(evt: string, fn: (d: T) => void, target?: object): void {
        Nexus.event.on(evt, fn, target);
    }
    static emit<T>(evt: string, data?: T): void {
        Nexus.event.emit(evt, data);
    }
    static offTarget(target: object): void {
        Nexus.event.offTarget(target);
    }
}
```

### 4.2 ServiceBase.ts（基类）

```typescript
export abstract class ServiceBase {
    /** 框架启动时按顺序调用 */
    async onBoot(config: NexusConfig): Promise<void> {}

    /** 框架销毁时逆序调用 */
    async onDestroy(): Promise<void> {}

    /** Bundle 切换：进入新 Bundle */
    async onBundleEnter(bundleName: string): Promise<void> {}

    /** Bundle 切换：离开旧 Bundle */
    async onBundleExit(bundleName: string): Promise<void> {}
}
```

### 4.3 ServiceRegistry.ts（注册表）

```typescript
export class ServiceRegistry {

    private static _map   = new Map<any, ServiceBase>();
    private static _order : ServiceBase[] = [];

    /** 注册服务（token = 接口类，impl = 具体实现） */
    static register<T extends ServiceBase>(token: any, impl: T): void {
        ServiceRegistry._map.set(token, impl);
        ServiceRegistry._order.push(impl);
    }

    /** 获取服务（未注册则抛出明确错误） */
    static get<T>(token: any): T {
        const svc = ServiceRegistry._map.get(token);
        if (!svc) throw new Error(`[Nexus] Service not registered: ${token?.name ?? token}`);
        return svc as T;
    }

    /** 按注册顺序依次 boot */
    static async bootAll(config: NexusConfig): Promise<void> {
        for (const svc of ServiceRegistry._order) {
            await svc.onBoot(config);
        }
    }

    /** 逆序 destroy（自动处理依赖关系） */
    static async destroyAll(): Promise<void> {
        for (const svc of [...ServiceRegistry._order].reverse()) {
            await svc.onDestroy();
        }
        ServiceRegistry._map.clear();
        ServiceRegistry._order = [];
    }

    /** Bundle 切换时广播给所有服务 */
    static async notifyBundleEnter(bundleName: string): Promise<void> {
        for (const svc of ServiceRegistry._order) {
            await svc.onBundleEnter(bundleName);
        }
    }

    static async notifyBundleExit(bundleName: string): Promise<void> {
        for (const svc of [...ServiceRegistry._order].reverse()) {
            await svc.onBundleExit(bundleName);
        }
    }
}
```

### 4.4 bootstrap.ts（注册入口）

```typescript
// 注册顺序 = boot 顺序，destroy 自动逆序
// 原则：被依赖的服务先注册

ServiceRegistry.register(IEventService,   new EventServiceImpl());   // 1. 事件（无依赖）
ServiceRegistry.register(IStorageService, new StorageServiceImpl()); // 2. 存储（无依赖）
ServiceRegistry.register(IAssetService,   new AssetServiceImpl());   // 3. 资源
ServiceRegistry.register(IBundleService,  new BundleServiceImpl());  // 4. Bundle（依赖资源）
ServiceRegistry.register(IUIService,      new UIServiceImpl());      // 5. UI（依赖 Bundle）
ServiceRegistry.register(IAudioService,   new AudioServiceImpl());   // 6. 音频（依赖资源）
ServiceRegistry.register(II18nService,    new I18nServiceImpl());    // 7. 国际化（依赖存储+资源）
ServiceRegistry.register(INetService,     new NetServiceImpl());     // 8. 网络（最后）
```

---

## 5. 服务模块详解

### 5.1 IEventService — 事件总线

```typescript
abstract class IEventService extends ServiceBase {
    abstract on<T>(event: string, fn: (d: T) => void, target?: object): void;
    abstract once<T>(event: string, fn: (d: T) => void, target?: object): void;
    abstract off<T>(event: string, fn: (d: T) => void, target?: object): void;
    abstract offTarget(target: object): void;   // 组件销毁时批量移除
    abstract emit<T>(event: string, data?: T): void;
    abstract has(event: string): boolean;
}

// 用法
Nexus.event.on('SPIN_DONE', this.onDone, this);
Nexus.event.emit('SPIN_DONE', { win: 100 });
Nexus.event.offTarget(this);  // 销毁时一行搞定所有监听

// 快捷（最常用）
Nexus.on('SPIN_DONE', this.onDone, this);
Nexus.emit('SPIN_DONE', { win: 100 });
Nexus.offTarget(this);
```

### 5.2 IBundleService — Bundle 管理

```typescript
abstract class IBundleService extends ServiceBase {
    abstract load(bundleName: string): Promise<void>;
    abstract enter(bundleName: string, params?: Record<string, any>): Promise<void>;
    abstract exit(bundleName: string): Promise<void>;
    abstract unload(bundleName: string): void;
    abstract isLoaded(bundleName: string): boolean;
    readonly current: string;
    /** 关闭当前 Bundle 的 Loading 面板；若有待切换场景则先 runScene → NexusBaseEntry.onEnter，再关面板。 */
    abstract hideLoading(): Promise<void>;
}

// 用法
await Nexus.bundle.enter('slotGame', { userId: 123, minBet: 10 });
await Nexus.bundle.hideLoading();   // Loading 内预加载/请求完成后调用，完成场景切换
await Nexus.bundle.exit('slotGame');
```

### 5.3 IUIService — UI 管理

```typescript
abstract class IUIService extends ServiceBase {
    abstract show(name: string, params?: any, layer?: UILayer): Promise<void>;
    abstract hide(name: string): void;
    abstract destroy(name: string): void;
    abstract showLoading(text?: string): void;
    abstract hideLoading(): void;
    abstract setRoot(canvasNode: Node): void;
}

// 用法
await Nexus.ui.show('WinPanel', { score: 9999 });
Nexus.ui.hide('WinPanel');
Nexus.ui.showLoading('加载中...');
```

### 5.4 INetService — 网络

```typescript
abstract class INetService extends ServiceBase {
    abstract get<T>(path: string, options?: IHttpOptions): Promise<IResponse<T>>;
    abstract post<T>(path: string, body?: any): Promise<IResponse<T>>;
    abstract setBaseUrl(url: string): void;
    abstract setToken(token: string): void;
    abstract connectWs(url: string): Promise<void>;
    abstract sendWs(cmd: string | number, data: any): void;
    abstract onWsMsg(cmd: string | number, fn: (msg: any) => void): void;
}

// 用法
const res = await Nexus.net.post<SpinResult>('/api/spin', { bet: 10 });
Nexus.net.onWsMsg(CMD.GAME_START, this.onStart);
```

### 5.5 IAudioService — 音频

```typescript
abstract class IAudioService extends ServiceBase {
    abstract playMusic(bundle: string, path: string, loop?: boolean): Promise<void>;
    abstract stopMusic(): void;
    abstract playSfx(bundle: string, path: string): Promise<void>;
    abstract setMusicVolume(vol: number): void;
    abstract setSfxVolume(vol: number): void;
    abstract setMusicEnabled(on: boolean): void;
    abstract setSfxEnabled(on: boolean): void;
    abstract pauseAll(): void;
    abstract resumeAll(): void;
}

// 用法
await Nexus.audio.playMusic('slotGame', 'audios/bgm');
Nexus.audio.playSfx('common', 'audios/btn_click');
```

### 5.6 IStorageService — 本地存储

```typescript
abstract class IStorageService extends ServiceBase {
    abstract get<T>(key: string, defaultValue?: T): T | undefined;
    abstract set<T>(key: string, value: T): void;
    abstract remove(key: string): void;
    abstract has(key: string): boolean;
    abstract clear(): void;
}

// 用法
Nexus.storage.set('userInfo', { id: 1, name: 'Alice' });
const info = Nexus.storage.get<UserInfo>('userInfo');
```

### 5.7 II18nService — 国际化

```typescript
abstract class II18nService extends ServiceBase {
    abstract t(key: string, params?: Record<string, any>): string;
    abstract switchLanguage(lang: string): Promise<void>;
    readonly language: string;
}

// 用法
Nexus.i18n.t('common.ok')                    // → "确认"
Nexus.i18n.t('ui.score', { score: 100 })    // → "分数：100"
await Nexus.i18n.switchLanguage('en_US');
```

### 5.8 IAssetService — 资源管理

```typescript
abstract class IAssetService extends ServiceBase {
    abstract load<T extends Asset>(bundle: string, path: string, type: AssetType<T>): Promise<T>;
    abstract loadDir<T extends Asset>(bundle: string, dir: string, type: AssetType<T>): Promise<T[]>;
    abstract release(bundle: string, path: string): void;
    abstract releaseBundle(bundle: string): void;
    abstract preload(bundle: string, paths: string[]): Promise<void>;
}

// 用法
const prefab = await Nexus.asset.load('slotGame', 'prefabs/Reel', Prefab);
const frames = await Nexus.asset.loadDir('common', 'textures/icons', SpriteFrame);
```

---

## 6. 多 Bundle 架构

### 6.1 Bundle 类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `common` | 公共资源，常驻内存，最先加载 | 字体、公共音效、框架 UI |
| `lobby` | 大厅，作为 entryBundle（有大厅模式） | 游戏列表、充值、个人中心 |
| `subgame` | 子游戏，按需加载/卸载 | slotGame、rpgGame |

### 6.2 NexusConfig 配置

```typescript
interface NexusConfig {
    version: string;
    debug: boolean;
    entryBundle?: string;            // 可选。不填时根据 enableLobby 与 URL game_id 自动解析
    enableLobby: boolean;            // 为 true 时首进 lobby；为 false 时按 URL game_id 或首个子游戏
    hotUpdateUrl?: string;           // 热更新地址（原生平台）
    defaultLanguage: string;
    languages: string[];
    networkTimeout: number;
    bundles: BundleConfig[];
}

interface BundleConfig {
    name: string;
    type: 'common' | 'lobby' | 'subgame';
    gameId?: number;                 // 子游戏时可选，与 URL 参数 game_id 对应，用于 H5 直进子游戏
    remoteUrl?: string;              // 远程加载地址（不填则本地）
    pattern?: 'mvc' | 'mvvm' | 'ecs' | 'component'; // 子游戏开发模式
    preload?: boolean;               // 是否预加载
}
```

### 6.3 Bundle 切换流程

**场景与 Loading 约定**：入口场景名为 `bundleName + 'Main'`（如 `lobbyMain`、`slotGameMain`）；各 Bundle 的 Loading 面板名为 `bundleName + 'Loading'`（如 `slotGameLoading`）。业务在 Loading 内完成预加载/请求后调用 `Nexus.bundle.hideLoading()`，框架再执行场景切换并调用 `NexusBaseEntry.onEnter`。

```
enter('slotGame', params)
    │
    ├─ 1. notifyBundleExit(prev) / unload(prev)   → 退出旧 Bundle
    ├─ 2. load('slotGame')                        → 加载子游戏 Bundle
    ├─ 3. show('slotGameLoading')                 → 显示该 Bundle 的 Loading 面板
    ├─ 4. loadScene('slotGameMain') 仅加载到内存，不 runScene；enter() 的 Promise 挂起
    │
    │   【业务在 Loading 内：预加载、发 joinGame 等，完成后调用 Nexus.bundle.hideLoading()】
    │
    ├─ 5. hideLoading() 内：runScene → NexusBaseEntry.onEnter(params) → notifyBundleEnter('slotGame')
    └─ 6. 关闭 Loading 面板
```

### 6.4 NexusBaseEntry 入口基类

每个 Bundle 的主场景根节点挂载继承 `NexusBaseEntry` 的脚本（大厅、子游戏通用）：

```typescript
@ccclass('SlotGameEntry')
export class SlotGameEntry extends NexusBaseEntry {

    async onEnter(params?: Record<string, any>): Promise<void> {
        await super.onEnter(params);
        // 子游戏初始化逻辑
        this._controller = new SlotController();
        await this._controller.start(params);
        await Nexus.audio.playMusic('slotGame', 'audios/bgm');
    }

    async onExit(): Promise<void> {
        this._controller?.destroy();
        Nexus.audio.stopMusic();
        await super.onExit();
    }
}
```

---

## 7. 子游戏开发模式

### 7.1 MVC 模式

适合：有明确业务逻辑的游戏（老虎机、棋牌、捕鱼）

```typescript
// Model：数据 + 业务规则
class SlotModel extends Model {
    private _balance = 0;

    async spin(bet: number): Promise<SpinResult> {
        const res = await Nexus.net.post<SpinResult>('/api/spin', { bet });
        this._balance = res.data.balance;
        this.notify('BALANCE_CHANGED', { balance: this._balance }); // 通知 View
        return res.data;
    }
}

// View：UI 展示，只监听事件，不直接调用 Model
@ccclass('SlotView')
class SlotView extends View {
    @property(Label) balanceLabel: Label = null!;

    protected registerEvents(): void {
        this.listen<{ balance: number }>('BALANCE_CHANGED', ({ balance }) => {
            this.balanceLabel.string = `${balance}`;
        });
        // 用户操作 → dispatch 给 Controller
        this.spinBtn.node.on('click', () => this.dispatch('CMD_SPIN'), this);
    }
}

// Controller：协调 Model 和 View
class SlotController extends Controller {
    private _model = new SlotModel();

    protected registerCommands(): void {
        this.handle('CMD_SPIN', this.onSpin.bind(this));
    }

    private async onSpin(): Promise<void> {
        Nexus.ui.showLoading();
        const result = await this._model.spin(this._bet);
        Nexus.ui.hideLoading();
        if (result.win > 0) {
            await Nexus.ui.show('WinPanel', { win: result.win });
        }
    }
}
```

### 7.2 MVVM 模式

适合：表单、配置界面、数据驱动展示类 UI

```typescript
// ViewModel：持有响应式数据
class LoginViewModel extends ViewModel {
    username = new Observable('');
    password = new Observable('');
    loading  = new Observable(false);
    errorMsg = new Observable('');

    async login(): Promise<void> {
        this.loading.value = true;
        try {
            const res = await Nexus.net.post('/api/login', {
                username: this.username.value,
                password: this.password.value,
            });
            Nexus.net.setToken(res.data.token);
            Nexus.emit('LOGIN_SUCCESS');
        } catch (e: any) {
            this.errorMsg.value = e.message;
        } finally {
            this.loading.value = false;
        }
    }
}

// View：声明绑定关系，自动刷新
@ccclass('LoginPanel')
class LoginPanel extends UIBase {
    @property(EditBox) usernameInput: EditBox = null!;
    @property(Label)   errorLabel:   Label   = null!;
    @property(Node)    loadingNode:  Node    = null!;

    private _vm = new LoginViewModel();

    onShow(): void {
        super.onShow();
        this._vm.bindEditBox(this._vm.username, this.usernameInput);
        this._vm.bindLabel(this._vm.errorMsg, this.errorLabel);
        this._vm.bindVisible(this._vm.loading, this.loadingNode);
        this.loginBtn.node.on('click', () => this._vm.login(), this);
    }
}
```

### 7.3 ECS 模式

适合：逻辑复杂、实体众多的游戏（RPG、RTS、弹幕射击）

```typescript
// Component：纯数据
class PositionComponent extends ECSComponent {
    constructor(public x = 0, public y = 0) { super(); }
}
class VelocityComponent extends ECSComponent {
    constructor(public vx = 0, public vy = 0) { super(); }
}
class HealthComponent extends ECSComponent {
    constructor(public hp = 100, public maxHp = 100) { super(); }
    get isDead() { return this.hp <= 0; }
}

// System：逻辑处理
class MovementSystem extends ECSSystem {
    requiredComponents() { return [PositionComponent, VelocityComponent]; }

    update(entities: Entity[], dt: number): void {
        for (const e of entities) {
            const pos = e.getComponent(PositionComponent)!;
            const vel = e.getComponent(VelocityComponent)!;
            pos.x += vel.vx * dt;
            pos.y += vel.vy * dt;
        }
    }
}

// World：ECS 运行时
@ccclass('RPGGameEntry')
class RPGGameEntry extends NexusBaseEntry {
    private _world = new World();

    async onEnter(params?: any): Promise<void> {
        this._world
            .addSystem(new MovementSystem())
            .addSystem(new CollisionSystem())
            .addSystem(new AISystem());

        const player = this._world.createEntity('Player');
        this._world.addComponent(player, new PositionComponent(0, 0));
        this._world.addComponent(player, new VelocityComponent());
        this._world.addComponent(player, new HealthComponent(500, 500));
    }

    update(dt: number): void {
        this._world.update(dt);  // 在 Cocos update 中驱动 ECS
    }
}
```

### 7.4 纯组件模式（Component）

适合：简单休闲游戏，直接用 CocosCreator 默认脚本风格

```typescript
@ccclass('GameController')
class GameController extends Component {

    async start(): Promise<void> {
        Nexus.on('COIN_COLLECT', this.onCoin, this);
        await Nexus.audio.playMusic('game', 'audios/bgm');
    }

    private onCoin(data: { value: number }): void {
        this._score += data.value;
        Nexus.audio.playSfx('common', 'audios/coin');
    }

    onDestroy(): void {
        Nexus.offTarget(this);  // 一行清理所有事件
    }
}
```

---

## 8. Extension 工作机制

### 8.1 文件同步机制

```
Extension/src/framework/   ──[MD5 增量对比]──►  assets/nexus/
        ↑                                              ↓
   唯一权威来源                                 Cocos 编译打包
   （开发者修改这里）                           （游戏运行时）
```

**同步策略：**

- 启动时全量对比，仅复制有变化的文件（MD5 增量）
- 开发模式下 FileWatcher 实时监听 `src/framework/`，修改即同步
- 同步记录写入 `.nexus-lock.json`，记录每个文件的版本哈希

### 8.2 Extension 生命周期

```typescript
// main.ts
export function load(): void {
    // 1. 检查项目，同步框架文件
    FileSyncEngine.sync();
    // 2. 启动 FileWatcher（开发模式）
    FileWatcher.start('src/framework', 'assets/nexus');
    // 3. 注册菜单
    Editor.Menu.addItem({ ... });
}

export function unload(): void {
    FileWatcher.stop();
}

export const methods = {
    // 供面板调用的主进程方法
    syncFramework:   () => FileSyncEngine.sync(),
    generateCode:    (opts) => CodeGenerator.generate(opts),
    checkAssets:     () => AssetChecker.run(),
    getBundleConfig: () => BundleConfigReader.read(),
};
```

### 8.3 面板功能（Vue3）

| 面板 | 功能 |
|------|------|
| **Bundle Manager** | 可视化管理子游戏列表、配置 remoteUrl、模式选择 |
| **Code Generator** | 选择模式（MVC/ECS/MVVM），输入名称，一键生成完整模板文件 |
| **Framework Settings** | 查看框架版本、同步状态、手动触发同步 |
| **Asset Checker** | 检查资源命名规范、Bundle 资源引用关系、缺失资源报告 |

### 8.4 Build Hook

```typescript
// hooks/build-hook.ts
export const onBeforeBuild = async (options: BuildOptions): Promise<void> => {
    // 1. 验证框架文件完整性
    FileSyncEngine.verify();
    // 2. 注入版本信息
    injectVersion(options.dest, config.version);
    // 3. 处理 Bundle 分包配置
    processBundleConfig(options);
};
```

---

## 9. 快速开始

### 9.1 安装 Extension

1. 打开 CocosCreator 3.8
2. 顶部菜单 → `Extensions` → `Extension Manager`
3. 点击 `+` → 选择本地 → 找到 `nexus-extension` 目录
4. 启用插件，框架文件自动同步到 `assets/nexus/`

### 9.2 配置项目

```typescript
// assets/launch/GameLauncher.ts
@ccclass('GameLauncher')
export class GameLauncher extends Component {

    @property(Node) canvasRoot: Node = null!;

    async start(): Promise<void> {
        await Nexus.init({
            version: '1.0.0',
            debug: true,
            enableLobby: true,
            entryBundle: 'lobby',
            defaultLanguage: 'zh_CN',
            languages: ['zh_CN', 'en_US'],
            networkTimeout: 10000,
            bundles: [
                { name: 'common',   type: 'common',   preload: true },
                { name: 'lobby',    type: 'lobby' },
                { name: 'slotGame', type: 'subgame',  pattern: 'mvc' },
                { name: 'rpgGame',  type: 'subgame',  pattern: 'ecs' },
            ],
        });

        Nexus.ui.setRoot(this.canvasRoot);
        await Nexus.start();
    }
}
```

### 9.3 纯子游戏模式（无大厅）

```typescript
await Nexus.init({
    enableLobby: false,
    entryBundle: 'slotGame',   // 直接进入子游戏
    bundles: [
        { name: 'common',   type: 'common', preload: true },
        { name: 'slotGame', type: 'subgame', pattern: 'mvc' },
    ],
});
```

### 9.4 进入/退出子游戏

```typescript
// 从大厅进入子游戏
await Nexus.bundle.enter('slotGame', {
    gameId: 1001,
    minBet: 10,
    maxBet: 1000,
});

// 返回大厅
await Nexus.bundle.enter('lobby');
```

---

## 10. API 速查

### Nexus 全局

```typescript
Nexus.init(config)          // 初始化框架
Nexus.start()               // 启动（解析 entryBundle 后进入，见 6.2）
Nexus.destroy()             // 销毁框架

Nexus.on(evt, fn, target)   // 监听事件（快捷）
Nexus.emit(evt, data)       // 发布事件（快捷）
Nexus.offTarget(target)     // 批量移除监听（快捷）
```

### Nexus.bundle

```typescript
Nexus.bundle.enter(name, params?)   // 加载并进入 Bundle（先显示 Loading，场景在 hideLoading 时切换）
Nexus.bundle.hideLoading()          // 关闭当前 Loading；若有待切换场景则执行 runScene → onEnter
Nexus.bundle.exit(name)             // 退出 Bundle
Nexus.bundle.load(name)             // 仅加载，不进入
Nexus.bundle.unload(name)           // 卸载并释放
Nexus.bundle.isLoaded(name)         // 是否已加载
Nexus.bundle.current                // 当前 Bundle 名
```

### Nexus.ui

```typescript
Nexus.ui.show(name, params?, layer?)  // 显示面板
Nexus.ui.hide(name)                   // 隐藏面板（保留缓存）
Nexus.ui.destroy(name)                // 销毁面板
Nexus.ui.showLoading(text?)           // 显示 Loading
Nexus.ui.hideLoading()                // 隐藏 Loading
Nexus.ui.setRoot(canvasNode)          // 设置 UI 根节点
```

### Nexus.net

```typescript
Nexus.net.setBaseUrl(url)               // 设置 HTTP baseUrl
Nexus.net.setToken(token)               // 设置 Authorization Token
Nexus.net.get<T>(path, options?)        // HTTP GET
Nexus.net.post<T>(path, body?)          // HTTP POST
Nexus.net.connectWs(url)               // 连接 WebSocket
Nexus.net.sendWs(cmd, data)            // 发送 WS 消息
Nexus.net.onWsMsg(cmd, fn)             // 监听 WS 消息
```

### Nexus.audio

```typescript
Nexus.audio.playMusic(bundle, path, loop?)  // 播放背景音乐
Nexus.audio.stopMusic()                     // 停止音乐
Nexus.audio.playSfx(bundle, path)           // 播放音效
Nexus.audio.setMusicVolume(vol)             // 设置音乐音量 0~1
Nexus.audio.setSfxVolume(vol)               // 设置音效音量 0~1
Nexus.audio.setMusicEnabled(on)             // 开关音乐
Nexus.audio.setSfxEnabled(on)               // 开关音效
```

### Nexus.asset

```typescript
Nexus.asset.load<T>(bundle, path, type)     // 加载单个资源
Nexus.asset.loadDir<T>(bundle, dir, type)   // 加载目录
Nexus.asset.preload(bundle, paths)          // 预加载
Nexus.asset.release(bundle, path)           // 释放资源
Nexus.asset.releaseBundle(bundle)           // 释放整个 Bundle 资源
```

### Nexus.storage

```typescript
Nexus.storage.get<T>(key, defaultValue?)    // 读取
Nexus.storage.set(key, value)               // 写入
Nexus.storage.remove(key)                   // 删除
Nexus.storage.has(key)                      // 是否存在
Nexus.storage.clear()                       // 清空（当前命名空间）
```

### Nexus.i18n

```typescript
Nexus.i18n.t(key, params?)              // 翻译文本
Nexus.i18n.switchLanguage(lang)         // 切换语言
Nexus.i18n.language                     // 当前语言
```

---

## 附录

### 全局事件常量

```typescript
export const NexusEvents = {
    APP_READY:          'APP_READY',
    APP_HIDE:           'APP_HIDE',
    APP_SHOW:           'APP_SHOW',
    BUNDLE_ENTER:       'BUNDLE_ENTER',
    BUNDLE_EXIT:        'BUNDLE_EXIT',
    NET_CONNECTED:      'NET_CONNECTED',
    NET_DISCONNECTED:   'NET_DISCONNECTED',
    LANGUAGE_CHANGED:   'LANGUAGE_CHANGED',
    LOGIN_SUCCESS:      'LOGIN_SUCCESS',
    LOGOUT:             'LOGOUT',
} as const;
```

### UILayer 层级

```typescript
export enum UILayer {
    SCENE   = 0,    // 场景内容层
    PANEL   = 100,  // 普通面板
    POPUP   = 200,  // 弹窗（自动队列）
    TIPS    = 300,  // Toast 提示
    LOADING = 400,  // 加载遮罩
    TOP     = 500,  // 最顶层（强提示）
}
```

---

*Nexus Framework · Built for CocosCreator 3.8 · MIT License*
