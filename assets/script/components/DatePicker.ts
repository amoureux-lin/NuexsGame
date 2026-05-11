// 日期选择器
import { _decorator, Component, Label, Node, Button, Layout, CCBoolean, Color, SpriteFrame, Sprite, NodePool, instantiate } from 'cc';
import { DateItem, DateItemData, DateType } from './item/DateItem';

const {ccclass, property} = _decorator;

/** 选择状态 */
interface SelectionState {
    startDate: Date | null;  // 开始日期
    endDate: Date | null;     // 结束日期
    isSelecting: boolean;     // 是否正在选择（true=已选开始，等待结束）
}

@ccclass('DatePicker')
export class DatePicker extends Component {
    //颜色要更新
    @property({type: Label, tooltip: "当前年月"})
    private currYearMonthLabel: Label = null;
    //颜色要更新
    @property({type: Button, tooltip: "上一月按钮"})
    private prevMonthBtn: Button = null;
    //颜色要更新
    @property({type: Button, tooltip: "下一月按钮"})
    private nextMonthBtn: Button = null;
    //颜色要更新
    @property({type: Node, tooltip: "周几容器（7个Label）"})
    private weekdaysContainer: Node = null;

    @property({type: Node, tooltip: "日期网格容器（需要Layout组件，Grid类型，7列）"})
    private datesContainer: Node = null;

    @property({type: Node, tooltip: "日期项预制体"})
    private dateItem: Node = null;

    @property({ tooltip: "是否只能选择近90天"})
    private canOnlySelectRecent3Months: boolean = false;


    //样式要更新
    @property({type: Sprite, tooltip: "背景"})
    backgroundSprite: Sprite = null;
    //颜色要更新
    @property({type: Label, tooltip: "title标签"})
    private titleLabel: Label = null;
    //颜色要更新
    @property({type: Sprite, tooltip: "close按钮"})
    private closeBtnSprite: Sprite = null;
    //颜色要更新
    @property({type: Sprite, tooltip: "分割线"})
    private lineSprite: Sprite = null;

    // 当前显示的年月
    private currentYear: number = 2025;
    private currentMonth: number = 0; // 0-11
    private showTimeConfig: { startTime: number, endTime: number } = null;

    // 选择状态
    private selectionState: SelectionState = {
        startDate: null,
        endDate: null,
        isSelecting: false
    };

    // 日期项数组
    private dateItems: DateItem[] = [];

    // 对象池
    private dateItemPool: NodePool = null;

    // 周几数组（周日开头）
    private readonly WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // 回调函数（返回时间戳，单位：毫秒）
    private onSelectionChange: (startDate: number | null, endDate: number | null) => void = null;

    private styles = {
        bgColor: new Color(255, 233, 191, 255), // 背景颜色
        textColor: new Color(118, 44, 13, 255), // 文字颜色
        weekdayColor: new Color(94, 30, 0, 255), // 周几颜色
        selectedBgColor: new Color(221, 116, 68, 223), // 选中背景颜色
        rangeBgColor: new Color(255, 213, 153, 255), // 范围背景颜色
        disabledColor: new Color(150, 150, 150, 200), // 禁用颜色
        lineColor: new Color(149, 145, 115, 200) // 分割线颜色
    };

    private historySummaryList: number[] = [];

    onLoad() {

    }

