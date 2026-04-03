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
    GameResultDetailsRes,
} from '../proto/tongits';

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
    }

    // ── Tongits 游戏操作 ──────────────────────────────────

    private async onDraw(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_DRAW_REQ, {});
    }

    private async onMeld(data: { cards: number[] }): Promise<void> {
        const req: MeldCardReq = { cards: data.cards };
        await this.safeRequest(MessageType.TONGITS_MELD_REQ, req);
    }

    private async onLayOff(data: { card: number; targetPlayerId: number; targetMeldId: number }): Promise<void> {
        const req: LayOffCardReq = {
            card: data.card,
            targetPlayerId: data.targetPlayerId,
            targetMeldId: data.targetMeldId,
        };
        await this.safeRequest(MessageType.TONGITS_LAYOFF_REQ, req);
    }

    private async onDiscard(data: { card: number }): Promise<void> {
        const req: DiscardCardReq = { card: data.card };
        await this.safeRequest(MessageType.TONGITS_DISCARD_REQ, req);
    }

    private async onTake(data: { cardsFromHand: number[] }): Promise<void> {
        const req: TakeCardReq = { cardsFromHand: data.cardsFromHand };
        await this.safeRequest(MessageType.TONGITS_TAKE_REQ, req);
    }

    private async onChallenge(data: { changeStatus: number }): Promise<void> {
        const req: ChallengeReq = { changeStatus: data.changeStatus };
        await this.safeRequest(MessageType.TONGITS_CHALLENGE_ACTION_REQ, req);
    }

    private async onStartGame(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_ROOM_OWNER_START_GAME_REQ, {});
    }

    private async onTongitsClick(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_WIN_CLICK_REQ, {});
    }

    private async onResultDetails(): Promise<void> {
        const res = await this.safeRequest<GameResultDetailsRes>(
            MessageType.TONGITS_GAME_RESULT_DETAILS_REQ, {},
        );
        if (res) Nexus.emit(TongitsEvents.RESULT_DETAILS, res);
    }
}
