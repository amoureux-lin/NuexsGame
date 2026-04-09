import { _decorator, Component, Node, Label, Sprite, SpriteFrame, EventTouch,Button} from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { TongitsPlayerInfo } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/**
 * PlayerSeat — 单个玩家座位组件
 *
 * 职责：
 *   - 纯展示层，接收 TongitsPlayerInfo 数据后刷新 UI
 *   - 不持有业务逻辑，状态全由外部 (PlayerSeatManager) 驱动
 *
 * 节点结构建议（Prefab）：
 *   PlayerSeat
 *   ├── emptyNode          空座位占位（无人时显示）
 *   └── occupiedNode       有玩家时的根节点
 *       ├── avatarSprite   头像
 *       ├── nameLabel      昵称
 *       ├── coinLabel      金币
 *       ├── cardCountNode  手牌数区域（对手可见）
 *       │   └── cardCountLabel
 *       ├── ownerIcon      房主标志
 *       ├── readyIcon      已准备标志
 *       ├── offlineIcon    离线标志
 *       ├── actionNode     当前操作高亮框
 *       └── countdownNode  倒计时容器
 *           └── countdownLabel
 */
@ccclass('PlayerSeat')
export class PlayerSeat extends Component {

    // ── 节点引用 ─────────────────────────────────────────

    /** 空座位节点（无人时显示） */
    @property({ type: Node, tooltip: '空座位占位节点，无人时显示' })
    emptyNode: Node = null!;

    /** 有玩家时的根容器 */
    @property({ type: Node, tooltip: '有玩家时的根容器，无人时隐藏' })
    occupiedNode: Node = null!;

    /** 头像 Sprite */
    @property({ type: Sprite, tooltip: '玩家头像 Sprite 组件' })
    avatarSprite: Sprite = null!;

    /** 昵称 Label */
    @property({ type: Label, tooltip: '玩家昵称文本' })
    nameLabel: Label = null!;

    /** 金币 Label */
    @property({ type: Label, tooltip: '玩家金币数量文本' })
    coinLabel: Label = null!;

    /** 房主图标 */
    @property({ type: Node, tooltip: '房主标志节点，玩家 post === 1 时显示' })
    ownerIcon: Node = null!;

    /** 自己图标 */
    @property({ type: Node, tooltip: '自己标志节点' })
    meIcon: Node = null!;

    /** 踢人按钮 */
    @property({ type: Button, tooltip: '踢人按钮节点' })
    kickBtn: Button = null!;


    /** 已准备图标 */
    @property({ type: Node, tooltip: '已准备标志节点，玩家 state === 1 时显示' })
    readyIcon: Node = null!;

    /** 手牌数量节点（对手用，显示牌背数） */
    @property({ type: Node, tooltip: '手牌数量区域，对手可见，自己隐藏（由 HandCardPanel 接管）' })
    cardCountNode: Node = null!;

    /** 手牌数量 Label */
    @property({ type: Label, tooltip: '对手手牌数量文本（显示牌背数）' })
    cardCountLabel: Label = null!;

    /** 离线图标 */
    @property({ type: Node, tooltip: '离线标志节点，玩家 state === 3 时显示' })
    offlineIcon: Node = null!;

    /** 当前操作高亮（轮到此玩家时显示） */
    @property({ type: Node, tooltip: '当前操作高亮框，轮到此玩家操作时显示' })
    actionNode: Node = null!;

    /** 倒计时容器节点 */
    @property({ type: Sprite, tooltip: '倒计时容器节点，操作高亮时与 actionNode 同步显隐' })
    countdownNode: Sprite = null!;

    /** 倒计时数字 Label */
    @property({ type: Label, tooltip: '倒计时剩余秒数文本' })
    countdownLabel: Label = null!;

    // ── 私有状态 ─────────────────────────────────────────

