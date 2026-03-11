import { director, instantiate, Label, Node, Prefab, UITransform, Vec3, Widget } from 'cc';
import { Nexus } from '../core/Nexus';
import { IUIService, UILayer } from '../services/contracts';

interface PanelRecord {
    node:  Node;
    layer: UILayer;
}

/** 按 UILayer 值排列的层定义（顺序即 z 序） */
const LAYER_DEFS: UILayer[] = [
    UILayer.SCENE,
    UILayer.PANEL,
    UILayer.POPUP,
    UILayer.TIPS,
    UILayer.LOADING,
    UILayer.TOP,
];

/**
 * 基于 Node + Prefab + instantiate 的 UI 管理实现。
 *
 * 层级结构（挂在 canvasRoot 下）：
 *   [Layer:SCENE]   z=0
 *   [Layer:PANEL]   z=100
 *   [Layer:POPUP]   z=200
 *   [Layer:TIPS]    z=300
 *   [Layer:LOADING] z=400
 *   [Layer:TOP]     z=500
 *
 * Prefab 查找规则：优先从当前 Bundle 的 prefabs/<name> 加载，
 * 找不到则 fallback 到 common Bundle。
 */
export class UIServiceImpl extends IUIService {

    private _root: Node | null = null;
    private readonly _layers  = new Map<UILayer, Node>();
    private readonly _panels  = new Map<string, PanelRecord>();
    private _loadingNode: Node | null = null;
    private _loadingLabel: Label | null = null;

    /** 设置 UI 挂载根节点，并初始化各层级容器。 */
    setRoot(root: Node): void {
        this._root = root as Node;
        // 添加到持久化根节点
        director.addPersistRootNode(root);
        this.buildLayers();
    }

    /** 显示面板；如果已存在则仅重新激活并分发 onShow。返回面板根节点。 */
    async show(name: string, params?: unknown, layer: UILayer = UILayer.PANEL): Promise<Node> {
        // 已存在：直接显示并透传参数
        const existing = this._panels.get(name);
        if (existing) {
            existing.node.active = true;
            this.dispatch(existing.node, 'onShow', params);
            return existing.node;
        }

        const prefab = await this.loadPrefab(name);
        const node   = instantiate(prefab);

        this.getLayerNode(layer).addChild(node);
        this._panels.set(name, { node, layer });
        this.dispatch(node, 'onShow', params);
        return node;
    }

    /** 隐藏已创建的面板，并分发 onHide。 */
    hide(name: string): void {
        const record = this._panels.get(name);
        if (!record) return;
        record.node.active = false;
        this.dispatch(record.node, 'onHide');
    }

    /** 销毁面板节点并移除缓存。 */
    destroy(name: string): void {
        const record = this._panels.get(name);
        if (!record) return;
        this.dispatch(record.node, 'onHide');
        record.node.destroy();
        this._panels.delete(name);
    }

    /** 显示全局 Loading，并更新提示文本。 */
    showLoading(text = ''): void {
        const loading = this.ensureLoadingNode();
        if (this._loadingLabel) {
            this._loadingLabel.string = text || 'Loading...';
        }
        loading.active = true;
        this.dispatch(loading, 'onShow', { text: this._loadingLabel?.string ?? text });
    }

    /** 隐藏全局 Loading。 */
    hideLoading(): void {
        this.ensureLoadingNode().active = false;
    }

    /** Bundle 切换离开时销毁所有非持久面板 */
    async onBundleExit(_bundleName: string): Promise<void> {
        for (const [name, record] of [...this._panels.entries()]) {
            this.dispatch(record.node, 'onHide');
            record.node.destroy();
            this._panels.delete(name);
        }
    }

    /** 销毁时清空所有运行时缓存。 */
    async onDestroy(): Promise<void> {
        this._panels.clear();
        this._layers.clear();
        this._loadingNode = null;
        this._loadingLabel = null;
        this._root = null;
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

        this._loadingNode = null;
        this._loadingLabel = null;
    }

    /** 获取指定层级节点，缺省时回退到根节点。 */
    private getLayerNode(layer: UILayer): Node {
        return this._layers.get(layer) ?? this._root!;
    }

    /** 延迟创建默认 Loading 节点。 */
    private ensureLoadingNode(): Node {
        if (this._loadingNode?.isValid) {
            return this._loadingNode;
        }

        const loading = new Node('[Loading]');
        loading.addComponent(UITransform);

        const labelNode = new Node('Label');
        labelNode.addComponent(UITransform);
        labelNode.setPosition(new Vec3(0, 0, 0));

        const label = labelNode.addComponent(Label);
        label.string = 'Loading...';
        label.fontSize = 36;
        label.lineHeight = 40;

        loading.addChild(labelNode);
        loading.active = false;

        this.getLayerNode(UILayer.LOADING).addChild(loading);
        this._loadingNode = loading;
        this._loadingLabel = label;

        return loading;
    }

    /** 优先从当前 Bundle 加载，失败则 fallback 到 common */
    private async loadPrefab(name: string): Promise<Prefab> {
        const path = `prefabs/${name}`;
        try {
            return await Nexus.asset.load<Prefab>(Nexus.bundle.current, path, Prefab);
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