    onAdded(params: any) {
        console.log('DatePicker onAdded', params);
        if (params && params.onSelectionChange) {
            this.setSelectionCallback(params.onSelectionChange);
        }

        params && params.styles && params.styles.bgColor && (this.styles.bgColor = params.styles.bgColor);  // 背景颜色         
        params && params.styles && params.styles.textColor && (this.styles.textColor = params.styles.textColor);  // 文字颜色
        params && params.styles && params.styles.weekdayColor && (this.styles.weekdayColor = params.styles.weekdayColor);  // 周几颜色
        params && params.styles && params.styles.selectedBgColor && (this.styles.selectedBgColor = params.styles.selectedBgColor);  // 选中背景颜色
        params && params.styles && params.styles.rangeBgColor && (this.styles.rangeBgColor = params.styles.rangeBgColor);  // 范围背景颜色
        params && params.styles && params.styles.disabledColor && (this.styles.disabledColor = params.styles.disabledColor);  // 禁用颜色
        params && params.styles && params.styles.lineColor && (this.styles.lineColor = params.styles.lineColor);  // 禁用颜色
        if (params?.historySummary) {
            this.historySummaryList = params.historySummary;
        }


        // //测试样式-------------------------start
        // this.styles.bgColor = new Color(230, 240, 255, 255);
        // this.styles.textColor = new Color(30, 60, 120, 255);
        // this.styles.weekdayColor = new Color(80, 120, 180, 255);
        // this.styles.selectedBgColor = new Color(70, 130, 255, 255);
        // this.styles.rangeBgColor = new Color(200, 220, 255, 255);
        // this.styles.disabledColor = new Color(200, 200, 200, 200);
        // this.styles.lineColor = new Color(149, 145, 115, 200);
        // //-------------------------end

        this.initStyles();

        // 初始化对象池
        this.dateItemPool = new NodePool();
        this.putPoolNode(this.dateItem);
        // 绑定按钮事件
        if (this.prevMonthBtn) {
            this.prevMonthBtn.node.on(Button.EventType.CLICK, this.prevMonth, this);
        }
        if (this.nextMonthBtn) {
            this.nextMonthBtn.node.on(Button.EventType.CLICK, this.nextMonth, this);
        }
        // 初始化周几标签
        this.initWeekdays();
        this.init();

        if (params?.showTimeConfig?.startTime && params?.showTimeConfig?.endTime) {
            this.showTimeConfig = params.showTimeConfig;
            this.setSelectedRange(new Date(this.showTimeConfig.startTime), new Date(this.showTimeConfig.endTime));
        }
        else {
            let finalEndDate = new Date();
            finalEndDate.setHours(0, 0, 0, 0);
            this.setSelectedRange(finalEndDate, finalEndDate);
        }

    }

    /**
     * 初始化样式
     * @param styles
     */
    private initStyles() {
        //property上有注释：颜色要更新 的都需要设置颜色
        //背景颜色
        if (this.backgroundSprite) {
            this.backgroundSprite.color = this.styles.bgColor;
        }
        //title标签颜色
        if (this.titleLabel) {
            this.titleLabel.color = this.styles.textColor;
        }
        //close按钮颜色
        if (this.closeBtnSprite) {
            this.closeBtnSprite.color = this.styles.textColor;
        }
        //prevMonth按钮颜色
        if (this.prevMonthBtn) {
            this.prevMonthBtn.node.getComponentInChildren(Sprite).color = this.styles.textColor;
        }
        //nextMonth按钮颜色
        if (this.nextMonthBtn) {
            this.nextMonthBtn.node.getComponentInChildren(Sprite).color = this.styles.textColor;
        }
        //周几标签颜色
        if (this.weekdaysContainer) {
            this.weekdaysContainer.getComponentsInChildren(Label).forEach(label => {
                label.color = this.styles.weekdayColor;
            });
        }
        //当前年月标签颜色
        if (this.currYearMonthLabel) {
            this.currYearMonthLabel.color = this.styles.textColor;
        }
        //分割线颜色
        if (this.lineSprite) {
            this.lineSprite.color = this.styles.lineColor;
        }
    }

    onDestroy() {
        // 清理事件（需要检查节点是否有效）
        if (this.prevMonthBtn && this.prevMonthBtn.node && this.prevMonthBtn.node.isValid) {
            this.prevMonthBtn.node.off(Button.EventType.CLICK, this.prevMonth, this);
        }
        if (this.nextMonthBtn && this.nextMonthBtn.node && this.nextMonthBtn.node.isValid) {
            this.nextMonthBtn.node.off(Button.EventType.CLICK, this.nextMonth, this);
        }

        // 回收所有日期项到对象池
        this.recycleAllDateItems();

        // 清理对象池
        if (this.dateItemPool) {
            this.dateItemPool.clear();
        }
    }

