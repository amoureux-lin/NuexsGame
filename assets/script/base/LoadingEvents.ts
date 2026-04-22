/**
 * Loading 阶段枚举。
 * BaseGameEntry 按阶段顺序 emit PROGRESS 事件，BaseLoadingView 订阅后将
 * "阶段内进度（0-100）"映射为全局进度条位置。
 */
export enum LoadingStage {
    COMMON_RESOURCES = 'loading:common',
    BUNDLE_RESOURCES = 'loading:bundle',
    CONNECTING       = 'loading:connecting',
    JOINING          = 'loading:joining',
    DONE             = 'loading:done',
}

/**
 * PROGRESS 事件的 payload。
 * percent 是当前阶段内的进度（0-100），由 LoadingView 负责映射到全局进度条。
 */
export interface LoadingProgress {
    stage: LoadingStage;
    percent: number;
    tip?: string;
}

export const LoadingEvents = {
    /** Entry → LoadingView：进度更新；payload: LoadingProgress */
    PROGRESS: 'loading:progress',
    /** LoadingView → Entry：进度条动画已跑满，Entry 可以收尾销毁 */
    VIEW_DONE: 'loading:view_done',
} as const;
