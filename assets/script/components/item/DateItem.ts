// 日期项组件
import { _decorator, Component, Label, Sprite, Button, Color } from 'cc';
const { ccclass, property } = _decorator;

/** 日期类型枚举 */
export enum DateType {
    NORMAL = 0,           // 普通日期
    START = 1,            // 开始日期（选中效果1）
    END = 2,              // 结束日期（选中效果1）
    IN_RANGE = 3,         // 范围内的日期（选中效果2）
    START_AND_END = 4,    // 开始和结束是同一天（选中效果1）
    RANGE_START = 5,      // 范围内的日期，行首（选中效果3）
    RANGE_END = 6,        // 范围内的日期，行尾（选中效果4）
    START_WITH_RANGE_START = 7,  // 开始时间 + 行首（效果1 + 效果3）
    END_WITH_RANGE_END = 8,      // 结束时间 + 行尾（效果1 + 效果4）
}

/** 日期项数据 */
export interface DateItemData {
    date: number;           // 日期数字（1-31）
    isCurrentMonth: boolean; // 是否当前月
    isToday: boolean;        // 是否今天
    dateType: DateType;      // 日期类型
    fullDate: Date;          // 完整日期对象
    isTodayHaveData: boolean;
}

@ccclass('DateItem')
export class DateItem extends Component {
    //颜色要更新
    @property({ type: Label, tooltip: "日期文本" })
    dateLabel: Label = null;

    //颜色要更新
    @property({ type: Sprite, tooltip: "背景（选中效果1）" })
    selectedBackground: Sprite = null;

    //颜色要更新
    @property({ type: Sprite, tooltip: "范围背景（选中效果2）" })
    rangeBackground: Sprite = null;

    //颜色要更新
    @property({ type: Sprite, tooltip: "行首背景（选中效果3）" })
    rangeStartBackground: Sprite = null;

    //颜色要更新
    @property({ type: Sprite, tooltip: "行尾背景（选中效果4）" })
    rangeEndBackground: Sprite = null;

    @property({ type: Button, tooltip: "日期按钮" })
    dateButton: Button = null;

    @property({ type: Label, tooltip: "type标签" })
    typeTagLabel: Label = null;

    @property({ type: Label, tooltip: "效果" })
    effectLabel: Label = null;

    private data: DateItemData = null;
    private datePicker: any = null; // 父组件引用
    private canOnlySelectRecent3Months: boolean = false; // 是否只能选择近三个月

    private styles = {
        textColor: new Color(118, 44, 13, 255), // 文字颜色
        selectedBgColor: new Color(221, 116, 68, 223), // 选中背景颜色
        rangeBgColor: new Color(255, 213, 153, 255), // 范围背景颜色
        disabledColor: new Color(150, 150, 150, 200), // 禁用颜色
    }

    onLoad() {
        if (this.dateButton) {
            this.dateButton.node.on(Button.EventType.CLICK, this.onDateClick, this);
        }
    }

    onDestroy() {
        if (this.dateButton && this.dateButton.node) {
            this.dateButton.node.off(Button.EventType.CLICK, this.onDateClick, this);
        }
    }

    /**
     * 设置父组件引用
     */
    setDatePicker(datePicker: any) {
        this.datePicker = datePicker;
    }

    /**
     * 设置是否只能选择近三个月
     */
    setCanOnlySelectRecent3Months(canOnlySelectRecent3Months: boolean) {
        this.canOnlySelectRecent3Months = canOnlySelectRecent3Months;
    }

    /**
     * 更新日期项显示
     */
    updateData(data: DateItemData) {
        // 如果data为null或undefined，直接返回，不处理
        if (!data) {
            console.warn("[DateItem] updateData接收到null或undefined数据");
            return;
        }
        
        this.data = data;
        
        if (this.dateLabel) {
            // 如果日期为0，表示空白占位，不显示文本
            if (data.date === 0 || !data.fullDate) {
                this.dateLabel.string = "";
            } else {
                this.dateLabel.string = String(data.date);
            }
        }

        // 根据日期类型设置样式
        this.updateStyle();
        
        // 更新类型标签
        // this.updateTypeTag();
        
        // 更新效果标签
        // this.updateEffectLabel();
    }

    initStyles(styles: any) {
        console.log("styles:",styles)
        styles && styles.textColor && (this.styles.textColor = styles.textColor);
        styles && styles.selectedBgColor && (this.styles.selectedBgColor = styles.selectedBgColor);
        styles && styles.rangeBgColor && (this.styles.rangeBgColor = styles.rangeBgColor);
        styles && styles.disabledColor && (this.styles.disabledColor = styles.disabledColor);
        //property上有注释：颜色要更新 的都需要设置颜色
        //日期文本颜色
        if(this.dateLabel) {
            console.log("日期文本颜色:",styles.textColor);
            this.dateLabel.color = styles.textColor;
        }
        //选中背景颜色
        if(this.selectedBackground) {
            this.selectedBackground.color = styles.selectedBgColor;
        }
        //范围背景颜色
        if(this.rangeBackground) {
            this.rangeBackground.color = styles.rangeBgColor;
        }
        //行首背景颜色
        if(this.rangeStartBackground) {
            this.rangeStartBackground.color = styles.rangeBgColor;
        }
        //行尾背景颜色
        if(this.rangeEndBackground) {
            this.rangeEndBackground.color = styles.rangeBgColor;
        }
    }

