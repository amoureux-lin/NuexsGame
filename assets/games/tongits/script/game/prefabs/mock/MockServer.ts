/**
 * MockServer — 模拟服务端逻辑（状态管理 + 请求拦截 + 广播构建）
 *
 * 纯逻辑层，不依赖 Cocos 组件，由 MockView 调用。
 * 按服务端实际消息流程逐步扩展。
 */

import { Nexus } from 'db://nexus-framework/core/Nexus';
import { MessageType } from '../../../proto/message_type';
import type {
    TongitsPlayerInfo, GameInfo, PotInfo, Meld,
    JoinRoomRes, GameReadyBroadcast, GameStartBroadcast,
    ActionChangeBroadcast,
    DrawCardRes, DrawCardBroadcast,
    MeldCardReq, MeldCardRes, MeldCardBroadcast,
    LayOffCardReq, LayOffCardRes, LayOffCardBroadcast,
    DiscardCardReq, DiscardCardRes, DiscardCardBroadcast,
    TakeCardReq, TakeCardRes, TakeCardBroadcast,
    ChallengeReq, ChallengeRes, ChallengeBroadcast, PKBroadcast,
    BeforeResultBroadcast, GameResultBroadcast, RoomResetBroadcast,
    SwitchAutoGroupCardsReq, SwitchAutoGroupCardsRes,
    GamePlayerGroupCardsReq, GamePlayerGroupCardsRes,
    PlayerResult,
} from '../../../proto/tongits';
import {
    SELF_ID, P2_ID, P3_ID, TURN_ORDER,
    FULL_DECK, SELF_FIXED_HAND, TAKE_BAIT_CARD,
    PLAYER_STATUS,
    shuffle, toCards, calcPoint,
    createMockPlayer, toProtoPlayer, buildPlayerInfo,
    buildPot, buildWaitingGameInfo, buildPlayingGameInfo, buildRoomInfo,
    type MockPlayer,
} from './MockConst';

export class MockServer {

    // ══════════════════════════════════════════════════════════
    // 游戏状态
    // ══════════════════════════════════════════════════════════

    /** 所有玩家内部数据 */
    players: MockPlayer[] = [];

    /** 游戏信息（null = 未初始化） */
    gameInfo: GameInfo | null = null;

    /** 牌堆 */
    deck: number[] = [];

    /** 持久化底池（跨局保留） */
    pot: PotInfo = buildPot(1);

    /** 当前操作玩家在 TURN_ORDER 中的索引 */
    actionIdx = 0;

    /** roundMsg 等待自己弃牌的回调 */
    private _selfDiscardResolver: (() => void) | null = null;

    /** 挑战后等待 BeforeResult */
    private _awaitingBeforeResult = false;

    /** Tongits 已声明标记 */
    private _tongitsDeclared = false;

    // ══════════════════════════════════════════════════════════
    // 内部工具
    // ══════════════════════════════════════════════════════════

    /** 当前操作玩家 ID */
    get actionId(): number { return TURN_ORDER[this.actionIdx]; }

    /** 切换到下一个操作玩家 */
    nextTurn(): void { this.actionIdx = (this.actionIdx + 1) % TURN_ORDER.length; }

    /** 按 userId 查找内部玩家 */
    mp(userId: number): MockPlayer | undefined {
        return this.players.find(p => p.userId === userId);
    }

    /** 构建所有玩家的 proto 快照（仅 SELF 附带手牌） */
    snapPlayers(): TongitsPlayerInfo[] {
        return this.players.map(mp => toProtoPlayer(mp, mp.userId === SELF_ID));
    }

    /** 构建所有玩家的 proto 快照（全部附带手牌，结算用） */
    snapAllPlayers(winnerId?: number): TongitsPlayerInfo[] {
        return this.players.map(mp => {
            const pi = toProtoPlayer(mp, true);
            if (winnerId !== undefined) {
                pi.isWin     = mp.userId === winnerId;
                pi.cardPoint = calcPoint(mp.hand);
            }
            return pi;
        });
    }

    /** 注入 WS 消息到框架 */
    send(msgType: number, data: unknown): void {
        console.log(`[MockServer] → msgType:${msgType}`, data);
        Nexus.net.simulateWsReceive?.(msgType, data);
    }

    // ══════════════════════════════════════════════════════════
    // 第 2 步：进房 (JoinRoom 3001→3002)
    // ══════════════════════════════════════════════════════════

