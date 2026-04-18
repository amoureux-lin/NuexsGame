/**
 * PotTrophyPanel — 顶部底池奖杯面板
 *
 * 管理游戏顶部两个奖杯图标，并负责从玩家座位飞向顶部的奖杯动画。
 *
 * 节点结构（编辑器中搭建）：
 *   PotTrophyPanel
 *   ├── trophy1Node     第一个奖杯（POT 积累，始终可见）
 *   │   └── winCountLabel  奖杯中间数字（pot.winCount）
 *   └── trophy2Node     第二个奖杯（玩家拿走底池时飞向此处）
 *
 * 使用方式：
 *   1. 游戏开始时调用 setWinCount(pot.winCount) 初始化数字
 *   2. 结算时调用 playTrophyFly(fromWorldPos, toPot2) 播放飞行动画
 */

import { _decorator, Component, Label, Node, Vec3, instantiate } from 'cc';
import { FlyUtil } from '../../utils/FlyUtil';

const { ccclass, property } = _decorator;

@ccclass('PotTrophyPanel')
export class PotTrophyPanel extends Component {

    /** 第一个奖杯节点（POT 积累，始终可见） */
    @property({ type: Node, tooltip: '第一个奖杯节点（POT 积累阶段）' })
    trophy1Node: Node | null = null;

    /** 第二个奖杯节点（玩家连续两局获胜、领取底池时飞向此处） */
    @property({ type: Node, tooltip: '第二个奖杯节点（POT 领取阶段）' })
    trophy2Node: Node | null = null;

    /** Trophy1 中间显示的 winCount 数字 */
    @property({ type: Label, tooltip: 'Trophy1 中间的 winCount 数字 Label' })
    winCountLabel: Label | null = null;

    /**
     * 飞行节点的父容器。
     * 建议挂在 Canvas 根节点下，避免被父节点裁切。
     * 未设置时默认挂在本节点的父节点下。
     */
    @property({ type: Node, tooltip: '飞行节点的父容器（建议为 Canvas 根节点）' })
    flyLayerNode: Node | null = null;

    // ── 生命周期 ──────────────────────────────────────────

    protected onLoad(): void {
        // Trophy2 默认隐藏，连赢领取底池时才显示
        if (this.trophy2Node) this.trophy2Node.active = false;
    }

    // ── 公开 API ──────────────────────────────────────────

    /**
     * 更新顶部 Trophy1 上显示的 winCount 数字。
     * 在游戏开始（GameStartBroadcast）和结算（BeforeResultBroadcast）时调用。
     */
    setWinCount(count: number): void {
        if (this.winCountLabel) this.winCountLabel.string = String(count);
    }

    /**
     * 播放奖杯飞行动画：从 fromWorldPos 飞向 Trophy1（或 Trophy2）。
     *
     * @param fromWorldPos  起点世界坐标（通常是 PlayerSeat.showTrophy() 的返回值）
     * @param toPot2        true = 飞向 Trophy2（连赢领取底池），false = 飞向 Trophy1（普通赢）
     * @param onComplete    动画结束后回调
     */
    playTrophyFly(fromWorldPos: Vec3, toPot2: boolean = false, onComplete?: () => void): void {
        const targetNode = toPot2 ? this.trophy2Node : this.trophy1Node;
        if (!targetNode || !this.trophy1Node) {
            onComplete?.();
            return;
        }

        // 飞向 Trophy2 时先让它可见（作为落点）
        if (toPot2) targetNode.active = true;

        // 以 trophy1Node 为视觉模板克隆飞行节点
        const flyNode = instantiate(this.trophy1Node);
        flyNode.active = true;

        const flyLayer = this.flyLayerNode ?? this.node.parent ?? this.node;
        flyLayer.addChild(flyNode);
        flyNode.setWorldPosition(fromWorldPos);

        const toPos = targetNode.getWorldPosition();

        FlyUtil.fly(flyNode, fromWorldPos, toPos, {
            duration:  0.6,
            arcHeight: 180,
            easing:    'quadOut',
            onComplete: () => {
                if (flyNode.isValid) flyNode.destroy();
                onComplete?.();
            },
        });
    }
}
