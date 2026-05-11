import { Nexus } from 'db://nexus-framework/index';
import {
    SendGameMessageType,
    HandleMessageType,
    ResultType,
    WebSdkGameStatus,
    type SendGameMessage,
    type HandleGameMessage,
} from './WebSDKMessages';

const win = window as any;

type MessageHandler = (data?: any) => void;

/**
 * WebSDK — 游戏与 Web 平台的 postMessage 通讯桥接。
 *
 * 发送：通过快捷方法或 sendMessage 向 parent window 发消息。
 * 接收：通过 on/off 注册 Platform→Game 消息监听，WebSDK 内部统一派发。
 */
export class WebSDK {
    private static _instance: WebSDK | null = null;

    static getInstance(): WebSDK {
        if (!WebSDK._instance) {
            WebSDK._instance = new WebSDK();
        }
        return WebSDK._instance;
    }

    private _handlers = new Map<string, Set<MessageHandler>>();
    private _boundHandleMessage = this._handleMessage.bind(this);
    private _initialized = false;

    private constructor() {}

    // ── 生命周期 ──────────────────────────────────────────────

    init(): void {
        if (this._initialized) return;
        this._initialized = true;
        win.addEventListener('message', this._boundHandleMessage, false);
    }

    destroy(): void {
        if (!this._initialized) return;
        this._initialized = false;
        win.removeEventListener('message', this._boundHandleMessage, false);
        this._handlers.clear();
    }

    // ── 监听 Platform → Game 消息 ─────────────────────────────

    on(type: HandleMessageType | string, handler: MessageHandler): void {
        if (!this._handlers.has(type)) this._handlers.set(type, new Set());
        this._handlers.get(type)!.add(handler);
    }

    off(type: HandleMessageType | string, handler: MessageHandler): void {
        this._handlers.get(type)?.delete(handler);
    }

    // ── 发送 Game → Platform 消息 ─────────────────────────────

    sendMessage(event: SendGameMessage): void {
        console.log('【WebSDK Send】', event);
        if (win.parent) {
            win.parent.postMessage(event, '*');
        }
    }

    exitGame(): void {
        this.sendMessage({ type: SendGameMessageType.C2W_EXIT_GAME });
    }

    changeCoin(coin: number): void {
        this.sendMessage({ type: SendGameMessageType.C2W_CHANGE_COIN, data: { coin } });
    }

    openUserData(userId: number): void {
        this.sendMessage({ type: SendGameMessageType.C2W_OPEN_USER_DATA, data: { userId } });
    }

    openResultEmoji(isWin: boolean = false): void {
        this.sendMessage({ type: SendGameMessageType.C2W_OPEN_RESULT_EMOJI, data: { isWin } });
    }

    closeResultEmoji(): void {
        this.sendMessage({ type: SendGameMessageType.C2W_CLOSE_RESULT_EMOJI, data: {} });
    }

    bankrupt(): void {
        this.sendMessage({ type: SendGameMessageType.C2W_BANKRUPT, data: {} });
    }

    voiceSwitch(isMuted: boolean): void {
        this.sendMessage({ type: SendGameMessageType.C2W_VOICE_SWITCH, data: { isMuted } });
    }

    memberUpdate(): void {
        this.sendMessage({ type: SendGameMessageType.C2W_MEMBER_UPDATE, data: {} });
    }

    gameStatus(status: WebSdkGameStatus, params: Record<string, unknown> = {}): void {
        const userId = Nexus.data.get<string | number>('user_id') ?? '';
        this.sendMessage({
            type: SendGameMessageType.C2W_GAME_STATUS,
            data: { status, params: { ...params, userId } },
        });
    }

    changeRoom(roomId: number): void {
        this.gameStatus(WebSdkGameStatus.JOIN_ROOM, { roomId });
    }

    refreshButtonStatus(activePendingAction: number): void {
        this.sendMessage({ type: SendGameMessageType.C2W_REFRESH_BUTTON_STATUS, data: { status: activePendingAction } });
    }

    gameAction(args: Record<string, unknown> = {}): void {
        this.sendMessage({ type: SendGameMessageType.C2W_GAME_ACTION, data: args });
    }

    // ── 接收处理 ──────────────────────────────────────────────

    private _handleMessage(event: MessageEvent): void {
        const message: HandleGameMessage = event.data;
        if (!message?.type) return;
        console.log('【WebSDK Receive】', message);
        const handlers = this._handlers.get(message.type);
        if (handlers && handlers.size > 0) {
            for (const handler of handlers) {
                handler(message.data);
            }
        }
    }
}
