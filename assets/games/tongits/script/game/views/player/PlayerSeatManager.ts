import { _decorator, Component ,Vec3} from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { PlayerSeat } from './PlayerSeat';
import { FightZone } from '../panel/FightZone';
import {TongitsPlayerInfo} from "db://assets/games/tongits/script/proto/tongits";

/** 结算面板所需的单个座位快照 */
export interface SeatSnapshot {
    /** 玩家 userId */
    userId: number;
    /** 头像节点的世界坐标（结算面板用于定位浮层） */
    avatarWorldPos: Vec3;
    /** 完整玩家数据（头像 URL、昵称、金币等） */
    playerInfo: TongitsPlayerInfo;
    /** 是否为视角玩家（自己） */
    isSelf: boolean;
}

const { ccclass, property } = _decorator;

/**
 * PlayerSeatManager — 三个座位的布局与数据管理
 *
 * 屏幕布局（Tongits 3人）：
 *
 *   [seatLeft]          [seatRight]
 *         [seatBottom（自己）]
 *
 * 屏幕位置索引约定（逆时针方向：bottom → right → left → bottom）：
 *   index 0 → 自己（或视角玩家）→ seatBottom
 *   index 1 → 逆时针第一个对手  → seatRight（屏幕右侧）
 *   index 2 → 逆时针第二个对手  → seatLeft （屏幕左侧）
 *
 * 服务端 seat 编号与屏幕位置的映射（以自己 seat=n 为基准）：
 *   seat n   → index 0（bottom）
 *   seat n+1 → index 1（right）
 *   seat n+2 → index 2（left）
 *
 * 职责：
 *   - 接收 players 列表 + selfUserId，计算视角排列后分发给3个 PlayerSeat
 *   - 提供通过 userId 或屏幕索引查找 PlayerSeat 的接口
 *   - 统一管理操作高亮、倒计时更新
 */
@ccclass('PlayerSeatManager')
export class PlayerSeatManager extends Component {

    // ── 三个座位引用（在 Prefab/Scene 中拖入） ────────────

    /** 下方座位（本地玩家 / 视角玩家） */
    @property(PlayerSeat)
    seatBottom: PlayerSeat = null!;

    /** 左侧座位（逆时针第一个对手） */
    @property(PlayerSeat)
    seatLeft: PlayerSeat = null!;

    /** 右侧座位（逆时针第二个对手） */
    @property(PlayerSeat)
    seatRight: PlayerSeat = null!;

    /** 下方挑战区域（与 seatBottom 位置对应） */
    @property(FightZone)
    fightZoneBottom: FightZone | null = null;

    /** 左侧挑战区域（与 seatLeft 位置对应） */
    @property(FightZone)
    fightZoneLeft: FightZone | null = null;

    /** 右侧挑战区域（与 seatRight 位置对应） */
    @property(FightZone)
    fightZoneRight: FightZone | null = null;

    // ── 私有上下文 ────────────────────────────────────────
    private _isLocalOwner: boolean = false;
    private _isGameStarted: boolean = false;
    /** 缓存上一次成功确定的自己座位号，用于 data.players 不含自己时保持相对布局 */
    private _selfSeat: number = 0;
    /** userId → FightZone 直接映射，refreshFromPlayers 时写入，不依赖运行时 getUserId() */
    private _userZoneMap: Map<number, FightZone> = new Map();

    // ── 公开方法 ─────────────────────────────────────────

    /**
     * 更新踢人按钮的显示上下文，并立即同步到所有座位。
     * 在 onGameStart / onRoomReset / onRoomJoined 中调用。
     */
    setContext(isLocalOwner: boolean, isGameStarted: boolean): void {
        this._isLocalOwner = isLocalOwner;
        this._isGameStarted = isGameStarted;
        for (const seat of this._allSeats()) {
            seat?.setContext(isLocalOwner, isGameStarted);
        }
    }

