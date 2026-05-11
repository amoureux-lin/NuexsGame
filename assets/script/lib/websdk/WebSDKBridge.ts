import { Nexus } from 'db://nexus-framework/index';
import { GameEvents } from 'db://assets/script/config/GameEvents';
import { WebSDK } from './WebSDK';
import { HandleMessageType, WebSdkGameStatus } from './WebSDKMessages';

/**
 * WebSDK 业务桥接层。
 *
 * 入站（Platform→Game）：init() 时注册 W2C_* 监听，转成 Nexus 事件 / 命令供业务订阅。
 * 出站（Game→Platform）：暴露语义化方法，调用方无需感知 WebSdkGameStatus 等协议细节。
 *
 * 调用约定：
 *   - 游戏生命周期 / 通用状态上报 / 平台关闭请求：统一走 WebSDKBridge；
 *   - 与具体业务点强耦合的即时调用（如 changeCoin / openResultEmoji / gameAction）：
 *     允许子游戏直接调 WebSDK，硬走桥层只是绕路。
 */
export class WebSDKBridge {
    private static _instance: WebSDKBridge | null = null;

    static getInstance(): WebSDKBridge {
        if (!WebSDKBridge._instance) WebSDKBridge._instance = new WebSDKBridge();
        return WebSDKBridge._instance;
    }

    private _initialized = false;

    private constructor() {}

    /** 注册 W2C 入站翻译。GameLauncher 在 WebSDK.init() 之后调用一次。 */
    init(): void {
        if (this._initialized) return;
        this._initialized = true;

        const sdk = WebSDK.getInstance();
        // 监听 表情播放
        sdk.on(HandleMessageType.W2C_PLAY_EMOJI, (data: any) => {
            Nexus.emit(GameEvents.PLAY_EMOJI, {
                userId: Number(data?.userId),
                type: Number(data?.type),
                content: data?.content,
            });
        });
        //  监听 游戏退出
        sdk.on(HandleMessageType.W2C_EXIT_GAME, () => {
            Nexus.emit(GameEvents.CMD_PLATFORM_EXIT);
        });
        //   监听 预约游戏退出
        sdk.on(HandleMessageType.W2C_PLAYER_PENDING_LEAVE, () => {
            Nexus.emit(GameEvents.CMD_PLATFORM_PENDING_LEAVE);
        });
        //   监听 换房
        sdk.on(HandleMessageType.W2C_PLAYER_SWITCH_ROOM, () => {
            Nexus.emit(GameEvents.CMD_PLATFORM_SWITCH_ROOM);
        });
    }

    // ── 出站：生命周期上报 ───────────────────────────────

    /** 加载流程开始 */
    notifyLoadingInit(): void {
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.INIT);
    }

    /** 加入房间成功 */
    notifyJoinRoom(roomId: string | number): void {
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.JOIN_ROOM, { roomId });
    }

    /** 游戏开始（带本人座位信息） */
    notifyGameStart(userId: number, seat: number): void {
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.GAME_ING, { userId, seat });
    }

    /** 当前在游戏中（断线重连 / 中途进入），可选传自己的座位号 */
    notifyGameInProgress(seat?: number): void {
        const params = seat !== undefined ? { seat } : {};
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.GAME_ING, params);
    }

    /** 游戏结束。resultType 取值对应 WebSDKMessages.ResultType：0=输 / 1=赢 / 2=平。 */
    notifyGameOver(resultType: number): void {
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.GAME_OVER, { resultType });
    }

    /** 游戏重置（回到等待状态） */
    notifyGameReset(): void {
        WebSDK.getInstance().gameStatus(WebSdkGameStatus.GAME_RESET);
    }

    // ── 出站：用户操作 / 异常 ────────────────────────────

    /** 请求平台关闭游戏（弹窗确认 / 被踢 / 服务器关闭 / 部分错误码触发） */
    requestPlatformExit(): void {
        WebSDK.getInstance().exitGame();
    }

    /** 通知平台破产，触发充值流程 */
    notifyBankrupt(): void {
        WebSDK.getInstance().bankrupt();
    }

    /**
     * 通知平台同步当前预约动作按钮状态。
     * 取值对应 proto.PendingRoomAction：0=无 / 1=预约换房 / 2=预约离开。
     */
    notifyPendingActionChanged(action: number): void {
        WebSDK.getInstance().refreshButtonStatus(action);
    }
}
