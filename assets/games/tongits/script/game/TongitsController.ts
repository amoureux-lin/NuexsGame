import { Nexus, MvcController } from 'db://nexus-framework/index';
import { TongitsEvents } from '../config/TongitsEvents';
import { TongitsUI } from '../config/TongitsUIConfig';
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
import {CommonUI} from "db://assets/script/config/UIConfig";

/**
 * Tongits Controller：
 *   - registerCommands 注册 View 发来的用户命令
 *   - 每个命令处理方法调用 Model 发 wsRequest
 *   - start() 启动 Model 广播监听
 */
export class TongitsController extends MvcController {

    constructor(private readonly _model: TongitsModel) {
        super();
    }

    protected registerCommands(): void {
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
        this.handle(TongitsEvents.CMD_OPEN_SETTINGS, () => this.onOpenSettings());
        this.handle(TongitsEvents.CMD_BACK_LOBBY, () => this.onBackLobby());
    }

    override async start(params?: Record<string, unknown>): Promise<void> {
        console.log('Starting Tongits Controller', params);
        this._model.registerHandlers();
    }

    // ── 游戏操作 ─────────────────────────────────────────

    /** 统一 wsRequest 错误处理 */
    private async safeRequest<T = unknown>(msgType: number, body: unknown): Promise<T | null> {
        try {
            return await this._model.wsRequest<T>(msgType, body);
        } catch (err) {
            console.error('[TongitsController] wsRequest failed:', msgType, err);
            return null;
        }
    }

    /** 抽牌 */
    private async onDraw(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_DRAW_REQ, {});
    }

    /** 出牌（组合） */
    private async onMeld(data: { cards: number[] }): Promise<void> {
        const req: MeldCardReq = { cards: data.cards };
        await this.safeRequest(MessageType.TONGITS_MELD_REQ, req);
    }

    /** 补牌/压牌 */
    private async onLayOff(data: { card: number; targetPlayerId: number; targetMeldId: number }): Promise<void> {
        const req: LayOffCardReq = {
            card: data.card,
            targetPlayerId: data.targetPlayerId,
            targetMeldId: data.targetMeldId,
        };
        await this.safeRequest(MessageType.TONGITS_LAYOFF_REQ, req);
    }

    /** 打牌（弃牌） */
    private async onDiscard(data: { card: number }): Promise<void> {
        const req: DiscardCardReq = { card: data.card };
        await this.safeRequest(MessageType.TONGITS_DISCARD_REQ, req);
    }

    /** 吃牌 */
    private async onTake(data: { cardsFromHand: number[] }): Promise<void> {
        const req: TakeCardReq = { cardsFromHand: data.cardsFromHand };
        await this.safeRequest(MessageType.TONGITS_TAKE_REQ, req);
    }

    /** 挑战操作 (2:发起 3:接受 4:拒绝) */
    private async onChallenge(data: { changeStatus: number }): Promise<void> {
        const req: ChallengeReq = { changeStatus: data.changeStatus };
        await this.safeRequest(MessageType.TONGITS_CHALLENGE_ACTION_REQ, req);
    }

    /** 房主开始游戏 */
    private async onStartGame(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_ROOM_OWNER_START_GAME_REQ, {});
    }

    /** Tongits 胜利点击确认 */
    private async onTongitsClick(): Promise<void> {
        await this.safeRequest(MessageType.TONGITS_WIN_CLICK_REQ, {});
    }

    /** 查看结算详情 */
    private async onResultDetails(): Promise<void> {
        const res = await this.safeRequest<GameResultDetailsRes>(
            MessageType.TONGITS_GAME_RESULT_DETAILS_REQ, {},
        );
        if (res) Nexus.emit(TongitsEvents.RESULT_DETAILS, res);
    }

    // ── 页面操作 ─────────────────────────────────────────

    private onOpenSettings(): void {
        Nexus.ui.show(CommonUI.SETTING);
    }

    private async onBackLobby(): Promise<void> {
        await Nexus.bundle.enter('lobby');
    }

    // ── 生命周期 ─────────────────────────────────────────

    override destroy(): void {
        this._model.destroy();
        super.destroy();
    }
}
