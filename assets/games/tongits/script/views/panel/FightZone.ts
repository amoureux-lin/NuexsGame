/**
 * FightZone — 单方向挑战/比牌区域组件
 *
 * 三个实例分别对应 bottom(自己) / left(p3) / right(p2) 三个三角区域。
 *
 * bgSkeleton 动画序列：
 *   setSkin(skin) → bg_in（单次）→ bg_loop（循环等待）
 *                                  ↓ 收到结果
 *                              out / bg_out2 / bg_win（单次）→ 隐藏
 *
 * 节点结构（编辑器中搭建）：
 *   FightZone
 *   ├── bgSkeletonNode   ← sp.Skeleton，背景动效层（默认 active=false）
 *   ├── fxSkeletonNode   ← sp.Skeleton，前景动效层（默认 active=false）
 *   └── showdownNode     ← 比牌展示根节点（默认 active=false）
 *       ├── handCardsNode  ← HandDisplayPanel 组件节点
 *       └── pointsLabel    ← Label，显示该玩家点数
 */

import { _decorator, Component, Node, Label, sp } from 'cc';
import { HandDisplayPanel }                        from '../handcard/HandDisplayPanel';
import type { GroupData }                          from '../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

// ── bgSkeleton Skin 名 ────────────────────────────────────
const SKIN_CHALLENGE = 'challenge';
const SKIN_FIGHT     = 'fight';
const SKIN_SURRENDER = 'surrender';
const SKIN_BURNED    = 'burned';

// ── bgSkeleton 动画名 ─────────────────────────────────────
const BG_IN   = 'bg_in';    // 入场（单次）
const BG_LOOP = 'bg_loop';  // 等待循环
const BG_OUT  = 'bg_out';      // 通用退出（接受 / 烧死）
const BG_OUT2 = 'bg_out2';  // 折牌退出
const BG_WIN  = 'bg_win';   // 赢牌退出

// ── fxSkeleton 动画名（后续补充后在此处填写） ─────────────
const FX_ACCEPT = '';
const FX_FOLD   = '';
const FX_BURN   = '';
const FX_WIN    = '';

@ccclass('FightZone')
export class FightZone extends Component {

    // ── Inspector：节点绑定 ────────────────────────────────

    @property({ type: sp.Skeleton, tooltip: '背景动效层 Skeleton（默认 active=false）' })
    bgSkeleton: sp.Skeleton | null = null;

    @property({ type: sp.Skeleton, tooltip: '前景/其他动效层 Skeleton（默认 active=false）' })
    fxSkeleton: sp.Skeleton | null = null;

    @property({ type: Node, tooltip: 'Showdown 阶段展示根节点（默认 active=false）' })
    showdownNode: Node | null = null;

    @property({ type: HandDisplayPanel, tooltip: 'Showdown 手牌展示组件' })
    handDisplay: HandDisplayPanel | null = null;

    @property({ type: Label, tooltip: 'Showdown 玩家点数标签' })
    pointsLabel: Label | null = null;

    // ── 生命周期 ───────────────────────────────────────────

    protected onLoad(): void {
        if (this.bgSkeleton) this.bgSkeleton.node.active = false;
        if (this.fxSkeleton) this.fxSkeleton.node.active = false;
        if (this.showdownNode) this.showdownNode.active   = false;
    }

    // ── 公开 API ───────────────────────────────────────────

    /** 发起挑战：bg → challenge skin，bg_in → bg_loop 循环等待 */
    playChallenge(): void {
        this._bgIntroLoop(SKIN_CHALLENGE);
    }

    /** 接受挑战：bg → fight skin，out 退出；fx 播接受动画 */
    playAccept(): void {
        if (this.bgSkeleton?.node.active) {
            this._bgOutro(SKIN_FIGHT, BG_OUT);
        } else {
            this._bgIntroDirect(SKIN_FIGHT, BG_OUT);
        }
        this._playFx(FX_ACCEPT);
    }

    /** 折牌：bg → surrender skin，bg_out2 退出；fx 播折牌动画 */
    playFold(): void {
        if (this.bgSkeleton?.node.active) {
            this._bgOutro(SKIN_SURRENDER, BG_OUT2);
        } else {
            this._bgIntroDirect(SKIN_SURRENDER, BG_OUT2);
        }
        this._playFx(FX_FOLD);
    }

