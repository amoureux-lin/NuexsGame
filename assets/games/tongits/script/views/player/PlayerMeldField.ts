/**
 * PlayerMeldField — 玩家牌组展示区
 *
 * 节点结构（编辑器中搭建）：
 *   PlayerMeldField (this.node)
 *   ├── bg      — 背景 Sprite
 *   └── content — 内容容器，MeldRow 动态添加到此；宽度即布局可用宽
 *       ├── MeldRow (Anchor 0.5,0.5) ← 运行时动态生成
 *       └── ...
 *
 * content 节点 Anchor 与布局方向对应：
 *   - 自己（singleRow=true） ：Anchor (0.5, 0.5)，水平居中，LTR
 *   - left 玩家（rtl=false） ：Anchor (0,   1)，左边缘起点，LTR
 *   - right 玩家（rtl=true） ：Anchor (1,   1)，右边缘起点，RTL
 */

import { _decorator, Component, Node, Prefab, instantiate, Vec3, tween, Tween, UITransform, UIOpacity, sp } from 'cc';
import { CardNode, DEFAULT_CARD_W, DEFAULT_CARD_H, CARD_SPACING } from '../handcard/CardNode';
import type { Meld } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/** 牌区内每张牌的缩放比例 */
const CARD_SCALE = 0.4;

/** 飞入动画时长（秒） */
const FLY_DUR = 0.35;
/** 展开动画时长（秒） */
const EXPAND_DUR = 0.25;
/** 每张牌展开的错开时间（秒） */
const EXPAND_STAGGER = 0.03;

@ccclass('PlayerMeldField')
export class PlayerMeldField extends Component {

    @property({ type: Prefab, tooltip: '牌面预制体（与 HandCardPanel 共用同一份）' })
    cardPrefab: Prefab | null = null;

    @property({ type: Node, tooltip: '内容容器节点，MeldRow 动态添加到此节点，宽度即布局可用宽' })
    contentNode: Node = null!;

    @property({ type: Node, tooltip: '背景节点（可选），行数增加时自动拉高' })
    bgNode: Node | null = null;

    @property({ type: Prefab, tooltip: '落牌光效 skeleton 预制体（飞入结束后播放一次）' })
    meldLightPrefab: Prefab | null = null;

    @property({ tooltip: '四周内边距（px）' })
    padding: number = 8;

    @property({ tooltip: '同行牌组块之间的间距（px）' })
    blockSpacing: number = 10;

    @property({ tooltip: '行与行之间的垂直间距（px）' })
    rowSpacing: number = 8;

    @property({ tooltip: '从右向左排列（right玩家设为 true，content Anchor (1,1)）' })
    rtl: boolean = false;

    @property({ tooltip: '单行模式：全部牌组排在同一行不换行（自己用，content Anchor (0.5,1)）' })
    singleRow: boolean = false;

    // ── 内部状态 ──────────────────────────────────────────

    /** 已添加的 meldId 集合（防重复） */
    private _placedIds = new Set<number>();
    /** 行列表，每行记录已用宽度与行节点 */
    private _rows: Array<{ node: Node; usedWidth: number }> = [];
    /** meldId → blockNode，供 layOffToMeld 定位目标块 */
    private _blocks = new Map<number, Node>();
    /** bgNode 呼吸动画 tween 句柄 */
    private _bgTween: Tween<UIOpacity> | null = null;
    /** 从 prefab 读取的实际牌宽（缩放前） */
    private _rawCardW: number = DEFAULT_CARD_W;
    /** 从 prefab 读取的实际牌高（缩放前） */
    private _rawCardH: number = DEFAULT_CARD_H;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        if (this.bgNode) this.bgNode.active = false;

