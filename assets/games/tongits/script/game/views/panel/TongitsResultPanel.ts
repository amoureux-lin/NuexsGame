import { _decorator, Component, Sprite ,Label ,Node, sp, Button, Vec3, UITransform, tween, UIOpacity } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { PlayerResult } from '../../../proto/tongits';
import type { SeatSnapshot } from '../player/PlayerSeatManager';
import { TongitsEvents } from '../../../config/TongitsEvents';
import { PlayerResultItem } from './PlayerResultItem';
import { ResultPlayerCard } from './ResultPlayerCard';
import { ResultDetailPanel } from './ResultDetailPanel';

const { ccclass, property } = _decorator;

/**
 * TongitsResultPanel — 游戏结算总面板
 *
 * 包含两个区域：
 *
 * ① 中间列表（固定布局）
 *   第一行：selfCard  — 自己/视角玩家，全宽突出显示
 *   第二行：otherCards[0] otherCards[1] — 其他两名玩家，各占一半
 *
 * ② 座位浮层（贴近世界坐标）
 *   playerItems[0/1/2] — 各自定位到对应座位头像世界坐标
 *   包含：头像、输赢金额、房主/自己标志、消息气泡
 *
 * 节点结构（编辑器搭建）：
 *   TongitsResultPanel（全屏遮罩，默认 active=false）
 *   ├── winBg                 赢背景（win_bg.png）
 *   ├── loseBg                输背景（lose_bg.png）
 *   ├── bgAnimation           背景 Spine 动画（Component: sp.Skeleton）
 *   ├── listArea              中间列表容器
 *   │   ├── selfCard          Component: ResultPlayerCard（第一行）
 *   │   ├── otherCard0        Component: ResultPlayerCard（第二行左）
 *   │   └── otherCard1        Component: ResultPlayerCard（第二行右）
 *   ├── playerItem0           Component: PlayerResultItem（bottom 座位浮层）
 *   ├── playerItem1           Component: PlayerResultItem（right 座位浮层）
 *   ├── playerItem2           Component: PlayerResultItem（left 座位浮层）
 *   ├── continueBtn           继续按钮
 *   └── detailsBtn            详情按钮
 *
 * bgAnimation 动画序列：
 *   赢：win_in（非循环）→ 完成后 win_loop（循环）→ 点继续 → win_out（非循环）→ 完成后隐藏
 *   输：lose_in（非循环）→ 完成后 lose_loop（循环）→ 点继续 → lose_out（非循环）→ 完成后隐藏
 */
@ccclass('TongitsResultPanel')
export class TongitsResultPanel extends Component {

    // ── 背景 ─────────────────────────────────────────────

    @property({ type: Node, tooltip: '赢背景节点（win_bg.png），自己是赢家时显示' })
    winBg: Node = null!;

    @property({ type: Node, tooltip: '输背景节点（lose_bg.png），自己是输家时显示' })
    loseBg: Node = null!;

    @property({ type: sp.Skeleton , tooltip:"背景动画（win_in/win_loop/win_out lose_in/lose_loop/lose_out）"})
    bgAnimation: sp.Skeleton = null;

    @property({ type: Node, tooltip: '信息节点' })
    infoNode: Node = null!;

    // ── 中间列表：第一行自己，第二行其他两人 ────────────

    @property({ type: ResultPlayerCard, tooltip: '第一行：自己/视角玩家卡片' })
    selfCard: ResultPlayerCard = null!;

    @property({ type: [ResultPlayerCard], tooltip: '第二行：其他两名玩家卡片（各占一半）' })
    otherCards: ResultPlayerCard[] = [];

    // ── 座位浮层（顺序对应 SeatSnapshot：bottom / right / left）──

    @property({ type: [PlayerResultItem], tooltip: '三个座位浮层，顺序对应 SeatSnapshot（bottom/right/left）' })
    playerItems: PlayerResultItem[] = [];

