import { _decorator, AudioClip, Font, Prefab, sp, SpriteFrame } from 'cc';
import {logger, Nexus} from 'db://nexus-framework/index';
import { BaseGameEntry, CommonLoadDirItem } from 'db://assets/script/base/BaseGameEntry';
import { BaseGameEvents } from 'db://assets/script/base/BaseGameEvents';
import { PendingRoomAction } from 'db://assets/script/proto/game_common_room';
import { classifyWsError } from 'db://assets/script/base/errors';
import { SlzqUI, SlzqUIPanelConfig } from './config/SlzqUIConfig';
// import { SlzqController } from './game/SlzqController';
// import { SlzqModel } from './game/SlzqModel';
// import { TONGITS_MSG_REGISTRY } from './proto/msg_registry_slzq';
// import { MessageType } from './proto/message_type';
// import type { JoinRoomRes, SlzqPlayerInfo } from './proto/slzq';
import type { PlayerInfo } from 'db://assets/script/proto/game_common_room';

const { ccclass } = _decorator;

@ccclass('SlzqEntry')
export class SlzqEntry extends BaseGameEntry {

    // private _model: SlzqModel | null = null;
    // private _controller: SlzqController | null = null;

    protected async onGameInit(params?: Record<string, unknown>): Promise<void> {
        // Nexus.proto.registerSubgame(TONGITS_MSG_REGISTRY);
        Nexus.ui.registerPanels(SlzqUIPanelConfig);

        // this._model = new SlzqModel();
        // this._controller = new SlzqController(this._model);
        // await this._controller.start(params);
    }

    protected override getBundlePreloadDirs(): CommonLoadDirItem[] {
        return [
            { dir: 'res/prefabs',  type: Prefab,          weight: 20  },
            { dir: 'res/sekleton', type: sp.SkeletonData, weight: 20 },
            { dir: 'res/images',   type: SpriteFrame,     weight: 20 },
            { dir: 'res/fonts',    type: Font,            weight: 20  },
            { dir: 'res/audios',   type: AudioClip,       weight: 20 },

        ];
    }

    // /** 网络层：只发请求拿响应，不应用到 model。失败统一归类为 NetworkError / ProtocolError */
    // protected override async fetchJoinRoom(params?: Record<string, unknown>): Promise<JoinRoomRes> {
    //     const roomId = Number(params?.room_id ?? Nexus.data.get<number>('room_id') ?? 0);
    //     try {
    //         const res = await Nexus.net.wsRequest<JoinRoomRes>(
    //             MessageType.TONGITS_JOIN_ROOM_REQ,
    //             { roomId },
    //         );
    //         console.log('joinRoomRes:', res);
    //         return res;
    //     } catch (raw) {
    //         // wsRequest 抛出可能是字符串(timeout/disconnected)或 Error('server:code')
    //         // 归类后由基类按 retryable 决定是否重试
    //         throw classifyWsError(raw);
    //     }
    // }

    // /** 状态层：把响应应用到 Model。同步执行，抛错=bug，不重试 */
    // protected override applyJoinRoom(res: JoinRoomRes): void {
    //     Nexus.data.set('room_id', res?.roomInfo?.roomId || 0);
    //     this._model!.joinRoom(res);
    // }

    protected async mockJoinRoom(): Promise<void> {
        // const SELF_ID = 1001, P2_ID = 1002, P3_ID = 1003;

        // const mkPlayer = (userId: number, post = 0, seat = 0): PlayerInfo => ({
        //     userId, nickname: `Player_${userId}`, avatar: '',
        //     coin: 100000, seat, role: 2, post, state: 1,
        //     coinChanged: 0, micAllowStatus: 0, micOn: false,
        //     nextMicRequestTime: 0, micRequestExpiredTime: 0, waitReadyExpiredTime: 0,
        //     activePendingAction: PendingRoomAction.PENDING_ROOM_ACTION_NONE,
        // });

        // const mkSlzqPlayer = (userId: number, isDealer = false, post = 0, seat = 0): SlzqPlayerInfo => ({
        //     playerInfo: mkPlayer(userId, post, seat),
        //     handCardCount: 0, isDealer,
        //     displayedMelds: [], groupCards: [],handCards:[],
        //     isFight: false, countdown: 25,
        //     changeStatus: 1, status: 1, isWin: false, cardPoint: 0, isAuto: false,
        // });

        // const res: JoinRoomRes = {
        //     roomInfo: { roomId: 9999, roomName: 'Mock Room', roomStatus: 1, maxSeat: 3 },
        //     players: [
        //         mkSlzqPlayer(SELF_ID, false, 0, 1),
        //         mkSlzqPlayer(P2_ID,   false, 0, 2),
        //         mkSlzqPlayer(P3_ID,   false, 0, 3),
        //     ],
        //     watchers: [], playersCount: 3, speakers: [],
        //     self: mkSlzqPlayer(SELF_ID, false, 1, 1),
        //     gameInfo: undefined,
        //     playerSettings: undefined,
        // };

        // this._model!.joinRoom(res);
        console.log('[SlzqEntry] mock join room complete');
    }

    protected override onSceneReady(): void {
        // Nexus.emit(BaseGameEvents.MODEL_READY, this._model);
    }

    protected override async onLoadingComplete(): Promise<void> {
        // await Nexus.audio.playMusic('res/audios/Slzq_bg', true);
    }

    protected override async resyncRoom(): Promise<void> {
        console.log("resyncRoom");
        
        // this._model?.freeze();
        // try {
        //     // super.resyncRoom 走 joinRoomFlow（fetch + apply），retry/错误分类全部交给基类
            await super.resyncRoom();
        // } finally {
        //     this._model?.unfreeze();
        // }
    }

    protected async onGameExit(): Promise<void> {
        // this._controller?.destroy();
        // this._controller = null;
        // this._model = null;
        Nexus.ui.unregisterPanels(SlzqUI);
    }
}