    /**
     * 更新样式
     */
    private updateStyle() {
        if (!this.data) {
            // 如果没有数据，隐藏所有内容但保持节点可见
            this.hideAllContent();
            return;
        }

        // 重置所有样式
        if (this.selectedBackground) {
            this.selectedBackground.node.active = false;
        }
        if (this.rangeBackground) {
            this.rangeBackground.node.active = false;
        }
        if (this.rangeStartBackground) {
            this.rangeStartBackground.node.active = false;
        }
        if (this.rangeEndBackground) {
            this.rangeEndBackground.node.active = false;
        }

        // 空白占位：隐藏所有内容，但保持节点可见（用于Layout布局）
        if (this.data.date === 0 || !this.data.fullDate) {
            this.hideAllContent();
            return;
        }

        // 实际日期：确保所有组件可见
        if (this.dateLabel) {
            this.dateLabel.node.active = true;
            const isFutureDate = this.isFutureDate(this.data.fullDate);
            const isMoreThan3MonthsAgo = this.isMoreThan3MonthsAgo(this.data.fullDate);
            // 未来日期、超过90天、或无数据 → disabledColor，否则 → textColor
            if (isFutureDate || isMoreThan3MonthsAgo || !this.data.isTodayHaveData) {
                this.dateLabel.color = this.styles.disabledColor;
            } else {
                this.dateLabel.color = this.styles.textColor;
            }
        }
        if (this.dateButton) {
            this.dateButton.node.active = true;
            // 检查日期是否超过今天，超过则禁用
            const isFutureDate = this.isFutureDate(this.data.fullDate);
            // 检查日期是否是3个月之前，如果是则禁用
            const isMoreThan3MonthsAgo = this.isMoreThan3MonthsAgo(this.data.fullDate);
            this.dateButton.interactable = !isFutureDate && !isMoreThan3MonthsAgo;
        }

        // 根据日期类型设置背景显隐 + 选中态文字颜色
        const isSelected = this.data.dateType === DateType.START
            || this.data.dateType === DateType.END
            || this.data.dateType === DateType.START_AND_END
            || this.data.dateType === DateType.START_WITH_RANGE_START
            || this.data.dateType === DateType.END_WITH_RANGE_END;

        switch (this.data.dateType) {
            case DateType.START:
            case DateType.END:
            case DateType.START_AND_END:
                // 选中效果1：显示选中背景
                if (this.selectedBackground) {
                    this.selectedBackground.node.active = true;
                }
                break;

            case DateType.START_WITH_RANGE_START:
                // 开始时间 + 行首（效果1 + 效果3）
                if (this.selectedBackground) {
                    this.selectedBackground.node.active = true;
                }
                if (this.rangeStartBackground) {
                    this.rangeStartBackground.node.active = true;
                }
                break;

            case DateType.END_WITH_RANGE_END:
                // 结束时间 + 行尾（效果1 + 效果4）
                if (this.selectedBackground) {
                    this.selectedBackground.node.active = true;
                }
                if (this.rangeEndBackground) {
                    this.rangeEndBackground.node.active = true;
                }
                break;

            case DateType.IN_RANGE:
                // 选中效果2：显示范围背景（普通范围内日期）
                if (this.rangeBackground) {
                    this.rangeBackground.node.active = true;
                }
                break;

            case DateType.RANGE_START:
                // 选中效果3：范围内的日期，行首
                if (this.rangeStartBackground) {
                    this.rangeStartBackground.node.active = true;
                }
                break;

            case DateType.RANGE_END:
                // 选中效果4：范围内的日期，行尾
                if (this.rangeEndBackground) {
                    this.rangeEndBackground.node.active = true;
                }
                break;

            case DateType.NORMAL:
            default:
                break;
        }

        // 选中态（START/END 系列）：文字改为白色，确保在 selectedBgColor 上可读
        if (isSelected && this.dateLabel) {
            this.dateLabel.color = Color.WHITE;
        }
    }

    /**
     * 判断是否是未来日期（超过今天）
     */
    private isFutureDate(date: Date): boolean {
        if (!date) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const compareDate = new Date(date);
        compareDate.setHours(0, 0, 0, 0);
        return compareDate > today;
    }

    /**
     * 判断是否是90天之前的日期
     */
    private isMoreThan3MonthsAgo(date: Date): boolean {
        if (!date) return false;
        if (!this.canOnlySelectRecent3Months) return false;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 计算90天前的日期
        const ninetyDaysAgo = new Date(today);
        ninetyDaysAgo.setDate(today.getDate() - 90);
        
        const compareDate = new Date(date);
        compareDate.setHours(0, 0, 0, 0);
        
        return compareDate < ninetyDaysAgo;
    }

