import { director, instantiate, Node, Prefab, UITransform, Widget } from 'cc';
import { Nexus } from '../core/Nexus';
import { IUIService, UILayer, type UIPanelConfigMap, type UIPanelOptions } from '../services/contracts';
import { NexusEvents } from '../NexusEvents';
import { UIPanel } from '../base/UIPanel';

interface PanelRecord {
    node:  Node;
    layer: UILayer;
    /** 该面板对应的遮罩节点（mask: false 时为 null） */
    maskNode: Node | null;
    /** 当前是否正在播放动画 */
    animating: boolean;
}

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
 * 遮罩策略（方案 B 改进版）：
 *   - mask: true 的面板，show 时自动加载 mask prefab 并放在面板前
 *   - 同一层级内只有最上层面板的遮罩可见，其余隐藏
 *   - hide/destroy 面板时自动销毁对应遮罩，并刷新可见性
 */
export class UIServiceImpl extends IUIService {

    private _root: Node | null = null;
    private readonly _layers        = new Map<UILayer, Node>();
    private readonly _panels        = new Map<string, PanelRecord>();
    private readonly _panelConfigs  = new Map<string, UIPanelOptions>();
    private _loadingPanelName: string | null = null;
    private _maskPanelName: string | null = null;
    /** 缓存已加载的 mask prefab，避免重复加载 */
    private _maskPrefab: Prefab | null = null;
    private readonly _loadingSet    = new Set<string>();
    private readonly _pendingHide   = new Set<string>();
    /** 模态栈：记录带遮罩面板的打开顺序，用于刷新遮罩可见性 */
    private readonly _modalStack: string[] = [];

    async onBoot(): Promise<void> {
        Nexus.on<{ id: string; params?: unknown; layer?: UILayer }>(
            NexusEvents.UI_OPEN,
            async ({ id, params, layer }) => { await this.show(id, params, layer); },
            this,
        );
        Nexus.on<{ id: string; destroy?: boolean }>(
            NexusEvents.UI_CLOSE,
            ({ id, destroy }) => { if (destroy) this.destroy(id); else this.hide(id); },
            this,
        );
    }

    registerPanels(config: UIPanelConfigMap): void {
        for (const id in config) {
            if (Object.prototype.hasOwnProperty.call(config, id)) {
                this._panelConfigs.set(id, config[id]);
            }
        }
    }

    unregisterPanels(ids: string[] | Record<string, string>): void {
        const list: string[] = Array.isArray(ids)
            ? ids
            : (() => {
                const a: string[] = [];
                for (const k in ids) {
                    if (Object.prototype.hasOwnProperty.call(ids, k)) a.push(ids[k]);
                }
                return a;
            })();
        for (const id of list) this._panelConfigs.delete(id);
    }

    setRoot(root: Node): void {
        this._root = root;
        director.addPersistRootNode(root);
        this.buildLayers();
    }

    setLoadingPanel(name: string): void {
        this._loadingPanelName = name;
    }

    setMaskPanel(name: string): void {
        this._maskPanelName = name;
    }

    // ── show / hide / destroy ────────────────────────────

