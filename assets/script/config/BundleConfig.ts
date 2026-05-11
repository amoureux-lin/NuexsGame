import type { BundleConfig } from 'db://nexus-framework/index';

/** Bundle 列表：common / lobby / 子游戏，子游戏可通过 gameId 与 URL game_id 对应 */
export const bundles: BundleConfig[] = [
    { name: 'common', type: 'common', preload: true },
    { name: 'lobby', type: 'lobby', orientation: 'landscape', previewRotateFrame: true },
    { name: 'tongits', type: 'subgame', gameId: 5, orientation: 'landscape', previewRotateFrame: true },  // ?game_id=5 时直接进此子游戏
    { name: 'slotSlzq', type: 'subgame', gameId: 6, orientation: 'portrait', previewRotateFrame: true },  // ?game_id=6 时直接进此子游戏
];
