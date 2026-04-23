import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import type { PlayerResult } from '../../../proto/tongits';

const { ccclass, property } = _decorator;

@ccclass('ResultDetailRow')
export class ResultDetailRow extends Component {

    @property({ type: Label })
    nickName: Label = null!;

    @property({ type: Sprite })
    avatar: Sprite = null!;

    @property({ type: Node })
    tongitsSprite: Node = null!;

    @property({ type: Node })
    winBg: Node = null!;

    @property({ type: Label })
    score: Label = null!;

    @property({ type: Label })
    profit: Label = null!;

    @property({ type: Label })
    normalWin: Label = null!;

    @property({ type: Label })
    tongits: Label = null!;

    @property({ type: Label })
    secretMelds: Label = null!;

    @property({ type: Label })
    speciolCords: Label = null!;

    @property({ type: Label })
    bunredPlayers: Label = null!;

    @property({ type: Label })
    challengers: Label = null!;

    @property({ type: Label })
    hitpot: Label = null!;

    @property({ type: Label })
    variablePayout: Label = null!;

    @property({ type: Label })
    zerohan: Label = null!;

    @property({ type: Label })
    extraBet: Label = null!;

    @property({ type: Node, tooltip: 'winner标' })
    winnerSign: Node = null!;

    // ── 公开接口 ─────────────────────────────────────────

    public init(player: PlayerResult, isWin: boolean): void {
        const baseInfo = player.playerInfo?.playerInfo;
        this._updatePlayerBaseInfo(baseInfo);
        this._updateScoreDetails(player);
        this._updateWinStatus(player, isWin);
    }

    // ── 私有 ─────────────────────────────────────────────

    /** 更新玩家的基础信息部分（头像和昵称） */
    private _updatePlayerBaseInfo(baseInfo: any): void {
        this.nickName.string = baseInfo?.nickname ?? '';
        if (baseInfo?.avatar) {
            Nexus.asset.loadRemote<SpriteFrame>(baseInfo.avatar).then(sf => {
                if (this.isValid && this.avatar) this.avatar.spriteFrame = sf;
            }).catch(() => {});
        }
    }

    /** 更新所有分数相关的文本标签 */
    private _updateScoreDetails(player: PlayerResult): void {
        this._setLabelString(this.normalWin,   player.normalWinBonus);
        this._setLabelString(this.tongits,     player.tongitsWinBonus);
        this._setLabelString(this.secretMelds, player.cardTypeBonus);
        this._setLabelString(this.speciolCords, player.bonusBonus);
        this._setLabelString(this.bunredPlayers, player.burnedBonus);
        this._setLabelString(this.challengers, player.winChallengeBonus);
        this._setLabelString(this.hitpot,      player.potBonus);
        this._setLabelString(this.score,       player.cardPoint);
        this.variablePayout.string = '-';
        this.zerohan.string        = '-';
        this.extraBet.string       = '-';
    }

    /** 根据胜负状态更新 UI（胜利背景、Tongits 图标等） */
    private _updateWinStatus(player: PlayerResult, isWin: boolean): void {
        this.profit.string = player.sumWinBonus?.toString() ?? '0';
        this.profit.color  = isWin ? new Color('#9BFF24') : new Color('#01BAFB');
        this.winBg.active  = isWin;

        this.tongitsSprite.active = false;
        this.winnerSign.active    = false;

        const bIsTongitsWin = player?.tongitsWinBonus !== 0;
        if (bIsTongitsWin) {
            this.tongitsSprite.active = player.tongitsWinBonus > 0;
        } else {
            this.winnerSign.active = isWin;
        }
    }

    /**
     * 安全地设置 Label 的字符串。
     * 如果传入的值有效（非 null/undefined），则显示该值；否则显示默认占位符。
     */
    private _setLabelString(
        label: Label,
        value: number | string | null | undefined,
        placeholder = '-',
    ): void {
        if (label) {
            const isValueValid = value !== null && value !== undefined;
            label.string = isValueValid ? String(value) : placeholder;
        }
    }
}
