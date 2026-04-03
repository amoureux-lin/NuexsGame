import { Nexus, MvcController } from 'db://nexus-framework/index';
import { GameEvents } from '../config/GameEvents';
import { CommonUI } from '../config/UIConfig';
import { MessageType } from '../proto/message_type';
import type { PlayerSitDownRes, PlayerStandUpRes, PlayerReadyGameRes } from '../proto/game_common_player';
import type { OwnerKickOffSeatRes } from '../proto/game_common_room';
import type { BaseGameModel } from './BaseGameModel';

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
        this.handle(GameEvents.CMD_BACK_LOBBY,                        ()  => this.onBackLobby());

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

    /** 返回大厅 */
    protected async onBackLobby(): Promise<void> {
        await Nexus.bundle.enter('lobby');
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
