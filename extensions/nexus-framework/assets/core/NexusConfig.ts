export type BundleType = 'common' | 'lobby' | 'subgame';

export type BundlePattern = 'mvc' | 'mvvm' | 'ecs' | 'component';

export interface BundleConfig {
    name: string;
    type: BundleType;
    remoteUrl?: string;
    pattern?: BundlePattern;
    preload?: boolean;
}

export interface NexusConfig {
    version: string;
    debug: boolean;
    entryBundle: string;
    enableLobby: boolean;
    hotUpdateUrl?: string;
    defaultLanguage: string;
    languages: string[];
    networkTimeout: number;
    bundles: BundleConfig[];
}
