import { Nexus } from 'db://nexus-framework/index';
import { BaseGameController } from 'db://assets/script/base/BaseGameController';
import { TongitsEvents } from '../config/TongitsEvents';
import { MessageType } from '../proto/message_type';
import type { TongitsModel } from './TongitsModel';
import type {
    MeldCardReq,
    LayOffCardReq,
    DiscardCardReq,
    TakeCardReq,
    ChallengeReq,
    SwitchAutoGroupCardsReq,
    GamePlayerGroupCardsReq,
    GameResultDetailsRes,
    DrawCardRes,
    MeldCardRes,
    DiscardCardRes,
    TakeCardRes,
    LayOffCardRes,
    ChallengeRes,
    SwitchAutoGroupCardsRes,
    GamePlayerGroupCardsRes,
    Cards,
    JoinRoomRes,
} from '../proto/tongits';
import {TongitsUI} from "db://assets/games/tongits/script/config/TongitsUIConfig";
import type {MenuPanelParams} from "db://assets/script/prefabs/MenuPanel";
import {GameEvents} from "db://assets/script/config/GameEvents";

/**
 * Tongits Controller：
 *   - 继承 BaseGameController，自动获得坐下、查看玩家信息、设置、返回大厅等公共命令处理
 *   - registerGameCommands() 只注册 Tongits 特有命令
 */
export class TongitsController extends BaseGameController {

    constructor(model: TongitsModel) {
        super(model);
    }

    override async start(params?: Record<string, unknown>): Promise<void> {
        console.log('Starting Tongits Controller', params);
        (this._model as TongitsModel).registerHandlers();
    }

    // ── Tongits 特有命令注册 ──────────────────────────────

    protected registerGameCommands(): void {
        this.handle(TongitsEvents.CMD_DRAW, () => this.onDraw());
        this.handle<{ cards: number[] }>(TongitsEvents.CMD_MELD, (d) => this.onMeld(d));
        this.handle<{ card: number; targetPlayerId: number; targetMeldId: number }>(
            TongitsEvents.CMD_LAY_OFF, (d) => this.onLayOff(d),
        );
        this.handle<{ card: number }>(TongitsEvents.CMD_DISCARD, (d) => this.onDiscard(d));
        this.handle<{ cardsFromHand: number[] }>(TongitsEvents.CMD_TAKE, (d) => this.onTake(d));
        this.handle<{ changeStatus: number }>(TongitsEvents.CMD_CHALLENGE, (d) => this.onChallenge(d));
        this.handle(TongitsEvents.CMD_START_GAME, () => this.onStartGame());
        this.handle(TongitsEvents.CMD_TONGITS_CLICK, () => this.onTongitsClick());
        this.handle(TongitsEvents.CMD_RESULT_DETAILS, () => this.onResultDetails());

        this.handle<{ isAuto: boolean }>(TongitsEvents.CMD_SWITCH_AUTO_GROUP, (d) => this.onSwitchAutoGroup(d));
        this.handle<{ targetGroupCards: Cards[] }>(TongitsEvents.CMD_PLAYER_GROUP_CARDS, (d) => this.onPlayerGroupCards(d));

        this.handle(TongitsEvents.CMD_OPEN_MOCK,     () => this.onOpenMock());
        this.handle(TongitsEvents.CMD_REFRESH_ROOM,  () => this.onRefreshRoom());
    }


    private async onRefreshRoom(): Promise<void> {
        const roomId = Nexus.data.get<number>('room_id') ?? 0;
        const res = await this.safeRequest<JoinRoomRes>(
            MessageType.TONGITS_JOIN_ROOM_REQ,
            { roomId },
        );
        if (res) (this._model as TongitsModel).joinRoom(res);
    }

    protected async onOpenMock(): Promise<void>{
        console.log("Starting Tongits Controller");
        await  Nexus.ui.show(TongitsUI.MOCK_VIEW);
    }

    // ── Tongits 游戏操作 ──────────────────────────────────

