/**
 * TongitsPrompt — Tongits 提示浮层
 *
 * 当服务端 Res 返回 hasTongits=true 时由 TongitsView 调用 show()，
 * 玩家点击后播放 end 动画，结束后触发 onClick 回调，
 * 由 TongitsView 向服务端发送 CMD_TONGITS。
 *
 * 动画序列：
 *   show()  → win_loop（循环等待点击）
 *   点击    → end（单次）→ 隐藏 → onClick 回调
 *
 * 节点结构（编辑器中搭建）：
 *   TongitsPrompt（默认 active=false）
 *   └── skeleton    ← sp.Skeleton，提示特效动画
 */

import { _decorator, Component, Node, sp } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('TongitsPrompt')
export class TongitsPrompt extends Component {

    @property({ type: sp.Skeleton, tooltip: '提示特效 Skeleton' })
    skeleton: sp.Skeleton | null = null;

    /** 玩家点击、end 动画播完后触发，由 TongitsView 注入 */
    onClick: (() => void) | null = null;

    /** 防止 end 动画播放期间重复点击 */
    private _ending: boolean = false;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        this.node.active = false;
        // 监听 skeleton 节点而非 this.node，避免父节点无 UITransform 时 TOUCH_END 收不到的问题
        this.skeleton?.node.on(Node.EventType.TOUCH_END, this._onTap, this);
    }

    protected onDestroy(): void {
        this.skeleton?.node.off(Node.EventType.TOUCH_END, this._onTap, this);
    }

    // ── 公开 API ──────────────────────────────────────────

    /** 显示提示浮层，播放 win_loop 循环等待点击 */
    show(): void {
        this.node.active = true;
        console.log("显示提示浮层，播放 win_loop 循环等待点击")
        this._ending = false;
        this.skeleton.node.active = true;
        this.skeleton.setCompleteListener(null);
        this.skeleton.setAnimation(0, 'win_loop', true);
    }

    /** 强制隐藏（游戏重置等外部调用） */
    hide(): void {
        this._ending = false;
        if (this.skeleton) {
            this.skeleton.clearTracks();
            this.skeleton.setCompleteListener(null);
            this.skeleton.node.active = false;
        }
    }

    // ── 私有 ──────────────────────────────────────────────

    private _onTap(): void {
        if (this._ending) return;
        this._ending = true;

        const sk = this.skeleton;
        if (!sk) {
            this.onClick?.();
            return;
        }

        sk.setCompleteListener(null);
        sk.setAnimation(0, 'end', false);
        sk.setCompleteListener(() => {
            if (!sk.isValid) return;
            sk.setCompleteListener(null);
            this.node.active = false;
            this._ending = false;
            this.onClick?.();
        });
    }
}
