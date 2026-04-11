import { _decorator, UITransform,Component, Node, sp,Label,Prefab,Vec3,tween } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
const { ccclass, property } = _decorator;

/** 对象池 key，与其他模块隔离 */
const COIN_POOL_KEY = 'tongits_coin_fly';

@ccclass('GameStartEffect')
export class GameStartEffect extends Component {

    // ── Inspector 配置 ────────────────────────────────────

    /** 屏幕中心汇聚锚点（不可见空节点） */
    @property(Node)
    centerAnchor: Node = null!;

    /** Spine 骨骼动画组件 */
    @property(sp.Skeleton)
    skeleton: sp.Skeleton = null!;

    /** 顶部金币图标（Phase2 飞行终点） */
    @property(Node)
    coinIconTarget: Node = null!;

    /** 顶部奖池金额 Label */
    @property(Label)
    potAmountLabel: Label = null!;

    /** 单个飞行金币预制体 */
    @property(Prefab)
    coinPrefab: Prefab = null!;

    // ── 配置常量 ──────────────────────────────────────────

    /** 每个座位发射的金币数量 */
    private readonly COINS_PER_SEAT = 10;
    /** Phase1 单个金币飞行时长（秒） */
    private readonly FLY_TO_CENTER_DUR = 0.15;
    /** Phase1 金币发射错开间隔（秒） */
    private readonly STAGGER = 0.03;
    /** Phase2 金币飞向图标时长 */
    private readonly FLY_TO_ICON_DUR = 0.3;
    /** Phase2 数字滚动时长 */
    private readonly COUNTER_DUR = 0.2;
    /** 图标 bounce 放大倍数 */
    private readonly ICON_BOUNCE_SCALE = 1.35;

    // ── 公开接口 ──────────────────────────────────────────

    /**
     * 播放完整开场序列。
     * @param avatarWorldPositions  各座位头像的世界坐标（由 PlayerSeatManager 提供）
     * @param potAmount             奖池目标金额
     * @param onDone                全部完成后回调（用于触发发牌）
     */
    playSequence(
        avatarWorldPositions: Vec3[],
        potAmount: number,
        onDone: () => void,
    ): void {
        this.node.active = true;
        this._phase1_flyToCenter(avatarWorldPositions)
            .then(() => this._phase2_flyToIcon(potAmount))
            .then(() => this._phase3_skeleton())
            .then(() => {
                this.node.active = false;
                onDone();
            });
    }

    // ── 暂存：Phase1 落地后停留在中心的金币 ─────────────────
    private _stagedCoins: Node[] = [];

    // ── Phase 1: 金币从座位飞向中心，落地后停留 ─────────────

    private async _phase1_flyToCenter(worldPositions: Vec3[]): Promise<void> {
        await Nexus.audio.playSfx("res/audios/collectmoney");
        this._stagedCoins = [];
        return new Promise(resolve => {
            const centerLocal = this._worldToFlyLayer(
                this.centerAnchor.getWorldPosition()
            );

            let total = 0;
            let arrived = 0;

            for (const wPos of worldPositions) {
                const startLocal = this._worldToFlyLayer(wPos);
                for (let i = 0; i < this.COINS_PER_SEAT; i++) {
                    total++;
                    const delay = i * this.STAGGER;
                    // 落地后在中心点周围随机分布
                    const landPos = centerLocal.clone().add(new Vec3(
                        (Math.random() - 0.5) * 80,
                        (Math.random() - 0.5) * 80,
                        0,
                    ));
                    const coin = this._getCoin(startLocal);
                    tween(coin)
                        .delay(delay)
                        .to(this.FLY_TO_CENTER_DUR,
                            { position: landPos },
                            { easing: 'quadIn' })
                        .call(() => {
                            // 落地后留在原位，存入暂存列表
                            this._stagedCoins.push(coin);
                            arrived++;
                            if (arrived >= total) resolve();
                        })
                        .start();
                }
            }

            // 防御：无座位时直接跳过
            if (total === 0) resolve();
        });
    }

