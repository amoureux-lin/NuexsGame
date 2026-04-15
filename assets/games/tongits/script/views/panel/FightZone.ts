/**
 * FightZone — 单方向挑战/比牌区域组件
 *
 * 三个实例分别对应 bottom(自己) / left(p3) / right(p2) 三个三角区域。
 *
 * bgSkeleton skin / 动画序列对照：
 *   发起挑战  skin=fight      bg: bg_in → bg_loop   fx: idle_fight_in → idle_fight_loop
 *   接受挑战  skin=challenge  bg: bg_in → bg_loop   fx: idle_challenge_in → idle_challenge_loop
 *   拒绝挑战  skin=surrender  bg: bg_in → bg_loop   fx: idle_surrender_in → idle_surrender_loop
 *   烧死      skin=burned     bg: bg_in → bg_loop   fx: idle_burned_in → idle_burned_loop
 *   赢牌      保持当前 skin   bg: bg_win（单次）→ 隐藏
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
const BG_LOOP = 'bg_loop';  // 循环等待
const BG_WIN  = 'bg_win';   // 赢牌退出（单次）→ 隐藏

// ── fxSkeleton 动画名 ────────────────────────────────────
const FX_FIGHT_IN       = 'idle_fight_in';
const FX_FIGHT_LOOP     = 'idle_fight_loop';
const FX_CHALLENGE_IN   = 'idle_challenge_in';
const FX_CHALLENGE_LOOP = 'idle_challenge_loop';
const FX_SURRENDER_IN   = 'idle_surrender_in';
const FX_SURRENDER_LOOP = 'idle_surrender_loop';
const FX_BURNED_IN      = 'idle_burned_in';
const FX_BURNED_LOOP    = 'idle_burned_loop';
const FX_WIN            = '';   // 赢牌 fx（后续补充）

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

    /** 发起挑战：bg skin=fight / fx idle_fight_in → idle_fight_loop */
    playChallenge(): void {
        this._bgIntroLoop(SKIN_FIGHT);
        this._playFxIntroLoop(FX_FIGHT_IN, FX_FIGHT_LOOP);
    }

    /** 接受挑战：bg skin=challenge / fx idle_challenge_in → idle_challenge_loop */
    playAccept(): void {
        this._bgIntroLoop(SKIN_CHALLENGE);
        this._playFxIntroLoop(FX_CHALLENGE_IN, FX_CHALLENGE_LOOP);
    }

    /** 拒绝挑战：bg skin=surrender / fx idle_surrender_in → idle_surrender_loop */
    playFold(): void {
        this._bgIntroLoop(SKIN_SURRENDER);
        this._playFxIntroLoop(FX_SURRENDER_IN, FX_SURRENDER_LOOP);
    }

    /** 烧死：bg skin=burned / fx idle_burned_in → idle_burned_loop */
    playBurn(): void {
        this._bgIntroLoop(SKIN_BURNED);
        this._playFxIntroLoop(FX_BURNED_IN, FX_BURNED_LOOP);
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
     * 保持（或切换）skin → bg_win（单次）→ 隐藏。
     * 仅用于 playWin()。
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

    private _stopBg(): void {
        const sk = this.bgSkeleton;
        if (!sk) return;
        sk.clearTracks();
        sk.setCompleteListener(null);
        sk.node.active = false;
    }

    // ── 私有：fxSkeleton ──────────────────────────────────

    /** inAnim（单次）→ loopAnim（循环）；inAnim 为空则跳过 */
    private _playFxIntroLoop(inAnim: string, loopAnim: string): void {
        const sk = this.fxSkeleton;
        if (!sk || !inAnim) return;
        sk.node.active = true;
        sk.setCompleteListener(null);
        sk.setAnimation(0, inAnim,    false);
        sk.addAnimation(0, loopAnim,  true, 0);
    }

    /** 播放 fx 单次动画后隐藏（animName 为空则跳过，赢牌 fx 备用） */
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
