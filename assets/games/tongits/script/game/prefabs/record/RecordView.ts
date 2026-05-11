/**
 * RecordView — Tongits 玩家历史记录面板
 *
 * 职责：拉取并以无限滚动方式展示玩家对局历史记录。
 */

import { _decorator, Color, instantiate, Label, Node, Prefab } from 'cc';
import { VirtualViewList } from 'db://assets/script/components/VirtualList';
import { UIPanel } from 'db://nexus-framework/base/UIPanel';
import { Nexus } from 'db://nexus-framework/index';
import { MessageType } from 'db://assets/games/tongits/script/proto/message_type';
import { GetPlayerHistoryRes, TongitsHistoryRecord } from 'db://assets/games/tongits/script/proto/tongits';
import type { TongitsModel } from '../../TongitsModel';
import { RecordItem } from './RecordItem';
import { DatePicker } from 'db://assets/script/components/DatePicker';

const { ccclass, property } = _decorator;

const ITEM_TYPE = 'record';

/** 传给 DatePicker 的配色（与设计稿对齐） */
const DATE_PICKER_STYLES = {
    bgColor:         new Color(255, 255, 255, 255), //背景颜色 #FFFFFF
    textColor:       new Color(16,   70, 145, 255), //文字颜色 rgb(16, 70, 145)
    weekdayColor:    new Color(16,   70, 145, 255), //周几颜色 #104691
    selectedBgColor: new Color(94,  137, 255, 255), //选中背景颜色 #5E89FF
    rangeBgColor:    new Color(225,  235, 255, 255), //// 范围背景颜色 #E1EBFF
    disabledColor: new Color(150, 150, 150, 200), // 禁用颜色
    lineColor: new Color(149, 145, 115, 200) // 分割线颜色
};

/** 由调用方（如 TongitsView）通过 Nexus.ui.show('record', params) 注入的参数。 */
export interface RecordViewParams {
    model: TongitsModel;
}

@ccclass('RecordView')
export class RecordView extends UIPanel {

    @property({ type: VirtualViewList, tooltip: "记录父节点" })
    private recordParentNode: VirtualViewList = null!;

    @property({ type: Prefab, tooltip: "记录预制体" })
    private recordPrefab: Prefab = null!;

    @property({ type:Node,tooltip:"时间选择点击区域" })
    timeNode:Node = null;

    @property({ type: Label, tooltip: "开始时间" })
    private startDateLabel: Label = null;

    @property({ type: Label, tooltip: "结束时间" })
    private endDateLabel: Label = null;

    @property({ type: DatePicker, tooltip: "日期选择面板" })
    datePicker:DatePicker = null;

    private _records: TongitsHistoryRecord[] = [];
    private _page: number = 1;
    private _isLoading: boolean = false;
    private _hasMore: boolean = true;

    private _startTimeMs: number = 0;
    private _endTimeMs: number = 0;

    private _listInited: boolean = false;
    private _timeUIInited: boolean = false;
    private _pickerInited: boolean = false;

    /** 当前选中索引；空列表时为 -1，否则默认 0（第一项） */
    private _selectedIndex: number = -1;

    /** 由打开方注入的 Model 引用，用于读取 myUserId 等运行时数据 */
    private _model: TongitsModel | null = null;

    onShow(params?: RecordViewParams): void {
        this._model = params?.model ?? null;
        this._initTimeRangeToday();
        this._initListOnce();
        this._initTimeUIOnce();
        this._refreshTimeLabels();
        this._reloadFromFirstPage();
    }

    onHide(): void {
        if (this._listInited) this.recordParentNode?.Clear();
        this._records = [];
        this._isLoading = false;
        this._hasMore = true;
        this._model = null;
        if (this.datePicker) this.datePicker.node.active = false;
    }

    onClickClose(): void {
        this.close();
    }

    // ── 数据 / 网络 ──────────────────────────────────────

    /** 默认拉取范围：今日 0:00 ~ 23:59:59.999 */
    private _initTimeRangeToday(): void {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        this._startTimeMs = start.getTime();
        this._endTimeMs = end.getTime();
    }

    private _reloadFromFirstPage(): void {
        this._page = 1;
        this._records = [];
        this._hasMore = true;
        this._isLoading = false;
        this._selectedIndex = -1;
        this.recordParentNode.Clear();
        void this._loadCurrentPage();
    }