    /**
     * 初始化
     */
    public init() {
        const today = new Date();
        this.currentYear = today.getFullYear();
        this.currentMonth = today.getMonth();
        this.updateCalendar();
        // 初始化时更新月份按钮状态
        this.updateMonthButtons();
    }

    /**
     * 初始化周几标签
     */
    private initWeekdays() {
        if (!this.weekdaysContainer) return;

        const weekdayLabels = this.weekdaysContainer.getComponentsInChildren(Label);
        for (let i = 0; i < this.WEEKDAYS.length && i < weekdayLabels.length; i++) {
            weekdayLabels[i].string = this.WEEKDAYS[i];
        }
    }

    isHaveAnyDataToday(year: number, month: number, day: number) {
        // 未提供摘要数据时，默认所有日期正常显示
        if (!this.historySummaryList?.length) {
            return true;
        }

        const nowMonth = month + 1;
        if (day) {
            const target = year * 10000 + nowMonth * 100 + day;
            return this.historySummaryList.includes(target);
        }

        return false;
    }

    /**
     * 创建日期项（只显示当前月的日期）
     * 根据当前月份动态创建日期项，不需要前后补的日期
     * 例如：1号是星期六，那么第一行只有星期六这一格显示1号
     */
    private createDateItems() {
        if (!this.datesContainer || !this.dateItem) {
            console.error("[DatePicker] datesContainer 或 dateItem 未设置");
            return;
        }

        // 确保容器有Layout组件
        let layout = this.datesContainer.getComponent(Layout);
        if (!layout) {
            console.warn("[DatePicker] datesContainer 没有Layout组件，将自动添加");
            layout = this.datesContainer.addComponent(Layout);
            layout.type = Layout.Type.GRID;
            layout.startAxis = Layout.AxisDirection.HORIZONTAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
        }

        // 先回收所有现有节点
        this.recycleAllDateItems();

        // 计算当前月的日期数据
        const dates = this.getMonthDates(this.currentYear, this.currentMonth);

        // 调试信息：打印日期数组结构
        const blankCount = dates.filter(d => d === null).length;
        const dateCount = dates.filter(d => d !== null).length;

        // 清空日期项数组
        this.dateItems = [];

        // 动态创建日期项（只创建当前月的日期 + 前面的空白占位）
        for (let i = 0; i < dates.length; i++) {
            const dateData = dates[i];

            // 如果是空白占位，仍然创建节点但设置为不可见和不可交互
            // 这样Layout组件才能正确布局（保持7列网格）
            let dateItemNode = this.getPoolNode();

            // 池空时从模板实例化兜底（避免依赖编辑器在 datesContainer 预放足够子节点）
            if (!dateItemNode) {
                if (!this.dateItem) {
                    console.error(`[DatePicker] dateItem 模板未配置，索引=${i}`);
                    continue;
                }
                dateItemNode = instantiate(this.dateItem);
            }

            // 设置父节点（必须在设置数据之前设置父节点）
            dateItemNode.setParent(this.datesContainer);

            // 所有节点都保持可见（包括空白占位），这样Layout才能正确布局
            // 空白占位通过DateItem组件内部处理（隐藏内容）
            dateItemNode.active = true;

            const dateItem = dateItemNode.getComponent(DateItem);
            if (dateItem) {
                dateItem.initStyles(this.styles);
                dateItem.setDatePicker(this);
                this.dateItems.push(dateItem);

                // 更新日期数据
                if (dateData) {
                    // 实际日期：判断日期类型并更新
                    // 传入索引位置，用于判断行首/行尾（index % 7 === 0 是行首，index % 7 === 6 是行尾）
                    const dateType = this.getDateType(
                        dateData.fullDate,
                        this.selectionState.startDate,
                        this.selectionState.endDate,
                        i  // 传入索引位置（包含空白占位）
                    );
                    dateData.dateType = dateType;
                    // 传递限制选项给DateItem
                    dateItem.setCanOnlySelectRecent3Months(this.canOnlySelectRecent3Months);
                    dateItem.updateData(dateData);
                }
                else {
                    // 空白占位：设置为空白状态
                    // 注意：fullDate设置为null，date设置为0，这样updateStyle会识别为空白占位
                    dateItem.updateData({
                        date: 0,
                        isCurrentMonth: false,
                        isToday: false,
                        dateType: DateType.NORMAL,
                        fullDate: null as any,
                        isTodayHaveData: true
                    });
                }
            }
            else {
                console.warn(`[DatePicker] 日期项节点缺少 DateItem 组件: ${i}`);
            }
        }

        // 强制更新Layout布局
        if (layout) {
            layout.updateLayout();
        }
    }

