/**
 * RuleView — Tongits 游戏规则面板
 *
 * 顶部 ToggleContainer 切换规则页签，
 * 切换时替换标题图片和内容图片，并滚动到顶部。
 */

import { _decorator, ScrollView, Sprite, SpriteFrame, Toggle, ToggleContainer } from 'cc';
import { UIPanel } from 'db://nexus-framework/base/UIPanel';

const { ccclass, property } = _decorator;

@ccclass('RuleView')
export class RuleView extends UIPanel {

    @property({ type: ScrollView, tooltip: '规则内容滚动视图' })
    scrollView: ScrollView = null!;

    @property({ type: ToggleContainer, tooltip: '页签切换容器' })
    toggleContainer: ToggleContainer = null!;

    @property({ type: Sprite, tooltip: '内容图片' })
    content: Sprite = null!;

    @property({ type: [SpriteFrame], tooltip: '各页签对应的内容图片' })
    contentSpriteFrames: SpriteFrame[] = [];

    onShow(): void {
        // 默认选中第一个页签
        if (this.toggleContainer?.toggleItems?.length > 0) {
            this.toggleContainer.toggleItems[0].isChecked = true;
            this.changeContentSpriteFrames(0);
        }
    }

    /** 页签切换回调（Inspector 中绑定到 ToggleContainer 的 checkEvents） */
    onToggleContainerChanged(toggle: Toggle): void {
        this.scrollView?.stopAutoScroll();
        this.scrollView?.scrollToTop();
        const idx = this._getToggleIndex(toggle);
        if (idx < 0) return;
        this.changeContentSpriteFrames(idx);
    }

    changeContentSpriteFrames(idx:number): void {
        if (this.content && idx < this.contentSpriteFrames.length) {
            this.content.spriteFrame = this.contentSpriteFrames[idx];
        }
    }

    onClickClose(): void {
        this.close();
    }

    private _getToggleIndex(toggle: Toggle): number {
        const items = this.toggleContainer?.toggleItems;
        if (!items) return -1;
        for (let i = 0; i < items.length; i++) {
            if (items[i] === toggle) return i;
        }
        return -1;
    }
}