    private async onDraw(): Promise<void> {
        const res = await this.safeRequest<DrawCardRes>(MessageType.TONGITS_DRAW_REQ, {});
        if (res) (this._model as TongitsModel).applyDrawRes(res);
    }

    private async onMeld(data: { cards: number[] }): Promise<void> {
        console.log("Starting Tongits Controller onMeld:",data);
        const req: MeldCardReq = { cards: data.cards };
        const res = await this.safeRequest<MeldCardRes>(MessageType.TONGITS_MELD_REQ, req);
        if (res) (this._model as TongitsModel).applyMeldRes(res);
    }

    private async onLayOff(data: { card: number; targetPlayerId: number; targetMeldId: number }): Promise<void> {
        const req: LayOffCardReq = {
            card: data.card,
            targetPlayerId: data.targetPlayerId,
            targetMeldId: data.targetMeldId,
        };
        const res = await this.safeRequest<LayOffCardRes>(MessageType.TONGITS_LAYOFF_REQ, req);
        if (res) (this._model as TongitsModel).applyLayOffRes(res);
    }

    private async onDiscard(data: { card: number }): Promise<void> {
        const req: DiscardCardReq = { card: data.card };
        const res = await this.safeRequest<DiscardCardRes>(MessageType.TONGITS_DISCARD_REQ, req);
        if (res) (this._model as TongitsModel).applyDiscardRes(res);
    }

    private async onTake(data: { cardsFromHand: number[] }): Promise<void> {
        const req: TakeCardReq = { cardsFromHand: data.cardsFromHand };
        const res = await this.safeRequest<TakeCardRes>(MessageType.TONGITS_TAKE_REQ, req);
        if (res) (this._model as TongitsModel).applyTakeRes(res);
    }

    private async onChallenge(data: { changeStatus: number }): Promise<void> {
        const req: ChallengeReq = { changeStatus: data.changeStatus };
        const res = await this.safeRequest<ChallengeRes>(MessageType.TONGITS_CHALLENGE_ACTION_REQ, req);
        if (res) (this._model as TongitsModel).applyChallengeRes(res);
    }

    private async onStartGame(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_ROOM_OWNER_START_GAME_REQ, {});
    }

    private async onTongitsClick(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_WIN_CLICK_REQ, {});
    }

    private async onSwitchAutoGroup(data: { isAuto: boolean }): Promise<void> {
        const req: SwitchAutoGroupCardsReq = { isAuto: data.isAuto };
        const res = await this.safeRequest<SwitchAutoGroupCardsRes>(
            MessageType.TONGITS_SWITCH_AUTO_GROUP_CARDS_REQ, req,
        );
        if (res) (this._model as TongitsModel).applySwitchAutoGroupRes(res);
    }

    private async onPlayerGroupCards(data: { targetGroupCards: Cards[] }): Promise<void> {
        const req: GamePlayerGroupCardsReq = { targetGroupCards: data.targetGroupCards };
        const res = await this.safeRequest<GamePlayerGroupCardsRes>(
            MessageType.TONGITS_GAME_PLAYER_GROUP_CARDS_REQ, req,
        );
        if (res) (this._model as TongitsModel).applyPlayerGroupCardsRes(res);
    }

    private async onResultDetails(): Promise<void> {
        const res = await this.safeRequest<GameResultDetailsRes>(
            MessageType.TONGITS_GAME_RESULT_DETAILS_REQ, {},
        );
        if (res) Nexus.emit(TongitsEvents.RESULT_DETAILS, res);
    }

    //菜单参数
    protected getMenuParams(): MenuPanelParams {
        return {
            cardColorChecked: true,
            onHistory: () => {
                Nexus.ui.show(TongitsUI.RECORD_VIEW, { model: this._model as TongitsModel });
            },
            onRule: () => {
                Nexus.ui.show(TongitsUI.RULE_VIEW);
            },
            onCardColor: (isChecked) => {
                console.log("点击 CardColor", isChecked);
                let _cardThemeIndex = isChecked ? 0 : 1;
                Nexus.emit(GameEvents.CMD_SWITCH_CARD_THEME, { index: _cardThemeIndex });
            },
        };
    }
}
