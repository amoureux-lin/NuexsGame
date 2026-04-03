import { _decorator, Component } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { TongitsEvents } from '../../config/TongitsEvents';
import { PlayerSeat } from './PlayerSeat';
import type { TongitsPlayerInfo } from '../../proto/tongits';

const { ccclass, property } = _decorator;

/**
 * PlayerSeatManager — 三个座位的布局与数据管理
 *
 * 屏幕布局（Tongits 3人逆时针）：
 *
 *   [seatLeft]          [seatRight]
 *         [seatBottom（自己）]
 *
 * getPlayersWithPosition() 返回的 index 含义：
 *   index 0 → 自己（或视角玩家）→ seatBottom
 *   index 1 → 逆时针第一个对手  → seatLeft
 *   index 2 → 逆时针第二个对手  → seatRight
 *
 * 职责：
 *   - 接收 players 列表 + selfUserId，计算视角排列后分发给3个 PlayerSeat
 *   - 提供通过 userId 查找 PlayerSeat 的接口
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

    // ── 私有上下文 ────────────────────────────────────────
    private _isLocalOwner: boolean = false;
    private _isGameStarted: boolean = false;

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
        console.log('refreshFromPlayers', players);
        const positions = this._buildPositions(players, selfUserId);
        const seats = [this.seatBottom, this.seatLeft, this.seatRight];
        for (let i = 0; i < seats.length; i++) {
            if (!seats[i]) continue;
            seats[i].setSeatIndex(i);
            seats[i].setContext(this._isLocalOwner, this._isGameStarted);
            const pos = positions[i];
            seats[i].setData(pos?.player ?? null, pos?.isSelf ?? false, pos?.seat ?? 0);
            this._bindSeatCallbacks(seats[i]);
        }
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
     * @param countdown 剩余秒数
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
     * 通过屏幕位置索引获取 PlayerSeat (0=下, 1=左, 2=右)。
     */
    getSeatByIndex(index: number): PlayerSeat | null {
        return [this.seatBottom, this.seatLeft, this.seatRight][index] ?? null;
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
            // 有座位：以自己为 index 0，逆时针排列
            return this._buildBySeat(selfSeat, MAX_SEATS, seatMap, selfUserId);
        }

        // 旁观者：空座 → 有人座
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
        return [this.seatBottom, this.seatLeft, this.seatRight];
    }

    private _findSeatByUserId(userId: number): PlayerSeat | null {
        return this._allSeats().find(s => s?.getUserId() === userId) ?? null;
    }
}
