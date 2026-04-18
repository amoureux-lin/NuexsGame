import { _decorator, Component, Node, Sprite, SpriteFrame, Label } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { PlayerResult } from '../../proto/tongits';
import type { SeatSnapshot } from '../player/PlayerSeatManager';

const { ccclass, property } = _decorator;

/**
 * PlayerResultItem — 结算时贴近座位头像显示的浮层
 *
 * 定位：由 TongitsResultPanel 在 show() 时将节点移到对应座位头像世界坐标
 *
 * 节点结构：
 *   PlayerResultItem
 *   ├── avatarSprite       头像
 *   ├── hostIcon           房主标志
 *   ├── meIcon             自己标志
 *   ├── winBonusLabel      赢时金额 Label（+xxx，赢时显示）
 *   ├── loseBonusLabel     输时金额 Label（-xxx，输时显示）
 *   └── messageBubble      消息气泡容器（默认隐藏）
 *       ├── winBubbleBg    赢时气泡背景（isWinner=true 时显示）
 *       ├── loseBubbleBg   输时气泡背景（isWinner=false 时显示）
 *       └── messageLabel   消息文本
 */
@ccclass('PlayerResultItem')
export class PlayerResultItem extends Component {

    @property({ type: Sprite, tooltip: '头像 Sprite' })
    avatarSprite: Sprite = null!;

    @property({ type: Node, tooltip: '房主标志节点' })
    hostIcon: Node | null = null;

    @property({ type: Node, tooltip: '自己标志节点' })
    meIcon: Node | null = null;

    @property({ type: Label, tooltip: '赢时金额 Label（+xxx），isWinner=true 时显示' })
    winBonusLabel: Label | null = null;

    @property({ type: Label, tooltip: '输时金额 Label（-xxx），isWinner=false 时显示' })
    loseBonusLabel: Label | null = null;

    @property({ type: Node, tooltip: '消息气泡容器节点（默认隐藏）' })
    messageBubble: Node | null = null;

    @property({ type: Node, tooltip: '气泡赢时背景（isWinner=true 时显示）' })
    winBubbleBg: Node | null = null;

    @property({ type: Node, tooltip: '气泡输时背景（isWinner=false 时显示）' })
    loseBubbleBg: Node | null = null;

    @property({ type: Label, tooltip: '消息气泡内的文本 Label' })
    messageLabel: Label | null = null;

    // ── 私有状态 ─────────────────────────────────────────

    private _isWinner: boolean = false;

    // ── 公开接口 ─────────────────────────────────────────

    /**
     * 填充座位浮层数据
     * @param snapshot  座位快照
     * @param result    结算数据（可为 null）
     * @param isWinner  是否为胜者
     */
    setup(snapshot: SeatSnapshot, result: PlayerResult | null, isWinner: boolean): void {
        this.node.active = true;
        this._isWinner = isWinner;

        // 房主 / 自己标志
        const post = snapshot.playerInfo.playerInfo?.post ?? 0;
        if (this.hostIcon) this.hostIcon.active = post === 1;
        if (this.meIcon)   this.meIcon.active   = snapshot.isSelf;

        // 输赢金额：赢/输用不同 Label
        if (result) {
            const bonus  = result.sumWinBonus;
            const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;

            if (this.winBonusLabel) {
                this.winBonusLabel.string      = bonusStr;
                this.winBonusLabel.node.active = isWinner;
            }
            if (this.loseBonusLabel) {
                this.loseBonusLabel.string      = bonusStr;
                this.loseBonusLabel.node.active = !isWinner;
            }
        } else {
            if (this.winBonusLabel)  this.winBonusLabel.node.active  = false;
            if (this.loseBonusLabel) this.loseBonusLabel.node.active = false;
        }

        // 气泡默认隐藏
        if (this.messageBubble) this.messageBubble.active = false;

        // 头像远程加载
        const url = snapshot.playerInfo.playerInfo?.avatar ?? '';
        if (url && this.avatarSprite) {
            Nexus.asset.loadRemote<SpriteFrame>(url).then(sf => {
                if (this.isValid && this.avatarSprite) {
                    this.avatarSprite.spriteFrame = sf;
                }
            }).catch(() => {});
        }
    }

    /**
     * 在头像上方显示消息气泡，3s 后自动隐藏。
     * 气泡背景根据 setup() 时的 isWinner 自动切换。
     * @param text 消息内容
     */
    showMessage(text: string): void {
        if (!this.messageBubble) return;
        if (this.messageLabel)  this.messageLabel.string = text;
        if (this.winBubbleBg)   this.winBubbleBg.active  = this._isWinner;
        if (this.loseBubbleBg)  this.loseBubbleBg.active = !this._isWinner;
        this.messageBubble.active = true;
        this.unschedule(this._hideBubble);
        this.scheduleOnce(this._hideBubble, 3);
    }

    /** 清空并隐藏浮层 */
    clear(): void {
        this.node.active = false;
        if (this.avatarSprite)   this.avatarSprite.spriteFrame = null;
        if (this.winBonusLabel)  this.winBonusLabel.node.active  = false;
        if (this.loseBonusLabel) this.loseBonusLabel.node.active = false;
        if (this.hostIcon)       this.hostIcon.active = false;
        if (this.meIcon)         this.meIcon.active   = false;
        if (this.messageBubble)  this.messageBubble.active = false;
    }

    // ── 私有 ─────────────────────────────────────────────

    private _hideBubble(): void {
        if (this.messageBubble) this.messageBubble.active = false;
    }
}
