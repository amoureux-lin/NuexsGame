import { _decorator, Component, Node, Sprite, SpriteFrame, Label } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { PlayerResult } from '../../../proto/tongits';
import type { SeatSnapshot } from '../player/PlayerSeatManager';

const { ccclass, property } = _decorator;

/**
 * ResultPlayerCard — 结算面板中间列表的玩家卡片
 *
 * 布局由编辑器控制：
 *   - selfCard（第一行，自己）：全宽，较大，不显示昵称
 *   - otherCards[0/1]（第二行）：各占一半宽度，显示昵称
 *
 * 节点结构：
 *   ResultPlayerCard
 *   ├── avatarSprite     头像
 *   ├── nameLabel        昵称（isSelf=true 时隐藏）
 *   ├── winBadge         赢标志（win.png），isWinner=true 时显示
 *   ├── loseBadge        输标志（lose.png），isWinner=false 时显示
 *   ├── tongitsBadge     Tongits 标志（tongits.png），winType=1 且 isWinner=true 时显示
 *   ├── winBonusLabel    赢时金额 Label（+xxx 字体），isWinner=true 时显示
 *   └── loseBonusLabel   输时金额 Label（-xxx 字体），isWinner=false 时显示
 */
@ccclass('ResultPlayerCard')
export class ResultPlayerCard extends Component {

    @property({ type: Sprite, tooltip: '头像 Sprite' })
    avatarSprite: Sprite = null!;

    @property({ type: Label, tooltip: '昵称 Label（自己时隐藏）' })
    nameLabel: Label | null = null;

    @property({ type: Node, tooltip: '赢标志节点（win.png）' })
    winBadge: Node | null = null;

    @property({ type: Node, tooltip: '输标志节点（lose.png）' })
    loseBadge: Node | null = null;

    @property({ type: Node, tooltip: 'Tongits 标志节点（tongits.png），winType=1 且赢家时显示' })
    tongitsBadge: Node | null = null;

    @property({ type: Label, tooltip: '赢时金额 Label（+xxx），isWinner=true 时显示' })
    winBonusLabel: Label | null = null;

    @property({ type: Label, tooltip: '输时金额 Label（-xxx），isWinner=false 时显示' })
    loseBonusLabel: Label | null = null;

    // ── 公开接口 ─────────────────────────────────────────

    /**
     * 填充卡片数据
     * @param snapshot  座位快照（昵称、头像 URL 等）
     * @param result    结算数据
     * @param isWinner  是否为胜者
     * @param winType   胜利类型（1=Tongits 2=挑战 3=时间到），控制 tongitsBadge
     */
    setup(
        snapshot: SeatSnapshot,
        result: PlayerResult | null,
        isWinner: boolean,
        winType: number = 0,
    ): void {
        this.node.active = true;

        // 昵称：自己不显示
        if (this.nameLabel) {
            this.nameLabel.node.active = !snapshot.isSelf;
            if (!snapshot.isSelf) {
                this.nameLabel.string = snapshot.playerInfo.playerInfo?.nickname ?? '';
            }
        }

        // 头像标识：三者互斥
        //   有 Tongits → 只显示 tongitsBadge
        //   赢但无 Tongits → 只显示 winBadge
        //   输 → 只显示 loseBadge
        const isTongits = isWinner && winType === 1;
        if (this.tongitsBadge) this.tongitsBadge.active = isTongits;
        if (this.winBadge)     this.winBadge.active     = isWinner && !isTongits;
        if (this.loseBadge)    this.loseBadge.active    = !isWinner;

        // 输赢金额：赢/输用不同 Label（字体不同）
        if (result) {
            const bonus    = result.sumWinBonus;
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

    /** 清空卡片 */
    clear(): void {
        this.node.active = false;
        if (this.avatarSprite)   this.avatarSprite.spriteFrame = null;
        if (this.nameLabel)      this.nameLabel.string = '';
        if (this.winBadge)       this.winBadge.active     = false;
        if (this.loseBadge)      this.loseBadge.active     = false;
        if (this.tongitsBadge)   this.tongitsBadge.active  = false;
        if (this.winBonusLabel)  this.winBonusLabel.node.active  = false;
        if (this.loseBonusLabel) this.loseBonusLabel.node.active = false;
    }
}
