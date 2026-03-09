import { AudioClip, AudioSource, director, game, Node } from 'cc';
import { Nexus } from '../core/Nexus';
import { IAudioService } from '../services/contracts';

/**
 * 基于 AudioSource 的音频管理实现。
 *
 * 架构：
 *   - 创建一个跨场景持久节点 [NexusAudio]
 *   - 挂一个 AudioSource 专用于背景音乐（loop）
 *   - 挂 SFX_POOL_SIZE 个 AudioSource 组成音效池（playOneShot，自动复用空闲通道）
 */
export class AudioServiceImpl extends IAudioService {

    private static readonly SFX_POOL_SIZE = 6;

    private _musicVolume = 1;
    private _sfxVolume   = 1;
    private _musicEnabled = true;
    private _sfxEnabled   = true;

    private _audioNode:    Node        | null = null;
    private _musicSource:  AudioSource | null = null;
    private _sfxSources:   AudioSource[]      = [];

    /** 创建持久音频节点，并初始化音乐通道与音效池。 */
    async onBoot(): Promise<void> {
        this._audioNode = new Node('[NexusAudio]');

        // 添加到当前场景，再设为持久节点（CC3 要求）
        director.getScene()?.addChild(this._audioNode);
        game.addPersistRootNode(this._audioNode);

        // 背景音乐通道
        this._musicSource = this._audioNode.addComponent(AudioSource);
        this._musicSource.loop   = true;
        this._musicSource.volume = this._musicVolume;

        // 音效池
        for (let i = 0; i < AudioServiceImpl.SFX_POOL_SIZE; i++) {
            const src = this._audioNode.addComponent(AudioSource);
            src.loop   = false;
            src.volume = this._sfxVolume;
            this._sfxSources.push(src);
        }
    }

    /** 加载并播放背景音乐。 */
    async playMusic(bundle: string, path: string, loop = true): Promise<void> {
        if (!this._musicEnabled || !this._musicSource) return;
        const clip = await Nexus.asset.load<AudioClip>(bundle, path, AudioClip);
        this._musicSource.clip   = clip;
        this._musicSource.loop   = loop;
        this._musicSource.volume = this._musicVolume;
        this._musicSource.play();
    }

    /** 停止当前背景音乐。 */
    stopMusic(): void {
        this._musicSource?.stop();
    }

    /** 播放一个音效，优先复用空闲通道。 */
    async playSfx(bundle: string, path: string): Promise<void> {
        if (!this._sfxEnabled) return;
        const clip = await Nexus.asset.load<AudioClip>(bundle, path, AudioClip);
        // 优先找空闲通道，没有则复用第一个
        const src = this._sfxSources.find(s => !s.playing) ?? this._sfxSources[0];
        src.volume = this._sfxVolume;
        src.playOneShot(clip);
    }

    /** 设置背景音乐音量。 */
    setMusicVolume(vol: number): void {
        this._musicVolume = this.clamp01(vol);
        if (this._musicSource) this._musicSource.volume = this._musicVolume;
    }

    /** 设置音效音量。 */
    setSfxVolume(vol: number): void {
        this._sfxVolume = this.clamp01(vol);
        for (const src of this._sfxSources) src.volume = this._sfxVolume;
    }

    /** 开关背景音乐；关闭时会立即停止播放。 */
    setMusicEnabled(on: boolean): void {
        this._musicEnabled = on;
        if (!on) this.stopMusic();
    }

    /** 开关音效播放。 */
    setSfxEnabled(on: boolean): void {
        this._sfxEnabled = on;
    }

    /** 暂停全部音频通道。 */
    pauseAll(): void {
        this._musicSource?.pause();
        for (const src of this._sfxSources) src.pause();
    }

    /** 恢复全部音频通道。 */
    resumeAll(): void {
        if (this._musicEnabled && this._musicSource?.clip) this._musicSource.play();
        for (const src of this._sfxSources) {
            if (src.clip) src.play();
        }
    }

    /** 销毁持久音频节点并清空引用。 */
    async onDestroy(): Promise<void> {
        this.stopMusic();
        if (this._audioNode) {
            game.removePersistRootNode(this._audioNode);
            this._audioNode.destroy();
            this._audioNode = null;
        }
        this._musicSource = null;
        this._sfxSources  = [];
    }

    /** 将数值限制在 0 到 1 之间。 */
    private clamp01(v: number): number {
        return Math.min(1, Math.max(0, v));
    }
}
