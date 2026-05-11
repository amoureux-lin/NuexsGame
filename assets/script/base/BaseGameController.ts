import { Nexus, MvcController } from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';
import { CommonUI } from '../config/UIConfig';
import type { MenuPanelParams } from '../prefabs/MenuPanel';
import { MessageType } from '../proto/message_type';
import type { PlayerSitDownRes, PlayerStandUpRes, PlayerReadyGameRes, PlayerExitRoomRes, PlayerSwitchRoomRes } from '../proto/game_common_player';
import { ExitRoomIntent, RoomActionAcceptStatus, type OwnerKickOffSeatRes } from '../proto/game_common_room';
import type { BaseGameModel } from './BaseGameModel';
import { BaseGameEvents, type GameStartedPayload, type GameEndedPayload } from './BaseGameEvents';
import { WebSDKBridge } from '../lib/websdk/WebSDKBridge';

/**
 * 子游戏 Controller 基类。
 *
 * 职责：
 *   - 注册所有游戏公共命令（坐下、查看玩家信息、打开设置、返回大厅）
 *   - 提供 safeRequest 通用错误包装
 *   - 子类通过 registerGameCommands() 注册游戏特有命令
 *
 * 用法：
 *   export class TongitsController extends BaseGameController {
 *       protected registerGameCommands(): void {
 *           this.handle(TongitsEvents.CMD_DRAW, () => this.onDraw());
 *           ...
 *       }
 *   }
 */
export abstract class BaseGameController extends MvcController {

    constructor(protected readonly _model: BaseGameModel<any, any>) {
        super();
    }

    // ── 命令注册 ─────────────────────────────────────────

    protected registerCommands(): void {
        // 公共命令
        this.handle<{ seat: number }>(GameEvents.CMD_SIT_DOWN,       (d) => this.onSitDown(d));
        this.handle(GameEvents.CMD_STAND_UP,                          ()  => this.onStandUp());
        this.handle<{ ready: boolean }>(GameEvents.CMD_READY,         (d) => this.onReady(d));
        this.handle<{ userId: number }>(GameEvents.CMD_KICK_OFF_SEAT, (d) => this.onKickOffSeat(d));
        this.handle<{ userId: number }>(GameEvents.CMD_VIEW_PLAYER_INFO, (d) => this.onViewPlayerInfo(d));
        this.handle(GameEvents.CMD_OPEN_SETTINGS,                     ()  => this.onOpenSettings());
        this.handle(GameEvents.CMD_OPEN_MENU,                         ()  => this.onOpenMenu());
        this.handle(GameEvents.CMD_BACK_LOBBY,                        ()  => this.onBackLobby());

        // 平台请求退出 / 预约离开 / 换房（由 WebSDKBridge 从 W2C_* 转发）
        this.handle(GameEvents.CMD_PLATFORM_EXIT,                     ()  => this.onPlatformExit());
        this.handle(GameEvents.CMD_PLATFORM_PENDING_LEAVE,            ()  => this.onPlatformPendingLeave());
        this.handle(GameEvents.CMD_PLATFORM_SWITCH_ROOM,              ()  => this.onPlatformSwitchRoom());

        // 游戏生命周期 → 平台上报（由子游戏 Model 在收到对应广播时 notify）
        this.handle<GameStartedPayload>(BaseGameEvents.GAME_STARTED,  (d) => this._reportGameStart(d));
        this.handle<GameEndedPayload>(BaseGameEvents.GAME_ENDED,      (d) => this._reportGameOver(d));
        this.handle(BaseGameEvents.GAME_PHASE_RESET,                  ()  => this._reportGameReset());

        // 子游戏特有命令
        this.registerGameCommands();
    }

    /** 子类在此注册游戏特有命令。 */
    protected abstract registerGameCommands(): void;

    // ── 公共命令处理 ─────────────────────────────────────

    /** 坐下：发送通用坐下请求，成功后更新 Model */
    protected async onSitDown(data: { seat: number }): Promise<void> {
        const res = await this.safeRequest<PlayerSitDownRes>(
            MessageType.COMMON_PLAYER_SIT_DOWN_REQ,
            { seat: data.seat },
        );
        if (res) this._model.onPlayerSitDownRes(res);
    }

    /** 准备 / 取消准备 */
    protected async onReady(data: { ready: boolean }): Promise<void> {
        const res = await this.safeRequest<PlayerReadyGameRes>(
            MessageType.COMMON_PLAYER_READY_GAME_REQ,
            { ready: data.ready },
        );
        if (res) this._model.onPlayerReadyRes(res);
    }

    /** 站起：发送站起请求，成功后更新 Model */
    protected async onStandUp(): Promise<void> {
        const res = await this.safeRequest<PlayerStandUpRes>(
            MessageType.COMMON_PLAYER_STAND_UP_REQ,
            {},
        );
        // RES 只发给自己，广播 STAND_UP_BROADCAST 会通知其他玩家
        if (res) this._model.onPlayerStandUpRes();
    }

    /** 房主踢人下座 */
    protected async onKickOffSeat(data: { userId: number }): Promise<void> {
        const res = await this.safeRequest<OwnerKickOffSeatRes>(
            MessageType.ROOM_OWNER_KICK_OFF_SEAT_REQ,
            { playerId: data.userId },
        );
        // RES 只发给房主自己，由 model 处理数据更新；其他玩家走 BROADCAST (210)
        if (res) this._model.onKickOffSeatRes(res);
    }

