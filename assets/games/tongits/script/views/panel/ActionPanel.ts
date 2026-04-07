import { _decorator, Button, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../../config/TongitsEvents';
import type { TongitsPlayerInfo, GameInfo } from '../../proto/tongits';
import type { ButtonStates } from '../../utils/HandCardState';

const { ccclass, property } = _decorator;

/** 玩家游戏内操作状态（与服务端一致） */
const enum PLAYER_STATUS {
    INIT   = 1,  // 等待抽牌
    SELECT = 2,  // 已弃牌，等待他人操作
    ACTION = 3,  // 已抽牌，可出牌/弃牌等
}

/**
 * ActionPanel — 游戏进行中的操作面板
 *
 * 按钮说明：
 *   group    — 将选中手牌创建组合（本地手牌操作）
 *   ungroup  — 取消选中的手牌组合（本地手牌操作）
 *   drop     — 打出有效组合到桌面（需 canDrop）
 *   drump    — 弃一张牌到弃牌堆
 *   fight    — 挑战 / 接受 / 拒绝
 *
 * 节点结构：
 *   ActionPanel
 *   ├── groupBtn
 *   ├── ungroupBtn
 *   ├── dropBtn
 *   ├── drumpBtn
 *   └── fightBtn
 */
@ccclass('ActionPanel')
export class ActionPanel extends Component {

    @property({ type: Button, tooltip: '打出组合到桌面按钮' })
    dropBtn: Button = null!;

    @property({ type: Button, tooltip: '挑战按钮' })
    fightBtn: Button = null!;

    @property({ type: Button, tooltip: '手牌分组按钮' })
    groupBtn: Button = null!;

    @property({ type: Button, tooltip: '手牌取消分组按钮' })
    ungroupBtn: Button = null!;

    @property({ type: Button, tooltip: '弃牌按钮' })
    drumpBtn: Button = null!;


    // ── 公开方法（由 TongitsView 驱动） ──────────────────

    /**
     * 刷新操作按钮的可交互状态（游戏进行中始终调用，按钮可见性由 showAll/hideAll 控制）。
     *
     * @param self        本地玩家数据（含 status / isFight / changeStatus）
     * @param gameInfo    游戏状态
     * @param handButtons 手牌状态机的按钮状态（可选，默认全 false）
     */
    refresh(
        self: TongitsPlayerInfo | null,
        gameInfo: GameInfo | null,
        handButtons?: ButtonStates,
    ): void {
        const status       = self?.status ?? PLAYER_STATUS.INIT;
        const isFight      = self?.isFight ?? false;
        const changeStatus = self?.changeStatus ?? 0;
        const inAction     = status === PLAYER_STATUS.ACTION;

        const canGroup   = handButtons?.canGroup   ?? false;
        const canUngroup = handButtons?.canUngroup ?? false;
        const canDrop    = handButtons?.canDrop    ?? false;
        const canDump    = handButtons?.canDump    ?? false;

        // ── drop / drump：始终可见，已摸牌(ACTION)且手牌满足条件才可点 ──
        this._setInteractable(this.dropBtn,  inAction && canDrop);
        this._setInteractable(this.drumpBtn, inAction && canDump);

        // ── group / ungroup 互斥显示 ──────────────────────────────────────
        this._setActive(this.ungroupBtn, canUngroup);
        this._setInteractable(this.ungroupBtn, true);

        this._setActive(this.groupBtn, !canUngroup);
        this._setInteractable(this.groupBtn, canGroup);

        // ── fight：isFight 或挑战进行中可点 ──────────────────────────────
        this._setInteractable(this.fightBtn, isFight || (changeStatus >= 2 && changeStatus <= 4));
    }

    /**
     * 显示所有按钮（发牌合并完成后调用），初始全部禁用状态。
     */
    showAll(): void {
        [this.dropBtn, this.drumpBtn, this.groupBtn, this.fightBtn]
            .forEach(btn => {
                this._setActive(btn, true);
                this._setInteractable(btn, false);
            });
        // ungroupBtn 初始隐藏，groupBtn 作为占位显示
        this._setActive(this.ungroupBtn, false);
    }

    /** 隐藏所有操作按钮（游戏结束 / 重置时调用） */
    hideAll(): void {
        [this.groupBtn, this.ungroupBtn, this.dropBtn, this.drumpBtn, this.fightBtn]
            .forEach(btn => this._setActive(btn, false));
    }

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.groupBtn?.node.on(Button.EventType.CLICK,   this._onGroup,   this);
        this.ungroupBtn?.node.on(Button.EventType.CLICK, this._onUngroup, this);
        this.dropBtn?.node.on(Button.EventType.CLICK,    this._onDrop,    this);
        this.drumpBtn?.node.on(Button.EventType.CLICK,   this._onDrump,   this);
        this.fightBtn?.node.on(Button.EventType.CLICK,   this._onFight,   this);
    }

    protected onDestroy(): void {
        this.groupBtn?.node.off(Button.EventType.CLICK,   this._onGroup,   this);
        this.ungroupBtn?.node.off(Button.EventType.CLICK, this._onUngroup, this);
        this.dropBtn?.node.off(Button.EventType.CLICK,    this._onDrop,    this);
        this.drumpBtn?.node.off(Button.EventType.CLICK,   this._onDrump,   this);
        this.fightBtn?.node.off(Button.EventType.CLICK,   this._onFight,   this);
    }

    // ── 私有工具 ─────────────────────────────────────────

    private _setActive(btn: Button | null, active: boolean): void {
        if (btn) btn.node.active = active;
    }

    private _setInteractable(btn: Button | null, interactable: boolean): void {
        if (btn) btn.interactable = interactable;
    }

    // ── 私有：按钮回调 ────────────────────────────────────

    private _onGroup(): void {
        Nexus.emit(TongitsEvents.CMD_GROUP);
    }

    private _onUngroup(): void {
        Nexus.emit(TongitsEvents.CMD_UNGROUP);
    }

    private _onDrop(): void {
        // 具体 cards 由 HandCardPanel 当前选中组决定，TongitsView 负责组装
        Nexus.emit(TongitsEvents.CMD_MELD, { cards: [] });
    }

    private _onDrump(): void {
        // 具体 card 由 HandCardPanel 选中散牌决定，TongitsView 负责组装
        Nexus.emit(TongitsEvents.CMD_DISCARD, { card: 0 });
    }

    private _onFight(): void {
        Nexus.emit(TongitsEvents.CMD_CHALLENGE, { changeStatus: 2 });
    }
}
