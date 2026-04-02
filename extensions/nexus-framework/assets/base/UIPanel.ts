import { Component, Node, tween, Tween, UIOpacity } from 'cc';
import { Nexus } from '../core/Nexus';

/**
 * UI 面板基类：所有通过 Nexus.ui.show() 打开的面板推荐继承此类。
 *
 * 提供：
 *   - onShow / onHide 生命周期（由框架自动调用）
 *   - showAnimation / hideAnimation 动画钩子（子类覆写自定义动画）
 *   - panelName 自动注入（框架 show 时写入，面板无需硬编码自己的 name）
 *   - close() / destroySelf() 快捷关闭方法
 *   - trackTween() / stopAllTweens() 动画工具方法
 *   - onDestroy 自动解绑事件
 */
export abstract class UIPanel extends Component {

    /** 框架注入：当前面板的注册 name，用于关闭自己。不要手动赋值。 */
    panelName = '';

    /** 框架注入：当前面板对应的遮罩节点。子类可在动画中使用。 */
    maskNode: Node | null = null;

    protected _tweens: { tw: Tween<any>; resolve: () => void }[] = [];

    /**
     * 面板显示时由框架调用。
     * 子类在此根据 params 初始化 UI 内容。
     */
    onShow(_params?: unknown): void {}

    /**
     * 面板隐藏时由框架调用。
     * 子类在此做清理（解绑按钮、重置状态等）。
     */
    onHide(): void {}

    /**
     * 显示动画：框架在 onShow 之后调用。
     * 默认渐显面板和遮罩，子类覆写可自定义。
     */
    showAnimation(): Promise<void> {
        this.stopAllTweens();

        const promises: Promise<void>[] = [];

        // 面板渐显
        const panelOpacity = this._ensureOpacity(this.node);
        panelOpacity.opacity = 0;
        promises.push(this.trackTween(panelOpacity, 0.25, { opacity: 255 }, 'quadOut'));

        // 遮罩渐显
        if (this.maskNode) {
            const maskOpacity = this._ensureOpacity(this.maskNode);
            maskOpacity.opacity = 0;
            promises.push(this.trackTween(maskOpacity, 0.25, { opacity: 255 }, 'quadOut'));
        }

        return Promise.all(promises).then(() => {});
    }

    /**
     * 隐藏动画：框架在 onHide 之前调用。
     * 默认渐隐面板和遮罩，子类覆写可自定义。
     */
    hideAnimation(): Promise<void> {
        this.stopAllTweens();

        const promises: Promise<void>[] = [];

        // 面板渐隐
        const panelOpacity = this._ensureOpacity(this.node);
        panelOpacity.opacity = 255;
        promises.push(this.trackTween(panelOpacity, 0.2, { opacity: 0 }, 'quadIn'));

        // 遮罩渐隐
        if (this.maskNode) {
            const maskOpacity = this._ensureOpacity(this.maskNode);
            maskOpacity.opacity = 255;
            promises.push(this.trackTween(maskOpacity, 0.2, { opacity: 0 }, 'quadIn'));
        }

        return Promise.all(promises).then(() => {});
    }

    /** 隐藏自己（保留节点，下次 show 可复用） */
    protected close(): void {
        if (this.panelName) Nexus.ui.hide(this.panelName);
    }

    /** 销毁自己（从 UI 管理中移除并销毁节点） */
    protected destroySelf(): void {
        if (this.panelName) Nexus.ui.destroy(this.panelName);
    }

    // ── 动画工具方法 ─────────────────────────────────────

    /** 创建 tween 并自动纳入管理，destroy 时自动清理 */
    protected trackTween<T extends object>(target: T, duration: number, props: object, easing: string = 'linear'): Promise<void> {
        return new Promise<void>(resolve => {
            const tw = tween(target)
                .to(duration, props, { easing: easing as any })
                .call(() => resolve())
                .start();
            this._tweens.push({ tw, resolve });
        });
    }

    /** 停止所有正在播放的 tween，并立即 resolve 被中断的 Promise（防止挂起） */
    protected stopAllTweens(): void {
        for (const { tw, resolve } of this._tweens) {
            tw.stop();
            resolve();
        }
        this._tweens.length = 0;
    }

    protected _ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    /** 组件销毁时自动解绑事件和停止动画 */
    protected onDestroy(): void {
        this.stopAllTweens();
        Nexus.offTarget(this);
    }
}
