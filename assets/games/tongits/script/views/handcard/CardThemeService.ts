/**
 * CardThemeService — 牌面主题管理服务
 *
 * 挂在场景中生命周期覆盖整局游戏的节点（如 GameRoot / Managers）。
 * 通过静态 instance 提供当前图集，CardNode 无需直接引用此组件。
 *
 * 使用方式：
 *   1. 在编辑器中将此组件挂到场景节点
 *   2. atlases[0] 绑第一套图集，atlases[1] 绑第二套图集
 *   3. 调用 CardThemeService.instance?.switchTheme(idx) 切换主题
 *      CardNode 会自动收到 CARD_THEME_CHANGE 事件并刷新显示
 */

import { _decorator, Component, SpriteAtlas } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';

const { ccclass, property } = _decorator;

/** 主题切换事件名 */
export const CARD_THEME_CHANGE = 'card:themeChange';

@ccclass('CardThemeService')
export class CardThemeService extends Component {

    /** 全局单例，onLoad 时设置，onDestroy 时清除 */
    static instance: CardThemeService | null = null;

    @property({
        type: [SpriteAtlas],
        tooltip: '牌面图集列表；index 0 = 主题A，index 1 = 主题B',
    })
    atlases: SpriteAtlas[] = [];

    private _currentIndex = 0;

    // ── 生命周期 ──────────────────────────────────────────

    onLoad(): void {
        CardThemeService.instance = this;
        Nexus.on<{ index: number }>(GameEvents.CMD_SWITCH_CARD_THEME, this._onSwitchEvent, this);
    }

    onDestroy(): void {
        Nexus.off(GameEvents.CMD_SWITCH_CARD_THEME, this._onSwitchEvent, this);
        if (CardThemeService.instance === this) {
            CardThemeService.instance = null;
        }
    }

    private _onSwitchEvent(data: { index: number }): void {
        this.switchTheme(data.index);
    }

    // ── 公开 API ──────────────────────────────────────────

    /** 当前主题序号 */
    get currentIndex(): number {
        return this._currentIndex;
    }

    /** 当前主题图集（null 表示未配置） */
    get currentAtlas(): SpriteAtlas | null {
        return this.atlases[this._currentIndex] ?? null;
    }

    /**
     * 切换到指定主题
     * @param idx  图集序号（0 或 1）
     */
    switchTheme(idx: number): void {
        if (idx === this._currentIndex) return;
        if (idx < 0 || idx >= this.atlases.length) {
            console.warn(`[CardThemeService] 无效的主题序号: ${idx}`);
            return;
        }
        this._currentIndex = idx;
        Nexus.emit(CARD_THEME_CHANGE);
    }
}
