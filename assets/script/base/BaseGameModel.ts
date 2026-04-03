import { MvcModel, Nexus } from 'db://nexus-framework/index';
import { MessageType } from 'db://assets/script/proto/message_type';
import type { PlayerInfo } from 'db://assets/script/proto/game_common_room';
import type {
    UserOfflineBroadcast,
    JoinRoomBroadcast,
    LeaveRoomBroadcast,
    PlayerSitDownRes,
    SitDownBroadcast,
    StandUpBroadcast,
    PlayerReadyGameRes,
    ReadyBroadcast,
    UserInfoUpdateBroadcast,
    ServerClosedBroadcast,
} from 'db://assets/script/proto/game_common_player';
import type {
    RoomNewOwnerBroadcast,
    OwnerKickOffSeatBroadcast,
    OwnerKickOffSeatRes,
    OwnerKickOutOfRoomBroadcast,
    OwnerKickOutOfRoomRes,
    OwnerChangeScoreBroadcast,
    OwnerChangeScoreRes,
    SetRoomModeBroadcast,
    SetRoomModeRes,
    SendBarrageBroadcast,
    AllowMicChangedBroadcast,
    ApplyAllowMicRes,
    ApplyAllowMicBroadcast,
    ApproveAllowMicRes,
    ApproveAllowMicBroadcast,
    AllowMicBroadcast,
    AgreeAllowMicBroadcast,
    OpenMicRes,
    OpenMicBroadcast,
    OwnerCloseMicRes,
    OwnerCloseMicBroadcast,
} from 'db://assets/script/proto/game_common_room';

/**
 * JoinRoom 响应通用结构约束。
 */
export interface JoinRoomData<P, G> {
    roomInfo: RoomInfoLike | undefined;
    players: P[];
    self: P | undefined;
    watchers: PlayerInfo[];
    speakers: PlayerInfo[];
    playersCount: number;
    gameInfo: G | undefined;
}

/** 房间信息最小约束 */
export interface RoomInfoLike {
    roomId: number;
    roomName: string;
    roomStatus: number;
}

/** 游戏特化玩家类型约束：必须内嵌 playerInfo */
export interface GamePlayerLike {
    playerInfo: PlayerInfo | undefined;
}

/** BaseGameModel 通用事件名 */
export const BaseGameEvents = {
    ROOM_JOINED: 'base:room:joined',
    PLAYERS_UPDATED: 'base:players:updated',
    GAME_INFO_UPDATED: 'base:gameInfo:updated',
    SELF_UPDATED: 'base:self:updated',
    WATCHERS_UPDATED: 'base:watchers:updated',
    SPEAKERS_UPDATED: 'base:speakers:updated',
} as const;

/** 房间状态枚举 */
export const enum ROOM_STATE { NULL = 0, WAIT = 1, GAME = 2, OVER = 3 }
/** 角色枚举 */
export const enum BASE_ROLE { UNKNOWN = 0, SPECTATOR = 1, PLAYER = 2 }
/** 职位枚举 */
export const enum BASE_POST { PLAYER = 0, HOST = 1, ADMIN = 2 }
/** 玩家状态枚举 */
export const enum PLAYER_STATE { ONLINE = 0, READY = 1, GAME = 2, OFFLINE = 3, LEAVE = 4 }

/**
 * 房间制多人游戏 Model 基类（泛型）。
 *
 * P = 游戏特化的玩家信息类型（需含 playerInfo: PlayerInfo）
 * G = 游戏特化的 GameInfo 类型
 */
export abstract class BaseGameModel<
    P extends GamePlayerLike = GamePlayerLike,
    G = unknown,
