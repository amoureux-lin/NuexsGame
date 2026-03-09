import type { NexusConfig } from './NexusConfig';

export abstract class ServiceBase {
    /** 框架启动时调用，用于初始化服务状态。 */
    async onBoot(_config: NexusConfig): Promise<void> {}

    /** 框架销毁时调用，用于释放资源。 */
    async onDestroy(): Promise<void> {}

    /** 进入 Bundle 后调用，可用于做场景级初始化。 */
    async onBundleEnter(_bundleName: string): Promise<void> {}

    /** 离开 Bundle 前调用，可用于做场景级清理。 */
    async onBundleExit(_bundleName: string): Promise<void> {}
}