    // ── Phase 2: 暂存金币一起飞向顶部图标 + 数字滚动 ────────

    private _phase2_flyToIcon(potAmount: number): Promise<void> {
        return new Promise(resolve => {
            const targetLocal = this._worldToFlyLayer(
                this.coinIconTarget.getWorldPosition()
            );

            const coins = this._stagedCoins;
            this._stagedCoins = [];
            const total = coins.length;

            if (total === 0) {
                this._animateCounter(potAmount, () => resolve());
                return;
            }

            // 所有金币同时飞向图标，飞行时长相同
            for (const coin of coins) {
                tween(coin)
                    .to(this.FLY_TO_ICON_DUR,
                        { position: targetLocal },
                        { easing: 'quadOut' })
                    .call(() => this._recycleCoin(coin))
                    .start();
            }
            // 飞行结束时 bounce 图标
            this.scheduleOnce(() => this._bounceNode(this.coinIconTarget), this.FLY_TO_ICON_DUR);

            // 数字滚动与飞行并行，两者都完成后 resolve
            let counterDone = false;
            let flyDone = false;
            const tryResolve = () => { if (counterDone && flyDone) resolve(); };

            this._animateCounter(potAmount, () => { counterDone = true; tryResolve(); });
            this.scheduleOnce(() => { flyDone = true; tryResolve(); },
                this.FLY_TO_ICON_DUR + 0.1);
        });
    }

    // ── Phase 3: Skeleton 动画 ────────────────────────────

    private _phase3_skeleton(): Promise<void> {
        return new Promise(resolve => {
            if (!this.skeleton) { resolve(); return; }
            this.skeleton.node.active = true;
            // 播放指定动画，监听完成事件
            this.skeleton.setCompleteListener((entry) => {
                if (entry.animation?.name === 'startgame') {
                    this.skeleton.setCompleteListener(null);
                    this.skeleton.node.active = false;
                    resolve();
                }
            });
            this.skeleton.setAnimation(0, 'startgame', false);
        });
    }

    // ── 工具方法 ──────────────────────────────────────────

    private _animateCounter(target: number, onDone: () => void): void {
        if (!this.potAmountLabel) { onDone(); return; }
        const obj = { val: 0 };
        tween(obj)
            .to(this.COUNTER_DUR, { val: target }, {
                easing: 'quadOut',
                onUpdate: () => {
                    this.potAmountLabel.string = Math.floor(obj.val).toString();
                },
            })
            .call(onDone)
            .start();
    }

    private _bounceNode(node: Node): void {
        const s = this.ICON_BOUNCE_SCALE;
        tween(node)
            .to(0.12, { scale: new Vec3(s, s, 1) }, { easing: 'quadOut' })
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();
    }

    /** 世界坐标 → this.node 本地坐标 */
    private _worldToFlyLayer(worldPos: Vec3): Vec3 {
        return this.node
            .getComponent(UITransform)!
            .convertToNodeSpaceAR(worldPos);
    }

    // ── 对象池（Nexus.pool） ──────────────────────────────

    protected onLoad(): void {
        if (this.coinPrefab) {
            Nexus.pool.preload(COIN_POOL_KEY, this.coinPrefab, 20);
        }
    }

    protected onDestroy(): void {
        Nexus.pool.clear(COIN_POOL_KEY);
    }

    private _getCoin(localPos: Vec3): Node {
        const coin = Nexus.pool.get(COIN_POOL_KEY, this.coinPrefab)!;
        coin.setParent(this.node);
        coin.setPosition(localPos);
        coin.setScale(Vec3.ONE);
        coin.active = true;
        return coin;
    }

    private _recycleCoin(coin: Node): void {
        coin.active = false;
        Nexus.pool.put(COIN_POOL_KEY, coin);
    }
}