    /**
     * 日期点击事件
     */
    private onDateClick() {
        if (this.datePicker && this.data && this.data.fullDate) {
            // 检查是否是未来日期，如果是则不允许选择
            if (this.isFutureDate(this.data.fullDate)) {
                return;
            }
            // 检查是否是3个月之前的日期，如果是则不允许选择
            if (this.isMoreThan3MonthsAgo(this.data.fullDate)) {
                return;
            }
            this.datePicker.onDateClick(this.data.fullDate);
        }
    }

    /**
     * 隐藏所有内容（用于空白占位）
     */
    private hideAllContent() {
        // 隐藏所有可见组件，但保持节点本身可见（用于Layout布局）
        if (this.dateLabel) {
            this.dateLabel.string = "";
            this.dateLabel.node.active = false;
        }
        if (this.dateButton) {
            this.dateButton.interactable = false;
            this.dateButton.node.active = false;
        }
        if (this.selectedBackground) {
            this.selectedBackground.node.active = false;
        }
        if (this.rangeBackground) {
            this.rangeBackground.node.active = false;
        }
        if (this.rangeStartBackground) {
            this.rangeStartBackground.node.active = false;
        }
        if (this.rangeEndBackground) {
            this.rangeEndBackground.node.active = false;
        }
        // 节点本身保持可见，这样Layout才能正确计算位置
    }

    /**
     * 更新类型标签（显示"第一个"或"最后一个"）
     * 规则：
     * - 周日（行的第一个）→ 显示"第一个"
     * - 周六（行的最后一个）→ 显示"最后一个"
     * - 每个月的第一天，如果不是第一个（不是周日）也不是最后一个（不是周六）→ 显示"第一个"
     * - 每个月的最后一天，如果不是第一个（不是周日）也不是最后一个（不是周六）→ 显示"最后一个"
     */
    private updateTypeTag() {
        if (!this.typeTagLabel) return;
        
        if (!this.data || !this.data.fullDate) {
            // 空白占位：不显示标签
            this.typeTagLabel.string = "";
            this.typeTagLabel.node.active = false;
            return;
        }
        
        // 获取日期是星期几（0=周日，1=周一...6=周六）
        const weekday = this.data.fullDate.getDay();
        const date = this.data.fullDate.getDate();
        
        // 获取当月最后一天
        const year = this.data.fullDate.getFullYear();
        const month = this.data.fullDate.getMonth();
        const lastDay = new Date(year, month + 1, 0);
        const lastDate = lastDay.getDate();
        
        // 判断是否是周日（行的第一个）
        if (weekday === 0) {
            this.typeTagLabel.string = "第一个";
            this.typeTagLabel.node.active = true;
        }
        // 判断是否是周六（行的最后一个）
        else if (weekday === 6) {
            this.typeTagLabel.string = "最后一个";
            this.typeTagLabel.node.active = true;
        }
        // 判断是否是当月1号，且不是周日也不是周六
        else if (date === 1) {
            this.typeTagLabel.string = "第一个";
            this.typeTagLabel.node.active = true;
        }
        // 判断是否是当月最后一天，且不是周日也不是周六
        else if (date === lastDate) {
            this.typeTagLabel.string = "最后一个";
            this.typeTagLabel.node.active = true;
        } else {
            // 其他日期：不显示标签
            this.typeTagLabel.string = "";
            this.typeTagLabel.node.active = false;
        }
    }

    /**
     * 更新效果标签显示
     */
    private updateEffectLabel() {
        if (!this.effectLabel) return;

        let effectText = "";
        
        if (!this.data || !this.data.fullDate) {
            // 空白占位：不显示效果
            this.effectLabel.string = "";
            this.effectLabel.node.active = false;
            return;
        }
        
        switch (this.data.dateType) {
            case DateType.START:
            case DateType.END:
                effectText = "1";  // 效果1
                break;

            case DateType.START_AND_END:
                effectText = "1";  // 效果1（同一天）
                break;

            case DateType.START_WITH_RANGE_START:
                effectText = "1+3";  // 效果1 + 效果3（左半圆）
                break;

            case DateType.END_WITH_RANGE_END:
                effectText = "1+4";  // 效果1 + 效果4（右半圆）
                break;

            case DateType.IN_RANGE:
                effectText = "2";  // 效果2
                break;

            case DateType.RANGE_START:
                effectText = "3";  // 效果3（左半圆）
                break;

            case DateType.RANGE_END:
                effectText = "4";  // 效果4（右半圆）
                break;

            case DateType.NORMAL:
            default:
                effectText = "";  // 无效果
                break;
        }

        this.effectLabel.string = effectText;
        // 如果有效果，显示标签；否则隐藏
        if (this.effectLabel.node) {
            this.effectLabel.node.active = effectText !== "";
        }
    }

    /**
     * 获取日期数据
     */
    getData(): DateItemData {
        return this.data;
    }
}