    /**
     * 根据玩家列表和自身 userId 刷新所有座位。
     * 内部自行计算视角排列（逆时针，自己始终在下方）。
     *
     * @param players    当前房间所有在座玩家列表
     * @param selfUserId 本地玩家 userId（旁观者传 perspectiveId 或首个玩家 id）
     */
    refreshFromPlayers(players: TongitsPlayerInfo[], selfUserId: number): void {
        const positions = this._buildPositions(players, selfUserId);
        const seats = [this.seatBottom, this.seatRight, this.seatLeft];
        const zones = [this.fightZoneBottom, this.fightZoneRight, this.fightZoneLeft];
        for (let i = 0; i < seats.length; i++) {
            if (!seats[i]) continue;
            seats[i].setSeatIndex(i);
            seats[i].setContext(this._isLocalOwner, this._isGameStarted);
            const pos = positions[i];
            seats[i].setData(pos?.player ?? null, pos?.isSelf ?? false, pos?.seat ?? 0);
            this._bindSeatCallbacks(seats[i]);

            // 绑定 userId → FightZone（只写入有玩家数据的槽位，保留其余已有绑定）
            const uid = pos?.player?.playerInfo?.userId;
            if (uid && zones[i]) {
                this._userZoneMap.set(uid, zones[i]);
            }
        }
    }

    /** 重置 userId→FightZone 映射（换局/重置房间时调用） */
    resetZoneMap(): void {
        this._userZoneMap.clear();
        this._selfSeat = 0;
    }

    /**
     * 更新当前操作玩家的高亮状态。
     * 先清除所有高亮，再点亮对应座位。
     *
     * @param actionPlayerId 当前操作玩家 userId（0 表示清除所有高亮）
     */
    updateActionPlayer(actionPlayerId: number): void {
        for (const seat of this._allSeats()) {
            if (!seat) continue;
            seat.setActionActive(actionPlayerId !== 0 && seat.getUserId() === actionPlayerId);
        }
    }

    /**
     * 更新某玩家的倒计时显示。
     *
     * @param playerId 玩家 userId
     * @param countdown 倒计时结束的 Unix 时间戳（ms）
     */
    updateCountdown(playerId: number, countdown: number): void {
        this._findSeatByUserId(playerId)?.setCountdown(countdown);
    }

    /**
     * 通过 userId 获取对应的 PlayerSeat 组件。
     * 找不到时返回 null。
     */
    getSeatByUserId(userId: number): PlayerSeat | null {
        return this._findSeatByUserId(userId);
    }

    /**
     * 通过屏幕位置索引获取 PlayerSeat。
     * 索引约定：0=bottom（自己）/ 1=right（逆时针第一）/ 2=left（逆时针第二）
     */
    getSeatByIndex(index: number): PlayerSeat | null {
        return [this.seatBottom, this.seatRight, this.seatLeft][index] ?? null;
    }

    /**
     * 通过 userId 获取对应的 FightZone。
     * 位置与 seat 一一对应：bottom / left / right。
     * 找不到时返回 null。
     */
    getFightZoneByUserId(userId: number): FightZone | null {
        return this._userZoneMap.get(userId) ?? null;
    }

    /**
     * 显示嬴的钱
     * @param userId
     * @param bonusAmount
     */
    showWin(userId:number,bonusAmount:number): void {
        this.getSeatByUserId(userId)?.showWin(bonusAmount);
    }

    /**
     * 结算时在所有在座玩家头像旁显示手牌点数，赢家用背景1，输家用背景2。
     * 需在 setData / refreshFromPlayers 已更新 cardPoint 之后调用。
     * @param winnerId 本局赢家 userId
     */
    showResultPoints(winnerId: number): void {
        for (const seat of this._allSeats()) {
            if (!seat || seat.isEmpty()) continue;
            seat.showResultPoint(seat.getUserId() === winnerId);
        }
    }

    /**
     * 获取所有有玩家座位的快照，供结算面板使用。
     * 返回顺序与屏幕位置一致：[bottom(自己), right, left]。
     */
    getSeatSnapshots(): SeatSnapshot[] {
        const result: SeatSnapshot[] = [];
        for (const seat of this._allSeats()) {
            if (!seat || seat.isEmpty()) continue;
            const avatarWorldPos = seat.getAvatarWorldPosition();
            const playerInfo     = seat.getPlayerInfo();
            if (!avatarWorldPos || !playerInfo) continue;
            result.push({
                userId:         seat.getUserId(),
                avatarWorldPos: avatarWorldPos,
                playerInfo:     playerInfo,
                isSelf:         seat.isSelf(),
            });
        }
        return result;
    }

    // ── 私有：视角排列计算 ────────────────────────────────

