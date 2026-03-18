/**
 * 由构建脚本根据 proto 生成，请勿手改。
 */
import type { MessageMapping } from 'db://nexus-framework/index';
import { JoinRoomReq, JoinRoomRes, StartGameReq, StartGameRes, GameStartBroadcast, TongitsReq, TongitsRes, DrawCardReq, DrawCardRes, DrawCardBroadcast, MeldCardReq, MeldCardRes, MeldCardBroadcast, LayOffCardReq, LayOffCardRes, LayOffCardBroadcast, DiscardCardReq, DiscardCardRes, DiscardCardBroadcast, TakeCardReq, TakeCardRes, TakeCardBroadcast, ChallengeReq, ChallengeRes, ChallengeBroadcast, PKBroadcast, GameResultBroadcast, RoomResetBroadcast, ActionChangeBroadcast, BeforeResultBroadcast, GameResultDetailsReq, GameResultDetailsRes, GetPlayerHistoryReq, GetPlayerHistoryRes } from './tongits';
import { MessageType } from './message_type';

/** 从 Writer 得到 Uint8Array（ts_proto 的 encode 返回 Writer） */
function finish(w: { finish(): Uint8Array }): Uint8Array {
    return w.finish();
}

export const TONGITS_MSG_REGISTRY: Record<number, MessageMapping> = {
    [MessageType.TONGITS_JOIN_ROOM_REQ]: {
        decode: (buf) => JoinRoomReq.decode(buf),
        encode: (msg) => finish(JoinRoomReq.encode(msg as JoinRoomReq)),
        name: 'JoinRoomReq',
    },
    [MessageType.TONGITS_JOIN_ROOM_RES]: {
        decode: (buf) => JoinRoomRes.decode(buf),
        encode: (msg) => finish(JoinRoomRes.encode(msg as JoinRoomRes)),
        name: 'JoinRoomRes',
    },
    [MessageType.TONGITS_ROOM_OWNER_START_GAME_REQ]: {
        decode: (buf) => StartGameReq.decode(buf),
        encode: (msg) => finish(StartGameReq.encode(msg as StartGameReq)),
        name: 'StartGameReq',
    },
    [MessageType.TONGITS_ROOM_OWNER_START_GAME_RES]: {
        decode: (buf) => StartGameRes.decode(buf),
        encode: (msg) => finish(StartGameRes.encode(msg as StartGameRes)),
        name: 'StartGameRes',
    },
    [MessageType.TONGITS_START_GAME_BROADCAST]: {
        decode: (buf) => GameStartBroadcast.decode(buf),
        encode: (msg) => finish(GameStartBroadcast.encode(msg as GameStartBroadcast)),
        name: 'GameStartBroadcast',
    },
    [MessageType.TONGITS_WIN_CLICK_REQ]: {
        decode: (buf) => TongitsReq.decode(buf),
        encode: (msg) => finish(TongitsReq.encode(msg as TongitsReq)),
        name: 'TongitsReq',
    },
    [MessageType.TONGITS_WIN_CLICK_RES]: {
        decode: (buf) => TongitsRes.decode(buf),
        encode: (msg) => finish(TongitsRes.encode(msg as TongitsRes)),
        name: 'TongitsRes',
    },
    [MessageType.TONGITS_DRAW_REQ]: {
        decode: (buf) => DrawCardReq.decode(buf),
        encode: (msg) => finish(DrawCardReq.encode(msg as DrawCardReq)),
        name: 'DrawCardReq',
    },
    [MessageType.TONGITS_DRAW_RES]: {
        decode: (buf) => DrawCardRes.decode(buf),
        encode: (msg) => finish(DrawCardRes.encode(msg as DrawCardRes)),
        name: 'DrawCardRes',
    },
    [MessageType.TONGITS_DRAW_BROADCAST]: {
        decode: (buf) => DrawCardBroadcast.decode(buf),
        encode: (msg) => finish(DrawCardBroadcast.encode(msg as DrawCardBroadcast)),
        name: 'DrawCardBroadcast',
    },
    [MessageType.TONGITS_MELD_REQ]: {
        decode: (buf) => MeldCardReq.decode(buf),
        encode: (msg) => finish(MeldCardReq.encode(msg as MeldCardReq)),
        name: 'MeldCardReq',
    },
    [MessageType.TONGITS_MELD_RES]: {
        decode: (buf) => MeldCardRes.decode(buf),
        encode: (msg) => finish(MeldCardRes.encode(msg as MeldCardRes)),
        name: 'MeldCardRes',
    },
    [MessageType.TONGITS_MELD_BROADCAST]: {
        decode: (buf) => MeldCardBroadcast.decode(buf),
        encode: (msg) => finish(MeldCardBroadcast.encode(msg as MeldCardBroadcast)),
        name: 'MeldCardBroadcast',
    },
    [MessageType.TONGITS_LAYOFF_REQ]: {
        decode: (buf) => LayOffCardReq.decode(buf),
        encode: (msg) => finish(LayOffCardReq.encode(msg as LayOffCardReq)),
        name: 'LayOffCardReq',
    },
    [MessageType.TONGITS_LAYOFF_RES]: {
        decode: (buf) => LayOffCardRes.decode(buf),
        encode: (msg) => finish(LayOffCardRes.encode(msg as LayOffCardRes)),
        name: 'LayOffCardRes',
    },
    [MessageType.TONGITS_LAYOFF_BROADCAST]: {
        decode: (buf) => LayOffCardBroadcast.decode(buf),
        encode: (msg) => finish(LayOffCardBroadcast.encode(msg as LayOffCardBroadcast)),
        name: 'LayOffCardBroadcast',
    },
    [MessageType.TONGITS_DISCARD_REQ]: {
        decode: (buf) => DiscardCardReq.decode(buf),
        encode: (msg) => finish(DiscardCardReq.encode(msg as DiscardCardReq)),
        name: 'DiscardCardReq',
    },
    [MessageType.TONGITS_DISCARD_RES]: {
        decode: (buf) => DiscardCardRes.decode(buf),
        encode: (msg) => finish(DiscardCardRes.encode(msg as DiscardCardRes)),
        name: 'DiscardCardRes',
    },
    [MessageType.TONGITS_DISCARD_BROADCAST]: {
        decode: (buf) => DiscardCardBroadcast.decode(buf),
        encode: (msg) => finish(DiscardCardBroadcast.encode(msg as DiscardCardBroadcast)),
        name: 'DiscardCardBroadcast',
    },
    [MessageType.TONGITS_TAKE_REQ]: {
        decode: (buf) => TakeCardReq.decode(buf),
        encode: (msg) => finish(TakeCardReq.encode(msg as TakeCardReq)),
        name: 'TakeCardReq',
    },
    [MessageType.TONGITS_TAKE_RES]: {
        decode: (buf) => TakeCardRes.decode(buf),
        encode: (msg) => finish(TakeCardRes.encode(msg as TakeCardRes)),
        name: 'TakeCardRes',
    },
    [MessageType.TONGITS_TAKE_BROADCAST]: {
        decode: (buf) => TakeCardBroadcast.decode(buf),
        encode: (msg) => finish(TakeCardBroadcast.encode(msg as TakeCardBroadcast)),
        name: 'TakeCardBroadcast',
    },
    [MessageType.TONGITS_CHALLENGE_ACTION_REQ]: {
        decode: (buf) => ChallengeReq.decode(buf),
        encode: (msg) => finish(ChallengeReq.encode(msg as ChallengeReq)),
        name: 'ChallengeReq',
    },
    [MessageType.TONGITS_CHALLENGE_ACTION_RES]: {
        decode: (buf) => ChallengeRes.decode(buf),
        encode: (msg) => finish(ChallengeRes.encode(msg as ChallengeRes)),
        name: 'ChallengeRes',
    },
    [MessageType.TONGITS_CHALLENGE_BROADCAST]: {
        decode: (buf) => ChallengeBroadcast.decode(buf),
        encode: (msg) => finish(ChallengeBroadcast.encode(msg as ChallengeBroadcast)),
        name: 'ChallengeBroadcast',
    },
    [MessageType.TONGITS_PK_BROADCAST]: {
        decode: (buf) => PKBroadcast.decode(buf),
        encode: (msg) => finish(PKBroadcast.encode(msg as PKBroadcast)),
        name: 'PKBroadcast',
    },
    [MessageType.TONGITS_GAME_RESULT_BROADCAST]: {
        decode: (buf) => GameResultBroadcast.decode(buf),
        encode: (msg) => finish(GameResultBroadcast.encode(msg as GameResultBroadcast)),
        name: 'GameResultBroadcast',
    },
    [MessageType.TONGITS_ROOM_RESET_BROADCAST]: {
        decode: (buf) => RoomResetBroadcast.decode(buf),
        encode: (msg) => finish(RoomResetBroadcast.encode(msg as RoomResetBroadcast)),
        name: 'RoomResetBroadcast',
    },
    [MessageType.TONGITS_ACTION_CHANGE_BROADCAST]: {
        decode: (buf) => ActionChangeBroadcast.decode(buf),
        encode: (msg) => finish(ActionChangeBroadcast.encode(msg as ActionChangeBroadcast)),
        name: 'ActionChangeBroadcast',
    },
    [MessageType.TONGITS_GAME_WIN_BROADCAST]: {
        decode: (buf) => BeforeResultBroadcast.decode(buf),
        encode: (msg) => finish(BeforeResultBroadcast.encode(msg as BeforeResultBroadcast)),
        name: 'BeforeResultBroadcast',
    },
    [MessageType.TONGITS_GAME_RESULT_DETAILS_REQ]: {
        decode: (buf) => GameResultDetailsReq.decode(buf),
        encode: (msg) => finish(GameResultDetailsReq.encode(msg as GameResultDetailsReq)),
        name: 'GameResultDetailsReq',
    },
    [MessageType.TONGITS_GAME_RESULT_DETAILS_RES]: {
        decode: (buf) => GameResultDetailsRes.decode(buf),
        encode: (msg) => finish(GameResultDetailsRes.encode(msg as GameResultDetailsRes)),
        name: 'GameResultDetailsRes',
    },
    [MessageType.TONGITS_GET_PLAYER_HISTORY_REQ]: {
        decode: (buf) => GetPlayerHistoryReq.decode(buf),
        encode: (msg) => finish(GetPlayerHistoryReq.encode(msg as GetPlayerHistoryReq)),
        name: 'GetPlayerHistoryReq',
    },
    [MessageType.TONGITS_GET_PLAYER_HISTORY_RES]: {
        decode: (buf) => GetPlayerHistoryRes.decode(buf),
        encode: (msg) => finish(GetPlayerHistoryRes.encode(msg as GetPlayerHistoryRes)),
        name: 'GetPlayerHistoryRes',
    },
};