    // ── 按钮 ─────────────────────────────────────────────

    @property({ type: Button, tooltip: '继续按钮（continue_btn.png）' })
    continueBtn: Button = null!;

    @property({ type: Button, tooltip: '详情按钮（details_btn.png）' })
    detailsBtn: Button = null!;

    @property({ type: ResultDetailPanel, tooltip: '结算详情子面板（默认 active=false）' })
    detailPanel: ResultDetailPanel | null = null;

    @property({ type: Sprite, tooltip: '倒计时filled图'})
    countdownSprite: Sprite | null = null;

    @property({ type: Label, tooltip: '倒计时剩余秒数文本' })
    countdownLabel: Label | null = null;

    // ── 私有状态 ─────────────────────────────────────────

    /** show() 后按 playerItems 顺序缓存的 userId，供 showPlayerMessage 查找 */
    private _snapshotUserIds: number[] = [];
    /** 缓存自己输赢，供 _onContinue 播放对应 out 动画 */
    private _selfIsWinner: boolean = false;
    /** 缓存本局结算数据，供详情面板使用 */
    private _cachedResults: PlayerResult[] = [];
    private _cachedWinnerId: number = 0;

    /** 倒计时结束的 Unix 时间戳（ms） */
    private _endTimestamp: number = 0;
    /** 倒计时总时长（秒），用于计算 fillRange 比例 */
    private _totalDuration: number = 1;
    /** 倒计时是否运行中 */
    private _countdownRunning: boolean = false;

    // ── 外部回调（由 TongitsView 注入） ──────────────────

