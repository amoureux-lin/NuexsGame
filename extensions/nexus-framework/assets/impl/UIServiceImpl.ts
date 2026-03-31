import { director, instantiate, Node, Prefab, UITransform, Widget } from 'cc';
import { Nexus } from '../core/Nexus';
import { IUIService, UILayer, type UIPanelConfigMap, type UIPanelOptions } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';

interface PanelRecord {
    node:  Node;
    layer: UILayer;
}

/**
 * 按 UILayer 枚举值从小到大排列的层定义（顺序即 z 序，前面在下，后面在上）。
 * 注意：必须与 UILayer 数值大小保持一致，否则 setSiblingIndex(layer) 会导致层级混乱。
 */
const LAYER_DEFS: UILayer[] = [
    UILayer.SCENE,   // 0
    UILayer.LOADING, // 100
    UILayer.PANEL,   // 200
    UILayer.POPUP,   // 300
    UILayer.TIPS,    // 400
    UILayer.TOP,     // 500
];

/**
 * 基于 Node + Prefab + instantiate 的 UI 管理实现。
 *
 * 层级结构（挂在 canvasRoot 下）：
 *   [Layer:SCENE]   z=0
 *   [Layer:LOADING] z=100
 *   [Layer:PANEL]   z=200
 *   [Layer:POPUP]   z=300
 *   [Layer:TIPS]    z=400
 *   [Layer:TOP]     z=500
 *
 * Prefab 查找规则：优先从当前 Bundle 的 prefabs/<name> 加载，
 * 找不到则 fallback 到 common Bundle。
 */
export class UIServiceImpl extends IUIService {

    private _root: Node | null = null;
    private readonly _layers        = new Map<UILayer, Node>();
    private readonly _panels        = new Map<string, PanelRecord>();
    /** 已注册的面板配置表：id -> 预制体路径、默认层级等。 */
    private readonly _panelConfigs  = new Map<string, UIPanelOptions>();
    /** 通过 setLoadingPanel 指定的 Loading 面板 key。 */
    private _loadingPanelName: string | null = null;
    /** Prefab 正在异步加载中的面板名集合。 */
    private readonly _loadingSet    = new Set<string>();
    /** 加载过程中收到 hide/destroy 请求的面板名集合。 */
    private readonly _pendingHide   = new Set<string>();

    /** 框架启动时注册事件驱动的 UI 打开/关闭处理。 */
    async onBoot(): Promise<void> {
        // 事件驱动：Nexus.emit(NexusEvents.UI_OPEN, { id, params?, layer? })
        Nexus.on<{ id: string; params?: unknown; layer?: UILayer }>(
            NexusEvents.UI_OPEN,
            async ({ id, params, layer }) => {
                await this.show(id, params, layer);
            },
            this,
        );
        // 事件驱动：Nexus.emit(NexusEvents.UI_CLOSE, { id, destroy? })
        Nexus.on<{ id: string; destroy?: boolean }>(
            NexusEvents.UI_CLOSE,
            ({ id, destroy }) => {
                if (destroy) this.destroy(id);
                else this.hide(id);
            },
            this,
        );
    }

    /** 注册一批 UI 面板配置。后注册的同名 id 会覆盖旧配置。 */
    registerPanels(config: UIPanelConfigMap): void {
        for (const id in config) {
            if (Object.prototype.hasOwnProperty.call(config, id)) {
                this._panelConfigs.set(id, config[id]);
            }
        }
    }

    /** 按 id 反注册；若传入 key 对象（如 lobbyUI），则取其 value 作为 id 列表。 */
    unregisterPanels(ids: string[] | Record<string, string>): void {
        const list: string[] = Array.isArray(ids)
            ? ids
            : (() => {
                const a: string[] = [];
                for (const k in ids) {
                    if (Object.prototype.hasOwnProperty.call(ids, k)) {
                        a.push(ids[k]);
                    }
                }
                return a;
            })();
        for (let i = 0; i < list.length; i++) {
            this._panelConfigs.delete(list[i]);
        }
    }

    /** 设置 UI 挂载根节点，并初始化各层级容器。 */
    setRoot(root: Node): void {
        this._root = root as Node;
        // 添加到持久化根节点
        director.addPersistRootNode(root);
        this.buildLayers();
    }

    /**
     * 指定用于 showLoading / hideLoading 的面板 key。
     * 需先通过 registerPanels 注册该 key 对应的面板配置。
     */
    setLoadingPanel(name: string): void {
        this._loadingPanelName = name;
    }

