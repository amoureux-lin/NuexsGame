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

import { _decorator, Component, Enum, Node, Label, sp, tween, Vec3, Tween, SpriteFrame, Sprite } from 'cc';
import { HandDisplayPanel }                                                   from '../handcard/HandDisplayPanel';
import type { GroupData }                                                      from '../../../utils/GroupAlgorithm';

const { ccclass, property } = _decorator;

// ── showdownNode 飞入方向 ─────────────────────────────────
export enum FightZoneAlignment {
    BOTTOM = 0,  // 底部（自己）：从下方飞入
    LEFT   = 1,  // 左侧（p3）：从左侧飞入
    RIGHT  = 2,  // 右侧（p2）：从右侧飞入
}

// ── bgSkeleton Skin 名 ────────────────────────────────────
const SKIN_CHALLENGE = 'challenge';
const SKIN_FIGHT     = 'fight';
const SKIN_SURRENDER = 'surrender';
const SKIN_BURNED    = 'burned';

// ── bgSkeleton 动画名 ─────────────────────────────────────
const BG_IN   = 'bg_in';    // 入场（单次）
const BG_LOOP = 'bg_loop';  // 循环等待
const BG_WIN  = 'bg_win';   // 赢牌退出（单次）→ 隐藏
const BG_OUT2 = 'bg_out2';  // 输牌退出（单次）→ 隐藏

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

    @property({ type: Enum(FightZoneAlignment), tooltip: 'showdownNode 飞入方向' })
    alignment: FightZoneAlignment = FightZoneAlignment.BOTTOM;

    @property({ type: SpriteFrame, tooltip: '赢背景图' })
    winBg: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '输背景图' })
    loseBg: SpriteFrame | null = null;

    @property({ type: Sprite, tooltip: '结果Sprite' })
    resType: Sprite | null = null;

    @property({ type: SpriteFrame, tooltip: '赢SpriteFrame' })
    winFrame: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: '输SpriteFrame' })
    loseFrame: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: '拒绝SpriteFrame' })
    foldFrame: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: '烧SpriteFrame' })
    burnedFrame: SpriteFrame | null = null;

    /** Showdown 结果动画播完后的回调，由 FightPanel 注入 */
    onShowdownComplete: (() => void) | null = null;

    private originPos = new Vec3();
    private startPos = new Vec3();
    /** 记录挑战过程中的特殊状态，用于 playShowdownResult 决定 title */
    private _zoneStatus: 'none' | 'fold' | 'burned' = 'none';

    // ── 生命周期 ───────────────────────────────────────────

    protected onLoad(): void {
        if (this.bgSkeleton) this.bgSkeleton.node.active = false;
        if (this.fxSkeleton) this.fxSkeleton.node.active = false;
        this.originPos = this.showdownNode.position.clone();
        this.initPos()
    }

    initPos(){
        let pos = this.originPos.clone();
        switch (this.alignment) {
            case FightZoneAlignment.BOTTOM:
                pos = new Vec3(pos.x, pos.y-1000, pos.z);
                break;
            case FightZoneAlignment.LEFT:
                pos = new Vec3(pos.x-1000, pos.y, pos.z);
                break;
            case FightZoneAlignment.RIGHT:
                pos = new Vec3(pos.x+1000, pos.y, pos.z);
                break;
        }
        this.startPos = pos;
        this.showdownNode.setPosition(this.startPos);
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
        this._zoneStatus = 'fold';
        this._bgIntroLoop(SKIN_SURRENDER);
        this._playFxIntroLoop(FX_SURRENDER_IN, FX_SURRENDER_LOOP);
    }

    /** 烧死：bg skin=burned / fx idle_burned_in → idle_burned_loop */
    playBurn(): void {
        this._zoneStatus = 'burned';
        this._bgIntroLoop(SKIN_BURNED);
        this._playFxIntroLoop(FX_BURNED_IN, FX_BURNED_LOOP);
    }

    /** 赢得比牌：bg 保持当前 skin，bg_win 退出；fx 播赢牌动画 */
    playWin(): void {
        this._bgOutro(null, BG_WIN);
        this._playFx(FX_WIN);
    }

    /**
     * Showdown 结果动画（winType=2 展示手牌后调用）：
     *   赢：skin=challenge → bg_win（单次）→ 隐藏
     *   输：skin=burned   → bg_out2（单次）→ 隐藏
     */
    playShowdownResult(isWin: boolean): void {
        // 更新 showdownNode 背景图
        if (this.showdownNode.getComponent(Sprite)) {
            this.showdownNode.getComponent(Sprite).spriteFrame = isWin ? this.winBg : this.loseBg;
        }

        // 激活 resType 并更新 title 图片
        if (this.resType) {
            this.resType.node.active = true;
            if (isWin) {
                this.resType.spriteFrame = this.winFrame;
            } else if (this._zoneStatus === 'fold') {
                this.resType.spriteFrame = this.foldFrame;
            } else if (this._zoneStatus === 'burned') {
                this.resType.spriteFrame = this.burnedFrame;
            } else {
                this.resType.spriteFrame = this.loseFrame;
            }
        }

        this._stopFx();
        const sk = this.bgSkeleton;
        if (!sk) return;
        sk.node.active = true;
        sk.setCompleteListener(null);
        if (isWin) {
            sk.setSkin(SKIN_CHALLENGE);
            sk.setAnimation(0, BG_WIN, false);
        } else {
            sk.setSkin(SKIN_BURNED);
            sk.setAnimation(0, BG_OUT2, false);
        }
        sk.setCompleteListener(() => {
            console.log(`[FightZone] playShowdownResult complete  isWin=${isWin} status=${this._zoneStatus} node=${this.node.name}`);
            sk.setCompleteListener(null);
            this.onShowdownComplete?.();
        });
    }

    /**
     * 显示 Showdown 手牌与点数。
     * @param cards  该玩家手牌值列表
     * @param points 该玩家点数
     * @param groups 服务端分组数据（不传则自动分组）
     */
    /**
     * 显示 Showdown 手牌与点数，并播放飞入动画。
     * 飞入完成后自动根据 isWin 切换背景动画。
     */
    showResult(cards: number[], points: number, groups?: GroupData[], isWin: boolean = false): void {
        // 1. 先激活节点，确保子组件 onLoad 已执行（_root 不为 null）
        Tween.stopAllByTarget(this.showdownNode);
        this.showdownNode.active = true;

        // 2. 初始化手牌内容与点数
        this.handDisplay?.show(cards, groups);
        if (this.pointsLabel) this.pointsLabel.string = String(points);

        tween(this.showdownNode).to(0.3, { position: this.originPos }).delay(0.3).call(()=>{
            this.playShowdownResult(isWin);
        }).start();
    }

    /**
     * 挑战结算前过渡状态（winType=2 时调用）：
     *   - fxSkeleton：立即停止并隐藏
     *   - bgSkeleton：保持当前 skin，切换为 bg_loop 纯循环（已隐藏则跳过）
     */
    toShowdownState(): void {
        this._stopFx();
        const sk = this.bgSkeleton;
        if (!sk || !sk.node.active) return;
        sk.setCompleteListener(null);
        sk.setAnimation(0, BG_LOOP, true);
    }

    /** 重置到初始状态（游戏结束 / 下一局时调用） */
    reset(): void {
        this._zoneStatus = 'none';
        this._stopBg();
        this._stopFx();
        this.handDisplay?.clear();
        if (this.resType) this.resType.node.active = false;
        if (this.showdownNode) {
            Tween.stopAllByTarget(this.showdownNode);
            this.showdownNode.active = false;
        }
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