    /** 点击继续后的回调 */
    public onHide: (() => void) | null = null;

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.continueBtn?.node.on(Button.EventType.CLICK, this._onContinue, this);
        this.detailsBtn?.node.on(Button.EventType.CLICK, this._onDetails, this);
        if (this.detailPanel) {
            this.detailPanel.onClose = () => { /* 返回主结算视图，无需额外操作 */ };
        }
    }

    protected onDestroy(): void {
        this.continueBtn?.node.off(Button.EventType.CLICK, this._onContinue, this);
        this.detailsBtn?.node.off(Button.EventType.CLICK, this._onDetails, this);
        this.bgAnimation?.setCompleteListener(null);
    }

    protected update(_dt: number): void {
        if (!this._countdownRunning) return;
        const remaining = Math.max(0, (this._endTimestamp - Date.now()) / 1000);
        if (this.countdownLabel) {
            this.countdownLabel.string = String(Math.ceil(remaining));
        }
        if (this.countdownSprite) {
            this.countdownSprite.fillRange = remaining / this._totalDuration;
        }
        if (remaining <= 0) {
            this._countdownRunning = false;
        }
    }

    // ── 公开接口 ─────────────────────────────────────────

    /**
     * 显示结算面板。
     *
     * @param snapshots    来自 seatManager.getSeatSnapshots()，顺序：bottom / right / left
     * @param results      来自 GameResultBroadcast.playerResults
     * @param winnerId     胜者 userId
     * @param winType      胜利类型（1=Tongits 2=挑战 3=时间到）
     * @param selfUserId   本地玩家 userId（决定背景及 selfCard 对象）
     * @param endTimestamp 倒计时结束的 Unix 时间戳（ms），0 表示不显示倒计时
     */
    show(
        snapshots: SeatSnapshot[],
        results: PlayerResult[],
        winnerId: number,
        winType: number,
        selfUserId: number,
        endTimestamp: number = 0,
    ): void {
        this.node.active = true;

        // 缓存本局数据，供详情面板使用
        this._cachedResults   = results;
        this._cachedWinnerId  = winnerId;

        // 倒计时
        this._startCountdown(endTimestamp);

        // 背景：自己是否是赢家
        const selfIsWinner = snapshots.some(s => s.isSelf && s.userId === winnerId);
        this._selfIsWinner = selfIsWinner;

        if (this.winBg)  this.winBg.active  = selfIsWinner;
        if (this.loseBg) this.loseBg.active = !selfIsWinner;

        // 播放入场动画
        this._playInAnimation();

        // userId → PlayerResult 映射
        const resultMap = new Map<number, PlayerResult>();
        for (const r of results) {
            const uid = r.playerInfo?.playerInfo?.userId;
            if (uid) resultMap.set(uid, r);
        }

        // 自己 / 其他人分组（保持原顺序）
        const selfSnap   = snapshots.find(s => s.isSelf);
        const otherSnaps = snapshots.filter(s => !s.isSelf);

        // ── ① 中间列表 ────────────────────────────────────

        // 第一行：自己
        if (selfSnap && this.selfCard) {
            this.selfCard.setup(
                selfSnap,
                resultMap.get(selfSnap.userId) ?? null,
                selfSnap.userId === winnerId,
                winType,
            );
        } else {
            this.selfCard?.clear();
        }

        // 第二行：其他两人
        for (let i = 0; i < this.otherCards.length; i++) {
            const card = this.otherCards[i];
            if (!card) continue;
            const snap = otherSnaps[i];
            if (snap) {
                card.setup(snap, resultMap.get(snap.userId) ?? null, snap.userId === winnerId, winType);
            } else {
                card.clear();
            }
        }

        // ── ② 座位浮层 ────────────────────────────────────

        this._snapshotUserIds = snapshots.map(s => s.userId);

        for (let i = 0; i < this.playerItems.length; i++) {
            const item = this.playerItems[i];
            if (!item) continue;

            const snap = snapshots[i];
            if (!snap) {
                item.clear();
                continue;
            }

            // 头像世界坐标 → 面板本地坐标
            item.node.setPosition(this._worldToLocal(snap.avatarWorldPos));
            item.setup(snap, resultMap.get(snap.userId) ?? null, snap.userId === winnerId);
        }
    }

    /**
     * 立即隐藏面板（不触发 onHide，不播放出场动画，供 _resetToPreGame 调用）。
     */
    hide(): void {
        this.detailPanel?.hide();
        if (this.bgAnimation) {
            this.bgAnimation.setCompleteListener(null);
            this.bgAnimation.clearTracks();
        }
        // 停止 infoNode 的任何进行中渐变，立即重置为不透明
        if (this.infoNode) {
            const opacity = this.infoNode.getComponent(UIOpacity);
            if (opacity) {
                tween(opacity).stop();
                opacity.opacity = 255;
            }
        }
        this._countdownRunning = false;
        if (this.countdownSprite) this.countdownSprite.fillRange = 1;
        this.node.active = false;
    }

    /**
     * 向指定玩家的座位浮层显示消息气泡，3s 后自动隐藏。
     * show() 调用后 _snapshotUserIds 已按 playerItems 顺序填好。
     * @param userId 目标玩家 userId
     * @param text   消息内容
     */
    showPlayerMessage(userId: number, text: string): void {
        const idx = this._snapshotUserIds.indexOf(userId);
        if (idx >= 0) this.playerItems[idx]?.showMessage(text);
    }

    /**
     * 用服务端返回的最新 playerResults 刷新详情面板（CMD_RESULT_DETAILS 响应到达时调用）。
     * 若详情面板未打开则只更新缓存，不强制显示。
     */
    showDetails(results: PlayerResult[]): void {
        this._cachedResults = results;
        this.detailPanel?.refresh(results, this._cachedWinnerId);
    }

    // ── 私有：动画 ───────────────────────────────────────

    /**
     * 播放入场动画：win_in / lose_in（不循环），
     * 同步 infoNode 渐显（opacity 0→255），
     * 完成后切换到 win_loop / lose_loop（循环）。
     */
    private _playInAnimation(): void {
        const anim = this.bgAnimation;
        const prefix   = this._selfIsWinner ? 'win' : 'lose';
        const inAnim   = `${prefix}_in`;
        const loopAnim = `${prefix}_loop`;

        // infoNode 渐显：与 _in 动画同步启动
        this._fadeInfoNode(true);

        if (!anim) return;

        anim.setCompleteListener((trackEntry) => {
            if (trackEntry.animation?.name === inAnim) {
                anim.setCompleteListener(null);
                anim.setAnimation(0, loopAnim, true);
            }
        });

        anim.setAnimation(0, inAnim, false);
    }

    /**
     * 播放出场动画：win_out / lose_out（不循环），
     * 同步 infoNode 渐隐（opacity 255→0），
     * 完成后隐藏面板并触发 onHide 回调。
     */
    private _playOutAnimation(): void {
        const outAnim = this._selfIsWinner ? 'win_out' : 'lose_out';

        // infoNode 渐隐：与 _out 动画同步启动
        this._fadeInfoNode(false);

        const anim = this.bgAnimation;
        if (!anim) {
            this.node.active = false;
            this.onHide?.();
            return;
        }

        anim.setCompleteListener((trackEntry) => {
            if (trackEntry.animation?.name === outAnim) {
                anim.setCompleteListener(null);
                this._countdownRunning = false;
                this.node.active = false;
                this.onHide?.();
            }
        });

        anim.setAnimation(0, outAnim, false);
    }

    /**
     * 启动倒计时（endTimestamp=0 则仅重置不启动）。
     */
    private _startCountdown(endTimestamp: number): void {
        this._endTimestamp  = endTimestamp;
        this._totalDuration = endTimestamp > 0
            ? Math.max(1, (endTimestamp - Date.now()) / 1000)
            : 1;
        console.log("1111111:",Date.now())
        console.log("1111112:",endTimestamp)
        console.log("1111113:",endTimestamp - Date.now())
        this._countdownRunning = endTimestamp > Date.now();

        // 立即刷新一次，防止首帧残留
        const remaining = endTimestamp > 0
            ? Math.max(0, (endTimestamp - Date.now()) / 1000)
            : 0;
        if (this.countdownLabel) {
            this.countdownLabel.string = endTimestamp > 0 ? String(Math.ceil(remaining)) : '';
        }
        if (this.countdownSprite) {
            this.countdownSprite.fillRange = endTimestamp > 0 ? 1 : 0;
        }
    }

    /**
     * 对 infoNode 做渐显或渐隐。
     * 时长与 Spine _in/_out 动画保持一致（默认 0.5s，可按实际动画时长调整）。
     * @param fadeIn true=渐显 false=渐隐
     */
    private _fadeInfoNode(fadeIn: boolean): void {
        if (!this.infoNode) return;

        // 确保 UIOpacity 组件存在
        let opacity = this.infoNode.getComponent(UIOpacity);
        if (!opacity) opacity = this.infoNode.addComponent(UIOpacity);

        tween(opacity)
            .stop()
            .set({ opacity: fadeIn ? 0 : 255 })
            .to(1, { opacity: fadeIn ? 255 : 0 })
            .start();
    }

    // ── 私有 ─────────────────────────────────────────────

    private _onContinue(): void {
        this._playOutAnimation();
    }

    private _onDetails(): void {
        if (this.detailPanel && this._cachedResults.length) {
            this.detailPanel.show(this._cachedResults, this._cachedWinnerId);
        }
        Nexus.emit(TongitsEvents.CMD_RESULT_DETAILS);
    }

    /** 将世界坐标转换为本节点的局部坐标 */
    private _worldToLocal(worldPos: Vec3): Vec3 {
        const uit = this.node.getComponent(UITransform);
        if (uit) return uit.convertToNodeSpaceAR(worldPos);
        const out = new Vec3();
        this.node.inverseTransformPoint(out, worldPos);
        return out;
    }
}