    async show(name: string, params?: unknown, layer?: UILayer): Promise<Node> {
        const cfg = this._panelConfigs.get(name);
        const targetLayer: UILayer = layer ?? cfg?.layer ?? UILayer.PANEL;
        const needMask = cfg?.mask === true;

        // 已有节点：直接激活并透传参数
        const existing = this._panels.get(name);
        if (existing) {
            // 正在播放动画时忽略重复 show
            if (existing.animating) return existing.node;

            if (!existing.node.active) {
                existing.node.active = true;
                if (existing.maskNode) existing.maskNode.active = true;
            }
            this.dispatch(existing.node, 'onShow', params, name, existing.maskNode);

            // 播放显示动画（复用节点时也需要重新播放）
            existing.animating = true;
            await this._playShowAnimation(existing.node);
            existing.animating = false;

            if (needMask) this._pushModal(name);
            return existing.node;
        }

        if (this._loadingSet.has(name)) return new Node();

        this._loadingSet.add(name);
        let prefab: Prefab;
        try {
            const prefabNameOrPath = cfg?.prefab ?? name;
            const bundleOverride   = cfg?.bundle;
            prefab = await this.loadPrefab(prefabNameOrPath, bundleOverride);
        } finally {
            this._loadingSet.delete(name);
        }

        if (this._pendingHide.has(name)) {
            this._pendingHide.delete(name);
            return new Node();
        }

        const layerNode = this.getLayerNode(targetLayer);

        // 创建遮罩节点（mask: true 时加载 mask prefab）
        let maskNode: Node | null = null;
        if (needMask) {
            maskNode = await this._createMask(name, cfg);
            if (maskNode) layerNode.addChild(maskNode);
        }

        // 创建面板节点
        const node = instantiate(prefab!);
        layerNode.addChild(node);

        const record: PanelRecord = { node, layer: targetLayer, maskNode, animating: false };
        this._panels.set(name, record);
        this.dispatch(node, 'onShow', params, name, maskNode);

        // 播放显示动画
        record.animating = true;
        await this._playShowAnimation(node);
        record.animating = false;

        if (needMask) this._pushModal(name);

        return node;
    }

    async hide(name: string): Promise<void> {
        if (this._loadingSet.has(name)) {
            this._pendingHide.add(name);
            return;
        }
        const record = this._panels.get(name);
        if (!record || !record.node.active) return;

        // 正在播放动画时忽略重复 hide
        if (record.animating) return;

        // 播放隐藏动画
        record.animating = true;
        await this._playHideAnimation(record.node);
        record.animating = false;

        record.node.active = false;
        if (record.maskNode) record.maskNode.active = false;
        this.dispatch(record.node, 'onHide');
        this._removeModal(name);
    }

    async destroy(name: string): Promise<void> {
        if (this._loadingSet.has(name)) {
            this._pendingHide.add(name);
            return;
        }
        const record = this._panels.get(name);
        if (!record) return;

        // 正在播放动画时忽略重复 destroy
        if (record.animating) return;

        if (record.node.active) {
            // 播放隐藏动画
            record.animating = true;
            await this._playHideAnimation(record.node);
            record.animating = false;
            this.dispatch(record.node, 'onHide');
        }
        if (record.maskNode) record.maskNode.destroy();
        record.node.destroy();
        this._panels.delete(name);
        this._removeModal(name);
    }

    showLoading(text = ''): void {
        if (!this._loadingPanelName) {
            console.warn('[Nexus] showLoading: 请先调用 setLoadingPanel(name) 指定 Loading 面板');
            return;
        }
        this.show(this._loadingPanelName, { text });
    }

    async hideLoading(): Promise<void> {
        if (!this._loadingPanelName) return;
        await this.hide(this._loadingPanelName);
    }

