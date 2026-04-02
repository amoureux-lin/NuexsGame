import { _decorator, Component, Node } from 'cc';
import { bootstrapNexus, getCurrentSearch, getQueryParams, Nexus } from 'db://nexus-framework/index';
import type { NexusConfig } from 'db://nexus-framework/index';
import { bundles } from './config/BundleConfig';
import { CommonUI, UIPanelConfig } from './config/UIConfig';
import { COMMON_MSG_REGISTRY } from './proto/msg_registry_common';
import { WsDelegate } from './net/WsDelegate';

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
        console.log("params:",params);
        
        await this.gameInit();
        Nexus.ui.setRoot(this.canvasRoot);
        Nexus.ui.registerPanels(UIPanelConfig);
        Nexus.ui.setLoadingPanel(CommonUI.NET_LOADING);
        Nexus.ui.setMaskPanel(CommonUI.MASK);
        await Nexus.start(params);

    }

    async gameInit(): Promise<void> {
        // 初始化 WS 委托（编解码 + 拦截 + 连接状态 UI）
        Nexus.net.initWs({
            autoReconnect: 3,
            reconnectDelayMs: 1000,
            requestTimeoutMs: 5000,
            heartbeatIntervalMs: 5000,
            receiveTimeoutMs: 6000,
        }, new WsDelegate());
        // 初始化 Nexus 配置
        const config: NexusConfig = {
            version: '1.0.0',
            debug: true,
            enableLobby: false,  // 不填 entryBundle 时：true → 进 lobby，false → 进第一个 subgame
            defaultLanguage: 'zh_CN',
            languages: ['zh_CN', 'en_US'],
            networkTimeout: 10000,
            bundles: bundles,
        };
        await Nexus.init(config);
        // 注册公共 Proto 消息映射，供 WS 收发时 getDecoder/getEncoder 查表
        Nexus.proto.registerCommon(COMMON_MSG_REGISTRY);
    }
}
