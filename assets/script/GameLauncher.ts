import { _decorator, Component, Node } from 'cc';
import { bootstrapNexus, getCurrentSearch, getQueryParams, Nexus } from 'db://nexus-framework/index';
import type { NexusConfig } from 'db://nexus-framework/index';
import { bundles } from './config/GameConfig';

const { ccclass, property } = _decorator;

/**
 * 游戏启动器：在首场景挂载此组件，负责注册框架、初始化配置并进入入口 Bundle。
 * 使用方式：挂到场景中任意节点（建议 Canvas），将 Canvas 节点拖到 canvasRoot。
 */
@ccclass('GameLauncher')
export class GameLauncher extends Component {

    @property(Node)
    canvasRoot: Node = null!;

    async onLoad(): Promise<void> {
        bootstrapNexus();

        const params = getQueryParams();
        console.log(params);

        const search = getCurrentSearch();
        console.log(search);

        await this.gameInit();

        Nexus.ui.setRoot(this.canvasRoot);

        await Nexus.start();

    }

    async gameInit(): Promise<void> {
        const config: NexusConfig = {
            version: '1.0.0',
            debug: true,
            enableLobby: true,  // 不填 entryBundle 时：true → 进 lobby，false → 进第一个 subgame
            defaultLanguage: 'zh_CN',
            languages: ['zh_CN', 'en_US'],
            networkTimeout: 10000,
            bundles: bundles,
        };

        await Nexus.init(config);
    }
}