    /**
     * 查看玩家个人信息。
     * 子类可覆写以打开游戏自定义的玩家信息面板。
     */
    protected onViewPlayerInfo(_data: { userId: number }): void {
        // 默认空实现，子类按需覆写
        // 示例：Nexus.ui.show(TongitsUI.PLAYER_INFO, { userId: data.userId });
    }

    /** 打开公共设置面板 */
    protected async onOpenSettings(): Promise<void> {
        await  Nexus.ui.show(CommonUI.SETTING);
    }

    /**
     * 打开公共菜单面板。
     * 子类覆写 getMenuParams() 可传入游戏特有的回调（历史记录、规则、牌色切换等）。
     */
    protected async onOpenMenu(): Promise<void> {
        await Nexus.ui.show(CommonUI.MENU_PANEL, this.getMenuParams());
    }

    /**
     * 返回 MenuPanel 的参数。
     * 子类覆写此方法，传入游戏特有的回调。
     */
    protected getMenuParams(): MenuPanelParams {
        return {};
    }

    /** 返回大厅 */
    protected async onBackLobby(): Promise<void> {
        await Nexus.bundle.enter('lobby');
    }

    // ── 平台退出请求 ──────────────────────────────────────

    /**
     * 平台请求立即退出（CMD_PLATFORM_EXIT，源自 W2C_EXIT_GAME）。
     */
    protected async onPlatformExit(): Promise<void> {
        await this._sendExitRoom(ExitRoomIntent.EXIT_ROOM_INTENT_IMMEDIATE);
    }

    /**
     * 平台请求预约离开（CMD_PLATFORM_PENDING_LEAVE，源自 W2C_PLAYER_PENDING_LEAVE）。
     * 重复点击同一预约动作时服务端会返回 CANCELED，作为"取消预约"语义；
     * 已有其他预约动作时返回 ALREADY_PENDING，按 res.activePendingAction 同步给平台。
     */
    protected async onPlatformPendingLeave(): Promise<void> {
        await this._sendExitRoom(ExitRoomIntent.EXIT_ROOM_INTENT_NEXT_HAND_LEAVE);
    }

    /**
     * 退出 / 预约离开统一发送逻辑：
     *   - EXECUTING：服务端立即受理（玩家未在牌局），通知平台关闭游戏；
     *   - DEFERRED / CANCELED / ALREADY_PENDING：预约状态变化，回报 activePendingAction
     *     给平台同步按钮显示；后续若真的执行，会经 SELF_LEFT_ROOM 走原有弹窗+关闭流程。
     */
    private async _sendExitRoom(intent: ExitRoomIntent): Promise<void> {
        const res = await this.safeRequest<PlayerExitRoomRes>(
            MessageType.COMMON_PLAYER_EXIT_ROOM_REQ,
            { intent },

        );
        if (!res) return;
        const bridge = WebSDKBridge.getInstance();
        if (res.status === RoomActionAcceptStatus.ROOM_ACTION_ACCEPT_STATUS_EXECUTING) {
            bridge.requestPlatformExit();
            return;
        }
        bridge.notifyPendingActionChanged(res.activePendingAction);
    }

    /**
     * 平台请求换房（CMD_PLATFORM_SWITCH_ROOM，源自 W2C_PLAYER_SWITCH_ROOM）。
     *   - EXECUTING：服务端立即换房，会广播 COMMON_SWITCH_ROOM_BROADCAST，
     *     由 BaseGameEntry._onSwitchRoom 触发 resync；客户端无需关闭游戏。
     *   - DEFERRED / CANCELED / ALREADY_PENDING：预约状态变化。
     * 所有状态都把 activePendingAction 回报给平台同步按钮显示。
     */
    protected async onPlatformSwitchRoom(): Promise<void> {
        const res = await this.safeRequest<PlayerSwitchRoomRes>(
            MessageType.COMMON_PLAYER_SWITCH_ROOM_REQ,
            {},
        );
        if (!res) return;
        WebSDKBridge.getInstance().notifyPendingActionChanged(res.activePendingAction);
    }

    // ── 游戏生命周期 → 平台上报（事件订阅触发） ────────────

    private _reportGameStart(d: GameStartedPayload): void {
        WebSDKBridge.getInstance().notifyGameStart(d.userId, d.seat);
    }

    private _reportGameOver(d: GameEndedPayload): void {
        WebSDKBridge.getInstance().notifyGameOver(d.resultType);
    }

    private _reportGameReset(): void {
        WebSDKBridge.getInstance().notifyGameReset();
    }

    // ── 工具方法 ─────────────────────────────────────────

    /**
     * 统一 wsRequest 错误处理包装。
     * 请求失败时打印错误并返回 null，不向上抛出。
     */
    protected async safeRequest<T = unknown>(msgType: number, body: unknown): Promise<T | null> {
        try {
            return await this._model.wsRequest<T>(msgType, body);
        } catch (err) {
            console.error(`[${this.constructor.name}] wsRequest failed, msgType:`, msgType, err);
            return null;
        }
    }

    // ── 生命周期 ─────────────────────────────────────────

    override destroy(): void {
        this._model.destroy();
        super.destroy();
    }
}
