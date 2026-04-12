import { _decorator, Button, Component, Node } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { TongitsEvents } from '../../config/TongitsEvents';
import type { TongitsPlayerInfo, GameInfo } from '../../proto/tongits';
import type { ButtonStates } from '../../utils/HandCardState';

const { ccclass, property } = _decorator;

/** 玩家游戏内操作状态（与服务端一致） */
const enum PLAYER_STATUS {
    INIT   = 1,  // 不可操作（非操作回合 / 弃牌后等待下一轮）
    SELECT = 2,  // 可操作：抽牌 / 吃牌 / 发起挑战 三选一
    ACTION = 3,  // 已抽/吃牌，必须弃牌或放牌
}

/**
 * ActionPanel — 游戏进行中的操作面板
 *
 * 按钮说明：
 *   groupBtn   — 将选中手牌创建组合（本地手牌操作）
 *   ungroupBtn — 取消选中的手牌组合（本地手牌操作）
 *   dropBtn    — 打出有效组合到桌面（需 canDrop）
 *   dumpBtn    — 弃一张牌到弃牌堆
 *   sapawBtn    — 将手中一张牌补到对手桌面已有的牌组（Sapaw）
 *   fightBtn   — 挑战 / 接受 / 拒绝
 *
 * 节点结构：
 *   ActionPanel
 *   ├── groupBtn
 *   ├── ungroupBtn
 *   ├── dropBtn
 *   ├── dumpBtn
 *   ├── sapawBtn    ← 默认隐藏，满足 Sapaw 条件时才显示
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
    dumpBtn: Button = null!;

    @property({ type: Button, tooltip: '补牌按钮（Sapaw）默认隐藏' })
    sapawBtn: Button = null!;

    @property({ type: Node, tooltip: '挑战按钮上的禁止标记节点（被补牌 ban 时显示）' })
    fightBanNode: Node | null = null;;


    // ── 公开方法（由 TongitsView 驱动） ──────────────────

    /**
     * 刷新操作按钮的可交互状态（游戏进行中始终调用，按钮可见性由 showAll
     * /hideAll 控制）。
     *
     * @param self        本地玩家数据（含 status / isFight / changeStatus）
     * @param gameInfo    游戏状态
     * @param handButtons 手牌状态机的按钮状态（可选，默认全 false）
     */
    refresh(
        self: TongitsPlayerInfo | null,
        gameInfo: GameInfo | null,
        handButtons?: ButtonStates,
        isBanned = false,
    ): void {
        const status       = self?.status ?? PLAYER_STATUS.INIT;
        const isFight      = self?.isFight ?? false;
        const changeStatus = self?.changeStatus ?? 0;
        // status===3(ACTION)：已抽/吃牌，可 drop/dump/sapaw
        const canPlayCards = status === PLAYER_STATUS.ACTION;

        const canGroup   = handButtons?.canGroup   ?? false;
        const canUngroup = handButtons?.canUngroup ?? false;
        const canDrop    = handButtons?.canDrop    ?? false;
        const canDump    = handButtons?.canDump    ?? false;
        const canSapaw    = handButtons?.canSapaw    ?? false;

        // ── drop：已抽牌(ACTION)且手牌满足条件才可点 ────────────────────────
        this._setInteractable(this.dropBtn, canPlayCards && canDrop);

        // ── sapaw / dump 互斥：选中牌能补时只显示 sapaw，否则只显示 dump ──
        const showSapaw = canPlayCards && canSapaw;
        this._setActive(this.sapawBtn, showSapaw);
        this._setInteractable(this.sapawBtn, showSapaw);
        this._setActive(this.dumpBtn, !showSapaw);
        this._setInteractable(this.dumpBtn, !showSapaw && canPlayCards && canDump);

        // ── group / ungroup：本地操作，不受回合限制，由选牌条件驱动 ──────
        this._setActive(this.ungroupBtn, canUngroup);
        this._setInteractable(this.ungroupBtn, canUngroup);

        this._setActive(this.groupBtn, !canUngroup);
        this._setInteractable(this.groupBtn, canGroup);

        // ── fight：isBanned 时强制禁用并显示禁止标记，否则按正常逻辑 ──────
        const canFight = !isBanned && (isFight || (changeStatus >= 2 && changeStatus <= 4));
        this._setInteractable(this.fightBtn, canFight);
        if (this.fightBanNode) this.fightBanNode.active = isBanned;
    }

    /**
     * 仅刷新 group / ungroup 按钮（不受回合限制，任意时刻选牌变化均可调用）。
     * TongitsView.onSelectionChange 始终调用此方法，与 refresh 解耦。
     */
    refreshGroupButtons(handButtons?: ButtonStates): void {
        const canGroup   = handButtons?.canGroup   ?? false;
        const canUngroup = handButtons?.canUngroup ?? false;

        this._setActive(this.ungroupBtn, canUngroup);
        this._setInteractable(this.ungroupBtn, canUngroup);

        this._setActive(this.groupBtn, !canUngroup);
        this._setInteractable(this.groupBtn, canGroup);
    }

    /**
     * 回合切换统一重置：所有按钮禁用（group/ungroup 由 refreshGroupButtons 实时驱动）。
     * 后续是否开启由 TongitsView 在"轮到自己 + 选牌变化/手牌满足条件"时再次 refresh 决定。
     */
    resetForTurn(): void {
        if (this.fightBanNode) this.fightBanNode.active = false;
        for (const btn of [this.dropBtn, this.dumpBtn, this.fightBtn]) {
            this._setActive(btn, true);
            this._setInteractable(btn, false);
        }
        // sapawBtn 回合重置时始终隐藏，由 refresh 按条件显示
        this._setActive(this.sapawBtn, false);
        this._setInteractable(this.sapawBtn, false);
        // group/ungroup reset 到初始状态（选牌清空后全 false，等待 refreshGroupButtons 驱动）
        this._setActive(this.ungroupBtn, false);
        this._setInteractable(this.ungroupBtn, false);
        this._setActive(this.groupBtn, true);
        this._setInteractable(this.groupBtn, false);
    }

    /**
     * 显示所有按钮（发牌合并完成后调用），初始全部禁用，等待选牌驱动。
     */
    showAll(): void {
        for (const btn of [this.dropBtn, this.dumpBtn, this.fightBtn]) {
            this._setActive(btn, true);
            this._setInteractable(btn, false);
        }
        // sapawBtn 初始隐藏，由 refresh 按条件显示
        this._setActive(this.sapawBtn, false);
        this._setInteractable(this.sapawBtn, false);
        // ungroupBtn 初始隐藏，groupBtn 显示但禁用，等待 refreshGroupButtons 驱动
        this._setActive(this.ungroupBtn, false);
        this._setInteractable(this.ungroupBtn, false);
        this._setActive(this.groupBtn, true);
        this._setInteractable(this.groupBtn, false);
    }

    /** 隐藏所有操作按钮（游戏结束 / 重置时调用） */
    hideAll(): void {
        [this.groupBtn, this.ungroupBtn, this.dropBtn, this.dumpBtn, this.fightBtn, this.sapawBtn]
            .forEach(btn => this._setActive(btn, false));
    }

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.groupBtn?.node.on(Button.EventType.CLICK,   this._onGroup,   this);
        this.ungroupBtn?.node.on(Button.EventType.CLICK, this._onUngroup, this);
        this.dropBtn?.node.on(Button.EventType.CLICK,    this._onDrop,    this);
        this.dumpBtn?.node.on(Button.EventType.CLICK,    this._onDump,    this);
        this.fightBtn?.node.on(Button.EventType.CLICK,   this._onFight,   this);
        this.sapawBtn?.node.on(Button.EventType.CLICK,    this._onSapaw,    this);
    }

    protected onDestroy(): void {
        this.groupBtn?.node.off(Button.EventType.CLICK,   this._onGroup,   this);
        this.ungroupBtn?.node.off(Button.EventType.CLICK, this._onUngroup, this);
        this.dropBtn?.node.off(Button.EventType.CLICK,    this._onDrop,    this);
        this.dumpBtn?.node.off(Button.EventType.CLICK,    this._onDump,    this);
        this.fightBtn?.node.off(Button.EventType.CLICK,   this._onFight,   this);
        this.sapawBtn?.node.off(Button.EventType.CLICK,    this._onSapaw,    this);
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
        Nexus.emit(TongitsEvents.CMD_DROP_BTN);
    }

    private _onDump(): void {
        Nexus.emit(TongitsEvents.CMD_DUMP_BTN);
    }

    private _onFight(): void {
        Nexus.emit(TongitsEvents.CMD_CHALLENGE, { changeStatus: 2 });
    }

    private _onSapaw(): void {
        // 具体 card / targetPlayerId / targetMeldId 由 TongitsView._onCmdSapaw 组装
        Nexus.emit(TongitsEvents.CMD_SAPAW_BTN);
    }
}