    /**
     * 显示面板，返回面板根节点。
     * - 未创建        → 加载 Prefab、实例化、挂载、触发 onShow
     * - 已创建且隐藏  → 重新激活、触发 onShow
     * - 已创建且显示  → 仅透传新参数触发 onShow（刷新内容），不重复挂载
     * - 加载中途收到 hide/destroy → 加载完成后直接丢弃，不挂载不显示
     */
    async show(name: string, params?: unknown, layer?: UILayer): Promise<Node> {
        const cfg = this._panelConfigs.get(name);
        const targetLayer: UILayer = layer ?? cfg?.layer ?? UILayer.PANEL;

        // 已有节点：直接激活并透传参数
        const existing = this._panels.get(name);
        if (existing) {
            if (!existing.node.active) {
                existing.node.active = true;
            }
            this.dispatch(existing.node, 'onShow', params);
            return existing.node;
        }

        // 已在加载中：跳过重复加载，避免创建多个孤儿节点
        if (this._loadingSet.has(name)) return new Node();

        // 标记为"加载中"，此后 hide/destroy 只写入 _pendingHide
        this._loadingSet.add(name);
        let prefab: Prefab;
        try {
            const prefabNameOrPath = cfg?.prefab ?? name;
            const bundleOverride   = cfg?.bundle;
            prefab = await this.loadPrefab(prefabNameOrPath, bundleOverride);
        } finally {
            this._loadingSet.delete(name);
        }

        // 加载期间已被 hide/destroy 取消，丢弃本次显示
        if (this._pendingHide.has(name)) {
            this._pendingHide.delete(name);
            return new Node(); // 返回空节点，调用方通常不关心返回值
        }

        const node = instantiate(prefab!);
        this.getLayerNode(targetLayer).addChild(node);
        this._panels.set(name, { node, layer: targetLayer });
        this.dispatch(node, 'onShow', params);
        return node;
    }

    /**
     * 隐藏面板，触发 onHide。
     * - 面板正在加载中 → 记录待关闭，加载完成后丢弃
     * - 面板不存在或已隐藏 → 跳过，避免重复触发 onHide
     */
    hide(name: string): void {
        if (this._loadingSet.has(name)) {
            this._pendingHide.add(name);
            return;
        }
        const record = this._panels.get(name);
        if (!record || !record.node.active) return;
        record.node.active = false;
        this.dispatch(record.node, 'onHide');
    }

    /**
     * 销毁面板节点并移除缓存。
     * - 面板正在加载中 → 记录待关闭，加载完成后丢弃
     * - 仅在 active 时触发 onHide，避免与 hide() 后再 destroy() 重复回调
     */
    destroy(name: string): void {
        if (this._loadingSet.has(name)) {
            this._pendingHide.add(name);
            return;
        }
        const record = this._panels.get(name);
        if (!record) return;
        if (record.node.active) {
            this.dispatch(record.node, 'onHide');
        }
        record.node.destroy();
        this._panels.delete(name);
    }

    /** 显示 Loading 面板，透传 text 参数给面板组件的 onShow。 */
    showLoading(text = ''): void {
        if (!this._loadingPanelName) {
            console.warn('[Nexus] showLoading: 请先调用 setLoadingPanel(name) 指定 Loading 面板');
            return;
        }
        this.show(this._loadingPanelName, { text });
    }

    /** 隐藏 Loading 面板。 */
    hideLoading(): void {
        if (!this._loadingPanelName) return;
        this.hide(this._loadingPanelName);
    }

    /** Bundle 切换离开时销毁所有面板，并清空加载中状态 */
    async onBundleExit(_bundleName: string): Promise<void> {
        // 正在加载中的面板全部标记取消
        for (const name of this._loadingSet) {
            this._pendingHide.add(name);
        }
        for (const [name, record] of [...this._panels.entries()]) {
            this.dispatch(record.node, 'onHide');
            record.node.destroy();
            this._panels.delete(name);
        }
    }

    /** 销毁时清空所有运行时缓存。 */
    async onDestroy(): Promise<void> {
        for (const name of this._loadingSet) {
            this._pendingHide.add(name);
        }
        this._panels.clear();
        this._layers.clear();
        this._panelConfigs.clear();
        this._loadingSet.clear();
        this._pendingHide.clear();
        this._loadingPanelName = null;
        this._root = null;
        Nexus.offTarget(this);
    }

    // ── 私有工具 ─────────────────────────────────────

    /** 构建标准 UI 层级节点。 */
    private buildLayers(): void {
        this._layers.clear();

        for (const layer of LAYER_DEFS) {
            const node = new Node(`[Layer:${UILayer[layer]}]`);
            node.addComponent(UITransform);

            // 全屏拉伸
            const widget = node.addComponent(Widget);
            widget.isAlignTop    = true;
            widget.isAlignBottom = true;
            widget.isAlignLeft   = true;
            widget.isAlignRight  = true;
            widget.top = widget.bottom = widget.left = widget.right = 0;
            widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

            this._root!.addChild(node);
            node.setSiblingIndex(layer);
            this._layers.set(layer, node);
        }
    }

    /** 获取指定层级节点，缺省时回退到根节点。 */
    getLayerNode(layer: UILayer): Node {
        return this._layers.get(layer) ?? this._root!;
    }

    /**
     * 优先从当前 Bundle（或配置指定的 Bundle）加载，失败则 fallback 到 common。
     * nameOrPath 中包含 '/' 时视为完整路径，否则按 prefabs/<name> 规则拼接。
     */
    private async loadPrefab(nameOrPath: string, bundleOverride?: string): Promise<Prefab> {
        const path = nameOrPath.includes('/') ? nameOrPath : `prefabs/${nameOrPath}`;
        const primaryBundle = bundleOverride ?? Nexus.bundle.current;
        try {
            return await Nexus.asset.load<Prefab>(primaryBundle, path, Prefab);
        } catch {
            return await Nexus.asset.load<Prefab>('common', path, Prefab);
        }
    }

    /** 向节点上所有组件分发 UI 生命周期回调 */
    private dispatch(node: Node, method: string, params?: unknown): void {
        for (const comp of node.components) {
            if (typeof (comp as any)[method] === 'function') {
                (comp as any)[method](params);
            }
        }
    }
}
