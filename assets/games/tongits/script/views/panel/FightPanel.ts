/**
 * FightPanel — 挑战阶段顶层容器
 *
 * 统一管理三个方向的 FightZone 与 ChallengeResponsePanel，
 * 对外提供语义化接口，由 TongitsView 驱动。
 *
 * screenIndex 约定（与 PlayerSeat.setSeatIndex 一致）：
 *   0 = bottom（自己 / p1）
 *   1 = left   （p3）
 *   2 = right  （p2）
 *
 * 节点结构（编辑器中搭建）：
 *   FightPanel（默认 active=false）
 *   ├── bottomZone          ← FightZone，alignment=CENTER
 *   ├── leftZone            ← FightZone，alignment=LEFT
 *   ├── rightZone           ← FightZone，alignment=RIGHT
 *   └── responsePanel       ← ChallengeResponsePanel（默认 active=false）
 *
 * TongitsView 接入示例：
 *   // 赋值回调
 *   this.fightPanel.onChallengeResponse = (accepted) => {
 *       this._sendFightResponse(accepted);
 *   };
 *   // 服务端事件驱动
 *   this.fightPanel.onPlayerChallenge(screenIndex);
 *   this.fightPanel.showResponsePanel(myPoints, endTimestamp);
 *   this.fightPanel.onPlayerFold(screenIndex);
 *   this.fightPanel.showShowdown([{ screenIndex, cards, points, groups? }, ...]);
 *   this.fightPanel.reset();
 */

import { _decorator, Component } from 'cc';
import { FightZone }               from './FightZone';
import { ChallengeResponsePanel }  from './ChallengeResponsePanel';
import type { GroupData }          from '../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

// ── Showdown 数据结构 ─────────────────────────────────────

export interface ShowdownInfo {
    /** 屏幕位置索引：0=bottom / 1=left / 2=right */
    screenIndex: number;
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

    @property({ type: FightZone, tooltip: 'bottom 方向区域（自己 / p1）' })
    bottomZone: FightZone | null = null;

    @property({ type: FightZone, tooltip: 'left 方向区域（p3）' })
    leftZone: FightZone | null = null;

    @property({ type: FightZone, tooltip: 'right 方向区域（p2）' })
    rightZone: FightZone | null = null;

    @property({ type: ChallengeResponsePanel, tooltip: '挑战响应面板（本地玩家专用）' })
    responsePanel: ChallengeResponsePanel | null = null;

    // ── 对外回调 ──────────────────────────────────────────

    /**
     * 本地玩家点击 Challenge（true）或 Fold（false）后触发。
     * 由 TongitsView 赋值，用于向服务端发送响应指令。
     */
    onChallengeResponse: ((accepted: boolean) => void) | null = null;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        // 整个面板默认隐藏，只在挑战阶段激活
        this.node.active = false;

        // 将响应面板的按钮回调代理到外部 onChallengeResponse
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

    // ── 公开 API（由 TongitsView 调用） ──────────────────────

    /**
     * 某玩家发起了挑战。
     * 激活整个 FightPanel，在对应方向播放挑战动画。
     * @param screenIndex 发起方的屏幕位置索引
     */
    onPlayerChallenge(screenIndex: number): void {
        this.node.active = true;
        this._getZone(screenIndex)?.playChallenge();
    }

    /**
     * 轮到本地玩家响应挑战，弹出 Challenge/Fold 面板。
     * @param points       自己当前手牌点数
     * @param endTimestamp 倒计时结束的 Unix 时间戳（ms）
     */
    showResponsePanel(points: number, endTimestamp: number): void {
        this.responsePanel?.show(points, endTimestamp);
    }

    /**
     * 某玩家接受了挑战，播放接受动画。
     * @param screenIndex 接受方的屏幕位置索引
     */
    onPlayerAccept(screenIndex: number): void {
        this._getZone(screenIndex)?.playAccept();
    }

    /**
     * 某玩家折牌，播放折牌动画。
     * @param screenIndex 折牌方的屏幕位置索引
     */
    onPlayerFold(screenIndex: number): void {
        this._getZone(screenIndex)?.playFold();
    }

    /**
     * 某玩家被烧死，播放烧死动画。
     * @param screenIndex 被烧方的屏幕位置索引
     */
    onPlayerBurn(screenIndex: number): void {
        this._getZone(screenIndex)?.playBurn();
    }

    /**
     * 某玩家赢得比牌，播放赢牌动画。
     * @param screenIndex 获胜方的屏幕位置索引
     */
    onPlayerWin(screenIndex: number): void {
        this._getZone(screenIndex)?.playWin();
    }

    /**
     * 进入 Showdown 比牌阶段：隐藏响应面板，
     * 在各方向区域展示手牌与点数。
     * @param infos 各玩家 Showdown 数据（可只传参与比牌的玩家）
     */
    showShowdown(infos: ShowdownInfo[]): void {
        this.responsePanel?.hide();
        for (const info of infos) {
            this._getZone(info.screenIndex)?.showShowdown(
                info.cards, info.points, info.groups,
            );
        }
    }

    /**
     * 重置所有状态（游戏结束 / 下一局开始前调用）。
     * 停止所有动画、清空手牌展示、隐藏整个面板。
     */
    reset(): void {
        this.bottomZone?.reset();
        this.leftZone?.reset();
        this.rightZone?.reset();
        this.responsePanel?.hide();
        this.node.active = false;
    }

    // ── 私有 ──────────────────────────────────────────────

    /** screenIndex → FightZone */
    private _getZone(screenIndex: number): FightZone | null {
        if (screenIndex === 0) return this.bottomZone;
        if (screenIndex === 1) return this.leftZone;
        if (screenIndex === 2) return this.rightZone;
        return null;
    }
}