        if (this.cardPrefab) {
            const n  = instantiate(this.cardPrefab);
            const tf = n.getComponent(UITransform);
            if (tf && tf.width > 0 && tf.height > 0) {
                this._rawCardW = tf.width;
                this._rawCardH = tf.height;
            }
            n.destroy();
        }
    }

    protected onDestroy(): void {
        this._bgTween?.stop();
        this._bgTween = null;
    }

    // ── 计算属性 ──────────────────────────────────────────

    /** contentNode 的可用宽度 */
    private get _contentW(): number {
        return this.contentNode?.getComponent(UITransform)?.contentSize.width ?? 0;
    }

    private get _innerW(): number { return this._contentW - this.padding * 2; }

    /** 缩放后单张牌宽 */
    private get _cw(): number { return this._rawCardW * CARD_SCALE; }
    /** 缩放后相邻牌中心间距 */
    private get _step(): number { return CARD_SPACING  * CARD_SCALE; }
    /** 缩放后单张牌高 */
    private get _ch(): number { return this._rawCardH * CARD_SCALE; }

    private _blockW(cardCount: number): number {
        return this._cw + this._step * (cardCount - 1);
    }

    // ── 回合高亮 ──────────────────────────────────────────

    /** 轮到该玩家时：显示 bgNode 并播放呼吸动画 */
    startTurnHighlight(): void {
        if (!this.bgNode) return;
        this.bgNode.active = true;
        const opacity = this.bgNode.getComponent(UIOpacity);
        if (!opacity) return;
        opacity.opacity = 255;
        this._bgTween?.stop();
        this._bgTween = tween(opacity)
            .to(0.8, { opacity: 60 },  { easing: 'sineInOut' })
            .to(0.8, { opacity: 255 }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    /** 回合结束时：停止动画并隐藏 bgNode */
    stopTurnHighlight(): void {
        this._bgTween?.stop();
        this._bgTween = null;
        if (this.bgNode) this.bgNode.active = false;
    }

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 新增一个 Meld 展示块（First-Fit Shelf 定位）。
     * 已存在的 meldId 会被忽略（防止重复添加）。
     *
     * @param meld         牌组数据
     * @param fromWorldPos 飞入起始世界坐标（传入时播放飞入 + 展开动画）
     */
    addMeld(meld: Meld, fromWorldPos?: Vec3): void {
        if (!meld || meld.cards.length === 0) return;
        if (this._placedIds.has(meld.meldId)) return;
        this._placedIds.add(meld.meldId);

        const bw        = this._blockW(meld.cards.length);
        const blockNode = this._createBlock(meld, !!fromWorldPos);
        this._fitBlock(blockNode, bw);
        this._blocks.set(meld.meldId, blockNode);

        if (fromWorldPos) {
            this._animateMeldFlyIn(blockNode, fromWorldPos, meld.cards.length);
        } else {
            this._playMeldLight(blockNode, meld.cards.length);
        }
    }

    /** 全量重建（重连 / 游戏恢复时调用） */
    setMelds(melds: Meld[]): void {
        this.clear();
        for (const m of melds) this.addMeld(m);
    }

    /** 清空所有展示节点与状态 */
    clear(): void {
        for (const row of this._rows) {
            if (row.node?.isValid) row.node.destroy();
        }
        this._rows = [];
        this._placedIds.clear();
        this._blocks.clear();
    }

    /**
     * Sapaw 补牌动画：将一张新牌插入已有 meld 块，并重排同行后续块（含换行处理）。
     *
     * @param meldId       目标 meld 的 id
     * @param newCard      新牌编号
     * @param insertIndex  插入位置（0-based，超出范围自动 clamp 到末尾）
     * @param fromWorldPos 新牌飞入起始世界坐标（不传则直接出现在目标位置）
     */
    layOffToMeld(meldId: number, newCard: number, insertIndex: number, fromWorldPos?: Vec3): void {
        const blockNode = this._blocks.get(meldId);
        if (!blockNode || !blockNode.isValid) return;

        const step       = this._step;
        const cw         = this._cw;
        const cardCount  = blockNode.children.length;
        const clampedIdx = Math.max(0, Math.min(insertIndex, cardCount));

        const CARD_DUR     = 0.18;
        const CARD_STAGGER = 0.04;
        const REFLOW_DUR   = 0.22;

        // ── 1. 目标块内：index >= clampedIdx 的牌逐个右移 ─────────
        for (let i = clampedIdx; i < cardCount; i++) {
            const card = blockNode.children[i];
            tween(card)
                .delay((i - clampedIdx) * CARD_STAGGER)
                .to(CARD_DUR, { position: new Vec3(cw / 2 + (i + 1) * step, 0, 0) }, { easing: 'quadOut' })
                .start();
        }

        // ── 2. 创建新牌节点，插入到正确 siblingIndex ─────────────
        const n  = this.cardPrefab ? instantiate(this.cardPrefab) : new Node('MeldCard');
        const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);
        cn.setCard(newCard);
        cn.setFaceDown(false);
        cn.onClick = null;
        n.setScale(CARD_SCALE, CARD_SCALE, 1);
        blockNode.addChild(n);
        n.setSiblingIndex(clampedIdx);

        const finalX   = cw / 2 + clampedIdx * step;
        const shiftEnd = cardCount > clampedIdx
            ? (cardCount - clampedIdx - 1) * CARD_STAGGER + CARD_DUR
            : 0;

        if (fromWorldPos) {
            n.setWorldPosition(fromWorldPos);
            n.setScale(0.5, 0.5, 1);
            tween(n)
                .delay(shiftEnd)
                .to(FLY_DUR, { position: new Vec3(finalX, 0, 0), scale: new Vec3(CARD_SCALE, CARD_SCALE, 1) }, { easing: 'quadOut' })
                .call(() => this._playMeldLight(blockNode, blockNode.children.length))
                .start();
        } else {
            n.setPosition(finalX, 0, 0);
            tween(n)
                .delay(shiftEnd)
                .call(() => this._playMeldLight(blockNode, blockNode.children.length))
                .start();
        }

        // ── 3. 同行后续块平移 + 行溢出换行 ───────────────────────
        const rowNode  = blockNode.parent!;
        const rowIdx   = this._rows.findIndex(r => r.node === rowNode);
        if (rowIdx < 0) return;

        const row      = this._rows[rowIdx];
        const posInRow = rowNode.children.indexOf(blockNode);
        // 本行新增了 step 宽度
        row.usedWidth += step;

        // RTL：block 右边缘锚定，block 向左扩展，所以 blockNode 自身左移 step
        if (this.rtl) {
            tween(blockNode)
                .to(REFLOW_DUR, { position: new Vec3(blockNode.position.x - step, 0, 0) }, { easing: 'quadOut' })
                .start();
        }

        if (this.singleRow) {
            // 单行模式：仅平移后续块，不处理溢出
            this._shiftBlocksAfter(blockNode, step, REFLOW_DUR);
            return;
        }

        // 收集后续块（不含 blockNode 自身）
        const blocksAfter: Node[] = Array.from(rowNode.children).slice(posInRow + 1);

        // 从末尾虚拟移除，确定溢出集合（不能越过目标块自身）
        const overflowNodes: Node[] = [];
        let virtualLen = rowNode.children.length;
        while (row.usedWidth > this._innerW + 0.5 && virtualLen > posInRow + 1) {
            const last  = rowNode.children[virtualLen - 1];
            const lastW = this._blockW(last.children.length);
            const sep   = virtualLen > 1 ? this.blockSpacing : 0;
            row.usedWidth -= (lastW + sep);
            overflowNodes.unshift(last); // 保持原顺序
            virtualLen--;
        }

        // 留在本行的后续块：平移 shiftDir * step
        const shiftDir = this.rtl ? -1 : 1;
        for (const b of blocksAfter) {
            if (overflowNodes.includes(b)) continue;
            tween(b)
                .to(REFLOW_DUR, { position: new Vec3(b.position.x + shiftDir * step, 0, 0) }, { easing: 'quadOut' })
                .start();
        }

        // 溢出块依次移到下一行
        for (const b of overflowNodes) {
            this._moveBlockToNextRow(b, rowIdx + 1, REFLOW_DUR);
        }
    }

    // ── 私有：补牌重排 ────────────────────────────────────

    /** 单行模式：平移 blockNode 之后的所有兄弟节点 */
    private _shiftBlocksAfter(blockNode: Node, delta: number, dur: number): void {
        const siblings = blockNode.parent!.children;
        const idx      = siblings.indexOf(blockNode);
        const dir      = this.rtl ? -1 : 1;
        for (let i = idx + 1; i < siblings.length; i++) {
            const b = siblings[i];
            tween(b)
                .to(dur, { position: new Vec3(b.position.x + dir * delta, 0, 0) }, { easing: 'quadOut' })
                .start();
        }
    }

    /**
     * 将 blockNode 移到第 nextRowIdx 行（若不存在则新建），
     * 保留视觉位置后 tween 到目标坐标；若目标行也溢出则递归。
     */
    private _moveBlockToNextRow(blockNode: Node, nextRowIdx: number, dur: number): void {
        const nextRow = nextRowIdx < this._rows.length
            ? this._rows[nextRowIdx]
            : this._newRow();

        const bW    = this._blockW(blockNode.children.length);
        const extra = nextRow.usedWidth > 0 ? this.blockSpacing : 0;
        const off   = nextRow.usedWidth + extra;
        const targetX = this.rtl
            ? -(this.padding + off + bW)
            :   this.padding + off;

        // reparent 保持视觉位置，再 tween 到目标本地坐标
        const wp = blockNode.worldPosition.clone();
        nextRow.node.addChild(blockNode);
        blockNode.setWorldPosition(wp);
        tween(blockNode)
            .to(dur, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' })
            .start();

        nextRow.usedWidth += extra + bW;

        // 若目标行也溢出，将其末尾 block 继续下移
        if (nextRow.usedWidth > this._innerW + 0.5 && nextRow.node.children.length > 1) {
            const last  = nextRow.node.children[nextRow.node.children.length - 1];
            const lastW = this._blockW(last.children.length);
            nextRow.usedWidth -= (lastW + this.blockSpacing);
            this._moveBlockToNextRow(last, nextRowIdx + 1, dur);
        }
    }

    // ── 私有：布局 ────────────────────────────────────────

    /** First-Fit 定位：找合适行放入块节点 */
    private _fitBlock(blockNode: Node, bw: number): void {
        if (this.singleRow) {
            this._placeInRow(this._rows[0] ?? this._newRow(), blockNode, bw);
            return;
        }
        for (const row of this._rows) {
            const extra = row.usedWidth > 0 ? this.blockSpacing : 0;
            if (row.usedWidth + extra + bw <= this._innerW) {
                this._placeInRow(row, blockNode, bw);
                return;
            }
        }
        this._placeInRow(this._newRow(), blockNode, bw);
    }

    private _newRow(): { node: Node; usedWidth: number } {
        const rowNode = new Node('MeldRow');
        // MeldRow anchor (0.5,0.5)
        // 自己(0.5,0.5)：content 中心为原点，MeldRow 直接在 y=0（垂直居中）
        // left/right(0or1, 1)：content 顶边为原点，行中心 = -(padding + ch/2) 起向下
        const y = this.singleRow
            ? 0
            : -(this.padding + this._ch / 2) - this._rows.length * (this._ch + this.rowSpacing);
        rowNode.setPosition(0, y, 0);
        this.contentNode.addChild(rowNode);
        const row = { node: rowNode, usedWidth: 0 };
        this._rows.push(row);
        return row;
    }

    private _placeInRow(
        row: { node: Node; usedWidth: number },
        blockNode: Node,
        bw: number,
    ): void {
        const extra  = row.usedWidth > 0 ? this.blockSpacing : 0;
        const offset = row.usedWidth + extra;

        let x: number;
        if (this.singleRow) {
            // 自己：content Anchor (0.5,0.5)，中心为原点
            x = -(this._innerW / 2) + offset;
        } else if (this.rtl) {
            // right 玩家：content Anchor (1,1)，右边缘为原点，向左排
            x = -(this.padding + offset + bw);
        } else {
            // left 玩家：content Anchor (0,1)，左边缘为原点，向右排
            x = this.padding + offset;
        }

        blockNode.setPosition(x, 0, 0);
        row.node.addChild(blockNode);
        row.usedWidth += extra + bw;
    }

    // ── 私有：牌块创建 ────────────────────────────────────

    /**
     * @param meld
     * @param stacked true 时所有牌叠在第一张位置（用于飞入动画起始状态）
     */
    private _createBlock(meld: Meld, stacked = false): Node {
        const blockNode = new Node(`Meld_${meld.meldId}`);
        const cw   = this._cw;
        const step = this._step;

        for (let i = 0; i < meld.cards.length; i++) {
            const n  = this.cardPrefab ? instantiate(this.cardPrefab) : new Node('MeldCard');
            const cn = n.getComponent(CardNode) ?? n.addComponent(CardNode);

            cn.setCard(meld.cards[i]);
            cn.setFaceDown(false);
            cn.onClick = null;

            n.setScale(CARD_SCALE, CARD_SCALE, 1);
            n.setPosition(stacked ? cw / 2 : cw / 2 + i * step, 0, 0);
            n.setSiblingIndex(i);
            blockNode.addChild(n);
        }
        return blockNode;
    }

    // ── 私有：飞入动画 ────────────────────────────────────

    private _animateMeldFlyIn(blockNode: Node, fromWorldPos: Vec3, cardCount: number): void {
        // 保存最终本地坐标（_placeInRow 已设置好），再用 setWorldPosition 移到起始位置
        const finalPos = new Vec3(blockNode.position.x, blockNode.position.y, 0);
        blockNode.setWorldPosition(fromWorldPos);
        blockNode.setScale(0.5,0.5)
        // 整块飞向目标位置，结束后播放落牌光效
        tween(blockNode)
            .to(FLY_DUR, { position: finalPos, scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
            .call(() => this._playMeldLight(blockNode, cardCount))
            .start();

        // 同步展开：每张牌从叠放位置错开滑向最终 x
        const cw   = this._cw;
        const step = this._step;
        for (let i = 0; i < cardCount; i++) {
            const card    = blockNode.children[i];
            const targetX = cw / 2 + i * step;
            tween(card)
                .delay(i * EXPAND_STAGGER)
                .to(EXPAND_DUR, { position: new Vec3(targetX, 0, 0) }, { easing: 'quadOut' })
                .start();
        }
    }

    private _playMeldLight(blockNode: Node, cardCount: number): void {
        if (!this.meldLightPrefab || !blockNode.isValid) return;
        const light = instantiate(this.meldLightPrefab);
        // 居中对齐 block（block 从 x=0 延伸到 bw）
        light.setPosition(this._blockW(cardCount) / 2, 0, 0);
        blockNode.addChild(light);
        const skeleton = light.getComponent(sp.Skeleton);
        if (!skeleton) { light.destroy(); return; }
        skeleton.setAnimation(0, 'drop_card', false);
        skeleton.setCompleteListener(() => {
            if (light.isValid) light.destroy();
        });

        // 同步：每张牌错开放大再回弹
        const normal = new Vec3(CARD_SCALE, CARD_SCALE, 1);
        const pop    = new Vec3(CARD_SCALE * 1.3, CARD_SCALE * 1.3, 1);
        for (let i = 0; i < cardCount; i++) {
            const card = blockNode.children[i];
            tween(card)
                .delay(i * 0.06)
                .to(0.1, { scale: pop  }, { easing: 'quadOut' })
                .to(0.1, { scale: normal }, { easing: 'quadIn'  })
                .start();
        }
    }
}