    private _data: TongitsPlayerInfo | null = null;
    private _isSelf: boolean = false;
    /** 在屏幕上的位置索引：0=下方(自己), 1=左, 2=右 */
    private _seatIndex: number = 0;
    /** 服务端座位号（1-based），空座位时由 Manager 直接传入，不依赖 playerInfo */
    private _serverSeat: number = 0;
    /** 已加载的头像 URL，避免重复请求同一张图 */
    private _loadedAvatarUrl: string = '';
    /** 本地玩家是否为房主，由 PlayerSeatManager 注入 */
    private _isLocalOwner: boolean = false;
    /** 游戏是否已开始，由 PlayerSeatManager 注入 */
    private _isGameStarted: boolean = false;

    /** 倒计时总秒数 */
    private _countdownTotal: number = 0;
    /** 倒计时剩余秒数（浮点，每帧递减） */
    private _countdownRemaining: number = 0;
    /** 倒计时是否运行中 */
    private _countdownRunning: boolean = false;

    /** 点击空座位回调（坐下），由 PlayerSeatManager 注入 */
    public onEmptySeatClick: ((seat: PlayerSeat) => void) | null = null;
    /** 点击有玩家座位回调（查看个人信息），由 PlayerSeatManager 注入 */
    public onPlayerInfoClick: ((seat: PlayerSeat) => void) | null = null;
    /** 点击踢人按钮回调，由 PlayerSeatManager 注入 */
    public onKickBtnClick: ((seat: PlayerSeat) => void) | null = null;

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.emptyNode?.on(Node.EventType.TOUCH_END, this._onEmptyClick, this);
        this.occupiedNode?.on(Node.EventType.TOUCH_END, this._onOccupiedClick, this);
        this.kickBtn?.node.on(Node.EventType.TOUCH_END, this._onKickBtnClick, this);
        if (this.countdownNode) this.countdownNode.node.active = false;
    }

    protected onDestroy(): void {
        this.emptyNode?.off(Node.EventType.TOUCH_END, this._onEmptyClick, this);
        this.occupiedNode?.off(Node.EventType.TOUCH_END, this._onOccupiedClick, this);
        this.kickBtn?.node.off(Node.EventType.TOUCH_END, this._onKickBtnClick, this);
    }

    // ── 公开方法 ─────────────────────────────────────────

    /** 设置屏幕位置索引，供 PlayerSeatManager 调用 */
    setSeatIndex(index: number): void {
        this._seatIndex = index;
    }

    /**
     * 设置踢人按钮的显示上下文（房主身份 + 游戏状态）。
     * 在 setData 之前调用，_refresh() 会读取这些值。
     * 独立调用时（如游戏开始/结束）会直接更新 kickBtn 可见性。
     */
    setContext(isLocalOwner: boolean, isGameStarted: boolean): void {
        this._isLocalOwner = isLocalOwner;
        this._isGameStarted = isGameStarted;
        if (this._data !== null) {
            if (this.kickBtn) {
                this.kickBtn.node.active = !isGameStarted && (this._isSelf || isLocalOwner);
            }
            // 游戏开始时显示对手手牌数，自己（perspectiveId）始终隐藏
            if (this.cardCountNode) {
                this.cardCountNode.active = isGameStarted && !this._isSelf;
            }
        }
    }

    /**
     * 刷新座位数据
     * @param player     玩家数据，null 表示空座位
     * @param isSelf     是否为本地玩家自己
     * @param serverSeat 服务端座位号（1-based），空座位时必传，有玩家时可由 playerInfo.seat 推导
     */
    setData(player: TongitsPlayerInfo | null, isSelf: boolean, serverSeat: number = 0): void {
        this._data = player;
        this._isSelf = isSelf;
        this._serverSeat = player?.playerInfo?.seat ?? serverSeat;
        this._refresh();
    }

    /**
     * 设置当前操作高亮状态
     * @param active 是否为当前操作玩家
     */
    setActionActive(active: boolean): void {
        if (this.actionNode) this.actionNode.active = active;
        if (this.countdownNode) this.countdownNode.node.active = active;
        if (!active) this._stopCountdown();
    }

    /**
     * 启动倒计时（收到 ActionChange 时调用）
     * @param totalSeconds 倒计时总秒数
     */
    setCountdown(totalSeconds: number): void {
        this._countdownTotal     = totalSeconds;
        this._countdownRemaining = totalSeconds;
        this._countdownRunning   = true;
        this._refreshCountdownUI();
    }

    protected update(dt: number): void {
        if (!this._countdownRunning) return;
        this._countdownRemaining = Math.max(0, this._countdownRemaining - dt);
        this._refreshCountdownUI();
        if (this._countdownRemaining <= 0) this._stopCountdown();
    }

    private _stopCountdown(): void {
        this._countdownRunning = false;
    }

    private _refreshCountdownUI(): void {
        if (this.countdownLabel) {
            this.countdownLabel.string = String(Math.ceil(this._countdownRemaining));
        }
        if (this.countdownNode && this._countdownTotal > 0) {
            this.countdownNode.fillRange = this._countdownRemaining / this._countdownTotal;
        }
    }

    /** 获取当前玩家的 userId，空座位返回 0 */
    getUserId(): number {
        return this._data?.playerInfo?.userId ?? 0;
    }

    /** 获取当前服务端座位号（1-based），空座位时返回 Manager 传入的预分配座位号 */
    getServerSeat(): number {
        return this._serverSeat;
    }

    /** 当前是否为空座位 */
    isEmpty(): boolean {
        return this._data === null;
    }

    /** 当前是否为自己 */
    isSelf(): boolean {
        return this._isSelf;
    }

    // ── 私有：点击事件 ────────────────────────────────────

    private _onEmptyClick(_e: EventTouch): void {
        this.onEmptySeatClick?.(this);
    }

    private _onOccupiedClick(_e: EventTouch): void {
        this.onPlayerInfoClick?.(this);
    }

    private _onKickBtnClick(e: EventTouch): void {
        e.propagationStopped = true; // 阻止冒泡到 occupiedNode
        this.onKickBtnClick?.(this);
    }

    // ── 私有刷新 ─────────────────────────────────────────

    private _loadAvatar(url: string): void {
        if (!this.avatarSprite) return;
        // URL 相同时跳过，避免重复请求
        if (url === this._loadedAvatarUrl) return;
        this._loadedAvatarUrl = url;

        if (!url) {
            this.avatarSprite.spriteFrame = null;
            return;
        }

        Nexus.asset.loadRemote<SpriteFrame>(url).then((sf) => {
            if (!this.isValid || !this.avatarSprite) return;
            this.avatarSprite.spriteFrame = sf;
        }).catch((err) => {
            console.warn('[PlayerSeat] 头像加载失败:', url, err);
        });
    }

    private _refresh(): void {
        const isEmpty = this._data === null;

        if (this.emptyNode) this.emptyNode.active = isEmpty;
        if (this.occupiedNode) this.occupiedNode.active = !isEmpty;

        // 无人时清除操作高亮
        if (isEmpty) {
            this.setActionActive(false);
            return;
        }

        const info = this._data!.playerInfo;

        // 头像
        // this._loadAvatar(info?.avatar ?? '');

        // 昵称
        if (this.nameLabel) {
            this.nameLabel.string = info?.nickname ?? '';
        }

        // 金币
        if (this.coinLabel) {
            this.coinLabel.string = String(info?.coin ?? 0);
        }

        // 手牌数：游戏开始后对手可见，自己始终隐藏
        if (this.cardCountNode) {
            this.cardCountNode.active = this._isGameStarted && !this._isSelf;
        }
        if (this.cardCountLabel) {
            this.cardCountLabel.string = String(this._data!.handCardCount);
        }

        // 自己标志
        if (this.meIcon) {
            this.meIcon.active = this._isSelf;
        }

        // 房主（post === 1）
        if (this.ownerIcon) {
            this.ownerIcon.active = (info?.post ?? 0) === 1;
        }

        // 踢人按钮：游戏未开始时，自己始终显示（=下座），他人仅房主可见（=踢人）
        if (this.kickBtn) {
            this.kickBtn.node.active = !this._isGameStarted && (this._isSelf || this._isLocalOwner);
        }

        // 准备状态（state === 1）
        if (this.readyIcon) {
            this.readyIcon.active = (info?.state ?? 0) === 1;
        }

        // 离线状态（state === 3）
        if (this.offlineIcon) {
            this.offlineIcon.active = (info?.state ?? 0) === 3;
        }
    }
}