> extends MvcModel {

    private _roomInfo: RoomInfoLike | null = null;
    private _players: P[] = [];
    private _self: P | null = null;
    private _watchers: PlayerInfo[] = [];
    private _speakers: PlayerInfo[] = [];
    private _playersCount = 0;
    private _gameInfo: G | null = null;
    private _isMidwayEnter = false;

    // ── Getters ──────────────────────────────────────────

    get roomInfo(): RoomInfoLike | null { return this._roomInfo; }
    get players(): P[] { return this._players; }
    get self(): P | null { return this._self; }
    get watchers(): PlayerInfo[] { return this._watchers; }
    get speakers(): PlayerInfo[] { return this._speakers; }
    get playersCount(): number { return this._playersCount; }
    get gameInfo(): G | null { return this._gameInfo; }
    get myUserId(): number { return this._self?.playerInfo?.userId ?? 0; }
    get mySeat(): number { return this._self?.playerInfo?.seat ?? 0; }
    get isMidwayEnter(): boolean { return this._isMidwayEnter; }
    set isMidwayEnter(v: boolean) { this._isMidwayEnter = v; }

    // ── JoinRoom ─────────────────────────────────────────

    joinRoom(res: JoinRoomData<P, G>): void {
        this._roomInfo = res.roomInfo ?? null;
        this._players = res.players ?? [];
        this._self = res.self ?? null;
        this._watchers = res.watchers ?? [];
        this._speakers = res.speakers ?? [];
        this._playersCount = res.playersCount ?? 0;
        this._gameInfo = res.gameInfo ?? null;
        this.notify(BaseGameEvents.ROOM_JOINED, res);
    }

    // ── 数据更新 ─────────────────────────────────────────

    updatePlayers(players: P[]): void {
        this._players = players;
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players });
    }

    updateSelf(data: P | Partial<P>): void {
        if (this._self) {
            this._mergePlayerData(this._self, data as Partial<P>);
        } else {
            this._self = data as P;
        }
        this.notify(BaseGameEvents.SELF_UPDATED, { self: this._self });
    }

    updateGameInfo(gameInfo: G): void {
        this._gameInfo = gameInfo;
        this.notify(BaseGameEvents.GAME_INFO_UPDATED, { gameInfo });
    }

    updateRoomInfo(partial: Partial<RoomInfoLike>): void {
        if (this._roomInfo) Object.assign(this._roomInfo, partial);
    }

    updatePlayersCount(count: number): void {
        this._playersCount = count;
    }

    // ── 玩家部分更新（合并式） ───────────────────────────

    /** 根据 userId 部分更新玩家数据，如果是自己同步更新 self */
    updatePlayerById(id: number, data: Partial<P>): void {
        if (this.isSelf(id) && this._self) {
            this._mergePlayerData(this._self, data);
        }
        const player = this.getPlayerByUserId(id);
        if (!player) return;
        this._mergePlayerData(player, data);
    }

    /** 深度合并玩家数据：playerInfo 单独 assign，其余字段直接 assign */
    protected _mergePlayerData(player: P, data: Partial<P>): void {
        if ((data as any).playerInfo && player.playerInfo) {
            Object.assign(player.playerInfo, (data as any).playerInfo);
        }
        const { playerInfo: _, ...rest } = data as any;
        Object.assign(player, rest);
    }

    // ── 玩家查找 ─────────────────────────────────────────

    getPlayerByUserId(id: number | unknown): P | undefined {
        const numId = this._normalizeId(id);
        if (!numId) return undefined;
        const found = this._players.find(p => this._normalizeId(p.playerInfo?.userId) === numId);
        if (!found && numId === this._normalizeId(this.myUserId) && this._self) return this._self;
        return found;
    }

    getPlayerBySeat(seat: number): P | undefined {
        if (!seat || seat < 1) return undefined;
        return this._players.find(p => p.playerInfo?.seat === seat);
    }

    getPlayerIndex(userId: number): number {
        return this._players.findIndex(p => p.playerInfo?.userId === userId);
    }

    getPlayerSeatById(userId: number): number {
        return this.getPlayerByUserId(userId)?.playerInfo?.seat ?? 0;
    }

    isSelf(userId: number): boolean {
        return this.myUserId === userId;
    }

    isSpectator(): boolean {
        return this.mySeat <= 0;
    }

    // ── 座位管理 ─────────────────────────────────────────

    addPlayerToSeat(player: P): void {
        const uid = player.playerInfo?.userId;
        if (!uid) return;
        const idx = this.getPlayerIndex(uid);
        if (idx >= 0) this._players[idx] = player;
        else this._players.push(player);
    }

    removePlayerFromSeat(userId: number): P | null {
        const idx = this.getPlayerIndex(userId);
        if (idx < 0) return null;
        return this._players.splice(idx, 1)[0];
    }

    getPlayersAlignedBySeat(seatCount: number, seatBase: 0 | 1 = 1): (P | null)[] {
        const result = new Array<P | null>(seatCount).fill(null);
        for (const player of this._players) {
            const seat = player.playerInfo?.seat;
            if (typeof seat !== 'number' || seat < seatBase || seat >= seatBase + seatCount) continue;
            const idx = seat - seatBase;
            if (result[idx] == null) result[idx] = player;
        }
        return result;
    }

    // ── 旁观者 / 上麦管理 ────────────────────────────────

    addToWatchers(info: PlayerInfo): void {
        const idx = this._watchers.findIndex(w => w.userId === info.userId);
        if (idx < 0) this._watchers.push(info);
        else this._watchers[idx] = info;
    }

    removeFromWatchers(userId: number): void {
        const idx = this._watchers.findIndex(w => w.userId === userId);
        if (idx >= 0) this._watchers.splice(idx, 1);
    }

    addToSpeakers(info: PlayerInfo): void {
        const idx = this._speakers.findIndex(s => s.userId === info.userId);
        if (idx < 0) this._speakers.push(info);
        else this._speakers[idx] = info;
    }

    removeFromSpeakers(userId: number): void {
        const idx = this._speakers.findIndex(s => s.userId === userId);
        if (idx >= 0) this._speakers.splice(idx, 1);
    }

    // ── 自己操作响应（直接接收 proto 类型） ───────────────

    /** 坐下响应 COMMON_PLAYER_SIT_DOWN_RES */
    onPlayerSitDownRes(res: PlayerSitDownRes): void {
        if (!this._self) return;
        // 更新 self 的 playerInfo
        if (this._self.playerInfo) {
            this._self.playerInfo.seat = res.seat;
            this._self.playerInfo.role = BASE_ROLE.PLAYER;
            this._self.playerInfo.state = PLAYER_STATE.ONLINE;
            this._self.playerInfo.waitReadyExpiredTime = res.waitReadyExpiredTime ?? 0;
        }
        // 把 self 同一引用加入 players（保持引用一致）
        this.addPlayerToSeat(this._self);
        this.removeFromWatchers(this.myUserId);
        this.notify(BaseGameEvents.SELF_UPDATED, { self: this._self });
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 站起响应 COMMON_PLAYER_STAND_UP_RES */
    onPlayerStandUpRes(): void {
        this.removePlayerFromSeat(this.myUserId);
        const watcherInfo = {
            ...this._self?.playerInfo,
            seat: 0,
            role: BASE_ROLE.SPECTATOR,
            state: PLAYER_STATE.ONLINE,
        } as PlayerInfo;
        this.updateSelf({ playerInfo: watcherInfo } as Partial<P>);
        this.addToWatchers(watcherInfo);
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 准备响应 COMMON_PLAYER_READY_GAME_RES */
    onPlayerReadyRes(res: PlayerReadyGameRes): void {
        const state = res.ready ? PLAYER_STATE.READY : PLAYER_STATE.ONLINE;
        const updates: Partial<PlayerInfo> = { state, waitReadyExpiredTime: res.waitReadyExpiredTime ?? 0 };
        this.updatePlayerById(this.myUserId, {
            playerInfo: { ...this._self?.playerInfo, ...updates },
        } as Partial<P>);
    }

    // ── 广播处理（直接接收 proto 类型） ──────────────────

    /** 坐下广播 COMMON_SIT_DOWN_BROADCAST */
    onSitDownBroadcast(data: SitDownBroadcast): void {
        if (!data.player) return;
        const info: PlayerInfo = { ...data.player, waitReadyExpiredTime: data.waitReadyExpiredTime ?? 0 };
        // 尝试找到已有玩家数据做合并（保留游戏特有字段），不存在则新建
        const existing = this.getPlayerByUserId(data.userId);
        if (existing) {
            if (existing.playerInfo) Object.assign(existing.playerInfo, info);
            this.addPlayerToSeat(existing);
        } else {
            this.addPlayerToSeat({ playerInfo: info } as unknown as P);
        }
        this.removeFromWatchers(data.userId);
        if (this.isSelf(data.userId)) {
            if (this._self?.playerInfo) Object.assign(this._self.playerInfo, info);
        }
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 站起广播 COMMON_STAND_UP_BROADCAST */
    onStandUpBroadcast(data: StandUpBroadcast): void {
        const removed = this.removePlayerFromSeat(data.userId);
        const watcherInfo: PlayerInfo = data.player ?? {
            ...removed?.playerInfo,
            seat: 0,
            role: BASE_ROLE.SPECTATOR,
            state: PLAYER_STATE.ONLINE,
        } as PlayerInfo;
        watcherInfo.seat = 0;
        watcherInfo.role = BASE_ROLE.SPECTATOR;
        watcherInfo.state = PLAYER_STATE.ONLINE;
        this.addToWatchers(watcherInfo);
        if (this.isSelf(data.userId)) this.updateSelf({ playerInfo: watcherInfo } as Partial<P>);
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 准备广播 COMMON_READY_BROADCAST */
    onReadyBroadcast(data: ReadyBroadcast): void {
        const state = data.isReady ? PLAYER_STATE.READY : PLAYER_STATE.ONLINE;
        const updates: Partial<PlayerInfo> = {
            state,
            waitReadyExpiredTime: data.waitReadyExpiredTime ?? 0,
            ...(data.player ? data.player : {}),
        };
        this.updatePlayerById(data.userId, {
            playerInfo: { ...this.getPlayerByUserId(data.userId)?.playerInfo, ...updates },
        } as Partial<P>);
    }

    /** 玩家进房广播 COMMON_JOIN_ROOM_BROADCAST */
    onJoinRoomBroadcast(data: JoinRoomBroadcast): void {
        if (data.player) {
            if (data.player.role === BASE_ROLE.SPECTATOR || !data.player.seat) {
                this.addToWatchers(data.player);
            } else {
                this.addPlayerToSeat({ playerInfo: data.player } as unknown as P);
            }
        }
        this._playersCount = data.playersCount;
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 玩家离开房间广播 COMMON_LEAVE_ROOM_BROADCAST */
    onLeaveRoomBroadcast(data: LeaveRoomBroadcast): void {
        this.removePlayerFromSeat(data.userId);
        this.removeFromWatchers(data.userId);
        this.removeFromSpeakers(data.userId);
        this._playersCount = data.playersCount;
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 玩家离线广播 COMMON_OFFLINE_BROADCAST */
    onOfflineBroadcast(data: UserOfflineBroadcast): void {
        this.updatePlayerById(data.userId, {
            playerInfo: {
                ...this.getPlayerByUserId(data.userId)?.playerInfo,
                state: PLAYER_STATE.OFFLINE,
                ...(data.player ?? {}),
            },
        } as Partial<P>);
        const watcher = this._watchers.find(w => w.userId === data.userId);
        if (watcher) {
            watcher.state = PLAYER_STATE.OFFLINE;
            if (data.player) Object.assign(watcher, data.player);
        }
    }

    /** 房主变更广播 COMMON_ROOM_NEW_OWNER_BROADCAST */
    onNewOwnerBroadcast(data: RoomNewOwnerBroadcast): void {
        for (const p of this._players) {
            if (p.playerInfo) {
                p.playerInfo.post = p.playerInfo.userId === data.playerId ? BASE_POST.HOST : BASE_POST.PLAYER;
            }
        }
        for (const w of this._watchers) {
            w.post = w.userId === data.playerId ? BASE_POST.HOST : BASE_POST.PLAYER;
        }
        if (this._self?.playerInfo) {
            this._self.playerInfo.post = this.isSelf(data.playerId) ? BASE_POST.HOST : BASE_POST.PLAYER;
        }
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 踢出房间广播 ROOM_OWNER_KICK_OUT_OF_ROOM_BROADCAST */
    onKickOutOfRoomBroadcast(data: OwnerKickOutOfRoomBroadcast): void {
        this.removePlayerFromSeat(data.playerId);
        this.removeFromWatchers(data.playerId);
        this.removeFromSpeakers(data.playerId);
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 踢下座位广播 ROOM_OWNER_KICK_OFF_SEAT_BROADCAST */
    onKickOffSeatBroadcast(data: OwnerKickOffSeatBroadcast): void {
        this._changePlayerToWatcher(data.playerId);
    }

    /** 房间模式变更广播 ROOM_SET_ROOM_MODE_BROADCAST */
    onSetRoomModeBroadcast(data: SetRoomModeBroadcast): void {
        // proto: SetRoomModeBroadcast { bcUid, mode, playersCount }
        // mode 对应 roomInfo.roomMode（0: 游戏模式, 1: 房主模式）
        if (this._roomInfo && 'roomMode' in this._roomInfo) {
            (this._roomInfo as any).roomMode = data.mode;
        }
        this._playersCount = data.playersCount;
    }

    /**
     * 改变底分广播 ROOM_OWNER_CHANGE_SCORE_BROADCAST
     * proto: OwnerChangeScoreBroadcast { bcUid, newScore }
     * 底分字段名因游戏而异，子类可覆写指定正确字段。
     */
    onChangeScoreBroadcast(_data: OwnerChangeScoreBroadcast): void {
        // 默认空实现，子类覆写：如 tongits 中 gameInfo.betAmount = data.newScore
    }

    /** 用户信息更新广播 COMMON_USER_UPDATE_BROADCAST */
    onUserInfoUpdateBroadcast(data: UserInfoUpdateBroadcast): void {
        const updates: Partial<PlayerInfo> = {};
        if (data.coins !== undefined && data.coins !== null) updates.coin = data.coins;

        this.updatePlayerById(data.userId, {
            playerInfo: { ...this.getPlayerByUserId(data.userId)?.playerInfo, ...updates },
        } as Partial<P>);
        const watcher = this._watchers.find(w => w.userId === data.userId);
        if (watcher && updates.coin !== undefined) watcher.coin = updates.coin;
        const speaker = this._speakers.find(s => s.userId === data.userId);
        if (speaker && updates.coin !== undefined) speaker.coin = updates.coin;
    }

    /** 弹幕广播 COMMON_SEND_BARRAGE_BROADCAST */
    onBarrageBroadcast(_data: SendBarrageBroadcast): void {
        // 子类按需覆写处理弹幕 UI
    }

    /** 上下麦变动广播 ROOM_ALLOW_MIC_CHANGED_BROADCAST */
    onAllowMicChangedBroadcast(data: AllowMicChangedBroadcast): void {
        if (!data.player) return;
        if (data.allowed) {
            this.addToSpeakers(data.player);
        } else {
            this.removeFromSpeakers(data.player.userId);
        }
        // 更新玩家的 micAllowStatus
        const status = data.allowed ? 2 : 0; // ALLOW : NOT_ALLOW
        this.updatePlayerById(data.player.userId, {
            playerInfo: { ...this.getPlayerByUserId(data.player.userId)?.playerInfo, micAllowStatus: status },
        } as Partial<P>);
    }

    /** 开麦广播 ROOM_OPEN_MIC_BROADCAST */
    onOpenMicBroadcast(data: OpenMicBroadcast): void {
        this.updatePlayerById(data.playerId, {
            playerInfo: { ...this.getPlayerByUserId(data.playerId)?.playerInfo, micOn: data.open },
        } as Partial<P>);
    }

    /** 申请上麦广播 ROOM_APPLY_ALLOW_MIC_BROADCAST */
    onApplyAllowMicBroadcast(data: ApplyAllowMicBroadcast): void {
        // 更新申请人的 micAllowStatus 为申请中
        this.updatePlayerById(data.playerId, {
            playerInfo: { ...this.getPlayerByUserId(data.playerId)?.playerInfo, micAllowStatus: 1 },
        } as Partial<P>);
        // 更新房间的申请上麦数量
        if (this._roomInfo && 'applyMicCount' in this._roomInfo) {
            (this._roomInfo as any).applyMicCount = data.applyMicCount;
        }
    }

    /** 批准上麦广播 ROOM_APPROVE_ALLOW_MIC_BROADCAST */
    onApproveAllowMicBroadcast(data: ApproveAllowMicBroadcast): void {
        const status = data.allowed ? 2 : 0; // ALLOW : NOT_ALLOW
        this.updatePlayerById(data.playerId, {
            playerInfo: { ...this.getPlayerByUserId(data.playerId)?.playerInfo, micAllowStatus: status },
        } as Partial<P>);
        if (this._roomInfo && 'applyMicCount' in this._roomInfo) {
            (this._roomInfo as any).applyMicCount = data.applyMicCount;
        }
    }

    /** 房主邀请上下麦广播 ROOM_ALLOW_MIC_BROADCAST */
    onAllowMicBroadcast(data: AllowMicBroadcast): void {
        const status = data.allow ? 2 : 0;
        this.updatePlayerById(data.playerId, {
            playerInfo: { ...this.getPlayerByUserId(data.playerId)?.playerInfo, micAllowStatus: status },
        } as Partial<P>);
    }

    /** 同意房主拉上麦广播 ROOM_AGREE_ALLOW_MIC_BROADCAST */
    onAgreeAllowMicBroadcast(data: AgreeAllowMicBroadcast): void {
        if (data.agree) {
            const player = this.getPlayerByUserId(data.playerId);
            if (player?.playerInfo) {
                player.playerInfo.micAllowStatus = 2; // ALLOW
                this.addToSpeakers(player.playerInfo);
            }
        }
    }

    /** 房主闭麦广播 ROOM_OWNER_CLOSE_MIC_BROADCAST */
    onOwnerCloseMicBroadcast(data: OwnerCloseMicBroadcast): void {
        this.updatePlayerById(data.playerId, {
            playerInfo: { ...this.getPlayerByUserId(data.playerId)?.playerInfo, micOn: false, micAllowStatus: 0 },
        } as Partial<P>);
        this.removeFromSpeakers(data.playerId);
    }

    /** 服务器关闭广播 COMMON_SERVER_CLOSED_BROADCAST */
    onServerClosedBroadcast(_data: ServerClosedBroadcast): void {
        // 子类覆写：弹窗提示并退出
    }

    // ── 自己操作的 Res 响应（房主操作） ──────────────────

    /** 踢出房间响应 ROOM_OWNER_KICK_OUT_OF_ROOM_RES — 数据变更同广播 */
    onKickOutOfRoomRes(res: OwnerKickOutOfRoomRes): void {
        this.onKickOutOfRoomBroadcast({ bcUid: 0, playerId: res.playerId });
    }

    /** 踢下座位响应 ROOM_OWNER_KICK_OFF_SEAT_RES — 数据变更同广播 */
    onKickOffSeatRes(res: OwnerKickOffSeatRes): void {
        this.onKickOffSeatBroadcast({ bcUid: 0, playerId: res.playerId });
    }

    /** 设置房间模式响应 ROOM_SET_ROOM_MODE_RES — 数据变更同广播 */
    onSetRoomModeRes(res: SetRoomModeRes): void {
        this.onSetRoomModeBroadcast({ bcUid: 0, mode: res.mode, playersCount: res.playersCount });
    }

    /** 改变底分响应 ROOM_OWNER_CHANGE_SCORE_RES — 数据变更同广播 */
    onChangeScoreRes(res: OwnerChangeScoreRes): void {
        this.onChangeScoreBroadcast({ bcUid: 0, newScore: res.newScore });
    }

    /** 申请上麦响应 ROOM_APPLY_ALLOW_MIC_RES */
    onApplyAllowMicRes(res: ApplyAllowMicRes): void {
        if (res.allowed && this._self?.playerInfo) {
            this._self.playerInfo.micAllowStatus = 2; // 直接上麦
            this.addToSpeakers(this._self.playerInfo);
        }
    }

    /** 批准上麦响应 ROOM_APPROVE_ALLOW_MIC_RES */
    onApproveAllowMicRes(res: ApproveAllowMicRes): void {
        const status = res.allowed ? 2 : 0;
        this.updatePlayerById(res.playerId, {
            playerInfo: { ...this.getPlayerByUserId(res.playerId)?.playerInfo, micAllowStatus: status },
        } as Partial<P>);
        if (this._roomInfo && 'applyMicCount' in this._roomInfo) {
            (this._roomInfo as any).applyMicCount = res.applyMicCount;
        }
    }

    /** 开麦响应 ROOM_OPEN_MIC_RES */
    onOpenMicRes(res: OpenMicRes): void {
        if (this._self?.playerInfo) {
            this._self.playerInfo.micOn = res.open;
        }
    }

    /** 房主闭麦响应 ROOM_OWNER_CLOSE_MIC_RES */
    onOwnerCloseMicRes(res: OwnerCloseMicRes): void {
        this.onOwnerCloseMicBroadcast({ bcUid: 0, playerId: res.playerId });
    }

    // ── 内部工具 ─────────────────────────────────────────

    private _changePlayerToWatcher(userId: number): void {
        const removed = this.removePlayerFromSeat(userId);
        if (removed?.playerInfo) {
            const watcherInfo: PlayerInfo = {
                ...removed.playerInfo,
                seat: 0,
                role: BASE_ROLE.SPECTATOR,
                state: PLAYER_STATE.ONLINE,
            };
            this.addToWatchers(watcherInfo);
        }
        if (this.isSelf(userId) && this._self?.playerInfo) {
            this._self.playerInfo.seat = 0;
            this._self.playerInfo.role = BASE_ROLE.SPECTATOR;
            this._self.playerInfo.state = PLAYER_STATE.ONLINE;
        }
        this.notify(BaseGameEvents.PLAYERS_UPDATED, { players: this._players });
    }

    /** 规范化 id（处理 protobuf Long、string、number） */
    protected _normalizeId(id: unknown): number {
        if (id == null) return 0;
        if (typeof id === 'number') return id;
        if (typeof id === 'string') return parseInt(id, 10) || 0;
        if (typeof id === 'object' && typeof (id as any).toNumber === 'function') return (id as any).toNumber();
        return Number(id) || 0;
    }

    // ── WS 快捷方法 ──────────────────────────────────────

    sendWs(cmd: string | number, data: unknown): void {
        Nexus.net.sendWs(cmd, data);
    }

    wsRequest<T = unknown>(msgType: number, body: unknown, timeoutMs?: number): Promise<T> {
        return Nexus.net.wsRequest<T>(msgType, body, timeoutMs);
    }

    // ── WS 监听模板 ──────────────────────────────────────

    /**
     * 注册公共广播监听。由 registerHandlers() 自动调用，子类无需手动调用。
     */
    protected registerCommonHandlers(): void {
        const net = Nexus.net;
        net.onWsMsg(MessageType.COMMON_OFFLINE_BROADCAST,              this.onOfflineBroadcast.bind(this),          this);
        net.onWsMsg(MessageType.COMMON_JOIN_ROOM_BROADCAST,            this.onJoinRoomBroadcast.bind(this),         this);
        net.onWsMsg(MessageType.COMMON_LEAVE_ROOM_BROADCAST,           this.onLeaveRoomBroadcast.bind(this),        this);
        net.onWsMsg(MessageType.COMMON_SIT_DOWN_BROADCAST,             this.onSitDownBroadcast.bind(this),          this);
        net.onWsMsg(MessageType.COMMON_STAND_UP_BROADCAST,             this.onStandUpBroadcast.bind(this),          this);
        net.onWsMsg(MessageType.COMMON_READY_BROADCAST,                this.onReadyBroadcast.bind(this),            this);
        net.onWsMsg(MessageType.COMMON_SEND_BARRAGE_BROADCAST,         this.onBarrageBroadcast.bind(this),          this);
        net.onWsMsg(MessageType.COMMON_USER_UPDATE_BROADCAST,          this.onUserInfoUpdateBroadcast.bind(this),   this);
        net.onWsMsg(MessageType.COMMON_SERVER_CLOSED_BROADCAST,        this.onServerClosedBroadcast.bind(this),     this);
        net.onWsMsg(MessageType.COMMON_ROOM_NEW_OWNER_BROADCAST,       this.onNewOwnerBroadcast.bind(this),         this);
        net.onWsMsg(MessageType.ROOM_SET_ROOM_MODE_BROADCAST,          this.onSetRoomModeBroadcast.bind(this),      this);
        net.onWsMsg(MessageType.ROOM_OWNER_KICK_OUT_OF_ROOM_BROADCAST, this.onKickOutOfRoomBroadcast.bind(this),   this);
        net.onWsMsg(MessageType.ROOM_OWNER_KICK_OFF_SEAT_BROADCAST,    this.onKickOffSeatBroadcast.bind(this),      this);
        net.onWsMsg(MessageType.ROOM_OWNER_CHANGE_SCORE_BROADCAST,     this.onChangeScoreBroadcast.bind(this),      this);
        net.onWsMsg(MessageType.ROOM_APPLY_ALLOW_MIC_BROADCAST,        this.onApplyAllowMicBroadcast.bind(this),    this);
        net.onWsMsg(MessageType.ROOM_APPROVE_ALLOW_MIC_BROADCAST,      this.onApproveAllowMicBroadcast.bind(this),  this);
        net.onWsMsg(MessageType.ROOM_OPEN_MIC_BROADCAST,               this.onOpenMicBroadcast.bind(this),          this);
        net.onWsMsg(MessageType.ROOM_ALLOW_MIC_BROADCAST,              this.onAllowMicBroadcast.bind(this),         this);
        net.onWsMsg(MessageType.ROOM_OWNER_CLOSE_MIC_BROADCAST,        this.onOwnerCloseMicBroadcast.bind(this),    this);
        net.onWsMsg(MessageType.ROOM_ALLOW_MIC_CHANGED_BROADCAST,      this.onAllowMicChangedBroadcast.bind(this),  this);
        net.onWsMsg(MessageType.ROOM_AGREE_ALLOW_MIC_BROADCAST,        this.onAgreeAllowMicBroadcast.bind(this),    this);
    }

    /** 子类在此注册游戏特有消息监听。 */
    protected abstract registerGameHandlers(): void;

    /** 对外入口，Entry 调用此方法启动所有监听。 */
    registerHandlers(): void {
        this.registerCommonHandlers();
        this.registerGameHandlers();
    }

    // ── 生命周期 ─────────────────────────────────────────

    override destroy(): void {
        Nexus.net.offWsMsgByTarget(this);
        this._roomInfo = null;
        this._players = [];
        this._self = null;
        this._watchers = [];
        this._speakers = [];
        this._playersCount = 0;
        this._gameInfo = null;
        this._isMidwayEnter = false;
        super.destroy();
    }
}
