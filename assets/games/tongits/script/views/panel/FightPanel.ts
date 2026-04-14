/**
 * FightPanel — 挑战阶段顶层容器
 *
 * 统一管理三个方向的 FightZone 与 ChallengeResponsePanel，
 * 对外提供语义化接口，由 TongitsView 驱动。
 *
 * userId → FightZone 的映射由外部注入的 zoneResolver 提供，
 * 实际实现由 PlayerSeatManager.getFightZoneByUserId 承担。
 *
 * 节点结构（编辑器中搭建）：
 *   FightPanel（默认 active=false）
 *   ├── bottomZone          ← FightZone，alignment=CENTER
 *   ├── leftZone            ← FightZone，alignment=LEFT
 *   ├── rightZone           ← FightZone，alignment=RIGHT
 *   └── responsePanel       ← ChallengeResponsePanel（默认 active=false）
 *
 * TongitsView 接入示例：
 *   this.fightPanel.zoneResolver = (uid) => this.seatManager.getFightZoneByUserId(uid);
 *   this.fightPanel.onChallengeResponse = (accepted) => { ... };
 *   this.fightPanel.onPlayerChallenge(userId);
 *   this.fightPanel.showResponsePanel(myPoints, endTimestamp);
 *   this.fightPanel.onPlayerFold(userId);
 *   this.fightPanel.showShowdown([{ userId, cards, points, groups? }, ...]);
 *   this.fightPanel.reset();
 */

import { _decorator, Component } from 'cc';
import { FightZone }              from './FightZone';
import { ChallengeResponsePanel } from './ChallengeResponsePanel';
import type { GroupData }         from '../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

// ── Showdown 数据结构 ─────────────────────────────────────

export interface ShowdownInfo {
    /** 玩家 userId */
    userId: number;
    /** 该玩家手牌值列表 */
    cards: number[];
    /** 该玩家点数 */
    points: number;
    /** 分组数据（不传则 HandDisplayPanel 自动分组） */
    groups?: GroupData[];
}

// ── 组件 ─────────────────────────────────────────────────

@ccclass('FightPanel')
export class FightPanel extends Component {

    // ── Inspector 绑定 ────────────────────────────────────

    @property({ type: FightZone, tooltip: 'bottom 方向区域（index 0 / 自己）' })
    bottomZone: FightZone | null = null;

    @property({ type: FightZone, tooltip: 'left 方向区域（index 1）' })
    leftZone: FightZone | null = null;

    @property({ type: FightZone, tooltip: 'right 方向区域（index 2）' })
    rightZone: FightZone | null = null;

    @property({ type: ChallengeResponsePanel, tooltip: '挑战响应面板（本地玩家专用）' })
    responsePanel: ChallengeResponsePanel | null = null;

    // ── 对外注入 ──────────────────────────────────────────

    /**
     * userId → FightZone 的查询函数，由 TongitsView 在 init 时注入。
     * 实际委托给 PlayerSeatManager.getFightZoneByUserId。
     */
    zoneResolver: ((userId: number) => FightZone | null) | null = null;

    /**
     * 本地玩家点击 Challenge（true）或 Fold（false）后触发。
     * 由 TongitsView 赋值，用于向服务端发送响应指令。
     */
    onChallengeResponse: ((accepted: boolean) => void) | null = null;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        this.node.active = false;

        if (this.responsePanel) {
            this.responsePanel.onChallenge = () => {
                this.responsePanel?.hide();
                this.onChallengeResponse?.(true);
            };
            this.responsePanel.onFold = () => {
                this.responsePanel?.hide();
                this.onChallengeResponse?.(false);
            };
        }
    }

    // ── 公开 API（由 TongitsView 调用，均以 userId 为参数） ──

    /** 某玩家发起了挑战：激活面板，在对应方向播放挑战动画 */
    onPlayerChallenge(userId: number): void {
        this.node.active = true;
        this._getZone(userId)?.playChallenge();
    }

    /**
     * 轮到本地玩家响应挑战，弹出 Challenge/Fold 面板。
     * @param points       自己当前手牌点数
     * @param endTimestamp 倒计时结束的 Unix 时间戳（ms）
     */
    showResponsePanel(points: number, endTimestamp: number): void {
        this.responsePanel?.show(points, endTimestamp);
    }

    /** 某玩家接受了挑战，播放接受动画 */
    onPlayerAccept(userId: number): void {
        this._getZone(userId)?.playAccept();
    }

    /** 某玩家折牌，播放折牌动画 */
    onPlayerFold(userId: number): void {
        this._getZone(userId)?.playFold();
    }

    /** 某玩家被烧死，播放烧死动画 */
    onPlayerBurn(userId: number): void {
        this._getZone(userId)?.playBurn();
    }

    /** 某玩家赢得比牌，播放赢牌动画 */
    onPlayerWin(userId: number): void {
        this._getZone(userId)?.playWin();
    }

    /**
     * 进入 Showdown 比牌阶段：隐藏响应面板，在各方向区域展示手牌与点数。
     * @param infos 各玩家 Showdown 数据
     */
    showShowdown(infos: ShowdownInfo[]): void {
        this.responsePanel?.hide();
        for (const info of infos) {
            this._getZone(info.userId)?.showShowdown(info.cards, info.points, info.groups);
        }
    }

    /** 重置所有状态（游戏结束 / 下一局开始前调用） */
    reset(): void {
        this.bottomZone?.reset();
        this.leftZone?.reset();
        this.rightZone?.reset();
        this.responsePanel?.hide();
        this.node.active = false;
    }

    // ── 私有 ──────────────────────────────────────────────

    private _getZone(userId: number): FightZone | null {
        const zone = this.zoneResolver?.(userId) ?? null;
        console.log(`[FightPanel] _getZone(${userId}) →`, zone?.node.name ?? 'null (resolver 未设置或未找到)');
        return zone;
    }
}