    /**
     * 烧死：bg → burned skin，bg_in → out（无 loop 阶段）；fx 播烧死动画
     */
    playBurn(): void {
        this._bgIntroDirect(SKIN_BURNED, BG_OUT);
        this._playFx(FX_BURN);
    }

    /** 赢得比牌：bg 保持当前 skin，bg_win 退出；fx 播赢牌动画 */
    playWin(): void {
        this._bgOutro(null, BG_WIN);
        this._playFx(FX_WIN);
    }

    /**
     * 显示 Showdown 手牌与点数。
     * @param cards  该玩家手牌值列表
     * @param points 该玩家点数
     * @param groups 服务端分组数据（不传则自动分组）
     */
    showShowdown(cards: number[], points: number, groups?: GroupData[]): void {
        if (this.showdownNode) this.showdownNode.active = true;
        this.handDisplay?.show(cards, groups);
        if (this.pointsLabel) this.pointsLabel.string = String(points);
    }

    /** 重置到初始状态（游戏结束 / 下一局时调用） */
    reset(): void {
        this._stopBg();
        this._stopFx();
        this.handDisplay?.clear();
        if (this.showdownNode) this.showdownNode.active = false;
    }

    // ── 私有：bgSkeleton ──────────────────────────────────

    /** setSkin → bg_in（单次）→ bg_loop（循环）*/
    private _bgIntroLoop(skin: string): void {
        const sk = this.bgSkeleton;
        if (!sk) return;
        sk.node.active = true;
        sk.setSkin(skin);
        sk.setCompleteListener(null);
        sk.setAnimation(0, BG_IN,   false);
        sk.addAnimation(0, BG_LOOP, true, 0);
    }

    /**
     * 可选换 skin → 中断 loop → outroAnim（单次）→ 隐藏。
     * @param skin  null 表示保持当前 skin 不变
     */
    private _bgOutro(skin: string | null, outroAnim: string): void {
        const sk = this.bgSkeleton;
        if (!sk || !sk.node.active) return;
        if (skin) sk.setSkin(skin);
        sk.setCompleteListener(null);
        sk.setAnimation(0, outroAnim, false);
        sk.setCompleteListener(() => {
            if (sk.isValid) {
                sk.node.active = false;
                sk.setCompleteListener(null);
            }
        });
    }

    /**
     * setSkin → bg_in（单次）→ bg_loop（循环，等 1 圈）→ outroAnim（单次）→ 隐藏
     * 用于结果已知、无需外部打断的场景（accept / fold / burn）。
     */
    private _bgIntroDirect(skin: string, outroAnim: string): void {
        const sk = this.bgSkeleton;
        if (!sk) return;
        sk.node.active = true;
        sk.setSkin(skin);
        sk.setCompleteListener(null);
        sk.setAnimation(0, BG_IN,   false);
        sk.addAnimation(0, BG_LOOP, true,  0);
        // bg_in 播完后切换监听，等 bg_loop 跑完一圈再出场
        sk.setCompleteListener(() => {
            if (!sk.isValid) return;
            sk.setCompleteListener(() => {
                if (!sk.isValid) return;
                sk.setCompleteListener(null);
                sk.setAnimation(0, outroAnim, false);
                sk.setCompleteListener(() => {
                    if (sk.isValid) {
                        sk.node.active = false;
                        sk.setCompleteListener(null);
                    }
                });
            });
        });
    }

    private _stopBg(): void {
        const sk = this.bgSkeleton;
        if (!sk) return;
        sk.clearTracks();
        sk.setCompleteListener(null);
        sk.node.active = false;
    }

    // ── 私有：fxSkeleton ──────────────────────────────────

    /** 播放 fx 单次动画（animName 为空则跳过） */
    private _playFx(animName: string): void {
        const sk = this.fxSkeleton;
        if (!sk || !animName) return;
        sk.node.active = true;
        sk.setCompleteListener(null);
        sk.setAnimation(0, animName, false);
        sk.setCompleteListener(() => {
            if (sk.isValid) {
                sk.node.active = false;
                sk.setCompleteListener(null);
            }
        });
    }

    private _stopFx(): void {
        const sk = this.fxSkeleton;
        if (!sk) return;
        sk.clearTracks();
        sk.setCompleteListener(null);
        sk.node.active = false;
    }
}