    /**
     * 更新日历显示
     */
    private updateCalendar() {
        // 1. 更新年月标签
        this.updateYearMonthLabel();

        // 2. 重新创建日期项（因为每个月天数不同，需要动态创建）
        this.createDateItems();

        // 3. 更新月份按钮状态
        this.updateMonthButtons();
    }

    /**
     * 更新年月标签
     */
    private updateYearMonthLabel() {
        if (this.currYearMonthLabel) {
            // 格式：2024年1月
            this.currYearMonthLabel.string = `${this.currentYear}/${this.currentMonth + 1}`;
        }
    }

    /**
     * 获取某个月的所有日期（只显示当前月的日期）
     * 返回数组：前面是空白占位（null），后面是当前月的日期
     * 例如：1号是星期六，返回 [null, null, null, null, null, null, 1, 2, 3, ...]
     */
    private getMonthDates(year: number, month: number): (DateItemData | null)[] {
        const dates: (DateItemData | null)[] = [];

        // 获取当月第一天
        const firstDay = new Date(year, month, 1);
        // 获取当月最后一天
        const lastDay = new Date(year, month + 1, 0);

        // 获取当月第一天是周几（0=周日，1=周一...）
        const firstDayWeekday = firstDay.getDay();

        // 添加前面的空白占位（从周日到1号前一天）
        for (let i = 0; i < firstDayWeekday; i++) {
            dates.push(null); // 空白占位
        }

        // 添加当月的日期
        const currentMonthDays = lastDay.getDate();
        for (let i = 1; i <= currentMonthDays; i++) {
            const date = new Date(year, month, i);
            dates.push({
                date: i,
                isCurrentMonth: true,
                isToday: this.isToday(date),
                dateType: DateType.NORMAL,
                fullDate: date,
                isTodayHaveData: this.isHaveAnyDataToday(this.currentYear, this.currentMonth, i)
            });
        }

        return dates;
    }

    /**
     * 判断是否是今天
     */
    private isToday(date: Date): boolean {
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    }

    /**
     * 日期点击处理（方案B：固定顺序）
     */
    onDateClick(date: Date) {
        const {startDate, endDate} = this.selectionState;

        // 创建标准化的日期对象（用于比较，只比较年月日）
        const normalizedDate = new Date(date);
        normalizedDate.setHours(0, 0, 0, 0);

        // 如果还没有选择开始时间
        if (!startDate) {
            // 开始时间设置为当天的 0点0分0秒
            const startDateTime = new Date(date);
            startDateTime.setHours(0, 0, 0, 0);
            this.selectionState.startDate = startDateTime;
            this.selectionState.isSelecting = true;
            this.updateCalendar();
            return;
        }

        // 如果已经选择了开始时间，但没有结束时间
        if (!endDate) {
            // 确保开始日期的时间部分也是 00:00:00（用于比较）
            const normalizedStartDate = new Date(this.selectionState.startDate);
            normalizedStartDate.setHours(0, 0, 0, 0);

            let finalStartDate: Date;
            let finalEndDate: Date;

            // 方案B：如果第二次点击的日期早于开始时间，则自动交换
            if (normalizedDate < normalizedStartDate) {
                // 开始时间设置为点击日期的 0点0分0秒
                finalStartDate = new Date(date);
                finalStartDate.setHours(0, 0, 0, 0);
                // 结束时间设置为原开始日期的 23点59分59秒
                finalEndDate = new Date(this.selectionState.startDate);
                finalEndDate.setHours(23, 59, 59, 999);
            }
            else {
                // 开始时间保持不变（已经是 0点0分0秒）
                finalStartDate = this.selectionState.startDate;
                // 结束时间设置为点击日期的 23点59分59秒
                finalEndDate = new Date(date);
                finalEndDate.setHours(23, 59, 59, 999);
            }

            this.selectionState.startDate = finalStartDate;
            this.selectionState.endDate = finalEndDate;
            this.selectionState.isSelecting = false;
            this.updateCalendar();

            // 延迟执行回调和关闭，让用户看到选中的区间
            this.scheduleOnce(() => {
                if (this.onSelectionChange) {
                    const startTimestamp = this.selectionState.startDate ? this.selectionState.startDate.getTime() : null;
                    const endTimestamp = this.selectionState.endDate ? this.selectionState.endDate.getTime() : null;
                    this.onSelectionChange(startTimestamp, endTimestamp);
                }
                this.onClickClose();
            }, 0.4);
            return;
        }

        // 如果已经选择了开始和结束，重新开始选择
        this.selectionState.startDate = null;
        this.selectionState.endDate = null;
        this.selectionState.isSelecting = true;
        this.updateCalendar();
    }

