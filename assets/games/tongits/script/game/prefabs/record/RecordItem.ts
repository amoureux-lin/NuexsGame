import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { TongitsHistoryRecord } from '../../../proto/tongits';
const { ccclass, property } = _decorator;

export type RecordItemClickCallback = (index: number) => void;

const COLOR_WIN  = new Color(46, 178, 67, 255);
const COLOR_LOSE = new Color(214, 48, 48, 255);

/** endTime(秒) → MM/DD/YYYY HH:mm:ss */
function formatRecordTime(endTimeSec: number): string {
    const d = new Date(endTimeSec * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

@ccclass('RecordItem')
export class RecordItem extends Component {

    @property({ type: Sprite, tooltip: "背景 Sprite" })
    private bgSprite: Sprite = null!;

    @property({ type: SpriteFrame, tooltip: "未选中背景" })
    private normalBg: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: "选中背景" })
    private selectedBg: SpriteFrame = null!;

    @property({type: Label, tooltip: "cost"})
    cost: Label = null;
    @property({type: Label, tooltip: "time"})
    time: Label = null;
    @property({type: Label, tooltip: "reward"})
    reward: Label = null;

    private _index: number = -1;
    private _onClick: RecordItemClickCallback | null = null;

    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this._onTap, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this._onTap, this);
    }

    setData(record: TongitsHistoryRecord, index: number, isSelected: boolean, onClick: RecordItemClickCallback, selfId: number) {
        this._index = index;
        this._onClick = onClick;
        this.setSelected(isSelected);
        this._renderContent(record, selfId);
    }

    private _renderContent(record: TongitsHistoryRecord, selfId: number) {
        const self = record.players?.find(v => v.userId === selfId);
        
        if (!self) return;

        // cost：自己的扣费（千分位）
        if (this.cost) {
            this.cost.string = Number(self.cost).toLocaleString();
        }

        // reward：净收益 = totalReward - cost；正数加 "+" 前缀
        const addCoins = (self.totalReward ?? 0) - (self.cost ?? 0);
        if (this.reward) {
            this.reward.string = addCoins > 0 ? `+${addCoins.toLocaleString()}` : addCoins.toLocaleString();
            this.reward.color = addCoins < 0 ? COLOR_LOSE : COLOR_WIN;
        }

        // time：endTime(秒) → MM/DD/YYYY HH:mm:ss
        if (this.time) {
            this.time.string = formatRecordTime(Number(self.endTime));
        }
    }

    setSelected(isSelected: boolean) {
        if (!this.bgSprite) return;
        const sf = isSelected ? this.selectedBg : this.normalBg;
        if (sf) this.bgSprite.spriteFrame = sf;
    }

    private _onTap() {
        this._onClick?.(this._index);
    }
}
