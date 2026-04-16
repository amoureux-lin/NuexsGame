/**
 * TongitsResultPanel — Tongits 结算展示面板
 *
 * 当玩家声明 Tongits（winType=1）时由 TongitsView 调用 show()，
 * 播放 appear → loop 动画并展示手牌；
 * 调用 hide() 时播放 disappear 后自动隐藏节点。
 *
 * 节点结构（编辑器中搭建）：
 *   TongitsResultPanel（默认 active=false）
 *   ├── tongitsAnimation   ← sp.Skeleton，appear / loop / disappear
 *   └── handDisplay        ← HandDisplayPanel，底部手牌展示
 */

import { _decorator, Component, sp } from 'cc';
import { HandDisplayPanel } from '../handcard/HandDisplayPanel';
import type { GroupData } from '../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

@ccclass('TongitsResultPanel')
export class TongitsResultPanel extends Component {

    @property({ type: sp.Skeleton, tooltip: 'Tongits 特效 Skeleton（appear / loop / disappear）' })
    tongitsAnimation: sp.Skeleton | null = null;

    @property({ type: HandDisplayPanel, tooltip: '底部手牌展示组件' })
    handDisplay: HandDisplayPanel | null = null;

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 显示结算面板：激活节点，播放 appear → loop，展示手牌。
     * @param cards  玩家手牌值列表
     * @param groups 服务端分组数据（不传则 HandDisplayPanel 自动分组）
     */
    show(cards: number[], groups?: GroupData[]): void {
        this.node.active = true;
        this.handDisplay.node.active = true;
        this.handDisplay?.show(cards, groups);
        this._playIntroLoop();
    }

    /**
     * 隐藏结算面板：播放 disappear 动画，结束后隐藏节点并清空手牌。
     * 若 Skeleton 未绑定则立即隐藏。
     */
    hide(): void {
        const sk = this.tongitsAnimation;
        if (!sk || !sk.node.active) {
            this._doHide();
            return;
        }
        sk.setCompleteListener(null);
        sk.setAnimation(0, 'disappear', false);
        sk.setCompleteListener(() => {
            if (!sk.isValid) return;
            sk.setCompleteListener(null);
            this._doHide();
        });
    }

    // ── 私有 ──────────────────────────────────────────────

    /** appear（单次）→ loop（循环） */
    private _playIntroLoop(): void {
        const sk = this.tongitsAnimation;
        if (!sk) return;
        sk.node.active = true;
        sk.setCompleteListener(null);
        sk.setAnimation(0, 'appear', false);
        sk.addAnimation(0, 'loop', true, 0);
    }

    private _doHide(): void {
        const sk = this.tongitsAnimation;
        if (sk) {
            sk.clearTracks();
            sk.setCompleteListener(null);
            sk.node.active = false;
        }
        this.handDisplay?.clear();
        this.node.active = false;
    }
}
