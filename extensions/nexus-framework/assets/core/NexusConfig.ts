export type BundleType = 'common' | 'lobby' | 'subgame';

export type BundlePattern = 'mvc' | 'mvvm' | 'ecs' | 'component';

export type BundleOrientation = 'landscape' | 'portrait';

export interface BundleConfig {
    name: string;
    type: BundleType;
    /** 子游戏时可选：与 URL 参数 game_id 对应，enableLobby=false 时据此决定进入哪个 Bundle */
    gameId?: number;
    /** 游戏设计方向：landscape 横屏，portrait 竖屏；不填默认横屏。 */
    orientation?: BundleOrientation;
    /** 仅 Creator Browser Preview 调试使用：运行时按 orientation 同步旋转预览外框。 */
    previewRotateFrame?: boolean;
    remoteUrl?: string;
    pattern?: BundlePattern;
    preload?: boolean;
}

export interface NexusConfig {
    version: string;
    debug: boolean;
    /** 入口 Bundle，不填时根据 enableLobby 自动推导：有大厅用 lobby，无大厅用第一个 subgame */
    entryBundle?: string;
    enableLobby: boolean;
    hotUpdateUrl?: string;
    defaultLanguage: string;
    languages: string[];
    networkTimeout: number;
    bundles: BundleConfig[];
}