    /**
     * 将玩家列表映射到三个显示位置。
     *
     * 算法：
     *   1. 找到 selfUserId 对应的 seat（服务端座位号 1-based）
     *   2. 从该 seat 出发，按逆时针（seat+0, seat+1, seat+2 mod maxSeat）排列
     *   3. 若 selfUserId 不在座位上（纯旁观）：空座优先放 index 0，有人座按原序排列
     */
    private _buildPositions(
        players: TongitsPlayerInfo[],
        selfUserId: number,
    ): Array<{ player: TongitsPlayerInfo | null; seat: number; isSelf: boolean }> {

        const MAX_SEATS = 3;

        // 构建 seat → player 映射
        const seatMap = new Map<number, TongitsPlayerInfo>();
        for (const p of players) {
            const seat = p.playerInfo?.seat;
            if (seat && seat > 0) seatMap.set(seat, p);
        }

        // 确定视角起始 seat
        const selfPlayer = players.find(p => p.playerInfo?.userId === selfUserId);
        const selfSeat = selfPlayer?.playerInfo?.seat ?? 0;

        if (selfSeat > 0) {
            this._selfSeat = selfSeat;   // 缓存，供后续局部数据更新时使用
            return this._buildBySeat(selfSeat, MAX_SEATS, seatMap, selfUserId);
        }

        // self 不在本次数据中（如 onBeforeResult 只含部分玩家）：
        // 用缓存的 seat 保持相对布局，不回退到绝对顺序
        if (this._selfSeat > 0) {
            return this._buildBySeat(this._selfSeat, MAX_SEATS, seatMap, selfUserId);
        }

        // 纯旁观者（游戏外）：空座优先
        return this._buildSpectator(MAX_SEATS, seatMap, selfUserId);
    }

    /** 从 viewSeat 出发按逆时针构建三个位置 */
    private _buildBySeat(
        viewSeat: number,
        max: number,
        map: Map<number, TongitsPlayerInfo>,
        selfId: number,
    ): Array<{ player: TongitsPlayerInfo | null; seat: number; isSelf: boolean }> {
        return Array.from({ length: max }, (_, i) => {
            const seat = ((viewSeat - 1 + i) % max) + 1;
            const player = map.get(seat) ?? null;
            return { player, seat, isSelf: player?.playerInfo?.userId === selfId };
        });
    }

    /** 旁观者模式：空座位优先排在前面 */
    private _buildSpectator(
        max: number,
        map: Map<number, TongitsPlayerInfo>,
        selfId: number,
    ): Array<{ player: TongitsPlayerInfo | null; seat: number; isSelf: boolean }> {
        const empty: Array<{ player: null; seat: number; isSelf: false }> = [];
        const occupied: Array<{ player: TongitsPlayerInfo; seat: number; isSelf: boolean }> = [];
        for (let seat = 1; seat <= max; seat++) {
            const p = map.get(seat);
            if (p) occupied.push({ player: p, seat, isSelf: p.playerInfo?.userId === selfId });
            else empty.push({ player: null, seat, isSelf: false });
        }
        return [...empty, ...occupied];
    }

    // ── 私有工具 ─────────────────────────────────────────

    /** 为座位注入点击回调，每次 setData 后调用确保数据最新 */
    private _bindSeatCallbacks(seat: PlayerSeat): void {
        seat.onEmptySeatClick = (s) => {
            Nexus.emit(GameEvents.CMD_SIT_DOWN, { seat: s.getServerSeat() });
        };
        seat.onPlayerInfoClick = (s) => {
            Nexus.emit(GameEvents.CMD_VIEW_PLAYER_INFO, { userId: s.getUserId() });
        };
        seat.onKickBtnClick = (s) => {
            if (s.isSelf()) {
                // 自己是房主：点击 = 站起
                Nexus.emit(GameEvents.CMD_STAND_UP);
            } else {
                // 其他玩家：点击 = 踢人下座
                Nexus.emit(GameEvents.CMD_KICK_OFF_SEAT, { userId: s.getUserId() });
            }
        };
    }

    private _allSeats(): (PlayerSeat | null)[] {
        return [this.seatBottom, this.seatRight, this.seatLeft];
    }

    private _findSeatByUserId(userId: number): PlayerSeat | null {
        return this._allSeats().find(s => s?.getUserId() === userId) ?? null;
    }

    /**
     * 获取所有非空座位头像节点的世界坐标。
     * 供 GameStartEffect 确定 Phase1 的金币起点。
     */
    getAvatarWorldPositions(): Vec3[] {
        const result: Vec3[] = [];
        for (const seat of this._allSeats()) {
            if (!seat || seat.isEmpty()) continue;
            // avatarSprite 节点即头像，取其世界坐标
            const avatarNode = seat.avatarSprite?.node;
            if (avatarNode) result.push(avatarNode.getWorldPosition());
        }
        return result;
    }

}
