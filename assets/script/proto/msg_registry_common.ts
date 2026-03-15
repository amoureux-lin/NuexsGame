/**
 * 由构建脚本根据 proto 生成，请勿手改。
 */
import type { MessageMapping } from 'db://nexus-framework/index';
import { ServerClosedBroadcast, UserOfflineBroadcast, JoinRoomBroadcast, PlayerExitRoomReq, PlayerExitRoomRes, LeaveRoomBroadcast, PlayerSitDownReq, PlayerSitDownRes, SitDownBroadcast, PlayerStandUpReq, PlayerStandUpRes, StandUpBroadcast, PlayerReadyGameReq, PlayerReadyGameRes, ReadyBroadcast, UserInfoUpdateBroadcast, GetHistorySummaryReq, GetHistorySummaryRes } from './game_common_player';
import { SendBarrageReq, SendBarrageRes, SendBarrageBroadcast, ApplyAllowMicReq, ApplyAllowMicRes, ApplyAllowMicBroadcast, ApproveAllowMicReq, ApproveAllowMicRes, ApproveAllowMicBroadcast, AllowMicChangedBroadcast, OpenMicReq, OpenMicRes, OpenMicBroadcast, AllowMicReq, AllowMicRes, AllowMicBroadcast, AgreeAllowMicReq, AgreeAllowMicRes, AgreeAllowMicBroadcast, ApplyAllowMicListReq, ApplyAllowMicListRes, OwnerCloseMicReq, OwnerCloseMicRes, OwnerCloseMicBroadcast, RoomNewOwnerBroadcast, PlayerListReq, PlayerListRes, SetRoomModeReq, SetRoomModeRes, SetRoomModeBroadcast, OwnerKickOutOfRoomReq, OwnerKickOutOfRoomRes, OwnerKickOutOfRoomBroadcast, OwnerKickOffSeatReq, OwnerKickOffSeatRes, OwnerKickOffSeatBroadcast, OwnerChangeScoreReq, OwnerChangeScoreRes, OwnerChangeScoreBroadcast } from './game_common_room';
import { ConnectedMessage, PingMessage, PongMessage, TestMessage } from './gateway';
import { MessageType } from './message_type';

/** 从 Writer 得到 Uint8Array（ts_proto 的 encode 返回 Writer） */
function finish(w: { finish(): Uint8Array }): Uint8Array {
    return w.finish();
}

