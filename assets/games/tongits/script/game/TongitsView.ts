import { _decorator } from 'cc';
import { MvcView } from 'db://nexus-framework/index';
import { BaseGameEvents } from 'db://assets/script/base/BaseGameModel';
import { TongitsEvents } from '../config/TongitsEvents';
import type {
    TongitsPlayerInfo,
    GameInfo,
    GameStartBroadcast,
    ActionChangeBroadcast,
    DrawCardBroadcast,
    MeldCardBroadcast,
    LayOffCardBroadcast,
    DiscardCardBroadcast,
    TakeCardBroadcast,
    ChallengeBroadcast,
    PKBroadcast,
    BeforeResultBroadcast,
    GameResultBroadcast,
    RoomResetBroadcast,
    JoinRoomRes,
    GameResultDetailsRes,
} from '../proto/tongits';

const { ccclass } = _decorator;

/**
 * Tongits View：挂到 tongitsMain 场景的主界面节点。
 *
 * 职责：
 *   - 监听 Model 事件 → 刷新 UI（on* 方法）
 *   - 用户操作 → dispatch CMD 给 Controller
 *
 * 所有 on* 方法默认空实现，子类或直接在此填充 UI 逻辑。
 */
@ccclass('TongitsView')
export class TongitsView extends MvcView {

    // ── 事件注册 ─────────────────────────────────────────

    protected registerEvents(): void {
        // BaseGameModel 通用事件
        this.listen<JoinRoomRes>(BaseGameEvents.ROOM_JOINED, (d) => this.onRoomJoined(d));
        this.listen<{ players: TongitsPlayerInfo[] }>(BaseGameEvents.PLAYERS_UPDATED, (d) => this.onPlayersUpdated(d.players));
        this.listen<{ gameInfo: GameInfo }>(BaseGameEvents.GAME_INFO_UPDATED, (d) => this.onGameInfoUpdated(d.gameInfo));
        this.listen<{ self: TongitsPlayerInfo }>(BaseGameEvents.SELF_UPDATED, (d) => this.onSelfUpdated(d.self));

        // Tongits 游戏广播事件
        this.listen<GameStartBroadcast>(TongitsEvents.GAME_START, (d) => this.onGameStart(d));
        this.listen<ActionChangeBroadcast>(TongitsEvents.ACTION_CHANGE, (d) => this.onActionChange(d));
        this.listen<DrawCardBroadcast>(TongitsEvents.DRAW, (d) => this.onDraw(d));
        this.listen<MeldCardBroadcast>(TongitsEvents.MELD, (d) => this.onMeld(d));
        this.listen<LayOffCardBroadcast>(TongitsEvents.LAY_OFF, (d) => this.onLayOff(d));
        this.listen<DiscardCardBroadcast>(TongitsEvents.DISCARD, (d) => this.onDiscard(d));
        this.listen<TakeCardBroadcast>(TongitsEvents.TAKE, (d) => this.onTake(d));
        this.listen<ChallengeBroadcast>(TongitsEvents.CHALLENGE, (d) => this.onChallenge(d));
        this.listen<PKBroadcast>(TongitsEvents.PK, (d) => this.onPK(d));
        this.listen<BeforeResultBroadcast>(TongitsEvents.BEFORE_RESULT, (d) => this.onBeforeResult(d));
        this.listen<GameResultBroadcast>(TongitsEvents.GAME_RESULT, (d) => this.onGameResult(d));
        this.listen<RoomResetBroadcast>(TongitsEvents.ROOM_RESET, (d) => this.onRoomReset(d));
        this.listen<GameResultDetailsRes>(TongitsEvents.RESULT_DETAILS, (d) => this.onResultDetails(d));
    }

    // ── Model → View 事件回调（填充 UI 逻辑） ────────────

    /** 进房数据就绪：初始化房间 UI、玩家头像、游戏状态 */
    protected onRoomJoined(_data: JoinRoomRes): void {}

