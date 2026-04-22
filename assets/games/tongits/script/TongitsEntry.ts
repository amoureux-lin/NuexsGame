import { _decorator, AudioClip, Font, SpriteFrame } from 'cc';
import { Nexus } from 'db://nexus-framework/index';
import { BaseGameEntry } from 'db://assets/script/base/BaseGameEntry';
import { BaseGameEvents } from 'db://assets/script/base/BaseGameModel';
import { TongitsUI, TongitsUIPanelConfig } from './config/TongitsUIConfig';
import { TongitsController } from './game/TongitsController';
import { TongitsModel } from './game/TongitsModel';
import { TONGITS_MSG_REGISTRY } from './proto/msg_registry_tongits';
import { MessageType } from './proto/message_type';
import type { JoinRoomRes, TongitsPlayerInfo } from './proto/tongits';
import type { PlayerInfo } from 'db://assets/script/proto/game_common_room';

const { ccclass } = _decorator;

@ccclass('TongitsEntry')
export class TongitsEntry extends BaseGameEntry {

    private _model: TongitsModel | null = null;
    private _controller: TongitsController | null = null;

    protected async onGameInit(params?: Record<string, unknown>): Promise<void> {
        Nexus.proto.registerSubgame(TONGITS_MSG_REGISTRY);
        Nexus.ui.registerPanels(TongitsUIPanelConfig);

        this._model = new TongitsModel();
        this._controller = new TongitsController(this._model);
        await this._controller.start(params);
    }

    protected async loadBundleResources(): Promise<void> {
        const bundleName = 'tongits';
        const dirs = [
            { dir: 'res/audios', type: AudioClip },
            { dir: 'res/font',   type: Font },
            { dir: 'res/image',  type: SpriteFrame },
        ];
        for (let i = 0; i < dirs.length; i++) {
            const segStart = (i / dirs.length) * 100;
            const segEnd   = ((i + 1) / dirs.length) * 100;
            await Nexus.asset.loadDir(bundleName, dirs[i].dir, dirs[i].type as any, (finished, total) => {
                const ratio = total > 0 ? finished / total : 1;
                this.setProgress(segStart + ratio * (segEnd - segStart), '加载游戏资源...');
            });
        }
    }

    protected async joinRoom(params?: Record<string, unknown>): Promise<void> {
        const roomId = Number(params?.room_id ?? Nexus.data.get<number>('room_id') ?? 0);
        Nexus.data.set('room_id', roomId);
        const res = await Nexus.net.wsRequest<JoinRoomRes>(
            MessageType.TONGITS_JOIN_ROOM_REQ,
            { roomId },
        );
        console.log('joinRoomRes:', res);
        this._model!.joinRoom(res);
    }

    protected async mockJoinRoom(): Promise<void> {
        const SELF_ID = 1001, P2_ID = 1002, P3_ID = 1003;

        const mkPlayer = (userId: number, post = 0, seat = 0): PlayerInfo => ({
            userId, nickname: `Player_${userId}`, avatar: '',
            coin: 100000, seat, role: 2, post, state: 1,
            coinChanged: 0, micAllowStatus: 0, micOn: false,
            nextMicRequestTime: 0, micRequestExpiredTime: 0, waitReadyExpiredTime: 0,
        });

        const mkTongitsPlayer = (userId: number, isDealer = false, post = 0, seat = 0): TongitsPlayerInfo => ({
            playerInfo: mkPlayer(userId, post, seat),
            handCardCount: 0, isDealer,
            displayedMelds: [], handCards: [],
            isFight: false, countdown: 25,
            changeStatus: 1, status: 1, isWin: false, cardPoint: 0,
        });

        const res: JoinRoomRes = {
            roomInfo: { roomId: 9999, roomName: 'Mock Room', roomStatus: 1, maxSeat: 3 },
            players: [
                mkTongitsPlayer(SELF_ID, false, 0, 1),
                mkTongitsPlayer(P2_ID,   false, 0, 2),
                mkTongitsPlayer(P3_ID,   false, 0, 3),
            ],
            watchers: [], playersCount: 3, speakers: [],
            self: mkTongitsPlayer(SELF_ID, false, 1, 1),
            gameInfo: undefined,
        };

        this._model!.joinRoom(res);
        console.log('[TongitsEntry] mock join room complete');
    }

    protected override onSceneReady(): void {
        Nexus.emit(BaseGameEvents.MODEL_READY, this._model);
    }

    protected override async onLoadingComplete(): Promise<void> {
        await Nexus.audio.playMusic('res/audios/Tongits_bg', true);
    }

    protected override async resyncRoom(): Promise<void> {
        this._model?.freeze();
        try {
            await this.joinRoom();
        } finally {
            this._model?.unfreeze();
        }
    }

    protected async onGameExit(): Promise<void> {
        this._controller?.destroy();
        this._controller = null;
        this._model = null;
        Nexus.ui.unregisterPanels(TongitsUI);
    }
}
