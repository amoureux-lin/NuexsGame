/**
 * TongitsResultPanel — Tongits 结算展示面板
 *
 * 当玩家声明 Tongits（winType=1）时由 TongitsView 调用 show()，
 * 播放 appear → loop 动画，左侧展示赢家头像/昵称，底部展示手牌；
 * 调用 hide() 时播放 disappear 后自动隐藏节点。
 *
 * 节点结构（编辑器中搭建）：
 *   TongitsResultPanel（默认 active=false）
 *   ├── tongitsAnimation   ← sp.Skeleton，appear / loop / disappear
 *   ├── avatarSprite       ← Sprite，赢家头像
 *   ├── nameLabel          ← Label，赢家昵称
 *   └── handDisplay        ← HandDisplayPanel，底部手牌展示
 */

import { _decorator, Component, Label, Node, Sprite, SpriteFrame, UIOpacity, sp, tween, Tween } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { HandDisplayPanel } from '../handcard/HandDisplayPanel';
import type { TongitsPlayerInfo } from '../../proto/tongits';
import type { GroupData } from '../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

@ccclass('TongitsResultPanel')
export class TongitsResultPanel extends Component {

    @property({ type: sp.Skeleton, tooltip: 'Tongits 特效 Skeleton（appear / loop / disappear）' })
    tongitsAnimation: sp.Skeleton | null = null;

    @property({ type: Sprite, tooltip: '赢家头像 Sprite' })
    avatarSprite: Sprite | null = null;

    @property({ type: Label, tooltip: '赢家昵称 Label' })
    nameLabel: Label | null = null;

    @property({ type: Node, tooltip: '玩家信息节点（appear 结束后展示）' })
    playerInfoNode: Node | null = null;

    @property({ type: HandDisplayPanel, tooltip: '底部手牌展示组件' })
    handDisplay: HandDisplayPanel | null = null;

    private _avatarCancelled = false;
    private _autoHideTimer: any = null;

    /** 面板完全隐藏后的回调（disappear 动画结束、节点 active=false 之后触发） */
    onHide: (() => void) | null = null;

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 显示结算面板：激活节点，刷新玩家信息，播放 appear → loop，展示手牌。
     * @param winner 赢家 TongitsPlayerInfo
     * @param groups 服务端分组数据（不传则 HandDisplayPanel 自动分组）
     */
    show(winner: TongitsPlayerInfo, groups?: GroupData[]): void {
        this._cancelAutoHide();
        this._avatarCancelled = false;
        this.node.active = true;

        // 预置透明度为 0，随 appear 同步渐显
        this._setOpacity(this.playerInfoNode, 0);
        if (this.playerInfoNode) this.playerInfoNode.active = true;
        this.handDisplay?.clear();
        this.handDisplay?.show(winner.handCards ?? [], groups, false);
        this._setOpacity(this.handDisplay?.node ?? null, 0);

        this._refreshPlayerInfo(winner);
        this._playIntroLoop();

        // loop 展示 2s 后自动隐藏
        this._autoHideTimer = setTimeout(() => {
            this._autoHideTimer = null;
            this.hide();
        }, 3000);
    }

    /**
     * 隐藏结算面板：播放 disappear 动画，结束后隐藏节点并清空手牌。
     * 若 Skeleton 未绑定则立即隐藏。
     */
    hide(): void {
        this._cancelAutoHide();
        const sk = this.tongitsAnimation;
        if (!sk || !sk.node.active) {
            this._doHide();
            return;
        }
        sk.setCompleteListener(null);
        sk.clearTracks();                        // 立即中断当前动画，不等 loop 完成
        sk.setAnimation(0, 'disappear', false);
        // 与 disappear 同步启动渐隐（时长与 appear 对称）
        this._fadeOut(this.playerInfoNode, 0.5);
        this._fadeOut(this.handDisplay?.node ?? null, 0.5);
        sk.setCompleteListener(() => {
            if (!sk.isValid) return;
            sk.setCompleteListener(null);
            this._doHide();
        });
    }

    // ── 私有 ──────────────────────────────────────────────

    private _refreshPlayerInfo(winner: TongitsPlayerInfo): void {
        const info = winner.playerInfo;
        if (this.nameLabel) {
            this.nameLabel.string = info?.nickname ?? '';
        }
        if (this.avatarSprite && info?.avatar) {
            Nexus.asset.loadRemote<SpriteFrame>(info.avatar).then((sf) => {
                if (!this.isValid || !this.avatarSprite || this._avatarCancelled) return;
                this.avatarSprite.spriteFrame = sf;
            }).catch(() => {});
        }
    }

    /** appear（单次）→ loop（循环）；同时对 playerInfoNode 和 handDisplay 渐显 */
    private _playIntroLoop(): void {
        const sk = this.tongitsAnimation;
        if (sk) {
            sk.node.active = true;
            sk.setCompleteListener(null);
            sk.setAnimation(0, 'appear', false);
            sk.addAnimation(0, 'loop', true, 0);
        }
        // 与 appear 同步启动渐显（appear 时长约 0.5s，可按实际调整）
        this._fadeIn(this.playerInfoNode, 0.5);
        this._fadeIn(this.handDisplay?.node ?? null, 0.5);
    }

    /** 对目标节点渐显（通过 UIOpacity 组件） */
    private _fadeIn(node: Node | null, duration: number): void {
        if (!node) return;
        const uo = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        Tween.stopAllByTarget(uo);
        uo.opacity = 0;
        tween(uo).to(duration, { opacity: 255 }).start();
    }

    /** 对目标节点渐隐（通过 UIOpacity 组件） */
    private _fadeOut(node: Node | null, duration: number): void {
        if (!node) return;
        const uo = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        Tween.stopAllByTarget(uo);
        tween(uo).to(duration, { opacity: 0 }).start();
    }

    private _cancelAutoHide(): void {
        if (this._autoHideTimer !== null) {
            clearTimeout(this._autoHideTimer);
            this._autoHideTimer = null;
        }
    }

    private _doHide(): void {
        this._avatarCancelled = true;
        const sk = this.tongitsAnimation;
        if (sk) {
            sk.clearTracks();
            sk.setCompleteListener(null);
            sk.node.active = false;
        }
        if (this.playerInfoNode) {
            Tween.stopAllByTarget(this.playerInfoNode.getComponent(UIOpacity));
            this._setOpacity(this.playerInfoNode, 255);
            this.playerInfoNode.active = false;
        }
        if (this.handDisplay?.node) {
            Tween.stopAllByTarget(this.handDisplay.node.getComponent(UIOpacity));
            this._setOpacity(this.handDisplay.node, 255);
        }
        this.handDisplay?.clear();
        this.node.active = false;
        this.onHide?.();
    }

    private _setOpacity(node: Node | null, opacity: number): void {
        if (!node) return;
        const uo = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        uo.opacity = opacity;
    }
}