    /** 玩家列表变化：刷新座位、头像、手牌数等 */
    protected onPlayersUpdated(_players: TongitsPlayerInfo[]): void {}

    /** 游戏状态变化：牌堆数、弃牌堆、底池等 */
    protected onGameInfoUpdated(_gameInfo: GameInfo): void {}

    /** 自己的数据变化：手牌、状态等 */
    protected onSelfUpdated(_self: TongitsPlayerInfo): void {}

    /** 游戏开始：发牌动画、初始化牌桌 */
    protected onGameStart(_data: GameStartBroadcast): void {}

    /** 操作轮转：高亮当前操作玩家、显示倒计时 */
    protected onActionChange(_data: ActionChangeBroadcast): void {}

    /** 抽牌：抽牌动画、更新牌堆数 */
    protected onDraw(_data: DrawCardBroadcast): void {}

    /** 出牌（组合）：显示新牌组、更新手牌数 */
    protected onMeld(_data: MeldCardBroadcast): void {}

    /** 补牌/压牌：将牌加入目标牌组动画 */
    protected onLayOff(_data: LayOffCardBroadcast): void {}

    /** 打牌（弃牌）：弃牌动画、更新弃牌堆 */
    protected onDiscard(_data: DiscardCardBroadcast): void {}

    /** 吃牌：吃牌动画、更新弃牌堆 */
    protected onTake(_data: TakeCardBroadcast): void {}

    /** 挑战：显示挑战 UI */
    protected onChallenge(_data: ChallengeBroadcast): void {}

    /** PK：显示 PK 状态 */
    protected onPK(_data: PKBroadcast): void {}

    /** 结算前比牌：翻牌动画、显示各玩家手牌 */
    protected onBeforeResult(_data: BeforeResultBroadcast): void {}

    /** 游戏结算：显示输赢结果、金额变化 */
    protected onGameResult(_data: GameResultBroadcast): void {}

    /** 房间重置：重置牌桌、准备下一局 */
    protected onRoomReset(_data: RoomResetBroadcast): void {}

    /** 结算详情（主动请求返回） */
    protected onResultDetails(_data: GameResultDetailsRes): void {}

    // ── View → Controller 命令（由 UI 事件调用） ─────────

    /** 抽牌 */
    protected draw(): void {
        this.dispatch(TongitsEvents.CMD_DRAW);
    }

    /** 出牌（组合） */
    protected meld(cards: number[]): void {
        this.dispatch(TongitsEvents.CMD_MELD, { cards });
    }

    /** 补牌/压牌 */
    protected layOff(card: number, targetPlayerId: number, targetMeldId: number): void {
        this.dispatch(TongitsEvents.CMD_LAY_OFF, { card, targetPlayerId, targetMeldId });
    }

    /** 打牌（弃牌） */
    protected discard(card: number): void {
        this.dispatch(TongitsEvents.CMD_DISCARD, { card });
    }

    /** 吃牌 */
    protected take(cardsFromHand: number[]): void {
        this.dispatch(TongitsEvents.CMD_TAKE, { cardsFromHand });
    }

    /** 挑战操作 (2:发起 3:接受 4:拒绝) */
    protected challenge(changeStatus: number): void {
        this.dispatch(TongitsEvents.CMD_CHALLENGE, { changeStatus });
    }

    /** 房主开始游戏 */
    protected startGame(): void {
        this.dispatch(TongitsEvents.CMD_START_GAME);
    }

    /** Tongits 胜利确认 */
    protected tongitsClick(): void {
        this.dispatch(TongitsEvents.CMD_TONGITS_CLICK);
    }

    /** 查看结算详情 */
    protected resultDetails(): void {
        this.dispatch(TongitsEvents.CMD_RESULT_DETAILS);
    }

    /** 打开设置 */
    protected openSettings(): void {
        this.dispatch(TongitsEvents.CMD_OPEN_SETTINGS);
    }

    /** 返回大厅 */
    protected backLobby(): void {
        this.dispatch(TongitsEvents.CMD_BACK_LOBBY);
    }
}
