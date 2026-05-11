/**
 * MockView — 服务端消息模拟面板（仅开发调试用）
 *
 * 纯 UI 入口：按钮点击 → 委托 MockServer 执行模拟逻辑。
 * 按服务端实际消息流程逐步扩展。
 */

import { _decorator } from 'cc';
import { UIPanel } from 'db://nexus-framework/base/UIPanel';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { MockServer } from './MockServer';
import {SELF_ID, P2_ID, P3_ID} from './MockConst';

const { ccclass } = _decorator;

@ccclass('MockView')
export class MockView extends UIPanel {

    private _server = new MockServer();

    // ── UIPanel 生命周期 ──────────────────────────────────

    onShow(): void {}

    onClickClose(): void {
        this._server.unregisterHandlers();
        this.close();
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：进房 (第 2 步)
    // ══════════════════════════════════════════════════════════

    /** 模拟进入房间（等待状态） */
    clickJoinRoom(): void {
        this._server.joinRoom();
    }

    /** 模拟重连进入（游戏进行中） */
    clickRejoin(): void {
        this._server.rejoin();
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：游戏准备 + 开始 (第 3 步)
    // ══════════════════════════════════════════════════════════

    /** 模拟初始化牌局（洗牌发牌，不发广播） */
    clickInitGame(): void {
        this._server.initGame();
    }

    /** 模拟 GameReady 满人倒计时 */
    clickGameReady(): void {
        this._server.gameReady();
    }

    /** 模拟 GameStart 游戏开始（同时注册请求拦截） */
    clickGameStart(): void {
        this._server.gameStart();
        this._server.registerHandlers();
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：回合切换 (第 4 步)
    // ══════════════════════════════════════════════════════════

    /** 模拟轮到自己 */
    clickActionChangeSelf(): void {
        this._server.actionChangeTo(SELF_ID);
    }

    /** 模拟轮到 P2 */
    clickActionChangeOther(): void {
        this._server.actionChangeTo(P2_ID);
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：摸牌 (第 5 步)
    // ══════════════════════════════════════════════════════════

    /** 模拟自己摸牌（通过广播路径） */
    clickDrawSelf(): void {
        this._server.sendSelfDrawBroadcast();
    }

    /** 模拟 P2 摸牌 */
    clickDrawP2(): void {
        this._server.sendDrawBroadcast(P2_ID);
    }

    /** 模拟 P3 摸牌 */
    clickDrawP3(): void {
        this._server.sendDrawBroadcast(P3_ID);
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：一键完整流程
    // ══════════════════════════════════════════════════════════

    /**
     * 一键模拟完整游戏流程：
     *   GameReady(3s) → GameStart → 多圈对局 → BeforeResult → GameResult
     *
     * AI 自动摸牌弃牌，SELF 回合等待玩家真实操作。
     */
    clickRunFullGame(): void {
        this._server.runFullGame();
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：结算测试
    // ══════════════════════════════════════════════════════════

    /** 模拟 Tongits 获胜结算（winType=1，自己获胜）：BeforeResult → 8s → GameResult */
    clickResultTongits(): void {
        if (!this._server.gameInfo) this._server.initGame();
        this._server.sendBeforeResult(SELF_ID, 1);
    }

    /** 模拟挑战获胜结算（winType=2，自己获胜，含 Showdown 手牌）：BeforeResult → 8s → GameResult */
    clickResultChallenge(): void {
        if (!this._server.gameInfo) this._server.initGame();
        this._server.sendBeforeResult(SELF_ID, 2);
    }

    /** 模拟牌堆耗尽结算（winType=3，P2 获胜）：BeforeResult → 8s → GameResult */
    clickResultDeckEmpty(): void {
        if (!this._server.gameInfo) this._server.initGame();
        this._server.sendBeforeResult(P2_ID, 3);
    }

    /** 模拟房间重置（回到等待状态） */
    clickRoomReset(): void {
        this._server.sendRoomReset();
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：挑战测试
    // ══════════════════════════════════════════════════════════

    /**
     * 模拟自己发起挑战：
     *   自己 changeStatus=2 → ChallengeBroadcast → AI 随机接受/拒绝(PK) → BeforeResult → GameResult
     */
    clickChallengeSelf(): void {
        if (!this._server.gameInfo) this._server.initGame();
        this._server.registerHandlers();
        this._server.simulateSelfChallenge();
    }

    /**
     * 模拟 P2 发起挑战（自己需要响应接受/拒绝）：
     *   ChallengeBroadcast → 等待自己通过 UI 响应
     */
    clickChallengeP2(): void {
        if (!this._server.gameInfo) this._server.initGame();
        this._server.registerHandlers();
        const p2 = this._server.mp(P2_ID)!;
        p2.changeStatus = 2;
        this._server.setAwaitingBeforeResult(true);
        this._server.sendChallengeBroadcast(P2_ID);
    }

    // ══════════════════════════════════════════════════════════
    // 按钮：表情/文字气泡测试
    // ══════════════════════════════════════════════════════════

    /** 可用表情名列表 */
    private _emojiNames = [
        'Afraid', 'Angry', 'Blink', 'Blush', 'Cool', 'Cry',
        'Ghost', 'Great', 'Happy', 'Joy',
    ];
    private _emojiIdx = 0;

    /** 在自己头像上播放 Spine 表情动画（循环切换不同表情） */
    clickEmojiSelf(): void {
        const name = this._emojiNames[this._emojiIdx % this._emojiNames.length];
        this._emojiIdx++;
        console.log(`[Mock] playEmoji SELF: ${name}`);
        Nexus.emit(GameEvents.PLAY_EMOJI, { userId: SELF_ID, type: 1, content: name });
    }

    /** 在 P2 头像上播放表情 */
    clickEmojiP2(): void {
        const name = this._emojiNames[this._emojiIdx % this._emojiNames.length];
        this._emojiIdx++;
        console.log(`[Mock] playEmoji P2: ${name}`);
        Nexus.emit(GameEvents.PLAY_EMOJI, { userId: P2_ID, type: 1, content: name });
    }

    /** 在 P3 头像上播放表情 */
    clickEmojiP3(): void {
        const name = this._emojiNames[this._emojiIdx % this._emojiNames.length];
        this._emojiIdx++;
        console.log(`[Mock] playEmoji P3: ${name}`);
        Nexus.emit(GameEvents.PLAY_EMOJI, { userId: P3_ID, type: 1, content: name });
    }

    /** 在自己头像上显示文字气泡 */
    clickTextSelf(): void {
        console.log('[Mock] showText SELF');
        Nexus.emit(GameEvents.PLAY_EMOJI, { userId: SELF_ID, type: 2, content: 'Hello!' });
    }

    /** 在 P2 头像上显示文字气泡 */
    clickTextP2(): void {
        console.log('[Mock] showText P2');
        Nexus.emit(GameEvents.PLAY_EMOJI, { userId: P2_ID, type: 2, content: 'Good game!' });
    }
}