    /**
     * 判断当前显示的年月是否是未来月份
     */
    private isFutureMonth(): boolean {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        // 如果年份大于当前年份，则是未来月份
        if (this.currentYear > currentYear) {
            return true;
        }
        // 如果年份等于当前年份，但月份大于当前月份，则是未来月份
        if (this.currentYear === currentYear && this.currentMonth > currentMonth) {
            return true;
        }
        return false;
    }

    /**
     * 切换到上一个月
     */
    public prevMonth() {
        // 如果限制了只能选择近90天，检查切换到上一个月后是否超出限制
        if (this.canOnlySelectRecent3Months) {
            let prevMonth: number;
            let prevYear: number;

            prevMonth = this.currentMonth - 1;
            if (prevMonth < 0) {
                prevMonth = 11;
            }
            prevYear = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // 计算90天前的日期
            const ninetyDaysAgo = new Date(today);
            ninetyDaysAgo.setDate(today.getDate() - 90);

            // 获取上一个月的最后一天（而不是第一天）
            // 如果上一个月的最后一天早于90天前，说明整个上一个月都在90天范围外，不允许切换
            const prevMonthLastDay = new Date(prevYear, prevMonth + 1, 0); // 获取上一个月的最后一天
            prevMonthLastDay.setHours(0, 0, 0, 0);

            // 如果上一个月的最后一天早于90天前，则不允许切换
            if (prevMonthLastDay < ninetyDaysAgo) {
                return;
            }
        }

        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.updateCalendar();
        this.updateMonthButtons();
    }

    /**
     * 切换到下一个月
     */
    public nextMonth() {
        // 检查切换到下一个月后是否是未来月份
        const nextMonth = this.currentMonth + 1 > 11 ? 0 : this.currentMonth + 1;
        const nextYear = this.currentMonth === 11 ? this.currentYear + 1 : this.currentYear;

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        // 如果下一个月是未来月份，则不允许切换
        if (nextYear > currentYear || (nextYear === currentYear && nextMonth > currentMonth)) {
            return;
        }

        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.updateCalendar();
        this.updateMonthButtons();
    }

