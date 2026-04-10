/**
 * Tongits 子游戏事件名：
 *   Model -> View（广播/数据更新）用常量名
 *   View -> Controller（用户命令）用 CMD_ 前缀
 */
export const TongitsEvents = {
    CMD_OPEN_MOCK:"tongits-open-mock",
    // ---------- Model -> View（服务端广播） ----------
    /** 游戏开始 */
    GAME_START: 'tongits:gameStart',
    /** 操作变动（轮到谁、倒计时等） */
    ACTION_CHANGE: 'tongits:actionChange',
    /** 抽牌广播 */
    DRAW: 'tongits:draw',
    /** 出牌（组合）广播 */
    MELD: 'tongits:meld',
    /** 补牌/压牌广播 */
    LAY_OFF: 'tongits:layOff',
    /** 打牌（弃牌）广播 */
    DISCARD: 'tongits:discard',
    /** 吃牌广播 */
    TAKE: 'tongits:take',
    /** 挑战广播 */
    CHALLENGE: 'tongits:challenge',
    /** PK 广播 */
    PK: 'tongits:pk',
    /** 结算前比牌 */
    BEFORE_RESULT: 'tongits:beforeResult',
    /** 游戏结算 */
    GAME_RESULT: 'tongits:gameResult',
    /** 房间重置 */
    ROOM_RESET: 'tongits:roomReset',
    /** 结算详情（主动请求返回） */
    RESULT_DETAILS: 'tongits:resultDetails',

    // ---------- Model -> View（自己操作的 RES 响应） ----------
    /** 自己抽牌响应 */
    DRAW_RES: 'tongits:drawRes',
    /** 自己出牌组响应 */
    MELD_RES: 'tongits:meldRes',
    /** 自己弃牌响应 */
    DISCARD_RES: 'tongits:discardRes',
    /** 自己吃牌响应 */
    TAKE_RES: 'tongits:takeRes',
    /** 自己补牌/压牌响应 */
    LAY_OFF_RES: 'tongits:layOffRes',
    /** 自己挑战操作响应 */
    CHALLENGE_RES: 'tongits:challengeRes',

    // ---------- View -> Controller（用户命令） ----------
    /** 抽牌 */
    CMD_DRAW: 'tongits:cmd:draw',
    /** 出牌（组合），data: { cards: number[] } */
    CMD_MELD: 'tongits:cmd:meld',
    /** 补牌/压牌，data: { card, targetPlayerId, targetMeldId } */
    CMD_LAY_OFF: 'tongits:cmd:layOff',
    /** 打牌（弃牌），data: { card: number } */
    CMD_DISCARD: 'tongits:cmd:discard',
    /** 吃牌，data: { cardsFromHand: number[] } */
    CMD_TAKE: 'tongits:cmd:take',
    /** 挑战操作，data: { changeStatus: number } (2:发起 3:接受 4:拒绝) */
    CMD_CHALLENGE: 'tongits:cmd:challenge',
    /** 房主开始游戏 */
    CMD_START_GAME: 'tongits:cmd:startGame',
    /** Tongits 点击（胜利确认） */
    CMD_TONGITS_CLICK: 'tongits:cmd:tongitsClick',
    /** 查看结算详情 */
    CMD_RESULT_DETAILS: 'tongits:cmd:resultDetails',
    /** 手牌分组（本地操作） */
    CMD_GROUP: 'tongits:cmd:group',
    /** 手牌取消分组（本地操作） */
    CMD_UNGROUP: 'tongits:cmd:ungroup',
    /** Drop 按钮点击（UI信号，TongitsView 填入真实 cards 后再发 CMD_MELD） */
    CMD_DROP_BTN: 'tongits:cmd:dropBtn',
    /** Dump 按钮点击（UI信号，TongitsView 填入真实 card 后再发 CMD_DISCARD） */
    CMD_DUMP_BTN: 'tongits:cmd:dumpBtn',
} as const;
