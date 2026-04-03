import { _decorator } from 'cc';
import { MvcView } from 'db://nexus-framework/index';
import { BaseGameEvents, type JoinRoomData } from './BaseGameModel';
import { GameEvents } from '../config/GameEvents';

const { ccclass } = _decorator;

/**
 * 子游戏 View 基类。
 *
 * 职责：
 *   - 注册公共 Model 事件（ROOM_JOINED / PLAYERS_UPDATED / GAME_INFO_UPDATED / SELF_UPDATED）
 *   - 提供公共空回调，子类按需 override
 *   - 提供公共 dispatch 快捷方法（openSettings / backLobby）
 *   - 子类通过 registerGameEvents() 注册游戏特有事件
 *
 * 用法：
 *   export class TongitsView extends BaseGameView<TongitsPlayerInfo, GameInfo> {
 *       protected registerGameEvents(): void {
 *           this.listen(TongitsEvents.GAME_START, (d) => this.onGameStart(d));
 *           ...
 *       }
 *   }
 *
 * @template P 玩家信息类型（对应子游戏的 PlayerInfo 扩展）
 * @template G 游戏状态类型（对应子游戏的 GameInfo）
 */
@ccclass('BaseGameView')
export abstract class BaseGameView<P = unknown, G = unknown> extends MvcView {

    // ── 事件注册模板 ─────────────────────────────────────

    /** 注册公共事件，由 registerEvents() 自动调用，子类无需手动调用。 */
    protected registerCommonEvents(): void {
        this.listen<JoinRoomData<P, G>>(
            BaseGameEvents.ROOM_JOINED,
            (d) => this.onRoomJoined(d),
        );
        this.listen<{ players: P[] }>(
            BaseGameEvents.PLAYERS_UPDATED,
            (d) => this.onPlayersUpdated(d.players),
        );
        this.listen<{ gameInfo: G }>(
            BaseGameEvents.GAME_INFO_UPDATED,
            (d) => this.onGameInfoUpdated(d.gameInfo),
        );
        this.listen<{ self: P }>(
            BaseGameEvents.SELF_UPDATED,
            (d) => this.onSelfUpdated(d.self),
        );
    }

    /** 子类在此注册游戏特有事件监听。 */
    protected abstract registerGameEvents(): void;

    /** 对外入口，框架调用此方法启动所有监听。 */
    protected override registerEvents(): void {
        this.registerCommonEvents();
        this.registerGameEvents();
    }

    // ── 公共回调（子类按需 override） ─────────────────────

    /** 进房数据就绪 */
    protected onRoomJoined(_data: JoinRoomData<P, G>): void {}

    /** 玩家列表变化 */
    protected onPlayersUpdated(_players: P[]): void {}

    /** 游戏状态变化 */
    protected onGameInfoUpdated(_gameInfo: G): void {}

    /** 自己的数据变化 */
    protected onSelfUpdated(_self: P): void {}

    // ── 公共 dispatch 快捷方法 ────────────────────────────

    /** 打开公共设置面板 */
    protected openSettings(): void {
        this.dispatch(GameEvents.CMD_OPEN_SETTINGS);
    }

    /** 返回大厅 */
    protected backLobby(): void {
        this.dispatch(GameEvents.CMD_BACK_LOBBY);
    }
}