    /**
     * 更新月份按钮状态
     */
    private updateMonthButtons() {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        // 检查下一个月是否是未来月份
        const nextMonth = this.currentMonth + 1 > 11 ? 0 : this.currentMonth + 1;
        const nextYear = this.currentMonth === 11 ? this.currentYear + 1 : this.currentYear;
        const isNextMonthFuture = nextYear > currentYear || (nextYear === currentYear && nextMonth > currentMonth);

        // 禁用/启用"下一月"按钮
        if (this.nextMonthBtn) {
            this.nextMonthBtn.interactable = !isNextMonthFuture;
        }

        // 如果限制了只能选择近90天，检查上一个月是否超出限制
        if (this.canOnlySelectRecent3Months) {
            let prevMonth: number;
            let prevYear: number;

            prevMonth = this.currentMonth - 1;
            if (prevMonth < 0) {
                prevMonth = 11;
            }
            prevYear = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // 计算90天前的日期
            const ninetyDaysAgo = new Date(today);
            ninetyDaysAgo.setDate(today.getDate() - 90);

            // 获取上一个月的最后一天（而不是第一天）
            // 如果上一个月的最后一天早于90天前，说明整个上一个月都在90天范围外，应该禁用按钮
            const prevMonthLastDay = new Date(prevYear, prevMonth + 1, 0); // 获取上一个月的最后一天
            prevMonthLastDay.setHours(0, 0, 0, 0);

            // 如果上一个月的最后一天早于90天前，则禁用"上一月"按钮
            if (this.prevMonthBtn) {
                this.prevMonthBtn.interactable = prevMonthLastDay >= ninetyDaysAgo;
            }
        }
        else {
            // 如果没有限制，上一月按钮始终可用
            if (this.prevMonthBtn) {
                this.prevMonthBtn.interactable = true;
            }
        }
    }

    /**
     * 判断是否是月份的第一天
     */
    private isFirstDayOfMonth(date: Date): boolean {
        return date.getDate() === 1;
    }

    /**
     * 判断是否是月份的最后一天
     */
    private isLastDayOfMonth(date: Date): boolean {
        const year = date.getFullYear();
        const month = date.getMonth();
        const lastDay = new Date(year, month + 1, 0);
        return date.getDate() === lastDay.getDate();
    }

    /**
     * 判断日期类型（考虑跨月和行首/行尾）
     * @param date 当前日期
     * @param startDate 开始日期
     * @param endDate 结束日期
     * @param index 日期在网格中的索引位置（用于判断行首/行尾，包含空白占位）
     */
    private getDateType(date: Date, startDate: Date | null, endDate: Date | null, index: number): DateType {
        if (!startDate && !endDate) {
            return DateType.NORMAL;
        }

        const dateStr = this.formatDate(date);
        const startStr = startDate ? this.formatDate(startDate) : null;
        const endStr = endDate ? this.formatDate(endDate) : null;

        // 判断是否是行首（index % 7 === 0，周日位置）和行尾（index % 7 === 6，周六位置）
        const isRowStart = (index % 7 === 0);  // 周日，行的第一个
        const isRowEnd = (index % 7 === 6);    // 周六，行的最后一个

        // 判断是否是月份的第一天和最后一天
        const isFirstDay = this.isFirstDayOfMonth(date);
        const isLastDay = this.isLastDayOfMonth(date);

        // 如果只选中了开始时间，没有结束时间
        if (startDate && !endDate) {
            // 只有开始时间有效果1（不显示效果3和4）
            if (dateStr === startStr) {
                return DateType.START;  // 只显示效果1
            }
            return DateType.NORMAL;
        }

        // 如果选中了开始和结束时间
        if (startDate && endDate) {
            // 开始和结束是同一天
            if (startStr === endStr && dateStr === startStr) {
                // 同一天，根据位置判断
                if (isRowStart) {
                    return DateType.START_WITH_RANGE_START;  // 效果1+3
                }
                else if (isRowEnd) {
                    return DateType.END_WITH_RANGE_END;      // 效果1+4
                }
                return DateType.START_AND_END;  // 效果1
            }

            // 是开始日期
            if (dateStr === startStr) {
                // 如果开始时间是月份的最后一天，则只显示效果1（不显示效果3和4）
                if (isLastDay) {
                    return DateType.START;  // 只显示效果1
                }
                // 如果开始时间在行的最后一个（周六），则不显示效果3和4（只显示效果1）
                if (isRowEnd) {
                    return DateType.START;  // 只显示效果1，不显示效果3和4
                }
                // 如果开始时间不是行的最后一个，则显示效果1+3（包括行的第一个和其他位置）
                return DateType.START_WITH_RANGE_START;  // 效果1+3
            }

            // 是结束日期
            if (dateStr === endStr) {
                // 如果结束时间是月份的第一天，则只显示效果1（不显示效果3和4）
                if (isFirstDay) {
                    return DateType.END;  // 只显示效果1
                }
                // 如果结束时间在行的第一个（周日），则不显示效果3和4（只显示效果1）
                if (isRowStart) {
                    return DateType.END;  // 只显示效果1，不显示效果3和4
                }
                // 如果结束时间不是行的第一个，则显示效果1+4（包括行的最后一个和其他位置）
                return DateType.END_WITH_RANGE_END;  // 效果1+4
            }

            // 在范围内（跨月也能正确判断）
            // 使用格式化后的日期字符串进行比较，确保只比较年月日，忽略时间部分
            if (dateStr > startStr && dateStr < endStr) {
                // 范围内的日期，根据行首/行尾判断效果3或效果4
                // 如果跨行的是整行了，跨的那些行的第一个（周日）则是效果3
                if (isRowStart) {
                    return DateType.RANGE_START;  // 效果3：左半圆
                }
                // 跨的那些行的最后一个（周六）则是效果4
                if (isRowEnd) {
                    return DateType.RANGE_END;    // 效果4：右半圆
                }
                // 其他的则是效果2
                return DateType.IN_RANGE;         // 效果2：普通范围内日期
            }
        }

        return DateType.NORMAL;
    }