export const COMMON_MSG_REGISTRY: Record<number, MessageMapping> = {
    [MessageType.COMMON_SERVER_CLOSED_BROADCAST]: {
        decode: (buf) => ServerClosedBroadcast.decode(buf),
        encode: (msg) => finish(ServerClosedBroadcast.encode(msg as ServerClosedBroadcast)),
        name: 'ServerClosedBroadcast',
    },
    [MessageType.COMMON_OFFLINE_BROADCAST]: {
        decode: (buf) => UserOfflineBroadcast.decode(buf),
        encode: (msg) => finish(UserOfflineBroadcast.encode(msg as UserOfflineBroadcast)),
        name: 'UserOfflineBroadcast',
    },
    [MessageType.COMMON_JOIN_ROOM_BROADCAST]: {
        decode: (buf) => JoinRoomBroadcast.decode(buf),
        encode: (msg) => finish(JoinRoomBroadcast.encode(msg as JoinRoomBroadcast)),
        name: 'JoinRoomBroadcast',
    },
    [MessageType.COMMON_PLAYER_EXIT_ROOM_REQ]: {
        decode: (buf) => PlayerExitRoomReq.decode(buf),
        encode: (msg) => finish(PlayerExitRoomReq.encode(msg as PlayerExitRoomReq)),
        name: 'PlayerExitRoomReq',
    },
    [MessageType.COMMON_PLAYER_EXIT_ROOM_RES]: {
        decode: (buf) => PlayerExitRoomRes.decode(buf),
        encode: (msg) => finish(PlayerExitRoomRes.encode(msg as PlayerExitRoomRes)),
        name: 'PlayerExitRoomRes',
    },
    [MessageType.COMMON_LEAVE_ROOM_BROADCAST]: {
        decode: (buf) => LeaveRoomBroadcast.decode(buf),
        encode: (msg) => finish(LeaveRoomBroadcast.encode(msg as LeaveRoomBroadcast)),
        name: 'LeaveRoomBroadcast',
    },
    [MessageType.COMMON_PLAYER_SIT_DOWN_REQ]: {
        decode: (buf) => PlayerSitDownReq.decode(buf),
        encode: (msg) => finish(PlayerSitDownReq.encode(msg as PlayerSitDownReq)),
        name: 'PlayerSitDownReq',
    },
    [MessageType.COMMON_PLAYER_SIT_DOWN_RES]: {
        decode: (buf) => PlayerSitDownRes.decode(buf),
        encode: (msg) => finish(PlayerSitDownRes.encode(msg as PlayerSitDownRes)),
        name: 'PlayerSitDownRes',
    },
    [MessageType.COMMON_SIT_DOWN_BROADCAST]: {
        decode: (buf) => SitDownBroadcast.decode(buf),
        encode: (msg) => finish(SitDownBroadcast.encode(msg as SitDownBroadcast)),
        name: 'SitDownBroadcast',
    },
    [MessageType.COMMON_PLAYER_STAND_UP_REQ]: {
        decode: (buf) => PlayerStandUpReq.decode(buf),
        encode: (msg) => finish(PlayerStandUpReq.encode(msg as PlayerStandUpReq)),
        name: 'PlayerStandUpReq',
    },
    [MessageType.COMMON_PLAYER_STAND_UP_RES]: {
        decode: (buf) => PlayerStandUpRes.decode(buf),
        encode: (msg) => finish(PlayerStandUpRes.encode(msg as PlayerStandUpRes)),
        name: 'PlayerStandUpRes',
    },
    [MessageType.COMMON_STAND_UP_BROADCAST]: {
        decode: (buf) => StandUpBroadcast.decode(buf),
        encode: (msg) => finish(StandUpBroadcast.encode(msg as StandUpBroadcast)),
        name: 'StandUpBroadcast',
    },
    [MessageType.COMMON_PLAYER_READY_GAME_REQ]: {
        decode: (buf) => PlayerReadyGameReq.decode(buf),
        encode: (msg) => finish(PlayerReadyGameReq.encode(msg as PlayerReadyGameReq)),
        name: 'PlayerReadyGameReq',
    },
    [MessageType.COMMON_PLAYER_READY_GAME_RES]: {
        decode: (buf) => PlayerReadyGameRes.decode(buf),
        encode: (msg) => finish(PlayerReadyGameRes.encode(msg as PlayerReadyGameRes)),
        name: 'PlayerReadyGameRes',
    },
    [MessageType.COMMON_READY_BROADCAST]: {
        decode: (buf) => ReadyBroadcast.decode(buf),
        encode: (msg) => finish(ReadyBroadcast.encode(msg as ReadyBroadcast)),
        name: 'ReadyBroadcast',
    },
    [MessageType.COMMON_USER_UPDATE_BROADCAST]: {
        decode: (buf) => UserInfoUpdateBroadcast.decode(buf),
        encode: (msg) => finish(UserInfoUpdateBroadcast.encode(msg as UserInfoUpdateBroadcast)),
        name: 'UserInfoUpdateBroadcast',
    },
    [MessageType.COMMON_GET_HISTORY_SUMMARY_REQ]: {
        decode: (buf) => GetHistorySummaryReq.decode(buf),
        encode: (msg) => finish(GetHistorySummaryReq.encode(msg as GetHistorySummaryReq)),
        name: 'GetHistorySummaryReq',
    },
    [MessageType.COMMON_GET_HISTORY_SUMMARY_RES]: {
        decode: (buf) => GetHistorySummaryRes.decode(buf),
        encode: (msg) => finish(GetHistorySummaryRes.encode(msg as GetHistorySummaryRes)),
        name: 'GetHistorySummaryRes',
    },
    [MessageType.COMMON_SEND_BARRAGE_REQ]: {
        decode: (buf) => SendBarrageReq.decode(buf),
        encode: (msg) => finish(SendBarrageReq.encode(msg as SendBarrageReq)),
        name: 'SendBarrageReq',
    },
    [MessageType.COMMON_SEND_BARRAGE_RES]: {
        decode: (buf) => SendBarrageRes.decode(buf),
        encode: (msg) => finish(SendBarrageRes.encode(msg as SendBarrageRes)),
        name: 'SendBarrageRes',
    },
    [MessageType.COMMON_SEND_BARRAGE_BROADCAST]: {
        decode: (buf) => SendBarrageBroadcast.decode(buf),
        encode: (msg) => finish(SendBarrageBroadcast.encode(msg as SendBarrageBroadcast)),
        name: 'SendBarrageBroadcast',
    },
    [MessageType.ROOM_APPLY_ALLOW_MIC_REQ]: {
        decode: (buf) => ApplyAllowMicReq.decode(buf),
        encode: (msg) => finish(ApplyAllowMicReq.encode(msg as ApplyAllowMicReq)),
        name: 'ApplyAllowMicReq',
    },
    [MessageType.ROOM_APPLY_ALLOW_MIC_RES]: {
        decode: (buf) => ApplyAllowMicRes.decode(buf),
        encode: (msg) => finish(ApplyAllowMicRes.encode(msg as ApplyAllowMicRes)),
        name: 'ApplyAllowMicRes',
    },
    [MessageType.ROOM_APPLY_ALLOW_MIC_BROADCAST]: {
        decode: (buf) => ApplyAllowMicBroadcast.decode(buf),
        encode: (msg) => finish(ApplyAllowMicBroadcast.encode(msg as ApplyAllowMicBroadcast)),
        name: 'ApplyAllowMicBroadcast',
    },
    [MessageType.ROOM_APPROVE_ALLOW_MIC_REQ]: {
        decode: (buf) => ApproveAllowMicReq.decode(buf),
        encode: (msg) => finish(ApproveAllowMicReq.encode(msg as ApproveAllowMicReq)),
        name: 'ApproveAllowMicReq',
    },
    [MessageType.ROOM_APPROVE_ALLOW_MIC_RES]: {
        decode: (buf) => ApproveAllowMicRes.decode(buf),
        encode: (msg) => finish(ApproveAllowMicRes.encode(msg as ApproveAllowMicRes)),
        name: 'ApproveAllowMicRes',
    },
    [MessageType.ROOM_APPROVE_ALLOW_MIC_BROADCAST]: {
        decode: (buf) => ApproveAllowMicBroadcast.decode(buf),
        encode: (msg) => finish(ApproveAllowMicBroadcast.encode(msg as ApproveAllowMicBroadcast)),
        name: 'ApproveAllowMicBroadcast',
    },
    [MessageType.ROOM_ALLOW_MIC_CHANGED_BROADCAST]: {
        decode: (buf) => AllowMicChangedBroadcast.decode(buf),
        encode: (msg) => finish(AllowMicChangedBroadcast.encode(msg as AllowMicChangedBroadcast)),
        name: 'AllowMicChangedBroadcast',
    },
    [MessageType.ROOM_OPEN_MIC_REQ]: {
        decode: (buf) => OpenMicReq.decode(buf),
        encode: (msg) => finish(OpenMicReq.encode(msg as OpenMicReq)),
        name: 'OpenMicReq',
    },
    [MessageType.ROOM_OPEN_MIC_RES]: {
        decode: (buf) => OpenMicRes.decode(buf),
        encode: (msg) => finish(OpenMicRes.encode(msg as OpenMicRes)),
        name: 'OpenMicRes',
    },
    [MessageType.ROOM_OPEN_MIC_BROADCAST]: {
        decode: (buf) => OpenMicBroadcast.decode(buf),
        encode: (msg) => finish(OpenMicBroadcast.encode(msg as OpenMicBroadcast)),
        name: 'OpenMicBroadcast',
    },
    [MessageType.ROOM_ALLOW_MIC_REQ]: {
        decode: (buf) => AllowMicReq.decode(buf),
        encode: (msg) => finish(AllowMicReq.encode(msg as AllowMicReq)),
        name: 'AllowMicReq',
    },
    [MessageType.ROOM_ALLOW_MIC_RES]: {
        decode: (buf) => AllowMicRes.decode(buf),
        encode: (msg) => finish(AllowMicRes.encode(msg as AllowMicRes)),
        name: 'AllowMicRes',
    },
    [MessageType.ROOM_ALLOW_MIC_BROADCAST]: {
        decode: (buf) => AllowMicBroadcast.decode(buf),
        encode: (msg) => finish(AllowMicBroadcast.encode(msg as AllowMicBroadcast)),
        name: 'AllowMicBroadcast',
    },
    [MessageType.ROOM_AGREE_ALLOW_MIC_REQ]: {
        decode: (buf) => AgreeAllowMicReq.decode(buf),
        encode: (msg) => finish(AgreeAllowMicReq.encode(msg as AgreeAllowMicReq)),
        name: 'AgreeAllowMicReq',
    },
    [MessageType.ROOM_AGREE_ALLOW_MIC_RES]: {
        decode: (buf) => AgreeAllowMicRes.decode(buf),
        encode: (msg) => finish(AgreeAllowMicRes.encode(msg as AgreeAllowMicRes)),
        name: 'AgreeAllowMicRes',
    },
    [MessageType.ROOM_AGREE_ALLOW_MIC_BROADCAST]: {
        decode: (buf) => AgreeAllowMicBroadcast.decode(buf),
        encode: (msg) => finish(AgreeAllowMicBroadcast.encode(msg as AgreeAllowMicBroadcast)),
        name: 'AgreeAllowMicBroadcast',
    },
    [MessageType.ROOM_APPLY_ALLOW_MIC_LIST_REQ]: {
        decode: (buf) => ApplyAllowMicListReq.decode(buf),
        encode: (msg) => finish(ApplyAllowMicListReq.encode(msg as ApplyAllowMicListReq)),
        name: 'ApplyAllowMicListReq',
    },
    [MessageType.ROOM_APPLY_ALLOW_MIC_LIST_RES]: {
        decode: (buf) => ApplyAllowMicListRes.decode(buf),
        encode: (msg) => finish(ApplyAllowMicListRes.encode(msg as ApplyAllowMicListRes)),
        name: 'ApplyAllowMicListRes',
    },
    [MessageType.ROOM_OWNER_CLOSE_MIC_REQ]: {
        decode: (buf) => OwnerCloseMicReq.decode(buf),
        encode: (msg) => finish(OwnerCloseMicReq.encode(msg as OwnerCloseMicReq)),
        name: 'OwnerCloseMicReq',
    },
    [MessageType.ROOM_OWNER_CLOSE_MIC_RES]: {
        decode: (buf) => OwnerCloseMicRes.decode(buf),
        encode: (msg) => finish(OwnerCloseMicRes.encode(msg as OwnerCloseMicRes)),
        name: 'OwnerCloseMicRes',
    },
    [MessageType.ROOM_OWNER_CLOSE_MIC_BROADCAST]: {
        decode: (buf) => OwnerCloseMicBroadcast.decode(buf),
        encode: (msg) => finish(OwnerCloseMicBroadcast.encode(msg as OwnerCloseMicBroadcast)),
        name: 'OwnerCloseMicBroadcast',
    },
    [MessageType.COMMON_ROOM_NEW_OWNER_BROADCAST]: {
        decode: (buf) => RoomNewOwnerBroadcast.decode(buf),
        encode: (msg) => finish(RoomNewOwnerBroadcast.encode(msg as RoomNewOwnerBroadcast)),
        name: 'RoomNewOwnerBroadcast',
    },
    [MessageType.ROOM_PLAYER_LIST_REQ]: {
        decode: (buf) => PlayerListReq.decode(buf),
        encode: (msg) => finish(PlayerListReq.encode(msg as PlayerListReq)),
        name: 'PlayerListReq',
    },
    [MessageType.ROOM_PLAYER_LIST_RES]: {
        decode: (buf) => PlayerListRes.decode(buf),
        encode: (msg) => finish(PlayerListRes.encode(msg as PlayerListRes)),
        name: 'PlayerListRes',
    },
    [MessageType.ROOM_SET_ROOM_MODE_REQ]: {
        decode: (buf) => SetRoomModeReq.decode(buf),
        encode: (msg) => finish(SetRoomModeReq.encode(msg as SetRoomModeReq)),
        name: 'SetRoomModeReq',
    },
    [MessageType.ROOM_SET_ROOM_MODE_RES]: {
        decode: (buf) => SetRoomModeRes.decode(buf),
        encode: (msg) => finish(SetRoomModeRes.encode(msg as SetRoomModeRes)),
        name: 'SetRoomModeRes',
    },
    [MessageType.ROOM_SET_ROOM_MODE_BROADCAST]: {
        decode: (buf) => SetRoomModeBroadcast.decode(buf),
        encode: (msg) => finish(SetRoomModeBroadcast.encode(msg as SetRoomModeBroadcast)),
        name: 'SetRoomModeBroadcast',
    },
    [MessageType.ROOM_OWNER_KICK_OUT_OF_ROOM_REQ]: {
        decode: (buf) => OwnerKickOutOfRoomReq.decode(buf),
        encode: (msg) => finish(OwnerKickOutOfRoomReq.encode(msg as OwnerKickOutOfRoomReq)),
        name: 'OwnerKickOutOfRoomReq',
    },
    [MessageType.ROOM_OWNER_KICK_OUT_OF_ROOM_RES]: {
        decode: (buf) => OwnerKickOutOfRoomRes.decode(buf),
        encode: (msg) => finish(OwnerKickOutOfRoomRes.encode(msg as OwnerKickOutOfRoomRes)),
        name: 'OwnerKickOutOfRoomRes',
    },
    [MessageType.ROOM_OWNER_KICK_OUT_OF_ROOM_BROADCAST]: {
        decode: (buf) => OwnerKickOutOfRoomBroadcast.decode(buf),
        encode: (msg) => finish(OwnerKickOutOfRoomBroadcast.encode(msg as OwnerKickOutOfRoomBroadcast)),
        name: 'OwnerKickOutOfRoomBroadcast',
    },
    [MessageType.ROOM_OWNER_KICK_OFF_SEAT_REQ]: {
        decode: (buf) => OwnerKickOffSeatReq.decode(buf),
        encode: (msg) => finish(OwnerKickOffSeatReq.encode(msg as OwnerKickOffSeatReq)),
        name: 'OwnerKickOffSeatReq',
    },
    [MessageType.ROOM_OWNER_KICK_OFF_SEAT_RES]: {
        decode: (buf) => OwnerKickOffSeatRes.decode(buf),
        encode: (msg) => finish(OwnerKickOffSeatRes.encode(msg as OwnerKickOffSeatRes)),
        name: 'OwnerKickOffSeatRes',
    },
    [MessageType.ROOM_OWNER_KICK_OFF_SEAT_BROADCAST]: {
        decode: (buf) => OwnerKickOffSeatBroadcast.decode(buf),
        encode: (msg) => finish(OwnerKickOffSeatBroadcast.encode(msg as OwnerKickOffSeatBroadcast)),
        name: 'OwnerKickOffSeatBroadcast',
    },
    [MessageType.ROOM_OWNER_CHANGE_SCORE_REQ]: {
        decode: (buf) => OwnerChangeScoreReq.decode(buf),
        encode: (msg) => finish(OwnerChangeScoreReq.encode(msg as OwnerChangeScoreReq)),
        name: 'OwnerChangeScoreReq',
    },
    [MessageType.ROOM_OWNER_CHANGE_SCORE_RES]: {
        decode: (buf) => OwnerChangeScoreRes.decode(buf),
        encode: (msg) => finish(OwnerChangeScoreRes.encode(msg as OwnerChangeScoreRes)),
        name: 'OwnerChangeScoreRes',
    },
    [MessageType.ROOM_OWNER_CHANGE_SCORE_BROADCAST]: {
        decode: (buf) => OwnerChangeScoreBroadcast.decode(buf),
        encode: (msg) => finish(OwnerChangeScoreBroadcast.encode(msg as OwnerChangeScoreBroadcast)),
        name: 'OwnerChangeScoreBroadcast',
    },
    [MessageType.GATEWAY_CONNECTED]: {
        decode: (buf) => ConnectedMessage.decode(buf),
        encode: (msg) => finish(ConnectedMessage.encode(msg as ConnectedMessage)),
        name: 'ConnectedMessage',
    },
    [MessageType.GATEWAY_PING_REQ]: {
        decode: (buf) => PingMessage.decode(buf),
        encode: (msg) => finish(PingMessage.encode(msg as PingMessage)),
        name: 'PingMessage',
    },
    [MessageType.GATEWAY_PONG_RES]: {
        decode: (buf) => PongMessage.decode(buf),
        encode: (msg) => finish(PongMessage.encode(msg as PongMessage)),
        name: 'PongMessage',
    },
    [MessageType.GATEWAY_TEST]: {
        decode: (buf) => TestMessage.decode(buf),
        encode: (msg) => finish(TestMessage.encode(msg as TestMessage)),
        name: 'TestMessage',
    },
};
