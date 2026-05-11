/**
 * Slzq 子游戏事件名：
 *   Model -> View（广播/数据更新）用常量名
 *   View -> Controller（用户命令）用 CMD_ 前缀
 */
export const SlzqEvents = {
    CMD_OPEN_MOCK:"slzq-open-mock",
    // ---------- Model -> View（服务端广播） ----------
    /** 游戏开始 */
    GAME_START: 'slzq:gameStart',
    /** 操作变动（轮到谁、倒计时等） */
    ACTION_CHANGE: 'slzq:actionChange',
    /** 抽牌广播 */
    DRAW: 'slzq:draw',
    /** 出牌（组合）广播 */
    MELD: 'slzq:meld',
    /** 补牌/压牌广播 */
    LAY_OFF: 'slzq:layOff',
    /** 打牌（弃牌）广播 */
    DISCARD: 'slzq:discard',
    /** 吃牌广播 */
    TAKE: 'slzq:take',
    /** 挑战广播 */
    CHALLENGE: 'slzq:challenge',
    /** PK 广播 */
    PK: 'slzq:pk',
    /** 结算前比牌 */
    BEFORE_RESULT: 'slzq:beforeResult',
    /** 游戏结算 */
    GAME_RESULT: 'slzq:gameResult',
    /** 游戏即将开始倒计时（满人触发） */
    GAME_READY: 'slzq:gameReady',
    /** 房间重置 */
    ROOM_RESET: 'slzq:roomReset',
    /** 结算详情（主动请求返回） */
    RESULT_DETAILS: 'slzq:resultDetails',

    // ---------- Model -> View（自己操作的 RES 响应） ----------
    /** 操作完成后服务端判定达成 Slzq 条件 */
    HAS_TONGITS: 'slzq:hasSlzq',
    /** 自己抽牌响应 */
    DRAW_RES: 'slzq:drawRes',
    /** 自己出牌组响应 */
    MELD_RES: 'slzq:meldRes',
    /** 自己弃牌响应 */
    DISCARD_RES: 'slzq:discardRes',
    /** 自己吃牌响应 */
    TAKE_RES: 'slzq:takeRes',
    /** 自己补牌/压牌响应 */
    LAY_OFF_RES: 'slzq:layOffRes',
    /** 自己挑战操作响应 */
    CHALLENGE_RES: 'slzq:challengeRes',

    // ---------- View -> Controller（用户命令） ----------
    /** 抽牌 */
    CMD_DRAW: 'slzq:cmd:draw',
    /** 出牌（组合），data: { cards: number[] } */
    CMD_MELD: 'slzq:cmd:meld',
    /** 补牌/压牌，data: { card, targetPlayerId, targetMeldId } */
    CMD_LAY_OFF: 'slzq:cmd:layOff',
    /** 打牌（弃牌），data: { card: number } */
    CMD_DISCARD: 'slzq:cmd:discard',
    /** 吃牌，data: { cardsFromHand: number[] } */
    CMD_TAKE: 'slzq:cmd:take',
    /** 挑战操作，data: { changeStatus: number } (2:发起 3:接受 4:拒绝) */
    CMD_CHALLENGE: 'slzq:cmd:challenge',
    /** 房主开始游戏 */
    CMD_START_GAME: 'slzq:cmd:startGame',
    /** Slzq 点击（胜利确认） */
    CMD_TONGITS_CLICK: 'slzq:cmd:slzqClick',
    /** 查看结算详情 */
    CMD_RESULT_DETAILS: 'slzq:cmd:resultDetails',
    /** 回前台/重连后主动拉取最新房间状态（3001→3002） */
    CMD_REFRESH_ROOM: 'slzq:cmd:refreshRoom',
    /** 切换自动组牌响应 */
    SWITCH_AUTO_GROUP_RES: 'slzq:switchAutoGroupRes',
    /** 手动组牌响应 */
    PLAYER_GROUP_CARDS_RES: 'slzq:playerGroupCardsRes',

    /** 手牌分组（本地操作） */
    CMD_GROUP: 'slzq:cmd:group',
    /** 手牌取消分组（本地操作） */
    CMD_UNGROUP: 'slzq:cmd:ungroup',
    /** Drop 按钮点击（UI信号，SlzqView 填入真实 cards 后再发 CMD_MELD） */
    CMD_DROP_BTN: 'slzq:cmd:dropBtn',
    /** Dump 按钮点击（UI信号，SlzqView 填入真实 card 后再发 CMD_DISCARD） */
    CMD_DUMP_BTN: 'slzq:cmd:dumpBtn',
    /** Sapaw 按钮点击（UI信号，SlzqView 自动选目标后再发 CMD_LAY_OFF） */
    CMD_SAPAW_BTN: 'slzq:cmd:sapawBtn',
    /** 切换自动组牌，data: { isAuto: boolean } */
    CMD_SWITCH_AUTO_GROUP: 'slzq:cmd:switchAutoGroup',
    /** 手动组牌，data: { targetGroupCards: Cards[] } */
    CMD_PLAYER_GROUP_CARDS: 'slzq:cmd:playerGroupCards',
} as const;