    /**
     * 格式化日期为 YYYY-MM-DD（用于比较，只比较年月日，忽略时分秒）
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 设置选择回调
     */
    setSelectionCallback(callback: (startDate: number | null, endDate: number | null) => void) {
        this.onSelectionChange = callback;
    }

    /**
     * 清除选择
     */
    clearSelection() {
        this.selectionState.startDate = null;
        this.selectionState.endDate = null;
        this.selectionState.isSelecting = false;
        this.updateCalendar();
    }

    /**
     * 设置已选择的日期范围
     */
    setSelectedRange(startDate: Date, endDate: Date) {
        // 创建标准化的日期对象用于比较（只比较年月日）
        const normalizedStart = new Date(startDate);
        normalizedStart.setHours(0, 0, 0, 0);
        const normalizedEnd = new Date(endDate);
        normalizedEnd.setHours(0, 0, 0, 0);

        // 确保开始日期 <= 结束日期
        if (normalizedStart > normalizedEnd) {
            [startDate, endDate] = [endDate, startDate];
        }

        // 开始时间设置为当天的 0点0分0秒
        const finalStartDate = new Date(startDate);
        finalStartDate.setHours(0, 0, 0, 0);

        // 结束时间设置为当天的 23点59分59秒
        const finalEndDate = new Date(endDate);
        finalEndDate.setHours(23, 59, 59, 999);

        this.selectionState.startDate = finalStartDate;
        this.selectionState.endDate = finalEndDate;
        this.selectionState.isSelecting = false;
        this.updateCalendar();
    }

    /**
     * 获取当前选择的日期范围
     */
    getSelectedRange(): { startDate: Date | null, endDate: Date | null } {
        return {
            startDate: this.selectionState.startDate,
            endDate: this.selectionState.endDate
        };
    }

    /**
     * 回收节点到对象池
     * @param node 要回收的节点
     */
    protected putPoolNode(node: Node) {
        this.dateItemPool.put(node);
    }

    /**
     * 从对象池获取节点
     * @returns 节点或null
     */
    protected getPoolNode(): Node | null {
        return this.dateItemPool.get();
    }

    /**
     * 清理所有日期项到对象池（组件销毁时调用）
     */
    private recycleAllDateItems() {
        if (!this.datesContainer) return;

        // 检查节点是否有效，以及 children 是否存在
        if (!this.datesContainer.isValid || !this.datesContainer.children) {
            this.dateItems = [];
            return;
        }

        // 将所有日期项回收到对象池
        // 注意：put 方法内部会自动调用 removeFromParent，所以不需要手动调用
        const children = this.datesContainer.children.slice();
        for (const child of children) {
            if (child && child.isValid) {
                this.putPoolNode(child);
            }
        }

        this.dateItems = [];
    }


    onClickClose() {
        
    }
}