    /**
     * 模拟进入房间（游戏未开始，等待状态）。
     * 创建 3 个玩家，发送 JoinRoomRes。
     */
    joinRoom(): void {
        this.players = [
            createMockPlayer(SELF_ID, [], false, 1, 1),
            createMockPlayer(P2_ID,   [], false, 0, 2),
            createMockPlayer(P3_ID,   [], false, 0, 3),
        ];
        this.gameInfo = buildWaitingGameInfo();

        const data: JoinRoomRes = {
            roomInfo:       buildRoomInfo(),
            players:        this.snapPlayers(),
            watchers:       [],
            playersCount:   3,
            speakers:       this.players.map(p => buildPlayerInfo(p.userId, p.post, p.seat)),
            self:           toProtoPlayer(this.players[0], true),
            gameInfo:       { ...this.gameInfo },
            playerSettings: undefined,
        };
        this.send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    /**
     * 模拟重连进入（游戏已在进行中）。
     * 需先调用 initGame() 初始化牌局。
     */
    rejoin(): void {
        const gi = this.gameInfo ? { ...this.gameInfo } : buildPlayingGameInfo(this.actionId);
        const data: JoinRoomRes = {
            roomInfo:       buildRoomInfo(),
            players:        this.snapPlayers(),
            watchers:       [],
            playersCount:   3,
            speakers:       [],
            self:           toProtoPlayer(this.mp(SELF_ID)!, true),
            gameInfo:       gi,
            playerSettings: undefined,
        };
        this.send(MessageType.TONGITS_JOIN_ROOM_RES, data);
    }

    // ══════════════════════════════════════════════════════════
    // 第 3 步：游戏准备 + 开始 (GameReady 3035 → GameStart 3015)
    // ══════════════════════════════════════════════════════════

    /**
     * 初始化牌局数据（洗牌发牌）。
     * 庄家 P3: 13 张，SELF: 12 张，P2: 12 张，牌堆: 15 张。
     */
    initGame(): void {
        const selfHand = [...SELF_FIXED_HAND];
        const baseDeck = shuffle(FULL_DECK.filter(c => !selfHand.includes(c) && c !== TAKE_BAIT_CARD));
        const p2Hand   = baseDeck.splice(0, 12);
        const p3Hand   = [TAKE_BAIT_CARD, ...baseDeck.splice(0, 12)];

        this.actionIdx = TURN_ORDER.indexOf(P3_ID);
        this.players   = [
            createMockPlayer(SELF_ID, selfHand, false, 1, 1),
            createMockPlayer(P2_ID,   p2Hand,   false, 0, 2),
            createMockPlayer(P3_ID,   p3Hand,   true,  0, 3),
        ];
        this.gameInfo = { ...buildPlayingGameInfo(P3_ID, baseDeck.length), pot: { ...this.pot } };
        this.deck     = [...baseDeck];

        console.log('[MockServer] 牌局已初始化', {
            selfHand, p2: p2Hand.length, p3: p3Hand.length, deck: this.deck.length,
        });
    }

    /**
     * 发送 GameReadyBroadcast（满人倒计时通知）。
     * @param seconds 倒计时秒数
     */
    gameReady(seconds = 3): void {
        const data: GameReadyBroadcast = {
            countdownSeconds: seconds,
            startTime:        Math.floor(Date.now() / 1000) + seconds,
        };
        this.send(MessageType.TONGITS_GAME_READY_BROADCAST, data);
    }

    /**
     * 发送 GameStartBroadcast（游戏正式开始）。
     * 若未初始化牌局，自动调用 initGame()。
     */
    gameStart(): void {
        if (!this.gameInfo) this.initGame();
        const data: GameStartBroadcast = {
            gameInfo: { ...this.gameInfo! },
            players:  this.snapPlayers(),
            userId:   SELF_ID,
        };
        this.send(MessageType.TONGITS_START_GAME_BROADCAST, data);
    }

    // ══════════════════════════════════════════════════════════
    // 第 4 步：回合切换 (ActionChange 3018)
    // ══════════════════════════════════════════════════════════

    /**
     * 发送 ActionChangeBroadcast（切换到当前 actionIdx 指向的玩家）。
     * 将该玩家状态设为 SELECT，并附带视角玩家的手牌。
     */
    sendActionChange(): void {
        const pid = this.actionId;
        const mp  = this.mp(pid)!;
        mp.status = PLAYER_STATUS.SELECT;
        this.gameInfo!.actionPlayerId = pid;

        // 轮到 SELF 且已有 meld 时允许发起挑战
        if (pid === SELF_ID) {
            mp.isFight = mp.displayedMelds.length > 0;
        }

        const selfMp = this.mp(SELF_ID)!;
        const data: ActionChangeBroadcast = {
            actionPlayerId: pid,
            countdown:      Math.floor(Date.now() / 1000) + 25,
            isFight:        mp.isFight,
            status:         mp.status,
            groupCards:      pid === SELF_ID ? toCards(selfMp.hand) : [],
            userId:         SELF_ID,
        };
        this.send(MessageType.TONGITS_ACTION_CHANGE_BROADCAST, data);
    }

    /**
     * 切换到指定玩家并发送 ActionChange。
     */
    actionChangeTo(userId: number): void {
        const idx = TURN_ORDER.indexOf(userId);
        if (idx >= 0) this.actionIdx = idx;
        this.sendActionChange();
    }

    // ══════════════════════════════════════════════════════════
    // 第 5 步：摸牌 (Draw 3003→3004 / 3021)
    // ══════════════════════════════════════════════════════════

    /**
     * 注册所有 Mock 请求拦截器。
     * 客户端 wsRequest 会被拦截并返回 mock 数据，模拟服务端响应。
     */
    registerHandlers(): void {
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_DRAW_REQ,                    () => this._handleDraw());
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_MELD_REQ,                    (b) => this._handleMeld(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_LAYOFF_REQ,                  (b) => this._handleLayOff(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_DISCARD_REQ,                 (b) => this._handleDiscard(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_TAKE_REQ,                    (b) => this._handleTake(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_CHALLENGE_ACTION_REQ,         (b) => this._handleChallenge(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_WIN_CLICK_REQ,               ()  => this._handleWinClick());
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_SWITCH_AUTO_GROUP_CARDS_REQ,  (b) => this._handleSwitchAutoGroup(b));
        Nexus.net.registerMockHandler?.(MessageType.TONGITS_GAME_PLAYER_GROUP_CARDS_REQ, (b) => this._handlePlayerGroupCards(b));
    }

    /** 注销所有拦截器 */
    unregisterHandlers(): void {
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_DRAW_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_MELD_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_LAYOFF_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_DISCARD_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_TAKE_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_CHALLENGE_ACTION_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_WIN_CLICK_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_SWITCH_AUTO_GROUP_CARDS_REQ);
        Nexus.net.unregisterMockHandler?.(MessageType.TONGITS_GAME_PLAYER_GROUP_CARDS_REQ);
    }

    // ══════════════════════════════════════════════════════════
    // 请求拦截器实现（Req → Res）
    // ══════════════════════════════════════════════════════════

    /** 摸牌：从牌堆抽一张加入手牌 */
    private _handleDraw(): DrawCardRes {
        const mp   = this.mp(SELF_ID)!;
        const card = this.deck.pop() ?? 0;
        if (card) mp.hand.push(card);
        mp.status = PLAYER_STATUS.ACTION;
        if (this.gameInfo) this.gameInfo.deckCardCount = this.deck.length;
        mp.isFight = mp.displayedMelds.length > 0;
        const hasTongits = mp.hand.length === 0;
        console.log(`[MockServer←RES] DRAW card=${card} isFight=${mp.isFight} hasTongits=${hasTongits}`);
        return {
            drawnCard: card, hasTongits,
            handCardCount: mp.hand.length, groupCards: toCards(mp.hand),
        };
    }

    /** 出牌组：从手牌移除指定牌，生成新 Meld */
    private _handleMeld(body: unknown): MeldCardRes {
        const req = body as MeldCardReq;
        const mp  = this.mp(SELF_ID)!;
        mp.hand   = mp.hand.filter(c => !req.cards.includes(c));
        const newMeld: Meld = {
            meldId: mp.displayedMelds.length + 1,
            cards: [...req.cards], ownerId: SELF_ID, highlightCards: 0, locked: false,
        };
        mp.displayedMelds.push(newMeld);
        mp.isFight = mp.displayedMelds.length > 0;
        const hasTongits = mp.hand.length === 0;
        console.log(`[MockServer←RES] MELD cards=${req.cards} isFight=${mp.isFight} hasTongits=${hasTongits}`);
        return { newMeld, hasTongits, handCardCount: mp.hand.length };
    }

    /** 补牌：从手牌移除一张，追加到目标牌组 */
    private _handleLayOff(body: unknown): LayOffCardRes {
        const req = body as LayOffCardReq;
        const mp  = this.mp(SELF_ID)!;
        mp.hand   = mp.hand.filter(c => c !== req.card);
        const target = this.mp(req.targetPlayerId);
        const meld   = target?.displayedMelds.find(m => m.meldId === req.targetMeldId);
        if (meld) meld.cards.push(req.card);
        mp.isFight = mp.displayedMelds.length > 0;
        const hasTongits = mp.hand.length === 0;
        console.log(`[MockServer←RES] LAYOFF card=${req.card} → p${req.targetPlayerId} meld${req.targetMeldId}`);
        return {
            cardAdded: req.card, targetPlayerId: req.targetPlayerId,
            targetMeldId: req.targetMeldId, hasTongits,
            handCardCount: mp.hand.length,
        };
    }

    /** 弃牌：从手牌移除一张，推入弃牌堆，回合结束 */
    private _handleDiscard(body: unknown): DiscardCardRes {
        const req = body as DiscardCardReq;
        const mp  = this.mp(SELF_ID)!;
        mp.hand   = mp.hand.filter(c => c !== req.card);
        mp.status = PLAYER_STATUS.INIT;
        if (this.gameInfo) {
            this.gameInfo.discardPile.push(req.card);
            this.gameInfo.discardCard = req.card;
        }
        console.log(`[MockServer←RES] DISCARD card=${req.card}`);
        // 通知 roundMsg 继续
        if (this._selfDiscardResolver) {
            const resolve = this._selfDiscardResolver;
            this._selfDiscardResolver = null;
            resolve();
        }
        return {
            discardedCard: req.card, unlockMelds: [],
            handCardCount: mp.hand.length,
            discardPile: [...(this.gameInfo?.discardPile ?? [])],
        };
    }

    /** 吃牌：用手牌 + 弃牌组成新牌组 */
    private _handleTake(body: unknown): TakeCardRes {
        const req         = body as TakeCardReq;
        const mp          = this.mp(SELF_ID)!;
        const discardCard = this.gameInfo?.discardCard ?? 0;
        mp.hand           = mp.hand.filter(c => !req.cardsFromHand.includes(c));
        const allCards     = [...req.cardsFromHand, discardCard].filter(Boolean);
        const newMeld: Meld = {
            meldId: mp.displayedMelds.length + 1,
            cards: allCards, ownerId: SELF_ID, highlightCards: discardCard, locked: false,
        };
        mp.displayedMelds.push(newMeld);
        if (this.gameInfo) this.gameInfo.discardCard = 0;
        mp.isFight = mp.displayedMelds.length > 0;
        const hasTongits = mp.hand.length === 0;
        console.log(`[MockServer←RES] TAKE fromHand=${req.cardsFromHand} discard=${discardCard}`);
        return { newMeld, hasTongits, handCardCount: mp.hand.length, discard: discardCard };
    }

    /** 挑战：更新自身 changeStatus，返回所有玩家的挑战状态 */
    private _handleChallenge(body: unknown): ChallengeRes {
        const req = body as ChallengeReq;
        const mp  = this.mp(SELF_ID)!;
        mp.changeStatus = req.changeStatus;
        console.log(`[MockServer←RES] CHALLENGE changeStatus=${req.changeStatus}`);

        // 自己发起挑战(2)：进入挑战阶段 + 广播 + AI 延迟响应
        if (req.changeStatus === 2) {
            if (this.gameInfo) this.gameInfo.status = 3;
            this.sendChallengeBroadcast(SELF_ID);
            this._scheduleAIResponses(SELF_ID);
        }
        // 自己做出响应(3=接受/4=拒绝)：延迟发送 BeforeResult
        if (this._awaitingBeforeResult && (req.changeStatus === 3 || req.changeStatus === 4)) {
            this._awaitingBeforeResult = false;
            setTimeout(() => this.sendBeforeResult(SELF_ID, 2), 2000);
        }
        return {
            basePlayers: this.players.map(p => ({
                playerId: p.userId, changeStatus: p.changeStatus, countdown: 10,
            })),
        };
    }

    /**
     * AI 玩家延迟随机响应挑战（接受=3 / 拒绝=4），
     * 全部响应完毕后触发 BeforeResult 结算。
     */
    private _scheduleAIResponses(challengerId: number): void {
        const aiPlayers = this.players.filter(p => p.userId !== challengerId);
        let responded = 0;

        for (let i = 0; i < aiPlayers.length; i++) {
            const delay = 1500 + i * 1200 + Math.random() * 800;
            setTimeout(() => {
                const ai = aiPlayers[i];
                // 随机接受(3)或拒绝(4)
                const status = Math.random() < 0.5 ? 3 : 4;
                this.sendPKBroadcast(ai.userId, status);
                console.log(`[MockServer] AI ${ai.userId} → ${status === 3 ? 'ACCEPT' : 'FOLD'}`);

                responded++;
                if (responded >= aiPlayers.length) {
                    // 全部响应完毕 → 判定结果并结算
                    const anyAccepted = aiPlayers.some(p => p.changeStatus === 3);
                    if (anyAccepted) {
                        // 有人接受：比点数，点数最低者胜
                        const eligible = this.players.filter(p => p.changeStatus !== 4);
                        eligible.sort((a, b) => calcPoint(a.hand) - calcPoint(b.hand));
                        const winnerId = eligible[0]?.userId ?? challengerId;
                        setTimeout(() => this.sendBeforeResult(winnerId, 2), 1500);
                    } else {
                        // 全部拒绝：发起者直接获胜
                        setTimeout(() => this.sendBeforeResult(challengerId, 2), 1500);
                    }
                }
            }, delay);
        }
    }

    /** Tongits 声明：通知 roundMsg 结束，延迟发 BeforeResult(winType=1) */
    private _handleWinClick(): object {
        console.log('[MockServer←RES] WIN_CLICK Tongits declared');
        this._tongitsDeclared = true;
        if (this._selfDiscardResolver) {
            const resolve = this._selfDiscardResolver;
            this._selfDiscardResolver = null;
            resolve();
        }
        setTimeout(() => this.sendBeforeResult(SELF_ID, 1), 800);
        return {};
    }

    /** 切换自动组牌：更新 isAuto，返回重组后手牌 */
    private _handleSwitchAutoGroup(body: unknown): SwitchAutoGroupCardsRes {
        const req = body as SwitchAutoGroupCardsReq;
        const mp  = this.mp(SELF_ID)!;
        mp.isAuto = req.isAuto;
        console.log(`[MockServer←RES] SWITCH_AUTO_GROUP isAuto=${req.isAuto}`);
        return { isAuto: req.isAuto, groupCards: toCards(mp.hand) };
    }

    /** 手动组牌：直接返回请求的分组（模拟服务端校验通过） */
    private _handlePlayerGroupCards(body: unknown): GamePlayerGroupCardsRes {
        const req = body as GamePlayerGroupCardsReq;
        console.log(`[MockServer←RES] PLAYER_GROUP_CARDS groups=${req.targetGroupCards?.length}`);
        return { groupCards: req.targetGroupCards ?? [] };
    }

    /**
     * 模拟他人摸牌广播（drawnCard=0，不暴露牌面）。
     */
    sendDrawBroadcast(pid: number): void {
        const mp   = this.mp(pid);
        if (!mp) return;
        const card = this.deck.pop() ?? 0;
        if (card) mp.hand.push(card);
        mp.status = PLAYER_STATUS.ACTION;
        if (this.gameInfo) this.gameInfo.deckCardCount = this.deck.length;

        const data: DrawCardBroadcast = {
            playerId:      pid,
            userId:        SELF_ID,
            drawnCard:     0,        // 他人牌面不可见
            handCardCount: mp.hand.length,
            groupCards:     [],       // 他人手牌不下发
        };
        console.log(`[MockServer→DRAW] player=${pid} card=${card} count=${mp.hand.length}`);
        this.send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    /** 模拟自己摸牌广播（服务端代操作场景） */
    sendSelfDrawBroadcast(): void {
        const mp   = this.mp(SELF_ID)!;
        const card = this.deck.pop() ?? 0;
        if (card) mp.hand.push(card);
        mp.status = PLAYER_STATUS.ACTION;
        if (this.gameInfo) this.gameInfo.deckCardCount = this.deck.length;
        const data: DrawCardBroadcast = {
            playerId: SELF_ID, userId: SELF_ID, drawnCard: card,
            handCardCount: mp.hand.length, groupCards: toCards(mp.hand),
        };
        this.send(MessageType.TONGITS_DRAW_BROADCAST, data);
    }

    // ── 弃牌广播 ─────────────────────────────────────────

    /** 模拟他人弃牌广播 */
    sendDiscardBroadcast(pid: number, card?: number): void {
        const mp = this.mp(pid);
        if (!mp) return;
        const discardCard = card ?? this._aiPickDiscard(mp);
        if (!discardCard) return;
        mp.hand   = mp.hand.filter(c => c !== discardCard);
        mp.status = PLAYER_STATUS.INIT;
        this.gameInfo!.discardPile.push(discardCard);
        this.gameInfo!.discardCard = discardCard;
        this.nextTurn();
        const data: DiscardCardBroadcast = {
            playerId: pid, discardedCard: discardCard, unlockMelds: [],
            handCardCount: mp.hand.length,
            discardPile: [...this.gameInfo!.discardPile], userId: SELF_ID,
        };
        console.log(`[MockServer→DISCARD] player=${pid} card=${discardCard}`);
        this.send(MessageType.TONGITS_DISCARD_BROADCAST, data);
    }

    /** AI 选一张散牌弃掉 */
    private _aiPickDiscard(mp: MockPlayer): number {
        if (!mp.hand.length) return 0;
        const meldCards = new Set(mp.displayedMelds.flatMap(m => m.cards));
        return mp.hand.find(c => !meldCards.has(c)) ?? mp.hand[0];
    }

    // ── 出牌组广播 ───────────────────────────────────────

    /** 模拟他人出牌组广播 */
    sendMeldBroadcast(pid: number, meldCards: number[]): void {
        const mp = this.mp(pid)!;
        mp.hand  = mp.hand.filter(c => !meldCards.includes(c));
        mp.status = PLAYER_STATUS.ACTION;
        const newMeld: Meld = {
            meldId: mp.displayedMelds.length + 1,
            cards: meldCards, ownerId: pid, highlightCards: 0, locked: false,
        };
        mp.displayedMelds.push(newMeld);
        const data: MeldCardBroadcast = {
            playerId: pid, newMeld: { ...newMeld, cards: [...newMeld.cards] },
            handCardCount: mp.hand.length, userId: SELF_ID,
        };
        console.log(`[MockServer→MELD] player=${pid} cards=${meldCards}`);
        this.send(MessageType.TONGITS_MELD_BROADCAST, data);
    }

    // ── 补牌广播 ─────────────────────────────────────────

    /** 模拟他人补牌广播 */
    sendLayOffBroadcast(actionPid: number, targetPid: number, targetMeldId: number, card: number): void {
        const actor  = this.mp(actionPid);
        const target = this.mp(targetPid);
        if (!actor || !target) return;
        actor.hand   = actor.hand.filter(c => c !== card);
        actor.status = PLAYER_STATUS.INIT;
        const meld = target.displayedMelds.find(m => m.meldId === targetMeldId);
        if (meld) { meld.cards.push(card); meld.highlightCards = card; }
        const data: LayOffCardBroadcast = {
            actionPlayerId: actionPid, targetPlayerId: targetPid, targetMeldId,
            cardAdded: card, handCardCount: actor.hand.length, userId: SELF_ID,
        };
        console.log(`[MockServer→LAYOFF] ${actionPid} card=${card} → p${targetPid} meld${targetMeldId}`);
        this.send(MessageType.TONGITS_LAYOFF_BROADCAST, data);
    }

    // ── 吃牌广播 ─────────────────────────────────────────

    /** 模拟他人吃牌广播 */
    sendTakeBroadcast(pid: number, discardCard: number, meldCards: number[]): void {
        const mp = this.mp(pid);
        if (!mp) return;
        const fromHand = meldCards.filter(c => c !== discardCard);
        mp.hand   = mp.hand.filter(c => !fromHand.includes(c));
        mp.status = PLAYER_STATUS.ACTION;
        const newMeld: Meld = {
            meldId: mp.displayedMelds.length + 1,
            cards: meldCards, ownerId: pid, highlightCards: discardCard, locked: false,
        };
        mp.displayedMelds.push(newMeld);
        if (this.gameInfo) {
            this.gameInfo.discardPile = this.gameInfo.discardPile.filter(c => c !== discardCard);
            this.gameInfo.discardCard = 0;
        }
        const data: TakeCardBroadcast = {
            playerId: pid, newMeld: { ...newMeld, cards: [...newMeld.cards] },
            handCardCount: mp.hand.length, discard: discardCard, userId: SELF_ID,
        };
        console.log(`[MockServer→TAKE] player=${pid} discard=${discardCard}`);
        this.send(MessageType.TONGITS_TAKE_BROADCAST, data);
    }

    /** AI 尝试吃牌：找同点数 2 张 + 弃牌组成刻子 */
    aiPickTakeMeld(pid: number, discardCard: number): number[] | null {
        const mp = this.mp(pid);
        if (!mp) return null;
        const sameRank = mp.hand.filter(c => c % 100 === discardCard % 100);
        if (sameRank.length < 2) return null;
        return [...sameRank.slice(0, 2), discardCard];
    }

    // ── 挑战广播 ─────────────────────────────────────────

    /**
     * 模拟自己发起挑战的完整服务端流程：
     *   更新状态 → ChallengeBroadcast → AI 延迟响应(PK) → BeforeResult
     */
    simulateSelfChallenge(): void {
        const mp = this.mp(SELF_ID)!;
        mp.changeStatus = 2;
        if (this.gameInfo) this.gameInfo.status = 3;
        this.sendChallengeBroadcast(SELF_ID);
        this._scheduleAIResponses(SELF_ID);
    }

    /** 发送挑战广播 */
    sendChallengeBroadcast(challengerId: number): void {
        const selfMp = this.mp(SELF_ID)!;
        const data: ChallengeBroadcast = {
            playerId: challengerId,
            basePlayers: this.players.map(p => ({
                playerId: p.userId, changeStatus: p.changeStatus,
                countdown: p.userId === challengerId ? 0 : Math.floor(Date.now() / 1000) + 10,
            })),
            cardPoint: calcPoint(selfMp.hand),
            userId: SELF_ID,
        };
        this.send(MessageType.TONGITS_CHALLENGE_BROADCAST, data);
    }

    /** 发送 PK 广播（接受/拒绝/烧死） */
    sendPKBroadcast(pid: number, changeStatus: number): void {
        const mp = this.mp(pid)!;
        mp.changeStatus = changeStatus;
        const data: PKBroadcast = { playerId: pid, changeStatus, userId: SELF_ID };
        this.send(MessageType.TONGITS_PK_BROADCAST, data);
    }

    /** 设置等待 BeforeResult 标记 */
    setAwaitingBeforeResult(v: boolean): void { this._awaitingBeforeResult = v; }

    // ── 结算广播 ─────────────────────────────────────────

    /** 发送 BeforeResultBroadcast */
    sendBeforeResult(winnerId: number, winType: number): void {
        if (!this.gameInfo) return;
        this.gameInfo.status = 4;
        const data: BeforeResultBroadcast = {
            winnerId, winType,
            players:   this.snapAllPlayers(winnerId),
            countdown: 5,
            pot:       { ...this.pot },
            userId:    SELF_ID,
        };
        this.send(MessageType.TONGITS_GAME_WIN_BROADCAST, data);
        this._scheduleGameResult(winnerId, 8000);
    }

    /** 发送 GameResultBroadcast */
    sendGameResult(winnerId: number): void {
        this.gameInfo!.status = 5;
        const data: GameResultBroadcast = {
            winnerId,
            playerResults: this._buildPlayerResults(winnerId),
            countdown: Math.floor(Date.now() / 1000) + 30,
            userId: SELF_ID,
        };
        this.send(MessageType.TONGITS_GAME_RESULT_BROADCAST, data);
    }

    /** 延迟发送 GameResult + 更新底池 */
    private _scheduleGameResult(winnerId: number, delayMs: number): void {
        const claimedPot = this.pot.useId === winnerId;
        setTimeout(() => {
            if (!this.gameInfo) return;
            this.sendGameResult(winnerId);
            if (claimedPot) {
                this.pot = buildPot(0);
            } else {
                const next = this.pot.winCount + 1;
                this.pot = { base: next, winCount: next, useId: winnerId };
            }
        }, delayMs);
    }

    private _buildPlayerResults(winnerId: number): PlayerResult[] {
        return this.players.map(mp => {
            const isWin = mp.userId === winnerId;
            const bonus = isWin ? 20 : -10;
            return {
                playerInfo: toProtoPlayer(mp, true),
                sumWinBonus: bonus, normalWinBonus: bonus,
                tongitsWinBonus: 0, cardTypeBonus: 0, bonusBonus: 0,
                burnedBonus: 0, winChallengeBonus: 0, potBonus: 0,
                cardPoint: calcPoint(mp.hand),
            } as PlayerResult;
        });
    }

    // ── 房间重置 ─────────────────────────────────────────

    /** 发送 RoomResetBroadcast */
    sendRoomReset(): void {
        this.players = [
            createMockPlayer(SELF_ID, [], false, 1, 1),
            createMockPlayer(P2_ID,   [], false, 0, 2),
            createMockPlayer(P3_ID,   [], false, 0, 3),
        ];
        this.gameInfo     = null;
        this.deck         = [];
        this.actionIdx    = 0;
        this._selfDiscardResolver = null;
        const data: RoomResetBroadcast = {
            players:  this.snapPlayers(),
            self:     toProtoPlayer(this.players[0], true),
            gameInfo: buildWaitingGameInfo(),
            userId:   SELF_ID,
        };
        this.send(MessageType.TONGITS_ROOM_RESET_BROADCAST, data);
    }

    // ── roundMsg 工具 ────────────────────────────────────

    /** 等待自己弃牌（由 _handleDiscard / _handleWinClick 触发） */
    waitForSelfDiscard(): Promise<void> {
        return new Promise<void>(resolve => { this._selfDiscardResolver = resolve; });
    }

    /** Tongits 是否已声明 */
    get tongitsDeclared(): boolean { return this._tongitsDeclared; }
    resetTongitsDeclared(): void { this._tongitsDeclared = false; }

    // ══════════════════════════════════════════════════════════
    // 完整游戏流程模拟
    // ══════════════════════════════════════════════════════════

    private _running = false;

    /**
     * 从 GameReady 开始，模拟一局完整的服务端游戏流程：
     *
     *   GameReady(3s) → GameStart → [多圈循环] → BeforeResult → GameResult
     *
     * 每圈按 TURN_ORDER 轮流：
     *   AI 回合：摸牌 → (偶尔 meld) → 弃牌
     *   SELF 回合：发 ActionChange(SELECT)，等待玩家真实操作（摸牌→弃牌）
     *
     * 结束条件：牌堆耗尽 / 玩家声明 Tongits
     */
    async runFullGame(): Promise<void> {
        if (this._running) { console.warn('[MockServer] runFullGame 已在运行'); return; }
        this._running = true;
        this._tongitsDeclared = false;

        const W = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
        const STEP = 1200;

        // ── 1. GameReady 倒计时 ──────────────────────────────
        this.gameReady(3);
        await W(3000);

        // ── 2. 初始化 + GameStart ────────────────────────────
        this.initGame();
        this.registerHandlers();
        this.gameStart();
        await W(3000);   // 等发牌动画完成

        // ── 3. 多圈循环 ─────────────────────────────────────
        const MAX_LOOPS = 8;
        const startIdx  = TURN_ORDER.indexOf(P3_ID);  // 庄家先手

        for (let loop = 0; loop < MAX_LOOPS; loop++) {
            for (let t = 0; t < TURN_ORDER.length; t++) {
                // 牌堆耗尽 → 比点数结算
                if (this.deck.length === 0) {
                    console.log('[runFullGame] 牌堆耗尽，触发结算');
                    this._running = false;
                    this.sendBeforeResult(SELF_ID, 3);
                    return;
                }

                const tIdx = (startIdx + t) % TURN_ORDER.length;
                const pid  = TURN_ORDER[tIdx];
                this.actionIdx = tIdx;

                console.log(`[runFullGame] Loop ${loop + 1} | Turn ${t + 1}/3 | Player ${pid}`);

                // 发送 ActionChange
                this.sendActionChange();
                await W(STEP);

                if (pid === SELF_ID) {
                    // ── 自己回合：等待玩家真实操作 ──────────────
                    console.log('[runFullGame] 等待玩家操作（摸牌→弃牌）...');
                    await this.waitForSelfDiscard();

                    // 玩家声明 Tongits → 退出
                    if (this._tongitsDeclared) {
                        console.log('[runFullGame] 玩家声明 Tongits，流程结束');
                        this._tongitsDeclared = false;
                        this._running = false;
                        return;
                    }
                    await W(500);

                } else {
                    // ── AI 回合：摸牌 → (可能 meld) → 弃牌 ────
                    const topDiscard = this.gameInfo?.discardCard ?? 0;
                    const takeMeld   = this.aiPickTakeMeld(pid, topDiscard);

                    if (pid === P3_ID && loop === 0 && t === 0) {
                        // P3 首回合特殊：摸牌 → meld 3张 → 弃出吃牌诱饵
                        this.sendDrawBroadcast(P3_ID);
                        await W(STEP);
                        const mp3 = this.mp(P3_ID)!;
                        const meld3 = mp3.hand.filter(c => c !== TAKE_BAIT_CARD).slice(0, 3);
                        if (meld3.length === 3) {
                            this.sendMeldBroadcast(P3_ID, meld3);
                            await W(STEP);
                        }
                        this.sendDiscardBroadcast(P3_ID, TAKE_BAIT_CARD);
                    } else if (takeMeld) {
                        // AI 吃牌
                        this.sendTakeBroadcast(pid, topDiscard, takeMeld);
                        await W(STEP);
                        this.sendDiscardBroadcast(pid);
                    } else {
                        // 普通：摸牌 → 弃牌
                        this.sendDrawBroadcast(pid);
                        await W(STEP);
                        this.sendDiscardBroadcast(pid);
                    }
                    await W(STEP);
                }
            }
        }

        // 循环结束未结算 → 比点数
        console.log('[runFullGame] 达到最大圈数，触发结算');
        this._running = false;
        this.sendBeforeResult(SELF_ID, 3);
    }

    /** 是否正在运行 */
    get isRunning(): boolean { return this._running; }
}