    private async _loadCurrentPage(): Promise<void> {
        if (this._isLoading || !this._hasMore) return;
        this._isLoading = true;
        try {
            const res = await Nexus.net.wsRequest<GetPlayerHistoryRes>(
                MessageType.TONGITS_GET_PLAYER_HISTORY_REQ,
                {
                    page: this._page,
                    // 服务端约定：startTime / endTime 为 Unix 秒
                    startTime: Math.floor(this._startTimeMs / 1000),
                    endTime:   Math.floor(this._endTimeMs / 1000),
                },
            );
            this._applyPageRecords(res?.records ?? []);
        } catch (e) {
            console.warn('[RecordView] 拉取历史记录失败:', e);
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * 把一页结果合并进列表。
     * - 空响应 → 标记没更多；首页空时渲染空态
     * - 首页有数据 → ReloadData 一次性铺满
     * - 后续页 → InsertItemAt 追加，不重建已有节点，不重置滚动位置
     */
    private _applyPageRecords(newRecords: TongitsHistoryRecord[]): void {
        const oldLen = this._records.length;

        if (newRecords.length === 0) {
            this._hasMore = false;
            if (oldLen === 0) {
                this.recordParentNode.ReloadData([]);
            }
            return;
        }

        this._records = oldLen === 0 ? newRecords : this._records.concat(newRecords);

        if (oldLen === 0) {
            // 首页：默认选中第一项
            this._selectedIndex = 0;
            const types = this._records.map(() => ITEM_TYPE);
            this.recordParentNode.ReloadData(types);
        } else {
            for (let i = oldLen; i < this._records.length; i++) {
                this.recordParentNode.InsertItemAt(i, ITEM_TYPE, false);
            }
        }
    }

    // ── 虚拟列表 ────────────────────────────────────────

    private _initListOnce(): void {
        if (this._listInited) return;
        if (!this.recordParentNode || !this.recordPrefab) {
            console.error('[RecordView] recordParentNode / recordPrefab 未配置');
            return;
        }
        this.recordParentNode.scrollViewInit();
        this.recordParentNode.RegisterTemplate(ITEM_TYPE, instantiate(this.recordPrefab), true);
        this.recordParentNode.SetCallbacks({
            onItemInit:   (node, idx) => this._fillItem(node, idx),
            onItemUpdate: (node, idx) => this._fillItem(node, idx),
            onScrolling:  (ratio)     => this._onScrolling(ratio),
        });
        this._listInited = true;
    }

    private _onScrolling(ratio: number): void {
        if (this._isLoading || !this._hasMore) return;
        if (this._records.length === 0) return;
        if (ratio >= 1) {
            this._page++;
            void this._loadCurrentPage();
        }
    }

    private _fillItem(node: Node, index: number): void {
        const record = this._records[index];
        if (!record) return;
        const isSelected = index === this._selectedIndex;
        const selfId = this._model?.myUserId ?? 0;
        node.getComponent(RecordItem)?.setData(record, index, isSelected, this._onItemClick, selfId);
    }

    /**
     * 点击切换选中项：仅刷新旧/新两个可见节点，未在视口的项依靠 _fillItem 在复用时自动取最新选中态。
     */
    private _onItemClick = (index: number): void => {
        if (index === this._selectedIndex) return;
        const oldIndex = this._selectedIndex;
        this._selectedIndex = index;

        if (oldIndex >= 0) {
            this.recordParentNode.GetItemNode(oldIndex)?.getComponent(RecordItem)?.setSelected(false);
        }
        this.recordParentNode.GetItemNode(index)?.getComponent(RecordItem)?.setSelected(true);
    };

    // ── 时间选择 UI ─────────────────────────────────────

    /** 初始绑定 timeNode 点击 + 隐藏 picker，仅一次 */
    private _initTimeUIOnce(): void {
        if (this._timeUIInited) return;
        if (this.timeNode) {
            this.timeNode.on(Node.EventType.TOUCH_END, this._onClickTime, this);
        }
        if (this.datePicker) {
            this.datePicker.node.active = false;
        }
        this._timeUIInited = true;
    }

    /** 点击 timeNode：切换 picker 显隐；首次显示时初始化，后续显示时同步选中范围 */
    private _onClickTime = (): void => {
        if (!this.datePicker) return;
        const willShow = !this.datePicker.node.active;
        this.datePicker.node.active = willShow;
        if (!willShow) return;

        if (!this._pickerInited) {
            this.datePicker.onAdded({
                showTimeConfig: { startTime: this._startTimeMs, endTime: this._endTimeMs },
                styles: DATE_PICKER_STYLES,
                onSelectionChange: this._onPickerSelected,
            });
            this._pickerInited = true;
        } else {
            this.datePicker.setSelectedRange(new Date(this._startTimeMs), new Date(this._endTimeMs));
        }
    };

    /** DatePicker 选完范围后：更新时间戳 → 刷新 Label → 隐藏 picker → 重新拉第一页 */
    private _onPickerSelected = (start: number | null, end: number | null): void => {
        if (!start || !end) return;
        this._startTimeMs = start;
        this._endTimeMs = end;
        this._refreshTimeLabels();
        if (this.datePicker) this.datePicker.node.active = false;
        this._reloadFromFirstPage();
    };

    /** 刷新顶部开始/结束时间 Label */
    private _refreshTimeLabels(): void {
        if (this.startDateLabel) this.startDateLabel.string = this._formatLabelDate(this._startTimeMs);
        if (this.endDateLabel)   this.endDateLabel.string   = this._formatLabelDate(this._endTimeMs);
    }

    private _formatLabelDate(ms: number): string {
        const d = new Date(ms);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
    }
}
