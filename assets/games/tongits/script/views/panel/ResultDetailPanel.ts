import { _decorator, Button, Component } from 'cc';
import type { PlayerResult } from '../../proto/tongits';
import { ResultDetailRow } from './ResultDetailRow';

const { ccclass, property } = _decorator;

/**
 * ResultDetailPanel — 结算详情弹层
 *
 * 由 TongitsResultPanel 中"详情"按钮触发显示，
 * 展示每位玩家各分项奖励的完整明细。
 *
 * 节点结构（编辑器搭建，default active=false）：
 *   ResultDetailPanel
 *   ├── closeBtn              关闭/返回按钮
 *   └── rows[0/1/2]           Component: ResultDetailRow（每位玩家一个）
 *
 * 数据来源：GameResultBroadcast.playerResults（onGameResult 时缓存）
 * 或 GameResultDetailsRes.playerResults（CMD_RESULT_DETAILS 返回后刷新）。
 */
@ccclass('ResultDetailPanel')
export class ResultDetailPanel extends Component {

    @property({ type: Button, tooltip: '关闭/返回按钮' })
    closeBtn: Button | null = null;

    @property({ type: [ResultDetailRow], tooltip: '三名玩家的明细行（顺序与 playerResults 一致）' })
    rows: ResultDetailRow[] = [];

    // ── 外部回调 ─────────────────────────────────────────

    /** 点击关闭后的回调（由 TongitsResultPanel 注入） */
    public onClose: (() => void) | null = null;

    // ── 生命周期 ─────────────────────────────────────────

    protected onLoad(): void {
        this.closeBtn?.node.on(Button.EventType.CLICK, this._onClose, this);
    }

    protected onDestroy(): void {
        this.closeBtn?.node.off(Button.EventType.CLICK, this._onClose, this);
    }

    // ── 公开接口 ─────────────────────────────────────────

    /**
     * 显示详情面板。
     * @param results   PlayerResult 数组（onGameResult 或 onResultDetails 时的数据）
     * @param winnerId  胜者 userId（用于判断每位玩家的输赢状态）
     */
    show(results: PlayerResult[], winnerId: number): void {
        this.node.active = true;
        this._populate(results, winnerId);
    }

    /**
     * 用新数据刷新（不重置显示状态，仅更新数值）。
     * 适用于 CMD_RESULT_DETAILS 服务端响应到达后的刷新。
     */
    refresh(results: PlayerResult[], winnerId: number): void {
        if (!this.node.active) return;
        this._populate(results, winnerId);
    }

    hide(): void {
        this.node.active = false;
    }

    // ── 私有 ─────────────────────────────────────────────

    private _populate(results: PlayerResult[], winnerId: number): void {
        for (let i = 0; i < this.rows.length; i++) {
            const row    = this.rows[i];
            const player = results[i];
            if (!row) continue;
            if (player) {
                const isWin = player.playerInfo?.playerInfo?.userId === winnerId;
                row.init(player, isWin);
            }
        }
    }

    private _onClose(): void {
        this.hide();
        this.onClose?.();
    }
}