    async onBundleExit(_bundleName: string): Promise<void> {
        for (const name of this._loadingSet) {
            this._pendingHide.add(name);
        }
        for (const [name, record] of [...this._panels.entries()]) {
            this.dispatch(record.node, 'onHide');
            if (record.maskNode) record.maskNode.destroy();
            record.node.destroy();
            this._panels.delete(name);
        }
        this._modalStack.length = 0;
    }

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
        this._maskPanelName = null;
        this._maskPrefab = null;
        this._modalStack.length = 0;
        this._root = null;
        Nexus.offTarget(this);
    }

    // ── 动画调用 ──────────────────────────────────────────

    /** 找到 UIPanel 组件并播放显示动画 */
    private async _playShowAnimation(node: Node): Promise<void> {
        const panel = node.getComponent(UIPanel as any) as UIPanel | null;
        if (panel) await panel.showAnimation();
    }

    /** 找到 UIPanel 组件并播放隐藏动画 */
    private async _playHideAnimation(node: Node): Promise<void> {
        const panel = node.getComponent(UIPanel as any) as UIPanel | null;
        if (panel) await panel.hideAnimation();
    }

    // ── 模态栈管理 ───────────────────────────────────────

    private _pushModal(name: string): void {
        const idx = this._modalStack.indexOf(name);
        if (idx >= 0) this._modalStack.splice(idx, 1);
        this._modalStack.push(name);
        this._refreshMaskVisibility();
    }

    private _removeModal(name: string): void {
        const idx = this._modalStack.indexOf(name);
        if (idx >= 0) {
            this._modalStack.splice(idx, 1);
            this._refreshMaskVisibility();
        }
    }

    /** 只有栈顶面板的 mask 可见，其余隐藏 */
    private _refreshMaskVisibility(): void {
        const topName = this._modalStack.length > 0 ? this._modalStack[this._modalStack.length - 1] : null;
        for (const name of this._modalStack) {
            const record = this._panels.get(name);
            if (record?.maskNode) {
                record.maskNode.active = (name === topName);
            }
        }
    }

    // ── 遮罩创建 ─────────────────────────────────────────

    /** 加载 mask prefab 并实例化遮罩节点 */
    private async _createMask(panelName: string, cfg?: UIPanelOptions): Promise<Node | null> {
        if (!this._maskPanelName) {
            console.warn('[Nexus] mask: true 但未调用 setMaskPanel() 指定遮罩面板');
            return null;
        }

        // 缓存 mask prefab，只加载一次
        if (!this._maskPrefab) {
            const maskCfg = this._panelConfigs.get(this._maskPanelName);
            const maskPath = maskCfg?.prefab ?? this._maskPanelName;
            const maskBundle = maskCfg?.bundle ?? 'common';
            try {
                this._maskPrefab = await this.loadPrefab(maskPath, maskBundle);
            } catch (e) {
                console.error('[Nexus] Failed to load mask prefab:', maskPath, e);
                return null;
            }
        }

        const node = instantiate(this._maskPrefab);
        node.name = `__mask_${panelName}__`;

        // maskClose: 点击遮罩关闭面板
        if (cfg?.maskClose) {
            node.on(Node.EventType.TOUCH_END, () => {
                this.hide(panelName);
            });
        }

        return node;
    }

    // ── 私有工具 ─────────────────────────────────────────

    private buildLayers(): void {
        this._layers.clear();
        for (const layer of LAYER_DEFS) {
            const node = new Node(`[Layer:${UILayer[layer]}]`);
            node.addComponent(UITransform);

            const widget = node.addComponent(Widget);
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            widget.top = widget.bottom = widget.left = widget.right = 0;
            widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

            this._root!.addChild(node);
            node.setSiblingIndex(layer);
            this._layers.set(layer, node);
        }
    }

    getLayerNode(layer: UILayer): Node {
        return this._layers.get(layer) ?? this._root!;
    }

    private async loadPrefab(nameOrPath: string, bundleOverride?: string): Promise<Prefab> {
        const path = nameOrPath.includes('/') ? nameOrPath : `prefabs/${nameOrPath}`;
        const primaryBundle = bundleOverride ?? Nexus.bundle.current;
        try {
            return await Nexus.asset.load<Prefab>(primaryBundle, path, Prefab);
        } catch {
            return await Nexus.asset.load<Prefab>('common', path, Prefab);
        }
    }

    private dispatch(node: Node, method: string, params?: unknown, panelName?: string, maskNode?: Node | null): void {
        for (const comp of node.components) {
            if (comp instanceof UIPanel) {
                if (panelName && !comp.panelName) comp.panelName = panelName;
                if (maskNode !== undefined) comp.maskNode = maskNode;
            }
            if (typeof (comp as any)[method] === 'function') {
                (comp as any)[method](params);
            }
        }
    }
}
