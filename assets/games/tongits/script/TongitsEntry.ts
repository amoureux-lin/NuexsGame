import { _decorator, AudioClip, Font, Prefab, ProgressBar, Label, sp, SpriteFrame } from 'cc';
import { Nexus, NexusBaseEntry, NexusEvents } from 'db://nexus-framework/index';
import { tongitsUI, TongitsUIPanelConfig } from './config/TongitsUIConfig';
import { TongitsController } from './game/TongitsController';
import { TongitsModel } from './game/TongitsModel';
import { TONGITS_MSG_REGISTRY } from './proto/msg_registry_tongits';
import { MessageType } from './proto/message_type';
import type { JoinRoomRes } from './proto/tongits';

const { ccclass, property } = _decorator;

/** 进度分段 */
const PROGRESS_COMMON_END = 30;
const PROGRESS_BUNDLE_END = 60;
const PROGRESS_CONNECT_END = 80;
const PROGRESS_JOIN_END = 100;

/**
 * Tongits 子游戏入口：Bundle 进入时由框架调用 onEnter/onExit。
 * Entry prefab 上挂载 Loading UI 节点（进度条等），加载完成后跳转场景。
 */
@ccclass('TongitsEntry')
export class TongitsEntry extends NexusBaseEntry {

    @property({ type: ProgressBar, tooltip: '进度条' })
    progressBar: ProgressBar | null = null;

    @property({ type: Label, tooltip: '进度文字' })
    progressLabel: Label | null = null;

    @property({ type: Label, tooltip: '进度数字' })
    progressNumber: Label | null = null;

    private _model: TongitsModel | null = null;
    private _controller: TongitsController | null = null;
    private _targetPercent = 0;
    private _displayProgress = 0;

    async onEnter(params?: Record<string, unknown>): Promise<void> {
        console.log('TongitsEntry onEnter');

        await super.onEnter(params);
        Nexus.proto.registerSubgame(TONGITS_MSG_REGISTRY);
        Nexus.ui.registerPanels(TongitsUIPanelConfig);

        this._model = new TongitsModel();
        this._controller = new TongitsController(this._model);
        await this._controller.start(params);

        await this.loadResources(params);
    }

    /**
     * 加载资源，按步骤更新进度条：
     * 1. 加载公共资源 (0-30%)
     * 2. 加载游戏 bundle 资源 (30-60%)
     * 3. WebSocket 建立连接 + 发送 joinRoomReq，等待加入房间成功返回 (60-100%)
     */
    async loadResources(params?: Record<string, unknown>): Promise<void> {
        this.setProgress(0, '加载公共资源...');

        // 1. 加载公共资源 0-30%
        const commonDirs = [
            { dir: 'prefabs', type: Prefab },
            { dir: 'emojis', type: sp.SkeletonData },
            { dir: 'fonts', type: Font },
            { dir: 'audios', type: AudioClip },
            { dir: 'images', type: SpriteFrame },
        ];
        for (let i = 0; i < commonDirs.length; i++) {
            const item = commonDirs[i];
            const start = (i / commonDirs.length) * PROGRESS_COMMON_END;
            const end = ((i + 1) / commonDirs.length) * PROGRESS_COMMON_END;
            await Nexus.asset.loadDir('common', item.dir, item.type as any, (finished, total) => {
                const ratio = total > 0 ? finished / total : 1;
                this.setProgress(start + ratio * (end - start), '加载公共资源...');
            });
        }
        this.setProgress(PROGRESS_COMMON_END, '加载游戏资源...');

        // 2. 加载游戏 bundle 资源 30-60%
        // TODO: 按需加载 tongits bundle 内的 prefab、图片等
        this.setProgress(PROGRESS_BUNDLE_END, '连接服务器...');

        // 3. WebSocket 连接 + joinRoom 60-100%
        if (!Nexus.net.isConnected()) {
            await new Promise<void>((resolve) => {
                const onConnected = () => {
                    Nexus.off(NexusEvents.NET_CONNECTED, onConnected, this);
                    resolve();
                };
                Nexus.on(NexusEvents.NET_CONNECTED, onConnected, this);
            });
        }
        this.setProgress(PROGRESS_CONNECT_END, '加入房间...');

        // 发送 joinRoomReq，等待响应
        const roomId = Number(params?.room_id ?? 0);
        const res = await Nexus.net.wsRequest<JoinRoomRes>(
            MessageType.TONGITS_JOIN_ROOM_REQ,
            { roomId },
        );
        console.log("joinRoomReq返回：",res);
        this._model.joinRoom(res);
        // this.setProgress(PROGRESS_JOIN_END, '进入游戏...');
        //
        // // 加载完成，跳转场景
        // await Nexus.bundle.runScene();
    }

    protected update(dt: number): void {
        const target = this._targetPercent / 100;
        this._displayProgress += (target - this._displayProgress) * Math.min(1, 3 * dt);
        const clamped = Math.min(1, Math.max(0, this._displayProgress));
        if (this.progressBar) this.progressBar.progress = clamped;
        if (this.progressNumber) this.progressNumber.string = Math.round(clamped * 100) + '%';
    }

    private setProgress(percent: number, tip?: string): void {
        this._targetPercent = Math.min(100, Math.max(0, percent));
        if (tip !== undefined && this.progressLabel) {
            this.progressLabel.string = tip;
        }
    }

    async onExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(tongitsUI);
        await super.onExit();
    }
}
